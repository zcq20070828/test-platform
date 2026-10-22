/**
 * 质量度量计算器单元测试
 * 测试代码覆盖率、需求覆盖率、缺陷密度、测试效率、综合质量评分
 */

const { 
  calculateCodeCoverage,
  calculateRequirementCoverage,
  calculateTestCaseCoverage,
  calculateDefectDensity,
  calculateTestEfficiency,
  calculateQualityScore,
  executeQualityMetrics
} = require('../backend/quality-metrics.js');

// 测试结果统计
let passed = 0;
let failed = 0;
const errors = [];

/**
 * 辅助函数：断言
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败：${message}`);
  }
}

/**
 * 测试用例1：代码覆盖率计算 - 基本功能
 */
function test1_codeCoverageBasic() {
  console.log('【测试用例1】代码覆盖率计算 - 基本功能');
  
  const coverageData = {
    lines: { covered: 850, total: 1000 },
    branches: { covered: 120, total: 150 },
    functions: { covered: 45, total: 50 },
    statements: { covered: 820, total: 980 }
  };
  
  const result = calculateCodeCoverage(coverageData);
  
  // 验证行覆盖率
  assert(result.lineCoverage === '85.00%', '行覆盖率应为85.00%');
  
  // 验证分支覆盖率
  assert(result.branchCoverage === '80.00%', '分支覆盖率应为80.00%');
  
  // 验证函数覆盖率
  assert(result.functionCoverage === '90.00%', '函数覆盖率应为90.00%');
  
  // 验证语句覆盖率
  assert(result.statementCoverage === '83.67%', '语句覆盖率应为83.67%');
  
  // 验证综合覆盖率
  assert(result.overall === '84.67%', '综合覆盖率应为84.67%');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例2：代码覆盖率计算 - 输入验证
 */
function test2_codeCoverageInputValidation() {
  console.log('【测试用例2】代码覆盖率计算 - 输入验证');
  
  // 测试无效输入
  try {
    calculateCodeCoverage(null);
    assert(false, '应抛出异常（null输入）');
  } catch (err) {
    assert(err.message.includes('必须为非空对象'), '异常消息应提及非空对象');
  }
  
  try {
    calculateCodeCoverage({});
    // 空对象可能不会抛出异常，取决于实现
  } catch (err) {
    // 忽略异常
  }
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例3：需求覆盖率计算 - 基本功能
 */
function test3_requirementCoverageBasic() {
  console.log('【测试用例3】需求覆盖率计算 - 基本功能');
  
  const requirementData = {
    requirements: [
      { id: 'REQ-001', name: '用户登录', isCovered: true },
      { id: 'REQ-002', name: '用户注册', isCovered: true },
      { id: 'REQ-003', name: '密码重置', isCovered: false }
    ]
  };
  
  const result = calculateRequirementCoverage(requirementData);
  
  // 验证总需求数
  assert(result.totalRequirements === 3, '总需求数应为3');
  
  // 验证已覆盖需求数
  assert(result.coveredRequirements === 2, '已覆盖需求数应为2');
  
  // 验证覆盖率
  assert(result.coverageRate === '66.67%', '覆盖率应为66.67%');
  
  // 验证未覆盖需求
  assert(result.uncoveredRequirements.length === 1, '未覆盖需求数应为1');
  assert(result.uncoveredRequirements[0] === 'REQ-003', '未覆盖需求应为REQ-003');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例4：缺陷密度计算 - 基本功能
 */
function test4_defectDensityBasic() {
  console.log('【测试用例4】缺陷密度计算 - 基本功能');
  
  const defectData = {
    defects: [
      { id: 'DEF-001', severity: 'critical', module: 'auth' },
      { id: 'DEF-002', severity: 'major', module: 'payment' },
      { id: 'DEF-003', severity: 'minor', module: 'auth' }
    ],
    codeLines: 10000,  // 1万行代码
    preReleaseDefects: 2,
    postReleaseDefects: 1
  };
  
  const result = calculateDefectDensity(defectData);
  
  // 验证总缺陷数
  assert(result.totalDefects === 3, '总缺陷数应为3');
  
  // 验证千行代码缺陷数
  assert(result.defectsPerKLOC === '0.30', '千行代码缺陷数应为0.30');
  
  // 验证缺陷去除率
  assert(result.defectRemovalRate === '66.67%', '缺陷去除率应为66.67%');
  
  // 验证缺陷泄漏率
  assert(result.defectLeakageRate === '33.33%', '缺陷泄漏率应为33.33%');
  
  // 验证按严重程度分布
  assert(result.defectsBySeverity.critical.count === 1, 'critical缺陷数应为1');
  assert(result.defectsBySeverity.major.count === 1, 'major缺陷数应为1');
  assert(result.defectsBySeverity.minor.count === 1, 'minor缺陷数应为1');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例5：测试效率计算 - 基本功能
 */
function test5_testEfficiencyBasic() {
  console.log('【测试用例5】测试效率计算 - 基本功能');
  
  const efficiencyData = {
    testCasesExecuted: 500,
    testExecutionHours: 80,
    defectsFound: 30,
    totalDefects: 35,
    automatedTestCases: 400,
    totalTestCases: 600
  };
  
  const result = calculateTestEfficiency(efficiencyData);
  
  // 验证每小时执行测试用例数
  assert(result.testCasesPerHour === '6.25', '每小时执行测试用例数应为6.25');
  
  // 验证每小时发现缺陷数
  assert(result.defectsFoundPerHour === '0.38', '每小时发现缺陷数应为0.38');
  
  // 验证测试执行总时间
  assert(result.testExecutionTime === '80.00h', '测试执行总时间应为80.00h');
  
  // 验证缺陷发现率
  assert(result.defectDetectionRate === '85.71%', '缺陷发现率应为85.71%');
  
  // 验证测试自动化率
  assert(result.testAutomationRate === '66.67%', '测试自动化率应为66.67%');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例6：综合质量评分 - 基本功能
 */
function test6_qualityScoreBasic() {
  console.log('【测试用例6】综合质量评分 - 基本功能');
  
  const qualityData = {
    codeCoverage: {
      lineCoverage: '85.00%'
    },
    requirementCoverage: {
      coverageRate: '80.00%'
    },
    testCaseCoverage: {
      executionRate: '95.00%',
      passRate: '88.00%'
    },
    defectDensity: {
      defectsPerKLOC: '2.50'
    },
    testEfficiency: {
      testAutomationRate: '70.00%'
    },
    codeQuality: {
      maintainabilityIndex: 75
    }
  };
  
  const result = calculateQualityScore(qualityData);
  
  // 验证综合评分
  assert(parseFloat(result.score) > 0, '综合评分应大于0');
  assert(parseFloat(result.score) <= 100, '综合评分应小于等于100');
  
  // 验证质量等级
  assert(['A+', 'A', 'B', 'C', 'D', 'F'].includes(result.grade), '质量等级应为有效值');
  
  // 验证各维度评分
  assert(result.dimensions.codeCoverage !== undefined, '应包含codeCoverage维度');
  assert(result.dimensions.requirementCoverage !== undefined, '应包含requirementCoverage维度');
  assert(result.dimensions.defectDensity !== undefined, '应包含defectDensity维度');
  
  console.log(`  ✅ 通过（评分：${result.score}分，等级：${result.grade}）`);
  passed++;
}

/**
 * 测试用例7：质量度量执行器 - 代码覆盖率
 */
async function test7_executeQualityMetricsCodeCoverage() {
  console.log('【测试用例7】质量度量执行器 - 代码覆盖率');
  
  const coverageData = {
    lines: { covered: 850, total: 1000 }
  };
  
  const result = await executeQualityMetrics({
    coverageData,
    metrics: 'codeCoverage'
  });
  
  // 验证返回结果
  assert(result.codeCoverage !== undefined, '应返回codeCoverage结果');
  assert(result.requirementCoverage === undefined, '不应返回requirementCoverage结果');
  
  // 验证代码覆盖率结果
  assert(result.codeCoverage.lineCoverage === '85.00%', '行覆盖率应为85.00%');
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 测试用例8：质量度量执行器 - 输入验证
 */
async function test8_executeQualityMetricsInputValidation() {
  console.log('【测试用例8】质量度量执行器 - 输入验证');
  
  // 测试无效metrics
  try {
    await executeQualityMetrics({
      coverageData: {},
      metrics: 'invalid'
    });
    assert(false, '应抛出异常（无效metrics）');
  } catch (err) {
    assert(err.message.includes('无效metrics'), '异常消息应提及无效metrics');
  }
  
  // 测试缺少coverageData
  try {
    await executeQualityMetrics({
      metrics: 'codeCoverage'
    });
    assert(false, '应抛出异常（缺少coverageData）');
  } catch (err) {
    assert(err.message.includes('必填'), '异常消息应提及必填');
  }
  
  console.log('  ✅ 通过');
  passed++;
}

/**
 * 主测试函数
 */
async function runAllTests() {
  console.log('=== 质量度量计算器单元测试 ===\n');
  
  // 同步测试
  test1_codeCoverageBasic();
  test2_codeCoverageInputValidation();
  test3_requirementCoverageBasic();
  test4_defectDensityBasic();
  test5_testEfficiencyBasic();
  test6_qualityScoreBasic();
  
  // 异步测试
  await test7_executeQualityMetricsCodeCoverage();
  await test8_executeQualityMetricsInputValidation();
  
  // 输出结果
  console.log('\n=== 测试结果 ===');
  console.log(`通过：${passed}`);
  console.log(`失败：${failed}`);
  
  if (errors.length > 0) {
    console.log('\n错误详情：');
    errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err}`);
    });
  }
  
  const success = failed === 0;
  console.log(`\n状态：${success ? '✅ 全部通过' : '❌ 存在失败'}`);
  
  return success;
}

// 运行测试
runAllTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('测试运行失败：', err);
  process.exit(1);
});
