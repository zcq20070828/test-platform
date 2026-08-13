/**
 * waiting-session-dao.js — 等待输入会话数据访问层
 * 替代 waitingInputSessions 内存 Map，数据持久化到 MySQL
 */

import { query } from './db.js';

export async function createWaitingSession(taskId, agentId, workflowId) {
  await query(
    `INSERT IGNORE INTO waiting_input_sessions (task_id, agent_id, workflow_id)
     VALUES (?, ?, ?)`,
    [taskId, agentId, workflowId || null]
  );
}

export async function removeWaitingSession(taskId) {
  await query('DELETE FROM waiting_input_sessions WHERE task_id = ?', [taskId]);
}

export async function getWaitingSession(taskId) {
  const rows = await query('SELECT * FROM waiting_input_sessions WHERE task_id = ?', [taskId]);
  return rows[0] || null;
}

export async function listWaitingSessions() {
  const rows = await query('SELECT * FROM waiting_input_sessions ORDER BY started_at ASC');
  return rows.map(r => ({
    taskId:     r.task_id,
    agentId:    r.agent_id,
    workflowId: r.workflow_id,
    startedAt:  r.started_at ? r.started_at.toISOString() : null,
  }));
}
