import statsDAO from '../database/stats-dao.js';
import { query } from '../database/db.js';
import * as costConfigDAO from '../database/cost-config-dao.js';

/**
 * 统计服务 - 负责数据聚合和计算
 */

// 默认配置（启动时从 DB 覆盖）
let HOURLY_SALARY = 62.5;  // 元/小时
let MANUAL_CONFIG = {
  // 各类型任务的人工预估耗时（分钟）
  'requirement-analysis': 120,     // 需求分析 2小时
  'test-case-generation': 15,      // 用例生成 每个用例15分钟
  'api-test': 30,                  // 接口测试 30分钟
  'ui-test': 45,                   // UI测试 45分钟
  'report-generation': 60,         // 报告生成 1小时
  'default': 30                    // 默认 30分钟
};

// 加载成本配置到内存缓存
export async function loadCostConfig() {
  try {
    const cfg = await costConfigDAO.getCostConfig();
    HOURLY_SALARY = cfg.hourlySalary;
    MANUAL_CONFIG = cfg.manualConfig;
    console.log(`[Stats] 成本配置已加载: hourlySalary=${HOURLY_SALARY}, manualConfig=${JSON.stringify(MANUAL_CONFIG)}`);
  } catch (err) {
    console.error('[Stats] 加载成本配置失败，使用默认值:', err.message);
  }
}

/**
 * 聚合指定日期的统计数据
 */
export async function aggregateDailyStats(date) {
  console.log(`[Stats] 开始聚合 ${date} 的统计数据...`);
  
  // 1. 聚合任务统计
  const taskStatsSql = `
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
          ELSE 0 END) as total_duration_minutes
    FROM tasks
    WHERE DATE(created_at) = ?
  `;
  const taskRows = await query(taskStatsSql, [date]);
  const taskStats = taskRows[0] || {};
  
  // 2. 计算提效数据
  // 优先使用任务自带的 manual_hours 字段（由智能体评估）
  const manualHoursSql = `
    SELECT 
      SUM(manual_hours) as total_manual_hours,
      SUM(CASE WHEN status = 'completed' 
          THEN TIMESTAMPDIFF(MINUTE, created_at, completed_at) / 60.0
          ELSE 0 END) as auto_hours,
      SUM(estimated_cost) as total_estimated_cost,
      SUM(actual_cost) as total_actual_cost,
      SUM(saved_cost) as total_saved_cost
    FROM tasks
    WHERE DATE(created_at) = ?
  `;
  const manualRows = await query(manualHoursSql, [date]);
  const manualStats = manualRows[0] || {};
  
  // 如果任务有 manual_hours 字段，直接使用；否则回退到 MANUAL_CONFIG 计算
  let manualHours = parseFloat(manualStats.total_manual_hours) || 0;
  let autoHours = parseFloat(manualStats.auto_hours) || 0;
  
  // 回退逻辑：如果没有 manual_hours 数据（旧任务），使用 MANUAL_CONFIG
  if (manualHours === 0) {
    const typeStatsSql = `
      SELECT 
        type,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' 
            THEN TIMESTAMPDIFF(MINUTE, created_at, completed_at) 
            ELSE 0 END) as auto_minutes
      FROM tasks
      WHERE DATE(created_at) = ? AND status = 'completed'
      GROUP BY type
    `;
    const typeRows = await query(typeStatsSql, [date]);
    
    let manualMinutes = 0;
    
    for (const row of typeRows) {
      const taskType = row.type || 'default';
      const manualTime = (MANUAL_CONFIG[taskType] || MANUAL_CONFIG.default) * row.count;
      manualMinutes += manualTime;
      autoHours += (row.auto_minutes || 0) / 60;
    }
    manualHours = manualMinutes / 60;
  }
  
  const savedHours = Math.max(0, manualHours - autoHours);
  const efficiencyRate = manualHours > 0 ? (savedHours / manualHours * 100) : 0;

  // 计算成本节省（优先使用任务自带的成本字段）
  let estimatedCost = parseFloat(manualStats.total_estimated_cost) || 0;
  let actualCost = parseFloat(manualStats.total_actual_cost) || 0;
  let savedCost = parseFloat(manualStats.total_saved_cost) || 0;
  
  // 回退逻辑：如果没有成本字段，动态计算
  if (estimatedCost === 0 && manualHours > 0) {
    estimatedCost = manualHours * HOURLY_SALARY;
    actualCost = autoHours * HOURLY_SALARY;
    savedCost = Math.max(0, estimatedCost - actualCost);
  }
  // 3. 查询质量数据（stat_date 存的是 CST 00:00，需 CONVERT_TZ 对齐 evaluation_reports.created_at）
  const qualitySql = `
    SELECT
      COUNT(*) as evaluation_count,
      SUM(CASE WHEN overall_score >= 60 THEN 1 ELSE 0 END) as quality_pass_count,
      AVG(overall_score) as avg_overall_score,
      AVG(quality_score) as avg_quality_score,
      SUM(has_artifact) as deliverable_count,
      SUM(CASE WHEN deliverable_score IS NOT NULL THEN 1 ELSE 0 END) as deliverable_scored,
      AVG(deliverable_score) as avg_deliverable_score
    FROM evaluation_reports
    WHERE DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = ?
      AND overall_score IS NOT NULL
  `;
  const qualityRows = await query(qualitySql, [date]);
  const qualityStats = qualityRows[0] || {};
  const evaluationCount = parseInt(qualityStats.evaluation_count) || 0;
  const qualityPassCount = parseInt(qualityStats.quality_pass_count) || 0;
  const avgOverallScore = parseFloat(parseFloat(qualityStats.avg_overall_score || 0).toFixed(2));
  const deliverableCount = parseInt(qualityStats.deliverable_count) || 0;
  const deliverableScored = parseInt(qualityStats.deliverable_scored) || 0;
  const avgDeliverableScore = parseFloat(parseFloat(qualityStats.avg_deliverable_score || 0).toFixed(2));
  const avgQualityScore = parseFloat(parseFloat(qualityStats.avg_quality_score || 0).toFixed(2));
  const qualityPassRate = evaluationCount > 0
    ? parseFloat((qualityPassCount / evaluationCount * 100).toFixed(2))
    : 0;

  // 4. 写入日统计（含质量维度）
  await statsDAO.upsertTaskDailyStats(date, {
    total_tasks: taskStats.total_tasks || 0,
    completed_tasks: taskStats.completed_tasks || 0,
    failed_tasks: taskStats.failed_tasks || 0,
    timeout_tasks: taskStats.timeout_tasks || 0,
    avg_duration_minutes: taskStats.avg_duration_minutes || 0,
    total_duration_minutes: taskStats.total_duration_minutes || 0,
    manual_hours: manualHours,
    auto_hours: autoHours,
    saved_hours: savedHours,
    efficiency_rate: efficiencyRate,
    estimated_cost: estimatedCost,
    actual_cost: actualCost,
    saved_cost: savedCost,
    evaluation_count: evaluationCount,
    quality_pass_count: qualityPassCount,
    quality_pass_rate: qualityPassRate,
    avg_overall_score: avgOverallScore,
    avg_quality_score: avgQualityScore,
    deliverable_count: deliverableCount,
    deliverable_scored: deliverableScored,
    avg_deliverable_score: avgDeliverableScore
  });
  
  // 5. 聚合智能体统计
  const agentStatsSql = `
    SELECT 
      agent_id,
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
      AVG(CASE WHEN status = 'completed' 
          THEN TIMESTAMPDIFF(MINUTE, created_at, completed_at) 
          ELSE NULL END) as avg_duration_minutes
    FROM tasks
    WHERE DATE(created_at) = ?
    GROUP BY agent_id
  `;
  const agentRows = await query(agentStatsSql, [date]);

  // Agent 名称映射（与 server.js 中 AGENTS 保持同步）
  const AGENT_NAMES = {
    'test-master': '测试主控',
    'test-requirement-analyzer': '需求分析',
    'test-case-generator': '测试用例生成',
    'test-data-generator': '测试数据生成',
    'defect-analyzer': '缺陷分析',
    'test-reporter': '测试报告生成',
    'data-masking': '数据脱敏',
    'test-script-generator': '测试脚本生成',
    'ui-e2e-executor': 'UI/E2E测试',
    'api-executor': 'API测试',
    'test-scheme-generator': '测试方案生成',
    'ai-quality-reviewer-1': 'AI质量审核-1',
    'ai-quality-reviewer-2': 'AI质量审核-2',
    'ai-quality-reviewer-3': 'AI质量审核-3',
    'ai-evaluation-agent': 'AI评估智能体(人工)',
  };
  
  for (const row of agentRows) {
    const agentName = AGENT_NAMES[row.agent_id] || row.agent_id;

    // 获取该智能体的平均评估分数（含三层子分，需 CONVERT_TZ 对齐时区）
    const scoreSql = `
      SELECT
        AVG(overall_score) as avg_score,
        AVG(capability_score) as avg_capability_score,
        AVG(business_score) as avg_business_score,
        SUM(has_artifact) as deliverable_count,
        AVG(deliverable_score) as avg_deliverable_score
      FROM evaluation_reports
      WHERE agent_id = ?
        AND DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = ?
        AND overall_score IS NOT NULL
    `;
    const scoreRows = await query(scoreSql, [row.agent_id, date]);
    const scoreStats = scoreRows[0] || {};
    const avgScore = parseFloat(parseFloat(scoreStats.avg_score || 0).toFixed(2));
    const avgCapScore = parseFloat(parseFloat(scoreStats.avg_capability_score || 0).toFixed(2));
    const avgBizScore = parseFloat(parseFloat(scoreStats.avg_business_score || 0).toFixed(2));
    const agentDeliverableCount = parseInt(scoreStats.deliverable_count) || 0;
    const agentAvgDeliverableScore = parseFloat(parseFloat(scoreStats.avg_deliverable_score || 0).toFixed(2));

    await statsDAO.upsertAgentDailyStats(date, row.agent_id, agentName, {
      total_tasks: row.total_tasks,
      completed_tasks: row.completed_tasks,
      failed_tasks: row.failed_tasks,
      avg_duration_minutes: row.avg_duration_minutes || 0,
      avg_score: avgScore,
      avg_capability_score: avgCapScore,
      avg_business_score: avgBizScore,
      deliverable_count: agentDeliverableCount,
      avg_deliverable_score: agentAvgDeliverableScore
    });
  }
  
  // 6. 聚合用户统计
  const userStatsSql = `
    SELECT 
      t.user_id,
      u.username,
      COUNT(*) as total_tasks,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
      AVG(CASE WHEN t.status = 'completed' 
          THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.completed_at) 
          ELSE NULL END) as avg_duration_minutes
    FROM tasks t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE DATE(t.created_at) = ?
    GROUP BY t.user_id, u.username
  `;
  const userRows = await query(userStatsSql, [date]);
  
  for (const row of userRows) {
    await statsDAO.upsertUserDailyStats(date, row.user_id, row.username, {
      total_tasks: row.total_tasks,
      completed_tasks: row.completed_tasks,
      failed_tasks: row.failed_tasks,
      avg_duration_minutes: row.avg_duration_minutes || 0
    });
  }
  
  // 7. 更新总体统计快照
  const totalStatsSql = `
    SELECT 
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as total_completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as total_failed
    FROM tasks
  `;
  const totalRows = await query(totalStatsSql);
  const totalStats = totalRows[0] || {};
  
  const savedStatsSql = `
    SELECT 
      SUM(saved_hours) as total_saved_hours,
      SUM(saved_cost) as total_saved_cost
    FROM task_daily_stats
  `;
  const savedRows = await query(savedStatsSql);
  const savedStats = savedRows[0] || {};
  
  const userCountSql = 'SELECT COUNT(DISTINCT id) as total_users FROM users';
  const userCountRows = await query(userCountSql);
  const totalUsers = userCountRows[0]?.total_users || 0;
  
  await statsDAO.updateOverallStat('total_tasks', totalStats.total_tasks || 0);
  await statsDAO.updateOverallStat('total_completed', totalStats.total_completed || 0);
  await statsDAO.updateOverallStat('total_failed', totalStats.total_failed || 0);
  await statsDAO.updateOverallStat('total_users', totalUsers);
  await statsDAO.updateOverallStat('total_saved_hours', savedStats.total_saved_hours || 0);
  await statsDAO.updateOverallStat('total_saved_cost', savedStats.total_saved_cost || 0);
  await statsDAO.updateOverallStat('last_updated', new Date().toISOString());
  
  console.log(`[Stats] ${date} 聚合完成: ${taskStats.total_tasks}个任务, 节省${savedHours.toFixed(2)}小时`);
}

/**
 * 聚合历史数据（首次运行或补数据）
 */
export async function aggregateHistory(days = 30) {
  console.log(`[Stats] 开始聚合最近 ${days} 天的历史数据...`);
  
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    
    await aggregateDailyStats(dateStr);
  }
  
  console.log(`[Stats] 历史数据聚合完成`);
}

/**
 * 定时聚合任务（每天凌晨1点执行）
 */
export function scheduleAggregation() {
  // 每天凌晨1点聚合昨天的数据
  const scheduleNextAggregation = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(1, 0, 0, 0);
    
    const delay = tomorrow.getTime() - now.getTime();
    
    setTimeout(async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);
      
      try {
        await aggregateDailyStats(dateStr);
      } catch (e) {
        console.error('[Stats] 聚合失败:', e);
      }
      
      // 安排下一次
      scheduleNextAggregation();
    }, delay);
    
    console.log(`[Stats] 下次聚合时间: ${tomorrow.toISOString()}`);
  };
  
  scheduleNextAggregation();
}

export default {
  aggregateDailyStats,
  aggregateHistory,
  scheduleAggregation
};
