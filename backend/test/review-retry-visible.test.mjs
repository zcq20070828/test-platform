#!/usr/bin/env node
/**
 * 审核重试可见性 单元测试（2026-11-11）
 *
 * 用户反馈「审核不通过的时候没有重试」。后端其实一直在重试
 * （实测任务 590f 有 3 轮 attempt，分数 65/0/62 → 68/65/72 → 72/73/0），
 * 但前端把这三条链路全断了：
 *
 *   1) task_review_retry / task_review_started / task_review_failed / task_error
 *      只给局部变量 message/status 赋值，从不调用 writeMsg；
 *   2) message/status 唯一的消费方是 realtimeLogs，而没有任何面板渲染它；
 *   3) reviewer_started / reviewer_completed 的消息 id 不含轮次，
 *      三轮 id 完全相同，v-for :key 冲突，看起来像「一次都没重试」。
 *
 * 这组测试守住这四个断点。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

function realtimeCase(name) {
  const start = STORE.lastIndexOf(`case '${name}':`);
  if (start < 0) return '';
  const rest = STORE.slice(start + 10);
  const next = rest.search(/\n      case '/);
  return next < 0 ? rest : rest.slice(0, next);
}

const checks = [];
const ok = (label, cond) => checks.push([label, !!cond]);

for (const evt of ['task_review_retry', 'task_review_failed', 'task_review_started']) {
  const body = realtimeCase(evt);
  ok(`${evt} 写进消息`, /writeMsg\(/.test(body));
  // id 必须唯一且带轮次：现在统一走 eventMsgId(prefix, 轮次)
  ok(`${evt} id 带轮次`, /eventMsgId\([^)]*attempt|eventMsgId\([^)]*retry/.test(body));
}
// task_error 不属于审核轮次，只要求能显示且 id 稳定（同一任务同一错误不重复）
ok('task_error 写进消息', /writeMsg\(/.test(realtimeCase('task_error')));

for (const evt of ['reviewer_started', 'reviewer_completed']) {
  const body = realtimeCase(evt);
  ok(`${evt} id 含 attempt`, /eventMsgId\([^)]*attempt/.test(body));
  ok(`${evt} 文案标轮次`, /roundTag/i.test(body));
}

ok('后端 reviewer_started 带 attempt', /attempt: retryCount/.test(SERVER));
ok('后端 task_review_failed 带 willRetry', /willRetry: retryCount \+ 1 < MAX_RETRIES/.test(SERVER));
ok('后端 task_review_retry 带 maxRetries', /maxRetries: MAX_RETRIES/.test(SERVER));
ok('时间线 reviewer_completed 标轮次', /tl-reviewer-done[\s\S]{0,500}roundTag/.test(STORE));
ok('时间线有 task_review_failed', /case 'task_review_failed':[\s\S]{0,800}tl-review-failed/.test(STORE));
ok('时间线白名单含 reviewer_failed', fs.readFileSync(path.join(ROOT, 'backend', 'database', 'task-timeline-dao.js'), 'utf8').includes("'reviewer_failed'"));

let fail = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? '✅' : '❌'} ${label}`);
  if (!pass) fail += 1;
}

// ---------------- 跨轮次 id 冲突 & 长静默（2026-11-11 第二轮）----------------
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'task-timeline-dao.js'), 'utf8');

ok('门禁消息 id 用 _eid 唯一化（round 每轮重置会撞 id）', /id: eventMsgId\('case-gate'/.test(STORE));
ok('修复消息 id 用 _eid 唯一化', /id: eventMsgId\('case-repair'/.test(STORE));
ok('审核员消息 id 用 _eid 唯一化', /eventMsgId\('reviewer-started'/.test(STORE) && /eventMsgId\('reviewer-completed'/.test(STORE));
ok('eventMsgId 优先取后端 _eid', /const eid = \(data as any\)\?\._eid/.test(STORE));
ok('无 _eid 时有时间戳+随机兜底', /Date\.now\(\)\}-\$\{Math\.random/.test(STORE));

ok('定向修复每批广播进度', /case_quality_repair_progress/.test(SERVER));
ok('修复进度在批次完成时发出（不等全部结束）', /reportBatchProgress\(bi, true\)/.test(SERVER));
ok('审核员调用期间发心跳', /reviewer_heartbeat/.test(SERVER) && /reviewHeartbeat/.test(SERVER));
ok('心跳在成功与失败路径都清理', (SERVER.match(/clearInterval\(reviewHeartbeat\)/g) || []).length >= 2);

ok('心跳不落盘（13分钟×20秒会淹掉时间线）', !DAO.includes("'reviewer_heartbeat'"));
ok('修复进度落盘（过程信息要能回放）', DAO.includes("'case_quality_repair_progress'"));
ok('前端渲染修复进度', /case 'case_quality_repair_progress'/.test(STORE));
ok('前端渲染审核心跳', /case 'reviewer_heartbeat'/.test(STORE));
ok('时间线重放修复进度', /tl-repair-progress/.test(STORE));
console.log(`\n结果：${checks.length - fail} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
