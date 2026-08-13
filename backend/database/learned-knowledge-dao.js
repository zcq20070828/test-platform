/**
 * 智能体知识学习记录 DAO
 * 替代 learnedKnowledge 内存 Map，实现持久化和增量学习
 */

import { query } from './db.js';
import crypto from 'crypto';

/**
 * 计算文档内容哈希
 * @param {string} content - 文档内容
 * @returns {string} SHA256 哈希值
 */
export function hashDocContent(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex');
}

/**
 * 获取用户-智能体的学习记录
 * @param {string} userId - 用户ID
 * @param {string} agentId - 智能体ID
 * @returns {Promise<Array>} 学习记录列表
 */
export async function getLearnedKnowledge(userId, agentId) {
  const sql = `
    SELECT kb_type, doc_path, doc_hash, content_preview, learned_at
    FROM agent_learned_knowledge
    WHERE user_id = ? AND agent_id = ?
    ORDER BY learned_at DESC
  `;
  return await query(sql, [userId, agentId]);
}

/**
 * 获取用户-智能体的所有学习内容（用于注入 system prompt）
 * @param {string} userId - 用户ID
 * @param {string} agentId - 智能体ID
 * @returns {Promise<string>} 拼接后的知识内容
 */
export async function getLearnedKnowledgeContent(userId, agentId) {
  const sql = `
    SELECT content_preview
    FROM agent_learned_knowledge
    WHERE user_id = ? AND agent_id = ?
    ORDER BY kb_type, doc_path
  `;
  const rows = await query(sql, [userId, agentId]);
  if (!rows || rows.length === 0) return '';
  return rows.map(r => r.content_preview).filter(Boolean).join('\n\n---\n\n');
}

/**
 * 检查文档是否需要重新学习（hash 变化或未学习过）
 * @param {string} userId - 用户ID
 * @param {string} agentId - 智能体ID
 * @param {string} kbType - 知识库类型
 * @param {string} docPath - 文档路径
 * @param {string} currentHash - 当前文档哈希
 * @returns {Promise<boolean>} true = 需要重新学习
 */
export async function needsRelearning(userId, agentId, kbType, docPath, currentHash) {
  const sql = `
    SELECT doc_hash FROM agent_learned_knowledge
    WHERE user_id = ? AND agent_id = ? AND kb_type = ? AND doc_path = ?
  `;
  const rows = await query(sql, [userId, agentId, kbType, docPath]);
  if (!rows || rows.length === 0) return true;
  return rows[0].doc_hash !== currentHash;
}

/**
 * 批量获取需要学习的文档（排除已学习且未变化的）
 * @param {string} userId - 用户ID
 * @param {string} agentId - 智能体ID
 * @param {Array<{kbType, docPath, content}>} docs - 候选文档列表
 * @returns {Promise<Array>} 需要学习的文档子集
 */
export async function filterNeedsLearning(userId, agentId, docs) {
  const result = [];
  for (const doc of docs) {
    const hash = hashDocContent(doc.content);
    const need = await needsRelearning(userId, agentId, doc.kbType, doc.docPath, hash);
    if (need) {
      result.push({ ...doc, hash });
    }
  }
  return result;
}

/**
 * 保存学习记录（插入或更新）
 * @param {string} userId - 用户ID
 * @param {string} agentId - 智能体ID
 * @param {string} kbType - 知识库类型
 * @param {string} docPath - 文档路径
 * @param {string} content - 完整内容（用于计算 hash 和提取预览）
 * @returns {Promise<void>}
 */
export async function saveLearnedKnowledge(userId, agentId, kbType, docPath, content) {
  // 【防御】content 为空时跳过写入，避免空 hash 占用 DB 导致 needsRelearning 失效
  if (!content || typeof content !== 'string' || content.startsWith('[文件') || content.startsWith('[KB')) {
    console.warn(`[LearnedKB] 跳过无效内容写入: user=${userId} agent=${agentId} doc=${kbType}/${docPath} content="${content?.slice(0, 50)}"`);
    return;
  }
  const hash = hashDocContent(content);
  const preview = (content || '').slice(0, 500); // 前500字符作为预览

  const sql = `
    INSERT INTO agent_learned_knowledge
      (user_id, agent_id, kb_type, doc_path, doc_hash, content_preview, learned_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      doc_hash = VALUES(doc_hash),
      content_preview = VALUES(content_preview),
      learned_at = VALUES(learned_at)
  `;
  await query(sql, [userId, agentId, kbType, docPath, hash, preview]);
}

/**
 * 根据知识库和文档路径，删除所有用户对该文档的学习记录
 * 用于文件被删除时的主动清理，防止空hash占用缓存导致后续无法重学
 * @param {string} kbType - 知识库类型
 * @param {string} docPath - 文档相对路径
 * @returns {Promise<number>} 删除的记录数
 */
export async function clearKnowledgeByDoc(kbType, docPath) {
  const sql = 'DELETE FROM agent_learned_knowledge WHERE kb_type = ? AND doc_path = ?';
  const result = await query(sql, [kbType, docPath]);
  return result.affectedRows || 0;
}

/**
 * 批量保存学习记录
 * @param {string} userId - 用户ID
 * @param {string} agentId - 智能体ID
 * @param {Array<{kbType, docPath, content}>} docs - 文档列表
 * @returns {Promise<number>} 保存的文档数
 */
export async function batchSaveLearnedKnowledge(userId, agentId, docs) {
  let saved = 0;
  for (const doc of docs) {
    await saveLearnedKnowledge(userId, agentId, doc.kbType, doc.docPath, doc.content);
    saved++;
  }
  return saved;
}

/**
 * 删除用户-智能体的所有学习记录（用于重新学习）
 * @param {string} userId - 用户ID
 * @param {string} agentId - 智能体ID（可选，不传则删除该用户所有）
 * @returns {Promise<number>} 删除的记录数
 */
export async function clearLearnedKnowledge(userId, agentId = null) {
  if (agentId) {
    const sql = 'DELETE FROM agent_learned_knowledge WHERE user_id = ? AND agent_id = ?';
    const result = await query(sql, [userId, agentId]);
    return result.affectedRows || 0;
  } else {
    const sql = 'DELETE FROM agent_learned_knowledge WHERE user_id = ?';
    const result = await query(sql, [userId]);
    return result.affectedRows || 0;
  }
}

/**
 * 获取学习统计
 * @param {string} userId - 用户ID
 * @param {string} agentId - 智能体ID（可选）
 * @returns {Promise<{total: number, byKbType: Object, lastLearnedAt: Date}>}
 */
export async function getLearningStats(userId, agentId = null) {
  let sql, params;
  if (agentId) {
    sql = `
      SELECT kb_type, COUNT(*) as cnt, MAX(learned_at) as last_at
      FROM agent_learned_knowledge
      WHERE user_id = ? AND agent_id = ?
      GROUP BY kb_type
    `;
    params = [userId, agentId];
  } else {
    sql = `
      SELECT kb_type, COUNT(*) as cnt, MAX(learned_at) as last_at
      FROM agent_learned_knowledge
      WHERE user_id = ?
      GROUP BY kb_type
    `;
    params = [userId];
  }
  const rows = await query(sql, params);
  const byKbType = {};
  let total = 0;
  let lastLearnedAt = null;
  for (const r of rows) {
    byKbType[r.kb_type] = parseInt(r.cnt);
    total += parseInt(r.cnt);
    if (r.last_at && (!lastLearnedAt || new Date(r.last_at) > lastLearnedAt)) {
      lastLearnedAt = new Date(r.last_at);
    }
  }
  return { total, byKbType, lastLearnedAt };
}

export default {
  hashDocContent,
  getLearnedKnowledge,
  getLearnedKnowledgeContent,
  needsRelearning,
  filterNeedsLearning,
  saveLearnedKnowledge,
  batchSaveLearnedKnowledge,
  clearLearnedKnowledge,
  getLearningStats,
  clearKnowledgeByDoc
};
