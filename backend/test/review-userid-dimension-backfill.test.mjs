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

// 这条是任务 3df0c26a / 829d97fb 的教训：只按「维度有没有用例」判断不够，
// 门禁还要求每个维度的「正常/边界/异常」三层齐全。
// 实测补齐后必测点覆盖已到 81~83%，却仍提示「九维覆盖未达标：缺层级 ① 用户、④ 操作」。
t('按「缺失层级」补齐，不只按维度补齐', () => {
  const fnStart = SERVER.indexOf('function buildDimensionCasesMarkdown(');
  assert.ok(fnStart > 0);
  const rest = SERVER.slice(fnStart);
  const body = rest.slice(0, rest.indexOf('\nfunction appendToPrimaryDeliverable'));

  // 必须统计已有用例的层级
  assert.ok(/existingLayers/.test(body), '没有统计已有用例的层级');
  // 必须读门禁给的 missingLayers
  assert.ok(/missingLayers/.test(body), '没有使用门禁的 missingLayers');
  assert.ok(/needThisLayer/.test(body), '没有「该维度缺这个层级才补」的判断');
  // 维度完全缺失时全部补
  assert.ok(/existingDims\.has\(mark\)/.test(body), '没有区分「维度完全没用例」');
  // 必测点去重
  assert.ok(/seenProbe/.test(body), '没有按 probeId 去重（会重复堆同一条）');
});

t('缺层级判定用 normalizeLayer 的三层口径', () => {
  const fnStart = SERVER.indexOf('function buildDimensionCasesMarkdown(');
  const rest = SERVER.slice(fnStart);
  const body = rest.slice(0, rest.indexOf('\nfunction appendToPrimaryDeliverable'));
  assert.ok(/'正常', '边界', '异常'/.test(body), '层级口径不是 正常/边界/异常');
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
  //
  // 起始位置必须是「函数签名结束后的第一个 {」，不能直接取 fnStart 之后的第一个 {——
  // 签名里可能有默认参数对象（如 options = {}），那对花括号会把深度算错、
  // 函数体被截成 170 个字符（实测过）。这里从参数列表的右括号之后开始找。
  const parenStart = SERVER.indexOf('(', fnStart);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let k = parenStart; k < SERVER.length; k += 1) {
    if (SERVER[k] === '(') parenDepth += 1;
    else if (SERVER[k] === ')') { parenDepth -= 1; if (parenDepth === 0) { parenEnd = k; break; } }
  }
  assert.ok(parenEnd > 0, '解析参数列表失败');
  let depth = 0;
  let i = SERVER.indexOf('{', parenEnd);
  let end = -1;
  for (; i < SERVER.length; i += 1) {
    if (SERVER[i] === '{') depth += 1;
    else if (SERVER[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > 0, '解析函数体失败');
  assert.ok(end - fnStart > 5000, `函数体只有 ${end - fnStart} 字符，解析明显有误`);
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

// ---------------- 九维规划器不能被「静默跳过」 ----------------
// 用户反馈「测试用例生成也没见调 planer 那个工具了」。
// 实测连续 3 个任务的 timeline 里只有 9dem-executor，planner 一次没调。
// 原因：提示词写的是「若确需先做维度规划…调用 9dem_planner」——纯可选措辞；
// 而 REQUIRED_SKILLS_BY_AGENT 里只列了 9dem-executor，证据门禁也不管它。
t('用例生成必须调用 9dem_planner（提示词不再用「若确需」）', () => {
  assert.ok(!/若确需先做维度规划/.test(SERVER), '系统提示里仍是「若确需」这种可选措辞');
  assert.ok(/必须先调用.*9dem_planner/.test(SERVER), '系统提示没有强制调用 planner');
});

t('模型漏调 planner 时系统确定性补算（不依赖模型自觉）', () => {
  assert.ok(/PlannerBackfill/.test(SERVER), '缺少 planner 补算逻辑');
  const fn = SERVER.slice(SERVER.indexOf("if (agentId === 'test-case-generator')", SERVER.indexOf('PlannerBackfill') - 2000));
  // 「调过」必须要求成功：实测任务 21bf3dc9 模型调用了但返回
  // 「dimensions 必须是非空数组」，那种情况仍要补算
  assert.ok(/skillExecutions\.some\(/.test(fn) && /9dem-planner/.test(fn), '没有检查是否已调用过 planner');
  assert.ok(/e\.result\.success !== false/.test(fn), '未要求调用成功（失败也会被当成已规划）');
  assert.ok(/autoInvoked: true/.test(fn), '补算结果未标记来源（审计时分不清是模型调的还是系统补的）');
  assert.ok(/维度规划（系统确定性补算 9dem_planner）/.test(SERVER), '补算结论没有写进交付物');
});

t('补算在证据门禁之前、用例门禁之前', () => {
  const fill = SERVER.indexOf('PlannerBackfill');
  const gate = SERVER.indexOf('// ── 执行证据门禁');
  const caseGate = SERVER.indexOf('用例交付物确定性质量门禁');
  assert.ok(fill > 0 && gate > 0 && caseGate > 0, '定位失败');
  assert.ok(fill < gate, '补算应在证据门禁之前');
  assert.ok(fill < caseGate, '补算应在本测用例门禁之前');
});

// ---------------- 用例数暴跌的真正原因：工具结果超窗口被截断 ----------------
// 用户反馈「感觉现在生成出来的用例在覆盖率上比之前低了」「是不是把组合数阈值设成 50 了」。
// 实测：用例数从 257 掉到 40~50。根因不是 pairwise 阈值，而是
// 9dem_executor 的工具结果有 468KB~7.8MB（带几万条 pairwise 明细），
// enforceContextBudget 把它截到 TOOL_RESULT_CAP=4000 字符，
// 里面的 design.cases(113~216 条) 几乎全被砍掉，模型只能凭印象编 40 来条。
t('工具结果先瘦身再截断，保住 design.cases', () => {
  assert.ok(/function slimToolResultPayload/.test(SERVER), '缺少工具结果瘦身函数');
  const fn = SERVER.slice(SERVER.indexOf('function slimToolResultPayload'));
  const body = fn.slice(0, 3000);
  assert.ok(/delete obj\.pairwiseFull|'pairwiseFull' in obj/.test(body), '未剔除 pairwiseFull');
  assert.ok(/dropPairwise/.test(body), '未剔除 data.pairwise 明细');
  // 瘦身必须在硬截断之前
  const slimIdx = SERVER.indexOf('const slim = slimToolResultPayload(out[i])');
  const hardIdx = SERVER.indexOf('if (c > TOOL_RESULT_CAP)');
  assert.ok(slimIdx > 0 && hardIdx > 0 && slimIdx < hardIdx, '瘦身必须在硬截断之前');
});

t('design.cases 由系统确定性落地（模型抄不完）', () => {
  assert.ok(/function buildDesignCasesMarkdown/.test(SERVER), '缺少基线用例落地函数');
  assert.ok(/toolDesignCases = out\.design\.cases/.test(SERVER), '没有收集工具的 design.cases');
  assert.ok(/DesignBackfill/.test(SERVER), '没有落地日志');
  // 落地必须在门禁循环之前。门禁循环已改为 while (true)（达标后还要跑打磨轮），
  // 这里用「casQuality 门禁分支」的起点定位，不绑死具体循环写法。
  const dcIdx = SERVER.indexOf('buildDesignCasesMarkdown(text, toolDesignCases');
  const gateIdx = SERVER.indexOf('if (CASE_QUALITY_GATE_AGENTS.has(agentId))');
  assert.ok(dcIdx > 0 && gateIdx > 0 && dcIdx > gateIdx, '基线落地必须在门禁循环内、门禁检查之前');
});

t('基线用例落地时做确定性补强（否则可用率暴跌）', () => {
  assert.ok(/function strengthenAssertion/.test(SERVER), '缺少断言补强函数');
  const fn = SERVER.slice(SERVER.indexOf('function buildDesignCasesMarkdown'));
  const body = fn.slice(0, 4000);
  assert.ok(/repairPlaceholderInput\(input, rowCtx\)/.test(body), '落地时未修复占位输入');
  assert.ok(/strengthenAssertion\(expected/.test(body), '落地时未补强预期结果');
  assert.ok(/if \(!steps\)/.test(body), '落地时未补执行步骤');
  // 编号前缀要与模型用例区分
  assert.ok(/DC-\$\{String\(seq\)/.test(body), '基线用例编号未用 DC- 前缀');
});

t('所有服务的 contextChars 不超过其上下文窗口', () => {
  // 上一版我凭印象填了 400000/200000 等值，19 个服务商全部超出实际窗口
  // （智谱 GLM-4 只有 128K tokens ≈ 96K 字符，却填了 40 万字符）。这里守住。
  const block = SERVER.slice(SERVER.indexOf('const PROVIDERS = {'), SERVER.indexOf('/** 取服务商配置'));
  const entries = [...block.matchAll(/^ {2}([a-z][a-z0-9]*): \{([\s\S]*?)^ {2}\},/gm)];
  assert.ok(entries.length >= 18, `只解析到 ${entries.length} 个服务商`);
  for (const [, id, body] of entries) {
    const m = body.match(/contextChars: (\d+)/);
    if (!m) continue;
    const chars = Number(m[1]);
    // 中文约 1.5 字符/token：字符数不应超过「窗口 tokens × 1.5」
    // 这里只做上限守卫：最大允许 1.5M 字符（对应 1M 窗口的 Gemini）
    assert.ok(chars <= 900000, `${id} 的 contextChars=${chars} 过大，可能超出模型窗口`);
  }
  // 智谱必须是 96000（128K tokens × 1.5 × 0.5）
  const zhipu = block.match(/zhipu: \{([\s\S]*?)^ {2}\},/m);
  assert.ok(zhipu && /contextChars: 96000/.test(zhipu[1]), '智谱 GLM-4 的预算应为 96000（128K 窗口）');
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
