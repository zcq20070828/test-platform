#!/usr/bin/env node
/**
 * 上下文续做 单元测试（2026-11-17）
 *
 * 实测问题：用户在分步测试里输入「重新生成刚才那份需求的用例」（13 字），
 * 系统当成全新任务跑，模型手上只有这 13 个字 —— 如实回「原始需求文本缺失」，
 * 白跑 3.5 分钟、消耗 token，产出一份 14KB 的「无法生成」说明文档，
 * 而这份说明文档结构齐全，门禁给 95.8% 可用率、审核 73/72/74 通过，
 * 最终被当成「成功交付」。
 *
 * 三个断点：
 *   1) spawnAgentSession 的第 7 个参数 userId 没传 → histKey=null
 *      → conversationMessages=null，会话历史一条都没加载
 *   2) 输入里没有 UUID → enrichInputWithTaskReferences 直接返回 null
 *      → 没有任何「上一份任务」的注入通道
 *   3) 交付物「自述无法生成」没有被识别 → 干瘪的说明文档被当成交付物
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const DASHBOARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'DashboardView.vue'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 上下文续做 单元测试 ===');

// ---------------- 断点1：userId 必须传 ----------------
t('executeTaskAsync 的 spawn 调用传了 userId', () => {
  const call = SERVER.match(/spawnAgentSession\(task\.agent, task\.input, task\.id, null, true[^)]*\)/);
  assert.ok(call, '未找到 spawn 调用');
  assert.ok(/task\.userId \|\| null/.test(call[0]), `userId 未传：${call[0]}`);
});

t('多轮续写 executeChatRound 也传了 userId', () => {
  const call = SERVER.match(/spawnAgentSession\(task\.agent, chatInput, task\.id, null, true[^)]*\)/);
  assert.ok(call, '未找到 chat 续写 spawn 调用');
  assert.ok(/task\.userId \|\| null/.test(call[0]), `userId 未传：${call[0]}`);
});

t('follow-up 补问也传了 userId', () => {
  const call = SERVER.match(/spawnAgentSession\(task\.agent, followUpInput, task\.id, null, true[^)]*\)/);
  assert.ok(call, '未找到 followUp spawn 调用');
  assert.ok(/task\.userId \|\| null/.test(call[0]), `userId 未传：${call[0]}`);
});

// ---------------- 断点2：指代上一份产出的注入通道 ----------------
t('存在 enrichInputWithRecentContext（无 UUID 时的续做通道）', () => {
  assert.ok(/async function enrichInputWithRecentContext/.test(SERVER), '缺少续做注入函数');
});

t('UUID 通道未命中时会回落到续做通道', () => {
  // 2026-11-25 起这段外面包了三元（上游注入命中就跳过显式引用），
  // 所以匹配的是「referenced 判空 → else 里调续做通道」这个语义，
  // 不再要求 referenced 那一行必须是 const 声明。
  assert.ok(/enrichInputWithTaskReferences[\s\S]{0,400}?\n(\s*)if \(referenced\)[\s\S]{0,300}?\1\} else \{[\s\S]{0,300}?enrichInputWithRecentContext/.test(SERVER),
    '未接上回落逻辑');
});

t('续做识别按内容语义判断，不用长度上限', () => {
  // 原来这里断言「必须有一个长度上限（如 input > 400 就不算续做）」，
  // 作用是防「粘贴一整份需求文档，里面恰好有『继续优化』四个字」被误判成续做。
  //
  // 2026-11-25 改为按内容语义判断（用户要求：不能根据长度判断）。
  // 防误判现在靠的是**语义判据**而不是长度：
  //   有具体对象的新指令（编号/数量/领域名词）→ 按独立需求处理，不注入上文。
  //   「一份需求文档」必然含大量具体对象，自然不会被当成续做指令。
  const fn = SERVER.slice(SERVER.indexOf('async function enrichInputWithRecentContext'), SERVER.indexOf('async function enrichInputWithTaskReferences'));
  // 不许再有长度门槛
  assert.ok(!/input\.length > \d+\) return null/.test(fn), '仍在用长度上限排除长输入');
  // 必须用语义判定
  assert.ok(/assessSelfContained\(input\)/.test(fn), '未使用内容语义判定');
  assert.ok(/!semantic\.selfContained/.test(fn), '未用语义结果来判断是否续做');
});

t('续做识别要求含指代词', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function enrichInputWithRecentContext'), SERVER.indexOf('async function enrichInputWithTaskReferences'));
  assert.ok(/刚才|刚刚|上面|之前/.test(fn), '缺少指代词匹配');
});

t('挑选上一份任务时排除「本身就是空壳指令」的任务', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function enrichInputWithRecentContext'), SERVER.indexOf('async function enrichInputWithTaskReferences'));
  // 2026-11-25 改为按内容语义判断（用户要求：不能根据长度判断，要对内容做语义理解）。
  // 判定逻辑抽到 lib/instruction-semantics.js，这里只验接线是否正确。
  assert.ok(/isPureContinuation/.test(fn), '未使用统一的语义判定');
  assert.ok(/instruction-semantics\.js/.test(SERVER), '未引入语义模块');
  // 旧的长度门槛必须彻底去掉
  assert.ok(!/String\(t\.input\)\.length >= 100/.test(fn), '旧的「input ≥ 100」判据仍在');
  assert.ok(!/s\.length < 8/.test(fn), '仍在用长度阈值判断空壳');
});

t('注入内容包含上一份任务的需求原文与任务号', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function enrichInputWithRecentContext'), SERVER.indexOf('async function enrichInputWithTaskReferences'));
  assert.ok(/上一份任务的需求原文/.test(fn), '缺少需求原文段落');
  assert.ok(/任务 \$\{prev\.id\}/.test(fn), '缺少任务号引用');
});

// ---------------- 断点3：自述无法生成的交付物 ----------------
t('识别「自述无法生成」的交付物并判失败', () => {
  assert.ok(/INCOMPLETE_SELF_REPORT/.test(SERVER), '缺少自述防护正则');
  assert.ok(/caseRows < 5/.test(SERVER), '缺少用例行数判据');
});

t('自述防护只看开头（避免正文里偶然提到就误判）', () => {
  assert.ok(/slice\(0, 1200\)/.test(SERVER), '应只检查交付物开头');
});

t('自述防护要同时满足「自述 + 无成规模用例表」', () => {
  assert.ok(/INCOMPLETE_SELF_REPORT\.test\(selfReportHead\)[\s\S]{0,200}caseRows < 5/.test(SERVER),
    '两个条件必须同时满足');
});

// 规则自测
t('防护规则不误伤正常交付物', () => {
  const RE = /(无法(产出|生成|完成)|需求(原文|文本)[^。\n]{0,12}(缺失|未提供|不存在)|未提供(任何)?需求|请(先)?(提供|补充)需求)/;
  const judge = (head, rows) => RE.test(head) && rows < 5;
  // 命中：自述无法生成 + 无用例表
  assert.strictEqual(judge('## 结论：需求原文缺失导致本轮无法产出', 3), true);
  // 不命中：正常交付物（即使正文后面提到「未提供」）
  assert.strictEqual(judge('# 测试用例集\n## 项目信息', 120), false);
  // 命中：自述 + 少量用例
  assert.strictEqual(judge('本轮无法生成完整用例，因为需求文本未提供', 4), true);
  // 不命中：有正常用例规模
  assert.strictEqual(judge('需求原文缺失但已用推断字段生成', 48), false);
});

// ---------------- 前端提示 ----------------
t('前端对「指代上一份产出」的输入给出续做引导', () => {
  // 2026-11-23 起不再只是「提示」，而是直接把用户送进上一份任务的对话并发送，
  // 引导文案与「新建 vs 继续改」的选择都要在。
  assert.ok(/isRevisionInstruction/.test(DASHBOARD), '缺少续做指令识别');
  assert.ok(/enterChatModeAndSend/.test(DASHBOARD), '缺少「进入对话并发送」的路径');
  assert.ok(/在原任务里继续修改/.test(DASHBOARD), '缺少「在原任务里继续修改」选项');
});

t('前端续做引导排除带附件的提交', () => {
  // 带附件通常是「基于这份材料做事」，不该被当成「改上一次的产出」
  assert.ok(/isRevisionInstruction && \(!files \|\| files\.length === 0\)/.test(DASHBOARD),
    '缺少「无附件」这个触发条件');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
