#!/usr/bin/env node
/**
 * test-effort-estimator 单元测试
 */
const assert = require('node:assert');
const { estimateEffort, BASE_PERSON_DAYS, HOURS_PER_PERSON_DAY } = require('../backend/estimate.js');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

const smallText = '生成登录测试用例';
const bigText = [
  '需求分析报告',
  'FR-001 登录', 'FR-002 注册', 'FR-003 修改密码', 'FR-004 退出', 'FR-005 找回密码',
  'FR-006 实名认证', 'FR-007 绑定手机', 'FR-008 解绑手机', 'FR-009 消息通知', 'FR-010 个人中心',
  'FR-011 权限管理', 'FR-012 操作日志', 'FR-013 数据导出', 'FR-014 批量导入', 'FR-015 审核流程',
  'FR-016 状态流转', 'FR-017 任务派发', 'FR-018 结果回传',
  'API-001 登录接口', 'API-002 注册接口', 'API-003 令牌刷新', 'API-004 用户信息', 'API-005 权限校验',
  'API-006 文件上传', 'API-007 文件下载', 'API-008 消息推送', 'API-009 数据查询', 'API-010 数据导出',
  '涉及模块：登录模块、用户模块、权限模块、消息模块、文件模块、报表模块',
  '边界条件：手机号 11 位；密码 8-32 位；连续 5 次失败锁定 30 分钟；超时 2 小时；并发 100；幂等写入；越权校验；回滚策略；限流 20 QPS',
  'x'.repeat(12000),
].join('\n');

console.log('=== test-effort-estimator 单元测试 ===');

t('小输入使用基准人天，不走放大', () => {
  const r = estimateEffort({ taskType: 'test-case-generator', taskInput: smallText });
  assert.ok(r.totalPersonDays > 0);
  assert.ok(r.totalPersonDays <= 1, '小输入不应超过 1 人天，实际 ' + r.totalPersonDays);
});

t('大输入规模系数上调', () => {
  const small = estimateEffort({ taskType: 'test-case-generator', taskInput: smallText });
  const big = estimateEffort({ taskType: 'test-case-generator', taskInput: bigText });
  assert.ok(big.scale > small.scale, `规模系数应上升：${small.scale} → ${big.scale}`);
  assert.ok(big.totalPersonDays > small.totalPersonDays);
});

t('识别需求条目与接口数量', () => {
  const r = estimateEffort({ taskType: 'test-case-generator', taskInput: bigText });
  assert.ok(r.factors.requirements.count >= 18, '需求条目识别不足：' + r.factors.requirements.count);
  assert.ok(r.factors.apis.count >= 10, '接口识别不足：' + r.factors.apis.count);
});

t('规模系数被夹在 [0.6, 2.5]', () => {
  for (const text of ['', smallText, bigText, 'x'.repeat(80000)]) {
    const r = estimateEffort({ taskType: 'test-case-generator', taskInput: text });
    assert.ok(r.scale >= 0.6 && r.scale <= 2.5, 'scale 越界：' + r.scale);
  }
});

t('工时 = 人天 × 8', () => {
  const r = estimateEffort({ taskType: 'test-case-generator', taskInput: bigText });
  assert.strictEqual(r.totalHours, Math.round(r.totalPersonDays * HOURS_PER_PERSON_DAY * 100) / 100);
});

t('同一输入结果稳定（确定性）', () => {
  const a = estimateEffort({ taskType: 'test-case-generator', taskInput: bigText });
  const b = estimateEffort({ taskType: 'test-case-generator', taskInput: bigText });
  assert.deepStrictEqual(a, b);
});

t('未知智能体退回默认基准', () => {
  const r = estimateEffort({ taskType: 'unknown-agent-xyz', taskInput: smallText });
  assert.strictEqual(r.basePersonDays, 0.5);
});

t('空输入不抛异常且为正数', () => {
  const r = estimateEffort({ taskType: 'test-case-generator', taskInput: '' });
  assert.ok(r.totalPersonDays > 0);
  assert.ok(r.totalHours > 0);
});

t('undefined 参数安全', () => {
  const r = estimateEffort();
  assert.strictEqual(r.taskType, 'unknown');
  assert.ok(r.totalPersonDays > 0);
});

t('对象输入可被序列化后估算', () => {
  const r = estimateEffort({ taskType: 'test-case-generator', taskInput: { a: 1, b: 'x'.repeat(5000) } });
  assert.ok(r.totalPersonDays > 0);
});

t('复杂度等级与人天一致', () => {
  const r = estimateEffort({ taskType: 'test-requirement-analyzer', taskInput: smallText });
  const map = { low: 0, medium: 1, high: 2, very_high: 3 };
  assert.ok(map[r.complexity] !== undefined);
  if (r.totalPersonDays < 0.5) assert.strictEqual(r.complexity, 'low');
  if (r.totalPersonDays > 3) assert.strictEqual(r.complexity, 'very_high');
});

t('各智能体基准人天均为正数', () => {
  for (const [agent, days] of Object.entries(BASE_PERSON_DAYS)) {
    assert.ok(days > 0, agent + ' 基准人天必须为正');
  }
});

t('basis 文案包含关键因子', () => {
  const r = estimateEffort({ taskType: 'test-case-generator', taskInput: bigText });
  assert.ok(r.basis.includes('基准人天'));
  assert.ok(r.basis.includes('规模系数'));
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
