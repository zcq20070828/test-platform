#!/usr/bin/env node
/**
 * 审核员 userId 传递 + 九维必测确定性补齐（2026-11-20）
 *
 * 两个线上实测暴露的缺陷：
 *
 * 1) 任务 8c33a87f 三个审核员全部 0 分，错误都是 `userId is not defined`。
 *    原因：给审核员补传 userId 时只改了 callReviewersSequentially 内部，
 *    真正发起调用的是 callSingleReviewer —— 它没有 userId 形参，
 *    函数体里却直接用了 userId，于是每个审核员一跑就抛 ReferenceError。
 *    后果比看起来严重：审核结论变成 inconclusive（有效审核 0/3），
 *    等于质量把关整段失效，任务被无条件放行。
 *
 * 2) 同一任务的 96 条用例维度**全是「② 数据」**，九维必测点覆盖只有 19%，
 *    两轮定向修复后仍然是 19%。原因是修复走「外科式补丁」——
 *    只会改写已有行的预期结果/执行步骤，物理上无法新增缺失维度的用例。
 *    而 9dem_executor 早就把 42 个必测点展开成现成用例（dimensionCases），
 *    维度/层级/步骤/预期全是确定性的，根本不该指望模型自己落进去。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 审核 userId 传递 + 九维必测补齐 ===');

// ---------------- 审核员 userId ----------------
t('callSingleReviewer 有 userId 形参', () => {
  const m = SERVER.match(/async function callSingleReviewer\(([^)]*)\)/);
  assert.ok(m, '找不到 callSingleReviewer 定义');
  assert.ok(/userId/.test(m[1]), `形参里没有 userId：${m[1]}`);
});

t('callSingleReviewer 的两处调用都传了 userId', () => {
  const calls = [...SERVER.matchAll(/callSingleReviewer\(([^)]*)\)/g)]
    .filter((m) => !/async function/.test(SERVER.slice(Math.max(0, m.index - 20), m.index)));
  assert.ok(calls.length >= 2, `只找到 ${calls.length} 处调用`);
  for (const c of calls) {
    assert.ok(/userId/.test(c[1]), `调用未传 userId：callSingleReviewer(${c[1].slice(0, 80)})`);
  }
});

t('callSingleReviewer 函数体里用到的 userId 都在形参中', () => {
  const start = SERVER.indexOf('async function callSingleReviewer(');
  assert.ok(start > 0);
  // 形参列表：从 '(' 到配对的 ')'
  const parenStart = SERVER.indexOf('(', start);
  let depth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < SERVER.length; i += 1) {
    if (SERVER[i] === '(') depth += 1;
    else if (SERVER[i] === ')') {
      depth -= 1;
      if (depth === 0) { parenEnd = i; break; }
    }
  }
  assert.ok(parenEnd > parenStart, '解析形参失败');
  const params = SERVER.slice(parenStart + 1, parenEnd);

  // 函数体：形参之后的第一个 '{' 到下一个顶层 async function 之前
  const bodyStart = SERVER.indexOf('{', parenEnd);
  const rest = SERVER.slice(bodyStart + 1);
  const nextFn = rest.indexOf('\nasync function ');
  const body = nextFn > 0 ? rest.slice(0, nextFn) : rest;

  if (!/\buserId\b/.test(body)) return; // 不用就不需要形参
  assert.ok(/\buserId\b/.test(params), '函数体用了 userId 但形参没有 → ReferenceError');
});

// ---------------- 九维必测确定性补齐 ----------------
t('存在九维必测补齐函数', () => {
  assert.ok(/function buildDimensionCasesMarkdown\(/.test(SERVER), '缺少 buildDimensionCasesMarkdown');
});

t('补齐在门禁循环内、且不依赖模型（确定性）', () => {
  const gateStart = SERVER.indexOf('if (CASE_QUALITY_GATE_AGENTS.has(agentId))');
  assert.ok(gateStart > 0, '找不到门禁块');
  const block = SERVER.slice(gateStart, gateStart + 4000);
  assert.ok(/buildDimensionCasesMarkdown\(/.test(block), '门禁循环里没有补齐调用');
  // 必须在「自动修复占位输入」之前，这样本轮门禁就能看到补齐结果
  const backfillIdx = block.indexOf('buildDimensionCasesMarkdown(');
  const repairIdx = block.indexOf('applyCaseInputRepairs(text)');
  assert.ok(backfillIdx > 0 && repairIdx > 0, '缺少补齐或修复调用');
  assert.ok(backfillIdx < repairIdx, '补齐必须在门禁检查之前执行');
});

t('只补「完全缺失」的维度，不重复堆用例', () => {
  const fn = SERVER.slice(SERVER.indexOf('function buildDimensionCasesMarkdown('));
  const body = fn.slice(0, fn.indexOf('\nfunction ', 10) > 0 ? fn.indexOf('\nfunction ', 10) : 6000);
  assert.ok(/present\.has\(mark\)/.test(body), '没有「该维度已有用例就跳过」的判断');
  assert.ok(/present\.add\(/.test(body), '没有收集已有维度');
});

t('工具返回的 dimensionCases 被收集（否则无从补齐）', () => {
  assert.ok(/toolDimensionCases = out\.dimensionCases/.test(SERVER), '没有收集工具的 dimensionCases');
  assert.ok(/let toolDimensionCases = null/.test(SERVER), '缺少收集变量');
});

// 这条是任务 44dd1eab 的教训：变量原本声明在 `if (tools.length>0)` 分支里，
// 而门禁代码在分支之外 —— 走「模型没调工具」的路径就 ReferenceError。
// 光看「声明在循环之前」不够，必须验证它不在任何 if 分支内。
t('toolDimensionCases 声明在 try 顶层，不在任何 if 分支内（跨路径可见）', () => {
  const fnStart = SERVER.indexOf('async function spawnAgentSession(');
  assert.ok(fnStart > 0, '找不到 spawnAgentSession');
  // 截取函数体（大括号配对）
  let depth = 0;
  let i = SERVER.indexOf('{', fnStart);
  let end = -1;
  for (; i < SERVER.length; i += 1) {
    if (SERVER[i] === '{') depth += 1;
    else if (SERVER[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > 0, '解析函数体失败');
  const body = SERVER.slice(fnStart, end + 1);

  const declIdx = body.indexOf('let toolDimensionCases = null;');
  assert.ok(declIdx > 0, '函数体内找不到声明');

  // 声明处嵌套深度：函数体 1 + try 块 2。>2 说明还在 if 里
  let d = 0;
  for (let k = 0; k < declIdx; k += 1) {
    if (body[k] === '{') d += 1;
    else if (body[k] === '}') d -= 1;
  }
  assert.strictEqual(d, 2, `声明处嵌套深度 ${d}（应为 2 = 函数体+try）；不在 try 顶层就会在别的分支里`);

  // 使用处必须在更深的层级（说明能访问到）
  const useIdx = body.indexOf('if (toolDimensionCases && toolDimensionCases.length) {');
  assert.ok(useIdx > 0, '找不到门禁里的使用');
  let du = 0;
  for (let k = 0; k < useIdx; k += 1) {
    if (body[k] === '{') du += 1;
    else if (body[k] === '}') du -= 1;
  }
  assert.ok(du > d, `使用处深度 ${du} 不大于声明处 ${d}，说明两者不在同一作用域链上`);
});

t('补齐后的表头与主用例表一致（否则门禁解析不到新用例）', () => {
  const fn = SERVER.slice(SERVER.indexOf('function buildDimensionCasesMarkdown('));
  const body = fn.slice(0, 6000);
  for (const col of ['用例编号', '维 度', '维度', '层级', '预期结果']) {
    if (col === '维 度') continue;
    assert.ok(body.includes(col), `补齐表头缺少「${col}」`);
  }
});

// ---------------- pairwise 口径 ----------------
t('pairwise 输出上限不再把 65536 以内的组合砍掉', () => {
  const inv = fs.readFileSync(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', '9dem-invoker.js'), 'utf8');
  // 业务口径由 executor.js 的 65536 决定；invoker 的只是「进 prompt 的样例数」
  assert.ok(/PAIRWISE_PROMPT_SAMPLE/.test(inv), '缺少 prompt 样例数常量');
  const m = inv.match(/PAIRWISE_OUTPUT_LIMIT = Number\(process\.env\.NINEDEM_PAIRWISE_OUTPUT_LIMIT\) \|\| (\d+)/);
  assert.ok(m, '找不到输出上限');
  assert.ok(Number(m[1]) >= 65536, `输出上限 ${m[1]} 小于全枚举阈值 65536`);
  assert.ok(/pairwiseFull/.test(inv), '全量明细未单独保留');
});

t('全量 pairwise 明细不进 LLM 上下文（否则 8 字段 12MB）', () => {
  assert.ok(/'pairwiseFull' in out/.test(SERVER), '下发前没有剔除 pairwiseFull');
  const idx = SERVER.indexOf("'pairwiseFull' in out");
  const block = SERVER.slice(idx - 400, idx + 400);
  assert.ok(/toolResult = JSON\.stringify\(forModel\)/.test(block), '剔除后没有用剩余字段序列化');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
