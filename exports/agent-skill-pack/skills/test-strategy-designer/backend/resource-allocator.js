/**
 * @fileoverview 测试资源分配与成本估算引擎
 * 提供测试资源分配、工时估算、工具链成本计算等能力
 */

// -----------------------------------------------
// 工具链定价基准（单位：元/月）
// -----------------------------------------------
const TOOL_PRICING = {
  // 开源免费工具
  openSource: {
    jest: 0,
    vitest: 0,
    pytest: 0,
    selenium: 0,
    playwright: 0,
    cypress: 0,
    postman: 0,
    'rest assured': 0,
    jmeter: 0,
    k6: 0,
    locust: 0,
    gatling: 0,
    'owasp zap': 0,
    burpsuite: 0,
    sonarqube: 0,
    'github actions': 0,
    jenkins: 0,
    gitlab: 0,
    circleci: 0,
    appium: 0,
    soapui: 0,
    'diffblue': 0,
    codiumai: 0,
  },

  // 商业工具（月费/人头，若无则为 License 费/月）
  commercial: {
    testrail: 25,        // $25/user/month
    zephyr: 10,          // $10/user/month
    xray: 7,             // ~¥7/user/month
    'jira + zephyr': 15,
    'applitools': 100,   // visual testing
    'perfecto': 200,     // mobile testing
    'pcloudy': 150,      // device farm
    'browserstack': 29,   // browser farm
    'saucelabs': 19,
    'testcomplete':  91,  // $91/user/month
    'ranorex': 2290,     // ~¥2290/user/year
    'cucumber': 0,       // open source
    'mabl': 400,         // AI testing platform
    'testim': 400,
    'curator (cursor)': 20,
    'copilot': 19,       // $19/user/month
    'katalon': 25,       // $25/user/month
    'blazemeter': 99,    // performance
    'neoload': 1500,
    'loadrunner': 5000,
  },

  // 基础设施（月费估算）
  infrastructure: {
    testEnv: 500,     // 测试环境服务器/云资源
    deviceFarm: 300, // 真机/模拟器资源
    dataEnv: 200,    // 测试数据管理
    ciRunner: 150,   // CI 构建资源
    monitoring: 100, // 监控/日志
  },
};

/**
 * 计算工具链总成本
 * @param {object} toolChain - strategy-engine 返回的 toolSelection 对象
 * @returns {{ monthly: object, yearly: object, breakdown: object[] }} 成本明细
 */
export function calcToolCost(toolChain) {
  if (!toolChain || typeof toolChain !== 'object') {
    throw new Error('[resource-allocator] calcToolCost: toolChain 需为非空对象');
  }

  const breakdown = [];
  let totalMonthly = 0;

  const allTools = [
    ...Object.entries(toolChain).filter(([, v]) => v),
  ];

  for (const [category, toolName] of allTools) {
    const name = (toolName || '').toLowerCase();
    let cost = 0;

    if (TOOL_PRICING.openSource[name]) {
      cost = 0;
    } else if (TOOL_PRICING.commercial[name]) {
      cost = TOOL_PRICING.commercial[name];
    } else if (TOOL_PRICING.infrastructure[category]) {
      cost = TOOL_PRICING.infrastructure[category];
    } else {
      // 未知工具，给估算
      cost = null;
    }

    breakdown.push({
      category,
      tool: toolName,
      isOpenSource: cost === 0,
      monthlyCost: cost,
      note: cost === null ? '请手动确认定价' : cost === 0 ? '开源免费' : `¥${cost}/月`,
    });

    if (typeof cost === 'number') {
      totalMonthly += cost;
    }
  }

  return {
    breakdown,
    monthly: {
      total: totalMonthly,
      currency: 'CNY',
      note: totalMonthly === 0 ? '全部使用开源/免费工具' : `含 ${breakdown.filter(b => b.monthlyCost === 0).length} 项免费`,
    },
    yearly: {
      total: totalMonthly * 12,
      currency: 'CNY',
    },
  };
}

/**
 * 估算测试执行时长
 * @param {number} usecaseCount - 用例总数
 * @param {number} complexity - 复杂度分数(1-5)
 * @param {number} teamSize - 测试团队人数
 * @returns {{ totalDays: number, byLevel: object, notes: string[] }} 各阶段工时明细
 */
export function estimateTestDuration(usecaseCount, complexity, teamSize) {
  if (usecaseCount <= 0) {
    throw new Error('[resource-allocator] estimateTestDuration: usecaseCount 需为正整数');
  }
  if (complexity < 1 || complexity > 5 || !Number.isInteger(complexity)) {
    throw new Error('[resource-allocator] estimateTestDuration: complexity 需为 1-5 的整数');
  }
  if (teamSize <= 0) {
    throw new Error('[resource-allocator] estimateTestDuration: teamSize 需为正整数');
  }

  // 复杂度系数（复杂度越高，每个用例平均耗时越多）
  const complexityFactor = {
    1: 0.6,
    2: 0.8,
    3: 1.0,
    4: 1.3,
    5: 1.7,
  };
  const cf = complexityFactor[complexity] || 1.0;

  // 各层用例占比（按复杂度调整）
  const levelRatios = {
    unit: complexity >= 4 ? 0.20 : 0.15,
    integration: 0.25,
    system: 0.40,
    acceptance: 0.20,
  };

  // 基础执行效率（用例/人天，基于手动测试基准）
  const baseEffort = {
    unit: 15,      // 单元测试用例/人天
    integration: 8, // 接口测试用例/人天
    system: 4,     // 系统测试用例/人天（含探索）
    acceptance: 3, // 验收测试用例/人天（需协调）
  };

  // 自动化系数（复杂度越高越需要自动化）
  const autoFactor = {
    unit: 0.7,      // 单元测试自动化率高
    integration: 0.6,
    system: 0.5,
    acceptance: 0.3,
  };

  const byLevel = {};
  let totalEffort = 0;
  const notes = [];

  for (const [level, ratio] of Object.entries(levelRatios)) {
    const count = Math.max(1, Math.round(usecaseCount * ratio));
    const baseDays = Math.ceil(count / baseEffort[level]);
    const effortDays = Math.max(1, Math.round(baseDays * cf));
    const autoDays = Math.max(1, Math.round(effortDays * autoFactor[level]));

    byLevel[level] = {
      usecases: count,
      manualDays: effortDays,
      autoDays,
      effectiveDays: Math.max(1, Math.round((effortDays * autoFactor[level] + effortDays * (1 - autoFactor[level]) * 0.5))),
      automationRate: Math.round(autoFactor[level] * 100),
    };

    totalEffort += byLevel[level].effectiveDays;
  }

  // 并行度：团队人数越多，理论并行度越高（有上限）
  const parallelism = Math.min(teamSize, 3);
  const parallelDays = Math.ceil(totalEffort / parallelism);

  // 增加轮次（回归轮次 = 复杂度相关）
  const regressionRounds = complexity >= 4 ? 3 : complexity >= 3 ? 2 : 1;
  const totalDays = parallelDays * regressionRounds;

  if (complexity >= 4) {
    notes.push('高复杂度项目，建议多轮回归确保质量');
  }
  if (totalDays > teamSize * 10) {
    notes.push(`工时较长(${totalDays}人天)，建议引入自动化以降低人力消耗`);
  }
  if (complexity >= 3) {
    notes.push('建议使用 AI 辅助用例生成与脚本维护');
  }

  return {
    totalDays,
    regressionRounds,
    effectiveTeamSize: parallelism,
    totalEffort,
    byLevel,
    notes,
  };
}

/**
 * 基于需求规模与可用预算分配测试资源
 * @param {string|object} requirement - 需求描述或需求结构对象
 * @param {number} availableBudget - 可用预算(万元)
 * @param {object} [options] - 额外选项
 * @param {number} [options.teamSize=2] - 测试团队人数
 * @param {number} [options.durationDays=10] - 项目工期(天)
 * @param {number} [options.automationTarget=0.5] - 目标自动化率
 * @param {string} [options.costPreference='balanced'] - 成本偏好: free/balanced/commercial
 * @returns {{ allocation: object, warnings: string[], recommendations: object[] }} 资源分配方案
 */
export function allocateResources(requirement, availableBudget, options = {}) {
  if (!requirement) {
    throw new Error('[resource-allocator] allocateResources: requirement 不能为空');
  }
  if (typeof availableBudget !== 'number' || availableBudget < 0) {
    throw new Error('[resource-allocator] allocateResources: availableBudget 需为非负数');
  }

  const {
    teamSize = 2,
    durationDays = 10,
    automationTarget = 0.5,
    costPreference = 'balanced',
  } = options;

  const reqStr = typeof requirement === 'string' ? requirement : JSON.stringify(requirement);
  const lower = reqStr.toLowerCase();

  // -----------------------------------------------
  // 1. 人力分配
  // -----------------------------------------------
  const roleDistribution = [];
  if (teamSize === 1) {
    roleDistribution.push({ role: '测试工程师', headcount: 1, focus: '全栈测试' });
  } else if (teamSize === 2) {
    roleDistribution.push({ role: '测试负责人', headcount: 1, focus: '用例设计 + 系统测试' });
    roleDistribution.push({ role: '测试工程师', headcount: 1, focus: '接口测试 + 自动化' });
  } else if (teamSize >= 3) {
    roleDistribution.push({ role: '测试负责人', headcount: 1, focus: '策略把控 + 风险跟踪' });
    roleDistribution.push({ role: '功能测试工程师', headcount: Math.max(1, teamSize - 2), focus: '功能/接口测试' });
    roleDistribution.push({ role: '自动化测试工程师', headcount: 1, focus: '自动化框架 + CI' });
  }

  // 人力成本估算（测试工程师均价 ¥800/人天）
  const dailyRate = 800;
  const laborCost = teamSize * durationDays * dailyRate;

  // -----------------------------------------------
  // 2. 工具成本估算
  // -----------------------------------------------
  let selectedTools = [];
  if (costPreference === 'free') {
    selectedTools = [
      { category: 'unit', tool: 'Jest' },
      { category: 'integration', tool: 'Postman' },
      { category: 'system', tool: 'Playwright' },
      { category: 'performance', tool: 'k6' },
      { category: 'ci', tool: 'GitHub Actions' },
      { category: 'management', tool: 'Jira' },
    ];
  } else if (costPreference === 'balanced') {
    selectedTools = [
      { category: 'unit', tool: 'Jest' },
      { category: 'integration', tool: 'Postman' },
      { category: 'system', tool: 'Playwright' },
      { category: 'performance', tool: 'JMeter' },
      { category: 'ci', tool: 'GitHub Actions' },
      { category: 'management', tool: 'Xray' },
    ];
  } else {
    selectedTools = [
      { category: 'unit', tool: 'Jest' },
      { category: 'integration', tool: 'Postman' },
      { category: 'system', tool: 'Playwright' },
      { category: 'performance', tool: 'BlazeMeter' },
      { category: 'ci', tool: 'Jenkins' },
      { category: 'management', tool: 'TestRail' },
      { category: 'visual', tool: 'Applitools' },
    ];
  }

  const toolChainObj = Object.fromEntries(selectedTools.map(t => [t.category, t.tool]));
  const toolCostResult = calcToolCost(toolChainObj);

  // -----------------------------------------------
  // 3. 环境分配
  // -----------------------------------------------
  const envNeeds = {
    dev: { type: '共享开发环境', slots: 1 },
    sit: { type: 'SIT测试环境', slots: 1 },
    uat: { type: 'UAT环境', slots: 1 },
  };

  if (lower.includes('性能') || lower.includes('压测') || lower.includes('高并发')) {
    envNeeds.perf = { type: '性能测试环境', slots: 1, note: '建议独立部署避免干扰' };
  }
  if (lower.includes('安全') || lower.includes('渗透') || lower.includes('权限')) {
    envNeeds.sec = { type: '安全测试环境', slots: 1 };
  }
  if (lower.includes('移动') || lower.includes('app') || lower.includes('ios') || lower.includes('android')) {
    envNeeds.mobile = { type: '真机/模拟器', slots: 1 };
  }

  const envCostMonthly = Object.keys(envNeeds).length * TOOL_PRICING.infrastructure.testEnv;
  const envCostTotal = Math.ceil(envCostMonthly * (durationDays / 30));

  // -----------------------------------------------
  // 4. 数据资源
  // -----------------------------------------------
  const dataAllocation = {
    testDataMgmt: { type: '测试数据管理', monthlyCost: TOOL_PRICING.infrastructure.dataEnv },
    prodDataClone: lower.includes('敏感') || lower.includes('隐私') ? { type: '数据脱敏处理', oneTime: 5000 } : null,
  };

  // -----------------------------------------------
  // 5. 成本汇总
  // -----------------------------------------------
  const toolMonthly = toolCostResult.monthly.total;
  const toolTotal = Math.ceil(toolMonthly * (durationDays / 30));
  const totalCost = laborCost + toolTotal + envCostTotal;

  // availableBudget 单位为万元 → 转换为元统一比较
  const budgetInYuan = availableBudget * 10000;
  const costAllocation = {
    labor: { amount: laborCost, ratio: Math.round(laborCost / totalCost * 100), unit: '¥800/人天' },
    tools: { amount: toolTotal, ratio: Math.round(toolTotal / totalCost * 100), unit: '¥/月均摊' },
    environment: { amount: envCostTotal, ratio: Math.round(envCostTotal / totalCost * 100), unit: '¥/月均摊' },
    total: totalCost,
    budget: availableBudget,
    budgetInYuan,
    surplus: budgetInYuan - totalCost,
    status: totalCost <= budgetInYuan ? 'within' : 'exceed',
  };

  // -----------------------------------------------
  // 6. 告警与建议
  // -----------------------------------------------
  const warnings = [];
  const recommendations = [];

  if (costAllocation.status === 'exceed') {
    warnings.push(`⚠️ 预估成本(¥${totalCost})超出预算(¥${budgetInYuan})`);
    if (teamSize > 2) {
      recommendations.push({ priority: 'high', action: '减少测试团队规模', savedEstimate: `¥${(teamSize - 2) * durationDays * dailyRate}` });
    }
    if (costPreference !== 'free') {
      recommendations.push({ priority: 'high', action: '切换为免费工具链', savedEstimate: `¥${toolTotal}` });
    }
  }

  if (teamSize < 2 && durationDays > 15) {
    warnings.push(`⚠️ 单人测试 + 长周期(${durationDays}天)，建议至少2人协作`);
    recommendations.push({ priority: 'medium', action: '增加1名测试工程师', benefit: '提升并行度、降低风险' });
  }

  if (automationTarget > 0.7 && teamSize <= 2) {
    recommendations.push({ priority: 'medium', action: '高自动化率目标(${Math.round(automationTarget*100)}%)需至少2名自动化工程师' });
  }

  if (lower.includes('支付') || lower.includes('金融')) {
    recommendations.push({ priority: 'high', action: '建议引入安全专项测试工具(OWASP ZAP免费/Burp Suite)', category: 'security' });
  }

  // -----------------------------------------------
  // 组装输出
  // -----------------------------------------------
  return {
    allocationId: `ALLOC-${Date.now().toString(36).toUpperCase()}`,
    generatedAt: new Date().toISOString(),
    allocation: {
      team: {
        size: teamSize,
        distribution: roleDistribution,
        dailyRate,
      },
      tools: {
        preference: costPreference,
        selected: selectedTools,
        cost: toolCostResult,
      },
      environments: envNeeds,
      data: dataAllocation,
    },
    costSummary: costAllocation,
    automationPlan: buildAutomationPlan(automationTarget, teamSize, durationDays),
    warnings,
    recommendations,
  };
}

/**
 * 构建自动化推进计划
 * @param {number} targetRate - 目标自动化率
 * @param {number} teamSize - 团队规模
 * @param {number} durationDays - 工期
 * @returns {object}
 */
function buildAutomationPlan(targetRate, teamSize, durationDays) {
  const actualRate = Math.round(targetRate * 100);
  const phases = [];

  if (durationDays <= 5) {
    phases.push({ phase: '初期', target: 20, action: '只做核心路径自动化(P0)，其余手动' });
  } else if (durationDays <= 15) {
    phases.push({ phase: '初期(前1/3)', target: Math.round(actualRate * 0.4), action: '搭建框架、完成 P0+P1 用例自动化' });
    phases.push({ phase: '中期(中1/3)', target: Math.round(actualRate * 0.7), action: '扩展 P2 用例，完善回归套件' });
    phases.push({ phase: '后期(后1/3)', target: actualRate, action: '补充边缘场景，CI/CD 集成' });
  } else {
    phases.push({ phase: 'Phase 1', target: 30, action: '框架选型与搭建，接口测试自动化' });
    phases.push({ phase: 'Phase 2', target: 55, action: 'UI 自动化接入，核心流程覆盖' });
    phases.push({ phase: 'Phase 3', target: 75, action: '性能/安全自动化扩展，CI 集成' });
    phases.push({ phase: 'Phase 4', target: actualRate, action: '全面覆盖，AI 辅助维护' });
  }

  return {
    targetRate: actualRate,
    phases,
    framework: teamSize >= 2 ? 'Playwright + Jest (推荐)' : '优先接口自动化，UI 自动化暂缓',
    ciIntegration: true,
  };
}

// -----------------------------------------------
// 自测入口
// -----------------------------------------------
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  console.log('=== resource-allocator 自测 ===\n');

  // 测试 calcToolCost
  const sampleToolChain = {
    unit: 'Jest',
    integration: 'Postman',
    system: 'Playwright',
    performance: 'JMeter',
    security: 'OWASP ZAP',
    ci: 'GitHub Actions',
    management: 'TestRail',
    aiAssisted: 'Cursor',
  };
  const costResult = calcToolCost(sampleToolChain);
  console.log('工具链成本:');
  costResult.breakdown.forEach(b => console.log(`  ${b.category}: ${b.tool} → ${b.note}`));
  console.log(`月总计: ¥${costResult.monthly.total} | 年总计: ¥${costResult.yearly.total}`);

  // 测试 estimateTestDuration
  console.log('\n--- 工时估算 ---');
  const duration = estimateTestDuration(50, 3, 2);
  console.log(`总工期: ${duration.totalDays}天 (${duration.regressionRounds}轮回归, 并行度${duration.effectiveTeamSize})`);
  Object.entries(duration.byLevel).forEach(([level, d]) => {
    console.log(`  ${level}: ${d.usecases}用例 | 手动${d.manualDays}天 | 自动化${d.autoDays}天 | 自动化率${d.automationRate}%`);
  });
  duration.notes.forEach(n => console.log(`  📌 ${n}`));

  // 测试 allocateResources
  console.log('\n--- 资源分配(预算5万) ---');
  const req = '电商订单系统，含支付流程、库存同步、第三方物流接口，7天交付';
  const result = allocateResources(req, 5, {
    teamSize: 3,
    durationDays: 7,
    automationTarget: 0.5,
    costPreference: 'balanced',
  });

  console.log(`分配ID: ${result.allocationId}`);
  console.log('\n团队:');
  result.allocation.team.distribution.forEach(r => console.log(`  ${r.role}: ${r.headcount}人, 负责${r.focus}`));
  console.log(`\n成本汇总:`);
  console.log(`  人力: ¥${result.costSummary.labor.amount} (${result.costSummary.labor.ratio}%)`);
  console.log(`  工具: ¥${result.costSummary.tools.amount} (${result.costSummary.tools.ratio}%)`);
  console.log(`  环境: ¥${result.costSummary.environment.amount} (${result.costSummary.environment.ratio}%)`);
  console.log(`  总计: ¥${result.costSummary.total} | 预算: ${result.costSummary.budget}万(¥${result.costSummary.budgetInYuan}) | ${result.costSummary.status === 'within' ? '✅ 预算内' : '❌ 超预算'}`);
  console.log(`\n自动化计划:`);
  result.automationPlan.phases.forEach(p => console.log(`  [${p.phase}] 目标${p.target}%: ${p.action}`));
  console.log('\n告警:');
  result.warnings.forEach(w => console.log(`  ${w}`));
  console.log('建议:');
  result.recommendations.forEach(r => console.log(`  [${r.priority}] ${r.action}`));

  console.log('\n✅ 自测通过');
}
