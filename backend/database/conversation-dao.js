/**
 * conversation-dao.js — 对话历史数据访问层
 * 替代 conversationHistory 内存 Map，数据持久化到 MySQL
 */

import { query } from './db.js';

export async function loadHistory(userId, agentId) {
  const rows = await query(
    `SELECT role, content, turn_index
     FROM conversation_history
     WHERE user_id = ? AND agent_id = ?
     ORDER BY turn_index ASC, id ASC
     LIMIT 40`,
    [userId, agentId]
  );
  return rows.map(r => ({ role: r.role, content: r.content }));
}

export async function saveTurn(userId, agentId, role, content, turnIndex) {
  await query(
    `INSERT INTO conversation_history (user_id, agent_id, role, content, turn_index)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, agentId, role, content, turnIndex]
  );
}

export async function loadOrCreateTurnIndex(userId, agentId) {
  const rows = await query(
    `SELECT COALESCE(MAX(turn_index), 0) AS maxTurn
     FROM conversation_history
     WHERE user_id = ? AND agent_id = ?`,
    [userId, agentId]
  );
  return rows[0].maxTurn;
}

export async function trimHistory(userId, agentId, keepCount = 40) {
  // 删除超出保留数量的最旧消息（按 turn_index 升序，只保留最近的 keepCount 条消息）
  await query(
    `DELETE FROM conversation_history
     WHERE user_id = ? AND agent_id = ?
       AND turn_index < (
         SELECT sub.max_turn FROM (
           SELECT MAX(turn_index) - CEIL(?/2) AS max_turn
           FROM conversation_history
           WHERE user_id = ? AND agent_id = ?
         ) sub
       )`,
    [userId, agentId, keepCount, userId, agentId]
  );
}
