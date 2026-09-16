/**
 * conversation-dao.js — 对话历史数据访问层
 * 替代 conversationHistory 内存 Map，数据持久化到 MySQL
 */

import { query } from './db.js';

export async function loadHistory(userId, agentId, limit = 40, taskId = null) {
  // taskId 必传:chatHistory 按 taskId 隔离,避免同 agent 多任务上下文污染
  // 旧数据 task_id=NULL 时不会命中(task_id IS NULL 不会等于具体 taskId)
  const rows = await query(
    `SELECT role, content, turn_index, created_at
     FROM conversation_history
     WHERE user_id = ? AND agent_id = ? AND task_id = ?
     ORDER BY turn_index ASC, id ASC
     LIMIT ?`,
    [userId, agentId, taskId, limit]
  );
  return rows.map(r => ({ role: r.role, content: r.content, timestamp: r.created_at }));
}

/**
 * 加载当前用户所有智能体的全部历史（合并，按时间升序）
 */
export async function loadAllHistory(userId, limit = 200) {
  const rows = await query(
    `SELECT agent_id, role, content, turn_index, created_at
     FROM conversation_history
     WHERE user_id = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [userId, limit]
  );
  return rows.map(r => ({ agentId: r.agent_id, role: r.role, content: r.content, timestamp: r.created_at }));
}

/**
 * 加载当前用户所有智能体的最近消息（合并，按时间排序）
 */
export async function loadRecentAllAgents(userId, limit = 30) {
  const rows = await query(
    `SELECT ch.agent_id, ch.role, ch.content, ch.turn_index, ch.id
     FROM conversation_history ch
     INNER JOIN (
       SELECT user_id, agent_id, MAX(id) as max_id
       FROM conversation_history
       WHERE user_id = ?
       GROUP BY user_id, agent_id
     ) latest ON ch.user_id = latest.user_id AND ch.agent_id = latest.agent_id AND ch.id = latest.max_id
     ORDER BY ch.id DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows.map(r => ({ agentId: r.agent_id, role: r.role, content: r.content }));
}

export async function saveTurn(userId, agentId, role, content, turnIndex, taskId = null) {
  await query(
    `INSERT INTO conversation_history (user_id, agent_id, task_id, role, content, turn_index)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, agentId, taskId, role, content, turnIndex]
  );
}

export async function loadOrCreateTurnIndex(userId, agentId, taskId = null) {
  // taskId 必传:turn_index 按 task 独立计算,不同 task 互不影响
  const rows = await query(
    `SELECT COALESCE(MAX(turn_index), 0) AS maxTurn
     FROM conversation_history
     WHERE user_id = ? AND agent_id = ? AND task_id = ?`,
    [userId, agentId, taskId]
  );
  return rows[0].maxTurn;
}

export async function trimHistory(userId, agentId, keepCount = 40, taskId = null) {
  // 删除超出保留数量的最旧消息（按 taskId 隔离,只清理当前 task）
  await query(
    `DELETE FROM conversation_history
     WHERE user_id = ? AND agent_id = ? AND task_id = ?
       AND turn_index < (
         SELECT sub.max_turn FROM (
           SELECT MAX(turn_index) - CEIL(?/2) AS max_turn
           FROM conversation_history
           WHERE user_id = ? AND agent_id = ? AND task_id = ?
         ) sub
       )`,
    [userId, agentId, taskId, keepCount, userId, agentId, taskId]
  );
}
