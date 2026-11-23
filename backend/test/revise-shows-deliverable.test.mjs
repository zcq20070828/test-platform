#!/usr/bin/env node
/**
 * 优化后必须能看到新交付物（2026-11-23）
 *
 * 用户反馈：「现在优化完没见重新输出交付物啊，刚实测的就没见输出」。
 *
 * 排查出四个独立问题，每个都会让人「以为没输出」：
 *
 * 1. 【交付物卡片丢失，最直接】
 *    chat_message 只带正文、不带 artifacts。
 *    文件其实每轮都落盘了（实测 c1e6dc32 有 v5~v16 共 12 个文件，md/docx/xlsx 齐备），
 *    但前端拿不到文件列表，界面上只有一大段文字，没有可下载的卡片。
 *    更隐蔽的是：对话的流式消息先建，chat_message 后到且内容一致时走「去重收尾」分支，
 *    那个分支也没补 artifacts —— 即使后端发了也显示不出来。
 *
 * 2. 【版本号永远显示 v1】
 *    getTaskOutputFiles 是 ORDER BY created_at DESC（新→旧），
 *    代码却用 `.filter(...).pop()` 取最后一条 = **最旧**。已迭代到 v14 仍标 v1。
 *
 * 3. 【「优化完要输出交付物」没被识别成改稿指令】
 *    9 个字，既不在改稿词表里（词表有「优化一下」没有「优化完」），
 *    又被当成新任务走输入校验 → failed「输入长度不足」。
 *    实测任务 2a498980 就是这么失败的。
 *
 * 4. 【穷举动词永远补不完】
 *    连续两次漏判：「继续优化」「优化完」。改为模式识别 + 长度粗筛。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'DashboardView.vue'), 'utf8');
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'task-dao.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 优化后能看到新交付物 ===');

// ---------------- 1. 交付物卡片 ----------------
console.log('\n-- 1. 交付物卡片 --');

t('★★ 后端 chat_message 带上本轮产出的文件卡片', () => {
  const idx = SERVER.indexOf("const entry = [");
  const chatBlock = SERVER.slice(SERVER.indexOf('async function executeChatRound'), idx);
  assert.ok(/chatArtifacts/.test(chatBlock), 'chat_message 没有携带 artifacts');
  assert.ok(/artifacts: chatArtifacts\.length \? chatArtifacts : undefined/.test(chatBlock),
    'artifacts 没挂到 chat_message 上');
  // 必须真的去查文件表，不能凭空造
  assert.ok(/getTaskOutputFiles\(task\.id\)/.test(chatBlock), '没有查询本轮产出文件');
});

t('★ 只在真的产出交付物时才带卡片（问答轮不该冒出文件）', () => {
  const start = SERVER.indexOf('let chatArtifacts = [];');
  const block = SERVER.slice(start, start + 500);
  assert.ok(/if \(producedDeliverable\)/.test(block), '没判断本轮是否产出交付物');
});

t('★★ 前端「去重收尾」分支也要补 artifacts', () => {
  // 这是最容易漏的地方：流式消息先建，chat_message 后到且内容一致 → 走 dup 分支
  const idx = STORE.indexOf("case 'chat_message':");
  const block = STORE.slice(idx, idx + 1800);
  const dupIdx = block.indexOf('if (dup) {');
  assert.ok(dupIdx > 0, '找不到去重收尾分支');
  const dupBlock = block.slice(dupIdx, dupIdx + 900);
  assert.ok(/Array\.isArray\(data\.data\.artifacts\)/.test(dupBlock), '去重分支没补 artifacts');
  assert.ok(/dup\.artifacts = data\.data\.artifacts/.test(dupBlock), '没把 artifacts 赋给流式消息');
});

// ---------------- 2. 版本号 ----------------
console.log('\n-- 2. 版本号 --');

t('★★ 交付物版本号取最新那条（不是最旧）', () => {
  // 版本号代码在 if (text) 块里，离 agentVerLabel 声明有几十行，必须用足够大的窗口
  const idx = SERVER.indexOf('let agentVerLabel');
  assert.ok(idx > 0, '找不到 agentVerLabel');
  const block = SERVER.slice(idx, idx + 3000);
  // 只看代码行：注释里可能提到「原来用 filter().pop()」这种说明文字
  const codeLines = block.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  const code = codeLines.join('\n')
  assert.ok(/const lastAgent = outs\.find\(o => o\.versionSource === 'agent'\)/.test(code),
    '应使用 find（列表已按时间倒序，find 取到的是最新）')
  assert.ok(!/\.filter\([^)]*\)\.pop\(\)/.test(code),
    '仍用 filter().pop() —— 列表是 DESC，pop 取到最旧那条，会一直显示 v1')
});

t('★ 输出的排序确实是新→旧（版本号取法的前提）', () => {
  assert.ok(/ORDER BY created_at DESC/.test(DAO), '输出文件排序被改了，版本号取法需要重新审视');
});

// ---------------- 3&4. 改稿识别 ----------------
console.log('\n-- 3. 改稿指令识别 --');

function detectRevision(text) {
  const src = VIEW.slice(VIEW.indexOf('const REVISE_VERB'), VIEW.indexOf('\n  if (isRevisionInstruction'));
  const verbMatch = src.match(/const REVISE_VERB = \/(.+?)\//);
  const refMatch = src.match(/const REVISE_REF = \/(.+?)\//);
  assert.ok(verbMatch && refMatch, '找不到 REVISE_VERB / REVISE_REF');
  const verb = new RegExp(verbMatch[1]);
  const ref = new RegExp(refMatch[1]);
  const s = String(text).trim();
  return ref.test(s) || (verb.test(s) && s.length <= 80);
}

t('★★ 「优化完要输出交付物」被识别为改稿（实测失败的那条）', () => {
  // 实测任务 2a498980：9 个字，被当新任务 → failed「输入长度不足」
  assert.strictEqual(detectRevision('优化完要输出交付物'), true);
});

t('★★ 不再靠穷举动词（改用改稿动词模式）', () => {
  const src = VIEW.slice(VIEW.indexOf('const REVISE_VERB'), VIEW.indexOf('\n  if (isRevisionInstruction'));
  assert.ok(/优化\|改进\|完善\|修订\|调整/.test(src), '缺核心改稿动词模式');
  // 必须注明为什么改模式：穷举漏了两轮
  assert.ok(/穷举|补不完|模式识别/.test(VIEW.slice(VIEW.indexOf('续做\/改稿指令识别'), VIEW.indexOf('const REVISE_VERB'))),
    '没有说明为什么放弃穷举');
});

t('★ 常见改稿说法都能识别', () => {
  for (const s of ['继续优化', '还有优化空间，继续优化', '完善一下这个需求的测试覆盖', '改一下 TC-005', '重新生成']) {
    assert.strictEqual(detectRevision(s), true, `「${s}」没被识别为改稿`);
  }
});

t('★ 明确的新需求不被误判', () => {
  for (const s of ['帮我给登录功能设计测试用例', '对支付模块做安全测试，检查SQL注入漏洞和权限绕过']) {
    assert.strictEqual(detectRevision(s), false, `「${s}」被误判为改稿`);
  }
});

t('长度粗筛防误伤（长文本按新需求处理）', () => {
  // 改稿指令通常短（只说"改什么"），完整需求描述通常长（要说"做什么"）。
  // 阈值 80 字，样例必须超过它才能测到这条规则。
  const long = '优化登录接口的性能，关注TPS和响应时间，需要压测报告，覆盖并发100/500/1000三个档位，'
    + '并给出瓶颈分析与优化建议，最后输出完整的性能测试报告文档，包含环境配置、脚本说明、'
    + '每个档位的原始数据表格和结论';
  assert.ok(long.length > 80, `样例只有 ${long.length} 字，测不到长度粗筛`);
  assert.strictEqual(detectRevision(long), false, '长需求被误判为改稿');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
