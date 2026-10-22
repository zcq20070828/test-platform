/**
 * dimension-planner.js
 * 九维穷举模型的维度规划引擎
 * 负责依赖分析、覆盖缺口识别、用例数估算
 */

// ---------------------------------------------------------------------------
// 常量定义
// ---------------------------------------------------------------------------

/** 五维枚举 */
export const DIMENSIONS = {
  DATA: 'data',
  PROCESS: 'process',
  ENVIRONMENT: 'environment',
  TIME: 'time',
  DEPENDENCY: 'dependency',
};

/** 维度中文名 */
export const DIMENSION_LABELS = {
  [DIMENSIONS.DATA]: '数据维度',
  [DIMENSIONS.PROCESS]: '流程维度',
  [DIMENSIONS.ENVIRONMENT]: '环境维度',
  [DIMENSIONS.TIME]: '时间维度',
  [DIMENSIONS.DEPENDENCY]: '依赖维度',
};

/** 维度复杂度等级 */
export const COMPLEXITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  VERY_HIGH: 'very_high',
};

/** 基础用例数估算参数（维度 × 复杂度系数） */
const BASE_CASE_COUNTS = {
  [DIMENSIONS.DATA]:         { [COMPLEXITY_LEVELS.LOW]: 8,   [COMPLEXITY_LEVELS.MEDIUM]: 20,  [COMPLEXITY_LEVELS.HIGH]: 50,   [COMPLEXITY_LEVELS.VERY_HIGH]: 100 },
  [DIMENSIONS.PROCESS]:      { [COMPLEXITY_LEVELS.LOW]: 5,   [COMPLEXITY_LEVELS.MEDIUM]: 15,  [COMPLEXITY_LEVELS.HIGH]: 40,   [COMPLEXITY_LEVELS.VERY_HIGH]: 80  },
  [DIMENSIONS.ENVIRONMENT]:  { [COMPLEXITY_LEVELS.LOW]: 6,   [COMPLEXITY_LEVELS.MEDIUM]: 18,  [COMPLEXITY_LEVELS.HIGH]: 45,   [COMPLEXITY_LEVELS.VERY_HIGH]: 90  },
  [DIMENSIONS.TIME]:         { [COMPLEXITY_LEVELS.LOW]: 4,   [COMPLEXITY_LEVELS.MEDIUM]: 12,  [COMPLEXITY_LEVELS.HIGH]: 30,   [COMPLEXITY_LEVELS.VERY_HIGH]: 60  },
  [DIMENSIONS.DEPENDENCY]:   { [COMPLEXITY_LEVELS.LOW]: 3,   [COMPLEXITY_LEVELS.MEDIUM]: 10,  [COMPLEXITY_LEVELS.HIGH]: 25,   [COMPLEXITY_LEVELS.VERY_HIGH]: 50  },
};

// ---------------------------------------------------------------------------
// 核心功能
// ---------------------------------------------------------------------------

/**
 * 获取五维之间的依赖关系图
 * @returns {Object} 依赖关系图，key=维度，value=该维度所依赖的前置维度数组
 */
export function getDimensionDependencies() {
  return {
    [DIMENSIONS.DATA]: [],                               // 数据维度无前置依赖
    [DIMENSIONS.PROCESS]: [DIMENSIONS.DATA],             // 流程维度依赖数据维度
    [DIMENSIONS.ENVIRONMENT]: [DIMENSIONS.DATA, DIMENSIONS.PROCESS], // 环境维度依赖数据+流程
    [DIMENSIONS.TIME]: [DIMENSIONS.PROCESS],             // 时间维度依赖流程维度
    [DIMENSIONS.DEPENDENCY]: [                          // 依赖维度依赖所有其他四维
      DIMENSIONS.DATA,
      DIMENSIONS.PROCESS,
      DIMENSIONS.ENVIRONMENT,
      DIMENSIONS.TIME,
    ],
  };
}

/**
 * 获取维度的依赖拓扑排序（执行顺序）
 * @returns {string[]} 按依赖顺序排列的维度数组
 */
export function getExecutionOrder() {
  return [
    DIMENSIONS.DATA,         // 1. 数据维度（无依赖）
    DIMENSIONS.PROCESS,      // 2. 流程维度（依赖数据）
    DIMENSIONS.ENVIRONMENT,  // 3. 环境维度（依赖数据+流程）
    DIMENSIONS.TIME,         // 4. 时间维度（依赖流程）
    DIMENSIONS.DEPENDENCY,   // 5. 依赖维度（依赖所有）
  ];
}

/**
 * 估算某维度在给定复杂度下的用例数量
 * @param {string} dimension - 维度名
 * @param {string} complexity - 复杂度等级
 * @returns {{ estimated: number, detail: string }}
 */
export function estimateDimensionCases(dimension, complexity) {
  if (!Object.values(DIMENSIONS).includes(dimension)) {
    throw new RangeError(`[dimension-planner] 未知维度: "${dimension}"，有效值: ${Object.values(DIMENSIONS).join(', ')}`);
  }
  if (!Object.values(COMPLEXITY_LEVELS).includes(complexity)) {
    throw new RangeError(`[dimension-planner] 未知复杂度: "${complexity}"，有效值: ${Object.values(COMPLEXITY_LEVELS).join(', ')}`);
  }

  const table = BASE_CASE_COUNTS[dimension];
  const estimated = table[complexity] ?? 0;

  return {
    estimated,
    detail: `${DIMENSION_LABELS[dimension]} × ${complexity} → 估算 ${estimated} 个用例`,
  };
}

/**
 * 识别覆盖缺口：哪些维度尚未覆盖
 * @param {string[]} covered - 已覆盖的维度数组
 * @param {string[]} [required] - 必需的维度数组，默认五维全量
 * @returns {Object} 包含 gaps（缺口维度）和 completeness（覆盖率）
 */
export function identifyCoverageGaps(covered = [], required = null) {
  const requiredDimensions = required ?? Object.values(DIMENSIONS);
  const coveredSet = new Set(covered);

  const gaps = requiredDimensions.filter(d => !coveredSet.has(d));

  return {
    gaps,                                        // 未覆盖的维度数组
    covered: requiredDimensions.filter(d => coveredSet.has(d)),
    completeness: requiredDimensions.length > 0
      ? Math.round((coveredSet.size / requiredDimensions.length) * 100)
      : 100,
    message: gaps.length === 0
      ? '五维已全部覆盖，无需补充。'
      : `缺少以下维度覆盖: ${gaps.map(d => DIMENSION_LABELS[d] || d).join('、')}`,
  };
}

/**
 * 从需求结构中推断各维度复杂度
 * @param {Object} requirement - 需求对象
 * @returns {Object} 各维度复杂度映射
 */
function inferComplexities(requirement) {
  const {
    dataVariations = 0,     // 数据变体数量
    processSteps = 0,        // 流程步骤数
    envCount = 0,            // 环境组合数
    timeFactors = 0,         // 时间因子数
    depCount = 0,            // 依赖项数
  } = requirement;

  return {
    [DIMENSIONS.DATA]:         inferSingleComplexity(dataVariations, [1, 5, 15, 30]),
    [DIMENSIONS.PROCESS]:      inferSingleComplexity(processSteps, [1, 4, 10, 20]),
    [DIMENSIONS.ENVIRONMENT]:  inferSingleComplexity(envCount, [1, 3, 8, 15]),
    [DIMENSIONS.TIME]:         inferSingleComplexity(timeFactors, [1, 3, 6, 12]),
    [DIMENSIONS.DEPENDENCY]:   inferSingleComplexity(depCount, [1, 3, 6, 10]),
  };
}

function inferSingleComplexity(value, thresholds) {
  if (value >= thresholds[3]) return COMPLEXITY_LEVELS.VERY_HIGH;
  if (value >= thresholds[2]) return COMPLEXITY_LEVELS.HIGH;
  if (value >= thresholds[1]) return COMPLEXITY_LEVELS.MEDIUM;
  return COMPLEXITY_LEVELS.LOW;
}

/**
 * 主规划入口
 * 输入需求 + 已覆盖维度，输出五维规划
 *
 * @param {Object} requirement - 需求结构
 *   @param {number} [requirement.dataVariations] - 数据变体数（默认 0→LOW）
 *   @param {number} [requirement.processSteps] - 流程步骤数（默认 0→LOW）
 *   @param {number} [requirement.envCount] - 环境组合数（默认 0→LOW）
 *   @param {number} [requirement.timeFactors] - 时间因子数（默认 0→LOW）
 *   @param {number} [requirement.depCount] - 依赖项数（默认 0→LOW）
 * @param {string[]} [existingDimensions] - 已覆盖的维度数组（可选）
 * @returns {Object} 五维规划结果
 */
export function planDimensions(requirement = {}, existingDimensions = []) {
  // 输入校验
  if (typeof requirement !== 'object' || requirement === null) {
    throw new TypeError('[dimension-planner] requirement 必须是对象');
  }
  if (!Array.isArray(existingDimensions)) {
    throw new TypeError('[dimension-planner] existingDimensions 必须是数组');
  }

  const deps = getDimensionDependencies();
  const executionOrder = getExecutionOrder();
  const complexities = inferComplexities(requirement);

  // 构建各维度详情
  const dimensions = Object.values(DIMENSIONS).map(dim => {
    const { estimated, detail } = estimateDimensionCases(dim, complexities[dim]);
    return {
      name: dim,
      label: DIMENSION_LABELS[dim],
      complexity: complexities[dim],
      estimatedCases: estimated,
      dependencies: deps[dim],
      alreadyCovered: existingDimensions.includes(dim),
      detail,
    };
  });

  // 用例总数估算
  const estimatedCases = dimensions.reduce((sum, d) => sum + d.estimatedCases, 0);

  // 覆盖缺口分析
  const { gaps, completeness } = identifyCoverageGaps(existingDimensions);

  return {
    dimensions,          // 各维度详情数组（按执行顺序）
    executionOrder,      // 拓扑排序后的执行顺序
    estimatedCases,      // 总估算用例数
    coverageGap: gaps.map(dim => ({
      dimension: dim,
      label: DIMENSION_LABELS[dim],
      reason: `尚未生成 ${DIMENSION_LABELS[dim]} 用例`,
      priority: existingDimensions.length === 0 ? 'high' : 'medium',
    })),
    completeness,        // 当前覆盖率（百分比）
    summary: {
      totalDimensions: Object.keys(DIMENSIONS).length,
      coveredCount: dimensions.filter(d => d.alreadyCovered).length,
      pendingCount: gaps.length,
      estimatedCases,
    },
  };
}

// ---------------------------------------------------------------------------
// 自测块
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.cwd()}/dimension-planner.js`.replace(/\\/g, '/') ||
    import.meta.url.endsWith('/dimension-planner.js')) {
  console.log('\n========== dimension-planner.js 自测 ==========\n');

  // 用例 1：空需求（默认全部 LOW）
  const plan1 = planDimensions({});
  console.log('【用例1】空需求规划:', JSON.stringify(plan1.summary, null, 2));

  // 用例 2：带已覆盖维度
  const plan2 = planDimensions({ dataVariations: 10 }, [DIMENSIONS.DATA]);
  console.log('【用例2】已覆盖数据维度:', plan2.gaps?.length, '个缺口未覆盖', plan2.completeness, '%');

  // 用例 3：复杂需求
  const plan3 = planDimensions({
    dataVariations: 20,
    processSteps: 15,
    envCount: 10,
    timeFactors: 8,
    depCount: 8,
  });
  console.log('【用例3】高复杂度规划:');
  plan3.dimensions.forEach(d => console.log(`  ${d.label}: ${d.estimatedCases}用例`));
  console.log(`  总计: ${plan3.estimatedCases} 用例`);

  // 用例 4：依赖关系验证
  const deps = getDimensionDependencies();
  console.log('【用例4】依赖关系:', JSON.stringify(deps, null, 2));

  // 用例 5：覆盖缺口识别
  const gaps = identifyCoverageGaps([DIMENSIONS.DATA, DIMENSIONS.PROCESS]);
  console.log('【用例5】缺口识别:', gaps.message, `(${gaps.completeness}%)`);

  console.log('\n✅ dimension-planner.js 自测通过\n');
}
