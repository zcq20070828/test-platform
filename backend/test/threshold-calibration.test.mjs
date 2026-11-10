#!/usr/bin/env node
/**
 * threshold-calibration 单元测试（2026-11-09）
 *
 * 覆盖：
 *   - 样本不足 / 无数据 / 不可行 三种状态
 *   - 推荐阈值：选「满足人感目标的最宽松阈值」
 *   - 当前阈值对比（收紧/放宽/一致）
 *   - 不一致明细（漏放 / 误拦）
 */
import assert from 'node:assert';
import {
  calibrateThreshold,
  evaluateThreshold,
  listDisagreements,
  usableSamples,
  MIN_SAMPLES,
  MIN_MARKED_CASES,
} from '../lib/threshold-calibration.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== threshold-calibration 单元测试 ===');

/** 造 n 个样本：门禁率与人工率成对给出 */
function samples(pairs) {
  return pairs.map(([gateRate, humanRate], i) => ({
    taskId: `T${i + 1}`,
    gateRate,
    humanRate,
    marked: Math.ceil(MIN_MARKED_CASES / Math.max(pairs.length, 1)),
  }));
}

t('无样本时明确返回 no_data，不假装有结论', () => {
  const r = calibrateThreshold([], { currentThreshold: 0.85 });
  assert.strictEqual(r.status, 'no_data');
  assert.strictEqual(r.recommended, null);
  assert.ok(r.message.includes('无法校准'));
});

t('样本不足时返回 insufficient', () => {
  const r = calibrateThreshold(samples([[0.9, 0.9]]), { currentThreshold: 0.85, markedCases: 10 });
  assert.strictEqual(r.status, 'insufficient');
  assert.ok(r.message.includes('样本不足'));
});

t('缺人工率的样本被剔除', () => {
  const list = usableSamples([
    { taskId: 'A', gateRate: 0.9, humanRate: 0.9 },
    { taskId: 'B', gateRate: 0.9, humanRate: null },
    { taskId: 'C', gateRate: null, humanRate: 0.8 },
  ]);
  assert.strictEqual(list.length, 1);
});

t('门禁在中间区间放行了大量低质交付 → 推荐阈值高于当前（应收紧）', () => {
  // 高门禁率区间里好坏掺半，只有卡到 0.95 以上人感才达标 → 需要收紧
  const list = samples([
    [0.86, 0.55],
    [0.88, 0.60],
    [0.90, 0.65],
    [0.92, 0.70],
    [0.96, 0.95],
    [0.98, 0.97],
  ]);
  const r = calibrateThreshold(list, { currentThreshold: 0.85, markedCases: 600 });
  assert.strictEqual(r.status, 'ok', r.message);
  assert.ok(r.recommended > 0.85, `推荐值 ${r.recommended} 应高于当前 0.85`);
  assert.ok(r.message.includes('收紧'), r.message);
});

t('门禁过严（人工其实都能用）→ 推荐阈值低于当前（可放宽）', () => {
  const list = samples([
    [0.60, 0.95],
    [0.65, 0.96],
    [0.70, 0.94],
    [0.55, 0.93],
    [0.75, 0.97],
  ]);
  const r = calibrateThreshold(list, { currentThreshold: 0.85, markedCases: 500 });
  assert.strictEqual(r.status, 'ok', r.message);
  assert.ok(r.recommended < 0.85, `推荐值 ${r.recommended} 应低于当前 0.85`);
  assert.ok(r.message.includes('放宽'), r.message);
});

t('推荐阈值取「满足目标的最宽松值」', () => {
  // 人工率 >= 0.9 的样本门禁率最低为 0.7 → 推荐应正好是 0.7 附近
  const list = samples([
    [0.70, 0.91],
    [0.72, 0.93],
    [0.80, 0.95],
    [0.60, 0.70],
    [0.50, 0.60],
  ]);
  const r = calibrateThreshold(list, { targetHumanRate: 0.9, currentThreshold: 0.85, markedCases: 500 });
  assert.strictEqual(r.status, 'ok', r.message);
  // 0.60 那个样本人感 0.70，必须被排除；0.61 起只剩 {0.70,0.72,0.80} → 人感均值 0.93
  assert.ok(r.recommended > 0.60 && r.recommended <= 0.70, `推荐 ${r.recommended} 应落在 (0.60, 0.70]`);
  assert.ok(r.recommendedDetail.meanHumanRate >= 0.9, JSON.stringify(r.recommendedDetail));
});

t('无论怎么卡都达不到人感目标 → infeasible 且给出原因', () => {
  const list = samples([
    [0.95, 0.50],
    [0.97, 0.45],
    [0.99, 0.40],
    [0.92, 0.55],
    [0.90, 0.60],
  ]);
  const r = calibrateThreshold(list, { targetHumanRate: 0.9, currentThreshold: 0.85, markedCases: 500 });
  assert.strictEqual(r.status, 'infeasible');
  assert.ok(r.message.includes('判定口径'), r.message);
});

t('evaluateThreshold 统计算得对', () => {
  const list = samples([
    [0.90, 0.95],
    [0.88, 0.92],
    [0.60, 0.40],
    [0.40, 0.30],
  ]);
  const e = evaluateThreshold(list, 0.85);
  assert.strictEqual(e.passed, 2);
  assert.strictEqual(e.coverage, 0.5);
  assert.strictEqual(e.falsePass, 0);
  assert.strictEqual(e.falseFail, 0);
  assert.strictEqual(e.meanHumanRate, 0.935);
});

t('不一致明细区分漏放与误拦', () => {
  const list = samples([
    [0.90, 0.30], // 门禁放行但人工很差 → false_pass
    [0.50, 0.95], // 门禁拦下但人工可用 → false_fail
    [0.90, 0.95], // 一致
  ]);
  const d = listDisagreements(list, 0.85);
  assert.strictEqual(d.length, 2);
  const types = d.map((x) => x.type).sort();
  assert.deepStrictEqual(types, ['false_fail', 'false_pass']);
});

t('曲线覆盖 0.50~0.99 每分钟一个点', () => {
  const list = samples([[0.9, 0.9], [0.8, 0.8], [0.7, 0.7], [0.6, 0.6], [0.5, 0.5]]);
  const r = calibrateThreshold(list, { currentThreshold: 0.85, markedCases: 500 });
  assert.ok(r.curve.length >= 49, `curve 点数 ${r.curve.length}`);
  assert.strictEqual(r.curve[0].threshold, 0.5);
});

t('缺少当前阈值时 message 里明确写「未设置」', () => {
  const list = samples([[0.9, 0.95], [0.8, 0.92], [0.7, 0.91], [0.6, 0.9], [0.5, 0.88]]);
  const r = calibrateThreshold(list, { markedCases: 500 });
  assert.ok(r.message.includes('未设置'), r.message);
});

t('MIN 常量与文档一致', () => {
  assert.strictEqual(MIN_SAMPLES, 5);
  assert.strictEqual(MIN_MARKED_CASES, 100);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
