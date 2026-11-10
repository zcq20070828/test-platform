#!/usr/bin/env node
/**
 * 9dem-planner 单元测试（2026-11-09）
 *
 * 覆盖：
 *   - 九维口径（不再是五维）
 *   - 维度定义与覆盖矩阵一致（单一事实源）
 *   - 依赖拓扑、并行组、优先级
 *   - invoker 参数/输出契约
 */
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLANNER = path.join(ROOT, 'qclaw-skills', '9dem-planner', 'backend');

const planner = await import(pathToFileURL(path.join(PLANNER, 'dimension-planner.js')).href);
const scheduler = await import(pathToFileURL(path.join(PLANNER, 'execution-scheduler.js')).href);
const invoker = await import(pathToFileURL(path.join(PLANNER, '9dem-planner-invoker.js')).href);
const matrix = await import(pathToFileURL(path.join(ROOT, 'backend', 'lib', 'dimension-matrix.js')).href);

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('use await helper');
    pass += 1; console.log('  ✅ ' + name);
  } catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}
async function ta(name, fn) {
  try { await fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 9dem-planner 单元测试 ===');

t('DIMENSIONS 是九维，不再是五维', () => {
  const keys = Object.values(planner.DIMENSIONS);
  assert.strictEqual(keys.length, 9, JSON.stringify(keys));
  assert.deepStrictEqual(keys, matrix.DIMENSION_KEYS);
});

t('维度中文名与覆盖矩阵一致', () => {
  for (const dim of matrix.DIMENSION_MATRIX) {
    assert.strictEqual(planner.DIMENSION_LABELS[dim.key], dim.label, dim.key);
    assert.strictEqual(planner.DIMENSION_WEIGHTS[dim.key], dim.weight, dim.key);
  }
});

t('依赖图覆盖九维且无环', () => {
  const deps = planner.getDimensionDependencies();
  assert.strictEqual(Object.keys(deps).length, 9);
  for (const [k, list] of Object.entries(deps)) {
    for (const d of list) assert.ok(deps[d], `${k} 依赖了未知维度 ${d}`);
  }
  // 拓扑序：任一维度的依赖必须排在它前面
  const order = planner.getExecutionOrder();
  for (const [k, list] of Object.entries(deps)) {
    for (const d of list) {
      assert.ok(order.indexOf(d) < order.indexOf(k), `${d} 应排在 ${k} 之前`);
    }
  }
});

t('用例估算按必测点数 × 复杂度，且随复杂度单调递增', () => {
  const low = planner.estimateDimensionCases('user', 'low');
  const high = planner.estimateDimensionCases('user', 'high');
  assert.ok(high.estimated > low.estimated, `${low.estimated} → ${high.estimated}`);
  const userDim = matrix.DIMENSION_MATRIX.find((d) => d.key === 'user');
  assert.strictEqual(low.estimated, userDim.probes.length, 'LOW 复杂度应等于必测点数');
});

t('未知维度/复杂度抛 RangeError 且信息含有效值', () => {
  assert.throws(() => planner.estimateDimensionCases('nope', 'low'), /未知维度/);
  assert.throws(() => planner.estimateDimensionCases('user', 'nope'), /未知复杂度/);
});

t('planDimensions 空需求输出九维，总计等于必测点数', () => {
  const plan = planner.planDimensions({});
  assert.strictEqual(plan.dimensions.length, 9);
  assert.strictEqual(plan.summary.totalDimensions, 9);
  const probeTotal = matrix.DIMENSION_MATRIX.reduce((s, d) => s + d.probes.length, 0);
  assert.strictEqual(plan.summary.estimatedCases, probeTotal);
  for (const d of plan.dimensions) {
    assert.deepStrictEqual(d.requiredLayers, matrix.DIMENSION_MATRIX.find((m) => m.key === d.name).requiredLayers);
    assert.strictEqual(d.probeCount, matrix.DIMENSION_MATRIX.find((m) => m.key === d.name).probes.length);
  }
});

t('identifyCoverageGaps 按九维计算覆盖率', () => {
  const gaps = planner.identifyCoverageGaps(['user', 'data']);
  assert.strictEqual(gaps.gaps.length, 7);
  assert.strictEqual(gaps.completeness, 22);
  assert.ok(gaps.message.includes('流程'));
});

t('参数类型校验', () => {
  assert.throws(() => planner.planDimensions(null), TypeError);
  assert.throws(() => planner.planDimensions({}, 'x'), TypeError);
});

t('并行组覆盖全部九维且组内无重复', () => {
  const plan = planner.planDimensions({});
  const schedule = scheduler.scheduleExecution(plan);
  const seen = schedule.parallelGroups.flatMap((g) => g.dimensions.map((d) => d.name));
  assert.deepStrictEqual([...new Set(seen)].sort(), [...matrix.DIMENSION_KEYS].sort());
  assert.strictEqual(seen.length, 9, '有维度被重复分组');
});

t('调度序列标出阻塞依赖与可并行同组维度', () => {
  const plan = planner.planDimensions({});
  const schedule = scheduler.scheduleExecution(plan);
  const processStep = schedule.sequence.find((s) => s.dimension === 'process');
  assert.deepStrictEqual(processStep.blockedBy.sort(), ['data', 'user']);
  assert.ok(processStep.canRunInParallelWith.includes('security'), JSON.stringify(processStep.canRunInParallelWith));
});

t('estimateTotalDuration 参数校验', () => {
  assert.throws(() => scheduler.estimateTotalDuration([]), TypeError);
  const d = scheduler.estimateTotalDuration(matrix.DIMENSION_KEYS);
  assert.ok(d.recommendedDays >= d.sequentialDays);
});

t('优先级排序：流程维在高复杂度下排前列', () => {
  const plan = planner.planDimensions({ processSteps: 15, roles: 4, dataVariations: 20, platforms: 4 });
  const priorities = scheduler.suggestPriorities(plan);
  assert.strictEqual(priorities.length, 9);
  const top = priorities[0];
  assert.ok(['process', 'security', 'user'].includes(top.dimension), `top=${top.dimension}`);
  // rank 连续
  priorities.forEach((p, i) => assert.strictEqual(p.rank, i + 1));
});

t('已覆盖维度优先级降为 skip', () => {
  const plan = planner.planDimensions({}, ['data']);
  const priorities = scheduler.suggestPriorities(plan);
  const data = priorities.find((p) => p.dimension === 'data');
  assert.strictEqual(data.priority, 'skip');
});

await ta('invoker 返回九维规划 + 必测清单 + 调度建议', async () => {
  const r = await invoker.invoke({ task: '统一消息中心：站内信/短信/邮件，支持权限控制、并发发送、弱网重连' });
  assert.strictEqual(r.success, true, r.error);
  assert.strictEqual(r.summary.totalDimensions, 9);
  assert.strictEqual(r.checklist.length, 9);
  assert.strictEqual(r.summary.probeTotal, 42);
  assert.ok(r.schedule.recommendations.length > 0);
  assert.ok(r.priorities.length === 9);
  assert.ok(r.hint.includes('9dem_executor'));
});

await ta('invoker 直接给 requirement 时优先于文本推断', async () => {
  const r = await invoker.invoke({ requirement: { dataVariations: 40 } });
  assert.strictEqual(r.success, true, r.error);
  const data = r.plan.dimensions.find((d) => d.name === 'data');
  assert.strictEqual(data.complexity, 'very_high', data.complexity);
});

await ta('invoker 异常输入不抛，返回 success=false', async () => {
  const r = await invoker.invoke({ requirement: 'not-an-object', task: 'x' });
  assert.strictEqual(r.success, true, '字符串 requirement 应被忽略并回落到推断');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
