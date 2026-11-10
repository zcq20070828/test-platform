#!/usr/bin/env node
/**
 * 审核上下文与跨环节一致性检查的单测（2026-11-06）
 *
 * 覆盖：
 *   - reviewContext.previousOutput 的三种渲染（有上游 / 首阶段 / 未提供）
 *   - 审核 prompt 必须包含跨环节检查条款
 *   - 自动工作流不再使用内联 prompt（源码级断言，防止回退）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 审核上下文与跨环节检查 单测 ===');

// 复刻 prompt 中 previousSection 的拼装规则
function renderPrevious(ctx) {
  const prev = ctx.previousOutput;
  const prevStage = ctx.previousStage || '上一环节';
  if (prev) return `【上一环节产出（${prevStage}，用于核对承接关系）】`;
  return ctx.hasPrevious === false
    ? '【上一环节产出】本环节为首个阶段，无上游产出'
    : '【上一环节产出】未提供（无法核对跨环节一致性，不得声称已核对）';
}

t('有上游产出时标注阶段名', () => {
  const out = renderPrevious({ previousOutput: '需求分析报告正文', previousStage: '需求分析' });
  assert.ok(out.includes('需求分析'));
  assert.ok(out.includes('用于核对承接关系'));
});

t('首阶段明确写「无上游产出」', () => {
  const out = renderPrevious({ hasPrevious: false });
  assert.ok(out.includes('首个阶段'));
  assert.ok(out.includes('无上游产出'));
});

t('未提供时要求审核不得声称已核对', () => {
  const out = renderPrevious({});
  assert.ok(out.includes('未提供'));
  assert.ok(out.includes('不得声称已核对'));
});

t('previousOutput 为空字符串时按「无上游」处理而非「有上游」', () => {
  // 空串是 falsy，应走到 hasPrevious 分支，不能渲染出空的「上一环节产出」标题
  const out = renderPrevious({ previousOutput: '', previousStage: '需求分析', hasPrevious: true });
  assert.ok(!out.includes('用于核对承接关系'), out);
});

// 源码级断言：prompt 必须包含跨环节条款
t('审核 prompt 含跨环节一致性检查条款', () => {
  assert.ok(/【跨环节一致性检查（提供了「上一环节产出」时必须执行[^】]*）】/.test(SERVER));
});

t('跨环节条款要求核对数值一致性', () => {
  assert.ok(/上一环节已明确的需求编号\/接口\/规则\/数值/.test(SERVER));
});

t('跨环节条款要求区分「上游缺失」责任归属', () => {
  assert.ok(SERVER.includes('上游缺失'));
});

// 源码级断言：三条链路都传 hasPrevious
t('三处审核调用都显式传 hasPrevious', () => {
  const count = (SERVER.match(/hasPrevious:/g) || []).length;
  assert.ok(count >= 3, '实际 ' + count + ' 处，应至少 3 处（交互工作流/自动工作流/单任务）');
});

t('自动工作流不再使用内联审核 prompt', () => {
  assert.ok(!SERVER.includes('const reviewPrompt = `请对以下「'), '仍存在内联 prompt');
});

t('自动工作流改为复用 callReviewersSequentially', () => {
  const calls = (SERVER.match(/await callReviewersSequentially\(/g) || []).length;
  assert.ok(calls >= 3, '实际 ' + calls + ' 处调用，应至少 3 处');
});

t('自动工作流传入上一阶段名与产出', () => {
  assert.ok(SERVER.includes('previousOutput: previousStepOutput'));
  assert.ok(SERVER.includes("finalPlan[step.step - 2]?.stage"));
});

t('交互工作流与单任务显式标记 hasPrevious=false', () => {
  const falseCount = (SERVER.match(/hasPrevious: false/g) || []).length;
  assert.ok(falseCount >= 2, '实际 ' + falseCount);
});

t('自动工作流按阶段序号判断是否有上游', () => {
  assert.ok(SERVER.includes('hasPrevious: step.step > 1'));
});


// ============ 阶段化审核重点（2026-11-06）============
t('审核重点按阶段/交付物类型切换', () => {
  assert.ok(SERVER.includes('DELIVERABLE_FOCUS'), '缺少 DELIVERABLE_FOCUS 表');
  assert.ok(SERVER.includes('本阶段审核重点（必须逐条执行）'), '未使用动态重点');
});

t('需求分析阶段明确禁止要求包含用例', () => {
  assert.ok(/本阶段只需产出需求分析报告[^`]*不得要求它包含测试用例/.test(SERVER));
});

t('用例生成阶段的重点包含「预期可判定」与「输入真实性」', () => {
  assert.ok(SERVER.includes('每条用例的预期结果是否可判定'));
  assert.ok(SERVER.includes('不能是「10位数字」「AAAAAA」这类占位'));
});

t('三处审核调用都传 agentId 供选择重点', () => {
  const count = (SERVER.match(/agentId: (task\.agent|selectedAgentId|step\.agentId)/g) || []).length;
  assert.ok(count >= 3, '实际 ' + count);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
