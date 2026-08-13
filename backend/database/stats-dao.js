import { query } from './db.js';

/**
 * 统计数据DAO
 */

// ==================== 日统计 ====================

/**
 * 获取指定日期范围的任务统计
 */
export async function getTaskDailyStats(startDate, endDate) {
  const sql = `
    SELECT 
      stat_date as date,
      total_tasks,
      completed_tasks,
      failed_tasks,
      timeout_tasks,
      avg_duration_minutes,
      manual_hours,
      auto_hours,
      saved_hours,
      efficiency_rate,
      estimated_cost,
      actual_cost,
      saved_cost,
      evaluation_count,
      quality_pass_count,
      quality_pass_rate,
      avg_overall_score,
      avg_quality_score,
      deliverable_count,
      deliverable_scored,
      avg_deliverable_score
    FROM task_daily_stats
    WHERE stat_date >= ? AND stat_date <= ?
    ORDER BY stat_date
  `;
  return await query(sql, [startDate, endDate]);
}

/**
 * 获取智能体统计
 */
export async function getAgentDailyStats(startDate, endDate, agentId = null) {
  let sql = `
    SELECT 
      stat_date as date,
      agent_id,
      agent_name,
      total_tasks,
      completed_tasks,
      failed_tasks,
      avg_duration_minutes,
      avg_score,
      avg_capability_score,
      avg_business_score,
      total_input_tokens,
      total_output_tokens,
      total_cost
    FROM agent_daily_stats
    WHERE stat_date >= ? AND stat_date <= ?
  `;
  const params = [startDate, endDate];
  
  if (agentId) {
    sql += ' AND agent_id = ?';
    params.push(agentId);
  }
  
  sql += ' ORDER BY stat_date, total_tasks DESC';
  return await query(sql, params);
}

/**
 * 获取用户统计
 */
export async function getUserDailyStats(startDate, endDate) {
  const sql = `
    SELECT 
      stat_date as date,
      user_id,
      username,
      total_tasks,
      completed_tasks,
      failed_tasks,
      avg_duration_minutes
    FROM user_daily_stats
    WHERE stat_date >= ? AND stat_date <= ?
    ORDER BY stat_date, total_tasks DESC
  `;
  return await query(sql, [startDate, endDate]);
}

// ==================== 汇总统计 ====================

/**
 * 获取总体统计（实时快照）
 */
export async function getOverallStats() {
  const sql = 'SELECT stat_key, stat_value FROM overall_stats';
  const rows = await query(sql);
  const stats = {};
  for (const row of rows) {
    stats[row.stat_key] = row.stat_value;
  }
  return stats;
}

/**
 * 更新总体统计
 */
export async function updateOverallStat(key, value) {
  const sql = `
    INSERT INTO overall_stats (stat_key, stat_value)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE stat_value = VALUES(stat_value)
  `;
  await query(sql, [key, String(value)]);
}

/**
 * 获取今日统计
 * @param {string|null} userId - 若提供则只看该用户的任务；admin 调用不传或传 null 则看全平台
 */
export async function getTodayStats(userId = null) {
  const today = new Date().toISOString().slice(0, 10);
  let sql;
  let params;
  
  if (userId) {
    // 按用户隔离：只看该用户的今日任务
    sql = `
      SELECT 
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
        SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) as timeout_tasks,
        AVG(CASE WHEN status = 'completed' 
            THEN TIMESTAMPDIFF(MINUTE, created_at, completed_at) 
            ELSE NULL END) as avg_duration_minutes,
        SUM(CASE WHEN status = 'completed' 
            THEN TIMESTAMPDIFF(MINUTE, created_at, completed_at) 
            ELSE 0 END) as total_duration_minutes,
        1 as active_users
      FROM tasks
      WHERE DATE(created_at) = ? AND user_id = ?
    `;
    params = [today, userId];
  } else {
    // 全平台统计（admin）
    sql = `
      SELECT 
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
        SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) as timeout_tasks,
        AVG(CASE WHEN status = 'completed' 
            THEN TIMESTAMPDIFF(MINUTE, created_at, completed_at) 
            ELSE NULL END) as avg_duration_minutes,
        SUM(CASE WHEN status = 'completed' 
            THEN TIMESTAMPDIFF(MINUTE, created_at, completed_at) 
            ELSE 0 END) as total_duration_minutes,
        COUNT(DISTINCT user_id) as active_users
      FROM tasks
      WHERE DATE(created_at) = ?
    `;
    params = [today];
  }
  
  const rows = await query(sql, params);
  const stats = rows[0] || {};

  // 今日评估质量数据
  const qualitySql = `
    SELECT
      COUNT(*) as evaluation_count,
      SUM(CASE WHEN overall_score >= 60 THEN 1 ELSE 0 END) as quality_pass_count
    FROM evaluation_reports
    WHERE DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = ?
      AND overall_score IS NOT NULL
  `;
  const qualityRows = await query(qualitySql, [today]);
  const q = qualityRows[0] || {};
  const evalCnt = parseInt(q.evaluation_count) || 0;
  const passCnt = parseInt(q.quality_pass_count) || 0;
  const qualityPassRate = evalCnt > 0 ? Math.round(passCnt / evalCnt * 100) : 0;

  return {
    ...stats,
    evaluation_count: evalCnt,
    quality_pass_count: passCnt,
    quality_pass_rate: qualityPassRate
  };
}

// ==================== 趋势统计 ====================

/**
 * 获取最近N天的趋势数据
 */
export async function getRecentTrend(days = 7) {
  const sql = `
    SELECT 
      stat_date as date,
      total_tasks,
      completed_tasks,
      ROUND(completed_tasks * 100.0 / NULLIF(total_tasks, 0), 2) as success_rate,
      avg_duration_minutes,
      saved_hours,
      efficiency_rate,
      evaluation_count,
      quality_pass_count,
      quality_pass_rate,
      avg_overall_score,
      avg_quality_score
    FROM task_daily_stats
    WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    ORDER BY stat_date
  `;
  return await query(sql, [days]);
}

/**
 * 获取智能体排名
 */
export async function getAgentRanking(startDate, endDate, limit = 10) {
  const sql = `
    SELECT
      agent_id,
      agent_name,
      SUM(total_tasks) as total_tasks,
      SUM(completed_tasks) as completed_tasks,
      ROUND(SUM(completed_tasks) * 100.0 / NULLIF(SUM(total_tasks), 0), 2) as success_rate,
      AVG(avg_score) as avg_score,
      AVG(avg_capability_score) as avg_capability_score,
      AVG(avg_business_score) as avg_business_score,
      SUM(total_cost) as total_cost,
      SUM(deliverable_count) as deliverable_count,
      AVG(avg_deliverable_score) as avg_deliverable_score
    FROM agent_daily_stats
    WHERE stat_date >= ? AND stat_date <= ?
    GROUP BY agent_id, agent_name
    ORDER BY total_tasks DESC
    LIMIT ?
  `;
  return await query(sql, [startDate, endDate, limit]);
}

// ==================== 提效统计 ====================

/**
 * 计算提效数据（本月）
 */
export async function getEfficiencyStats() {
  const sql = `
    SELECT 
      SUM(total_tasks) as total_tasks,
      SUM(completed_tasks) as completed_tasks,
      SUM(manual_hours) as manual_hours,
      SUM(auto_hours) as auto_hours,
      SUM(saved_hours) as saved_hours,
      AVG(efficiency_rate) as avg_efficiency_rate,
      SUM(estimated_cost) as estimated_cost,
      SUM(actual_cost) as actual_cost,
      SUM(saved_cost) as saved_cost,
      SUM(evaluation_count) as evaluation_count,
      SUM(quality_pass_count) as quality_pass_count,
      ROUND(SUM(quality_pass_count) * 100.0 / NULLIF(SUM(evaluation_count), 0), 2) as quality_pass_rate,
      AVG(avg_overall_score) as avg_overall_score,
      AVG(avg_quality_score) as avg_quality_score,
      SUM(deliverable_count) as deliverable_count,
      SUM(deliverable_scored) as deliverable_scored,
      AVG(avg_deliverable_score) as avg_deliverable_score
    FROM task_daily_stats
    WHERE stat_date >= DATE_FORMAT(NOW(), '%Y-%m-01')
  `;
  const rows = await query(sql);
  return rows[0] || {};
}

// ==================== 写入统计 ====================

/**
 * 写入/更新日统计数据
 */
export async function upsertTaskDailyStats(statDate, data) {
  const sql = `
    INSERT INTO task_daily_stats
      (stat_date, total_tasks, completed_tasks, failed_tasks, timeout_tasks,
       avg_duration_minutes, total_duration_minutes, manual_hours, auto_hours,
       saved_hours, efficiency_rate, estimated_cost, actual_cost, saved_cost,
       evaluation_count, quality_pass_count, quality_pass_rate,
       avg_overall_score, avg_quality_score,
       deliverable_count, deliverable_scored, avg_deliverable_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      total_tasks = VALUES(total_tasks),
      completed_tasks = VALUES(completed_tasks),
      failed_tasks = VALUES(failed_tasks),
      timeout_tasks = VALUES(timeout_tasks),
      avg_duration_minutes = VALUES(avg_duration_minutes),
      total_duration_minutes = VALUES(total_duration_minutes),
      manual_hours = VALUES(manual_hours),
      auto_hours = VALUES(auto_hours),
      saved_hours = VALUES(saved_hours),
      efficiency_rate = VALUES(efficiency_rate),
      estimated_cost = VALUES(estimated_cost),
      actual_cost = VALUES(actual_cost),
      saved_cost = VALUES(saved_cost),
      evaluation_count = VALUES(evaluation_count),
      quality_pass_count = VALUES(quality_pass_count),
      quality_pass_rate = VALUES(quality_pass_rate),
      avg_overall_score = VALUES(avg_overall_score),
      avg_quality_score = VALUES(avg_quality_score),
      deliverable_count = VALUES(deliverable_count),
      deliverable_scored = VALUES(deliverable_scored),
      avg_deliverable_score = VALUES(avg_deliverable_score)
  `;
  await query(sql, [
    statDate,
    data.total_tasks || 0,
    data.completed_tasks || 0,
    data.failed_tasks || 0,
    data.timeout_tasks || 0,
    data.avg_duration_minutes || 0,
    data.total_duration_minutes || 0,
    data.manual_hours || 0,
    data.auto_hours || 0,
    data.saved_hours || 0,
    data.efficiency_rate || 0,
    data.estimated_cost || 0,
    data.actual_cost || 0,
    data.saved_cost || 0,
    data.evaluation_count || 0,
    data.quality_pass_count || 0,
    data.quality_pass_rate || 0,
    data.avg_overall_score || 0,
    data.avg_quality_score || 0,
    data.deliverable_count || 0,
    data.deliverable_scored || 0,
    data.avg_deliverable_score || 0
  ]);
}

/**
 * 写入/更新智能体日统计
 */
export async function upsertAgentDailyStats(statDate, agentId, agentName, data) {
  const sql = `
    INSERT INTO agent_daily_stats
      (stat_date, agent_id, agent_name, total_tasks, completed_tasks, failed_tasks,
       avg_duration_minutes, avg_score, avg_capability_score, avg_business_score,
       total_input_tokens, total_output_tokens, total_cost,
       deliverable_count, avg_deliverable_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      agent_name = VALUES(agent_name),
      total_tasks = VALUES(total_tasks),
      completed_tasks = VALUES(completed_tasks),
      failed_tasks = VALUES(failed_tasks),
      avg_duration_minutes = VALUES(avg_duration_minutes),
      avg_score = VALUES(avg_score),
      avg_capability_score = VALUES(avg_capability_score),
      avg_business_score = VALUES(avg_business_score),
      total_input_tokens = VALUES(total_input_tokens),
      total_output_tokens = VALUES(total_output_tokens),
      total_cost = VALUES(total_cost),
      deliverable_count = VALUES(deliverable_count),
      avg_deliverable_score = VALUES(avg_deliverable_score)
  `;
  await query(sql, [
    statDate,
    agentId,
    agentName,
    data.total_tasks || 0,
    data.completed_tasks || 0,
    data.failed_tasks || 0,
    data.avg_duration_minutes || 0,
    data.avg_score || 0,
    data.avg_capability_score || 0,
    data.avg_business_score || 0,
    data.total_input_tokens || 0,
    data.total_output_tokens || 0,
    data.total_cost || 0,
    data.deliverable_count || 0,
    data.avg_deliverable_score || 0
  ]);
}

/**
 * 写入/更新用户日统计
 */
export async function upsertUserDailyStats(statDate, userId, username, data) {
  const sql = `
    INSERT INTO user_daily_stats
      (stat_date, user_id, username, total_tasks, completed_tasks, failed_tasks, avg_duration_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      total_tasks = VALUES(total_tasks),
      completed_tasks = VALUES(completed_tasks),
      failed_tasks = VALUES(failed_tasks),
      avg_duration_minutes = VALUES(avg_duration_minutes)
  `;
  await query(sql, [
    statDate,
    userId,
    username,
    data.total_tasks || 0,
    data.completed_tasks || 0,
    data.failed_tasks || 0,
    data.avg_duration_minutes || 0
  ]);
}

export default {
  getTaskDailyStats,
  getAgentDailyStats,
  getUserDailyStats,
  getOverallStats,
  updateOverallStat,
  getTodayStats,
  getRecentTrend,
  getAgentRanking,
  getEfficiencyStats,
  upsertTaskDailyStats,
  upsertAgentDailyStats,
  upsertUserDailyStats
};
