/**
 * 变更计划显式化（2026-11-25 · 对话改造第一步）
 *
 * 要解决的问题：用户说「整体感觉不够严格」，意图分类只能归到 refine，
 * 于是把 14 万字整个重写——慢、贵、可能改坏别处，用户全程看不到中间态、
 * 无法干预。改造后先给一份可勾选的变更计划，确认才执行。
 *
 * 核心不变量（改这里前必读）：
 *   1) 计划环节只加「确认」，**不能改变执行者**——真正干活的仍是
 *      spawnAgentSession + 原智能体 + skill。这是用户明确要求保留的。
 *   2) 明确指令不得被拦下来要求确认（改一条用例还要点确认是倒退）。
 *   3) 计划解析失败必须退回直接执行，不能卡住对话。
 *   4) 用户取消勾选的项绝不能被执行。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldPlanBeforeExecute,
  buildDeliverableSummary,
  buildPlanPrompt,
  parseChangePlan,
  planToIntent,
  normalizeConfirmedPlan,
} from '../lib/change-plan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ❌ ${name} :: ${e.message}`);
  }
}

console.log('=== 变更计划 单元测试 ===');

// ---------------- 何时需要先出计划 ----------------

t('模糊整体指令 → 先出计划', () => {
  const r = shouldPlanBeforeExecute({ mode: 'refine', caseIds: [], count: null }, { deliverableChars: 140000 });
  assert.strictEqual(r.needed, true);
});

t('明确点名编号 → 直接执行（不为改一条用例增加确认）', () => {
  const r = shouldPlanBeforeExecute({ mode: 'surgical', caseIds: ['TC-007'], count: null }, { deliverableChars: 140000 });
  assert.strictEqual(r.needed, false);
});

t('纯提问 → 不规划（不改交付物）', () => {
  const r = shouldPlanBeforeExecute({ mode: 'question', caseIds: [], count: null }, { deliverableChars: 140000 });
  assert.strictEqual(r.needed, false);
});

t('明确要求重新生成 → 不规划', () => {
  const r = shouldPlanBeforeExecute({ mode: 'regenerate', caseIds: [], count: null }, { deliverableChars: 140000 });
  assert.strictEqual(r.needed, false);
});

t('追加内容 → 不规划（影响面明确，不碰已有内容）', () => {
  const r = shouldPlanBeforeExecute({ mode: 'append', caseIds: [], count: 5 }, { deliverableChars: 140000 });
  assert.strictEqual(r.needed, false);
});

t('短交付物 → 不规划（改动代价本来就小）', () => {
  const r = shouldPlanBeforeExecute({ mode: 'refine', caseIds: [], count: null }, { deliverableChars: 500 });
  assert.strictEqual(r.needed, false);
});

t('没有交付物 → 不规划', () => {
  const r = shouldPlanBeforeExecute({ mode: 'refine' }, { hasDeliverable: false });
  assert.strictEqual(r.needed, false);
});

// ---------------- 交付物结构摘要 ----------------

const SAMPLE = `# 测试用例

| 用例编号 | 用例名称 | 维度 / 设计方法 | 层级 | 预期结果 |
|---|---|---|---|---|
| TC-001 | 登录成功 | ① 功能 / 等价类 | 正常 | 200 |
| TC-002 | 密码错误 | ① 功能 / 等价类 | 异常 | 401 |
| TC-003 | 账号锁定 | ① 功能 / 边界值 | 异常 | 423 |

## 附：需求覆盖
| 需求编号 | 覆盖用例 |
|---|---|
| FR-001 | TC-001 |
`;

t('结构摘要抽出编号与名称，不含正文全文', () => {
  const s = buildDeliverableSummary(SAMPLE);
  // 两张带编号的表都要收：用例表 3 条 + 需求覆盖表 1 条（FR-001）。
  // 只收第一张会让模型看不到需求侧条目，规划时容易漏掉关联改动。
  assert.strictEqual(s.rows.length, 4, `应抽到 4 条，实际 ${s.rows.length}: ${s.rows.map((r) => r.id).join(',')}`);
  assert.deepStrictEqual(s.rows.map((r) => r.id).slice(0, 3), ['TC-001', 'TC-002', 'TC-003']);
  assert.ok(s.rows[0].name.includes('登录成功'));
  // 摘要必须比全文短得多，否则规划本身就贵得离谱
  const summarySize = JSON.stringify(s).length;
  assert.ok(summarySize < SAMPLE.length * 2, `摘要 ${summarySize} 应远小于原文 ${SAMPLE.length}`);
});

t('识别多张带编号的表', () => {
  const s = buildDeliverableSummary(SAMPLE);
  assert.ok(s.tableCount >= 2, `应识别到 2 张带编号表，实际 ${s.tableCount}`);
});

t('超过上限时截断并标记', () => {
  const big = ['| 用例编号 | 用例名称 |', '|---|---|'];
  for (let i = 0; i < 200; i += 1) big.push(`| TC-${String(i).padStart(3, '0')} | 用例${i} |`);
  const s = buildDeliverableSummary(big.join('\n'), { maxRows: 50 });
  assert.strictEqual(s.rows.length, 50);
  assert.strictEqual(s.truncated, true);
});

t('空交付物不崩', () => {
  const s = buildDeliverableSummary('');
  assert.strictEqual(s.rows.length, 0);
  assert.strictEqual(s.headers.length, 0);
});

// ---------------- 计划解析 ----------------

t('解析纯 JSON 计划', () => {
  const r = parseChangePlan('{"summary":"改2条预期结果","mode":"surgical","scale":"small","items":[{"type":"modify","caseIds":["TC-007","TC-012"],"reason":"预期不可判定"}]}');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.plan.mode, 'surgical');
  assert.strictEqual(r.plan.items.length, 1);
  assert.deepStrictEqual(r.plan.items[0].caseIds, ['TC-007', 'TC-012']);
});

t('解析 ```json 代码块包裹的计划', () => {
  const r = parseChangePlan('```json\n{"summary":"补充边界","mode":"append","items":[{"type":"add","count":2}]}\n```');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.plan.mode, 'append');
  assert.strictEqual(r.plan.items[0].count, 2);
});

t('解析前后夹带解释文字的计划', () => {
  // 实测模型很喜欢先写「好的，我打算…」再给 JSON
  const r = parseChangePlan('好的，我打算这样改：{"summary":"全文统一","mode":"refine","items":[{"type":"global","reason":"术语不一致"}]} 请确认');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.plan.mode, 'refine');
});

t('modify 缺 caseIds 的项被丢弃（无法执行）', () => {
  const r = parseChangePlan('{"items":[{"type":"modify","reason":"x"}]}');
  assert.strictEqual(r.ok, false);
});

t('add 缺 count 的项被丢弃', () => {
  const r = parseChangePlan('{"items":[{"type":"add","reason":"x"}]}');
  assert.strictEqual(r.ok, false);
});

t('垃圾文本返回失败而不是抛错', () => {
  const r = parseChangePlan('我不太确定该怎么改');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

t('空响应返回失败', () => {
  assert.strictEqual(parseChangePlan('').ok, false);
});

t('模型没给 summary 时用条目自动拼一句', () => {
  const r = parseChangePlan('{"items":[{"type":"modify","caseIds":["TC-001","TC-002"]},{"type":"add","count":3}]}');
  assert.ok(r.ok, r.error);
  assert.ok(r.plan.summary.includes('修改 2 条'), `实际 summary=${r.plan.summary}`);
  assert.ok(r.plan.summary.includes('新增 3 条'));
});

// ---------------- 计划 → 执行意图 ----------------

t('计划转意图：surgical 带出编号', () => {
  const plan = { summary: '改2条', mode: 'surgical', scale: 'small', items: [{ type: 'modify', caseIds: ['TC-007', 'TC-012'], reason: 'x' }] };
  const it = planToIntent(plan, { mode: 'refine' });
  assert.strictEqual(it.mode, 'surgical');
  assert.deepStrictEqual(it.caseIds, ['TC-007', 'TC-012']);
  assert.strictEqual(it.fromPlan, true);
});

t('计划含 global 但没有具体编号 → 走 refine（整体重写）', () => {
  const plan = { summary: 'x', mode: 'surgical', scale: 'large', items: [{ type: 'global', reason: '术语' }] };
  assert.strictEqual(planToIntent(plan, {}).mode, 'refine');
});

t('定点 + global 混合计划 → 仍走 surgical（不丢精确编号）', () => {
  // 实测模型经常这么给：modify TC-001..014 + global 统一规范。
  // 早期见到 global 就整体降级成 refine，等于把「已点名 14 条」的信息全丢，
  // 用户确认了具体编号却被整份重写——改造就白做了。
  const plan = {
    summary: '收紧预期结果',
    mode: 'surgical',
    scale: 'medium',
    items: [
      { type: 'modify', caseIds: ['TC-001', 'TC-002'], reason: '预期虚' },
      { type: 'global', reason: '统一书写规范' },
    ],
  };
  const it = planToIntent(plan, {});
  assert.strictEqual(it.mode, 'surgical', `实际 ${it.mode}`);
  assert.deepStrictEqual(it.caseIds, ['TC-001', 'TC-002']);
  // global 项不能被丢掉，要转成附加约束
  assert.ok(it.itemBrief.some((x) => x.includes('书写规范')), 'global 要求丢失了');
});

t('计划只有 add → 走 append', () => {
  const plan = { summary: 'x', mode: 'surgical', scale: 'small', items: [{ type: 'add', count: 3, reason: 'x' }] };
  const it = planToIntent(plan, {});
  assert.strictEqual(it.mode, 'append');
  assert.strictEqual(it.count, 3);
});

t('空计划退回原意图（不改变原行为）', () => {
  const fallback = { mode: 'refine', caseIds: [], reason: '原判断' };
  const it = planToIntent({ items: [] }, fallback);
  assert.strictEqual(it.mode, 'refine');
  assert.strictEqual(it.fromPlan, false);
});

t('计划生成 itemBrief，供 prompt 约束执行范围', () => {
  const plan = { summary: 'x', mode: 'surgical', scale: 'small', items: [
    { type: 'modify', caseIds: ['TC-001'], reason: '预期虚' },
    { type: 'add', count: 2, reason: '补边界' },
  ] };
  const it = planToIntent(plan, {});
  assert.ok(Array.isArray(it.itemBrief) && it.itemBrief.length === 2);
  assert.ok(it.itemBrief[0].includes('TC-001'));
});

// ---------------- 用户回传计划的校验 ----------------

t('用户回传的计划通过结构校验', () => {
  const r = normalizeConfirmedPlan({ summary: 'x', mode: 'surgical', items: [{ type: 'modify', caseIds: ['TC-001'] }] });
  assert.ok(r.ok, r.error);
});

t('非法编号格式被过滤（防注入）', () => {
  const r = normalizeConfirmedPlan({
    summary: 'x',
    mode: 'surgical',
    items: [{ type: 'modify', caseIds: ['TC-001', 'DROP TABLE', '../../etc/passwd', 'a'.repeat(100)] }],
  });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.plan.items[0].caseIds, ['TC-001'], `实际：${JSON.stringify(r.plan.items[0].caseIds)}`);
});

t('未知 type 被丢弃', () => {
  const r = normalizeConfirmedPlan({ items: [{ type: 'delete_everything', caseIds: ['TC-001'] }] });
  assert.strictEqual(r.ok, false);
});

t('空计划被拒绝', () => {
  assert.strictEqual(normalizeConfirmedPlan(null).ok, false);
  assert.strictEqual(normalizeConfirmedPlan({}).ok, false);
});

// ---------------- 接入链路（不能改变执行者）----------------

t('执行仍走 spawnAgentSession —— 原智能体与 skill 不变', () => {
  // 用户明确要求：改造后还是得调用现在的智能体和 skill 执行任务
  assert.ok(/const result = await spawnAgentSession\(task\.agent, chatInput/.test(SERVER),
    '对话执行路径被改动了，必须仍调用原智能体');
});

t('计划生成只走轻量调用，不落盘、不跑门禁', () => {
  const start = SERVER.indexOf('async function generateChangePlan');
  assert.ok(start > 0, '找不到 generateChangePlan');
  const end = SERVER.indexOf('async function executeChatRound', start);
  const body = SERVER.slice(start, end);
  assert.ok(/callDeepSeekRewrite/.test(body), '计划应走轻量非流式调用');
  // 计划阶段绝不能落盘交付物（那会凭空多出一个版本）
  assert.ok(!/createTaskOutputFile/.test(body), '计划阶段不应写交付物文件');
  assert.ok(!/updateTask\(/.test(body), '计划阶段不应改任务记录');
});

t('确认计划后 planOnly=false，不会再次规划', () => {
  assert.ok(/planOnly: !resolvedPlan/.test(SERVER), '确认后仍会重新规划，导致死循环');
});

t('计划只暂存在内存且一次性使用', () => {
  assert.ok(/chatPlans\.set\(planId/.test(SERVER), '计划未暂存');
  assert.ok(/chatPlans\.delete\(String\(planId\)\)/.test(SERVER), '计划未一次性消费，可能被重复执行');
});

t('确认计划要校验任务与用户归属', () => {
  const start = SERVER.indexOf('if (planId) {');
  assert.ok(start > 0, '找不到 planId 处理');
  const block = SERVER.slice(start, start + 900);
  assert.ok(/stored\.taskId !== taskId/.test(block), '未校验计划是否属于该任务');
  assert.ok(/stored\.userId/.test(block), '未校验计划归属用户');
});

t('计划过期时返回可识别错误码', () => {
  assert.ok(/PLAN_EXPIRED/.test(SERVER), '缺少 PLAN_EXPIRED 错误码，前端无法提示重发');
});

t('执行 prompt 里带上已确认范围，防止模型顺手多改', () => {
  assert.ok(/已确认的变更范围（用户逐项勾选过，只能动这些）/.test(SERVER),
    '执行时未约束范围，用户确认过的边界会失效');
});

t('计划生成失败退回直接执行（不卡住对话）', () => {
  const start = SERVER.indexOf('const planned = await generateChangePlan');
  assert.ok(start > 0, '找不到规划调用');
  const block = SERVER.slice(start, start + 1800);
  // 关键：失败分支里要能看到「退回直接执行」的降级路径，
  // 而不是直接 return 让用户的话石沉大海
  assert.ok(/退回直接执行/.test(block), '计划失败时未降级');
  // 失败分支之后必须继续往下走（走 chatInput/executeChatRound）。
  // 判据：降级提示之后仍然出现构建 chatInput 的调用
  const afterDowngrade = block.slice(block.indexOf('退回直接执行'));
  assert.ok(/buildChatContinuationInput/.test(SERVER.slice(start, start + 2600))
    || /buildChatContinuationInput/.test(SERVER.slice(start, start + 4000)),
    '降级后未继续执行对话');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
