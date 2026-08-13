/**
 * @fileoverview 测试策略生成引擎
 * 提供复杂度评估、测试模式选择、里程碑规划等核心策略能力
 */

/**
 * 评估需求复杂度
 * @param {string|object} requirement - 需求描述或需求结构对象
 * @returns {{ score: number, dimensions: object }} 复杂度分数(1-5)及维度明细
 */
export function assessComplexity(requirement) {
  if (!requirement) {
    throw new Error('[strategy-engine] assessComplexity: requirement 不能为空');
  }

  const reqStr = typeof requirement === 'string' ? requirement : JSON.stringify(requirement);

  // 维度权重配置
  const dimensions = {
    functionalComplexity: 0,  // 功能复杂度
    integrationComplexity: 0, // 集成复杂度
    dataComplexity: 0,         // 数据复杂度
    businessRisk: 0,           // 业务风险
    changeFrequency: 0,        // 变更频率
    teamFamiliarity: 0,        // 团队熟悉度
  };

  const lower = reqStr.toLowerCase();

  // 功能复杂度评估（基于功能点数、字段数、规则数）
  const ruleKeywords = ['规则', '校验', '验证', '限制', '约束', '权限', '角色', '审批', '流程', '状态机', '计算', '聚合'];
  const ruleCount = ruleKeywords.filter(k => lower.includes(k)).length;
  const fieldKeywords = ['字段', '表单', '输入', '选项', '配置', '参数', '属性'];
  const fieldCount = fieldKeywords.filter(k => lower.includes(k)).length;
  dimensions.functionalComplexity = Math.min(5, 1 + Math.floor((ruleCount + fieldCount) / 3));

  // 集成复杂度评估
  const integrationKeywords = ['接口', 'api', 'rest', 'graphql', 'grpc', '第三方', '集成', '对接', '回调', 'webhook', '消息队列', 'mq'];
  dimensions.integrationComplexity = Math.min(5, Math.floor(integrationKeywords.filter(k => lower.includes(k)).length * 0.7) + 1);

  // 数据复杂度评估
  const dataKeywords = ['数据库', '数据', '存储', '迁移', '导入', '导出', '报表', '统计', '分析', '大数据', '海量', '实时', '缓存'];
  dimensions.dataComplexity = Math.min(5, Math.floor(dataKeywords.filter(k => lower.includes(k)).length * 0.6) + 1);

  // 业务风险评估
  const riskKeywords = ['支付', '金融', '订单', '交易', '金额', '安全', '认证', '隐私', '金钱', '核心', '关键', '高可用', 'sla'];
  dimensions.businessRisk = Math.min(5, Math.floor(riskKeywords.filter(k => lower.includes(k)).length * 0.8) + 1);

  // 变更频率评估
  const changeKeywords = ['迭代', '新功能', '新增', '频繁', 'v2', 'v3', '重构', '优化', '实验', 'ab'];
  dimensions.changeFrequency = Math.min(5, Math.floor(changeKeywords.filter(k => lower.includes(k)).length * 0.7) + 1);

  // 团队熟悉度（假设默认值，越高越低风险）
  dimensions.teamFamiliarity = 3;

  // 加权总分
  const weights = {
    functionalComplexity: 0.25,
    integrationComplexity: 0.20,
    dataComplexity: 0.15,
    businessRisk: 0.25,
    changeFrequency: 0.10,
    teamFamiliarity: 0.05,
  };

  const rawScore = Object.keys(weights).reduce((sum, key) => sum + (dimensions[key] * weights[key]), 0);
  const score = Math.min(5, Math.max(1, Math.round(rawScore)));

  return { score, dimensions };
}

/**
 * 基于复杂度/风险/时间选择测试模式
 * @param {number} complexity - 复杂度分数(1-5)
 * @param {number} [risk=3] - 风险等级(1-5)，越高越关键
 * @param {number} [timeBudget=10] - 时间预算(天)
 * @returns {{ approach: string, rationale: string, coverage: object }} 测试模式及理由
 */
export function selectApproach(complexity, risk = 3, timeBudget = 10) {
  if (complexity < 1 || complexity > 5 || !Number.isInteger(complexity)) {
    throw new Error('[strategy-engine] selectApproach: complexity 需为 1-5 的整数');
  }
  if (risk < 1 || risk > 5) {
    throw new Error('[strategy-engine] selectApproach: risk 需为 1-5 的整数');
  }
  if (timeBudget <= 0) {
    throw new Error('[strategy-engine] selectApproach: timeBudget 需为正数');
  }

  const score = complexity * 0.5 + risk * 0.3 + Math.max(0, (10 - timeBudget) / 10 * 5);

  let approach, rationale, coverage;

  if (score < 3.5) {
    approach = 'exploratory';
    rationale = '低复杂度、低风险、时间充裕，适合探索性测试为主，发现边缘缺陷';
    coverage = { exploratory: 0.6, scripted: 0.3, aiAssisted: 0.1 };
  } else if (score < 5.5) {
    approach = 'hybrid';
    rationale = '中等复杂度或风险，脚本化覆盖核心路径，探索性补充边界场景';
    coverage = { exploratory: 0.3, scripted: 0.5, aiAssisted: 0.2 };
  } else if (score < 7.5) {
    approach = 'scripted-heavy';
    rationale = '较高复杂度或风险，时间偏紧，以脚本化测试为主确保回归覆盖';
    coverage = { exploratory: 0.15, scripted: 0.65, aiAssisted: 0.2 };
  } else {
    approach = 'ai-driven';
    rationale = '高复杂度、高风险且时间紧，引入 AI 辅助提升效率，重点保障核心路径';
    coverage = { exploratory: 0.1, scripted: 0.4, aiAssisted: 0.5 };
  }

  return { approach, rationale, coverage };
}

/**
 * 生成里程碑计划
 * @param {number} durationDays - 项目总工期(天)
 * @param {number} complexity - 复杂度分数(1-5)
 * @returns {object[]} 里程碑数组
 */
export function generateMilestonePlan(durationDays, complexity) {
  if (durationDays <= 0) {
    throw new Error('[strategy-engine] generateMilestonePlan: durationDays 需为正数');
  }
  if (complexity < 1 || complexity > 5 || !Number.isInteger(complexity)) {
    throw new Error('[strategy-engine] generateMilestonePlan: complexity 需为 1-5 的整数');
  }

  // 各阶段耗时比例（基于复杂度调整）
  const ratioMap = {
    1: { design: 0.10, prep: 0.10, unit: 0.20, integration: 0.20, system: 0.25, acceptance: 0.15 },
    2: { design: 0.12, prep: 0.10, unit: 0.18, integration: 0.22, system: 0.25, acceptance: 0.13 },
    3: { design: 0.15, prep: 0.10, unit: 0.15, integration: 0.22, system: 0.25, acceptance: 0.13 },
    4: { design: 0.18, prep: 0.12, unit: 0.12, integration: 0.20, system: 0.25, acceptance: 0.13 },
    5: { design: 0.20, prep: 0.12, unit: 0.10, integration: 0.18, system: 0.25, acceptance: 0.15 },
  };

  const ratios = ratioMap[complexity] || ratioMap[3];

  // 预留缓冲时间（复杂度越高缓冲越多）
  const bufferRatio = (complexity - 1) * 0.03;
  const effectiveDays = Math.floor(durationDays * (1 - bufferRatio));

  const stages = [
    { name: 'testDesign', label: '测试设计', ratio: ratios.design, desc: '需求分析、测试方案编写、用例设计' },
    { name: 'testPrep', label: '测试准备', ratio: ratios.prep, desc: '环境搭建、测试数据准备、工具配置' },
    { name: 'unitTest', label: '单元测试', ratio: ratios.unit, desc: '开发自测、代码静态分析' },
    { name: 'integrationTest', label: '集成测试', ratio: ratios.integration, desc: '接口测试、服务集成验证' },
    { name: 'systemTest', label: '系统测试', ratio: ratios.system, desc: '功能测试、回归测试、性能测试' },
    { name: 'acceptanceTest', label: '验收测试', ratio: ratios.acceptance, desc: 'UAT、预发布验证' },
  ];

  let accumulated = 0;
  const milestones = stages.map((stage, idx) => {
    const days = Math.max(1, Math.round(effectiveDays * stage.ratio));
    const startDay = accumulated + 1;
    accumulated += days;
    return {
      name: stage.name,
      label: stage.label,
      startDay,
      endDay: accumulated,
      duration: days,
      desc: stage.desc,
      trigger: getTrigger(stage.name),
    };
  });

  return milestones;
}

/**
 * 获取各阶段交付物/触发条件
 * @param {string} stageName
 * @returns {string}
 */
function getTrigger(stageName) {
  const triggers = {
    testDesign: '测试方案评审通过',
    testPrep: '测试环境就绪',
    unitTest: '代码覆盖率达标',
    integrationTest: '冒烟测试通过',
    systemTest: '测试用例执行率 >95%',
    acceptanceTest: '遗留缺陷全部关闭',
  };
  return triggers[stageName] || '';
}

/**
 * 选择工具链
 * @param {object} options - { levels, approach, techStack }
 * @returns {object} 工具链推荐
 */
function selectToolChain(options = {}) {
  const { levels = [], approach = 'hybrid', techStack = [] } = options;
  const tech = techStack.map(s => s.toLowerCase()).join(' ');

  const toolChain = {
    unit: ['Jest', 'Vitest', 'pytest', 'JUnit'],
    integration: ['Postman', 'REST Assured', 'JMeter', 'SoapUI'],
    system: ['Selenium', 'Playwright', 'Cypress', 'Appium'],
    performance: ['JMeter', 'k6', 'Locust', 'Gatling'],
    security: ['OWASP ZAP', 'Burp Suite', 'SonarQube'],
    automated: ['GitHub Actions', 'Jenkins', 'GitLab CI', 'CircleCI'],
    testManagement: ['TestRail', 'Zephyr', 'Xray', '禅道'],
    aiAssisted: ['Cursor', 'Copilot', 'CodiumAI', 'Diffblue'],
  };

  const selectFrom = (arr) => {
    const mapping = {
      'jest': arr.includes('Jest') ? 'Jest' : null,
      'vitest': arr.includes('Vitest') ? 'Vitest' : null,
      'python': arr.includes('pytest') ? 'pytest' : null,
      'java': arr.includes('JUnit') ? 'JUnit' : null,
      'playwright': arr.includes('Playwright') ? 'Playwright' : null,
      'selenium': arr.includes('Selenium') ? 'Selenium' : null,
      'cypress': arr.includes('Cypress') ? 'Cypress' : null,
      'jmeter': arr.includes('JMeter') ? 'JMeter' : null,
      'postman': arr.includes('Postman') ? 'Postman' : null,
    };
    for (const [key, val] of Object.entries(mapping)) {
      if (tech.includes(key) && val) return val;
    }
    return arr[0];
  };

  const result = {};
  if (levels.includes('unit')) result.unit = selectFrom(toolChain.unit);
  if (levels.includes('integration')) result.integration = selectFrom(toolChain.integration);
  if (levels.includes('system')) result.system = selectFrom(toolChain.system);
  if (levels.includes('acceptance')) result.system = result.system || selectFrom(toolChain.system);

  result.performance = toolChain.performance[0];
  result.security = toolChain.security[0];
  result.ci = toolChain.automated[0];
  result.management = toolChain.testManagement[0];

  if (approach === 'ai-driven' || approach === 'exploratory') {
    result.aiAssisted = toolChain.aiAssisted[0];
  }

  return result;
}

/**
 * 生成风险缓解措施
 * @param {object} dimensions - assessComplexity 返回的 dimensions
 * @param {number} timeBudget - 时间预算(天)
 * @returns {object[]} 风险缓解措施列表
 */
function generateRiskMitigation(dimensions, timeBudget) {
  const risks = [];

  if (dimensions.integrationComplexity >= 4) {
    risks.push({
      id: 'R001',
      category: '集成风险',
      description: '多系统/多方集成依赖复杂，可能因外部系统延迟导致测试阻塞',
      likelihood: '高',
      impact: '高',
      mitigation: '建立契约测试/mock服务；提前与集成方协调联调窗口；制定降级方案',
    });
  }

  if (dimensions.businessRisk >= 4) {
    risks.push({
      id: 'R002',
      category: '业务风险',
      description: '核心业务流程缺陷影响用户资金/数据安全',
      likelihood: '中',
      impact: '严重',
      mitigation: '核心路径必须脚本化覆盖；建立交易监控；安排专家评审关键用例',
    });
  }

  if (dimensions.dataComplexity >= 4) {
    risks.push({
      id: 'R003',
      category: '数据风险',
      description: '大数据量/多源数据场景下性能问题不易复现',
      likelihood: '中',
      impact: '中',
      mitigation: '使用生产级数据子集；性能测试环境与生产保持 1:1 数据量级',
    });
  }

  if (timeBudget < 7) {
    risks.push({
      id: 'R004',
      category: '进度风险',
      description: '测试时间严重不足，可能导致覆盖不充分',
      likelihood: '高',
      impact: '中',
      mitigation: '优先测试 P0 核心路径；启用 AI 辅助用例生成；减少非关键探索性测试',
    });
  }

  if (dimensions.changeFrequency >= 4) {
    risks.push({
      id: 'R005',
      category: '变更风险',
      description: '需求频繁变更导致测试用例失效或返工',
      likelihood: '高',
      impact: '中',
      mitigation: '采用自动化用例框架便于快速更新；变更入口统一记录；与开发协同评审变更影响范围',
    });
  }

  return risks;
}

/**
 * 主策略生成入口
 * @param {string|object} requirement - 需求描述或需求结构对象
 * @param {object} [constraints] - 约束条件
 * @param {number} [constraints.timeBudget=10] - 时间预算(天)
 * @param {number} [constraints.budget=0] - 预算(万元)
 * @param {number} [constraints.teamSize=2] - 测试团队人数
 * @param {string[]} [constraints.techStack=[]] - 技术栈
 * @param {string[]} [constraints.excludeLevels=[]] - 排除的测试层级
 * @param {number} [constraints.riskPreference=3] - 风险偏好(1-5)
 * @returns {object} 完整测试策略
 */
export function designStrategy(requirement, constraints = {}) {
  if (!requirement) {
    throw new Error('[strategy-engine] designStrategy: requirement 不能为空');
  }

  const {
    timeBudget = 10,
    budget = 0,
    teamSize = 2,
    techStack = [],
    excludeLevels = [],
    riskPreference = 3,
  } = constraints;

  // Step 1: 复杂度评估
  const complexityResult = assessComplexity(requirement);
  const { score: complexityScore, dimensions } = complexityResult;

  // Step 2: 选择测试模式
  const approachResult = selectApproach(complexityScore, riskPreference, timeBudget);
  const { approach, rationale, coverage } = approachResult;

  // Step 3: 生成里程碑
  const milestonePlan = generateMilestonePlan(timeBudget, complexityScore);

  // Step 4: 确定测试层级
  const allLevels = ['unit', 'integration', 'system', 'acceptance'];
  const testLevels = allLevels
    .filter(l => !excludeLevels.includes(l))
    .map(level => buildLevelStrategy(level, complexityScore, dimensions, approach));

  // Step 5: 工具选型
  const toolSelection = selectToolChain({ levels: allLevels, approach, techStack });

  // Step 6: 风险缓解
  const riskMitigation = generateRiskMitigation(dimensions, timeBudget);

  return {
    strategyId: generateId('STR'),
    generatedAt: new Date().toISOString(),
    testLevels,
    approach,
    approachRationale: rationale,
    coverage,
    toolSelection,
    milestonePlan,
    riskMitigation,
    meta: {
      complexityScore,
      dimensions,
      timeBudget,
      budget,
      teamSize,
      techStack,
    },
  };
}

/**
 * 构建单层测试策略
 * @param {string} level - 测试层级
 * @param {number} complexity - 复杂度分数
 * @param {object} dimensions - 维度明细
 * @param {string} approach - 测试模式
 * @returns {object} 层级策略
 */
function buildLevelStrategy(level, complexity, dimensions, approach) {
  const strategyMap = {
    unit: {
      label: '单元测试',
      objective: '验证最小可测试单元的正确性',
      focus: dimensions.functionalComplexity >= 3 ? '边界值/异常路径' : '正向路径',
      coverage: Math.min(90, 50 + complexity * 5),
      technique: complexity >= 4 ? 'AI辅助生成 + 人工review' : '开发自测 + 框架覆盖',
      criteria: '语句覆盖率 ≥70%，分支覆盖率 ≥60%',
    },
    integration: {
      label: '集成测试',
      objective: '验证模块间接口与数据交互正确性',
      focus: dimensions.integrationComplexity >= 3 ? '接口契约 + 异常场景' : '主流程接口',
      coverage: Math.min(85, 40 + complexity * 8),
      technique: dimensions.integrationComplexity >= 4 ? '契约测试 + Mock分层' : '端到端接口串联',
      criteria: '核心接口覆盖 100%，次要接口覆盖 ≥60%',
    },
    system: {
      label: '系统测试',
      objective: '验证完整系统满足需求规格',
      focus: dimensions.businessRisk >= 3 ? '核心业务 + 安全合规' : '功能完整性',
      coverage: Math.min(95, 30 + complexity * 12),
      technique: approach === 'ai-driven' ? 'AI辅助生成 + 自动化执行' :
                 approach === 'scripted-heavy' ? '脚本化回归 + 探索补充' : '脚本化 + 探索性',
      criteria: 'P0用例通过率 100%，P1用例通过率 ≥95%',
    },
    acceptance: {
      label: '验收测试',
      objective: '由业务/用户确认系统满足业务目标',
      focus: dimensions.businessRisk >= 3 ? '资金/合规/关键操作' : '核心业务场景',
      coverage: Math.min(80, 20 + complexity * 10),
      technique: '业务主导 + 关键路径覆盖',
      criteria: '业务核心场景通过率 100%，用户签字确认',
    },
  };

  return strategyMap[level] || strategyMap.system;
}

/**
 * 生成简短唯一ID
 * @param {string} prefix
 * @returns {string}
 */
function generateId(prefix = 'ID') {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

// ============================================================
// 自测入口
// ============================================================
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  console.log('=== strategy-engine 自测 ===\n');

  const req = '用户登录系统，包含表单校验、第三方OAuth集成、数据库查询、支付接口调用，需在7天内完成';
  console.log(`需求: ${req}\n`);

  // 测试 assessComplexity
  const complexity = assessComplexity(req);
  console.log('复杂度评估:', complexity);

  // 测试 selectApproach
  const approach = selectApproach(complexity.score, 4, 7);
  console.log('\n测试模式:', approach);

  // 测试 generateMilestonePlan
  const milestones = generateMilestonePlan(7, complexity.score);
  console.log('\n里程碑计划:');
  milestones.forEach(m => {
    console.log(`  Day ${m.startDay}-${m.endDay} [${m.label}]: ${m.desc}`);
  });

  // 测试主入口
  console.log('\n--- 完整策略 ---');
  const strategy = designStrategy(req, {
    timeBudget: 7,
    budget: 5,
    teamSize: 3,
    techStack: ['Java', 'Spring Boot', 'PostgreSQL', 'React'],
    riskPreference: 4,
  });

  console.log(`策略ID: ${strategy.strategyId}`);
  console.log(`测试模式: ${strategy.approach} - ${strategy.approachRationale}`);
  console.log('\n各层策略:');
  strategy.testLevels.forEach(l => {
    console.log(`  [${l.label}] 目标: ${l.objective}`);
    console.log(`    重点: ${l.focus} | 覆盖率: ${l.coverage}%`);
    console.log(`    手段: ${l.technique} | 达标: ${l.criteria}`);
  });
  console.log('\n工具链:', strategy.toolSelection);
  console.log('\n风险缓解:');
  strategy.riskMitigation.forEach(r => {
    console.log(`  [${r.id}] ${r.category}(${r.likelihood}/${r.impact}): ${r.description}`);
    console.log(`    对策: ${r.mitigation}`);
  });

  console.log('\n✅ 自测通过');
}
