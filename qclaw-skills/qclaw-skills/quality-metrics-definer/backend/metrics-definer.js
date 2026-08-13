/**
 * metrics-definer.js — 质量指标定义引擎
 * 为测试需求定义量化质量指标集
 *
 * @module quality-metrics-definer/backend/metrics-definer
 * @exports defineMetrics
 * @exports suggestCoverageTarget
 * @exports getDefectSeverityThresholds
 * @exports calculateRegressionRatio
 */

/**
 * 模块类型 → 覆盖率目标映射（经验值）
 * @type {Record<string, number>}
 */
const MODULE_COVERAGE_MAP = {
  login: 0.90,
  auth: 0.90,
  payment: 0.95,
  transaction: 0.95,
  order: 0.90,
  data: 0.80,
  report: 0.75,
  search: 0.80,
  file: 0.80,
  notification: 0.75,
  admin: 0.70,
  api: 0.85,
  integration: 0.80,
  core: 0.95,
  default: 0.80,
};

/**
 * 根据模块类型推荐覆盖率目标
 * @param {string} module - 模块名称（英文或中文均可，会做模糊匹配）
 * @returns {{ target: number, reason: string }}
 */
export function suggestCoverageTarget(module) {
  if (typeof module !== 'string' || module.trim() === '') {
    throw new Error('[suggestCoverageTarget] module 参数必须为非空字符串');
  }

  const key = module.toLowerCase().trim();

  // 精确 + 前缀匹配
  let target = MODULE_COVERAGE_MAP.default;
  let reason = `模块类型 "${module}" 使用默认覆盖率目标`;

  for (const [type, value] of Object.entries(MODULE_COVERAGE_MAP)) {
    if (key.includes(type) || type.includes(key)) {
      target = value;
      reason = `模块类型 "${module}" 匹配到 "${type}"，推荐覆盖率目标为 ${(value * 100).toFixed(0)}%`;
      break;
    }
  }

  return { target, reason };
}

/**
 * 返回缺陷严重度阈值配置
 * @returns {{ critical: { max: number, label: string }, high: { max: number, label: string }, medium: { max: number, label: string }, low: { max: number, label: string } }}
 */
export function getDefectSeverityThresholds() {
  return {
    critical: {
      max: 0,
      label: '严重（Critical）缺陷数必须为 0，发布前必须全部修复',
    },
    high: {
      max: 3,
      label: '高（High）缺陷数不超过 3 个，否则阻塞发布',
    },
    medium: {
      max: 10,
      label: '中（Medium）缺陷数不超过 10 个，超出需评审',
    },
    low: {
      max: 9999, // 实际业务中等效于不限
      label: '低（Low）缺陷数不限，建议控制在 20 以内',
    },
  };
}

/**
 * 基于覆盖率返回建议回归比例
 * @param {number} coverage - 当前代码覆盖率（0~1）
 * @returns {{ ratio: number, reason: string }}
 */
export function calculateRegressionRatio(coverage) {
  if (typeof coverage !== 'number' || coverage < 0 || coverage > 1) {
    throw new Error('[calculateRegressionRatio] coverage 必须为 0~1 之间的数字');
  }

  // 覆盖率越高，回归范围越大（因为覆盖了更多场景）
  let ratio;
  let reason;

  if (coverage >= 0.95) {
    ratio = 1.0;
    reason = '覆盖率 ≥95%，全量回归以确保高覆盖率质量';
  } else if (coverage >= 0.85) {
    ratio = 0.80;
    reason = '覆盖率 85%~95%，核心路径全量 + 非核心抽检';
  } else if (coverage >= 0.70) {
    ratio = 0.60;
    reason = '覆盖率 70%~85%，核心路径全量回归';
  } else if (coverage >= 0.50) {
    ratio = 0.40;
    reason = '覆盖率 50%~70%，高风险模块回归 + 新增功能覆盖';
  } else {
    ratio = 0.20;
    reason = '覆盖率 <50%，聚焦高优先级用例，避免无效投入';
  }

  return { ratio, reason };
}

/**
 * 核心函数：为单个测试需求定义量化质量指标集
 *
 * @param {Object} requirement - 测试需求结构
 * @param {string} requirement.module - 模块名称
 * @param {string} [requirement.priority] - 优先级（P0/P1/P2/P3）
 * @param {string} [requirement.type] - 模块类型（login/payment/report 等）
 * @param {number} [requirement.currentCoverage] - 当前代码覆盖率（可选，0~1）
 * @param {string[]} [requirement.acceptanceCriteria] - 验收标准（可选）
 * @returns {Object} 量化质量指标集
 */
export function defineMetrics(requirement) {
  if (!requirement || typeof requirement !== 'object') {
    throw new Error('[defineMetrics] requirement 参数必须为对象');
  }
  if (typeof requirement.module !== 'string' || requirement.module.trim() === '') {
    throw new Error('[defineMetrics] requirement.module 必须为非空字符串');
  }

  const { module, priority, type, currentCoverage, acceptanceCriteria } = requirement;

  // 确定实际模块类型（优先用 type，否则用 module 推断）
  const moduleType = type || module;
  const { target: testCoverageTarget, reason: coverageReason } = suggestCoverageTarget(moduleType);

  // 优先级对覆盖率做调整（P0/P1 提高目标）
  let adjustedCoverageTarget = testCoverageTarget;
  if (priority === 'P0' || priority === 'P1') {
    adjustedCoverageTarget = Math.min(1.0, testCoverageTarget + 0.05);
  } else if (priority === 'P3') {
    adjustedCoverageTarget = Math.max(0.6, testCoverageTarget - 0.05);
  }

  // 缺陷密度阈值（每千行代码允许的缺陷数）
  let defectDensityThreshold;
  if (priority === 'P0' || priority === 'P1') {
    defectDensityThreshold = 0.5; // 高优模块：≤0.5/千行
  } else if (priority === 'P2') {
    defectDensityThreshold = 1.0;
  } else {
    defectDensityThreshold = 2.0;
  }

  // 通过率下限
  const passRateFloor = currentCoverage != null
    ? Math.min(1.0, adjustedCoverageTarget * 0.95) // 覆盖率未达标时，通过率也要相对宽松
    : adjustedCoverageTarget;

  // 严重度阈值
  const defectSeverityThresholds = getDefectSeverityThresholds();

  // 回归比例（基于当前覆盖率）
  const coverageForRegression = currentCoverage != null ? currentCoverage : testCoverageTarget;
  const { ratio: regressionRatio, reason: regressionReason } = calculateRegressionRatio(coverageForRegression);

  return {
    testCoverageTarget: {
      value: adjustedCoverageTarget,
      display: `${(adjustedCoverageTarget * 100).toFixed(0)}%`,
      reason: coverageReason + (priority ? `（优先级 ${priority} 调整）` : ''),
    },
    defectDensityThreshold: {
      value: defectDensityThreshold,
      display: `≤${defectDensityThreshold} 缺陷/千行`,
      reason: `基于优先级 ${priority || 'P2'} 确定，高优模块更严格`,
    },
    regressionRatio: {
      value: regressionRatio,
      display: `${(regressionRatio * 100).toFixed(0)}%`,
      reason: regressionReason,
    },
    criticalBlockerThreshold: {
      value: 0,
      display: '0（必须全部修复）',
      reason: '严重级（Critical）缺陷数量必须为 0，阻塞发布',
    },
    passRateFloor: {
      value: passRateFloor,
      display: `${(passRateFloor * 100).toFixed(1)}%`,
      reason: '基于目标覆盖率计算，确保测试有效性',
    },
    _internal: {
      module,
      priority: priority || 'P2',
      defectSeverityThresholds,
      acceptanceCriteria: acceptanceCriteria || [],
    },
  };
}

// ============================================================
// 自测块
// ============================================================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== metrics-definer.js 自测 ===\n');

  // 1. suggestCoverageTarget
  console.log('1. suggestCoverageTarget:');
  console.log('   payment ->', JSON.stringify(suggestCoverageTarget('payment')));
  console.log('   登录模块 ->', JSON.stringify(suggestCoverageTarget('登录模块')));
  console.log('   unknown-module ->', JSON.stringify(suggestCoverageTarget('unknown-module')));

  try {
    suggestCoverageTarget('');
  } catch (e) {
    console.log('   空字符串校验 ->', e.message, '✓');
  }

  // 2. getDefectSeverityThresholds
  console.log('\n2. getDefectSeverityThresholds:');
  console.log(JSON.stringify(getDefectSeverityThresholds(), null, 2));

  // 3. calculateRegressionRatio
  console.log('\n3. calculateRegressionRatio:');
  console.log('   coverage=0.97 ->', JSON.stringify(calculateRegressionRatio(0.97)));
  console.log('   coverage=0.75 ->', JSON.stringify(calculateRegressionRatio(0.75)));
  console.log('   coverage=0.40 ->', JSON.stringify(calculateRegressionRatio(0.40)));

  try {
    calculateRegressionRatio(1.5);
  } catch (e) {
    console.log('   越界校验 ->', e.message, '✓');
  }

  // 4. defineMetrics
  console.log('\n4. defineMetrics:');
  const metrics = defineMetrics({
    module: '支付模块',
    priority: 'P0',
    currentCoverage: 0.88,
  });
  console.log(JSON.stringify(metrics, null, 2));

  console.log('\n=== 自测完成 ===');
}
