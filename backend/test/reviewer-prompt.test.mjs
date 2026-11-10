#!/usr/bin/env node
/**
 * reviewer-prompt 单元测试（2026-11-09）
 *
 * 这组测试守的是「三名审核员能力必须完整」这条约定：
 * 历史上三人职能互斥（只有 reviewer-2 审安全、只有 reviewer-3 审格式），
 * 在「三审取中位数」的机制下，只有一人能发现的问题会被另外两人的高分拉回通过区间。
 * 一旦有人把「不审其它维度」写回提示词，这里就会失败。
 */
import assert from 'node:assert';
import { buildReviewerSystemPrompt } from '../lib/reviewer-prompt.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== reviewer-prompt 单元测试 ===');

const IDS = ['ai-quality-reviewer-1', 'ai-quality-reviewer-2', 'ai-quality-reviewer-3'];
const prompts = Object.fromEntries(IDS.map((id) => [id, buildReviewerSystemPrompt(id)]));

t('三个审核员都具备五维审核能力', () => {
  for (const id of IDS) {
    const p = prompts[id];
    for (const dim of ['需求一致性', '事实与逻辑', '安全合规', '格式与可执行性', '跨环节承接']) {
      assert.ok(p.includes(dim), `${id} 缺少维度「${dim}」`);
    }
  }
});

t('不存在「不审其它维度」的互斥表述', () => {
  for (const id of IDS) {
    const p = prompts[id];
    assert.ok(!/不审格式|不审安全|不审需求一致性|只审(核)?[「"]/.test(p), `${id} 仍含互斥表述：${p.match(/不审[^。]*/)}`);
    assert.ok(!/不属我职责/.test(p), `${id} 仍含职责推脱表述`);
  }
});

t('输出契约包含五维分数', () => {
  for (const id of IDS) {
    const p = prompts[id];
    assert.ok(p.includes('"dimensions"'), `${id} 缺少 dimensions 字段`);
    for (const k of ['requirement', 'factLogic', 'security', 'format', 'traceability']) {
      assert.ok(p.includes(`"${k}"`), `${id} dimensions 缺少 ${k}`);
    }
  }
});

t('保留实测校准过的护栏（不过度扣分/不默认幻觉/不重复扣可用率）', () => {
  for (const id of IDS) {
    const p = prompts[id];
    assert.ok(/不要因格式不完美而大幅扣分|不要因格式不完美而过度扣分/.test(p), `${id} 缺少格式扣分护栏`);
    assert.ok(/无法核实.*默认幻觉|不要因无法核实/.test(p), `${id} 缺少幻觉护栏`);
    assert.ok(/确定性门禁/.test(p), `${id} 缺少可用率护栏`);
    assert.ok(/不要重复扣分/.test(p), `${id} 缺少重复扣分护栏`);
  }
});

t('跨环节检查三条都在', () => {
  for (const id of IDS) {
    const p = prompts[id];
    assert.ok(p.includes('上游缺失'), `${id} 缺少上游缺失归因要求`);
    assert.ok(p.includes('跨环节一致性检查'), `${id} 缺少跨环节小节`);
  }
});

t('用例集覆盖率判定字段完整', () => {
  for (const id of IDS) {
    const p = prompts[id];
    for (const k of ['coverage_applicable', 'coverage_L1', 'coverage_L2', 'coverage_L3', 'coverage_L4', 'coverage_L5', 'coverage_verdict', 'coverage_gaps']) {
      assert.ok(p.includes(k), `${id} 缺少 ${k}`);
    }
  }
});

t('三个审核员主视角不同（保证独立性）', () => {
  const lenses = IDS.map((id) => (prompts[id].match(/主视角\*\*是「([^」]+)」/) || [])[1]);
  assert.ok(lenses.every(Boolean), JSON.stringify(lenses));
  assert.strictEqual(new Set(lenses).size, 3, `主视角重复：${JSON.stringify(lenses)}`);
});

t('未知 id 回落到 1 号提示词而不是空串', () => {
  const p = buildReviewerSystemPrompt('who-knows');
  assert.ok(p.length > 500);
  assert.ok(p.includes('需求一致性'));
});

t('提示词要求只输出 JSON', () => {
  for (const id of IDS) {
    assert.ok(prompts[id].includes('只输出 JSON'), id);
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
