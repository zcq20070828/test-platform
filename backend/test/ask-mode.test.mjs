#!/usr/bin/env node
/**
 * 提交框直接问问题（2026-11-20）
 *
 * 用户要求：「提交框里也能直接问问题」。
 *
 * 难点不在「怎么调模型」，而在「别走生成链路」。
 * 任务提交会创建任务记录、跑三审、落交付物版本、占用用户串行锁——
 * 用户问一句「这个需求该怎么测」就产出任务 + 交付物 + 三审，
 * 白等十几分钟还污染任务列表。
 *
 * 本文件验证五件事：
 *   A. 问答不建任务、不落交付物、不进串行锁
 *   B. 两项生成侧校验必须跳过（否则纯问答会被拒）
 *        - validateAgentInput：要求最小长度 / 要求前置交付物
 *        - validateEvidenceBinding：要求报告/缺陷类带真实执行数据
 *   C. 系统提示词要压制「输出完整交付物」（否则回答写成一份文档）
 *   D. SSE 隔离：chat_message 必须带顶层 userId，否则会广播给所有用户
 *   E. 追问能接上下文（askId 会话），且不能读别人的会话
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'api', 'index.ts'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'DashboardView.vue'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 提交框直接问问题 ===');

/** 取出 /api/ask 的处理函数体 */
function askHandler() {
  const start = SERVER.indexOf("app.post('/api/ask'");
  assert.ok(start > 0, '找不到 /api/ask 端点');
  const end = SERVER.indexOf("app.post('/api/tasks/:id/chat'", start);
  assert.ok(end > start, '找不到 /api/ask 结束位置');
  return SERVER.slice(start, end);
}

// ---------------- A) 不走生成链路 ----------------
console.log('\n-- A. 不走生成链路 --');

t('★ 问答不创建任务（不写 tasks 表、不生成任务对象）', () => {
  const body = askHandler();
  assert.ok(!/taskDAO\.createTask/.test(body), '问答链路在创建任务记录');
  assert.ok(!/tasks\.set\(/.test(body), '问答链路往内存任务表塞了记录');
});

t('★ 问答不落交付物、不跑三审', () => {
  const body = askHandler();
  assert.ok(!/saveDeliverablesToFiles/.test(body), '问答链路在落交付物');
  assert.ok(/skipReview/.test(body) || /true,\s*\/\/ skipReview/.test(body), '问答没跳过三审');
  // spawnAgentSession 第 5 个参数是 skipReview，问答应传 true
  const call = body.slice(body.indexOf('spawnAgentSession('), body.indexOf('spawnAgentSession(') + 400);
  assert.ok(/true,\s*\/\/ skipReview/.test(call), `spawn 的 skipReview 不是 true：${call.slice(0, 120)}`);
});

t('★ 问答不占用用户串行锁（问问题不该被「有任务在执行」挡住）', () => {
  const body = askHandler();
  assert.ok(!/checkUserTaskLock/.test(body), '问答链路在检查用户串行锁');
});

// ---------------- B) 跳过生成侧校验 ----------------
console.log('\n-- B. 跳过生成侧校验 --');

t('★★ 问答跳过输入物校验（否则纯问答被拒）', () => {
  // validateAgentInput 要求最小长度，且部分智能体 requiresArtifact ——
  // 用户问「这个需求该怎么测」既短又没有交付物，必然被拒
  const idx = SERVER.indexOf('const validation = options.mode === \'ask\'');
  assert.ok(idx > 0, '输入物校验没按问答模式跳过');
  const around = SERVER.slice(idx, idx + 320);
  assert.ok(/问答模式跳过输入物校验/.test(around), '跳过逻辑没有说明');
  assert.ok(/validateAgentInput\(agentId, taskInput, previousArtifacts\)/.test(around),
    '非问答模式仍应走原校验');
});

t('★★ 问答跳过证据绑定（否则报告/缺陷类智能体拒绝回答）', () => {
  const idx = SERVER.indexOf("options.mode === 'ask'", SERVER.indexOf('const evidenceBinding'));
  assert.ok(idx > 0, '证据绑定没按问答模式跳过');
  const around = SERVER.slice(idx - 200, idx + 200);
  assert.ok(/validateEvidenceBinding/.test(around), '非问答模式仍应走证据绑定');
});

t('★ 问答模式的开关由调用方显式传入（不能靠猜）', () => {
  const body = askHandler();
  assert.ok(/\{ mode: 'ask' \}/.test(body), '调用 spawn 时没传 mode: ask');
});

// ---------------- C) 提示词压制 ----------------
console.log('\n-- C. 提示词压制交付物模板 --');

t('★★ 问答模式明确禁止输出完整交付物', () => {
  const idx = SERVER.indexOf("options.mode === 'ask'", SERVER.indexOf('let baseSystem'));
  assert.ok(idx > 0, '系统提示词没按问答模式调整');
  const block = SERVER.slice(idx, idx + 900);
  assert.ok(/问答模式/.test(block), '没说明这是问答模式');
  assert.ok(/不要输出完整交付物|不要套用上面的交付物模板/.test(block), '没禁止输出交付物');
});

t('问答模式不追加「用表格表达结构化数据」的 Excel 提示', () => {
  // 那条提示是为生成 Excel 交付物服务的，在问答里会诱导模型输出成表格文档
  const idx = SERVER.indexOf("_agentType !== 'reviewer' && options.mode !== 'ask'");
  assert.ok(idx > 0, '问答模式仍会追加 Excel 表格提示');
});

// ---------------- D) SSE 隔离 ----------------
console.log('\n-- D. SSE 用户隔离 --');

t('★★ 问答的 chat_message 全部带顶层 userId（否则广播给所有人）', () => {
  const body = askHandler();
  const broadcasts = body.split('sseBroadcast(').length - 1;
  const withUid = body.split('userId,').length - 1;
  assert.ok(broadcasts >= 4, `问答链路只有 ${broadcasts} 处广播，预期至少 4 处（用户消息/开始回答/最终回答/失败）`);
  assert.ok(withUid >= broadcasts - 1, `广播 ${broadcasts} 处但只有 ${withUid} 处带 userId`);
});

t('★ 问答事件带 taskId（sseBroadcast 对任务类事件强制要求可归属）', () => {
  const body = askHandler();
  assert.ok(/taskId: askId/.test(body), '广播没带 taskId，会被 ISO 拦截或当全局事件');
  assert.ok(/askId/.test(body), '没把 askId 透给前端');
});

t('★ 流式回调复用 agent_stream_* 协议（前端面板零改动）', () => {
  const body = askHandler();
  assert.ok(/streamCb/.test(body), '没有流式回调');
  assert.ok(/sseBroadcast\(\{ \.\.\.event, userId, taskId: askId/.test(body),
    '流式事件没补 userId/taskId，会被隔离拦掉');
});

// ---------------- E) 追问上下文 ----------------
console.log('\n-- E. 追问上下文 --');

t('★ 支持继续追问（askId 会话保留历史）', () => {
  const body = askHandler();
  assert.ok(/continueAskId/.test(body), '不支持续问');
  assert.ok(/askSessions\.set/.test(body), '没有保存问答会话');
  assert.ok(/buildAskHistoryBlock/.test(body), '没把历史拼进提示词');
});

t('★★ 不能读到别人的问答会话（越权风险）', () => {
  const body = askHandler();
  const idx = body.indexOf('const prev = continueAskId');
  assert.ok(idx > 0, '找不到续问取会话的代码');
  const block = body.slice(idx, idx + 300);
  assert.ok(/prev\.userId === userId/.test(block), '续问没校验会话归属，可能读到他人的对话');
});

t('会话有回收机制（不能无限增长占内存）', () => {
  assert.ok(/ASK_SESSION_TTL_MS/.test(SERVER), '缺会话过期时间');
  assert.ok(/askSessions\.delete/.test(SERVER), '没有清理逻辑');
  assert.ok(/setInterval/.test(SERVER.slice(SERVER.indexOf('ASK_SESSION_TTL_MS'), SERVER.indexOf('ASK_SESSION_TTL_MS') + 600)),
    '没有定时清理');
});

t('历史长度有上限（长对话不撑爆上下文）', () => {
  assert.ok(/ASK_HISTORY_LIMIT/.test(SERVER), '缺历史条数上限');
  assert.ok(/slice\(-ASK_HISTORY_LIMIT/.test(SERVER), '历史没截断');
});

// ---------------- F) 前端接线 ----------------
console.log('\n-- F. 前端接线 --');

t('★ api 层有 ask 方法且不复用任务创建接口', () => {
  assert.ok(/async ask\(/.test(API), '缺 taskApi.ask');
  const idx = API.indexOf('async ask(');
  const body = API.slice(idx, idx + 700);
  assert.ok(/\/api\/ask/.test(body), '没打到 /api/ask');
  assert.ok(!/\/api\/tasks'/.test(body), 'ask 打到了任务创建接口');
});

t('★★ 提交框遇到提问改走问答（不创建任务）', () => {
  assert.ok(/shouldAskInsteadOfGenerate/.test(VIEW), '提交框没有提问分流');
  const idx = VIEW.indexOf('if (shouldAskInsteadOfGenerate(taskInputValue');
  assert.ok(idx > 0, '没有在 handleSendTask 里分流');
  const block = VIEW.slice(idx, idx + 200);
  assert.ok(/submitAsQuestion/.test(block), '分流后没调用问答');
  // 分流必须在创建任务之前
  const createIdx = VIEW.indexOf('store.createTask(targetAgentId, fullMessage');
  assert.ok(createIdx > idx, '先创建了任务才判断是否提问');
});

t('★ 有明确产出动作时不误判为提问（不能把生成任务变成问答）', () => {
  const idx = VIEW.indexOf('function shouldAskInsteadOfGenerate');
  const body = VIEW.slice(idx, idx + 900);
  assert.ok(/hasAction/.test(body), '没有产出动作判断');
  // 这些词都表示要产出
  for (const kw of ['生成', '设计', '分析', '执行', '整理']) {
    assert.ok(body.includes(kw), `缺产出动作词「${kw}」`);
  }
  assert.ok(/return isQuestion && !hasAction/.test(body), '最终判定必须是「是提问且无产出动作」');
});

t('★★ 提问/产出的判定在真实语料上全部正确', () => {
  // 把前端函数抽出来直接跑（去掉 TS 类型标注）
  const start = VIEW.indexOf('function shouldAskInsteadOfGenerate');
  assert.ok(start > 0, '找不到判定函数');
  const end = VIEW.indexOf('\n}', start) + 2;
  const src = VIEW.slice(start, end).replace('(text: string, hasFiles = false): boolean', '(text, hasFiles = false)');
  const fn = new Function(src + '; return shouldAskInsteadOfGenerate;')();

  const cases = [
    // [输入, 是否带附件, 期望：true=走问答]
    ['这个需求该怎么测才好', false, true],     // 实测漏判过：「怎么测」不在原正则里
    ['为什么这条用例没有预期结果？', false, true],
    ['有什么遗漏吗', false, true],             // 实测漏判过：只有句尾「吗」
    ['这个接口是不是有问题', false, true],
    ['这样对吗', false, true],
    ['帮我生成登录功能的测试用例', false, false],
    ['对这个系统做接口测试', false, false],
    ['为什么没覆盖到，重新生成一遍', false, false],  // 有「重新生成」，是产出
    ['分析一下这个缺陷的根因', false, false],
    ['整理一份测试报告', false, false],
    ['把这个改成 200', false, false],
    ['帮我看看这份文档', true, false],         // 带附件按生成处理才安全
  ];
  for (const [text, hasFiles, want] of cases) {
    const got = fn(text, hasFiles);
    assert.strictEqual(got, want, `「${text}」判成了${got ? '问答' : '生成'}，应为${want ? '问答' : '生成'}`);
  }
});

t('前端保存 askId 供下一轮追问', () => {
  assert.ok(/lastAskId/.test(VIEW), '没保存 askId');
  assert.ok(/continueAskId: lastAskId\.value/.test(VIEW), '追问没带上 askId');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
