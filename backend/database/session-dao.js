/**
 * 会话数据访问层（2026-11-25 · 对话改造第三步）
 *
 * 会话是**任务的分组容器**，不参与执行。
 *
 * 为什么这么设计：任务已经完整承载了「执行一次交付物生成」的全部语义
 * （智能体、门禁、审核、成本、产物版本）。把会话做成新的执行单元，
 * 意味着要把这些全部复制一遍——风险极大、收益为零。
 * 会话真正要解决的只是「让多个任务的产物在同一个上下文里串起来」，
 * 那是分组问题，不是执行问题。
 *
 * 因此本层只有四个职责：
 *   1) 建会话
 *   2) 把任务挂进会话（分配会话内序号）
 *   3) 按会话取产物列表（供「上一份产物」和侧栏展示）
 *   4) 取会话内最新的上游产物（供串联注入）
 */

import { query } from './db.js';
import crypto from 'crypto';

/** 生成会话 ID（与任务 ID 同格式，便于前端统一处理） */
function newSessionId() {
  return crypto.randomUUID();
}

/**
 * 创建会话
 *
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} [args.title]  不传时留空，等首个任务挂入后用输入摘要补
 * @param {string} [args.projectKey]
 * @returns {Promise<{id:string}>}
 */
export async function createSession({ userId, title = null, projectKey = null }) {
  const id = newSessionId();
  await query(
    `INSERT INTO chat_sessions (id, user_id, title, project_key) VALUES (?, ?, ?, ?)`,
    [id, userId, title ? String(title).slice(0, 200) : null, projectKey ? String(projectKey).slice(0, 80) : null],
  );
  return { id };
}

/**
 * 把任务挂进会话，并分配会话内序号
 *
 * 序号必须显式分配而不是靠 created_at 排序：同秒创建的两个任务
 * created_at 可能相同，排序不确定，「上一份产物是谁」就没有答案。
 *
 * @param {string} taskId
 * @param {string} sessionId
 * @returns {Promise<number>} 分配到的序号
 */
export async function attachTask(taskId, sessionId) {
  const rows = await query(
    `SELECT COALESCE(MAX(session_seq), 0) AS mx FROM tasks WHERE session_id = ?`,
    [sessionId],
  );
  const seq = (Number(rows[0]?.mx) || 0) + 1;
  await query(
    `UPDATE tasks SET session_id = ?, session_seq = ? WHERE id = ?`,
    [sessionId, seq, taskId],
  );
  return seq;
}

/**
 * 取会话内的产物列表（按序号升序）
 *
 * @param {string} sessionId
 * @returns {Promise<Array<{id:string, seq:number, agentId:string, status:string, type:string, title:string, createdAt:string}>>}
 */
export async function listSessionTasks(sessionId) {
  const rows = await query(
    `SELECT id, session_seq, agent_id, status, type, created_at, result
       FROM tasks
      WHERE session_id = ?
      ORDER BY session_seq ASC, created_at ASC`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.session_seq) || 0,
    agentId: r.agent_id,
    status: r.status,
    type: r.type,
    title: deriveTitle(r.result),
    createdAt: r.created_at,
  }));
}

/** 从结果里粗略推一个标题（只取前 60 字的第一行有内容的文本） */
function deriveTitle(result) {
  const t = String(result || '').trim();
  if (!t) return '';
  const line = t.split(/\r?\n/).find((l) => l.trim() && !/^[#\-*\s|]+$/.test(l)) || '';
  return line.replace(/^#+\s*/, '').replace(/[*|]/g, '').trim().slice(0, 60);
}

/**
 * 取会话内某个任务**之前**最近的、来自指定智能体的成功产物
 *
 * 用途：用例生成时自动挂上同会话的需求分析报告。
 * 比现有的「跨任务按项目名匹配」更可靠——同一会话内的先后关系是确定的，
 * 不需要猜项目名。
 *
 * @param {Object} args
 * @param {string} args.sessionId
 * @param {number} args.beforeSeq        当前任务的序号（只找它之前的）
 * @param {string} args.agentId          要找哪个智能体的产物
 * @returns {Promise<{taskId:string, seq:number, result:string}|null>}
 */
export async function findUpstreamArtifact({ sessionId, beforeSeq, agentId }) {
  if (!sessionId || !agentId) return null;
  const rows = await query(
    `SELECT id, session_seq, result
       FROM tasks
      WHERE session_id = ?
        AND agent_id = ?
        AND status = 'completed'
        AND session_seq < ?
        AND result IS NOT NULL AND result <> ''
      ORDER BY session_seq DESC
      LIMIT 1`,
    [sessionId, agentId, beforeSeq],
  );
  if (!rows.length) return null;
  return {
    taskId: rows[0].id,
    seq: Number(rows[0].session_seq) || 0,
    result: rows[0].result,
  };
}

/**
 * 取用户的会话列表（按最近更新排序）
 *
 * @param {string} userId
 * @param {number} [limit=50]
 */
export async function listSessions(userId, limit = 50) {
  const rows = await query(
    `SELECT s.id, s.title, s.project_key, s.created_at, s.updated_at,
            COUNT(t.id) AS task_count,
            SUM(t.status = 'completed') AS completed_count
       FROM chat_sessions s
       LEFT JOIN tasks t ON t.session_id = s.id
      WHERE s.user_id = ?
      GROUP BY s.id, s.title, s.project_key, s.created_at, s.updated_at
      ORDER BY s.updated_at DESC
      LIMIT ?`,
    [userId, Number(limit) || 50],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title || '(未命名会话)',
    projectKey: r.project_key,
    taskCount: Number(r.task_count) || 0,
    completedCount: Number(r.completed_count) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** 会话标题为空时，用首个任务的输入补上（只在为空时写，不覆盖用户改过的） */
export async function backfillTitle(sessionId, title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) return;
  await query(
    `UPDATE chat_sessions SET title = ? WHERE id = ? AND (title IS NULL OR title = '')`,
    [clean, sessionId],
  );
}

/** 取会话归属用户（鉴权用） */
export async function getSessionOwner(sessionId) {
  const rows = await query(`SELECT user_id FROM chat_sessions WHERE id = ? LIMIT 1`, [sessionId]);
  return rows[0]?.user_id || null;
}
