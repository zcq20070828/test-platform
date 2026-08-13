/**
 * 任务执行日志 DAO（Token 追踪）
 */
import { query } from './db.js';

export async function logExecution(data) {
  const sql = `
    INSERT INTO task_execution_logs (
      task_id, agent_id, stage,
      input_tokens, output_tokens, total_tokens, api_calls,
      cost, start_time, end_time, duration_ms, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const now = new Date();
  const start = data.startTime ? new Date(data.startTime) : now;
  const end = data.endTime ? new Date(data.endTime) : now;
  const params = [
    data.taskId, data.agentId, data.stage || null,
    data.inputTokens || 0, data.outputTokens || 0, data.totalTokens || 0, data.apiCalls || 1,
    data.cost || 0, start, end, data.durationMs || (end - start), data.status || 'success'
  ];
  return await query(sql, params);
}

export async function getExecutionLogs(filters = {}) {
  const { taskId, agentId, limit = 50 } = filters;
  const where = [];
  const params = [];
  if (taskId) { where.push('task_id = ?'); params.push(taskId); }
  if (agentId) { where.push('agent_id = ?'); params.push(agentId); }
  const sql = `
    SELECT * FROM task_execution_logs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  params.push(parseInt(limit) || 50);
  return await query(sql, params);
}

export async function getTokenStats(filters = {}) {
  const { startDate, endDate, agentId } = filters;
  const where = ["status = 'success'"];
  const params = [];
  if (startDate) { where.push('created_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('created_at <= ?'); params.push(endDate); }
  if (agentId) { where.push('agent_id = ?'); params.push(agentId); }
  const sql = `
    SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM task_execution_logs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;
  const rows = await query(sql, params);
  return rows[0] || { total_calls: 0, total_input: 0, total_output: 0, total_tokens: 0, avg_duration_ms: 0 };
}

/**
 * 按智能体分组的 Token 使用统计（用户行为数据统计功能新增，仅追加）
 */
export async function getTokenStatsByAgent(filters = {}) {
  const { startDate, endDate, agentId } = filters;
  const where = ["status = 'success'"];
  const params = [];
  if (startDate) { where.push('created_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('created_at <= ?'); params.push(endDate); }
  if (agentId) { where.push('agent_id = ?'); params.push(agentId); }
  const sql = `
    SELECT
      agent_id,
      COUNT(DISTINCT task_id) as task_count,
      COUNT(*) as total_calls,
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cost), 0) as total_cost,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM task_execution_logs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY agent_id
    ORDER BY total_tokens DESC
  `;
  return await query(sql, params);
}
