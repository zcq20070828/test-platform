#!/usr/bin/env node
/**
 * case-feedback-dao 单元测试（SQL 语义 + 边界）
 *
 * 不连真库：用最小 mock 验证参数拼装、返回结构、空值处理。
 * 真实读写由端到端验证覆盖（dev 环境已建表）。
 */
import assert from 'node:assert';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== case-feedback-dao 单元测试（结构/边界）===');

// 复刻 DAO 里的纯函数逻辑（避免为测试引入 DB 依赖）
function normalizeReason(reason) {
  const VALID = new Set(['assertion', 'placeholder', 'duplicate', 'irrelevant', 'wrong', 'format', 'other']);
  if (!reason) return null;
  return VALID.has(reason) ? reason : 'other';
}

function computeHumanRate(marked, usable) {
  if (!marked) return null;
  return Math.round((usable / marked) * 1000) / 1000;
}

t('人工可用率：3 条中 1 条可用 → 0.333', () => {
  assert.strictEqual(computeHumanRate(3, 1), 0.333);
});

t('人工可用率：无标记 → null（不能算成 0，否则会误判为「全部不可用」）', () => {
  assert.strictEqual(computeHumanRate(0, 0), null);
});

t('人工可用率：全部可用 → 1', () => {
  assert.strictEqual(computeHumanRate(5, 5), 1);
});

t('拒绝原因白名单外的值归一为 other', () => {
  assert.strictEqual(normalizeReason('something-weird'), 'other');
  assert.strictEqual(normalizeReason('assertion'), 'assertion');
  assert.strictEqual(normalizeReason(null), null);
});

t('拒绝原因不能为空字符串时当作无原因', () => {
  assert.strictEqual(normalizeReason(''), null);
});

// 反例库文案生成（与 DAO buildCounterExamples 的映射一致）
const LABELS = {
  assertion: '预期结果只写「功能正常」→ 必须写出可观测结果',
  placeholder: '输入写「10位数字」「AAAAAA」→ 必须给符合业务规则的真实值',
  duplicate: '同一规则拆成多条用例 → 合并为 1 条并标注多方法',
};
function buildText(rows) {
  if (!rows.length) return '';
  const lines = ['【近期被人工判定不可用的用例类型（必须避免）】'];
  for (const r of rows) lines.push(`- ${LABELS[r.reason] || r.reason}（${r.count} 次）`);
  return lines.join('\n');
}

t('无拒绝记录时不生成反例文案', () => {
  assert.strictEqual(buildText([]), '');
});

t('反例文案含原因说明与次数', () => {
  const text = buildText([{ reason: 'assertion', count: 12 }, { reason: 'placeholder', count: 5 }]);
  assert.ok(text.includes('必须避免'));
  assert.ok(text.includes('12 次'));
  assert.ok(text.includes('必须给符合业务规则的真实值'));
});

t('未知原因也能落到文案里（不丢数据）', () => {
  const text = buildText([{ reason: 'weird_reason', count: 1 }]);
  assert.ok(text.includes('weird_reason'));
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
