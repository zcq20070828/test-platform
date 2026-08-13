'use strict';

/**
 * Quality Metrics Invoker - LLM tool-call 统一入口
 * 封装质量度量计算器，接受测试结果/覆盖率数据，返回度量指标
 */

const { executeQualityMetrics } = require('./quality-metrics');

/**
 * invoke - LLM tool-call 入口
 * @param {Object} params
 * @param {Array} [params.results] - 测试结果数组（UTRM 格式，自动推导各度量数据）
 * @param {Object} [params.coverageData] - 覆盖率数据（显式传入时使用）
 * @param {Object} [params.requirementData] - 需求覆盖率数据
 * @param {Object} [params.testCaseData] - 用例覆盖率数据
 * @param {Object} [params.defectData] - 缺陷数据
 * @param {Object} [params.efficiencyData] - 效率数据
 * @param {Object} [params.qualityData] - 质量评分数据
 * @param {string} [params.metrics='all'] - 计算哪些指标（all/codeCoverage/.../qualityScore）
 * @param {Object} [params.options] - 扩展选项
 * @returns {Object} 度量结果
 */
async function invoke(params) {
  const {
    results,
    coverageData,
    requirementData,
    testCaseData,
    defectData,
    efficiencyData,
    qualityData,
    metrics = 'all',
    options = {}
  } = params || {};

  // 从 results 推导各类数据（如果未显式提供）
  let cov = coverageData;
  let req = requirementData;
  let tc = testCaseData;
  let def = defectData;
  let eff = efficiencyData;
  let qual = qualityData;

  if (results && Array.isArray(results)) {
    // 简化：从 results 推断基础度量数据
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed' || r.status === 'PASS').length;
    const failed = total - passed;

    // 如果没有显式提供覆盖率数据，用通过率近似
    if (!cov) {
      cov = {
        lineCoverage: total > 0 ? Math.round((passed / total) * 100) : 0,
        branchCoverage: total > 0 ? Math.round((passed / total) * 100) : 0
      };
    }

    // 缺陷数据：失败数作为缺陷数
    if (!def) {
      def = {
        totalDefects: failed,
        criticalDefects: 0,
        majorDefects: Math.floor(failed * 0.3),
        minorDefects: Math.floor(failed * 0.7),
        linesOfCode: 10000 // 默认代码行数（可由 LLM 提供更精确值）
      };
    }

    // 效率数据
    if (!eff) {
      const avgDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0) / (total || 1);
      eff = {
        totalTests: total,
        passedTests: passed,
        failedTests: failed,
        executionTime: avgDuration * total / 1000, // 秒
        defectsFound: failed
      };
    }

    // 质量评分数据
    if (!qual) {
      qual = {
        codeCoverage: cov.lineCoverage,
        defectDensity: def.totalDefects / (def.linesOfCode || 10000) * 1000,
        testPassRate: total > 0 ? (passed / total) * 100 : 0,
        automationRate: 100, // 假设全自动化
        executionEfficiency: eff.executionTime > 0 ? total / eff.executionTime : 0
      };
    }
  }

  // 必填校验（根据 metrics 选择性校验）
  const opts = {
    coverageData: cov,
    requirementData: req,
    testCaseData: tc,
    defectData: def,
    efficiencyData: eff,
    qualityData: qual,
    metrics
  };

  try {
    const result = await executeQualityMetrics(opts);
    return {
      skill: 'quality-metrics-calculator',
      success: true,
      metrics,
      result
    };
  } catch (e) {
    // 如果 executeQualityMetrics 抛错（缺必填参数），返回友好提示
    return {
      skill: 'quality-metrics-calculator',
      success: false,
      error: e.message,
      hint: '请提供 results（UTRM 格式测试结果）或显式传入 coverageData/requirementData/testCaseData/defectData/efficiencyData/qualityData 之一。',
      provided: {
        hasResults: !!results,
        hasCoverageData: !!coverageData,
        hasDefectData: !!defectData,
        metrics
      }
    };
  }
}

module.exports = { invoke };
