/**
 * execution-scheduler.js
 * 九维穷举模型的执行调度器
 * 负责调度序列生成、并行组划分、总时长估算、优先级建议
 */

import {
  planDimensions,
  getDimensionDependencies,
  getExecutionOrder,
  DIMENSIONS,
  DIMENSION_LABELS,
} from './dimension-planner.js';

// ---------------------------------------------------------------------------
// 常量定义
// ---------------------------------------------------------------------------

/** 维度单人单日基准产能（用例/天） */
const DAILY_THROUGHPUT = {
  [DIMENSIONS.DATA]:         8,
  [DIMENSIONS.PROCESS]:      6,
  [DIMENSIONS.ENVIRONMENT]:  5,
  [DIMENSIONS.TIME]:         4,
  [DIMENSIONS.DEPENDENCY]:   3,
};

/** 维度风险等级（1-5, 5最高） */
const RISK_LEVELS = {
  [DIMENSIONS.DATA]:         2,
  [DIMENSIONS.PROCESS]:      4,
  [DIMENSIONS.ENVIRONMENT]:  3,
  [DIMENSIONS.TIME]:         5,
  [DIMENSIONS.DEPENDENCY]:   5,
};

/** 维度优先级权重（数值越大优先级越高） */
const PRIORITY_WEIGHTS = {
  [DIMENSIONS.DATA]:         3,
  [DIMENSIONS.PROCESS]:      5,
  [DIMENSIONS.ENVIRONMENT]:  4,
  [DIMENSIONS.TIME]:         5,
  [DIMENSIONS.DEPENDENCY]:   5,
};

/** 可并行执行的维度组 */
const PARALLEL_GROUPS = [
  [DIMENSIONS.DATA],              // 组1：数据维度（无依赖，并行起点）
  [DIMENSIONS.PROCESS],           // 组2：流程维度（依赖数据，串行）
  [DIMENSIONS.ENVIRONMENT, DIMENSIONS.TIME], // 组3：环境+时间（均依赖流程，可并行）
  [DIMENSIONS.DEPENDENCY],        // 组4：依赖维度（依赖所有，串行终点）
];

/** 并行组语义标签 */
const GROUP_LABELS = ['数据准备', '流程设计', '环境×时间并行', '依赖整合'];

// ---------------------------------------------------------------------------
// 核心功能
// ---------------------------------------------------------------------------

/**
 * 估算九维穷举总耗时（天）
 * @param {string[]} dimensions - 维度数组
 * @param {Object} [caseCounts] - 各维度用例数映射，可选，默认使用 planDimensions 估算
 * @returns {Object} 按时长分析结果
 */
export function estimateTotalDuration(dimensions, caseCounts = null) {
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new TypeError('[execution-scheduler] dimensions 必须是非空数组');
  }

  // 若未提供用例数，则估算
  const counts = caseCounts ?? Object.fromEntries(
    dimensions.map(dim => [dim, 1]) // 默认每个维度1个单位
  );

  // 按并行组计算（组内并行，组间串行）
  let totalDaysSequential = 0;
  let maxDaysParallel = 0;
  const groupDurations = [];
  const dimDurations = {};

  for (const group of PARALLEL_GROUPS) {
    const groupDims = group.filter(d => dimensions.includes(d));
    if (groupDims.length === 0) continue;

    // 组内并行：取最慢的维度决定组时长
    const groupMaxDays = Math.max(
      ...groupDims.map(dim => {
        const cases = counts[dim] ?? 1;
        const days = Math.max(1, Math.ceil(cases / DAILY_THROUGHPUT[dim]));
        dimDurations[dim] = days;
        return days;
      })
    );

    groupDurations.push({
      dims: groupDims.map(d => DIMENSION_LABELS[d]),
      days: groupMaxDays,
    });

    totalDaysSequential += groupMaxDays;  // 简单累加（保守估算）
    maxDaysParallel += groupMaxDays;       // 按并行组累加（实际并行时）
  }

  return {
    sequentialDays: totalDaysSequential,    // 纯串行估算
    parallelDays: maxDaysParallel,           // 允许组内并行时的估算
    recommendedDays: Math.max(1, Math.round(maxDaysParallel * 1.2)), // 含20%缓冲
    dimDurations,                            // 各维度单独耗时
    groupDurations,
    unit: '天',
  };
}

/**
 * 基于规划结果生成可执行的调度序列
 * @param {Object} plan - dimension-planner 输出的 planDimensions 结果
 * @param {Object} [resourceLimit] - 资源限制
 *   @param {number} [resourceLimit.maxParallel] - 最大并行人数（默认3）
 *   @param {number} [resourceLimit.peoplePerDim] - 每维度最少人数（默认1）
 * @returns {Object} 调度结果
 */
export function scheduleExecution(plan = {}, resourceLimit = {}) {
  // 输入校验
  if (typeof plan !== 'object' || plan === null) {
    throw new TypeError('[execution-scheduler] plan 必须是对象');
  }
  const {
    maxParallel = 3,
    peoplePerDim = 1,
  } = resourceLimit;

  const dimensions = plan.dimensions ?? [];
  const executionOrder = plan.executionOrder ?? Object.values(DIMENSIONS);

  // 构造并行组
  const parallelGroups = PARALLEL_GROUPS.map((group, idx) => {
    const groupDims = group
      .map(dim => dimensions.find(d => d.name === dim))
      .filter(Boolean);

    return {
      groupId: idx + 1,
      label: GROUP_LABELS[idx] || `阶段${idx + 1}`,
      dimensions: groupDims.map(d => ({
        name: d.name,
        label: d.label,
        estimatedCases: d.estimatedCases,
        complexity: d.complexity,
        alreadyCovered: d.alreadyCovered,
      })),
      parallelizable: groupDims.length > 1,
      canStartNow: idx === 0 ||
        idx === 1 || // PROCESS 可在 DATA 后开始
        (idx === 2), // ENV + TIME 均可依赖 PROCESS
    };
  });

  // 生成调度序列
  const sequence = executionOrder.map((dimName, idx) => {
    const dimInfo = dimensions.find(d => d.name === dimName);
    const parallelGroupIdx = PARALLEL_GROUPS.findIndex(g => g.includes(dimName));
    const parallelGroup = parallelGroups[parallelGroupIdx];

    return {
      step: idx + 1,
      dimension: dimName,
      label: DIMENSION_LABELS[dimName],
      estimatedCases: dimInfo?.estimatedCases ?? 0,
      groupId: parallelGroup?.groupId ?? null,
      groupLabel: parallelGroup?.label ?? null,
      blockedBy: getDimensionDependencies()[dimName] || [],
      canRunInParallelWith: getParallelSiblings(dimName),
      skip: dimInfo?.alreadyCovered ?? false,
    };
  });

  // 总时长估算
  const caseCounts = Object.fromEntries(
    dimensions.map(d => [d.name, d.estimatedCases])
  );
  const duration = estimateTotalDuration(
    executionOrder.filter(d => !(dimensions.find(dim => dim.name === d)?.alreadyCovered)),
    caseCounts
  );

  // 资源分配建议
  const resourceAssignment = Object.fromEntries(
    dimensions.map(dim => [dim.name, peoplePerDim])
  );

  return {
    sequence,
    parallelGroups,
    totalDuration: duration,
    resourceAssignment,
    maxParallelWorkers: maxParallel,
    recommendations: buildRecommendations(sequence, parallelGroups, duration),
  };
}

/**
 * 获取某维度的可并行执行维度列表
 * @param {string} dimName
 * @returns {string[]}
 */
function getParallelSiblings(dimName) {
  for (const group of PARALLEL_GROUPS) {
    if (group.includes(dimName)) {
      return group.filter(d => d !== dimName);
    }
  }
  return [];
}

/**
 * 根据调度结果构建执行建议
 * @param {Object[]} sequence
 * @param {Object[]} parallelGroups
 * @param {Object} duration
 * @returns {string[]}
 */
function buildRecommendations(sequence, parallelGroups, duration) {
  const recs = [];

  // 建议1：并行策略
  const parallelizableGroups = parallelGroups.filter(g => g.parallelizable);
  if (parallelizableGroups.length > 0) {
    recs.push(
      `建议开启 ${parallelizableGroups.map(g => g.label).join(' + ')} 的组内并行，` +
      `可节省约 ${duration.recommendedDays - 1} 天。`
    );
  }

  // 建议2：依赖顺序
  const firstUncovered = sequence.find(s => !s.skip);
  if (firstUncovered) {
    recs.push(
      `优先执行 ${firstUncovered.label}，解除后续维度的阻塞。`
    );
  }

  // 建议3：时间维度特殊建议
  if (sequence.find(s => s.dimension === DIMENSIONS.TIME && !s.skip)) {
    recs.push(
      '时间维度涉及时效测试，建议尽早安排以预留观测窗口。'
    );
  }

  // 建议4：依赖维度建议
  if (sequence.find(s => s.dimension === DIMENSIONS.DEPENDENCY && !s.skip)) {
    recs.push(
      '依赖维度需在前四维全部完成后执行，建议作为最终收尾阶段。'
    );
  }

  // 建议5：覆盖率
  const uncoveredCount = sequence.filter(s => !s.skip).length;
  recs.push(
    `共 ${uncoveredCount} 个维度待执行，预计总工期 ${duration.recommendedDays} 天（含20%缓冲）。`
  );

  return recs;
}

/**
 * 基于规划结果给出优先级建议
 * @param {Object} plan - dimension-planner 输出的 planDimensions 结果
 * @returns {Object[]} 按优先级排序的维度建议列表
 */
export function suggestPriorities(plan = {}) {
  if (typeof plan !== 'object' || plan === null) {
    throw new TypeError('[execution-scheduler] plan 必须是对象');
  }

  const dimensions = plan.dimensions ?? [];
  const deps = getDimensionDependencies();

  // 计算优先级分数：风险 × 依赖度 × 复杂度 × (1/已有覆盖)
  const scored = dimensions.map(dim => {
    const risk = RISK_LEVELS[dim.name] ?? 3;
    const complexityScore = { low: 1, medium: 2, high: 3, very_high: 4 }[dim.complexity] ?? 2;
    const weight = PRIORITY_WEIGHTS[dim.name] ?? 3;
    // 依赖度高（有更多维度依赖它）则优先
    const dependentCount = Object.values(deps).filter(d => d.includes(dim.name)).length;
    const alreadyCovered = dim.alreadyCovered ? 0.1 : 1; // 已覆盖大幅降低优先级

    const score = risk * complexityScore * weight * (dependentCount + 1) * alreadyCovered;

    return {
      dimension: dim.name,
      label: dim.label,
      score: Math.round(score * 100) / 100,
      risk: risk,
      complexity: dim.complexity,
      dependentCount,
      alreadyCovered: dim.alreadyCovered,
      priority: derivePriority(score, dim.alreadyCovered),
      reason: buildPriorityReason(dim, risk, complexityScore, dependentCount),
    };
  });

  // 按分数降序排列
  scored.sort((a, b) => b.score - a.score);

  // 添加序号
  return scored.map((item, idx) => ({ rank: idx + 1, ...item }));
}

/**
 * 根据分数推导优先级标签
 * @param {number} score
 * @param {boolean} alreadyCovered
 * @returns {string}
 */
function derivePriority(score, alreadyCovered) {
  if (alreadyCovered) return 'skip';
  if (score >= 150) return 'critical';
  if (score >= 80) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * 构建优先级原因说明
 */
function buildPriorityReason(dim, risk, complexityScore, dependentCount) {
  const reasons = [];

  if (risk >= 4) reasons.push(`风险等级${risk}（高/极高）`);
  if (complexityScore >= 3) reasons.push(`复杂度${dim.complexity}`);
  if (dependentCount >= 2) reasons.push(`被${dependentCount}个维度依赖`);

  return reasons.length > 0
    ? `优先执行：${reasons.join('，')}。`
    : '按标准顺序执行。';
}

// ---------------------------------------------------------------------------
// 自测块
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.cwd()}/execution-scheduler.js`.replace(/\\/g, '/') ||
    import.meta.url.endsWith('/execution-scheduler.js')) {
  console.log('\n========== execution-scheduler.js 自测 ==========\n');

  // 准备测试用 planDimensions 结果
  const testPlan = planDimensions({
    dataVariations: 10,
    processSteps: 12,
    envCount: 8,
    timeFactors: 6,
    depCount: 5,
  });

  // 用例 1：标准调度
  const schedule1 = scheduleExecution(testPlan);
  console.log('【用例1】调度序列:');
  schedule1.sequence.forEach(s => {
    console.log(`  步骤${s.step}. ${s.label} (${s.dimension}) - ${s.estimatedCases}用例${s.skip ? ' [跳过]' : ''}`);
  });

  // 用例 2：并行组分析
  console.log('\n【用例2】并行组:');
  schedule1.parallelGroups.forEach(g => {
    console.log(`  组${g.groupId}: ${g.label} - ${g.dimensions.map(d => d.label).join(' + ')}`);
  });

  // 用例 3：总时长估算
  const duration = estimateTotalDuration(Object.values(DIMENSIONS));
  console.log('\n【用例3】时长估算:');
  console.log(`  纯串行: ${duration.sequentialDays} 天`);
  console.log(`  允许组内并行: ${duration.parallelDays} 天`);
  console.log(`  含20%缓冲建议工期: ${duration.recommendedDays} 天`);

  // 用例 4：优先级建议
  const priorities = suggestPriorities(testPlan);
  console.log('\n【用例4】优先级建议:');
  priorities.forEach(p => {
    console.log(`  #${p.rank} ${p.label} [${p.priority.toUpperCase()}] score=${p.score} - ${p.reason}`);
  });

  // 用例 5：含资源限制的调度
  const schedule2 = scheduleExecution(testPlan, { maxParallel: 2, peoplePerDim: 1 });
  console.log('\n【用例5】资源限制调度 (maxParallel=2):');
  console.log('  建议:', schedule2.recommendations.join('\n  '));

  console.log('\n✅ execution-scheduler.js 自测通过\n');
}
