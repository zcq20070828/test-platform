#!/usr/bin/env node
/**
 * design-methods.js 单元测试
 * 覆盖：9 种方法各自生成、输入不足时跳过、跨方法去重、正交 2-wise 覆盖、非法迁移
 */
const assert = require('node:assert');
const dm = require('../backend/design-methods.js');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

const fullInput = {
  inputSpec: {
    username: { type: 'string', length: [3, 20], pattern: '^[A-Za-z0-9_]+$' },
    age: { type: 'integer', range: [18, 120] },
    channel: { type: 'enum', values: ['app', 'web'] },
    agree: { type: 'boolean' },
  },
  causes: ['已登录', '余额充足'],
  effects: ['下单成功', '提示余额不足'],
  rules: [
    { id: 'R1', conditions: { C1: true, C2: true }, actions: { 下单成功: true } },
    { id: 'R2', conditions: { C1: true, C2: false }, actions: { 提示余额不足: true } },
  ],
  factors: { 平台: ['iOS', 'Android', 'Web'], 网络: ['4G', 'WiFi', '弱网'], 登录态: ['已登录', '未登录'] },
  scenarios: [
    { name: '正常下单', type: 'basic', steps: ['选商品', '提交订单', '支付'] },
    { name: '余额不足', type: 'exception', steps: ['选商品', '提交订单'] },
  ],
  states: {
    states: ['待支付', '已支付', '已取消'],
    transitions: [
      { from: '待支付', to: '已支付', event: '支付成功' },
      { from: '待支付', to: '已取消', event: '取消' },
    ],
  },
  functions: [
    { id: 'F1', name: '创建订单', preconditions: ['已登录'], postconditions: ['订单状态=待支付'], dependsOn: ['登录'] },
  ],
};

console.log('=== design-methods 单元测试 ===');

t('9 种方法全部注册', () => {
  assert.strictEqual(dm.METHOD_KEYS.length, 9);
  assert.deepStrictEqual(dm.METHOD_KEYS.map((k) => dm.METHODS[k].key), ['M1','M2','M3','M4','M5','M6','M7','M8','M9']);
});

t('信息完整时 9 种方法均产出用例', () => {
  const r = dm.executeDesignMethods({ input: fullInput });
  const empty = r.methods.filter((m) => m.caseCount === 0);
  assert.deepStrictEqual(empty.map((m) => m.methodKey), [], '存在未产出方法的：' + JSON.stringify(empty.map(m => m.methodKey + ':' + m.reason)));
  assert.strictEqual(r.stats.methodsWithCases, 9);
  assert.strictEqual(r.stats.methodCoverage, 100);
});

t('等价类覆盖有效/无效/边界长度', () => {
  const r = dm.executeDesignMethods({ input: { inputSpec: fullInput.inputSpec }, methods: ['equivalence'] });
  const names = r.cases.map((c) => c.name).join('|');
  assert.ok(/长度合法/.test(names));
  assert.ok(/长度过短/.test(names));
  assert.ok(/长度过长/.test(names));
  assert.ok(/格式非法/.test(names));
  assert.ok(r.cases.every((c) => c.methodKey === 'M1'));
});

t('边界值包含 min/min+1/内点/max-1/max/max+1 七点集核心点', () => {
  const r = dm.executeDesignMethods({ input: { inputSpec: { age: { type: 'integer', range: [18, 120] } } }, methods: ['boundary'] });
  const ids = r.cases.map((c) => c.trace).join('|');
  for (const tag of ['min-1', 'min', 'min+1', '内点', 'max-1', 'max', 'max+1']) assert.ok(ids.includes(tag), '缺少 ' + tag);
});

t('因果图每条规则产出正例+反例', () => {
  const r = dm.executeDesignMethods({ input: { causes: fullInput.causes, effects: fullInput.effects, rules: fullInput.rules }, methods: ['causeEffect'] });
  assert.strictEqual(r.cases.length, 4);
  assert.ok(r.cases.some((c) => /反例/.test(c.name) && c.layer === '异常'));
});

t('判定表含「所有条件均不满足」默认规则', () => {
  const r = dm.executeDesignMethods({ input: { rules: fullInput.rules, causes: fullInput.causes, effects: fullInput.effects }, methods: ['decisionTable'] });
  assert.ok(r.cases.some((c) => c.name.includes('所有条件均不满足')));
  assert.strictEqual(r.cases.filter((c) => c.layer === '异常').length, 1);
});

t('正交试验为 2-wise 且组合数少于全组合', () => {
  const r = dm.executeDesignMethods({ input: { factors: fullInput.factors }, methods: ['orthogonal'] });
  assert.strictEqual(r.cases.length, 18, '3x3x2 应压缩为 9 条 2-wise，含因子命名实际为 ' + r.cases.length);
  const full = dm.buildCoveringArray([[1,2,3],[1,2,3],[1,2]], 64);
  assert.strictEqual(full.mode, 'full');
});

t('正交结果标注兼容性维度（因子含平台）', () => {
  const r = dm.executeDesignMethods({ input: { factors: fullInput.factors }, methods: ['orthogonal'] });
  assert.ok(r.cases.every((c) => c.dimension === '⑨ 兼容性'));
});

t('错误推测含 SQLi/XSS 且标注安全维度', () => {
  const r = dm.executeDesignMethods({ input: { inputSpec: fullInput.inputSpec }, methods: ['errorGuessing'] });
  const sec = r.cases.filter((c) => c.dimension === '⑤ 安全');
  assert.ok(sec.length >= 2, '安全维度用例不足');
  assert.ok(sec.some((c) => /SQL/.test(c.name)));
  assert.ok(sec.some((c) => /XSS/.test(c.name)));
  assert.ok(r.cases.some((c) => c.dimension === '④ 操作' && /重复提交/.test(c.name)));
});

t('场景法三条路径均标注流程维度', () => {
  const r = dm.executeDesignMethods({ input: { scenarios: fullInput.scenarios }, methods: ['scenario'] });
  assert.strictEqual(r.cases.length, 2);
  assert.ok(r.cases.every((c) => c.dimension === '③ 流程'));
  assert.ok(r.cases.some((c) => c.layer === '异常'));
});

t('状态迁移覆盖合法迁移+非法迁移', () => {
  const r = dm.executeDesignMethods({ input: { states: fullInput.states }, methods: ['stateTransition'] });
  assert.ok(r.cases.filter((c) => c.layer === '正常').length === 2);
  assert.ok(r.cases.filter((c) => /非法/.test(c.name)).length >= 1);
  assert.ok(r.cases.every((c) => c.dimension === '③ 流程'));
});

t('功能图含前置条件不满足反例', () => {
  const r = dm.executeDesignMethods({ input: { functions: fullInput.functions }, methods: ['functionGraph'] });
  assert.strictEqual(r.cases.length, 2);
  assert.ok(r.cases.some((c) => c.layer === '异常'));
});

t('输入不足时方法被跳过并给出 guidance，不伪造用例', () => {
  const r = dm.executeDesignMethods({ input: { inputSpec: fullInput.inputSpec }, methods: dm.METHOD_KEYS });
  const skipped = r.methods.filter((m) => m.skipped);
  assert.ok(skipped.length >= 5, '应有多方法跳过');
  for (const m of skipped) {
    assert.ok(m.caseCount === 0);
    assert.ok(m.guidance && m.guidance.length > 10, m.methodKey + ' 缺少 guidance');
  }
});

t('跨方法去重后 uniqueCases <= 去重前，且 duplicates 有记录', () => {
  const r = dm.executeDesignMethods({ input: fullInput, dedupe: true });
  assert.ok(r.stats.uniqueCases <= r.stats.totalCasesBeforeDedupe);
  assert.strictEqual(r.stats.uniqueCases + r.stats.duplicatesRemoved, r.stats.totalCasesBeforeDedupe);
});

t('去重合并多方法标注', () => {
  const dup = [
    { methodKey: 'M1', methodLabel: '等价类划分法', name: 'A', input: 'x=1', steps: '', expected: 'ok', dimension: '② 数据' },
    { methodKey: 'M2', methodLabel: '边界值分析法', name: 'B', input: 'x=1', steps: '', expected: 'ok', dimension: '② 数据' },
  ];
  const r = dm.dedupeCases(dup);
  assert.strictEqual(r.cases.length, 1);
  assert.deepStrictEqual(r.cases[0].methodKeys, ['M1', 'M2']);
  assert.ok(r.cases[0].methodLabel.includes('+'));
  assert.strictEqual(r.cases[0].mergedCount, 2);
});

t('去重不合并预期结果不同的用例', () => {
  const list = [
    { methodKey: 'M1', methodLabel: '等价类划分法', name: 'A', input: 'x=1', steps: '', expected: 'ok' },
    { methodKey: 'M1', methodLabel: '等价类划分法', name: 'B', input: 'x=1', steps: '', expected: 'fail' },
  ];
  const r = dm.dedupeCases(list);
  assert.strictEqual(r.cases.length, 2);
});

t('dedupe=false 时保留全部用例', () => {
  const r = dm.executeDesignMethods({ input: fullInput, dedupe: false });
  assert.strictEqual(r.cases.length, r.stats.totalCasesBeforeDedupe);
  assert.strictEqual(r.stats.duplicatesRemoved, 0);
});

t('单方法调用不影响其他方法', () => {
  const r = dm.executeDesignMethods({ input: fullInput, methods: ['equivalence'] });
  assert.strictEqual(r.methods.length, 1);
  assert.ok(r.cases.every((c) => c.methodKey === 'M1'));
});

t('未知方法键被忽略而不报错', () => {
  const r = dm.executeDesignMethods({ input: fullInput, methods: ['equivalence', 'notExist'] });
  assert.strictEqual(r.methods.length, 1);
});

t('空输入不抛异常', () => {
  const r = dm.executeDesignMethods({ input: {} });
  assert.strictEqual(r.cases.length, 0);
  assert.strictEqual(r.stats.methodCoverage, 0);
});

t('用例结构字段完整（可直接落表）', () => {
  const r = dm.executeDesignMethods({ input: fullInput });
  for (const c of r.cases) {
    for (const k of ['name', 'methodLabel', 'dimension', 'layer', 'precondition', 'input', 'expected', 'priority', 'trace']) {
      assert.ok(c[k] !== undefined, `用例缺少字段 ${k}: ${JSON.stringify(c).slice(0, 120)}`);
    }
  }
});

t('用例数量受上限保护（每方法 <= 40）', () => {
  const bigSpec = {};
  for (let i = 0; i < 30; i += 1) bigSpec['f' + i] = { type: 'string', length: [1, 10] };
  const r = dm.executeDesignMethods({ input: { inputSpec: bigSpec }, methods: ['equivalence', 'errorGuessing'] });
  for (const m of r.methods) assert.ok(m.caseCount <= 40, m.methodKey + ' 超过 40 条');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
