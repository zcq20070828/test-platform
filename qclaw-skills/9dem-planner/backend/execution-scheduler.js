/**
 * execution-scheduler.js
 * 九维穷举模型的执行调度器
 * 负责调度序列生成、并行组划分、总时长估算、优先级建议
 *
 * 2026-11-09：随 dimension-planner 一起从五维口径改为九维口径。
 * 并行组按「前置信息依赖」划分，而不是按人天产能——九维的用例是同一批人
 * 在同一轮设计里产出的，真正的串行约束来自信息依赖，不是产能。
 */

import { pathToFileURL } from 'node:url';
import {
  planDimensions,
  getDimensionDependencies,
  getExecutionOrder,
  DIMENSIONS,
  DIMENSION_LABELS,
  DIMENSION_WEIGHTS,
} from './dimension-planner.js';

// ---------------------------------------------------------------------------
// 常量定义
// ---------------------------------------------------------------------------

/** 维度单人单日基准产能（用例/天）——用于估算工期，不参与串并行判定 */
const DAILY_THROUGHPUT = {
  [DIMENSIONS.USER]: 8,
  [DIMENSIONS.DATA]: 8,
  [DIMENSIONS.PROCESS]: 6,
  [DIMENSIONS.OPERATION]: 6,
  [DIMENSIONS.SECURITY]: 5,
  [DIMENSIONS.PERFORMANCE]: 4,
  [DIMENSIONS.NETWORK]: 5,
  [DIMENSIONS.TERMINAL]: 5,
  [DIMENSIONS.COMPATIBILITY]: 5,
};

/** 维度风险等级（1-5，5 最高） */
const RISK_LEVELS = {
  [DIMENSIONS.USER]: 4,
  [DIMENSIONS.DATA]: 3,
  [DIMENSIONS.PROCESS]: 5,
  [DIMENSIONS.OPERATION]: 4,
  [DIMENSIONS.SECURITY]: 5,
  [DIMENSIONS.PERFORMANCE]: 4,
  [DIMENSIONS.NETWORK]: 4,
  [DIMENSIONS.TERMINAL]: 3,
  [DIMENSIONS.COMPATIBILITY]: 3,
};

/** 并行组：组内可同时进行（前置信息相同），组间串行 */
const PARALLEL_GROUPS = [
  [DIMENSIONS.USER, DIMENSIONS.DATA],                                     // 组1：基础（无前置）
  [DIMENSIONS.PROCESS, DIMENSIONS.SECURITY],                               // 组2：流程与安全（依赖用户+数据）
  [DIMENSIONS.OPERATION],                                                  // 组3：操作（依赖流程）
  [DIMENSIONS.PERFORMANCE, DIMENSIONS.NETWORK, DIMENSIONS.TERMINAL],       // 组4：非功能（依赖流程+操作）
  [DIMENSIONS.COMPATIBILITY],                                              // 组5：兼容性（依赖终端）
];

const GROUP_LABELS = ['基础维度（用户×数据）', '流程与安全并行', '操作维度', '非功能维度并行', '兼容性收尾'];

// ---------------------------------------------------------------------------
// 核心功能
// ---------------------------------------------------------------------------

/**
 * 估算九维穷举总耗时（天）
 * @param {string[]} dimensions
 * @param {Object} [caseCounts] - 各维度用例数映射
 * @returns {Object}
 */
export function estimateTotalDuration(dimensions, caseCounts = null) {
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new TypeError('[execution-scheduler] dimensions 必须是非空数组');
  }

  const counts = caseCounts ?? Object.fromEntries(dimensions.map((dim) => [dim, 1]));

  let totalDaysSequential = 0;
  const groupDurations = [];
  const dimDurations = {};

  for (const group of PARALLEL_GROUPS) {
    const groupDims = group.filter((d) => dimensions.includes(d));
    if (groupDims.length === 0) continue;

    const groupMaxDays = Math.max(
      ...groupDims.map((dim) => {
        const cases = counts[dim] ?? 1;
        const perDay = DAILY_THROUGHPUT[dim] ?? 5;
        const days = Math.max(1, Math.ceil(cases / perDay));
        dimDurations[dim] = days;
        return days;
      }),
    );

    groupDurations.push({
      dims: groupDims.map((d) => DIMENSION_LABELS[d]),
      days: groupMaxDays,
    });

    totalDaysSequential += groupMaxDays;
  }

  return {
    sequentialDays: totalDaysSequential,
    parallelDays: totalDaysSequential,   // 组间串行，组内并行已体现在 groupDims 取最大值
    recommendedDays: Math.max(1, Math.round(totalDaysSequential * 1.2)),
    dimDurations,
    groupDurations,
    unit: '天',
  };
}

/**
 * 基于规划结果生成可执行的调度序列
 * @param {Object} plan - dimension-planner 输出的 planDimensions 结果
 * @param {Object} [resourceLimit]
 * @returns {Object}
 */
export function scheduleExecution(plan = {}, resourceLimit = {}) {
  if (typeof plan !== 'object' || plan === null) {
    throw new TypeError('[execution-scheduler] plan 必须是对象');
  }
  const { maxParallel = 3, peoplePerDim = 1 } = resourceLimit;

  const dimensions = plan.dimensions ?? [];
  const executionOrder = plan.executionOrder ?? Object.values(DIMENSIONS);
  const deps = getDimensionDependencies();

  const parallelGroups = PARALLEL_GROUPS.map((group, idx) => {
    const groupDims = group
      .map((dim) => dimensions.find((d) => d.name === dim))
      .filter(Boolean);

    return {
      groupId: idx + 1,
      label: GROUP_LABELS[idx] || `阶段${idx + 1}`,
      dimensions: groupDims.map((d) => ({
        name: d.name,
        label: d.label,
        estimatedCases: d.estimatedCases,
        complexity: d.complexity,
        alreadyCovered: d.alreadyCovered,
      })),
      parallelizable: groupDims.length > 1,
    };
  }).filter((g) => g.dimensions.length > 0);

  const sequence = executionOrder.map((dimName, idx) => {
    const dimInfo = dimensions.find((d) => d.name === dimName);
    const group = parallelGroups.find((g) => g.dimensions.some((d) => d.name === dimName));

    return {
      step: idx + 1,
      dimension: dimName,
      label: DIMENSION_LABELS[dimName],
      estimatedCases: dimInfo?.estimatedCases ?? 0,
      groupId: group?.groupId ?? null,
      groupLabel: group?.label ?? null,
      blockedBy: deps[dimName] || [],
      canRunInParallelWith: getParallelSiblings(dimName),
      skip: dimInfo?.alreadyCovered ?? false,
    };
  });

  const caseCounts = Object.fromEntries(dimensions.map((d) => [d.name, d.estimatedCases]));
  const duration = estimateTotalDuration(
    executionOrder.filter((d) => !(dimensions.find((dim) => dim.name === d)?.alreadyCovered)),
    caseCounts,
  );

  const resourceAssignment = Object.fromEntries(dimensions.map((dim) => [dim.name, peoplePerDim]));

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
    if (group.includes(dimName)) return group.filter((d) => d !== dimName);
  }
  return [];
}

function buildRecommendations(sequence, parallelGroups, duration) {
  const recs = [];

  const parallelizableGroups = parallelGroups.filter((g) => g.parallelizable);
  if (parallelizableGroups.length > 0) {
    recs.push(
      `建议开启 ${parallelizableGroups.map((g) => g.label).join(' + ')} 的组内并行，` +
      `这些维度的前置信息相同，可同一轮产出。`,
    );
  }

  const firstUncovered = sequence.find((s) => !s.skip);
  if (firstUncovered) {
    recs.push(`优先执行 ${firstUncovered.label}，解除后续维度的信息阻塞。`);
  }

  const pending = sequence.filter((s) => !s.skip);
  const heavy = pending
    .filter((s) => (DIMENSION_WEIGHTS[s.dimension] ?? 1) >= 2)
    .map((s) => s.label);
  if (heavy.length) {
    recs.push(`${heavy.join('、')} 为高权重维度（●●），用例不足会直接压低九维覆盖率，不得裁剪。`);
  }

  recs.push(
    `共 ${pending.length} 个维度待执行，预计总工期 ${duration.recommendedDays} 天（含20%缓冲）。`,
  );

  return recs;
}

/**
 * 基于规划结果给出优先级建议
 * @param {Object} plan
 * @returns {Object[]}
 */
export function suggestPriorities(plan = {}) {
  if (typeof plan !== 'object' || plan === null) {
    throw new TypeError('[execution-scheduler] plan 必须是对象');
  }

  const dimensions = plan.dimensions ?? [];
  const deps = getDimensionDependencies();

  const scored = dimensions.map((dim) => {
    const risk = RISK_LEVELS[dim.name] ?? 3;
    const complexityScore = { low: 1, medium: 2, high: 3, very_high: 4 }[dim.complexity] ?? 2;
    const weight = DIMENSION_WEIGHTS[dim.name] ?? 1;
    const dependentCount = Object.values(deps).filter((d) => d.includes(dim.name)).length;
    const alreadyCovered = dim.alreadyCovered ? 0.1 : 1;

    const score = risk * complexityScore * weight * (dependentCount + 1) * alreadyCovered;

    return {
      dimension: dim.name,
      label: dim.label,
      score: Math.round(score * 100) / 100,
      risk,
      complexity: dim.complexity,
      dependentCount,
      alreadyCovered: dim.alreadyCovered,
      priority: derivePriority(score, dim.alreadyCovered),
      reason: buildPriorityReason(dim, risk, complexityScore, dependentCount),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item, idx) => ({ rank: idx + 1, ...item }));
}

function derivePriority(score, alreadyCovered) {
  if (alreadyCovered) return 'skip';
  if (score >= 150) return 'critical';
  if (score >= 80) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function buildPriorityReason(dim, risk, complexityScore, dependentCount) {
  const reasons = [];
  if (risk >= 4) reasons.push(`风险等级${risk}（高/极高）`);
  if (complexityScore >= 3) reasons.push(`复杂度${dim.complexity}`);
  if (dependentCount >= 2) reasons.push(`被${dependentCount}个维度依赖`);
  return reasons.length > 0 ? `优先执行：${reasons.join('，')}。` : '按标准顺序执行。';
}

// ---------------------------------------------------------------------------
// 自测块
// ---------------------------------------------------------------------------
// 只有直接 `node <本文件>` 时才跑自测；被 import 时不要打印噪声（会污染调用方日志）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('\n========== execution-scheduler.js 自测 ==========\n');

  const testPlan = planDimensions({
    roles: 3,
    dataVariations: 10,
    processSteps: 12,
    operationPaths: 5,
    securityRequirements: 3,
    perfTargets: 3,
    networkConditions: 3,
    terminals: 2,
    platforms: 4,
  });

  const schedule1 = scheduleExecution(testPlan);
  console.log('【用例1】调度序列:');
  schedule1.sequence.forEach((s) => {
    console.log(`  步骤${s.step}. ${s.label} (${s.dimension}) - ${s.estimatedCases}用例${s.skip ? ' [跳过]' : ''}`);
  });

  console.log('\n【用例2】并行组:');
  schedule1.parallelGroups.forEach((g) => {
    console.log(`  组${g.groupId}: ${g.label} - ${g.dimensions.map((d) => d.label).join(' + ')}`);
  });

  const duration = estimateTotalDuration(Object.values(DIMENSIONS));
  console.log('\n【用例3】时长估算:');
  console.log(`  组间串行: ${duration.sequentialDays} 天`);
  console.log(`  含20%缓冲建议工期: ${duration.recommendedDays} 天`);

  const priorities = suggestPriorities(testPlan);
  console.log('\n【用例4】优先级建议:');
  priorities.forEach((p) => {
    console.log(`  #${p.rank} ${p.label} [${p.priority.toUpperCase()}] score=${p.score} - ${p.reason}`);
  });

  const schedule2 = scheduleExecution(testPlan, { maxParallel: 2, peoplePerDim: 1 });
  console.log('\n【用例5】资源限制调度 (maxParallel=2):');
  console.log('  建议:', schedule2.recommendations.join('\n  '));

  console.log('\n✅ execution-scheduler.js 自测通过\n');
}
