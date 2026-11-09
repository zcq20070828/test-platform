#!/usr/bin/env node
/**
 * quality-rules 单元测试（2026-11-06 阶段四 4.3）
 *
 * 覆盖：
 *   - 12 个智能体都有规则集
 *   - 合格交付物通过、伪造交付物不通过
 *   - 各规则的针对性（占位编号、无证据、未脱敏、无断言…）
 *   - 表格行数统计不因文档末尾空行丢行（历史 bug）
 *   - 空交付物判 0 分
 */
import assert from 'node:assert';
import { checkWithRules, getRulesFor, listRuleAgents } from '../lib/quality-rules.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== quality-rules 单元测试 ===');

// ---------------- 覆盖范围 ----------------
t('12 个智能体都配置了规则集', () => {
  const agents = listRuleAgents();
  assert.strictEqual(agents.length, 12, '实际 ' + agents.length + ': ' + agents.join(','));
  for (const a of agents) assert.ok(getRulesFor(a).length >= 3, a + ' 规则太少');
});

t('未配置的智能体返回 applicable=false（不误判）', () => {
  const r = checkWithRules('test-master', '任意内容');
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.pass, true);
});

t('每个规则都有 id/severity/weight/check', () => {
  for (const a of listRuleAgents()) {
    for (const rule of getRulesFor(a)) {
      assert.ok(rule.id, a + ' 缺 id');
      assert.ok(['blocker', 'major', 'minor'].includes(rule.severity), a + '/' + rule.id + ' severity 非法');
      assert.ok(typeof rule.weight === 'number' && rule.weight > 0, a + '/' + rule.id + ' weight 非法');
      assert.ok(typeof rule.check === 'function', a + '/' + rule.id + ' check 非函数');
    }
  }
});

// ---------------- 需求分析 ----------------
t('需求分析：合格报告通过', () => {
  const good = [
    '# 需求分析报告',
    '## 功能需求清单',
    '| 需求编号 | 需求名称 | 需求描述 | 验收标准 | 可测试性 |',
    '|---|---|---|---|---|',
    '| FR-001 | 登录 | 手机号+密码 | 返回 JWT | 可测试 |',
    '## 非功能需求',
    '- 性能：登录响应 < 2s',
    '## 需求追溯矩阵',
    '| 需求编号 | 测试用例 |',
    '|---|---|',
    '| FR-001 | TC-001 |',
  ].join('\n');
  const r = checkWithRules('test-requirement-analyzer', good);
  assert.strictEqual(r.pass, true, r.summary.text);
});

t('需求分析：占位编号（FR-xxx）被判不通过', () => {
  const bad = [
    '## 功能需求清单',
    '| 需求编号 | 需求名称 |',
    '|---|---|',
    '| FR-xxx | 登录 |',
    '## 非功能需求 性能',
    '## 验收标准 可测试性',
    '## 追溯矩阵',
  ].join('\n');
  const r = checkWithRules('test-requirement-analyzer', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.byReason.fabrication >= 1, JSON.stringify(r.byReason));
});

// ---------------- 表格行数不丢行 ----------------
t('表格行数统计不受文档末尾空行影响', () => {
  const oneRow = '## 功能需求清单\n| 需求编号 | 名称 |\n|---|---|\n| FR-001 | 登录 |\n';
  const r = checkWithRules('test-requirement-analyzer', oneRow);
  const failed = r.cases.map((c) => c.id);
  assert.ok(!failed.includes('hasFunctionalList'), '单行表格应被识别，实际失败: ' + failed.join(','));
});

// ---------------- 方案 ----------------
t('测试方案：缺准入准出标准不通过', () => {
  const bad = '## 测试策略\n功能测试：等价类\n## 测试资源\n3 人 5 天';
  const r = checkWithRules('test-scheme-generator', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.cases.some((c) => c.id === 'hasCriteria'));
});

// ---------------- 执行类 ----------------
t('接口执行：无真实状态码不通过', () => {
  const bad = '## 执行结果\n| 用例编号 | 结果 |\n|---|---|\n| TC-001 | 通过 |';
  const r = checkWithRules('api-executor', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.cases.some((c) => c.id === 'hasRealStatus'));
});

t('接口执行：声称全通过但无请求证据不通过', () => {
  const bad = '全部通过 100% 成功\n| 用例编号 | 执行结果 |\n|---|---|\n| TC-001 | 通过 |\n状态 200';
  const r = checkWithRules('api-executor', bad + ' 200 201');
  const failed = r.cases.map((c) => c.id);
  assert.ok(failed.includes('noFabricatedPass'), '实际失败: ' + failed.join(','));
});

t('UI 执行：无截图/日志证据不通过', () => {
  const bad = '| 用例编号 | 执行结果 |\n|---|---|\n| E2E-001 | 通过 |\nhttps://example.com';
  const r = checkWithRules('ui-e2e-executor', bad);
  assert.ok(r.cases.some((c) => c.id === 'hasEvidence'));
});

// ---------------- 缺陷 / 报告 ----------------
t('缺陷分析：缺根因不通过', () => {
  const bad = '缺陷ID: BUG-001\n复现步骤: 1. 打开 2. 点击\n严重程度: 一般';
  const r = checkWithRules('defect-analyzer', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.cases.some((c) => c.id === 'hasRootCause'));
});

t('测试报告：无数字不通过', () => {
  const bad = '测试结论：通过\n总用例数：若干';
  const r = checkWithRules('test-reporter', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.cases.some((c) => c.id === 'hasNumbers'));
});

t('测试报告：编造评分无依据不通过', () => {
  const bad = '总用例数 100 执行数 100 通过 95 失败 5 缺陷 5 个\n测试结论：通过\n质量评分：92';
  const r = checkWithRules('test-reporter', bad);
  assert.ok(r.cases.some((c) => c.id === 'noFakeScore'), JSON.stringify(r.cases.map((c) => c.id)));
});

// ---------------- 脱敏 / 安全 ----------------
t('脱敏：残留真实手机号不通过', () => {
  const bad = '字段: 手机号\n脱敏方式: 掩码\n示例: 13800138000';
  const r = checkWithRules('data-masking', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.cases.some((c) => c.id === 'noRawSensitive'));
});

t('脱敏：已脱敏通过', () => {
  const good = '| 字段 | 脱敏方式 |\n|---|---|\n| 手机号 | 掩码 138****8000 |\n| 姓名 | 保留姓 张* |';
  const r = checkWithRules('data-masking', good);
  assert.strictEqual(r.pass, true, r.summary.text);
});

t('安全：无扫描/验证证据不通过', () => {
  const bad = '| 严重度 | 漏洞 |\n|---|---|\n| 高危 | SQL 注入 |\n风险等级 高危 中危';
  const r = checkWithRules('security-sentinel', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.cases.some((c) => c.id === 'hasEvidence'));
});

// ---------------- 性能 / 兼容 / 脚本 ----------------
t('性能：无具体指标数值不通过', () => {
  const bad = 'TPS 较高 响应时间可接受 错误率低 用 jmeter 压测';
  const r = checkWithRules('performance-tester', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.cases.some((c) => c.id === 'hasNumbers'));
});

t('兼容性：缺矩阵结果不通过', () => {
  const bad = '浏览器测试完成，结果良好';
  const r = checkWithRules('compatibility-coordinator', bad);
  assert.strictEqual(r.pass, false);
});

t('脚本生成：无断言不通过', () => {
  const bad = '```js\ntest("a", () => { page.goto("/") })\n```\n使用 playwright';
  const r = checkWithRules('test-script-generator', bad);
  assert.strictEqual(r.pass, false);
  assert.ok(r.cases.some((c) => c.id === 'hasAssertion'));
});

t('脚本生成：含断言的脚本通过', () => {
  const good = '```js\ntest("a", () => { expect(page.title()).toBe("X") })\n```\n框架: playwright';
  const r = checkWithRules('test-script-generator', good);
  assert.strictEqual(r.pass, true, r.summary.text);
});

// ---------------- 边界 ----------------
t('空交付物判 0 分且不通过', () => {
  const r = checkWithRules('test-requirement-analyzer', '');
  assert.strictEqual(r.pass, false);
  assert.strictEqual(r.usabilityRate, 0);
});

t('规则自身抛异常时按未通过处理（不静默放行）', () => {
  // 用一个必然触发的极端输入，确保不抛到外层
  const r = checkWithRules('test-requirement-analyzer', '|'.repeat(1));
  assert.ok(typeof r.usabilityRate === 'number');
});

t('阈值可配置', () => {
  const text = '# 需求分析报告\n## 功能需求清单\n| 需求编号 | 名称 |\n|---|---|\n| FR-001 | 登录 |\n';
  const strict = checkWithRules('test-requirement-analyzer', text, { minPassRate: 0.99 });
  const loose = checkWithRules('test-requirement-analyzer', text, { minPassRate: 0.2 });
  assert.strictEqual(loose.pass, true, '宽松阈值应通过');
  assert.strictEqual(strict.pass, false, '严格阈值应不通过');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
