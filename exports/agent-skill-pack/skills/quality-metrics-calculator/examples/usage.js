/**
 * 质量度量计算器使用示例
 * 演示各种质量指标计算
 */

const { executeQualityMetrics } = require('../backend/quality-metrics.js');

/**
 * 示例1：计算代码覆盖率
 */
async function example1_codeCoverage() {
  console.log('=== 示例1：计算代码覆盖率 ===\n');
  
  // 覆盖率数据
  const coverageData = {
    lines: { covered: 850, total: 1000 },
    branches: { covered: 120, total: 150 },
    functions: { covered: 45, total: 50 },
    statements: { covered: 820, total: 980 }
  };
  
  console.log('输入：覆盖率数据');
  console.log(`  - 行覆盖率：${coverageData.lines.covered}/${coverageData.lines.total}`);
  console.log(`  - 分支覆盖率：${coverageData.branches.covered}/${coverageData.branches.total}`);
  console.log(`  - 函数覆盖率：${coverageData.functions.covered}/${coverageData.functions.total}`);
  console.log(`  - 语句覆盖率：${coverageData.statements.covered}/${coverageData.statements.total}`);
  
  // 执行代码覆盖率计算
  const result = await executeQualityMetrics({
    coverageData,
    metrics: 'codeCoverage'
  });
  
  console.log('\n输出：代码覆盖率指标');
  console.log(`  - 行覆盖率：${result.codeCoverage.lineCoverage}`);
  console.log(`  - 分支覆盖率：${result.codeCoverage.branchCoverage}`);
  console.log(`  - 函数覆盖率：${result.codeCoverage.functionCoverage}`);
  console.log(`  - 语句覆盖率：${result.codeCoverage.statementCoverage}`);
  console.log(`  - 综合覆盖率：${result.codeCoverage.overall}`);
}

/**
 * 示例2：计算需求覆盖率
 */
async function example2_requirementCoverage() {
  console.log('\n\n=== 示例2：计算需求覆盖率 ===\n');
  
  // 需求覆盖数据
  const requirementData = {
    requirements: [
      { id: 'REQ-001', name: '用户登录', isCovered: true, testCases: ['TC-001', 'TC-002'], coverageSource: 'test_case' },
      { id: 'REQ-002', name: '用户注册', isCovered: true, testCases: ['TC-003'], coverageSource: 'test_case' },
      { id: 'REQ-003', name: '密码重置', isCovered: false, testCases: [], coverageSource: 'none' },
      { id: 'REQ-004', name: '个人信息修改', isCovered: true, testCases: ['TC-004', 'TC-005'], coverageSource: 'test_case' },
      { id: 'REQ-005', name: '订单管理', isCovered: false, testCases: [], coverageSource: 'none' }
    ]
  };
  
  console.log('输入：需求覆盖数据');
  console.log(`  - 总需求数：${requirementData.requirements.length}`);
  console.log(`  - 已覆盖需求：${requirementData.requirements.filter(r => r.isCovered).length}`);
  console.log(`  - 未覆盖需求：${requirementData.requirements.filter(r => !r.isCovered).map(r => r.id).join(', ')}`);
  
  // 执行需求覆盖率计算
  const result = await executeQualityMetrics({
    requirementData,
    metrics: 'requirementCoverage'
  });
  
  console.log('\n输出：需求覆盖率指标');
  console.log(`  - 总需求数：${result.requirementCoverage.totalRequirements}`);
  console.log(`  - 已覆盖需求数：${result.requirementCoverage.coveredRequirements}`);
  console.log(`  - 覆盖率：${result.requirementCoverage.coverageRate}`);
  console.log(`  - 未覆盖需求：${result.requirementCoverage.uncoveredRequirements.join(', ')}`);
}

/**
 * 示例3：计算缺陷密度
 */
async function example3_defectDensity() {
  console.log('\n\n=== 示例3：计算缺陷密度 ===\n');
  
  // 缺陷数据
  const defectData = {
    defects: [
      { id: 'DEF-001', severity: 'critical', module: 'auth' },
      { id: 'DEF-002', severity: 'major', module: 'payment' },
      { id: 'DEF-003', severity: 'minor', module: 'auth' },
      { id: 'DEF-004', severity: 'critical', module: 'order' },
      { id: 'DEF-005', severity: 'major', module: 'payment' }
    ],
    codeLines: 50000,  // 5万行代码
    preReleaseDefects: 4,
    postReleaseDefects: 1
  };
  
  console.log('输入：缺陷数据');
  console.log(`  - 总缺陷数：${defectData.defects.length}`);
  console.log(`  - 代码行数：${defectData.codeLines}`);
  console.log(`  - 发布前发现：${defectData.preReleaseDefects}`);
  console.log(`  - 发布后发现：${defectData.postReleaseDefects}`);
  
  // 执行缺陷密度计算
  const result = await executeQualityMetrics({
    defectData,
    metrics: 'defectDensity'
  });
  
  console.log('\n输出：缺陷密度指标');
  console.log(`  - 总缺陷数：${result.defectDensity.totalDefects}`);
  console.log(`  - 千行代码缺陷数：${result.defectDensity.defectsPerKLOC}`);
  console.log(`  - 缺陷去除率：${result.defectDensity.defectRemovalRate}`);
  console.log(`  - 缺陷泄漏率：${result.defectDensity.defectLeakageRate}`);
  console.log(`  - 按严重程度分布：`);
  Object.keys(result.defectDensity.defectsBySeverity).forEach(severity => {
    const data = result.defectDensity.defectsBySeverity[severity];
    console.log(`    - ${severity}: ${data.count}个（${data.percentage}）`);
  });
}

/**
 * 示例4：计算测试效率
 */
async function example4_testEfficiency() {
  console.log('\n\n=== 示例4：计算测试效率 ===\n');
  
  // 测试效率数据
  const efficiencyData = {
    testCasesExecuted: 850,
    testExecutionHours: 120,
    defectsFound: 45,
    totalDefects: 50,
    automatedTestCases: 600,
    totalTestCases: 1000
  };
  
  console.log('输入：测试效率数据');
  console.log(`  - 已执行测试用例：${efficiencyData.testCasesExecuted}`);
  console.log(`  - 测试执行时间：${efficiencyData.testExecutionHours}h`);
  console.log(`  - 发现缺陷数：${efficiencyData.defectsFound}`);
  console.log(`  - 自动化测试用例：${efficiencyData.automatedTestCases}/${efficiencyData.totalTestCases}`);
  
  // 执行测试效率计算
  const result = await executeQualityMetrics({
    efficiencyData,
    metrics: 'testEfficiency'
  });
  
  console.log('\n输出：测试效率指标');
  console.log(`  - 每小时执行测试用例数：${result.testEfficiency.testCasesPerHour}`);
  console.log(`  - 每小时发现缺陷数：${result.testEfficiency.defectsFoundPerHour}`);
  console.log(`  - 测试执行总时间：${result.testEfficiency.testExecutionTime}`);
  console.log(`  - 缺陷发现率：${result.testEfficiency.defectDetectionRate}`);
  console.log(`  - 测试自动化率：${result.testEfficiency.testAutomationRate}`);
}

/**
 * 示例5：计算综合质量评分
 */
async function example5_qualityScore() {
  console.log('\n\n=== 示例5：计算综合质量评分 ===\n');
  
  // 质量数据
  const qualityData = {
    codeCoverage: {
      lineCoverage: '85.00%',
      branchCoverage: '80.00%',
      functionCoverage: '90.00%'
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
  
  console.log('输入：质量数据');
  console.log(`  - 代码覆盖率：${qualityData.codeCoverage.lineCoverage}`);
  console.log(`  - 需求覆盖率：${qualityData.requirementCoverage.coverageRate}`);
  console.log(`  - 测试用例通过率：${qualityData.testCaseCoverage.passRate}`);
  console.log(`  - 千行代码缺陷数：${qualityData.defectDensity.defectsPerKLOC}`);
  console.log(`  - 测试自动化率：${qualityData.testEfficiency.testAutomationRate}`);
  
  // 执行综合质量评分计算
  const result = await executeQualityMetrics({
    qualityData,
    metrics: 'qualityScore'
  });
  
  console.log('\n输出：综合质量评分');
  console.log(`  - 综合评分：${result.qualityScore.score}分`);
  console.log(`  - 质量等级：${result.qualityScore.grade}`);
  console.log(`  - 各维度评分：`);
  Object.keys(result.qualityScore.dimensions).forEach(dimName => {
    const dim = result.qualityScore.dimensions[dimName];
    console.log(`    - ${dimName}: ${dim.score}分（权重${dim.weight}，加权${dim.weightedScore}）`);
  });
  
  if (result.qualityScore.recommendations.length > 0) {
    console.log(`  - 改进建议：`);
    result.qualityScore.recommendations.forEach((rec, idx) => {
      console.log(`    ${idx + 1}. ${rec.dimension}维度：${rec.issue}，${rec.suggestion}`);
    });
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    await example1_codeCoverage();
    await example2_requirementCoverage();
    await example3_defectDensity();
    await example4_testEfficiency();
    await example5_qualityScore();
    
    console.log('\n\n=== 示例运行完成 ===');
    console.log('✅ 代码覆盖率计算功能正常');
    console.log('✅ 需求覆盖率计算功能正常');
    console.log('✅ 缺陷密度计算功能正常');
    console.log('✅ 测试效率计算功能正常');
    console.log('✅ 综合质量评分功能正常');
  } catch (err) {
    console.error('❌ 示例运行失败：', err.message);
    process.exit(1);
  }
}

main();
