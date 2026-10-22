'use strict';

/**
 * Result Aggregator Invoker - LLM tool-call 统一入口
 * 封装结果聚合器，接受测试结果数组，返回聚合后的报告
 */

const { executeResultAggregator } = require('./result-aggregator');

/**
 * invoke - LLM tool-call 入口
 * @param {Object} params
 * @param {Array} params.results - 测试结果数组（UTRM 格式）
 * @param {Object} [params.collectOptions] - 收集选项
 * @param {Object} [params.aggregateOptions] - 聚合选项
 * @param {Object} [params.deduplicateOptions] - 去重选项
 * @param {Object} [params.sortOptions] - 排序选项
 * @param {Object} [params.reportOptions] - 报告生成选项
 * @param {string} [params.format='markdown'] - 报告格式（markdown/html/json）
 * @param {Object} [params.options] - 扩展选项
 * @returns {Object} 聚合结果（含 report）
 */
async function invoke(params) {
  const {
    results,
    collectOptions = {},
    aggregateOptions = {},
    deduplicateOptions = {},
    sortOptions = {},
    reportOptions = {},
    format = 'markdown',
    options = {}
  } = params || {};

  // 必填校验
  if (!results || !Array.isArray(results)) {
    return {
      skill: 'result-aggregator',
      success: false,
      error: 'results 参数必填且必须为数组（UTRM 格式测试结果）',
      hint: '每个结果对象应至少包含: id, name, status, duration, error (可选)。'
    };
  }

  // 合并格式选项到 reportOptions
  const finalReportOptions = { ...reportOptions, format };

  try {
    const result = await executeResultAggregator({
      results,
      collectOptions,
      aggregateOptions,
      deduplicateOptions,
      sortOptions,
      reportOptions: finalReportOptions
    });

    // 提取关键信息供 LLM 快速理解
    const summary = {
      total: results.length,
      passed: results.filter(r => r.status === 'passed' || r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'failed' || r.status === 'FAIL').length,
      skipped: results.filter(r => r.status === 'skipped' || r.status === 'SKIP').length,
      avgDuration: results.reduce((sum, r) => sum + (r.duration || 0), 0) / (results.length || 1)
    };

    return {
      skill: 'result-aggregator',
      success: true,
      summary,
      collected: result.collected,
      aggregated: result.aggregated,
      deduplicated: result.deduplicated,
      sorted: result.sorted,
      report: result.report
    };
  } catch (e) {
    return {
      skill: 'result-aggregator',
      success: false,
      error: e.message,
      resultsCount: results.length
    };
  }
}

module.exports = { invoke };
