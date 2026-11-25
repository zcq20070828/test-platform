/**
 * 对话模式不能注入「上一份任务」（2026-11-25）
 *
 * 用户提醒：「还有一个『继续对话』，这个时候可能不是最近执行的任务，要考虑到这一点」。
 *
 * 问题：spawnAgentSession 里有一段逻辑——如果输入像「继续/优化」这类指代，
 * 就去找「当前任务之外最近的一个任务」，把它的需求原文注入进来。
 * 这在**新建任务**时是对的（用户想接着上次的活干），
 * 但在**对话模式**下是错的：
 *
 *   - 对话模式的上下文是确定的：就是当前 task.id，
 *     buildChatContinuationInput 已经带了它的完整交付物与历史对话。
 *   - 再去找「最近的那个任务」，会把**另一个任务**的需求原文注进来，
 *     于是模型拿着任务 B 的需求去改任务 A 的交付物。
 *
 * 修法：对话轮调用 spawnAgentSession 时传 { mode: 'chat' }，
 * 该分支明确跳过「上一份任务」注入。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ❌ ${name} :: ${e.message}`);
  }
}

console.log('=== 对话模式不注入上一份任务 单元测试 ===');

/** 取 spawnAgentSession 里「引用任务 / 对话模式 / 新建任务」三段分派 */
function dispatchBlock() {
  const start = SERVER.indexOf('const referenced = upstreamInjected');
  assert.ok(start > 0, '找不到分派逻辑');
  const end = SERVER.indexOf('// ========== 熔断器检查 ==========', start);
  assert.ok(end > start, '找不到分派结束');
  return SERVER.slice(start, end);
}

t('对话模式传了 mode: chat', () => {
  // executeChatRound 里必须显式标记这是对话轮
  assert.ok(/spawnAgentSession\(task\.agent, chatInput, task\.id, null, true, \[\], task\.userId \|\| null, false,\s*\{ mode: 'chat' \}\)/.test(SERVER),
    '对话轮没有传 mode: chat，会走「上一份任务」注入');
});

t('对话模式分支存在且明确跳过注入', () => {
  const block = dispatchBlock();
  assert.ok(/options\.mode === 'chat'/.test(block), '缺少对话模式分支');
  assert.ok(/跳过「上一份任务」注入/.test(block), '缺少跳过说明');
});

t('对话模式分支里不调用 enrichInputWithRecentContext', () => {
  const block = dispatchBlock();
  // 取出 chat 分支到 else 之间
  const chatStart = block.indexOf("options.mode === 'chat'");
  const elseStart = block.indexOf('// 新建任务：没显式引用 UUID 时', chatStart);
  assert.ok(chatStart > 0 && elseStart > chatStart, '找不到分支边界');
  const chatBranch = block.slice(chatStart, elseStart);
  assert.ok(!/enrichInputWithRecentContext\s*\(/.test(chatBranch),
    '对话分支仍在调 enrichInputWithRecentContext，会把别的任务需求注入进来');
});

t('新建任务分支仍会调用（原功能不丢）', () => {
  const block = dispatchBlock();
  const elseStart = block.indexOf('// 新建任务：没显式引用 UUID 时');
  const newBranch = block.slice(elseStart);
  assert.ok(/enrichInputWithRecentContext\s*\(/.test(newBranch),
    '新建任务的「继续」功能被误删了');
});

t('对话模式的上下文来源是当前任务本身', () => {
  // buildChatContinuationInput 要带当前交付物
  const start = SERVER.indexOf('function buildChatContinuationInput');
  assert.ok(start > 0, '找不到 buildChatContinuationInput');
  const end = SERVER.indexOf('function ', start + 40);
  const fn = SERVER.slice(start, end > start ? end : start + 6000);
  assert.ok(/currentDeliverable/.test(fn), '未使用当前任务交付物');
  // 实参必须传 currentDeliverable
  assert.ok(/buildChatContinuationInput\(task, message, userFileContents, chatHistory, intent, currentDeliverable\)/.test(SERVER),
    '调用时没传当前交付物，对话上下文不完整');
});

t('在任务 A 的对话里不会被注入任务 B 的需求', () => {
  // 这是本条修复要防的具体症状：断言「排除当前任务」的那行代码
  // 只在新建任务路径上生效，对话路径不能到达它
  const block = dispatchBlock();
  const chatStart = block.indexOf("options.mode === 'chat'");
  const elseStart = block.indexOf('// 新建任务：没显式引用 UUID 时', chatStart);
  const chatBranch = block.slice(chatStart, elseStart);
  // extractRecent 内部按 `t.id !== currentTaskId` 找别的任务，
  // 对话分支不该触达这段。注释里提到这句是允许的（我们在那里写了原因），
  // 所以只看生效代码。
  const code = chatBranch.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/currentTaskId/.test(code), '对话分支涉及了「别的任务」的查找');
});

t('ask 模式（/api/ask）也不受影响', () => {
  // 问答模式本来就跳过证据绑定，也不该注入上一份任务
  const start = SERVER.indexOf('async function spawnAgentSession');
  const block = SERVER.slice(start, start + 8000);
  assert.ok(/options\.mode === 'ask'/.test(block), 'ask 模式的分支丢失');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
