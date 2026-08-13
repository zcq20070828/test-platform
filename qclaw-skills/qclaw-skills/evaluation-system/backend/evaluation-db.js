/**
 * 评估数据库访问模块
 * 使用 MySQL 存储评估报告和历史数据（与主系统共用数据库连接池）
 */

import path from 'path';
import { pathToFileURL } from 'url';

// 复用主系统的 MySQL 连接池（database/db.js 导出 pool）
const { pool } = await import(
  pathToFileURL(path.join(process.env.HOME || '/root', '.qclaw/workspace/backend/database/db.js')).href
);

// ==================== 评估报告操作 ====================

/**
 * 保存评估报告
 */
export async function saveReport(report) {
  const sql = `INSERT INTO evaluation_reports (
    agent_id, task_id, task_type, \`timestamp\`,
    overall_score, overall_grade, overall_level,
    capability_score, capability_metrics,
    quality_score, quality_metrics,
    business_score, business_metrics,
    input_duration, input_output_length, input_created_at,
    trend_capability_delta, trend_capability_trend,
    trend_quality_delta, trend_quality_trend,
    trend_business_delta, trend_business_trend,
    trend_overall_delta, trend_overall_trend,
    recommendations, next_evaluation_at, task_count, avg_score, scope
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  const [result] = await pool.execute(sql, [
    report.agentId,
    report.taskId ?? null,
    report.taskType ?? null,
    report.timestamp,
    report.overall.score,
    report.overall.grade,
    report.overall.level,
    report.layers.capability?.score ?? null,
    report.layers.capability?.metrics ? JSON.stringify(report.layers.capability.metrics) : null,
    report.layers.quality?.score ?? null,
    report.layers.quality?.metrics ? JSON.stringify(report.layers.quality.metrics) : null,
    report.layers.business?.score ?? null,
    report.layers.business?.metrics ? JSON.stringify(report.layers.business.metrics) : null,
    report.inputMetadata?.duration ?? null,
    report.inputMetadata?.outputLength ?? null,
    report.inputMetadata?.createdAt ? new Date(report.inputMetadata.createdAt).toISOString() : null,
    report.trends?.capability?.delta ?? 0,
    report.trends?.capability?.trend || 'stable',
    report.trends?.quality?.delta ?? 0,
    report.trends?.quality?.trend || 'stable',
    report.trends?.business?.delta ?? 0,
    report.trends?.business?.trend || 'stable',
    report.trends?.overall?.delta ?? 0,
    report.trends?.overall?.trend || 'stable',
    report.recommendations ? JSON.stringify(report.recommendations) : null,
    report.nextEvaluationAt ?? null,
    report.taskCount ?? 0,
    report.avgScore ?? null,
    report.scope ? JSON.stringify(report.scope) : null
  ]);

  const reportId = result.insertId;
  await saveMetricsHistory(reportId, report);

  return reportId;
}

/**
 * 保存指标历史
 */
async function saveMetricsHistory(reportId, report) {
  const layers = ['capability', 'quality', 'business'];
  for (const layer of layers) {
    const metrics = report.layers[layer]?.metrics || [];
    for (const metric of metrics) {
      await pool.execute(`
        INSERT INTO evaluation_metrics_history (
          report_id, agent_id, metric_key, metric_name, layer, score, weight, \`timestamp\`
        ) VALUES (?,?,?,?,?,?,?,?)
      `, [
        reportId,
        report.agentId,
        metric.key,
        metric.name,
        layer,
        metric.score,
        metric.weight,
        report.timestamp
      ]);
    }
  }
}

/**
 * 获取智能体的评估报告列表
 */
export async function getAgentReports(agentId, limit = 20) {
  const [rows] = await pool.execute(
    'SELECT * FROM evaluation_reports WHERE agent_id = ? ORDER BY `timestamp` DESC LIMIT ?',
    [agentId, limit]
  );
  return rows.map(dbRecordToReport);
}

/**
 * 获取单个报告详情
 */
export async function getReportById(agentId, timestamp) {
  const [rows] = await pool.execute(
    'SELECT * FROM evaluation_reports WHERE agent_id = ? AND `timestamp` = ? LIMIT 1',
    [agentId, timestamp]
  );
  return rows[0] || null;
}

/**
 * 获取所有报告列表
 */

/**
 * 获取指标趋势（从 MySQL）
 * @param {string} agentId
 * @param {string} metricKey  'overall' | 'capability' | 'quality' | 'business' | 'overall.score' 等
 * @param {number} days
 */
export async function getMetricTrend(agentId, metricKey = 'overall', days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  // 按 metricKey 映射到 MySQL 列名
  let colName = 'overall_score';
  if (metricKey === 'capability' || metricKey === 'capability.score') colName = 'capability_score';
  else if (metricKey === 'quality' || metricKey === 'quality.score') colName = 'quality_score';
  else if (metricKey === 'business' || metricKey === 'business.score') colName = 'business_score';

  const [rows] = await pool.execute(
    `SELECT \`timestamp\`, \`${colName}\` as score FROM evaluation_reports
     WHERE agent_id = ? AND \`timestamp\` >= ? ORDER BY \`timestamp\` ASC LIMIT 365`,
    [agentId, since]
  );
  return rows.map(r => ({ timestamp: r.timestamp, score: Number(r.score) }));
}

export async function getAllReports(limit = 50) {
  const [rows] = await pool.execute(
    'SELECT * FROM evaluation_reports ORDER BY `timestamp` DESC LIMIT ?',
    [limit]
  );
  return rows.map(dbRecordToReport);
}

/**
 * 获取指标历史趋势
 */
export async function getMetricHistory(agentId, metricKey, limit = 10) {
  const [rows] = await pool.execute(
    'SELECT score, weight, `timestamp` FROM evaluation_metrics_history WHERE agent_id = ? AND metric_key = ? ORDER BY `timestamp` DESC LIMIT ?',
    [agentId, metricKey, limit]
  );
  return rows;
}

// ==================== 评估运行记录 ====================

/**
 * 创建评估运行记录
 */
export async function createEvaluationRun(runId, runType, opts) {
  await pool.execute(`
    INSERT INTO evaluation_runs (
      run_id, run_type, agent_ids, task_id, scope, status, started_at, total_agents
    ) VALUES (?,?,?,?,?,?,?,?)
  `, [
    runId,
    runType,
    opts.agentIds ? JSON.stringify(opts.agentIds) : null,
    opts.taskId ?? null,
    JSON.stringify(opts.scope),
    'running',
    new Date().toISOString(),
    opts.agentIds?.length || 0
  ]);
}

/**
 * 更新评估运行状态
 */
export async function updateEvaluationRun(runId, updates) {
  const setParts = [];
  const params = [];
  if (updates.status) { setParts.push('status = ?'); params.push(updates.status); }
  if (updates.completedAt) { setParts.push('completed_at = ?'); params.push(updates.completedAt); }
  if (updates.totalTasks !== undefined) { setParts.push('total_tasks = ?'); params.push(updates.totalTasks); }
  if (updates.avgScore !== undefined) { setParts.push('avg_score = ?'); params.push(updates.avgScore); }
  if (updates.errorMessage) { setParts.push('error_message = ?'); params.push(updates.errorMessage); }

  if (setParts.length === 0) return;

  params.push(runId);
  await pool.execute(
    `UPDATE evaluation_runs SET ${setParts.join(', ')} WHERE run_id = ?`,
    params
  );
}

// ==================== 评估配置 ====================

/**
 * 保存智能体评估配置（MySQL: INSERT ... ON DUPLICATE KEY UPDATE）
 */
export async function saveEvaluationConfig(agentId, config) {
  await pool.execute(`
    INSERT INTO evaluation_configs (
      agent_id, enabled, period, scope, next_evaluation_at, updated_at
    ) VALUES (?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      enabled = VALUES(enabled),
      period = VALUES(period),
      scope = VALUES(scope),
      next_evaluation_at = VALUES(next_evaluation_at),
      updated_at = VALUES(updated_at)
  `, [
    agentId,
    config.enabled ? 1 : 0,
    config.period,
    JSON.stringify(config.scope),
    config.nextEvaluationAt ?? null,
    new Date().toISOString()
  ]);
}

// ==================== 数据收集 ====================

/**
 * 保存数据收集会话
 */
export async function saveCollectionSession(sessionId, opts, stats) {
  await pool.execute(`
    INSERT INTO evaluation_collection_sessions (
      session_id, collection_type, agent_ids, days_back, limit_per_agent,
      total_tasks, agents_covered, collected_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `, [
    sessionId,
    opts.collectionType || 'auto',
    opts.agentIds ? JSON.stringify(opts.agentIds) : null,
    opts.daysBack || 30,
    opts.limitPerAgent || 20,
    stats.totalTasks || 0,
    stats.agentsCovered || 0,
    stats.collectedAt
  ]);
}

/**
 * 保存收集的任务数据（批量）
 */
export async function saveCollectedTasks(tasks, collectedAt) {
  if (!tasks || tasks.length === 0) return;

  const placeholders = tasks.map(() => '(?,?,?,?,?,?,?,?)').join(',');
  const params = [];
  for (const t of tasks) {
    params.push(
      t.taskId,
      t.agentId,
      t.type ?? null,
      t.input ?? null,
      t.output ?? null,
      t.status,
      t.duration ?? 0,
      collectedAt
    );
  }

  await pool.execute(`
    INSERT INTO evaluation_collected_tasks (
      task_id, agent_id, task_type, input, output, status, duration, collected_at
    ) VALUES ${placeholders}
  `, params);
}

/**
 * 获取收集的任务数据
 */
export async function getCollectedTasks(agentId, limit = 50) {
  let sql = 'SELECT * FROM evaluation_collected_tasks';
  const params = [];
  if (agentId) {
    sql += ' WHERE agent_id = ?';
    params.push(agentId);
  }
  sql += ' ORDER BY collected_at DESC LIMIT ?';
  params.push(limit);
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * 获取收集会话历史
 */
export async function getCollectionSessions(limit = 20) {
  const [rows] = await pool.execute(
    'SELECT * FROM evaluation_collection_sessions ORDER BY collected_at DESC LIMIT ?',
    [limit]
  );
  return rows;
}

/**
 * 获取智能体评估配置
 */
export async function getEvaluationConfig(agentId) {
  const [rows] = await pool.execute(
    'SELECT * FROM evaluation_configs WHERE agent_id = ?',
    [agentId]
  );
  return rows[0] || null;
}

/**
 * 获取所有启用的定时评估配置
 */
export async function getEnabledConfigs() {
  const [rows] = await pool.execute(
    'SELECT * FROM evaluation_configs WHERE enabled = 1'
  );
  return rows;
}

/**
 * 更新最后评估时间
 */
export async function updateLastEvaluationTime(agentId) {
  await pool.execute(`
    UPDATE evaluation_configs
    SET last_evaluation_at = ?, updated_at = ?
    WHERE agent_id = ?
  `, [new Date().toISOString(), new Date().toISOString(), agentId]);
}

// ==================== 统计查询 ====================

/**
 * 获取智能体平均评分
 */
export async function getAgentAverageScore(agentId, days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [rows] = await pool.execute(
    'SELECT AVG(overall_score) as avg_score, COUNT(*) as count FROM evaluation_reports WHERE agent_id = ? AND `timestamp` >= ?',
    [agentId, cutoff]
  );
  return rows[0];
}

/**
 * 获取评分分布
 */
export async function getGradeDistribution(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [rows] = await pool.execute(
    'SELECT overall_grade, COUNT(*) as count FROM evaluation_reports WHERE `timestamp` >= ? GROUP BY overall_grade',
    [cutoff]
  );
  return rows;
}

/**
 * 获取最近 N 次评估的趋势
 */
export async function getRecentTrend(agentId, limit = 5) {
  const [rows] = await pool.execute(
    'SELECT `timestamp`, overall_score, capability_score, quality_score, business_score FROM evaluation_reports WHERE agent_id = ? ORDER BY `timestamp` DESC LIMIT ?',
    [agentId, limit]
  );
  return rows;
}

// ==================== 记录转换 ====================

/**
 * 将数据库记录转换为报告格式
 * 注意：MySQL DECIMAL 字段返回字符串，需转为 Number
 */
export function dbRecordToReport(record) {
  const num = (v) => (v == null ? null : Number(v));
  return {
    agentId: record.agent_id,
    taskId: record.task_id,
    taskType: record.task_type,
    timestamp: record.timestamp,
    overall: {
      score: num(record.overall_score),
      grade: record.overall_grade,
      level: num(record.overall_level)
    },
    layers: {
      capability: {
        score: num(record.capability_score),
        metrics: record.capability_metrics ? JSON.parse(record.capability_metrics) : []
      },
      quality: {
        score: num(record.quality_score),
        metrics: record.quality_metrics ? JSON.parse(record.quality_metrics) : []
      },
      business: {
        score: num(record.business_score),
        metrics: record.business_metrics ? JSON.parse(record.business_metrics) : []
      }
    },
    inputMetadata: {
      duration: num(record.input_duration),
      outputLength: num(record.input_output_length),
      createdAt: record.input_created_at
    },
    trends: {
      capability: { delta: num(record.trend_capability_delta), trend: record.trend_capability_trend },
      quality: { delta: num(record.trend_quality_delta), trend: record.trend_quality_trend },
      business: { delta: num(record.trend_business_delta), trend: record.trend_business_trend },
      overall: { delta: num(record.trend_overall_delta), trend: record.trend_overall_trend }
    },
    recommendations: record.recommendations ? JSON.parse(record.recommendations) : [],
    nextEvaluationAt: record.next_evaluation_at,
    taskCount: num(record.task_count),
    avgScore: num(record.avg_score),
    scope: record.scope ? JSON.parse(record.scope) : ['capability', 'quality', 'business']
  };
}

export default {
  saveReport,
  getAgentReports,
  getReportById,
  getAllReports,
  getMetricHistory,
  getMetricTrend,
  createEvaluationRun,
  updateEvaluationRun,
  saveEvaluationConfig,
  getEvaluationConfig,
  getEnabledConfigs,
  updateLastEvaluationTime,
  getAgentAverageScore,
  getGradeDistribution,
  getRecentTrend,
  dbRecordToReport
};
