#!/usr/bin/env node
/**
 * 「继续对话」按指令智能执行（2026-11-20）
 *
 * 用户提问：「"继续对话"的时候应该要根据用户输入的任务指令来智能判断要如何执行任务才合理吧」
 *
 * 原实现把行为写死在一句话里（buildChatContinuationInput）：
 *   「请基于全部上下文直接输出更新后的**完整**交付件」
 * 于是无论用户说什么都全量重写。实测三个真实历史轮次，全部被无视指令类型：
 *   3164b853「既然定向修复了，怎么没输出交付物」（**提问**）→ 重生成 143K 字符
 *   b772a7f3「重新生成」（全量重写）                        → 61K 字符（这个是对的）
 *   054eb009「把质量最差的 3 条用例的预期结果改得更具体」（**只需改 3 行**）→ 重生成 63K 字符
 *
 * 全量重写的代价不只是慢和贵：
 *   - 想改 3 条却重写全文，原本满意的部分可能被改坏；
 *   - 只是提问却被当成修改指令，白白产出一个新版本；
 *   - 每轮都产新版本，用户分不清哪一版是自己想要的。
 *
 * 本文件验证四件事：
 *   A. 意图分类：五种模式在真实语料上判对，判不准时落到 refine（不比旧行为差）
 *   B. 行级补丁：只改点名的行，其余原样；列顺序变了也能按表头对齐
 *   C. 追加：只加新行，跳过重复编号，不插进统计表
 *   D. 服务端接线：提示词按模式分化、结果按模式落地、问答不产新版本
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = await import(path.join(ROOT, 'backend', 'lib', 'chat-intent.js'));
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 继续对话按指令智能执行 ===');

// ---------------- A) 意图分类 ----------------
console.log('\n-- A. 意图分类 --');

t('★ 提问不当作修改指令（真实案例 3164b853）', () => {
  const r = CI.classifyChatIntent('既然定向修复了，怎么没输出交付物');
  assert.strictEqual(r.mode, 'question', `判成了 ${r.mode}（${r.reason}）`);
});

t('★ 明确要求重来 → 全量重写（真实案例 b772a7f3）', () => {
  for (const s of ['重新生成', '全部重写一遍', '从头生成一份', '重新来过']) {
    assert.strictEqual(CI.classifyChatIntent(s).mode, 'regenerate', `「${s}」判错`);
  }
});

t('★ 点名改几条 → 定点修改（真实案例 054eb009）', () => {
  const r = CI.classifyChatIntent('把质量最差的 3 条用例的预期结果改得更具体，要带明确状态码和字段名');
  assert.strictEqual(r.mode, 'surgical', `判成了 ${r.mode}`);
  assert.strictEqual(r.count, 3, `条数识别为 ${r.count}`);
});

t('指定用例编号 → 定点修改，并抽出编号', () => {
  const r = CI.classifyChatIntent('改一下 TC-005 的预期结果');
  assert.strictEqual(r.mode, 'surgical');
  assert.deepStrictEqual(r.caseIds, ['TC-005']);

  const r2 = CI.classifyChatIntent('TC-001 和 TC-012 的步骤要写细一点');
  assert.strictEqual(r2.mode, 'surgical');
  assert.deepStrictEqual(r2.caseIds.sort(), ['TC-001', 'TC-012']);
});

t('★ 问句 + 重来 同时出现 → 以「重来」为准', () => {
  // 「为什么没生成，重新生成一遍」真实意图是重来，不是解释
  const r = CI.classifyChatIntent('为什么没生成交付物，重新生成一遍');
  assert.strictEqual(r.mode, 'regenerate', `判成了 ${r.mode}`);
});

t('要求追加 → append', () => {
  for (const s of ['再补充几条边界值用例', '追加 5 条异常场景', '增加几条安全测试用例']) {
    assert.strictEqual(CI.classifyChatIntent(s).mode, 'append', `「${s}」判错`);
  }
});

t('未指名具体条目 → 全局修订（保持旧行为，不比现在差）', () => {
  for (const s of ['把整份用例的预期结果都加上状态码', '优化一下整体结构', '完善一下覆盖']) {
    assert.strictEqual(CI.classifyChatIntent(s).mode, 'refine', `「${s}」判错`);
  }
});

t('没有可改的交付物时不能定点修改（只能重新生成）', () => {
  const r = CI.classifyChatIntent('改一下 TC-005', { hasDeliverable: false });
  assert.strictEqual(r.mode, 'regenerate', `判成了 ${r.mode}，没有交付物时无法定点替换`);
});

t('空指令（仅上传材料）→ 全局修订', () => {
  assert.strictEqual(CI.classifyChatIntent('').mode, 'refine');
});

t('每种模式都有中文标签（前端要直接展示给用户）', () => {
  for (const s of ['为什么没生成', '重新生成', '改 TC-1', '再补充几条', '整体优化']) {
    const r = CI.classifyChatIntent(s);
    assert.ok(r.label && r.label.length > 0, `「${s}」缺 label`);
    assert.ok(r.reason && r.reason.length > 0, `「${s}」缺 reason`);
  }
});

// ---------------- B) 行级补丁 ----------------
console.log('\n-- B. 行级补丁 --');

const ORIGINAL = [
  '# 测试用例集',
  '',
  '| 用例编号 | 用例名称 | 维度 | 层级 | 执行步骤 | 预期结果 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| TC-001 | 登录成功 | ① 用户 / 场景法 | 正常 | 1.输入账号 2.提交 | 返回 200 |',
  '| TC-002 | 密码错误 | ① 用户 / 等价类 | 异常 | 1.输入错密码 2.提交 | 提示错误 |',
  '| TC-003 | 锁定账号 | ① 用户 / 边界值 | 边界 | 1.连续5次错误 | 账号锁定 |',
  '',
  '## 统计',
  '| 指标 | 值 |',
  '| --- | --- |',
  '| 总计 | 3 |',
].join('\n');

t('★★ 只改点名的行，其余行逐字保留', () => {
  const patch = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 执行步骤 | 预期结果 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| TC-002 | 密码错误 | ① 用户 / 等价类 | 异常 | 1.输入错误密码 2.点击提交 | 返回 401 且 code=1001 |',
  ].join('\n');
  const r = CI.applyRowPatch(ORIGINAL, patch);
  assert.strictEqual(r.replaced, 1, `替换了 ${r.replaced} 条`);
  assert.deepStrictEqual(r.replacedIds, ['TC-002']);

  const lines = r.text.split('\n');
  // TC-001/TC-003 必须逐字不变
  assert.ok(lines.includes('| TC-001 | 登录成功 | ① 用户 / 场景法 | 正常 | 1.输入账号 2.提交 | 返回 200 |'),
    'TC-001 被改动了');
  assert.ok(lines.includes('| TC-003 | 锁定账号 | ① 用户 / 边界值 | 边界 | 1.连续5次错误 | 账号锁定 |'),
    'TC-003 被改动了');
  // 统计表不能被动
  assert.ok(lines.includes('| 总计 | 3 |'), '统计表被改动了');
  // 行数不变
  assert.strictEqual(lines.length, ORIGINAL.split('\n').length, '行数变了，说明结构被破坏');
});

t('★ 模型打乱列顺序也能按表头对齐（不能按位置硬填）', () => {
  const patch = [
    '| 预期结果 | 用例编号 | 执行步骤 | 层级 | 维度 | 用例名称 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 返回 403 | TC-003 | 1.改步骤 | 异常 | ① 用户 / 边界值 | 锁定账号 |',
  ].join('\n');
  const r = CI.applyRowPatch(ORIGINAL, patch);
  assert.strictEqual(r.replaced, 1);
  const row = r.text.split('\n').find((l) => l.includes('TC-003'));
  assert.ok(row.includes('返回 403'), `预期结果没落到正确列：${row}`);
  assert.ok(row.includes('① 用户 / 边界值'), `维度列被写错：${row}`);
  // 依据原表头顺序输出：编号|名称|维度|层级|步骤|预期
  assert.ok(/^\| TC-003 \| 锁定账号 \| ① 用户 \/ 边界值 \| 异常 \| 1\.改步骤 \| 返回 403 \|$/.test(row),
    `列顺序没按原表对齐：${row}`);
});

t('补丁里的编号在原表中不存在 → 报 missed，不静默丢弃', () => {
  const patch = [
    '| 用例编号 | 预期结果 |',
    '| --- | --- |',
    '| TC-999 | 返回 200 |',
  ].join('\n');
  const r = CI.applyRowPatch(ORIGINAL, patch);
  assert.strictEqual(r.replaced, 0);
  assert.deepStrictEqual(r.missed, ['TC-999'], '没有报告未匹配的编号');
  assert.strictEqual(r.text, ORIGINAL, '没匹配上却改动了原文');
});

t('补丁是空表 → 原文不动（不能把交付物清空）', () => {
  const r = CI.applyRowPatch(ORIGINAL, '这里没有任何表格');
  assert.strictEqual(r.replaced, 0);
  assert.strictEqual(r.text, ORIGINAL);
});

// ---------------- C) 追加 ----------------
console.log('\n-- C. 追加 --');

t('★ 新行插到用例表末尾，不插进统计表', () => {
  const add = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 执行步骤 | 预期结果 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| TC-004 | 空账号 | ① 用户 / 等价类 | 异常 | 1.不输入 2.提交 | 返回 400 |',
  ].join('\n');
  const r = CI.appendRows(ORIGINAL, add);
  assert.strictEqual(r.added, 1);
  assert.deepStrictEqual(r.addedIds, ['TC-004']);

  const lines = r.text.split('\n');
  const idxNew = lines.findIndex((l) => l.includes('TC-004'));
  const idxStat = lines.findIndex((l) => l.includes('## 统计'));
  const idxOldLast = lines.findIndex((l) => l.includes('TC-003'));
  assert.ok(idxNew > idxOldLast, '新行没插在原有行之后');
  assert.ok(idxNew < idxStat, '新行被插到统计表里了');
});

t('★ 模型把原有行也吐出来 → 按编号去重，不重复插入', () => {
  const add = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 执行步骤 | 预期结果 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| TC-001 | 登录成功 | ① 用户 / 场景法 | 正常 | 1.输入账号 2.提交 | 返回 200 |',
    '| TC-004 | 空账号 | ① 用户 / 等价类 | 异常 | 1.不输入 2.提交 | 返回 400 |',
  ].join('\n');
  const r = CI.appendRows(ORIGINAL, add);
  assert.strictEqual(r.added, 1, `插入了 ${r.added} 条，应只插 1 条`);
  assert.deepStrictEqual(r.addedIds, ['TC-004']);
  const count = (r.text.match(/\| TC-001 \|/g) || []).length;
  assert.strictEqual(count, 1, `TC-001 出现了 ${count} 次`);
});

// ---------------- D) 服务端接线 ----------------
console.log('\n-- D. 服务端接线 --');

t('★ 提示词不再写死「输出完整交付件」，而是按模式分化', () => {
  const start = SERVER.indexOf('function buildChatContinuationInput');
  const body = SERVER.slice(start, start + 4200);
  assert.ok(/MODE_INSTRUCTIONS/.test(body), '没有按模式分化的指令表');
  for (const m of ['question', 'regenerate', 'surgical', 'append', 'refine']) {
    assert.ok(new RegExp(`${m}:\\s*\\[`).test(body), `缺 ${m} 模式的提示词`);
  }
  // 提问模式必须明确禁止产出交付物
  const qIdx = body.indexOf('question: [');
  const qBlock = body.slice(qIdx, qIdx + 400);
  assert.ok(/不要输出新的交付物|不要输出.*完整交付件/.test(qBlock), '提问模式没有禁止产出交付物');
  // 定点模式必须要求「只输出待修改的那几条」
  const sIdx = body.indexOf('surgical: [');
  const sBlock = body.slice(sIdx, sIdx + 700);
  assert.ok(/只包含待修改的那几条/.test(sBlock), '定点模式没有限制只返回待改行');
});

t('★ 定点/追加模式把现有交付物给模型（否则不知道原编号）', () => {
  const start = SERVER.indexOf('function buildChatContinuationInput');
  const body = SERVER.slice(start, start + 4200);
  assert.ok(/mode === 'surgical' \|\| mode === 'append'/.test(body), '没给现有交付物');
  // 问答模式只给摘要，避免 14 万字塞进上下文
  assert.ok(/summarizeDeliverableForQuestion/.test(body), '问答模式没用摘要');
});

t('★★ 结果落地按模式分流：定点按行替换、问答不产新版本', () => {
  const start = SERVER.indexOf("if (intent.mode === 'question') {");
  assert.ok(start > 0, '没有按模式分流结果落地');
  const body = SERVER.slice(start, start + 2600);
  assert.ok(/producedDeliverable = false/.test(body), '问答模式没有阻止落盘');
  assert.ok(/applyChatRowPatch\(currentDeliverable, text\)/.test(body), '定点模式没有按行替换');
  assert.ok(/appendChatRows\(currentDeliverable, text\)/.test(body), '追加模式没有按行追加');
  // 定点替换后的完整文档才是落盘对象
  assert.ok(/effectiveText = patched\.text/.test(body), '定点模式没有用替换后的完整文档落盘');
});

t('★ 质量检查对象是 effectiveText（不能拿几行补丁去跑门禁）', () => {
  // 只看 chat 轮次内部，不能误伤主生成流程（那里的 text 本来就是完整交付物）
  const chatStart = SERVER.indexOf('async function executeChatRound');
  const chatEnd = SERVER.indexOf("app.post('/api/tasks/:id/chat'", chatStart);
  const chatBody = SERVER.slice(chatStart, chatEnd);
  assert.ok(/applyCaseInputRepairs\(effectiveText\)/.test(chatBody),
    'chat 轮质量检查没用 effectiveText；定点模式下模型只返回几行补丁，会得出「0 条用例」的假结果');
  assert.ok(!/applyCaseInputRepairs\(text\)/.test(chatBody),
    'chat 轮里还有地方在用原始 text 做质量检查');
});

t('质量检查带 targetKind（AI 应用任务不能按传统规则判）', () => {
  const idx = SERVER.indexOf('applyCaseInputRepairs(effectiveText)');
  const body = SERVER.slice(idx, idx + 900);
  assert.ok(/targetKind: AI_APP_TARGET_AGENTS\.has\(task\.agent\)/.test(body), 'chat 轮门禁没传 targetKind');
});

t('失败/未匹配必须明确告知用户（不能让他以为改生效了）', () => {
  assert.ok(/定点修改未匹配到任何用例编号/.test(SERVER), '定点失败没有提示');
  assert.ok(/本轮为问答，未改动交付物/.test(SERVER), '问答没说明未改动交付物');
  const idx = SERVER.indexOf('定点修改未匹配到任何用例编号');
  const body = SERVER.slice(Math.max(0, idx - 400), idx + 200);
  assert.ok(/modeNote/.test(body), '提示没有传给前端');
});

t('执行模式广播给前端（用户要知道这一轮要做什么）', () => {
  assert.ok(/intentMode: intent\.mode/.test(SERVER), '没把 intentMode 传给前端');
  assert.ok(/intent\.label.*intent\.reason/.test(SERVER), '开场提示没说清本轮要做什么');
});

t('当前交付物从最新 agent 版本文件读（不能拿 result 猜）', () => {
  assert.ok(/async function loadCurrentDeliverable/.test(SERVER), '缺 loadCurrentDeliverable');
  const start = SERVER.indexOf('async function loadCurrentDeliverable');
  const body = SERVER.slice(start, start + 800);
  assert.ok(/versionSource === 'agent'/.test(body), '没优先取 agent 版本');
  assert.ok(/fs\.readFile\(latest\.filePath/.test(body), '没读文件内容');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
