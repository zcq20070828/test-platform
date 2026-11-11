/**
 * 任务时间线 DAO（2026-11-11）
 *
 * 解决的问题：门禁结果、三个审核员的评分、定向修复轮次这些「过程信息」
 * 只由前端写进内存数组，任务结束或刷新后全部丢失，用户看到的就是
 * 「实时信息不完整」。数据其实一直在库里（task_review_results、
 * task_quality_metrics），但没有任何接口按时间顺序把它们读回来。
 *
 * 这张表补的是「事件流」这一层：把任务级过程事件按 seq 落盘，刷新后重放。
 *
 * 写入策略：
 *   - 只记录白名单里的事件类型（见 RECORD_EVENT_TYPES），流式 chunk 这类高频事件不记；
 *   - 单条负载上限 MAX_PAYLOAD_BYTES，超出截断并记录原长度；
 *   - 失败只 warn 不抛，时间线是附属能力，不能因为它让主流程失败。
 */
import { query } from './db.js';

/** 需要落盘的事件类型（任务级过程信息，刷新后要能复原的那部分） */
export const RECORD_EVENT_TYPES = new Set([
  'task_started',
  'agent_started',
  'agent_completed',
  'agent_rejected',
  'agent_skill_result',
  'case_quality_gate',
  'case_quality_repair',
  'case_quality_repair_progress',
  'rule_quality_gate',
  'task_review_started',
  'reviewer_started',
  'reviewer_completed',
  'reviewer_failed',
  'task_review_failed',
  'task_review_retry',
  'task_review_exhausted',
  'task_review_passed',
  'step_passed',
  'step_failed',
  'step_review_completed',
  'task_completed',
  'task_error',
  'task_cancelled',
]);

/** 单条事件负载上限（字符）。审核输出一般 4~6KB，给足冗余但挡住异常膨胀 */
const MAX_PAYLOAD_CHARS = 200_000;

/**
 * 每个任务一条写入队列
 *
 * broadcast 是同步函数，一个任务在一次工具循环里会连续推好几条事件
 * （agent_skill_result ×3、case_quality_gate ×2…），它们几乎同时到达。
 * 如果各自独立算 seq，会全部 SELECT 到同一个值然后撞唯一键——
 * 实测并发 20 条只成功 9 条，剩下的被丢掉，时间线就缺事件。
 *
 * 所以按 taskId 串成 Promise 链：同一任务的写入严格串行，
 * seq 永远算在「上一条已提交之后」，不会互相覆盖。
 */
const taskWriteQueues = new Map();

/** 把一次写入排到该任务队的尾端 */
function enqueue(taskId, job) {
  const prev = taskWriteQueues.get(taskId) || Promise.resolve();
  const next = prev.then(job, job).catch(() => null);
  taskWriteQueues.set(taskId, next);
  // 队列跑完就清理，避免长期运行的进程累积 key
  next.finally(() => {
    if (taskWriteQueues.get(taskId) === next) taskWriteQueues.delete(taskId);
  });
  return next;
}

async function insertEvent(taskId, type, agentId, text, originalSize) {
  try {
    const rows = await query(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM task_timeline_events WHERE task_id = ?',
      [taskId],
    );
    const seq = Number(rows[0]?.nextSeq) || 1;
    await query(
      `INSERT INTO task_timeline_events (task_id, seq, type, agent_id, payload, original_size)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [taskId, seq, type, agentId, text, originalSize],
    );
    return seq;
  } catch (e) {
    // 表不存在（未跑迁移）或多进程撞唯一键都只 warn，不影响主流程
    console.warn(`[Timeline] 事件落盘失败 ${type}/${taskId}: ${e.message}`);
    return null;
  }
}

/**
 * 追加一条时间线事件
 *
 * ⚠️ 不要改回 `INSERT ... SELECT MAX(seq)+1 FROM 本表` 的写法：
 * MariaDB 并发下会报 `Failed to read auto-increment value from storage engine`，
 * 事件被静默丢弃（实测 12 条时间线里少了 reviewer-1/reviewer-2 的「开始审核」）。
 *
 * @param {Object} input
 * @param {string} input.taskId
 * @param {string} input.type
 * @param {string} [input.agentId]
 * @param {Object} input.payload - 原始事件对象
 * @returns {Promise<number|null>} 写入的 seq，失败返回 null
 */
export async function appendTimelineEvent({ taskId, type, agentId = null, payload }) {
  if (!taskId || !type) return null;

  let text = '';
  let originalSize = 0;
  try {
    text = JSON.stringify(payload || {});
    originalSize = text.length;
    if (text.length > MAX_PAYLOAD_CHARS) {
      // 截断后仍是合法 JSON：保留结构，把超长字段换成省略标记
      text = JSON.stringify({
        ...payload,
        _truncated: true,
        _originalSize: originalSize,
        output: typeof payload?.output === 'string'
          ? `${payload.output.slice(0, MAX_PAYLOAD_CHARS)}…[已截断]`
          : payload?.output,
      });
    }
  } catch (_) {
    return null;
  }

  return enqueue(taskId, () => insertEvent(taskId, type, agentId, text, originalSize));
}

/**
 * 读取任务时间线
 * @param {string} taskId
 * @param {Object} [options]
 * @param {number} [options.limit=200]
 * @param {number} [options.afterSeq=0]
 * @returns {Promise<Array<{seq:number,type:string,agentId:string|null,payload:object,createdAt:string}>>}
 */
export async function getTaskTimeline(taskId, { limit = 200, afterSeq = 0 } = {}) {
  if (!taskId) return [];
  const max = Math.max(1, Math.min(500, Number(limit) || 200));
  try {
    const rows = await query(
      `SELECT seq, type, agent_id, payload, created_at
         FROM task_timeline_events
        WHERE task_id = ? AND seq > ?
        ORDER BY seq ASC
        LIMIT ?`,
      [taskId, Number(afterSeq) || 0, max],
    );
    return rows.map((r) => {
      let payload = {};
      try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch (_) { payload = { _raw: true }; }
      return {
        seq: Number(r.seq),
        type: r.type,
        agentId: r.agent_id,
        payload,
        createdAt: r.created_at,
      };
    });
  } catch (e) {
    console.warn(`[Timeline] 读取失败 ${taskId}: ${e.message}`);
    return [];
  }
}

/** 某个任务的事件条数（用于前端判断是否需要重放） */
export async function countTaskTimeline(taskId) {
  try {
    const rows = await query('SELECT COUNT(*) AS n FROM task_timeline_events WHERE task_id = ?', [taskId]);
    return Number(rows[0]?.n) || 0;
  } catch (_) {
    return 0;
  }
}

export default {
  RECORD_EVENT_TYPES,
  appendTimelineEvent,
  getTaskTimeline,
  countTaskTimeline,
};
