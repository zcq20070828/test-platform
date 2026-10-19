/**
 * data-collector.js — 评估数据自动收集器
 * 
 * 自动从以下来源采集智能体输出数据：
 * 1. ~/.qclaw/data/tasks.json — 任务历史
 * 2. ~/.qclaw/data/evaluations/ — 已有评估报告（用于趋势分析）
 * 3. MySQL 数据库（test_platform.evaluation_* 表，通过 evaluation-db.js 访问）
 * 4. ~/.qclaw/data/deliverables/ — 交付件（可选）
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// mysql2 依赖解析（2026-10-19 修复）：
//   本 skill 位于 qclaw-skills/ 目录下，Node 默认只向上查找祖先 node_modules，
//   找不到「兄弟目录」test-platform/backend/node_modules，直接 import 'mysql2/promise'
//   会抛 Cannot find package 'mysql2'，导致 getEvalEngine() 加载失败
//   → 表现为「评估引擎未加载」，手动评估与定时评估全部不可用。
//   与 ui-e2e-executor 的 playwright 解析同做法：用 createRequire 显式指定根目录。
const _requireFromBackend = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', 'backend', 'package.json')
);
const mysql = _requireFromBackend('mysql2/promise');

// 数据库模块
import * as evalDb from './evaluation-db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || '/Users/zhaochengqing';
const TASKS_FILE = path.join(HOME, '.qclaw', 'data', 'tasks.json');
const EVAL_DIR   = path.join(HOME, '.qclaw', 'data', 'evaluations');

// MySQL 连接配置（复用 backend/database/db.js 的配置）
const MYSQL_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'appuser',
  password: process.env.DB_PASSWORD || 'apppwd123',
  database: process.env.DB_NAME     || 'test_platform',
  charset:  'utf8mb4',
};

/**
 * 从 MySQL 加载任务数据（权威实时数据源）
 * @returns {CollectedTask[]}
 */
async function loadTasksFromMySQL(daysBack = 30) {
  let pool;
  try {
    pool = mysql.createPool(MYSQL_CONFIG);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const [rows] = await pool.execute(
      `SELECT id, agent_id, type, status, input, result, created_at, completed_at
       FROM tasks
       WHERE status = 'completed'
         AND (created_at >= ? OR completed_at >= ?)
       ORDER BY completed_at DESC
       LIMIT 500`,
      [cutoff, cutoff]
    );

    await pool.end();

    return rows.map(row => {
      const result = row.result || '';
      const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
      const completedAt = row.completed_at ? new Date(row.completed_at).getTime() : 0;
      return {
        taskId:    row.id || '',
        agentId:   row.agent_id || '',
        type:      row.type || 'general',
        input:     row.input || '',
        output:    typeof result === 'string' ? result : JSON.stringify(result || ''),
        status:    row.status || 'unknown',
        createdAt,
        updatedAt: completedAt || createdAt,
        duration:  completedAt && createdAt ? completedAt - createdAt : 0,
      };
    });
  } catch (err) {
    if (pool) await pool.end().catch(() => {});
    console.warn('[DataCollector] MySQL 读取失败:', err.message);
    return null; // 返回 null 表示需要降级
  }
}

/**
 * 按 taskId 从 MySQL 加载单个任务
 * @returns {CollectedTask | null}
 */
export async function loadTaskFromMySQL(taskId) {
  let pool;
  try {
    pool = mysql.createPool(MYSQL_CONFIG);
    const [rows] = await pool.execute(
      `SELECT id, agent_id, type, status, input, result, created_at, completed_at
       FROM tasks WHERE id = ?`,
      [taskId]
    );
    await pool.end();
    if (!rows.length) return null;

    const row = rows[0];
    const result = row.result || '';
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
    const completedAt = row.completed_at ? new Date(row.completed_at).getTime() : 0;
    return {
      taskId:    row.id || '',
      agentId:   row.agent_id || '',
      type:      row.type || 'general',
      input:     row.input || '',
      output:    typeof result === 'string' ? result : JSON.stringify(result || ''),
      status:    row.status || 'unknown',
      createdAt,
      updatedAt: completedAt || createdAt,
      duration:  completedAt && createdAt ? completedAt - createdAt : 0,
    };
  } catch (err) {
    if (pool) await pool.end().catch(() => {});
    console.warn('[DataCollector] MySQL loadTaskById 失败:', err.message);
    return null;
  }
}

/**
 * @typedef {Object} CollectedTask
 * @property {string} taskId
 * @property {string} agentId
 * @property {string} type
 * @property {string} input
 * @property {string} output
 * @property {string} status
 * @property {number} createdAt  — ms timestamp
 * @property {number} updatedAt — ms timestamp
 * @property {number} duration  — ms (updatedAt - createdAt)
 */

/**
 * @typedef {Object} CollectionOptions
 * @property {string[]} [agentIds]        — 限定哪些智能体，默认全部
 * @property {string[]} [taskTypes]      — 限定任务类型
 * @property {number}   [daysBack]       — 向前取多少天，默认 30
 * @property {number}   [limitPerAgent]  — 每智能体最多取多少条，默认 20
 * @property {string}   [status]         — 限定任务状态，默认 completed
 */

/**
 * 从 tasks.json 加载原始任务数据
 * @returns {CollectedTask[]}
 */
export function loadRawTasks() {
  if (!fs.existsSync(TASKS_FILE)) {
    console.warn(`[DataCollector] tasks.json not found: ${TASKS_FILE}`);
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.map(t => ({
      taskId:    t.id   || t.taskId  || '',
      agentId:   t.agent || '',
      type:      t.type  || 'general',
      input:     t.input  || '',
      // 确保 output 是字符串（可能是对象，需要序列化）
      output:    typeof t.result === 'string' ? t.result 
                : typeof t.output === 'string' ? t.output 
                : JSON.stringify(t.result || t.output || ''),
      status:    t.status || 'unknown',
      createdAt: t.createdAt ? new Date(t.createdAt).getTime() : 0,
      updatedAt: t.updatedAt ? new Date(t.updatedAt).getTime() : 0,
      duration:  t.duration || (
        (t.createdAt && t.updatedAt)
          ? new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime()
          : 0
      ),
    }));
  } catch (e) {
    console.error(`[DataCollector] Failed to parse tasks.json:`, e.message);
    return [];
  }
}

/**
 * 根据选项过滤任务
 * @param {CollectedTask[]} tasks
 * @param {CollectionOptions} opts
 */
function filterTasks(tasks, opts = {}) {
  const now = Date.now();
  const daysBack = opts.daysBack ?? 30;
  const cutoff = now - daysBack * 24 * 3600 * 1000;

  return tasks.filter(t => {
    if (t.status !== (opts.status || 'completed') && t.status !== 'review_passed') return false;
    if (t.updatedAt < cutoff) return false;
    if (opts.agentIds?.length && !opts.agentIds.includes(t.agentId)) return false;
    if (opts.taskTypes?.length && !opts.taskTypes.includes(t.type)) return false;
    // 跳过无输出的任务（确保 output 是字符串）
    const outputStr = typeof t.output === 'string' ? t.output : JSON.stringify(t.output || '');
    if (!outputStr || outputStr.trim().length < 50) return false;
    return true;
  });
}

/**
 * 按智能体分组，每智能体取最新 N 条
 * @param {CollectedTask[]} tasks
 * @param {number} limitPerAgent
 */
function groupByAgent(tasks, limitPerAgent = 20) {
  const groups = {};
  for (const t of tasks) {
    if (!groups[t.agentId]) groups[t.agentId] = [];
    groups[t.agentId].push(t);
  }
  for (const agentId of Object.keys(groups)) {
    // 按 updatedAt 降序（最新的在前）
    groups[agentId].sort((a, b) => b.updatedAt - a.updatedAt);
    groups[agentId] = groups[agentId].slice(0, limitPerAgent);
  }
  return groups;
}

/**
 * 收集历史评估报告（用于趋势分析）
 * 优先从数据库读取，失败回退到文件
 * @param {string} agentId
 * @param {number} daysBack
 * @returns {Object[]} — 评估报告对象数组
 */
export function loadEvaluationHistory(agentId, daysBack = 90) {
  // 优先从数据库读取
  try {
    const rows = evalDb.getAgentReports(agentId, 100);
    if (rows && rows.length > 0) {
      const now = Date.now();
      const cutoff = now - daysBack * 24 * 3600 * 1000;
      
      return rows
        .filter(r => {
          const ts = new Date(r.timestamp).getTime();
          return ts >= cutoff;
        })
        .map(r => evalDb.dbRecordToReport(r))
        .sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
    }
  } catch (dbError) {
    console.warn('[DataCollector] DB read failed, fallback to file:', dbError.message);
  }
  
  // 回退到文件读取
  const agentDir = path.join(EVAL_DIR, agentId);
  if (!fs.existsSync(agentDir)) return [];

  const now = Date.now();
  const cutoff = now - daysBack * 24 * 3600 * 1000;
  const reports = [];

  try {
    const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(agentDir, file), 'utf-8');
        // 支持 JSON Lines（每行一个）或单对象 JSON
        const lines = content.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const report = JSON.parse(line);
          if (report.timestamp) {
            const ts = new Date(report.timestamp).getTime();
            if (ts >= cutoff) reports.push(report);
          }
        }
      } catch { /* skip invalid file */ }
    }
  } catch { /* dir not accessible */ }

  return reports.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * 生成评估指标趋势
 * @param {Object[]} history
 * @param {string} metricPath — 如 "layers.capability.score"
 */
function calcTrend(history, metricPath) {
  if (history.length < 2) return { current: null, delta: 0, trend: 'stable' };
  const values = history.map(r => metricPath.split('.').reduce((obj, k) => obj?.[k], r)).filter(v => typeof v === 'number');
  if (values.length < 2) return { current: values[0] ?? null, delta: 0, trend: 'stable' };
  const current = values[values.length - 1];
  const prev    = values[values.length - 2];
  const delta   = Math.round(current - prev);
  const trend    = delta > 2 ? 'up' : delta < -2 ? 'down' : 'stable';
  return { current, delta, trend };
}

/**
 * 主函数：自动收集评估数据
 * @param {CollectionOptions} opts
 * @returns {Object} — 按智能体分组的待评估数据 + 统计摘要
 */
export function autoCollect(opts = {}) {
  const allTasks = loadRawTasks();
  const filtered = filterTasks(allTasks, opts);
  const grouped  = groupByAgent(filtered, opts.limitPerAgent);

  // 汇总统计
  const stats = {};
  for (const [agentId, tasks] of Object.entries(grouped)) {
    stats[agentId] = {
      taskCount:     tasks.length,
      totalDuration: tasks.reduce((s, t) => s + t.duration, 0),
      avgDuration:   tasks.length ? Math.round(tasks.reduce((s, t) => s + t.duration, 0) / tasks.length) : 0,
      oldestTask:    tasks.length ? new Date(tasks[tasks.length - 1].updatedAt).toISOString() : null,
      newestTask:    tasks.length ? new Date(tasks[0].updatedAt).toISOString() : null,
    };
  }

  // 趋势数据（从历史评估报告提取）
  const trends = {};
  for (const agentId of Object.keys(grouped)) {
    const history = loadEvaluationHistory(agentId);
    trends[agentId] = {
      overall:    calcTrend(history, 'overall.score'),
      capability: calcTrend(history, 'layers.capability.score'),
      quality:    calcTrend(history, 'layers.quality.score'),
      business:   calcTrend(history, 'layers.business.score'),
    };
  }

  const collectedAt = new Date().toISOString();
  
  // 保存收集的任务数据到数据库
  try {
    const sessionId = `session-${Date.now()}`;
    const allCollectedTasks = Object.values(grouped).flat();
    
    // 保存会话
    evalDb.saveCollectionSession(sessionId, opts, {
      totalTasks: filtered.length,
      agentsCovered: Object.keys(grouped).length,
      collectedAt
    });
    
    // 保存任务数据
    evalDb.saveCollectedTasks(allCollectedTasks, collectedAt);
    
    console.log(`[DataCollector] Saved ${allCollectedTasks.length} tasks to DB, session: ${sessionId}`);
  } catch (dbError) {
    console.error('[DataCollector] Failed to save to DB:', dbError.message);
  }

  return {
    groups:       grouped,
    stats,
    trends,
    totalTasks:   filtered.length,
    agentsCovered: Object.keys(grouped).length,
    collectedAt,
  };
}

/**
 * 异步版主函数：优先从 MySQL 加载数据，失败时回退到 tasks.json
 * 用于 evaluateAll 等异步调用场景
 * @param {CollectionOptions} opts
 * @returns {Promise<Object>}
 */
export async function autoCollectAsync(opts = {}) {
  let allTasks = null;
  let source = '';

  // 1. 优先从 MySQL 读取（实时数据）
  try {
    const mysqlTasks = await loadTasksFromMySQL(opts.daysBack || 30);
    if (mysqlTasks && mysqlTasks.length > 0) {
      allTasks = mysqlTasks;
      source = 'mysql';
      console.log(`[DataCollector] MySQL 提供 ${allTasks.length} 条任务`);
    }
  } catch (mysqlErr) {
    console.warn('[DataCollector] MySQL 读取失败，降级到 tasks.json:', mysqlErr.message);
  }

  // 2. MySQL 无数据时降级到 tasks.json
  if (!allTasks || allTasks.length === 0) {
    allTasks = loadRawTasks();
    source = 'json';
    console.log(`[DataCollector] 使用 tasks.json 提供 ${allTasks.length} 条任务`);
  }

  const filtered = filterTasks(allTasks, opts);
  const grouped  = groupByAgent(filtered, opts.limitPerAgent);

  // 汇总统计
  const stats = {};
  for (const [agentId, tasks] of Object.entries(grouped)) {
    stats[agentId] = {
      taskCount:     tasks.length,
      totalDuration: tasks.reduce((s, t) => s + t.duration, 0),
      avgDuration:   tasks.length ? Math.round(tasks.reduce((s, t) => s + t.duration, 0) / tasks.length) : 0,
      oldestTask:    tasks.length ? new Date(tasks[tasks.length - 1].updatedAt).toISOString() : null,
      newestTask:    tasks.length ? new Date(tasks[0].updatedAt).toISOString() : null,
    };
  }

  // 趋势数据
  const trends = {};
  for (const agentId of Object.keys(grouped)) {
    const history = loadEvaluationHistory(agentId);
    trends[agentId] = {
      overall:    calcTrend(history, 'overall.score'),
      capability: calcTrend(history, 'layers.capability.score'),
      quality:    calcTrend(history, 'layers.quality.score'),
      business:   calcTrend(history, 'layers.business.score'),
    };
  }

  const collectedAt = new Date().toISOString();

  // 保存到 DB
  try {
    evalDb.saveCollectionSession(`session-${Date.now()}`, opts, {
      totalTasks: filtered.length, agentsCovered: Object.keys(grouped).length, collectedAt, source
    });
    evalDb.saveCollectedTasks(Object.values(grouped).flat(), collectedAt);
  } catch (dbError) {
    console.warn('[DataCollector] 保存到评估 DB 失败:', dbError.message);
  }

  return {
    groups:       grouped,
    stats,
    trends,
    totalTasks:   filtered.length,
    agentsCovered: Object.keys(grouped).length,
    collectedAt,
    source,
  };
}

/**
 * 将原始任务数据转换为 evaluation-engine 所需的 EvaluationInput 格式
 * @param {CollectedTask} task
 * @returns {Object}
 */
export function toEvaluationInput(task) {
  return {
    agentId:  task.agentId,
    taskId:  task.taskId,
    taskType: mapAgentToTaskType(task.agentId),
    output:  task.output,
    metadata: {
      duration:    task.duration,
      outputLength: task.output.length,
      createdAt:   task.createdAt,
    },
  };
}

/**
 * 根据 agentId 推断 taskType
 */
function mapAgentToTaskType(agentId) {
  const map = {
    'test-requirement-analyzer': 'requirement-analysis',
    'test-case-generator':        'case-generation',
    'api-executor':               'api-test',
    'ui-e2e-executor':            'ui-test',
    'report-generator':           'report-generation',
    'defect-analyzer':           'defect-analysis',
    'data-masking':              'data-masking',
    'test-master':               'requirement-analysis',
    'test-scheme-generator':     'requirement-analysis',
    'test-data-generator':        'case-generation',
  };
  return map[agentId] || 'requirement-analysis';
}

/**
 * 打印汇总报告（调试用）
 */
export function printCollectionSummary(data) {
  console.log(`\n[DataCollector] Collected ${data.totalTasks} tasks from ${data.agentsCovered} agents`);
  for (const [agentId, stats] of Object.entries(data.stats)) {
    console.log(`  ${agentId}: ${stats.taskCount} tasks, avg ${(stats.avgDuration/1000).toFixed(1)}s`);
    const t = data.trends[agentId];
    if (t?.overall?.current !== null) {
      console.log(`    Trend: overall=${t.overall.trend}(${t.overall.delta > 0 ? '+' : ''}${t.overall.delta}), cap=${t.capability.trend}, qual=${t.quality.trend}, biz=${t.business.trend}`);
    }
  }
}
