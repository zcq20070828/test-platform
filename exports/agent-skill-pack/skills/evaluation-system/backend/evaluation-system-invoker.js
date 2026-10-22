'use strict';

/**
 * Evaluation System Invoker - LLM tool-call 统一入口
 * 封装三层五级评估系统核心功能
 */

import * as dataCollector from './data-collector.js';
import * as evalEngine from './evaluation-engine.js';

/**
 * invoke - LLM tool-call 入口
 * @param {Object} params
 */
async function invoke(params) {
  const { action, agentId, taskId, daysBack, limitPerAgent, scope, taskType, output, metadata } = params;

  try {
    switch (action) {
      case 'autoCollect': {
        // 自动收集所有智能体最近任务数据（同步版本，返回 groups）
        const data = dataCollector.autoCollect({
          daysBack: daysBack || 30,
          limitPerAgent: limitPerAgent || 20,
        });
        return {
          success: true,
          totalTasks: data.totalTasks,
          agentsCovered: data.agentsCovered,
          agents: Object.keys(data.groups || {}).map(agentId => ({
            agentId,
            taskCount: (data.groups[agentId] || []).length,
            latestTask: (data.groups[agentId] || [])[0]?.taskId || 'N/A',
          })),
        };
      }

      case 'autoCollectAsync': {
        // 异步版：从 MySQL 优先读取，失败时回退 tasks.json
        const data = await dataCollector.autoCollectAsync({
          daysBack: daysBack || 30,
          limitPerAgent: limitPerAgent || 20,
        });
        return {
          success: true,
          totalTasks: data.totalTasks,
          agentsCovered: data.agentsCovered,
          agents: Object.keys(data.groups || {}).map(agentId => ({
            agentId,
            taskCount: (data.groups[agentId] || []).length,
            latestTask: (data.groups[agentId] || [])[0]?.taskId || 'N/A',
          })),
        };
      }

      case 'evaluate': {
        // 评估单个任务输出
        if (!output || !taskType) {
          return { success: false, error: 'evaluate 需要 output 和 taskType 参数' };
        }
        const report = await evalEngine.quickAssess(output, taskType, metadata);
        return { success: true, report };
      }

      case 'evaluateAll': {
        // 全量评估：收集数据 + 评估所有智能体 + 保存报告
        const report = await evalEngine.evaluateAll({
          daysBack: daysBack || 30,
          limitPerAgent: limitPerAgent || 20,
          scope: scope || ['capability', 'quality', 'business'],
        });
        return { success: true, report };
      }

      case 'getHistory': {
        // 获取评估历史
        if (!agentId) {
          return { success: false, error: 'getHistory 需要 agentId 参数' };
        }
        const history = await evalEngine.getEvaluationHistory(agentId, daysBack || 90);
        return { success: true, history };
      }

      case 'listReports': {
        // 列出评估报告
        if (!agentId) {
          return { success: false, error: 'listReports 需要 agentId 参数' };
        }
        const reports = await evalEngine.listEvaluationReports(agentId, limitPerAgent || 50);
        return { success: true, reports };
      }

      case 'getTrend': {
        // 获取指标趋势
        if (!agentId || !taskType) {
          return { success: false, error: 'getTrend 需要 agentId 和 taskType 参数' };
        }
        const trend = await evalEngine.assessTrends(agentId, { taskType });
        return { success: true, trend };
      }

      default:
        return {
          success: false,
          error: `未知 action: ${action}`,
          availableActions: ['autoCollect', 'evaluate', 'evaluateAll', 'getHistory', 'listReports', 'getTrend'],
        };
    }
  } catch (err) {
    console.error('[EvaluationSystem Invoker] Error:', err.message);
    return { success: false, error: err.message };
  }
}

export { invoke };
export default { invoke };
