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
  applyLayerColumnRepair,
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
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 | 关联需求 |',
    '|---|---|---|---|---|---|---|---|',
    '| TC-001 | a | ② 数据 / 等价类划分法 | 正常 | x=1 | 1.输入 2.提交 | 返回 200，含 token 字段 | FR-001 |',
    '| TC-002 | b | ② 数据 / 边界值分析法 | 边界 | x=2 | 1.输入 2.提交 | 提示"参数非法" | FR-001 |',
  ].join('\n');
  const r = checkDeliverable(md, { originalInput: 'FR-001', minUsabilityRate: 0.85, requireDimensionCoverage: false });
  assert.strictEqual(r.applicable, true);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.usabilityRate, 1);
  assert.strictEqual(r.pass, true);
});

t('低可用率不通过并给出问题分布', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| TC-001 | a | ② 数据 / 等价类划分法 | 正常 | x=1 | 1.输入 | 被接受 |',
    '| TC-002 | b | ② 数据 / 等价类划分法 | 正常 | x=2 | 1.输入 | 校验通过 |',
    '| TC-003 | c | ② 数据 / 等价类划分法 | 正常 | x=3 | 1.输入 | 正常处理 |',
    '| TC-004 | d | ② 数据 / 等价类划分法 | 正常 | x=4 | 1.输入 | 返回 200，含 token |',
  ].join('\n');
  const r = checkDeliverable(md, { minUsabilityRate: 0.85, requireDimensionCoverage: false });
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
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| TC-001 | a | ② 数据 / 等价类划分法 | 正常 | x=1 | 1.输入 | 返回 200 |',
    '| TC-002 | b | ② 数据 / 等价类划分法 | 正常 | x=2 | 1.输入 | 校验通过 |',
  ].join('\n');
  const opts = { requireDimensionCoverage: false };
  assert.strictEqual(checkDeliverable(md, { ...opts, minUsabilityRate: 0.5 }).pass, true);
  assert.strictEqual(checkDeliverable(md, { ...opts, minUsabilityRate: 0.9 }).pass, false);
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


// ---------------- 长度边界保真（2026-11-10）----------------
t('长度边界用例：输入长度必须与用例名一致', () => {
  const r = repairPlaceholderInput('password="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"', '密码31位(max-1) 输入31位密码');
  const v = r.input.split('=')[1].replace(/"/g, '');
  assert.strictEqual(v.length, 31, r.input);
});

t('长度边界用例：33 位密码修完仍是 33 位', () => {
  const r = repairPlaceholderInput('password=33位字符', '密码33位过长 边界');
  const v = r.input.split('=')[1].replace(/"/g, '');
  assert.strictEqual(v.length, 33, r.input);
});

t('非边界用例：密码修成合规的 8 位真实样例', () => {
  const r = repairPlaceholderInput('password="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"', '正常登录用例');
  const v = r.input.split('=')[1].replace(/"/g, '');
  assert.strictEqual(v.length, 8, r.input);
});

t('手机号边界：10/11/12 位均保真', () => {
  for (const [len, ctx] of [[10, '手机号10位过短 边界'], [11, '手机号11位合法值'], [12, '手机号12位过长 边界']]) {
    const raw = 'phone="' + 'A'.repeat(len) + '"';
    const r = repairPlaceholderInput(raw, ctx);
    const v = r.input.split('=')[1].replace(/"/g, '');
    assert.strictEqual(v.length, len, ctx + ' → ' + r.input);
  }
});

t('验证码边界：5/6/7 位均保真', () => {
  for (const len of [5, 6, 7]) {
    const raw = 'smsCode="' + 'A'.repeat(len) + '"';
    const r = repairPlaceholderInput(raw, '验证码' + len + '位 边界');
    const v = r.input.split('=')[1].replace(/"/g, '');
    assert.strictEqual(v.length, len, r.input);
  }
});

t('邮箱边界仍保留 @ 结构', () => {
  const r = repairPlaceholderInput('email="AAAAAAAAAAAA"', '邮箱长度边界');
  assert.ok(r.input.includes('@'), r.input);
});

t('applyInputRepairs 用整行上下文判断边界', () => {
  const md = '| TC-013 | 密码31位(max-1) | password="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" | 1.输入31位密码 | 返回 200 |';
  const out = applyInputRepairs(md);
  const cell = out.text.split('|')[3].trim();
  const v = cell.split('=')[1].replace(/"/g, '');
  assert.strictEqual(v.length, 31, out.text);
});


// ---------------- 用例编号不再被误跳过（2026-11-09）----------------
t('真实编号 TC-LOGIN-P0-001 被解析而非跳过', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| TC-LOGIN-P0-001 | 手机号登录 | ① 用户 / 场景法 | 正常 | phone=13800138000 | 1.输入 2.提交 | 返回 200，含 token 字段 |',
  ].join('\n');
  const { cases, skippedIds } = parseCaseTable(md);
  assert.strictEqual(cases.length, 1, '编号被跳过：' + JSON.stringify(skippedIds));
  assert.strictEqual(cases[0].id, 'TC-LOGIN-P0-001');
});

t('CAPTCHA-001 / IT-API-001-Up 都能被解析', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| CAPTCHA-001 | 图形验证码校验 | ② 数据 / 等价类划分法 | 异常 | code=abcd | 1.输入 2.提交 | 返回 400，提示"验证码错误" |',
    '| IT-API-001-Up | 接口正向调用 | ② 数据 / 等价类划分法 | 正常 | id=1 | 1.调用 | 返回 200，字段齐全 |',
  ].join('\n');
  const { cases } = parseCaseTable(md);
  assert.strictEqual(cases.length, 2, JSON.stringify(cases.map((c) => c.id)));
});

t('不是编号的单元格仍被排除（纯文字/日期）', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| 待确认 | a | ② 数据 / 等价类划分法 | 正常 | x=1 | 1.输入 | 返回 200 |',
    '| 2026-11-09 | b | ② 数据 / 等价类划分法 | 正常 | x=2 | 1.输入 | 返回 200 |',
  ].join('\n');
  const { cases, skippedIds } = parseCaseTable(md);
  assert.strictEqual(cases.length, 0);
  assert.ok(skippedIds.length >= 2, JSON.stringify(skippedIds));
});

// ---------------- 维度列成为约束（2026-11-09）----------------
t('维度列为空判为不可用且属 blocker', () => {
  const r = inspectCase(
    { id: 'TC-001', name: 'n', steps: '1.输入 2.提交', expected: '返回 200，含 token 字段', input: 'a=1', dimension: '', layer: '正常' },
    { requireDimension: true },
  );
  assert.strictEqual(r.usable, false);
  assert.ok(r.reasons.includes('missingDimension'), JSON.stringify(r.reasons));
  assert.strictEqual(r.severity, 'blocker');
});

t('维度写了但没有设计方法判为 missingMethod', () => {
  const r = inspectCase(
    { id: 'TC-001', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', dimension: '② 数据', layer: '正常' },
    { requireDimension: true },
  );
  assert.ok(r.reasons.includes('missingMethod'), JSON.stringify(r.reasons));
});

t('层级缺失判为 missingLayer', () => {
  const r = inspectCase(
    { id: 'TC-001', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', dimension: '② 数据 / 等价类划分法', layer: '' },
    { requireDimension: true },
  );
  assert.ok(r.reasons.includes('missingLayer'), JSON.stringify(r.reasons));
});

t('维度/方法/层级齐全通过该项检查', () => {
  const r = inspectCase(
    { id: 'TC-001', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', dimension: '② 数据 / 等价类划分法', layer: '边界' },
    { requireDimension: true },
  );
  assert.strictEqual(r.usable, true, r.detail);
});

// ---------------- 九维覆盖成为 pass 的前置条件（2026-11-09）----------------
t('九维只覆盖数据维 → 维度判定不通过', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| TC-001 | a | ② 数据 / 等价类划分法 | 正常 | x=1 | 1.输入 2.提交 | 返回 200，含 token 字段 |',
  ].join('\n');
  const r = checkDeliverable(md, { minUsabilityRate: 0.85 });
  assert.strictEqual(r.usabilityPass, true, r.summary.text);
  assert.strictEqual(r.dimensionPass, false);
  assert.strictEqual(r.pass, false, '九维未覆盖时不得通过');
  assert.ok(r.dimensions.missingDimensions.length >= 7, r.dimensions.text);
});

t('豁免声明中的维度不再算漏测', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| TC-001 | a | ② 数据 / 等价类划分法 | 正常 | x=1 | 1.输入 2.提交 | 返回 200，含 token 字段 |',
    '',
    '### 豁免声明',
    '| 维度/方法 | 不适用原因 | 风险影响 | 声明人 |',
    '| --- | --- | --- | --- |',
    '| ⑤ 安全 | 本次为纯离线工具，无网络入口 | 无 | AI |',
  ].join('\n');
  const r = checkDeliverable(md, {});
  assert.ok(r.dimensions.waived.includes('security'), JSON.stringify(r.dimensions.waived));
  assert.ok(!r.dimensions.missingDimensions.includes('security'));
});

t('skippedIds 会出现在报告里（漏检可见）', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| 待定 | a | ② 数据 / 等价类划分法 | 正常 | x=1 | 1.输入 | 返回 200 |',
    '| TC-001 | b | ② 数据 / 等价类划分法 | 正常 | x=2 | 1.输入 2.提交 | 返回 200 |',
  ].join('\n');
  const r = checkDeliverable(md, {});
  assert.ok(Array.isArray(r.skippedIds));
  assert.ok(r.skippedIds.includes('待定'), JSON.stringify(r.skippedIds));
});


// ---------------- 断言识别：中文引号与具体对象（2026-11-10）----------------
// 实测任务 590f：47 条被判「预期不可判定」的用例中 28 条其实是可判定的，
// 只因引号是中文弯引号 “ ” 或描述里带具体 UI 对象。误杀会让模型白改一遍。
t('中文弯引号包裹的具体文案算可判定', () => {
  assert.strictEqual(inspectAssertion('顶栏显示文案“玩转AI云盘赢豪礼”').verifiable, true);
  assert.strictEqual(inspectAssertion('任务卡片正常展示“一次性任务”').verifiable, true);
  assert.strictEqual(inspectAssertion('列表尾部显示“1000+”').verifiable, true);
});

t('具体 UI 对象 + 可观测变化算可判定', () => {
  assert.strictEqual(inspectAssertion('登录成功进入活动页，右上角显示掩码手机号').verifiable, true);
  assert.strictEqual(inspectAssertion('页面出现验证码输入框').verifiable, true);
});

t('负向可观测结果算可判定（不执行注入/不发放奖品）', () => {
  assert.strictEqual(inspectAssertion('参数化查询生效，不执行注入语句').verifiable, true);
  assert.strictEqual(inspectAssertion('纯文本回显，脚本不执行').verifiable, true);
  assert.strictEqual(inspectAssertion('助力失败，不发放奖励，明细不增加').verifiable, true);
});

t('「XX 展示正确」仍判为不可判定（有评价词但无判据）', () => {
  assert.strictEqual(inspectAssertion('未登录态展示正确').verifiable, false);
  assert.strictEqual(inspectAssertion('功能正常').verifiable, false);
  assert.strictEqual(inspectAssertion('弱网下功能可用，无状态错乱').verifiable, false);
});

t('判定顺序：弱描述优先于强断言词', () => {
  // 「展示」在强断言表里，但整句只剩「展示正确」时必须是弱
  const r = inspectAssertion('页面展示正确');
  assert.strictEqual(r.verifiable, false, 'reason=' + r.reason);
});

// ---------------- 层级列自动补齐（2026-11-10）----------------
const noLayerTable = [
  '| 用例编号 | 用例名称 | 维度 | 输入数据 | 执行步骤 | 预期结果 |',
  '|---|---|---|---|---|---|',
  '| IT-001-01 | 正向调用 | ② 数据 / 等价类划分法 | id=1 | 1.调用 | 返回 200，含 data 字段 |',
  '| IT-001-02 | 参数异常 | ② 数据 / 边界值分析法 | id=超长 | 1.调用 | 返回 400 并给出字段名 |',
  '| IT-001-03 | 边界值 | ② 数据 / 边界值分析法 | id=最大值 | 1.调用 | 返回 200，字段值原样回显 |',
].join('\n');

t('缺层级列的表被自动补齐，层级插在维度列之后', () => {
  const r = applyLayerColumnRepair(noLayerTable);
  assert.strictEqual(r.tablesRepaired, 1);
  assert.strictEqual(r.rowsRepaired, 3);
  const header = r.text.split('\n')[0];
  assert.ok(/维度 \| 层级 \| 输入数据/.test(header), header);
});

t('层级按行文字确定性推断：异常→边界→正常', () => {
  const r = applyLayerColumnRepair(noLayerTable);
  const { cases } = parseCaseTable(r.text);
  assert.strictEqual(cases[0].layer, '正常', 'arg异常行被误判=' + cases[0].layer);
  assert.strictEqual(cases[1].layer, '异常');
  assert.strictEqual(cases[2].layer, '边界');
});

t('已有层级列的表不改动', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 预期结果 |',
    '|---|---|---|---|---|',
    '| TC-001 | a | ② 数据 / 等价类划分法 | 边界 | 返回 200 |',
  ].join('\n');
  const r = applyLayerColumnRepair(md);
  assert.strictEqual(r.tablesRepaired, 0);
  assert.strictEqual(r.text, md);
});

t('补层级后整份门禁可用率显著提升', () => {
  const before = checkDeliverable(noLayerTable, { minUsabilityRate: 0.5 });
  assert.ok(before.byReason.missingLayer >= 3, JSON.stringify(before.byReason));
  const fixed = applyLayerColumnRepair(noLayerTable);
  const after = checkDeliverable(fixed.text, { requireDimensionCoverage: false });
  assert.ok(!after.byReason.missingLayer, JSON.stringify(after.byReason));
  assert.ok(after.usable > before.usable, `${before.usable} → ${after.usable}`);
});

t('非用例表（无预期结果列）不补层级', () => {
  const md = [
    '| 需求编号 | 覆盖用例数 | 覆盖状态 |',
    '|---|---|---|',
    '| FR-001 | 3 | 已覆盖 |',
  ].join('\n');
  const r = applyLayerColumnRepair(md);
  assert.strictEqual(r.tablesRepaired, 0);
});


// ---------------- 需求编号抽取：追踪标记不算断链（2026-11-12）----------------
// 实测任务 1ddfd0f6：239 条用例里 102 条被误判需求断链，因为「关联需求」列写成
// `FR-011 [R1]`，方括号是设计方法追踪标记，按空白切词后被当成需求编号去比对。
t('关联需求含追踪标记 [R1] 不判断链', () => {
  const ctx = { requirementIds: new Set(['FR-011']), seenKeys: new Map() };
  const r = inspectCase({ id: 'X', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', requirement: 'FR-011 [R1]' }, ctx);
  assert.ok(!r.reasons.includes('orphanRequirement'), r.detail);
});

t('多编号 + 追踪标记都能正确解析', () => {
  const ctx = { requirementIds: new Set(['FR-015', 'NFR-002']), seenKeys: new Map() };
  const r = inspectCase({ id: 'X', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', requirement: 'FR-015/NFR-002 [R5]' }, ctx);
  assert.ok(!r.reasons.includes('orphanRequirement'), r.detail);
});

t('真断链仍然判出（不因放宽而漏检）', () => {
  const ctx = { requirementIds: new Set(['FR-011']), seenKeys: new Map() };
  const r = inspectCase({ id: 'X', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', requirement: 'FR-999 [R1]' }, ctx);
  assert.ok(r.reasons.includes('orphanRequirement'), r.detail);
});

t('部分断链：一个存在一个不存在仍判断链', () => {
  const ctx = { requirementIds: new Set(['NFR-002']), seenKeys: new Map() };
  const r = inspectCase({ id: 'X', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', requirement: 'FR-999/NFR-002' }, ctx);
  assert.ok(r.reasons.includes('orphanRequirement'), r.detail);
});

t('关联需求没写编号（如「见需求文档」）不算断链', () => {
  const ctx = { requirementIds: new Set(['FR-011']), seenKeys: new Map() };
  const r = inspectCase({ id: 'X', name: 'n', steps: '1.输入', expected: '返回 200', input: 'a=1', requirement: '见需求文档' }, ctx);
  assert.ok(!r.reasons.includes('orphanRequirement'), r.detail);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
