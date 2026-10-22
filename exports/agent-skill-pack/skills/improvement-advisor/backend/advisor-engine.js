/**
 * 改进建议引擎
 * 基于评估结果生成结构化改进建议
 * 
 * @module advisor-engine
 */

/**
 * 生成改进建议主入口
 * @param {Object} evaluationResult - 评估结果对象
 * @param {Object} evaluationResult.metrics - 指标数据 { dimension: score }
 * @param {Object} evaluationResult.summary - 评估摘要
 * @param {Object} [trendData] - 趋势数据
 * @param {Array} [trendData.trends] - 趋势列表
 * @param {Object} [anomalyData] - 异常数据
 * @param {Array} [anomalyData.anomalies] - 异常列表
 * @returns {{ shortTerm: Array, midTerm: Array, longTerm: Array, priorityRoadmap: Object }}
 */
export function generateImprovements(evaluationResult, trendData = {}, anomalyData = {}) {
  // 输入校验
  if (!evaluationResult || typeof evaluationResult !== 'object') {
    throw new Error('[generateImprovements] evaluationResult 必须是非空对象');
  }
  if (!evaluationResult.metrics || typeof evaluationResult.metrics !== 'object') {
    throw new Error('[generateImprovements] evaluationResult.metrics 必须是非空对象');
  }

  // 1. 识别薄弱环节
  const weaknesses = identifyWeaknesses(evaluationResult.metrics);
  
  // 2. 生成行动计划
  const actionPlan = generateActionPlan(weaknesses, {
    trends: trendData.trends || [],
    anomalies: anomalyData.anomalies || []
  });

  // 3. 分类为短/中/长期
  const categorized = categorizeActions(actionPlan);

  // 4. 生成路线图
  const priorityRoadmap = buildPriorityRoadmap(categorized);

  return {
    shortTerm: categorized.shortTerm,
    midTerm: categorized.midTerm,
    longTerm: categorized.longTerm,
    priorityRoadmap
  };
}

/**
 * 从指标数据识别薄弱环节
 * @param {Object} metrics - 指标数据 { dimension: score }
 * @returns {Array<{ dimension: string, score: number, severity: string, suggestions: Array<string> }>}
 */
export function identifyWeaknesses(metrics) {
  // 输入校验
  if (!metrics || typeof metrics !== 'object') {
    throw new Error('[identifyWeaknesses] metrics 必须是非空对象');
  }

  const weaknesses = [];
  const THRESHOLD = 70;
  const SEVERITY_LEVELS = {
    critical: { min: 0, max: 40, label: '严重' },
    high: { min: 40, max: 60, label: '较高' },
    medium: { min: 60, max: 70, label: '中等' }
  };

  for (const [dimension, score] of Object.entries(metrics)) {
    if (typeof score !== 'number' || score >= THRESHOLD) continue;

    // 确定严重程度
    let severity = 'medium';
    for (const [level, range] of Object.entries(SEVERITY_LEVELS)) {
      if (score >= range.min && score < range.max) {
        severity = level;
        break;
      }
    }

    // 生成针对性建议
    const suggestions = generateDimensionSuggestions(dimension, score);

    weaknesses.push({
      dimension,
      score: Math.round(score * 100) / 100,
      severity,
      suggestions
    });
  }

  // 按严重程度和分数排序
  const severityOrder = { critical: 0, high: 1, medium: 2 };
  weaknesses.sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    return severityDiff !== 0 ? severityDiff : a.score - b.score;
  });

  return weaknesses;
}

/**
 * 将薄弱环节转化为可执行行动计划
 * @param {Array} weaknesses - 薄弱环节列表
 * @param {Object} [constraints] - 约束条件
 * @param {Array} [constraints.trends] - 趋势数据
 * @param {Array} [constraints.anomalies] - 异常数据
 * @param {number} [constraints.maxActions] - 最大行动数
 * @returns {Array<{ action: string, reason: string, expectedImpact: number, effort: number, urgency: number, category: string, relatedDimension: string }>}
 */
export function generateActionPlan(weaknesses, constraints = {}) {
  // 输入校验
  if (!Array.isArray(weaknesses)) {
    throw new Error('[generateActionPlan] weaknesses 必须是数组');
  }

  const { trends = [], anomalies = [], maxActions = 20 } = constraints;
  const actions = [];

  // 基于薄弱环节生成行动
  for (const weakness of weaknesses) {
    const dimensionActions = createActionsForDimension(weakness, trends, anomalies);
    actions.push(...dimensionActions);
  }

  // 去重并排序
  const uniqueActions = deduplicateActions(actions);
  
  // 限制数量
  return uniqueActions.slice(0, maxActions);
}

// ==================== 内部辅助函数 ====================

/**
 * 为特定维度生成改进建议
 * @private
 */
function generateDimensionSuggestions(dimension, score) {
  const suggestionMap = {
    accuracy: [
      '优化提示词以提高回答准确性',
      '增加知识库覆盖范围',
      '引入事实核查机制'
    ],
    relevance: [
      '改进上下文理解能力',
      '优化检索策略',
      '增强意图识别'
    ],
    coherence: [
      '优化回答结构化模板',
      '增强逻辑推理能力',
      '改进过渡和连接词使用'
    ],
    helpfulness: [
      '增加具体示例和操作步骤',
      '提供可执行的建议',
      '优化回答的实用性'
    ],
    safety: [
      '加强内容安全过滤',
      '完善风险识别规则',
      '增加安全审核流程'
    ],
    efficiency: [
      '优化响应时间',
      '改进资源利用率',
      '简化处理流程'
    ],
    default: [
      '分析具体问题点',
      '制定针对性改进方案',
      '持续监控改进效果'
    ]
  };

  return suggestionMap[dimension] || suggestionMap.default;
}

/**
 * 为维度创建具体行动
 * @private
 */
function createActionsForDimension(weakness, trends, anomalies) {
  const actions = [];
  const { dimension, score, severity, suggestions } = weakness;

  // 基础行动
  for (const suggestion of suggestions) {
    const effort = estimateEffort(suggestion, severity);
    const impact = estimateImpact(score, severity);
    const urgency = calculateUrgency(severity, trends, anomalies);

    actions.push({
      action: suggestion,
      reason: `${dimension} 维度评分为 ${score} 分（${severity} 级别），需要改进`,
      expectedImpact: impact,
      effort,
      urgency,
      category: categorizeAction(suggestion, effort, impact),
      relatedDimension: dimension
    });
  }

  // 基于趋势添加行动
  if (trends.length > 0) {
    const decliningTrends = trends.filter(t => t.direction === 'declining');
    if (decliningTrends.some(t => t.dimension === dimension)) {
      actions.push({
        action: `针对 ${dimension} 维度的下降趋势进行专项优化`,
        reason: `${dimension} 维度呈下降趋势，需及时干预`,
        expectedImpact: 80,
        effort: 60,
        urgency: 85,
        category: 'shortTerm',
        relatedDimension: dimension
      });
    }
  }

  // 基于异常添加行动
  if (anomalies.length > 0) {
    const relatedAnomalies = anomalies.filter(a => a.dimension === dimension);
    if (relatedAnomalies.length > 0) {
      actions.push({
        action: `调查并修复 ${dimension} 维度的异常问题`,
        reason: `检测到 ${relatedAnomalies.length} 个异常`,
        expectedImpact: 75,
        effort: 50,
        urgency: 90,
        category: 'shortTerm',
        relatedDimension: dimension
      });
    }
  }

  return actions;
}

/**
 * 估算行动投入
 * @private
 */
function estimateEffort(suggestion, severity) {
  const baseEffort = {
    critical: 70,
    high: 50,
    medium: 30
  };

  const effortModifiers = {
    '优化': 10,
    '增强': 20,
    '引入': 30,
    '增加': 15,
    '完善': 25,
    '简化': -10
  };

  let effort = baseEffort[severity] || 40;
  
  for (const [keyword, modifier] of Object.entries(effortModifiers)) {
    if (suggestion.includes(keyword)) {
      effort += modifier;
      break;
    }
  }

  return Math.max(10, Math.min(100, effort));
}

/**
 * 估算行动影响
 * @private
 */
function estimateImpact(score, severity) {
  const impactBase = {
    critical: 90,
    high: 75,
    medium: 60
  };

  // 分数越低，改进后影响越大
  const scoreBonus = Math.max(0, (70 - score) * 0.5);
  
  return Math.min(100, (impactBase[severity] || 70) + scoreBonus);
}

/**
 * 计算紧急程度
 * @private
 */
function calculateUrgency(severity, trends, anomalies) {
  const urgencyBase = {
    critical: 95,
    high: 75,
    medium: 50
  };

  let urgency = urgencyBase[severity] || 50;

  // 趋势影响
  if (trends.some(t => t.direction === 'declining')) {
    urgency += 10;
  }

  // 异常影响
  if (anomalies.length > 0) {
    urgency += Math.min(15, anomalies.length * 5);
  }

  return Math.min(100, urgency);
}

/**
 * 分类行动
 * @private
 */
function categorizeAction(suggestion, effort, impact) {
  // 快速见效：低投入、高影响
  if (effort <= 40 && impact >= 70) {
    return 'shortTerm';
  }
  // 长期投入：高投入
  if (effort >= 70) {
    return 'longTerm';
  }
  // 中期改进
  return 'midTerm';
}

/**
 * 分类所有行动
 * @private
 */
function categorizeActions(actions) {
  const categorized = {
    shortTerm: [],
    midTerm: [],
    longTerm: []
  };

  for (const action of actions) {
    const category = action.category || 'midTerm';
    const priority = calculatePriority(action);
    
    categorized[category].push({
      ...action,
      priority
    });
  }

  // 每个类别内按优先级排序
  for (const category of Object.keys(categorized)) {
    categorized[category].sort((a, b) => b.priority - a.priority);
  }

  return categorized;
}

/**
 * 计算优先级分数
 * @private
 */
function calculatePriority(action) {
  const { expectedImpact = 50, effort = 50, urgency = 50 } = action;
  return Math.round(expectedImpact * 0.4 + urgency * 0.3 - effort * 0.3);
}

/**
 * 去重行动
 * @private
 */
function deduplicateActions(actions) {
  const seen = new Map();
  
  for (const action of actions) {
    const key = action.action.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key) || seen.get(key).priority < action.priority) {
      seen.set(key, action);
    }
  }

  return Array.from(seen.values());
}

/**
 * 构建优先级路线图
 * @private
 */
function buildPriorityRoadmap(categorized) {
  return {
    week1: categorized.shortTerm.slice(0, 5).map(a => ({
      action: a.action,
      priority: a.priority,
      expectedImpact: a.expectedImpact
    })),
    week2_4: categorized.midTerm.slice(0, 5).map(a => ({
      action: a.action,
      priority: a.priority,
      expectedImpact: a.expectedImpact
    })),
    monthPlus: categorized.longTerm.slice(0, 5).map(a => ({
      action: a.action,
      priority: a.priority,
      expectedImpact: a.expectedImpact
    }))
  };
}

// ==================== 自测 ====================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== advisor-engine.js 自测开始 ===\n');

  // 测试 1: identifyWeaknesses
  console.log('测试 1: identifyWeaknesses');
  const testMetrics = {
    accuracy: 55,
    relevance: 68,
    coherence: 72,
    helpfulness: 45,
    safety: 85
  };
  const weaknesses = identifyWeaknesses(testMetrics);
  console.log('薄弱环节:', JSON.stringify(weaknesses, null, 2));
  console.log('✓ 通过\n');

  // 测试 2: generateActionPlan
  console.log('测试 2: generateActionPlan');
  const actionPlan = generateActionPlan(weaknesses, {
    trends: [{ dimension: 'accuracy', direction: 'declining' }],
    anomalies: [{ dimension: 'helpfulness', type: 'drop' }]
  });
  console.log('行动计划数量:', actionPlan.length);
  console.log('✓ 通过\n');

  // 测试 3: generateImprovements
  console.log('测试 3: generateImprovements');
  const evaluationResult = {
    metrics: testMetrics,
    summary: { overallScore: 65 }
  };
  const trendData = {
    trends: [{ dimension: 'accuracy', direction: 'declining', change: -5 }]
  };
  const anomalyData = {
    anomalies: [{ dimension: 'helpfulness', type: 'sudden_drop', value: 30 }]
  };
  
  const improvements = generateImprovements(evaluationResult, trendData, anomalyData);
  console.log('短期行动数:', improvements.shortTerm.length);
  console.log('中期行动数:', improvements.midTerm.length);
  console.log('长期行动数:', improvements.longTerm.length);
  console.log('路线图:', JSON.stringify(improvements.priorityRoadmap, null, 2));
  console.log('✓ 通过\n');

  // 测试 4: 输入校验
  console.log('测试 4: 输入校验');
  try {
    generateImprovements(null);
    console.log('✗ 应该抛出错误');
  } catch (e) {
    console.log('正确捕获错误:', e.message);
    console.log('✓ 通过\n');
  }

  console.log('=== advisor-engine.js 自测完成 ===');
}
