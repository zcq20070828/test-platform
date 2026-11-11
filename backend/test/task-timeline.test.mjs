#!/usr/bin/env node
/**
 * 任务时间线单元测试（2026-11-11）
 *
 * 这组测试守的是「过程信息不能只活在内存里」这条约定：
 * 门禁结果、审核评分、定向修复轮次过去只由前端写进内存数组，
 * 任务结束或刷新后全部丢失，用户看到的就是「实时信息不完整」。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 任务时间线 单元测试 ===');

const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'task-timeline-dao.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
const SCHEMA = (() => {
  const p = path.join(ROOT, 'database', '09-task-timeline.sql');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
})();

t('迁移脚本存在且幂等', () => {
  assert.ok(SCHEMA.includes('CREATE TABLE IF NOT EXISTS `task_timeline_events`'), '缺少建表语句');
  assert.ok(SCHEMA.includes('uk_task_seq'), '缺少任务内序号唯一键（并发写要靠它防重复 seq）');
});

t('记录白名单覆盖过程类事件', () => {
  for (const evt of [
    'case_quality_gate', 'case_quality_repair', 'rule_quality_gate',
    'reviewer_started', 'reviewer_completed', 'task_review_retry',
    'task_review_exhausted', 'step_review_completed', 'task_error',
  ]) {
    assert.ok(DAO.includes(`'${evt}'`), `白名单缺少 ${evt}`);
  }
});

t('流式 chunk 不进白名单（高频，会撑爆表）', () => {
  assert.ok(!DAO.includes("'agent_stream_chunk'"), 'agent_stream_chunk 不应落盘');
});

t('单条负载有上限且截断后仍是合法 JSON', () => {
  assert.ok(/MAX_PAYLOAD_CHARS/.test(DAO), '缺少负载上限常量');
  assert.ok(/_truncated: true/.test(DAO), '截断时应标注 _truncated');
  assert.ok(/_originalSize/.test(DAO), '截断时应保留原始长度');
});

t('写失败只 warn 不抛（时间线是附属能力）', () => {
  const idx = DAO.indexOf('catch (e) {');
  assert.ok(idx > 0);
  const block = DAO.slice(idx, idx + 220);
  assert.ok(/console\.warn/.test(block), '写入失败必须 warn');
  assert.ok(/return null/.test(block), '写入失败必须返回 null 而不是抛');
});

t('broadcast 在广播后落盘，且只对白名单类型动手', () => {
  assert.ok(SERVER.includes('TIMELINE_EVENT_TYPES.has(message.type)'), 'broadcast 未按白名单过滤');
  const bIdx = SERVER.indexOf('sseBroadcast(message);');
  const tIdx = SERVER.indexOf('appendTimelineEvent({');
  assert.ok(bIdx > 0 && tIdx > bIdx, '落盘应在广播之后（先保证实时性，再持久化）');
});

t('存在按 seq 读取的接口，且校验任务归属', () => {
  assert.ok(/app\.get\('\/api\/tasks\/:id\/timeline'/.test(SERVER), '缺少 timeline 接口');
  const route = SERVER.slice(SERVER.indexOf("app.get('/api/tasks/:id/timeline'"));
  const body = route.slice(0, 1600);
  assert.ok(/canAccessTask\(task, req\)/.test(body), 'timeline 接口必须校验任务归属');
  assert.ok(/getTaskTimeline\(taskId/.test(body), 'timeline 接口必须读时间线');
});

t('接口对历史任务给兜底数据（审核历史 + 门禁快照）', () => {
  const route = SERVER.slice(SERVER.indexOf("app.get('/api/tasks/:id/timeline'"));
  const body = route.slice(0, 1600);
  assert.ok(/getReviewHistory\(taskId\)/.test(body), '缺少审核历史兜底');
  assert.ok(/getTaskQuality\(taskId\)/.test(body), '缺少门禁快照兜底');
});

t('前端有把时间线事件还原成消息的纯函数', () => {
  assert.ok(/function timelineEventToMessage/.test(STORE), '缺少时间线→消息转换函数');
  for (const kind of ["case 'reviewer_completed'", "case 'case_quality_gate'", "case 'case_quality_repair'", "case 'rule_quality_gate'"]) {
    assert.ok(STORE.includes(kind), `转换函数缺少 ${kind}`);
  }
});

t('恢复历史任务时会重放时间线', () => {
  const fn = STORE.slice(STORE.indexOf('async function loadRecentTaskResults'));
  const body = fn.slice(0, fn.indexOf('async function createTask'));
  assert.ok(/restoreTaskTimeline\(taskId/.test(body), 'loadRecentTaskResults 未调用 restoreTaskTimeline');
});

t('重放与实时对「审核失败」用同一口径', () => {
  // score=0 且带 error 是「审核自己没跑起来」，不是模型打 0 分
  assert.ok(/未跑出结果/.test(STORE), '缺少「未跑出结果」文案');
  // 第一处是时间线重放 helper，实时链路在后面（lastIndexOf）
  const realtime = STORE.slice(STORE.lastIndexOf("case 'reviewer_completed'"));
  assert.ok(/reviewerFailed/.test(realtime.slice(0, 700)), '实时链路未区分审核失败');
});

t('时间线为空时有摘要兜底（历史任务也能看到三轮评分）', () => {
  assert.ok(/events\.length === 0/.test(STORE), '缺少时间线为空的兜底分支');
  assert.ok(/历史执行过程/.test(STORE), '缺少历史执行过程摘要');
});


// ---------------- 并发写入（2026-11-11）----------------
// 踩过的坑：broadcast 是同步函数，一个任务在一次工具循环里会连推好几条事件，
// 各自独立算 seq 会全撞同一个值。实测并发 20 条只进 9 条，时间线缺事件。
t('同任务写入按 taskId 串行（不用 INSERT...SELECT，也不用裸并发）', () => {
  assert.ok(/taskWriteQueues/.test(DAO), '缺少按任务的写入队列');
  assert.ok(/function enqueue/.test(DAO), '缺少入队函数');
  // INSERT ... SELECT MAX(seq) 在 MariaDB 并发下会报
  // 「Failed to read auto-increment value from storage engine」，绝不能用
  assert.ok(!/INSERT INTO task_timeline_events[\s\S]{0,200}SELECT\s+\?,\s*COALESCE\(MAX/s.test(DAO),
    '不允许 INSERT ... SELECT MAX(seq) 写法');
});

t('seq 用独立 SELECT 算，冲突只 warn', () => {
  assert.ok(/SELECT COALESCE\(MAX\(seq\), 0\) \+ 1 AS nextSeq/.test(DAO), 'seq 应由独立 SELECT 计算');
  assert.ok(/事件落盘失败/.test(DAO), '写入失败要 warn');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
