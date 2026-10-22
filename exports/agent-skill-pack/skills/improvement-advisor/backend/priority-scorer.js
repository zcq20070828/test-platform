/**
 * 优先级评分器
 * 对改进行动进行综合评分、排序和路线图规划
 * 
 * @module priority-scorer
 */

/**
 * 对改进行动进行综合评分
 * 公式: impact × 0.4 + urgency × 0.3 - effort × 0.3
 * 
 * @param {string} action - 改进行动描述
 * @param {number} effort - 投入精力 (0~100)
 * @param {number} expectedImpact - 预期影响 (0~100)
 * @param {number} urgency - 紧急程度 (0~100)
 * @returns {number} 综合评分 (0~100)
 */
export function scoreAction(action, effort, expectedImpact, urgency) {
  // 输入校验
  if (typeof action !== 'string' || action.trim().length === 0) {
    throw new Error('[scoreAction] action 必须是非空字符串');
  }
  if (typeof effort !== 'number' || effort < 0 || effort > 100) {
    throw new Error('[scoreAction] effort 必须是 0~100 的数字');
  }
  if (typeof expectedImpact !== 'number' || expectedImpact < 0 || expectedImpact > 100) {
    throw new Error('[scoreAction] expectedImpact 必须是 0~100 的数字');
  }
  if (typeof urgency !== 'number' || urgency < 0 || urgency > 100) {
    throw new Error('[scoreAction] urgency 必须是 0~100 的数字');
  }

  // 计算综合评分
  const score = expectedImpact * 0.4 + urgency * 0.3 - effort * 0.3;
  
  // 确保在 0~100 范围内
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * 对行动列表按综合评分排序
 * @param {Array<Object>} actions - 行动列表
 * @param {string} actions[].action - 行动描述
 * @param {number} actions[].effort - 投入精力
 * @param {number} actions[].expectedImpact - 预期影响
 * @param {number} actions[].urgency - 紧急程度
 * @returns {Array<Object>} 排序后的行动列表（降序）
 */
export function rankActions(actions) {
  // 输入校验
  if (!Array.isArray(actions)) {
    throw new Error('[rankActions] actions 必须是数组');
  }

  // 计算每项的分数
  const scoredActions = actions.map((item, index) => {
    const effort = item.effort ?? 50;
    const expectedImpact = item.expectedImpact ?? 50;
    const urgency = item.urgency ?? 50;

    const priority = scoreAction(
      item.action || `Action ${index + 1}`,
      effort,
      expectedImpact,
      urgency
    );

    return {
      ...item,
      priority,
      _index: index // 保持原始顺序用于稳定排序
    };
  });

  // 降序排序（高优先级在前）
  scoredActions.sort((a, b) => {
    const priorityDiff = b.priority - a.priority;
    return priorityDiff !== 0 ? priorityDiff : a._index - b._index;
  });

  // 移除临时字段
  return scoredActions.map(({ _index, ...rest }) => rest);
}

/**
 * 估算投入产出比（ROI）
 * @param {Object} action - 行动对象
 * @param {string} action.action - 行动描述
 * @param {number} action.effort - 投入精力 (0~100)
 * @param {number} action.expectedImpact - 预期影响 (0~100)
 * @returns {{ roi: number, level: string, description: string }}
 */
export function estimateROI(action) {
  // 输入校验
  if (!action || typeof action !== 'object') {
    throw new Error('[estimateROI] action 必须是非空对象');
  }

  const effort = action.effort ?? 50;
  const expectedImpact = action.expectedImpact ?? 50;

  if (effort === 0) {
    return {
      roi: expectedImpact,
      level: 'excellent',
      description: '零投入高收益，优先执行'
    };
  }

  // ROI = 预期收益 / 投入精力
  const roi = Math.round((expectedImpact / effort) * 100) / 100;

  // 划分等级
  let level, description;
  if (roi >= 1.5) {
    level = 'excellent';
    description = '高收益低投入，强烈推荐';
  } else if (roi >= 1.0) {
    level = 'good';
    description = '收益大于投入，值得执行';
  } else if (roi >= 0.7) {
    level = 'fair';
    description = '收益接近投入，可考虑执行';
  } else {
    level = 'low';
    description = '投入大于收益，优先级较低';
  }

  return {
    roi: Math.round(roi * 100) / 100,
    level,
    description
  };
}

/**
 * 生成改进路线图
 * @param {Array<Object>} actions - 行动列表
 * @param {Object} [timelineConstraints] - 时间约束
 * @param {number} [timelineConstraints.weeks] - 总周数（默认 4）
 * @param {number} [timelineConstraints.maxPerWeek] - 每周最大行动数（默认 3）
 * @param {Date} [timelineConstraints.startDate] - 开始日期
 * @returns {{ weeks: Array, summary: Object }}
 */
export function generateRoadmap(actions, timelineConstraints = {}) {
  // 输入校验
  if (!Array.isArray(actions)) {
    throw new Error('[generateRoadmap] actions 必须是数组');
  }

  const {
    weeks = 4,
    maxPerWeek = 3,
    startDate = new Date()
  } = timelineConstraints;

  // 排序行动
  const rankedActions = rankActions(actions);

  // 初始化周数组
  const weeksArray = Array.from({ length: weeks }, (_, i) => ({
    weekNumber: i + 1,
    startDate: getWeekStartDate(startDate, i),
    endDate: getWeekStartDate(startDate, i + 1),
    actions: [],
    totalEffort: 0,
    totalImpact: 0
  }));

  // 分配行动到各周
  for (const action of rankedActions) {
    // 找到第一个有空间且努力值总和最低的周
    let targetWeekIndex = -1;
    let minEffort = Infinity;

    for (let i = 0; i < weeksArray.length; i++) {
      const week = weeksArray[i];
      if (week.actions.length < maxPerWeek) {
        if (week.totalEffort < minEffort) {
          minEffort = week.totalEffort;
          targetWeekIndex = i;
        }
      }
    }

    if (targetWeekIndex >= 0) {
      const week = weeksArray[targetWeekIndex];
      const effort = action.effort ?? 50;
      const impact = action.expectedImpact ?? 50;

      week.actions.push({
        ...action,
        scheduledWeek: targetWeekIndex + 1
      });
      week.totalEffort += effort;
      week.totalImpact += impact;
    }
  }

  // 过滤空周
  const nonEmptyWeeks = weeksArray.filter(w => w.actions.length > 0);

  // 生成摘要
  const summary = {
    totalActions: rankedActions.length,
    scheduledActions: nonEmptyWeeks.reduce((sum, w) => sum + w.actions.length, 0),
    averagePriority: Math.round(
      rankedActions.reduce((sum, a) => sum + (a.priority || 50), 0) / rankedActions.length
    ),
    totalExpectedEffort: rankedActions.reduce((sum, a) => sum + (a.effort || 50), 0),
    totalExpectedImpact: rankedActions.reduce((sum, a) => sum + (a.expectedImpact || 50), 0)
  };

  return {
    weeks: nonEmptyWeeks,
    summary
  };
}

// ==================== 内部辅助函数 ====================

/**
 * 计算周的起始日期
 * @private
 */
function getWeekStartDate(startDate, weekOffset) {
  const date = new Date(startDate);
  date.setDate(date.getDate() + weekOffset * 7);
  return date.toISOString().split('T')[0];
}

/**
 * 格式化行动为字符串
 * @private
 */
function formatActionSummary(action) {
  const roi = estimateROI(action);
  return {
    action: action.action,
    priority: action.priority || 50,
    roi: roi.roi,
    roiLevel: roi.level
  };
}

// ==================== 自测 ====================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== priority-scorer.js 自测开始 ===\n');

  // 测试 1: scoreAction
  console.log('测试 1: scoreAction');
  const score1 = scoreAction('优化提示词', 30, 80, 70);
  console.log('评分 1:', score1, '(预期: 80×0.4 + 70×0.3 - 30×0.3 = 53)');
  const score2 = scoreAction('重构系统', 80, 60, 40);
  console.log('评分 2:', score2, '(预期: 60×0.4 + 40×0.3 - 80×0.3 = 16)');
  console.log('✓ 通过\n');

  // 测试 2: rankActions
  console.log('测试 2: rankActions');
  const testActions = [
    { action: '快速修复', effort: 20, expectedImpact: 70, urgency: 80 },
    { action: '长期重构', effort: 90, expectedImpact: 85, urgency: 30 },
    { action: '中期优化', effort: 50, expectedImpact: 75, urgency: 60 }
  ];
  const ranked = rankActions(testActions);
  console.log('排序结果:');
  ranked.forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.action} - 优先级: ${a.priority}`);
  });
  console.log('✓ 通过\n');

  // 测试 3: estimateROI
  console.log('测试 3: estimateROI');
  const highROI = estimateROI({ action: '快速优化', effort: 20, expectedImpact: 80 });
  console.log('高 ROI:', highROI);
  const lowROI = estimateROI({ action: '大规模重构', effort: 90, expectedImpact: 50 });
  console.log('低 ROI:', lowROI);
  console.log('✓ 通过\n');

  // 测试 4: generateRoadmap
  console.log('测试 4: generateRoadmap');
  const actions = [
    { action: '修复紧急 Bug', effort: 30, expectedImpact: 90, urgency: 95 },
    { action: '优化性能', effort: 50, expectedImpact: 75, urgency: 70 },
    { action: '重构代码', effort: 80, expectedImpact: 60, urgency: 40 },
    { action: '更新文档', effort: 20, expectedImpact: 50, urgency: 30 },
    { action: '添加测试', effort: 40, expectedImpact: 65, urgency: 55 },
    { action: '改进 UI', effort: 60, expectedImpact: 70, urgency: 50 }
  ];
  const roadmap = generateRoadmap(actions, { weeks: 3, maxPerWeek: 2 });
  console.log('路线图摘要:', roadmap.summary);
  console.log('周计划:');
  roadmap.weeks.forEach(w => {
    console.log(`  第 ${w.weekNumber} 周: ${w.actions.map(a => a.action).join(', ')}`);
    console.log(`    总投入: ${w.totalEffort}, 总影响: ${w.totalImpact}`);
  });
  console.log('✓ 通过\n');

  // 测试 5: 输入校验
  console.log('测试 5: 输入校验');
  try {
    scoreAction('', 50, 50, 50);
    console.log('✗ 应该抛出错误');
  } catch (e) {
    console.log('正确捕获错误:', e.message);
  }
  try {
    scoreAction('test', 150, 50, 50);
    console.log('✗ 应该抛出错误');
  } catch (e) {
    console.log('正确捕获错误:', e.message);
  }
  console.log('✓ 通过\n');

  console.log('=== priority-scorer.js 自测完成 ===');
}
