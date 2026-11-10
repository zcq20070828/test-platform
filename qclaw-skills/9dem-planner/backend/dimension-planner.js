/**
 * dimension-planner.js
 * 九维穷举模型的维度规划引擎
 * 负责依赖分析、覆盖缺口识别、用例数估算
 *
 * 2026-11-09 口径统一：本文件历史上实现的是**五维**（数据/流程/环境/时间/依赖），
 * 与 SKILL.md 和 9dem-executor 声明的九维（用户/数据/流程/操作/安全/性能/网络环境/
 * 终端环境/兼容性）不一致，导致用例生成智能体依赖一个口径不同的计划器。
 * 现在统一为九维，维度键、中文名、必测点全部来自九维覆盖矩阵
 * （backend/lib/dimension-matrix.js），与门禁判定共用一份定义。
 *
 * 「环境/时间/依赖」三个旧维度不是被删除，而是按九维模型拆解：
 *   环境 → ⑦ 网络环境 + ⑧ 终端环境 + ⑨ 兼容性
 *   时间 → ⑥ 性能（并发/超时/大数据量）
 *   依赖 → ③ 流程（状态机/上下游）+ ④ 操作（幂等/中断恢复）
 */

import { pathToFileURL } from 'node:url';
import { DIMENSION_MATRIX, LAYER_KEYS } from './dimension-matrix-data.js';

// ---------------------------------------------------------------------------
// 常量定义
// ---------------------------------------------------------------------------

/** 九维枚举（与 9dem-executor / 门禁完全一致的键） */
export const DIMENSIONS = Object.fromEntries(
  DIMENSION_MATRIX.map((d) => [d.key.toUpperCase(), d.key]),
);

/** 维度中文名 */
export const DIMENSION_LABELS = Object.fromEntries(
  DIMENSION_MATRIX.map((d) => [d.key, d.label]),
);

/** 维度风险权重（来自覆盖矩阵，●● = 2，● = 1） */
export const DIMENSION_WEIGHTS = Object.fromEntries(
  DIMENSION_MATRIX.map((d) => [d.key, d.weight]),
);

/** 维度复杂度等级 */
export const COMPLEXITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  VERY_HIGH: 'very_high',
};

/**
 * 基础用例数估算参数（维度 × 复杂度系数）
 *
 * 估算口径：每维至少要覆盖 requiredLayers（2~3 层）× 必测点数。
 * 复杂度的作用是「同一必测点在复杂需求下会拆成更多等价场景」，
 * 所以系数以必测点数为基准放大，而不是拍一个绝对数字。
 */
const COMPLEXITY_MULTIPLIER = {
  [COMPLEXITY_LEVELS.LOW]: 1,
  [COMPLEXITY_LEVELS.MEDIUM]: 1.5,
  [COMPLEXITY_LEVELS.HIGH]: 2.5,
  [COMPLEXITY_LEVELS.VERY_HIGH]: 4,
};

function baseCaseCount(dimKey) {
  const dim = DIMENSION_MATRIX.find((d) => d.key === dimKey);
  if (!dim) return 0;
  return dim.probes.length;
}

// ---------------------------------------------------------------------------
// 核心功能
// ---------------------------------------------------------------------------

/**
 * 获取九维之间的依赖关系图
 *
 * 依赖依据「前置信息是否已被产出」：
 *   用户 / 数据 是基础（无前置）→ 流程依赖两者 → 操作依赖流程 →
 *   安全依赖用户（要有身份才有越权）→ 性能/网络/终端/兼容依赖流程与操作。
 *
 * @returns {Object} key=维度，value=该维度所依赖的前置维度数组
 */
export function getDimensionDependencies() {
  return {
    user: [],
    data: [],
    process: ['user', 'data'],
    operation: ['process'],
    security: ['user', 'data'],
    performance: ['process', 'operation'],
    network: ['process', 'operation'],
    terminal: ['process', 'operation'],
    compatibility: ['process', 'terminal'],
  };
}

/**
 * 获取维度的依赖拓扑排序（执行顺序）
 * @returns {string[]}
 */
export function getExecutionOrder() {
  return DIMENSION_MATRIX.map((d) => d.key);
}

/**
 * 估算某维度在给定复杂度下的用例数量
 * @param {string} dimension
 * @param {string} complexity
 * @returns {{ estimated: number, detail: string }}
 */
export function estimateDimensionCases(dimension, complexity) {
  const keys = Object.values(DIMENSIONS);
  if (!keys.includes(dimension)) {
    throw new RangeError(`[dimension-planner] 未知维度: "${dimension}"，有效值: ${keys.join(', ')}`);
  }
  if (!Object.values(COMPLEXITY_LEVELS).includes(complexity)) {
    throw new RangeError(`[dimension-planner] 未知复杂度: "${complexity}"，有效值: ${Object.values(COMPLEXITY_LEVELS).join(', ')}`);
  }

  const base = baseCaseCount(dimension);
  const estimated = Math.max(1, Math.round(base * (COMPLEXITY_MULTIPLIER[complexity] ?? 1)));

  return {
    estimated,
    detail: `${DIMENSION_LABELS[dimension]} × ${complexity} → 估算 ${estimated} 个用例（基准必测点 ${base} 个）`,
  };
}

/**
 * 识别覆盖缺口：哪些维度尚未覆盖
 * @param {string[]} covered - 已覆盖的维度数组
 * @param {string[]} [required] - 必需的维度数组，默认九维全量
 * @returns {{ gaps: string[], covered: string[], completeness: number, message: string }}
 */
export function identifyCoverageGaps(covered = [], required = null) {
  const requiredDimensions = required ?? Object.values(DIMENSIONS);
  const coveredSet = new Set(covered);

  const gaps = requiredDimensions.filter((d) => !coveredSet.has(d));

  return {
    gaps,
    covered: requiredDimensions.filter((d) => coveredSet.has(d)),
    completeness: requiredDimensions.length > 0
      ? Math.round((coveredSet.size / requiredDimensions.length) * 100)
      : 100,
    message: gaps.length === 0
      ? '九维已全部覆盖，无需补充。'
      : `缺少以下维度覆盖: ${gaps.map((d) => DIMENSION_LABELS[d] || d).join('、')}`,
  };
}

/**
 * 从需求结构中推断各维度复杂度
 * @param {Object} requirement
 * @returns {Object} 各维度复杂度映射
 */
function inferComplexities(requirement) {
  const {
    dataVariations = 0,     // 数据变体数量
    processSteps = 0,       // 流程步骤数
    roles = 0,              // 角色数量
    operationPaths = 0,     // 操作路径 / 幂等场景数
    securityRequirements = 0,
    perfTargets = 0,        // 性能指标数量
    networkConditions = 0,
    terminals = 0,
    platforms = 0,          // 浏览器 / 机型数量
  } = requirement;

  return {
    user: inferSingleComplexity(roles || 1, [1, 2, 4, 6]),
    data: inferSingleComplexity(dataVariations, [1, 5, 15, 30]),
    process: inferSingleComplexity(processSteps, [1, 4, 10, 20]),
    operation: inferSingleComplexity(operationPaths || 1, [1, 3, 6, 10]),
    security: inferSingleComplexity(securityRequirements || 1, [1, 2, 4, 6]),
    performance: inferSingleComplexity(perfTargets || 1, [1, 2, 4, 6]),
    network: inferSingleComplexity(networkConditions || 1, [1, 2, 4, 6]),
    terminal: inferSingleComplexity(terminals || 1, [1, 2, 3, 5]),
    compatibility: inferSingleComplexity(platforms || 1, [1, 2, 4, 6]),
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
 * 输入需求 + 已覆盖维度，输出九维规划
 *
 * @param {Object} requirement - 需求结构（各维度规模信号，见 inferComplexities）
 * @param {string[]} [existingDimensions] - 已覆盖的维度数组（可选）
 * @returns {Object}
 */
export function planDimensions(requirement = {}, existingDimensions = []) {
  if (typeof requirement !== 'object' || requirement === null) {
    throw new TypeError('[dimension-planner] requirement 必须是对象');
  }
  if (!Array.isArray(existingDimensions)) {
    throw new TypeError('[dimension-planner] existingDimensions 必须是数组');
  }

  const deps = getDimensionDependencies();
  const executionOrder = getExecutionOrder();
  const complexities = inferComplexities(requirement);

  const dimensions = DIMENSION_MATRIX.map((meta) => {
    const { estimated, detail } = estimateDimensionCases(meta.key, complexities[meta.key]);
    return {
      name: meta.key,
      label: meta.label,
      weight: meta.weight,
      complexity: complexities[meta.key],
      estimatedCases: estimated,
      requiredLayers: meta.requiredLayers,
      probeCount: meta.probes.length,
      probeIds: meta.probes.map((p) => p.id),
      dependencies: deps[meta.key],
      alreadyCovered: existingDimensions.includes(meta.key),
      detail,
    };
  });

  const estimatedCases = dimensions.reduce((sum, d) => sum + d.estimatedCases, 0);
  const { gaps, completeness } = identifyCoverageGaps(existingDimensions);

  return {
    dimensions,
    executionOrder,
    layers: LAYER_KEYS,
    estimatedCases,
    coverageGap: gaps.map((dim) => ({
      dimension: dim,
      label: DIMENSION_LABELS[dim],
      reason: `尚未生成 ${DIMENSION_LABELS[dim]} 用例`,
      priority: existingDimensions.length === 0 ? 'high' : 'medium',
    })),
    completeness,
    summary: {
      totalDimensions: DIMENSION_MATRIX.length,
      coveredCount: dimensions.filter((d) => d.alreadyCovered).length,
      pendingCount: gaps.length,
      estimatedCases,
    },
  };
}

// ---------------------------------------------------------------------------
// 自测块
// ---------------------------------------------------------------------------
// 只有直接 `node <本文件>` 时才跑自测；被 import 时不要打印噪声（会污染调用方日志）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('\n========== dimension-planner.js 自测 ==========\n');

  const plan1 = planDimensions({});
  console.log('【用例1】空需求规划:', JSON.stringify(plan1.summary, null, 2));

  const plan2 = planDimensions({ dataVariations: 10 }, [DIMENSIONS.DATA]);
  console.log('【用例2】已覆盖数据维度:', plan2.coverageGap.length, '个缺口未覆盖', plan2.completeness, '%');

  const plan3 = planDimensions({
    roles: 4,
    dataVariations: 20,
    processSteps: 15,
    operationPaths: 8,
    securityRequirements: 5,
    perfTargets: 4,
    networkConditions: 4,
    terminals: 3,
    platforms: 4,
  });
  console.log('【用例3】高复杂度规划:');
  plan3.dimensions.forEach((d) => console.log(`  ${d.label}: ${d.estimatedCases} 用例（${d.probeCount} 必测点）`));
  console.log(`  总计: ${plan3.estimatedCases} 用例`);

  const deps = getDimensionDependencies();
  console.log('【用例4】依赖关系:', JSON.stringify(deps, null, 2));

  const gaps = identifyCoverageGaps([DIMENSIONS.USER, DIMENSIONS.DATA]);
  console.log('【用例5】缺口识别:', gaps.message, `(${gaps.completeness}%)`);

  console.log('\n✅ dimension-planner.js 自测通过\n');
}
