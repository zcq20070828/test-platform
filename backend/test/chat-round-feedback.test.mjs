#!/usr/bin/env node
/**
 * 「继续对话」过程反馈 单元测试（2026-11-19）
 *
 * 用户反馈：继续对话时不输出实时信息。
 *
 * 代码级原因（三个）：
 *   1. executeChatRound 只在 `if (text)` 里广播 —— spawnAgentSession 失败时返回
 *      { success:false, error }，没有 text，于是 402/超时/熔断这些失败**完全静默**，
 *      用户只看到自己那条消息，以为没发出去（实测就是余额不足 402）。
 *   2. chat 轮次没有任何阶段事件。普通任务有 task_started/task_progress/门禁/三审，
 *      chat 轮只有末尾一条 chat_message，模型慢的时候界面一直停在用户消息。
 *   3. 修订后的交付物既不显示质量检查结果，也看不到"这版比上版好还是差"。
 *
 * 另外顺手修了：chat 轮的产出会覆盖任务初次交付的质量快照，
 * 导致任务详情页的可用率随每次改稿漂移。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

/** executeChatRound 函数体 */
const CHAT_FN = (() => {
  const start = SERVER.indexOf('async function executeChatRound');
  const end = SERVER.indexOf("app.post('/api/tasks/:id/chat'");
  return SERVER.slice(start, end);
})();

console.log('=== 「继续对话」过程反馈 单元测试 ===');

// ---------------- 失败必须播报 ----------------
t('显式判断 result.success === false', () => {
  assert.ok(/result && result\.success === false/.test(CHAT_FN), '缺少失败分支判断');
});

t('失败时广播到聊天面板（不是只写日志）', () => {
  assert.ok(/本轮修订失败/.test(CHAT_FN), '缺少失败文案');
  const failBlock = CHAT_FN.slice(CHAT_FN.indexOf('result.success === false'));
  assert.ok(/type: 'chat_message'/.test(failBlock.slice(0, 1200)), '失败分支未广播 chat_message');
});

t('失败也要写入 chat_history（避免下一轮误判成功）', () => {
  assert.ok(/\[本轮失败\]/.test(CHAT_FN), '失败未记入对话历史');
});

t('失败分支在取 text 之前 return（不会走到成功逻辑）', () => {
  const failIdx = CHAT_FN.indexOf('result.success === false');
  const textIdx = CHAT_FN.indexOf("const text = result && result.text");
  assert.ok(failIdx > 0 && textIdx > failIdx, '失败分支应在取 text 之前');
  const between = CHAT_FN.slice(failIdx, textIdx);
  assert.ok(/return;/.test(between), '失败分支必须 return');
});

// ---------------- 阶段反馈 ----------------
t('chat 轮开始有进度提示', () => {
  assert.ok(/正在按对话指令修订交付物/.test(CHAT_FN), '缺少开始提示');
});

t('进度提示走 chat_message（前端唯一会渲染的通道）', () => {
  // task_progress 只更新任务列表状态，不写入聊天面板 —— 用它等于没提示
  const idx = CHAT_FN.indexOf('正在按对话指令修订交付物');
  const around = CHAT_FN.slice(Math.max(0, idx - 400), idx + 200);
  assert.ok(/type: 'chat_message'/.test(around), '进度提示未使用 chat_message');
  assert.ok(/role: 'system'/.test(around), '进度提示应为 system 角色');
});

// ---------------- 修订后质量反馈 ----------------
t('修订后跑确定性质量检查', () => {
  assert.ok(/checkCaseQuality\(candidate/.test(CHAT_FN), '缺少修订后质量检查');
});

t('修订后质量结果广播（用户能看出变好还是变差）', () => {
  assert.ok(/type: 'case_quality_gate'/.test(CHAT_FN), '未广播质量结果');
  assert.ok(/本轮修订后：/.test(CHAT_FN), '质量摘要未标注「本轮修订后」');
});

t('质量检查带维度覆盖信息（与普通任务一致）', () => {
  assert.ok(/dimensionCoverage: afterGate\.dimensions/.test(CHAT_FN), '缺少维度覆盖');
  assert.ok(/usabilityPass: afterGate\.usabilityPass/.test(CHAT_FN), '缺少可用率达标标记');
});

t('质量检查失败不阻断对话（try/catch 兜住）', () => {
  assert.ok(/\[Chat\] 本轮质量检查失败/.test(CHAT_FN), '质量检查异常未兜住');
});

// ---------------- 质量快照不被覆盖 ----------------
t('chat 前保存质量快照、跑完恢复', () => {
  assert.ok(/const prevQualitySnapshot = taskCaseQualityReports\.get\(task\.id\)/.test(CHAT_FN), '未保存快照');
  assert.ok(/if \(prevQualitySnapshot\) taskCaseQualityReports\.set\(task\.id, prevQualitySnapshot\)/.test(CHAT_FN),
    '未恢复快照');
});

// ---------------- 前端去重 ----------------
t('前端对 chat_message 与流式消息去重（同一份修订不显示两遍）', () => {
  const handler = STORE.slice(STORE.indexOf("case 'chat_message'"), STORE.indexOf("case 'agent_output'"));
  assert.ok(/role === 'assistant'/.test(handler), '去重只看 assistant 消息');
  assert.ok(/String\(m\.content \|\| ''\)\.trim\(\) === incoming\.trim\(\)/.test(handler), '缺少内容比对');
  assert.ok(/dup\.isStreaming = false/.test(handler), '命中重复应收尾而非追加');
});

t('前端仍能渲染 chat_message 与 case_quality_gate', () => {
  assert.ok(/case 'chat_message'/.test(STORE));
  assert.ok(/case 'case_quality_gate'/.test(STORE));
});

// ---------------- 回归：不能破坏正常路径 ----------------
t('成功路径仍保存交付物版本号并广播 chat_message', () => {
  assert.ok(/agentVerLabel/.test(CHAT_FN), '缺少版本号');
  assert.ok(/saveDeliverablesToFiles\(task\.id, 'chat'/.test(CHAT_FN), '缺少交付物落盘');
});

t('成功路径仍写入 chat_history', () => {
  assert.ok(/const updated = \(chatHistory \|\| \[\]\)\.concat\(entry\)/.test(CHAT_FN), '缺少历史写入');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
