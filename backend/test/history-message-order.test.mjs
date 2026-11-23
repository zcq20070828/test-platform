#!/usr/bin/env node
/**
 * Dashboard 历史消息必须按时间排好（2026-11-23）
 *
 * 用户反馈：「前端dashboard里显示的最新消息的时间不对，还是上周五下午四点多的」，
 * 截图是「用例质量门禁 … 16:37:41」。
 *
 * 排查结果：时间显示本身是对的（16:37:41 确实是 11-20 那天的真实事件），
 * 错的是**消息排列顺序**：
 *
 *   loadRecentTaskResults 按「任务完成时间倒序」遍历（最新在前），
 *   但对每个任务的过程时间线直接 `messages.value.push(...)` 追加到末尾。
 *   于是循环里最后处理的那个（= 最旧的任务）的事件落在列表最底部，
 *   用户滚动到底看到的就是上周的门禁消息，误以为「最新消息停在几天前」。
 *
 * 实测数据（今天已有 09:10 / 09:22 两个新任务）：
 *   倒序遍历：c1e6dc32(11-23 09:27) → b1d3ecca(11-23 09:19) → 3164b853(11-20 17:25)
 *             → 5d1f488c(11-20 16:43) → 10b26fa7(11-20 16:38)
 *   push 追加后：底部是 10b26fa7 的 16:38 ← 正是截图看到的那条
 *
 * 另一个隐藏 bug：时间线为空时合成的「历史执行过程」摘要用了
 * `timestamp: new Date().toISOString()`，会让几天前的旧任务显示成「刚刚执行」，
 * 并因为时间最新被排到列表最底部。
 *
 * 本文件验证：排序工具本身正确、所有恢复路径都走它、兜底摘要用任务真实时间。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 历史消息按时间排序 ===');

/** 抽出 insertMessagesByTime 并可执行 */
function loadInserter() {
  const start = STORE.indexOf('function insertMessagesByTime');
  assert.ok(start > 0, '找不到 insertMessagesByTime');
  const end = STORE.indexOf('\n  }', start) + 4;
  const src = STORE.slice(start, end)
    .replace('(incoming: ChatMessage[])', '(incoming)')
    .replace(/\(m: any\)/g, '(m)')
    .replace(/ as any/g, '');
  const bucket = { value: [] };
  const fn = new Function('messages', `${src}; return insertMessagesByTime;`)(bucket);
  return { insert: fn, bucket };
}

// ---------------- A) 排序工具 ----------------
console.log('\n-- A. 排序工具 --');

t('★★ 倒序遍历任务、逐条插入后，最新的在最下面（复现并修复截图症状）', () => {
  const { insert, bucket } = loadInserter();
  // 真实数据：与库里最近 5 个任务的完成时间一致
  const tasks = [
    { id: 'c1e6dc32', time: '2026-11-23T09:27:17+08:00' },
    { id: 'b1d3ecca', time: '2026-11-23T09:19:38+08:00' },
    { id: '3164b853', time: '2026-11-20T17:25:08+08:00' },
    { id: '5d1f488c', time: '2026-11-20T16:43:09+08:00' },
    { id: '10b26fa7', time: '2026-11-20T16:38:28+08:00' },
  ];
  for (const tk of tasks) {
    insert([{ id: `loaded-task-${tk.id}`, content: 'x', timestamp: tk.time, isStreaming: false }]);
  }
  const ids = bucket.value.map((m) => m.id.replace('loaded-task-', ''));
  assert.deepStrictEqual(ids, ['10b26fa7', '5d1f488c', '3164b853', 'b1d3ecca', 'c1e6dc32'],
    `排序结果不对：${ids.join(' → ')}`);
  const last = bucket.value[bucket.value.length - 1].timestamp;
  assert.ok(last.startsWith('2026-11-23T09:27'), `底部不是最新任务（${last}）`);
});

t('★ 乱序插入也能得到正确顺序（不依赖调用方按序传入）', () => {
  const { insert, bucket } = loadInserter();
  const times = ['2026-11-23T09:19:38+08:00', '2026-11-20T16:38:28+08:00', '2026-11-23T09:27:17+08:00', '2026-11-20T17:25:08+08:00'];
  for (const ts of times) insert([{ id: `m-${ts}`, content: 'x', timestamp: ts, isStreaming: false }]);
  const got = bucket.value.map((m) => m.timestamp);
  const sorted = [...got].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  assert.deepStrictEqual(got, sorted, `插入后未按时间升序：${got.join(' | ')}`);
});

t('★ 流式消息固定在末尾（历史不能被插到正在输出的消息后面）', () => {
  const { insert, bucket } = loadInserter();
  bucket.value.push({ id: 'streaming', content: '正在输出…', timestamp: new Date().toISOString(), isStreaming: true });
  insert([{ id: 'old', content: 'x', timestamp: '2026-11-20T16:38:28+08:00', isStreaming: false }]);
  insert([{ id: 'new', content: 'x', timestamp: new Date(Date.now() + 60000).toISOString(), isStreaming: false }]);
  const ids = bucket.value.map((m) => m.id);
  assert.strictEqual(ids[ids.length - 1], 'streaming', `流式消息被挤走了：${ids.join(',')}`);
});

t('时间无法解析时追加到末尾而不是丢弃（不能因为格式问题丢消息）', () => {
  const { insert, bucket } = loadInserter();
  insert([{ id: 'bad', content: 'x', timestamp: 'not-a-date', isStreaming: false }]);
  assert.strictEqual(bucket.value.length, 1, '时间不可解析的消息被丢掉了');
});

t('比所有历史都早的消息插到最前面', () => {
  const { insert, bucket } = loadInserter();
  insert([{ id: 'mid', content: 'x', timestamp: '2026-11-20T16:38:28+08:00', isStreaming: false }]);
  insert([{ id: 'older', content: 'x', timestamp: '2026-11-19T10:00:00+08:00', isStreaming: false }]);
  assert.strictEqual(bucket.value[0].id, 'older', `最早的消息没排到最前：${bucket.value.map((m) => m.id).join(',')}`);
});

// ---------------- B) 所有恢复路径都走它 ----------------
console.log('\n-- B. 恢复路径统一 --');

t('★★ 时间线重放不再直接 push（这是截图症状的直接原因）', () => {
  const start = STORE.indexOf('async function restoreTaskTimeline');
  const end = STORE.indexOf('async function loadRecentTaskResults', start);
  const body = STORE.slice(start, end);
  assert.ok(/insertMessagesByTime\(collected\)/.test(body), '时间线重放没走按时间插入');
  assert.ok(!/messages\.value\.push\(msg\)/.test(body), '时间线仍在直接 push（会排到最底部）');
});

t('★★ 交付物消息也走按时间插入', () => {
  const start = STORE.indexOf('async function loadRecentTaskResults');
  const body = STORE.slice(start, start + 6000);
  assert.ok(/insertMessagesByTime\(\[\{/.test(body), '交付物消息没走按时间插入');
  assert.ok(!/messages\.value\.push\(\{\s*\n\s*id: `loaded-task-/.test(body), '交付物消息仍在直接 push');
});

t('★★ 兜底摘要用任务真实时间，不用 new Date()', () => {
  const start = STORE.indexOf('async function restoreTaskTimeline');
  const end = STORE.indexOf('async function loadRecentTaskResults', start);
  const body = STORE.slice(start, end);
  assert.ok(/const taskTime = /.test(body), '兜底摘要没用任务时间');
  assert.ok(/data\.task\?\.completedAt/.test(body), '没从接口取任务完成时间');
  // 摘要消息的 timestamp 必须用 taskTime
  const idx = body.indexOf('id: summaryId');
  const around = body.slice(idx, idx + 600);
  assert.ok(/timestamp: taskTime/.test(around), '摘要消息仍用 new Date()，会把旧任务显示成刚刚执行');
});

t('★ 后端 timeline 接口返回任务时间（前端才有得用）', () => {
  const start = SERVER.indexOf("app.get('/api/tasks/:id/timeline'");
  assert.ok(start > 0, '找不到 timeline 接口');
  const body = SERVER.slice(start, start + 2000);
  assert.ok(/task: \{/.test(body), '接口没返回 task 字段');
  assert.ok(/completedAt: task\.completedAt \|\| task\.completed_at/.test(body), '没返回完成时间');
  assert.ok(/createdAt: task\.createdAt \|\| task\.created_at/.test(body), '没返回创建时间');
});

t('★ 没有「用当前时间冒充历史消息」的残留', () => {
  const start = STORE.indexOf('async function restoreTaskTimeline');
  const end = STORE.indexOf('async function loadRecentTaskResults', start);
  const body = STORE.slice(start, end);
  // 允许 timestamp 作为兜底出现在 ?? / || 链尾，但不能直接赋值 new Date()
  assert.ok(!/timestamp: new Date\(\)\.toISOString\(\)/.test(body),
    '仍有消息用 new Date() 当时间戳，历史消息会被显示成刚刚');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
