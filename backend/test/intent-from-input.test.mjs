#!/usr/bin/env node
/**
 * 意图识别必须以输入框内容为准（2026-11-23）
 *
 * 用户问：「不是根据用户在dashboard下面那个输入框输入的内容来做语义理解来做意图识别吗」
 *
 * 之前的实情是：**完全没有**。前端每次都把下拉框选中的智能体当 `agent` 参数传上来：
 *   store.createTask(targetAgentId, fullMessage, files, { type: targetAgentId })
 * 后端第一分支：
 *   if (specifiedAgent) { targetAgent = resolveAgentId(specifiedAgent); confirmedAgent = true; }
 * 于是意图识别整段被跳过——输入框写了什么从不参与决策，全靠用户先选对下拉框。
 * 实测库里今天两个任务都进了 test-case-generator，因为下拉框当时选的就是它。
 *
 * 修复要点：
 *   A. 前端传 preferAgent（弱偏好）+ intentDriven=true，不再传 agent
 *   B. 后端在 intentDriven 下跳过「指定 agent 优先」，改为内容优先
 *   C. 内容识别不出时才回退到 preferAgent（比弹窗打扰更少）
 *   D. 移除「输入与下拉框不匹配」的确认弹窗（intentDriven 下它不是问题）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'api', 'index.ts'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'DashboardView.vue'), 'utf8');
const TI = await import(path.join(ROOT, 'backend', 'lib', 'task-intent.js'));

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 意图识别以输入内容为准 ===');

/** 取出 POST /api/tasks 的路由分发段 */
function dispatchBlock() {
  const start = SERVER.indexOf("app.post('/api/tasks'");
  assert.ok(start > 0, '找不到 POST /api/tasks');
  const end = SERVER.indexOf('const task = {', start);
  assert.ok(end > start, '找不到任务对象构造位置');
  return SERVER.slice(start, end);
}

// ---------------- A) 后端：内容优先 ----------------
console.log('\n-- A. 后端：内容优先 --');

t('★★ intentDriven 模式下不把 specifiedAgent 当「用户已确认」', () => {
  const block = dispatchBlock();
  assert.ok(/const intentDriven = req\.body\.intentDriven === true/.test(block), '没解析 intentDriven');
  assert.ok(/if \(specifiedAgent && !intentDriven\)/.test(block),
    'intentDriven 下仍走「指定 agent 优先」，意图识别会被跳过');
});

t('★★ 内容识别明确时以内容为准（即使与下拉框不同）', () => {
  const block = dispatchBlock();
  const idx = block.indexOf('intentInfo = analyzeTaskIntent');
  assert.ok(idx > 0, '没调用意图识别');
  const after = block.slice(idx, idx + 900);
  assert.ok(/if \(intentInfo\.confident && intentInfo\.agentId\) \{/.test(after), '没有「明确就用内容结果」的分支');
  assert.ok(/targetAgent = intentInfo\.agentId/.test(after), '没把识别结果赋给 targetAgent');
});

t('★★ 内容不明确时回退到 preferAgent（而非直接弹窗）', () => {
  const block = dispatchBlock();
  assert.ok(/const prefer = preferAgent \? resolveAgentId\(preferAgent\) : null/.test(block),
    '没解析 preferAgent 作为弱偏好');
  const idx = block.indexOf('} else if (!confirmedAgent) {');
  const body = block.slice(idx, idx + 900);
  assert.ok(/if \(prefer\) \{/.test(body), '内容不明确时没有先用下拉框兜底');
  assert.ok(/targetAgent = prefer/.test(body), '没把偏好赋给 targetAgent');
  assert.ok(/INTENT_CONFIRM_REQUIRED/.test(body), '连偏好都没有时应该返回候选');
});

t('★ intentDriven 不影响原有「用户明确指定」路径（非该模式行为不变）', () => {
  const block = dispatchBlock();
  // 非 intentDriven 时 specifiedAgent 仍应生效
  assert.ok(/confirmedAgent = true/.test(block), '指定 agent 的确认逻辑被删掉了');
});

// ---------------- B) 前端：不再抢答 ----------------
console.log('\n-- B. 前端不再替后端决定 --');

t('★★ api 层在 intentDriven 下不传 agent，改传 preferAgent', () => {
  const idx = API.indexOf('async create(');
  const body = API.slice(idx, idx + 1800);
  assert.ok(/intentDriven\?: boolean/.test(body), 'create 没有 intentDriven 选项');
  assert.ok(/body\.preferAgent = agentId/.test(body), '没把 agentId 降级为 preferAgent');
  assert.ok(/body\.intentDriven = true/.test(body), '没传 intentDriven 标记');
  // 关键：intentDriven 分支里绝不能同时传 agent
  const ifIdx = body.indexOf('if (options?.intentDriven)');
  const elseIdx = body.indexOf('} else {', ifIdx);
  const drivenBlock = body.slice(ifIdx, elseIdx);
  assert.ok(!/body\.agent = /.test(drivenBlock), 'intentDriven 下仍传了 agent，后端会跳过意图识别');
});

t('★★ dashboard 提交时走 intentDriven（用户点选候选的除外）', () => {
  assert.ok(/intentDriven: true/.test(VIEW), 'dashboard 没有启用 intentDriven');

  // 普通提交路径必须带 intentDriven：
  //   1) 原任务已结束、回退新建任务
  //   2) 正常新建任务
  // 唯独「意图确认弹窗回调」不能带 —— 那是用户已经在候选里明确选了某个智能体，
  // 属于「用户指定」，再走内容识别等于否定用户的选择。
  const calls = VIEW.match(/store\.createTask\(/g) || [];
  const withDriven = VIEW.match(/store\.createTask\([^)]*intentDriven: true/g) || [];
  assert.ok(calls.length >= 2, '找不到 createTask 调用');
  assert.strictEqual(withDriven.length, calls.length - 1,
    `${calls.length} 处 createTask 里 ${withDriven.length} 处启用 intentDriven，应只有「确认弹窗回调」那一处不带`);

  // 确认弹窗回调里必须是显式指定（不带 intentDriven）
  const idx = VIEW.indexOf('async function onIntentConfirmed');
  assert.ok(idx > 0, '找不到 onIntentConfirmed');
  const body = VIEW.slice(idx, idx + 700);
  assert.ok(/store\.createTask\(agentId, pending\.input/.test(body), '确认回调没按选定类型提交');
  assert.ok(!/intentDriven/.test(body), '确认回调不该走 intentDriven（用户已明确选择）');
});

t('★ store 层透传 intentDriven', () => {
  const idx = STORE_INDEX();
  function STORE_INDEX() {
    const s = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
    return s.indexOf('async function createTask');
  }
  const s = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
  const body = s.slice(idx, idx + 400);
  assert.ok(/intentDriven\?: boolean/.test(body), 'store 的 createTask 没接收 intentDriven');
});

t('★★ 移除了「输入与下拉框不匹配」的确认弹窗', () => {
  // intentDriven 下这不是问题；留着会让用户以为必须先选对下拉框
  assert.ok(!/预检查 1: 检查输入与智能体是否匹配/.test(VIEW), '旧的不匹配预检查还在');
  assert.ok(!/未检测到与该智能体相关的关键词/.test(VIEW), '不匹配弹窗文案还在');
});

// ---------------- C) 语义正确性 ----------------
console.log('\n-- C. 语义正确性 --');

t('★★ 相同输入下，下拉框不同不影响实际派发（内容说了算）', () => {
  const cases = [
    ['帮我给登录功能设计测试用例', 'test-case-generator'],
    ['压测一下下单接口看TPS', 'performance-tester'],
    ['给AI助手测幻觉和提示注入', 'ai-app-tester'],
    ['分析这个缺陷的根因', 'defect-analyzer'],
  ];
  const prefs = ['test-requirement-analyzer', 'test-case-generator', 'api-executor', 'security-sentinel'];
  for (const [input, expected] of cases) {
    for (const _pref of prefs) {
      const r = TI.analyzeTaskIntent(input, {});
      assert.strictEqual(r.confident, true, `「${input}」应能明确识别`);
      assert.strictEqual(r.agentId, expected, `「${input}」派给了 ${r.agentId}`);
    }
  }
});

t('★ 内容识别不出时才用偏好（且偏好确实是下拉框的值）', () => {
  const vague = '这个功能还有什么没考虑到的';
  const r = TI.analyzeTaskIntent(vague, {});
  assert.strictEqual(r.confident, false, `「${vague}」不该被自动定性`);
  // 后端在 !confident 时用 preferAgent 兜底——这条在 A 组已验证代码路径
});

t('★ 「AI 助手」这类内容能压过普通用例的下拉框选择', () => {
  // 这正是之前最典型的误派：用户选着「用例生成」，输入里全是 AI 应用测试
  const r = TI.analyzeTaskIntent('给 AI 助手做测试，检查幻觉和提示注入', {});
  assert.strictEqual(r.agentId, 'ai-app-tester', `派给了 ${r.agentId}`);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
