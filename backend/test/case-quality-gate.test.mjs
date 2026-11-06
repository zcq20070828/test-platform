#!/usr/bin/env node
/**
 * case-quality-gate 单元测试
 *
 * 覆盖：
 *   - 断言识别：强断言/负向结果/弱描述
 *   - 占位输入修复：字段语义替换、长度边界、非法枚举
 *   - 表格解析：只认用例表，不误吃覆盖分析表
 *   - 整份门禁：可用率、问题归类、pass 判定
 *   - 定向修复指令：含具体用例编号与现文
 */
import assert from 'node:assert';
import {
  inspectAssertion,
  repairPlaceholderInput,
  parseCaseTable,
  inspectCase,
  checkDeliverable,
  buildRepairPrompt,
  applyInputRepairs,
} from '../lib/case-quality-gate.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== case-quality-gate 单元测试 ===');

// ---------------- 断言识别 ----------------
t('HTTP 状态码算可判定', () => {
  assert.strictEqual(inspectAssertion('返回 401，响应体 {"error":"未认证"}').verifiable, true);
});

t('具体文案（引号包裹）算可判定', () => {
  assert.strictEqual(inspectAssertion('提示"手机号须为11位"').verifiable, true);
});

t('数值变化算可判定', () => {
  assert.strictEqual(inspectAssertion('失败计数变为 3 次').verifiable, true);
  assert.strictEqual(inspectAssertion('锁定 30 分钟后自动解锁').verifiable, true);
});

t('跳转目标算可判定', () => {
  assert.strictEqual(inspectAssertion('跳转至登录页').verifiable, true);
});

t('负向结果（拒绝/拦截）算可判定', () => {
  assert.strictEqual(inspectAssertion('拒绝请求并保持原状态').verifiable, true);
  assert.strictEqual(inspectAssertion('不允许提交').verifiable, true);
});

t('「被接受，进入校验」判为不可判定', () => {
  const r = inspectAssertion('手机号被接受，进入密码校验');
  assert.strictEqual(r.verifiable, false, r.reason);
});

t('「校验通过」判为不可判定', () => {
  assert.strictEqual(inspectAssertion('长度校验通过').verifiable, false);
});

t('「正常处理」判为不可判定', () => {
  assert.strictEqual(inspectAssertion('按密码登录正常处理').verifiable, false);
});

t('空预期判为不可判定', () => {
  const r = inspectAssertion('');
  assert.strictEqual(r.verifiable, false);
  assert.ok(r.reason.includes('为空'));
});

// ---------------- 占位输入修复 ----------------
t('重复 A 按字段语义替换为真实手机号', () => {
  const r = repairPlaceholderInput('phone="AAAAAAAAAAA"');
  assert.strictEqual(r.repaired, true);
  assert.ok(/138\d{8}/.test(r.input), r.input);
});

t('「33位字符」按语义替换为合法密码', () => {
  const r = repairPlaceholderInput('password=33位字符');
  assert.strictEqual(r.repaired, true);
  assert.ok(!/位/.test(r.input), r.input);
});

t('「10位数字」在边界场景下生成长度正确的串', () => {
  const r = repairPlaceholderInput('phone边界=10位数字');
  assert.strictEqual(r.repaired, true);
  const val = r.input.split('=')[1];
  assert.strictEqual(val.replace(/"/g, '').length, 10, r.input);
});

t('__ILLEGAL__ 替换为非法值', () => {
  const r = repairPlaceholderInput('channel=__ILLEGAL__');
  assert.strictEqual(r.repaired, true);
  assert.ok(!r.input.includes('__ILLEGAL__'), r.input);
});

t('多字段逗号分隔逐个修复', () => {
  const r = repairPlaceholderInput('phone="AAAAAAAAAAA", password=__ILLEGAL__');
  assert.strictEqual(r.repairs.length, 2, JSON.stringify(r.repairs));
  assert.ok(!/AAAA|__ILLEGAL__/.test(r.input), r.input);
});

t('正常输入不误改', () => {
  const r = repairPlaceholderInput('phone=13800138000');
  assert.strictEqual(r.repaired, false);
  assert.strictEqual(r.input, 'phone=13800138000');
});

t('非字段表达式不误改', () => {
  const r = repairPlaceholderInput('连续点击登录按钮 5 次');
  assert.strictEqual(r.repaired, false);
});

// ---------------- 表格解析 ----------------
const caseTable = [
  '| 用例编号 | 所属模块 | 用例名称 | 维度 | 层级 | 前置条件 | 输入数据 | 执行步骤 | 预期结果 | 优先级 | 关联需求 |',
  '|---------|---------|---------|------|------|---------|---------|---------|---------|--------|----------|',
  '| TC-001 | 登录 | 手机号合法 | ② 数据 | 正常 | 已注册 | phone=13800138000 | 1.输入 2.提交 | 返回 200 且含 token | 高 | FR-001 |',
  '| TC-002 | 登录 | 手机号过短 | ② 数据 | 异常 | 服务可用 | phone=138 | 1.输入 2.提交 | 提示"须11位" | 中 | FR-001 |',
].join('\n');

t('解析用例表得到 2 条用例', () => {
  const { cases, headerFound } = parseCaseTable(caseTable);
  assert.strictEqual(headerFound, true);
  assert.strictEqual(cases.length, 2);
  assert.strictEqual(cases[0].id, 'TC-001');
  assert.strictEqual(cases[1].expected, '提示"须11位"');
});

t('覆盖分析表不被误判为用例表', () => {
  const md = [
    caseTable,
    '',
    '## 覆盖分析',
    '| 需求编号 | 覆盖用例数 | 覆盖状态 |',
    '|---------|-----------|---------|',
    '| FR-001 | TC-001,TC-002 | 已覆盖 |',
  ].join('\n');
  const { cases } = parseCaseTable(md);
  assert.strictEqual(cases.length, 2, '不应包含覆盖分析行，实际 ' + cases.length);
});

t('没有预期结果列的表不算用例表', () => {
  const md = [
    '| 需求编号 | 覆盖用例数 | 覆盖状态 |',
    '|---|---|---|',
    '| FR-001 | 3 | 已覆盖 |',
  ].join('\n');
  const { cases, headerFound } = parseCaseTable(md);
  assert.strictEqual(headerFound, false);
  assert.strictEqual(cases.length, 0);
});

// ---------------- 单条检查 ----------------
t('合格用例判为可用', () => {
  const r = inspectCase({
    id: 'TC-001', name: 'n', steps: '1.输入 2.提交', expected: '返回 200，响应体含 token 字段', input: 'phone=13800138000',
  });
  assert.strictEqual(r.usable, true, r.detail);
});

t('弱断言判为不可用且标 major', () => {
  const r = inspectCase({ id: 'TC-002', name: 'n', steps: '1.输入', expected: '校验通过', input: 'a=1' });
  assert.strictEqual(r.usable, false);
  assert.ok(r.reasons.includes('weakAssertion'));
  assert.strictEqual(r.severity, 'major');
});

t('占位输入可自动修复时不判不可用', () => {
  const r = inspectCase({ id: 'TC-003', name: 'n', steps: '1.输入', expected: '返回 200', input: 'phone="AAAAAAAAAAA"' });
  assert.strictEqual(r.usable, true, r.detail);
  assert.ok(r.repairs.length > 0, '应记录修复动作');
});

t('重复用例被识别', () => {
  const ctx = { seenKeys: new Map() };
  const c = { id: 'TC-001', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', module: 'm' };
  inspectCase(c, ctx);
  const r = inspectCase({ ...c, id: 'TC-002' }, ctx);
  assert.ok(r.reasons.includes('duplicate'));
});

t('关联需求不存在被识别', () => {
  const ctx = { requirementIds: new Set(['FR-001']) };
  const r = inspectCase({ id: 'TC-009', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', requirement: 'FR-999' }, ctx);
  assert.ok(r.reasons.includes('orphanRequirement'), JSON.stringify(r.reasons));
});

// ---------------- 整份门禁 ----------------
t('全合格交付物通过门禁', () => {
  const md = [
    '| 用例编号 | 用例名称 | 输入数据 | 执行步骤 | 预期结果 | 关联需求 |',
    '|---|---|---|---|---|---|',
    '| TC-001 | a | x=1 | 1.输入 2.提交 | 返回 200，含 token 字段 | FR-001 |',
    '| TC-002 | b | x=2 | 1.输入 2.提交 | 提示"参数非法" | FR-001 |',
  ].join('\n');
  const r = checkDeliverable(md, { originalInput: 'FR-001', minUsabilityRate: 0.85 });
  assert.strictEqual(r.applicable, true);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.usabilityRate, 1);
  assert.strictEqual(r.pass, true);
});

t('低可用率不通过并给出问题分布', () => {
  const md = [
    '| 用例编号 | 用例名称 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|',
    '| TC-001 | a | x=1 | 1.输入 | 被接受 |',
    '| TC-002 | b | x=2 | 1.输入 | 校验通过 |',
    '| TC-003 | c | x=3 | 1.输入 | 正常处理 |',
    '| TC-004 | d | x=4 | 1.输入 | 返回 200，含 token |',
  ].join('\n');
  const r = checkDeliverable(md, { minUsabilityRate: 0.85 });
  assert.strictEqual(r.pass, false);
  assert.strictEqual(r.usable, 1);
  assert.strictEqual(r.usabilityRate, 0.25);
  assert.strictEqual(r.byReason.weakAssertion, 3);
});

t('非用例交付物判为不适用且不阻塞', () => {
  const r = checkDeliverable('# 需求分析报告\n\n## 功能需求\n- FR-001 登录', {});
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.usabilityRate, 1);
});

t('阈值可配置', () => {
  const md = [
    '| 用例编号 | 用例名称 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|',
    '| TC-001 | a | x=1 | 1.输入 | 返回 200 |',
    '| TC-002 | b | x=2 | 1.输入 | 校验通过 |',
  ].join('\n');
  assert.strictEqual(checkDeliverable(md, { minUsabilityRate: 0.5 }).pass, true);
  assert.strictEqual(checkDeliverable(md, { minUsabilityRate: 0.9 }).pass, false);
});

// ---------------- 修复指令 ----------------
t('修复指令包含具体用例编号与现文', () => {
  const md = [
    '| 用例编号 | 用例名称 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|',
    '| TC-001 | 手机号合法 | phone=13800138000 | 1.输入 | 手机号被接受，进入密码校验 |',
  ].join('\n');
  const r = checkDeliverable(md, {});
  const prompt = buildRepairPrompt(r);
  assert.ok(prompt.includes('TC-001'), prompt.slice(0, 300));
  assert.ok(prompt.includes('手机号被接受'), '应引用现文');
  assert.ok(prompt.includes('HTTP 状态码') || prompt.includes('可观测断言'), '应给出改写要求');
});

t('修复指令含占位输入与重复用例分节', () => {
  const md = [
    '| 用例编号 | 用例名称 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|',
    '| TC-001 | a | k=__ILLEGAL__ | 1.输入 | 校验通过 |',
    '| TC-002 | a | k=__ILLEGAL__ | 1.输入 | 校验通过 |',
  ].join('\n');
  const prompt = buildRepairPrompt(checkDeliverable(md, {}));
  assert.ok(prompt.includes('重复用例') || prompt.includes('重复'), prompt.slice(0, 400));
});

t('不适用时返回空指令', () => {
  const r = checkDeliverable('# 无表格', {});
  assert.strictEqual(buildRepairPrompt(r), '');
});

// ---------------- 自动修复落表 ----------------
t('applyInputRepairs 把占位值写回表格', () => {
  const md = [
    '| 用例编号 | 用例名称 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|',
    '| TC-001 | a | phone="AAAAAAAAAAA" | 1.输入 | 返回 200 |',
  ].join('\n');
  const r = applyInputRepairs(md);
  assert.strictEqual(r.applied, 1, 'applied=' + r.applied);
  assert.ok(/138\d{8}/.test(r.text), r.text);
  assert.ok(!/AAAAAAAAAAA/.test(r.text));
});

t('applyInputRepairs 不改动非表格行', () => {
  const md = '普通段落 phone="AAAAAAAAAAA"';
  const r = applyInputRepairs(md);
  assert.strictEqual(r.applied, 0);
  assert.strictEqual(r.text, md);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
