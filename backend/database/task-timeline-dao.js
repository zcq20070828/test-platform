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
  'rule_quality_gate',
  'task_review_started',
  'reviewer_started',
  'reviewer_completed',
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
 * 追加一条时间线事件
 *
 * seq 用单条 SQL 内的 MAX(seq)+1 计算，配合 uk_task_seq 唯一键，
 * 并发写同一个任务时最多是冲突重试，不会出现重复序号。
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

  try {
    await query(
      `INSERT INTO task_timeline_events (task_id, seq, type, agent_id, payload, original_size)
       SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?
         FROM task_timeline_events
        WHERE task_id = ?`,
      [taskId, type, agentId, text, originalSize, taskId],
    );
    const rows = await query(
      'SELECT seq FROM task_timeline_events WHERE task_id = ? ORDER BY seq DESC LIMIT 1',
      [taskId],
    );
    return rows.length ? Number(rows[0].seq) : null;
  } catch (e) {
    // 表不存在（未跑迁移）或写入冲突都不影响主流程
    console.warn(`[Timeline] 事件落盘失败 ${type}/${taskId}: ${e.message}`);
    return null;
  }
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
