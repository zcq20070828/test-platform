/**
 * evaluation-engine.js
 * 三层五级评估引擎
 */

import {
  CAPABILITY_METRICS,
  QUALITY_METRICS,
  BUSINESS_METRICS,
  LAYER_WEIGHTS,
  GRADE_THRESHOLDS,
  LEVEL_MAP,
} from './metrics-definition.js';

// 数据库模块
import * as evalDb from './evaluation-db.js';

// 存储根目录（兼容旧文件存储）
const DATA_ROOT = `${process.env.HOME || '/root'}/.qclaw/data/evaluations`;

import fs from 'fs';
import path from 'path';
import { mkdirSync, existsSync, readFileSync, appendFileSync, readdirSync, writeFileSync } from 'fs';

// ─────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────

/**
 * 主评估函数
 * @param {EvaluationInput} input
 * @param {Object} opts — { scope?: string[] }
 * @returns {Promise<EvaluationReport>}
 */
export async function evaluate(input, opts = {}) {
  const { agentId, taskId, taskType, output, metadata = {} } = input;
  const { scope = ['capability', 'quality', 'business'] } = opts;
  const timestamp = new Date().toISOString();

  // 根据 scope 确定启用的层
  const activeLayers = {
    capability: scope.includes('capability'),
    quality: scope.includes('quality'),
    business: scope.includes('business')
  };

  // 三层评估（按 scope 过滤）
  const capabilityMetrics = activeLayers.capability ? assessCapability(output, metadata) : [];
  const qualityMetrics = activeLayers.quality ? assessQuality(output, taskType) : [];
  const businessMetrics = activeLayers.business ? assessBusinessValue(output, taskType, metadata) : [];

  // 计算各层综合分
  const capabilityScore = activeLayers.capability ? calculateScoreLayer(capabilityMetrics) : 0;
  const qualityScore = activeLayers.quality ? calculateScoreLayer(qualityMetrics) : 0;
  const businessScore = activeLayers.business ? calculateScoreLayer(businessMetrics) : 0;

  // 根据 scope 计算动态权重
  const totalBaseWeight = (activeLayers.capability ? LAYER_WEIGHTS.capability : 0) +
                          (activeLayers.quality ? LAYER_WEIGHTS.quality : 0) +
                          (activeLayers.business ? LAYER_WEIGHTS.business : 0);
  const dynamicWeights = totalBaseWeight > 0 ? {
    capability: activeLayers.capability ? LAYER_WEIGHTS.capability / totalBaseWeight : 0,
    quality: activeLayers.quality ? LAYER_WEIGHTS.quality / totalBaseWeight : 0,
    business: activeLayers.business ? LAYER_WEIGHTS.business / totalBaseWeight : 0
  } : LAYER_WEIGHTS;

  // 加权总分
  const overallScore = Math.round(
    capabilityScore * dynamicWeights.capability +
    qualityScore * dynamicWeights.quality +
    businessScore * dynamicWeights.business
  );

  const grade = determineGrade(overallScore);
  const level = LEVEL_MAP[grade];

  // 趋势分析
  const trends = await assessTrends(agentId, [capabilityScore, qualityScore, businessScore]);

  // 建议
  const allMetrics = [...capabilityMetrics, ...qualityMetrics, ...businessMetrics];
  const recommendations = generateRecommendations(allMetrics, grade);

  const report = {
    agentId,
    taskId: taskId || null,
    taskType,
    timestamp,
    overall: { score: overallScore, grade, level },
    layers: {
      capability: { score: capabilityScore, metrics: capabilityMetrics },
      quality: { score: qualityScore, metrics: qualityMetrics },
      business: { score: businessScore, metrics: businessMetrics },
    },
    inputMetadata: metadata,
    trends,
    recommendations,
    nextEvaluationAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  // 持久化
  await saveEvaluationReport(report);

  return report;
}

/**
 * 评估能力层
 */
export function assessCapability(text, metadata) {
  return Object.entries(CAPABILITY_METRICS).map(([key, metric]) => ({
    key,
    name: metric.name,
    score: Math.round(metric.scoring(text, metadata)),
    weight: metric.weight,
  }));
}

/**
 * 评估质量层
 */
export function assessQuality(text, taskType) {
  return Object.entries(QUALITY_METRICS).map(([key, metric]) => ({
    key,
    name: metric.name,
    score: Math.round(metric.scoring(text, taskType)),
    weight: metric.weight,
  }));
}

/**
 * 评估业务价值层
 */
export function assessBusinessValue(text, taskType, metadata) {
  return Object.entries(BUSINESS_METRICS).map(([key, metric]) => ({
    key,
    name: metric.name,
    score: Math.round(metric.scoring(text, metadata)),
    weight: metric.weight,
  }));
}

/**
 * 计算某层综合分
 * @param {Array<{score: number, weight: number}>} metrics
 */
export function calculateScoreLayer(metrics) {
  if (!metrics || metrics.length === 0) return 0;
  const totalWeight = metrics.reduce((sum, m) => sum + m.weight, 0);
  if (totalWeight === 0) return 0;
  return Math.round(
    metrics.reduce((sum, m) => sum + m.score * (m.weight / totalWeight), 0)
  );
}

/**
 * 根据总分确定等级
 */
export function determineGrade(score) {
  const threshold = GRADE_THRESHOLDS.find(t => score >= t.min);
  return threshold ? threshold.grade : 'D';
}

/**
 * 生成改进建议
 */
export function generateRecommendations(metrics, grade) {
  const recommendations = [];

  // 按得分升序，找出最差的指标
  const sorted = [...metrics].sort((a, b) => a.score - b.score);
  const weakest = sorted.slice(0, 3);

  weakest.forEach(m => {
    if (m.score < 60) {
      recommendations.push(...getMetricSuggestion(m.key, m.score));
    }
  });

  // 等级警告
  if (grade === 'D') {
    recommendations.unshift('⚠️ 当前评分低于 60 分（等级 D），建议立即进行专项优化并重新评估。');
  } else if (grade === 'C') {
    recommendations.unshift('📌 当前评分处于及格线（等级 C），建议关注以下短板进行改进。');
  }

  // 去重
  return [...new Set(recommendations)];
}

/**
 * 针对具体指标给出建议
 */
function getMetricSuggestion(key, score) {
  const suggestions = {
    intentAccuracy: [
      '增加结构化输出：使用 Markdown 表格、JSON、列表等格式组织信息。',
      '明确任务意图后再执行，避免偏离用户需求。',
    ],
    toolInvocationRate: [
      '检查工具调用链是否完整，确保所需工具均已正确调用。',
      '如无需工具调用，请确认任务是否过于简单或 Agent 理解有误。',
    ],
    contextEfficiency: [
      '减少冗余输出，提升信息密度。',
      '适当控制回复长度，在保证完整性的同时精简表达。',
    ],
    errorRecoveryRate: [
      '增加错误重试机制和降级方案。',
      '对可能的异常情况提前做防御性处理。',
    ],
    syntaxAccuracy: [
      '仔细检查输出语法，确保代码块结构完整。',
      '使用 linter/formatter 自动格式化输出内容。',
    ],
    logicCompleteness: [
      '对照需求检查是否覆盖所有关键逻辑分支。',
      '补充遗漏的边界条件和异常路径。',
    ],
    standardCompliance: [
      '参考 ISTQB/IEEE 829 标准补充必要字段。',
      '完善测试文档的规范格式。',
    ],
    executabilityRate: [
      '将描述性内容转化为可执行代码/API/命令。',
      '提供具体的输入参数和预期输出示例。',
    ],
    defectDiscoveryRate: [
      '扩大测试范围以发现更多潜在缺陷。',
      '结合不同测试策略（边界值、等价类、场景法）提升缺陷发现率。',
    ],
    coverageImprovement: [
      '量化覆盖率指标，明确当前覆盖率并设定提升目标。',
      '通过覆盖率分析工具识别未覆盖的代码/需求。',
    ],
    efficiencyGain: [
      '记录并对比自动化 vs 人工的效率数据。',
      '持续优化自动化脚本，减少无效执行时间。',
    ],
    accuracyRate: [
      '建立缺陷分类标准，减少误报和漏报。',
      '引入专家评审机制提升缺陷判定准确性。',
    ],
  };
  return suggestions[key] || [`建议优化「${key}」相关能力，当前得分 ${score} 分。`];
}

/**
 * 分析指标趋势（与历史数据对比）
 * @param {string} agentId
 * @param {number[]} currentScores [capabilityScore, qualityScore, businessScore]
 */
export async function assessTrends(agentId, currentScores) {
  const history = await getEvaluationHistory(agentId, 7); // 近 7 天

  const layerKeys = ['capability', 'quality', 'business'];
  const trends = [];

  layerKeys.forEach((layer, i) => {
    const historicalLayerScores = history
      .map(r => r.layers[layer]?.score)
      .filter(s => s !== undefined);

    if (historicalLayerScores.length === 0) {
      trends.push({ metric: layer, delta: 0, trend: 'stable', currentScore: currentScores[i] });
      return;
    }

    const avgHistory = historicalLayerScores.reduce((a, b) => a + b, 0) / historicalLayerScores.length;
    const delta = Math.round(currentScores[i] - avgHistory);

    let trend = 'stable';
    if (delta > 3) trend = 'up';
    else if (delta < -3) trend = 'down';

    trends.push({ metric: layer, delta, trend, currentScore: currentScores[i], avgHistory: Math.round(avgHistory) });
  });

  return trends;
}

/**
 * 获取评估历史
 * @param {string} agentId
 * @param {number} days
 */
export async function getEvaluationHistory(agentId, days = 7) {
  // 优先从数据库读取
  try {
    const rows = evalDb.getAgentReports(agentId, 100);
    if (rows && rows.length > 0) {
      const now = Date.now();
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      
      return rows
        .filter(r => {
          const ts = new Date(r.timestamp).getTime();
          return ts >= cutoff;
        })
        .map(r => evalDb.dbRecordToReport(r))
        .sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    }
  } catch (dbError) {
    console.warn('[EvalEngine] DB read failed, fallback to file:', dbError.message);
  }
  
  // 回退到文件读取
  const agentDir = path.join(DATA_ROOT, agentId);
  if (!existsSync(agentDir)) return [];

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = (readdirSync(agentDir).filter(f => f.endsWith('.json')) || []);

  const reports = [];
  for (const file of files) {
    try {
      const filePath = path.join(agentDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const report = JSON.parse(content);
      if (new Date(report.timestamp).getTime() >= cutoff) {
        reports.push(report);
      }
    } catch {
      // ignore parse errors
    }
  }

  return reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * 获取所有评估报告列表（摘要）
 */
export async function listEvaluationReports(agentId, limit = 50) {
  const agentDir = path.join(DATA_ROOT, agentId);
  if (!existsSync(agentDir)) return [];

  const files = (readdirSync(agentDir).filter(f => f.endsWith('.json')) || [])
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  return files.map(file => {
    try {
      const content = readFileSync(path.join(agentDir, file), 'utf-8');
      const report = JSON.parse(content);
      return {
        id: report.timestamp,
        agentId: report.agentId,
        timestamp: report.timestamp,
        score: report.overall.score,
        grade: report.overall.grade,
        taskType: report.taskType,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * 保存评估报告到磁盘
 */
export async function saveEvaluationReport(report) {
  const agentDir = path.join(DATA_ROOT, report.agentId);
  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true });
  }

  const timestamp = report.timestamp.replace(/[:.]/g, '-');
  const filePath = path.join(agentDir, `${timestamp}.json`);

  // 写入 JSON 文件
  writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  
  // 同时保存到数据库
  try {
    await evalDb.saveReport(report);
    console.log(`[EvalDB] Saved report: ${report.agentId} @ ${report.timestamp}`);
  } catch (dbError) {
    console.error('[EvalDB] Failed to save report to DB:', dbError.message);
  }

  return filePath;
}

/**
 * 获取单份报告详情
 */
export async function getReportById(agentId, timestamp) {
  const agentDir = path.join(DATA_ROOT, agentId);
  if (!existsSync(agentDir)) return null;

  const files = readdirSync(agentDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = readFileSync(path.join(agentDir, file), 'utf-8');
      const report = JSON.parse(content);
      if (report.timestamp === timestamp) {
        return report;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * 获取指定指标的历史趋势数据
 */
export async function getMetricTrend(agentId, metricKey, days = 30) {
  const history = await getEvaluationHistory(agentId, days);
  console.log(`[getMetricTrend] agentId=${agentId}, metricKey=${metricKey}, history.length=${history.length}`);

  // metricKey 可能是 layer 名称、具体 metric key 或路径如 "overall.score"
  const dataPoints = history.map(report => {
    let score;
    
    // 处理路径格式（如 "overall.score"）
    if (metricKey === 'overall' || metricKey === 'overall.score' || metricKey.includes('.')) {
      // overall 总分或路径格式（如 overall.score / layers.capability.score）
      score = metricKey.split('.').reduce((obj, k) => obj?.[k], report);
      if (score === undefined) score = report.overall?.score;
    } else if (['capability', 'quality', 'business'].includes(metricKey)) {
      // 层名称
      score = report.layers[metricKey]?.score;
    } else {
      // 遍历所有层的 metrics 找具体指标
      for (const layer of Object.values(report.layers)) {
        const found = layer.metrics?.find(m => m.key === metricKey);
        if (found) { score = found.score; break; }
      }
    }
    
    console.log(`[getMetricTrend] report timestamp=${report.timestamp}, score=${score}`);
    return { timestamp: report.timestamp, score };
  }).filter(d => d.score !== undefined);

  return dataPoints.reverse(); // 从旧到新
}

// ─────────────────────────────────────────
// 便捷评估函数
// ─────────────────────────────────────────

/**
 * 快速评估（不持久化）
 */
export function quickAssess(output, taskType, metadata = {}) {
  // 空输出或过短输出返回低分
  if (!output || output.trim().length < 50) {
    return { overall: { score: 30, grade: 'D' } };
  }
  const capabilityMetrics = assessCapability(output, metadata);
  const qualityMetrics = assessQuality(output, taskType);
  const businessMetrics = assessBusinessValue(output, taskType, metadata);
  const capabilityScore = calculateScoreLayer(capabilityMetrics);
  const qualityScore = calculateScoreLayer(qualityMetrics);
  const businessScore = calculateScoreLayer(businessMetrics);
  const overallScore = Math.round(
    capabilityScore * LAYER_WEIGHTS.capability +
    qualityScore * LAYER_WEIGHTS.quality +
    businessScore * LAYER_WEIGHTS.business
  );
  const grade = determineGrade(overallScore);
  return {
    overall: { score: overallScore, grade, level: LEVEL_MAP[grade] },
    layers: {
      capability: { score: capabilityScore, metrics: capabilityMetrics },
      quality: { score: qualityScore, metrics: qualityMetrics },
      business: { score: businessScore, metrics: businessMetrics },
    },
  };
}

// ─────────────────────────────────────────
// 自动全量评估 — 收集所有智能体最新输出并评估
// ─────────────────────────────────────────

import { autoCollectAsync, toEvaluationInput, loadEvaluationHistory, loadTaskFromMySQL } from './data-collector.js';

/**
 * 自动全量评估所有智能体
 * @param {Object} opts — CollectionOptions + { onProgress?: (agentId, done, total) => void, scope?: string[] }
 * @returns {Promise<Object>} — { agentReports: EvaluationReport[], summary: Object }
 */
export async function evaluateAll(opts = {}) {
  const { onProgress, scope = ['capability', 'quality', 'business'] } = opts;
  const collection = await autoCollectAsync(opts);
  
  // 根据 scope 计算有效权重
  const activeLayers = {
    capability: scope.includes('capability'),
    quality: scope.includes('quality'),
    business: scope.includes('business')
  };
  const activeCount = Object.values(activeLayers).filter(Boolean).length;
  const totalBaseWeight = (activeLayers.capability ? LAYER_WEIGHTS.capability : 0) +
                          (activeLayers.quality ? LAYER_WEIGHTS.quality : 0) +
                          (activeLayers.business ? LAYER_WEIGHTS.business : 0);
  const dynamicWeights = totalBaseWeight > 0 ? {
    capability: activeLayers.capability ? LAYER_WEIGHTS.capability / totalBaseWeight : 0,
    quality: activeLayers.quality ? LAYER_WEIGHTS.quality / totalBaseWeight : 0,
    business: activeLayers.business ? LAYER_WEIGHTS.business / totalBaseWeight : 0
  } : LAYER_WEIGHTS;

  const agentReports = [];
  const agentIds = Object.keys(collection.groups);
  let completed = 0;

  for (const agentId of agentIds) {
    const tasks = collection.groups[agentId];
    if (!tasks || tasks.length === 0) {
      completed++;
      continue;
    }

    // 评估该智能体最新一个任务（代表性输出）
    const latestTask = tasks[0];
    const evalInput  = toEvaluationInput(latestTask);

    // 计算该智能体近期任务的平均分（用于综合评分）
    const taskScores = [];
    for (const task of tasks.slice(0, 5)) {
      const inp = toEvaluationInput(task);
      // 同步轻量评估（直接算分，不走LLM）
      const quick = quickAssess(inp.output, inp.taskType);
      taskScores.push(quick.overall.score);
    }
    const avgScore = taskScores.length
      ? Math.round(taskScores.reduce((a, b) => a + b, 0) / taskScores.length)
      : 0;

    // 深度评估最新任务（传入 scope）
    const deepReport = await evaluate(evalInput, { scope });

    // 用平均分校正最终评分（更客观反映持续能力）
    const finalScore = Math.round(avgScore * 0.4 + deepReport.overall.score * 0.6);
    const grade = determineGrade(finalScore);

    // 历史趋势
    const history = loadEvaluationHistory(agentId, 90);
    const trends = {
      overall:    calcTrendFromHistory(history, 'overall.score'),
      capability: calcTrendFromHistory(history, 'layers.capability.score'),
      quality:    calcTrendFromHistory(history, 'layers.quality.score'),
      business:   calcTrendFromHistory(history, 'layers.business.score'),
    };

    const report = {
      ...deepReport,
      agentId,
      timestamp:     new Date().toISOString(),
      taskCount:     tasks.length,
      avgScore:      avgScore,
      overall: {
        score:  finalScore,
        grade,
        level:  LEVEL_MAP[grade],
      },
      layers: {
        capability: { score: deepReport.layers.capability.score,  metrics: deepReport.layers.capability.metrics },
        quality:     { score: deepReport.layers.quality.score,      metrics: deepReport.layers.quality.metrics },
        business:    { score: deepReport.layers.business.score,     metrics: deepReport.layers.business.metrics },
      },
      trends,
      recommendations: generateRecommendations([...deepReport.layers.capability.metrics, ...deepReport.layers.quality.metrics, ...deepReport.layers.business.metrics], deepReport.overall.grade),
      nextEvaluationAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(), // 7天后
    };

    await saveEvaluationReport(report);
    agentReports.push(report);

    completed++;
    if (onProgress) onProgress(agentId, completed, agentIds.length);
  }

  return {
    agentReports,
    summary: {
      totalAgents:   agentReports.length,
      totalTasks:    collection.totalTasks,
      avgOverall:    agentReports.length
        ? Math.round(agentReports.reduce((s, r) => s + r.overall.score, 0) / agentReports.length)
        : 0,
      gradeDist: {
        S: agentReports.filter(r => r.overall.grade === 'S').length,
        A: agentReports.filter(r => r.overall.grade === 'A').length,
        B: agentReports.filter(r => r.overall.grade === 'B').length,
        C: agentReports.filter(r => r.overall.grade === 'C').length,
        D: agentReports.filter(r => r.overall.grade === 'D').length,
      },
      collectedAt: collection.collectedAt,
      evaluatedAt: new Date().toISOString(),
    },
  };
}

function calcTrendFromHistory(history, metricPath) {
  if (history.length < 2) return { current: null, delta: 0, trend: 'stable' };
  const values = history
    .map(r => metricPath.split('.').reduce((obj, k) => obj?.[k], r))
    .filter(v => typeof v === 'number');
  if (values.length < 2) return { current: values[0] ?? null, delta: 0, trend: 'stable' };
  const current = values[values.length - 1];
  const prev    = values[values.length - 2];
  const delta   = Math.round(current - prev);
  const trend   = delta > 2 ? 'up' : delta < -2 ? 'down' : 'stable';
  return { current, delta, trend };
}

/**
 * 按任务ID评估单个任务
 * @param {string} taskId - 任务ID
 * @param {Object} opts - { scope?: string[] }
 * @returns {Promise<Object>} - { agentReports: [report], summary: Object }
 */
export async function evaluateByTaskId(taskId, opts = {}) {
  const { scope = ['capability', 'quality', 'business'] } = opts;

  // 1. 优先从 MySQL 读取
  let task = null;
  try {
    task = await loadTaskFromMySQL(taskId);
  } catch (err) {
    console.warn(`[evaluateByTaskId] MySQL 读取失败: ${err.message}`);
  }

  // 2. 降级到 tasks.json
  if (!task) {
    const tasksPath = path.join(process.env.HOME || '/root', '.qclaw/data/tasks.json');
    if (existsSync(tasksPath)) {
      try {
        const tasksRaw = JSON.parse(readFileSync(tasksPath, 'utf-8'));
        const found = tasksRaw.find(t => t.id === taskId);
        if (found) {
          task = {
            taskId:    found.id,
            agentId:   found.agent || found.agentId,
            type:      found.type || 'general',
            input:     found.input || '',
            output:    found.result || found.output || '',
            status:    found.status || 'unknown',
            createdAt: found.createdAt ? new Date(found.createdAt).getTime() : 0,
            updatedAt: found.updatedAt ? new Date(found.updatedAt).getTime() : 0,
            duration:  found.duration || 0,
          };
        }
      } catch (jsonErr) {
        console.warn(`[evaluateByTaskId] tasks.json 读取失败: ${jsonErr.message}`);
      }
    }
  }

  // 3. 任务不存在 → 返回友好提示，不抛异常
  if (!task) {
    return {
      agentReports: [],
      summary: {
        totalAgents: 0,
        totalTasks: 0,
        avgOverall: null,
        message: `任务 [${taskId}] 不存在或尚未生成输出，无法评估`,
        evaluatedAt: new Date().toISOString(),
      }
    };
  }

  // 4. 输出为空/过短 → 返回"无法评估"提示
  if (!task.output || task.output.trim().length < 50) {
    const report = {
      taskId: task.taskId,
      agentId: task.agentId,
      taskType: mapAgentToTaskType(task.agentId),
      overall: {
        score: 0,
        grade: 'D',
        verdict: '无法评估',
        message: `任务输出为空（${task.output?.trim().length || 0} 字符），无法进行质量评估`,
      },
      layers: {
        capability: { score: 0, grade: 'D', verdict: '无法评估', message: '无输出内容' },
        quality:    { score: 0, grade: 'D', verdict: '无法评估', message: '无输出内容' },
        business:   { score: 0, grade: 'D', verdict: '无法评估', message: '无输出内容' },
      },
      metadata: { duration: task.duration || 0, outputLength: task.output?.length || 0 },
      timestamp: new Date().toISOString(),
    };
    return {
      agentReports: [report],
      summary: {
        totalAgents: 1,
        totalTasks: 1,
        avgOverall: 0,
        gradeDist: { S: 0, A: 0, B: 0, C: 0, D: 1 },
        evaluatedAt: report.timestamp,
        message: '任务输出为空或过短（<50字符），无法评估',
      }
    };
  }

  // 5. 正常评估
  const evalInput = {
    agentId:  task.agentId,
    taskId:   task.taskId,
    taskType: mapAgentToTaskType(task.agentId),
    output:   task.output,
    metadata: {
      duration:     task.duration || 0,
      outputLength: task.output.length,
      createdAt:    task.createdAt,
    }
  };

  const report = await evaluate(evalInput, { scope });

  return {
    agentReports: [report],
    summary: {
      totalAgents: 1,
      totalTasks: 1,
      avgOverall: report.overall.score,
      gradeDist: {
        S: report.overall.grade === 'S' ? 1 : 0,
        A: report.overall.grade === 'A' ? 1 : 0,
        B: report.overall.grade === 'B' ? 1 : 0,
        C: report.overall.grade === 'C' ? 1 : 0,
        D: report.overall.grade === 'D' ? 1 : 0,
      },
      evaluatedAt: report.timestamp,
    }
  };
}

// 辅助函数：根据 agentId 推断 taskType
function mapAgentToTaskType(agentId) {
  const map = {
    'test-requirement-analyzer': 'requirement-analysis',
    'test-case-generator': 'case-generation',
    'api-executor': 'api-test',
    'ui-e2e-executor': 'ui-test',
    'test-reporter': 'report-generation',
    'defect-analyzer': 'defect-analysis',
    'ai-quality-reviewer-1': 'quality-review',
    'ai-quality-reviewer-2': 'quality-review',
    'ai-quality-reviewer-3': 'quality-review',
  };
  return map[agentId] || 'general';
}

export default {
  evaluate,
  evaluateAll,
  evaluateByTaskId,
  quickAssess,
  assessCapability,
  assessQuality,
  assessBusinessValue,
  calculateScoreLayer,
  determineGrade,
  generateRecommendations,
  assessTrends,
  getEvaluationHistory,
  listEvaluationReports,
  getReportById,
  getMetricTrend,
  saveEvaluationReport,
  autoCollect: (opts) => autoCollect(opts),
};
