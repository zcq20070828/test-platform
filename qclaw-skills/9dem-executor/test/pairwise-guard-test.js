#!/usr/bin/env node
/**
 * pairwise 保护策略回归测试（2026-11-04 OOM 修复）
 *
 * 背景：generatePairwiseCombinations 原实现是全笛卡尔积，
 * 12 个 string 字段（每字段 4 水平）产生 1677 万组合，直接把后端堆内存打满崩溃。
 * 现在：全组合数 <= 65536 时全枚举，超过则走贪心 2-wise；字段数上限 12。
 */
const assert = require('node:assert');
const { generatePairwiseCombinations } = require('../executor.js');
const invoker = require('../backend/9dem-invoker.js');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

function spec(n, type = 'string') {
  const o = {};
  for (let i = 0; i < n; i += 1) {
    o['f' + i] = type === 'enum'
      ? { type: 'enum', values: ['A', 'B', 'C'] }
      : { type: 'string', minLength: 1, maxLength: 20 };
  }
  return o;
}

console.log('=== pairwise 保护策略回归测试 ===');

t('小规模仍在安全范围内全枚举（4 字段 = 256）', () => {
  const r = generatePairwiseCombinations(spec(4));
  assert.strictEqual(r.length, 256);
  assert.strictEqual(r.mode, 'full');
  assert.strictEqual(r.excludedFields.length, 0);
});

t('恰好等于阈值 65536 时全枚举（8 字段 string）', () => {
  const r = generatePairwiseCombinations(spec(8));
  assert.strictEqual(r.originalTotal, 65536);
  assert.strictEqual(r.mode, 'full');
  assert.strictEqual(r.length, 65536);
});

t('超过阈值切换 2-wise（10 字段 string = 1048576）', () => {
  const r = generatePairwiseCombinations(spec(10));
  assert.strictEqual(r.mode, 'pairwise');
  assert.ok(r.length <= 64, '2-wise 产出应 <= 64，实际 ' + r.length);
  assert.ok(r.originalTotal >= 1048576 - 1);
});

t('12 字段（曾导致 OOM）不再全枚举', () => {
  const r = generatePairwiseCombinations(spec(12));
  assert.strictEqual(r.mode, 'pairwise');
  assert.ok(r.length <= 64);
});

t('字段数上限 12：超出部分记录到 excludedFields', () => {
  const r = generatePairwiseCombinations(spec(20));
  assert.strictEqual(r.factorCount, 12);
  assert.strictEqual(r.excludedFields.length, 8);
  assert.deepStrictEqual(r.excludedFields.slice(0, 2), ['f12', 'f13']);
});

t('20 字段不抛错且产出受限', () => {
  const r = generatePairwiseCombinations(spec(20));
  assert.ok(r.length > 0 && r.length <= 64);
});

t('enum 多水平同样受限（30 字段 × 3 = 531441）', () => {
  const r = generatePairwiseCombinations(spec(30, 'enum'));
  assert.strictEqual(r.mode, 'pairwise');
  assert.ok(r.length <= 64);
});

t('空输入返回空数组而非异常', () => {
  const r = generatePairwiseCombinations({});
  assert.deepStrictEqual(Array.from(r), []);
  assert.strictEqual(r.factorCount, 0);
});

t('数组自定义属性不进入 JSON（不污染工具结果）', () => {
  const r = generatePairwiseCombinations(spec(4));
  const wire = JSON.stringify({ pairwise: r });
  assert.ok(!wire.includes('excludedFields'), 'JSON 不应包含自定义属性');
});

t('2-wise 保留全部因子（每行包含 12 个键）', () => {
  const r = generatePairwiseCombinations(spec(20));
  for (const combo of r) {
    assert.strictEqual(Object.keys(combo).length, 12);
  }
});

(async () => {
  // 工具结果体积必须可被 LLM 接受
  console.log('\n【通过 invoker 验证工具结果体积】');
  for (const n of [8, 10, 12, 20]) {
    const fields = Array.from({ length: n }, (_, i) => ({ name: 'field' + i, type: 'string', minLength: 1, maxLength: 20 }));
    const out = await invoker.invoke({ fields, dimensions: ['data'] });
    const wire = JSON.stringify(out);
    const kb = wire.length / 1024;
    const capped = out.summary.pairwise.outputTruncated;
    const shown = out.dimensionsResult.data.pairwise.length;
    console.log(`  fields=${n} 工具结果=${kb.toFixed(0)}KB 输出组合=${shown} 原组合=${out.summary.dataPairwiseCount.toLocaleString()} 截断=${capped}`);
    assert.ok(kb < 500, `${n} 字段工具结果超 500KB（${kb.toFixed(0)}KB），会撑爆 LLM 上下文`);
    assert.ok(shown <= 200, `${n} 字段输出组合超过 200 条`);
    assert.ok(out.summary.pairwise && typeof out.summary.pairwise.compressed === 'boolean');
  }
  pass += 4;
  console.log('  ✅ 4 种字段规模下工具结果均 < 500KB 且组合数已裁剪');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
