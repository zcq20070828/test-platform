/**
 * 质量度量计算器
 * 计算测试覆盖率、缺陷密度、测试效率等质量指标
 * Quality Metrics Calculator
 */

/**
 * 计算代码覆盖率
 * @param {Object} coverageData - 覆盖率数据
 * @returns {Object} 代码覆盖率指标
 */
function calculateCodeCoverage(coverageData) {
  const result = {
    lineCoverage: 0,      // 行覆盖率
    branchCoverage: 0,     // 分支覆盖率
    functionCoverage: 0,    // 函数覆盖率
    statementCoverage: 0,   // 语句覆盖率
    overall: '0.00%'       // 综合覆盖率
  };
  
  // 验证输入
  if (!coverageData || typeof coverageData !== 'object') {
    throw new Error('coverageData必须为非空对象');
  }
  
  // 计算行覆盖率
  if (coverageData.lines && coverageData.lines.total > 0) {
    result.lineCoverage = (coverageData.lines.covered / coverageData.lines.total * 100).toFixed(2) + '%';
  }
  
  // 计算分支覆盖率
  if (coverageData.branches && coverageData.branches.total > 0) {
    result.branchCoverage = (coverageData.branches.covered / coverageData.branches.total * 100).toFixed(2) + '%';
  }
  
  // 计算函数覆盖率
  if (coverageData.functions && coverageData.functions.total > 0) {
    result.functionCoverage = (coverageData.functions.covered / coverageData.functions.total * 100).toFixed(2) + '%';
  }
  
  // 计算语句覆盖率
  if (coverageData.statements && coverageData.statements.total > 0) {
    result.statementCoverage = (coverageData.statements.covered / coverageData.statements.total * 100).toFixed(2) + '%';
  }
  
  // 计算综合覆盖率（平均）
  const coverages = [];
  if (coverageData.lines) coverages.push(coverageData.lines.covered / coverageData.lines.total);
  if (coverageData.branches) coverages.push(coverageData.branches.covered / coverageData.branches.total);
  if (coverageData.functions) coverages.push(coverageData.functions.covered / coverageData.functions.total);
  if (coverageData.statements) coverages.push(coverageData.statements.covered / coverageData.statements.total);
  
  if (coverages.length > 0) {
    const avg = coverages.reduce((sum, val) => sum + val, 0) / coverages.length;
    result.overall = (avg * 100).toFixed(2) + '%';
  }
  
  return result;
}

/**
 * 计算需求覆盖率
 * @param {Object} requirementData - 需求覆盖数据
 * @returns {Object} 需求覆盖率指标
 */
function calculateRequirementCoverage(requirementData) {
  const result = {
    totalRequirements: 0,     // 总需求数
    coveredRequirements: 0,     // 已覆盖需求数
    coverageRate: '0.00%',     // 覆盖率
    uncoveredRequirements: [],    // 未覆盖需求列表
    details: []                  // 详细覆盖情况
  };
  
  // 验证输入
  if (!requirementData || typeof requirementData !== 'object') {
    throw new Error('requirementData必须为非空对象');
  }
  
  // 计算需求覆盖率
  if (requirementData.requirements && Array.isArray(requirementData.requirements)) {
    result.totalRequirements = requirementData.requirements.length;
    result.coveredRequirements = requirementData.requirements.filter(req => 
      req.isCovered === true
    ).length;
    
    // 计算覆盖率
    if (result.totalRequirements > 0) {
      result.coverageRate = (result.coveredRequirements / result.totalRequirements * 100).toFixed(2) + '%';
    }
    
    // 记录未覆盖需求
    result.uncoveredRequirements = requirementData.requirements
      .filter(req => !req.isCovered)
      .map(req => req.id || req.name);
    
    // 记录详细覆盖情况
    result.details = requirementData.requirements.map(req => ({
      id: req.id || req.name,
      name: req.name || req.id,
      isCovered: req.isCovered || false,
      testCases: req.testCases || [],
      coverageSource: req.coverageSource || 'unknown'
    }));
  }
  
  return result;
}

/**
 * 计算测试用例覆盖率
 * @param {Object} testCaseData - 测试用例数据
 * @returns {Object} 测试用例覆盖率指标
 */
function calculateTestCaseCoverage(testCaseData) {
  const result = {
    totalTestCases: 0,          // 总测试用例数
    executedTestCases: 0,        // 已执行测试用例数
    passedTestCases: 0,          // 通过测试用例数
    failedTestCases: 0,          // 失败测试用例数
    executionRate: '0.00%',      // 执行率
    passRate: '0.00%',           // 通过率
    coverageByPriority: {},        // 按优先级覆盖率
    coverageByModule: {}          // 按模块覆盖率
  };
  
  // 验证输入
  if (!testCaseData || typeof testCaseData !== 'object') {
    throw new Error('testCaseData必须为非空对象');
  }
  
  // 计算测试用例覆盖率
  if (testCaseData.testCases && Array.isArray(testCaseData.testCases)) {
    result.totalTestCases = testCaseData.testCases.length;
    result.executedTestCases = testCaseData.testCases.filter(tc => 
      tc.status !== 'not_executed'
    ).length;
    result.passedTestCases = testCaseData.testCases.filter(tc => 
      tc.status === 'passed'
    ).length;
    result.failedTestCases = testCaseData.testCases.filter(tc => 
      tc.status === 'failed'
    ).length;
    
    // 计算执行率
    if (result.totalTestCases > 0) {
      result.executionRate = (result.executedTestCases / result.totalTestCases * 100).toFixed(2) + '%';
    }
    
    // 计算通过率
    if (result.executedTestCases > 0) {
      result.passRate = (result.passedTestCases / result.executedTestCases * 100).toFixed(2) + '%';
    }
    
    // 按优先级统计覆盖率
    const priorityGroups = {};
    testCaseData.testCases.forEach(tc => {
      const priority = tc.priority || 'unknown';
      if (!priorityGroups[priority]) {
        priorityGroups[priority] = { total: 0, executed: 0, passed: 0 };
      }
      priorityGroups[priority].total++;
      if (tc.status !== 'not_executed') {
        priorityGroups[priority].executed++;
      }
      if (tc.status === 'passed') {
        priorityGroups[priority].passed++;
      }
    });
    
    Object.keys(priorityGroups).forEach(priority => {
      const group = priorityGroups[priority];
      result.coverageByPriority[priority] = {
        total: group.total,
        executed: group.executed,
        passed: group.passed,
        executionRate: group.total > 0 ? (group.executed / group.total * 100).toFixed(2) + '%' : '0.00%',
        passRate: group.executed > 0 ? (group.passed / group.executed * 100).toFixed(2) + '%' : '0.00%'
      };
    });
    
    // 按模块统计覆盖率
    const moduleGroups = {};
    testCaseData.testCases.forEach(tc => {
      const module = tc.module || 'unknown';
      if (!moduleGroups[module]) {
        moduleGroups[module] = { total: 0, executed: 0, passed: 0 };
      }
      moduleGroups[module].total++;
      if (tc.status !== 'not_executed') {
        moduleGroups[module].executed++;
      }
      if (tc.status === 'passed') {
        moduleGroups[module].passed++;
      }
    });
    
    Object.keys(moduleGroups).forEach(module => {
      const group = moduleGroups[module];
      result.coverageByModule[module] = {
        total: group.total,
        executed: group.executed,
        passed: group.passed,
        executionRate: group.total > 0 ? (group.executed / group.total * 100).toFixed(2) + '%' : '0.00%',
        passRate: group.executed > 0 ? (group.passed / group.executed * 100).toFixed(2) + '%' : '0.00%'
      };
    });
  }
  
  return result;
}

/**
 * 计算缺陷密度
 * @param {Object} defectData - 缺陷数据
 * @returns {Object} 缺陷密度指标
 */
function calculateDefectDensity(defectData) {
  const result = {
    totalDefects: 0,           // 总缺陷数
    defectsPerKLOC: '0.00',    // 千行代码缺陷数
    defectsBySeverity: {},       // 按严重程度分布
    defectsByModule: {},          // 按模块分布
    defectRemovalRate: '0.00%', // 缺陷去除率
    defectLeakageRate: '0.00%'  // 缺陷泄漏率
  };
  
  // 验证输入
  if (!defectData || typeof defectData !== 'object') {
    throw new Error('defectData必须为非空对象');
  }
  
  // 计算总缺陷数
  if (defectData.defects && Array.isArray(defectData.defects)) {
    result.totalDefects = defectData.defects.length;
  }
  
  // 计算千行代码缺陷数
  if (defectData.codeLines && defectData.codeLines > 0) {
    result.defectsPerKLOC = (result.totalDefects / (defectData.codeLines / 1000)).toFixed(2);
  }
  
  // 按严重程度统计
  if (defectData.defects && Array.isArray(defectData.defects)) {
    const severityGroups = {};
    defectData.defects.forEach(defect => {
      const severity = defect.severity || 'unknown';
      if (!severityGroups[severity]) {
        severityGroups[severity] = 0;
      }
      severityGroups[severity]++;
    });
    
    Object.keys(severityGroups).forEach(severity => {
      result.defectsBySeverity[severity] = {
        count: severityGroups[severity],
        percentage: (severityGroups[severity] / result.totalDefects * 100).toFixed(2) + '%'
      };
    });
  }
  
  // 按模块统计
  if (defectData.defects && Array.isArray(defectData.defects)) {
    const moduleGroups = {};
    defectData.defects.forEach(defect => {
      const module = defect.module || 'unknown';
      if (!moduleGroups[module]) {
        moduleGroups[module] = 0;
      }
      moduleGroups[module]++;
    });
    
    Object.keys(moduleGroups).forEach(module => {
      result.defectsByModule[module] = {
        count: moduleGroups[module],
        percentage: (moduleGroups[module] / result.totalDefects * 100).toFixed(2) + '%'
      };
    });
  }
  
  // 计算缺陷去除率
  if (defectData.preReleaseDefects && defectData.postReleaseDefects) {
    const totalFound = defectData.preReleaseDefects + defectData.postReleaseDefects;
    if (totalFound > 0) {
      result.defectRemovalRate = (defectData.preReleaseDefects / totalFound * 100).toFixed(2) + '%';
      result.defectLeakageRate = (defectData.postReleaseDefects / totalFound * 100).toFixed(2) + '%';
    }
  }
  
  return result;
}

/**
 * 计算测试效率指标
 * @param {Object} efficiencyData - 测试效率数据
 * @returns {Object} 测试效率指标
 */
function calculateTestEfficiency(efficiencyData) {
  const result = {
    testCasesPerHour: '0.00',     // 每小时执行测试用例数
    defectsFoundPerHour: '0.00',   // 每小时发现缺陷数
    testExecutionTime: '0.00h',    // 测试执行总时间
    defectDetectionRate: '0.00%',  // 缺陷发现率
    testAutomationRate: '0.00%'   // 测试自动化率
  };
  
  // 验证输入
  if (!efficiencyData || typeof efficiencyData !== 'object') {
    throw new Error('efficiencyData必须为非空对象');
  }
  
  // 计算每小时执行测试用例数
  if (efficiencyData.testCasesExecuted && efficiencyData.testExecutionHours) {
    result.testCasesPerHour = (efficiencyData.testCasesExecuted / efficiencyData.testExecutionHours).toFixed(2);
  }
  
  // 计算每小时发现缺陷数
  if (efficiencyData.defectsFound && efficiencyData.testExecutionHours) {
    result.defectsFoundPerHour = (efficiencyData.defectsFound / efficiencyData.testExecutionHours).toFixed(2);
  }
  
  // 测试执行总时间
  if (efficiencyData.testExecutionHours) {
    result.testExecutionTime = efficiencyData.testExecutionHours.toFixed(2) + 'h';
  }
  
  // 计算缺陷发现率
  if (efficiencyData.defectsFound && efficiencyData.totalDefects) {
    result.defectDetectionRate = (efficiencyData.defectsFound / efficiencyData.totalDefects * 100).toFixed(2) + '%';
  }
  
  // 计算测试自动化率
  if (efficiencyData.automatedTestCases && efficiencyData.totalTestCases) {
    result.testAutomationRate = (efficiencyData.automatedTestCases / efficiencyData.totalTestCases * 100).toFixed(2) + '%';
  }
  
  return result;
}

/**
 * 计算综合质量评分
 * @param {Object} qualityData - 质量数据
 * @returns {Object} 综合质量评分
 */
function calculateQualityScore(qualityData) {
  const result = {
    score: 0,                    // 综合评分（0-100）
    grade: 'F',                   // 质量等级（A+/A/B/C/D/F）
    dimensions: {},                // 各维度评分
    recommendations: []            // 改进建议
  };
  
  // 验证输入
  if (!qualityData || typeof qualityData !== 'object') {
    throw new Error('qualityData必须为非空对象');
  }
  
  // 定义评分维度（可配置权重）
  const dimensions = qualityData.dimensions || [
    { name: 'codeCoverage', weight: 0.25 },
    { name: 'requirementCoverage', weight: 0.20 },
    { name: 'testCaseExecution', weight: 0.15 },
    { name: 'defectDensity', weight: 0.20 },
    { name: 'testEfficiency', weight: 0.10 },
    { name: 'codeQuality', weight: 0.10 }
  ];
  
  // 计算各维度评分
  let totalScore = 0;
  let totalWeight = 0;
  
  dimensions.forEach(dim => {
    let dimScore = 0;
    
    // 根据维度名称计算评分
    switch (dim.name) {
      case 'codeCoverage':
        // 代码覆盖率评分（基于行覆盖率）
        if (qualityData.codeCoverage) {
          const lineCov = parseFloat(qualityData.codeCoverage.lineCoverage) || 0;
          dimScore = Math.min(lineCov, 100);  // 最高100分
        }
        break;
        
      case 'requirementCoverage':
        // 需求覆盖率评分
        if (qualityData.requirementCoverage) {
          const reqCov = parseFloat(qualityData.requirementCoverage.coverageRate) || 0;
          dimScore = Math.min(reqCov, 100);
        }
        break;
        
      case 'testCaseExecution':
        // 测试用例执行率评分
        if (qualityData.testCaseCoverage) {
          const execRate = parseFloat(qualityData.testCaseCoverage.executionRate) || 0;
          const passRate = parseFloat(qualityData.testCaseCoverage.passRate) || 0;
          dimScore = (execRate * 0.4 + passRate * 0.6);  // 通过率权重更高
        }
        break;
        
      case 'defectDensity':
        // 缺陷密度评分（越低越好）
        if (qualityData.defectDensity) {
          const density = parseFloat(qualityData.defectDensity.defectsPerKLOC) || 0;
          // 假设：缺陷密度<1为满分，1-5为及格，>10为0分
          if (density < 1) dimScore = 100;
          else if (density < 5) dimScore = 80;
          else if (density < 10) dimScore = 60;
          else dimScore = 30;
        }
        break;
        
      case 'testEfficiency':
        // 测试效率评分
        if (qualityData.testEfficiency) {
          const automationRate = parseFloat(qualityData.testEfficiency.testAutomationRate) || 0;
          dimScore = automationRate;  // 自动化率作为效率指标
        }
        break;
        
      case 'codeQuality':
        // 代码质量评分（基于静态分析）
        if (qualityData.codeQuality) {
          const maintainability = qualityData.codeQuality.maintainabilityIndex || 0;
          dimScore = Math.min(maintainability, 100);
        }
        break;
    }
    
    result.dimensions[dim.name] = {
      score: dimScore.toFixed(2),
      weight: dim.weight,
      weightedScore: (dimScore * dim.weight).toFixed(2)
    };
    
    totalScore += dimScore * dim.weight;
    totalWeight += dim.weight;
  });
  
  // 计算综合评分
  result.score = totalWeight > 0 ? (totalScore / totalWeight).toFixed(2) : 0;
  
  // 确定质量等级
  const score = parseFloat(result.score);
  if (score >= 90) result.grade = 'A+';
  else if (score >= 85) result.grade = 'A';
  else if (score >= 75) result.grade = 'B';
  else if (score >= 60) result.grade = 'C';
  else if (score >= 40) result.grade = 'D';
  else result.grade = 'F';
  
  // 生成改进建议
  Object.keys(result.dimensions).forEach(dimName => {
    const dim = result.dimensions[dimName];
    const dimScore = parseFloat(dim.score);
    
    if (dimScore < 60) {
      result.recommendations.push({
        dimension: dimName,
        issue: `评分过低（${dim.score}分）`,
        suggestion: `建议优先改进${dimName}维度`
      });
    } else if (dimScore < 80) {
      result.recommendations.push({
        dimension: dimName,
        issue: `评分一般（${dim.score}分）`,
        suggestion: `建议优化${dimName}维度`
      });
    }
  });
  
  return result;
}

/**
 * 执行质量度量分析
 * @param {Object} options - 分析选项
 * @returns {Object} 质量度量分析结果
 */
async function executeQualityMetrics(options) {
  const { 
    coverageData, 
    requirementData, 
    testCaseData, 
    defectData, 
    efficiencyData,
    qualityData,
    metrics = 'all' 
  } = options;
  
  const result = {};
  
  // 验证输入
  const validMetrics = ['all', 'codeCoverage', 'requirementCoverage', 'testCaseCoverage', 'defectDensity', 'testEfficiency', 'qualityScore'];
  if (!validMetrics.includes(metrics)) {
    throw new Error(`无效metrics：${metrics}。有效值：${validMetrics.join(', ')}`);
  }
  
  // 代码覆盖率
  if (metrics === 'all' || metrics === 'codeCoverage') {
    if (!coverageData) {
      throw new Error('metrics=codeCoverage时，coverageData参数必填');
    }
    result.codeCoverage = calculateCodeCoverage(coverageData);
  }
  
  // 需求覆盖率
  if (metrics === 'all' || metrics === 'requirementCoverage') {
    if (!requirementData) {
      throw new Error('metrics=requirementCoverage时，requirementData参数必填');
    }
    result.requirementCoverage = calculateRequirementCoverage(requirementData);
  }
  
  // 测试用例覆盖率
  if (metrics === 'all' || metrics === 'testCaseCoverage') {
    if (!testCaseData) {
      throw new Error('metrics=testCaseCoverage时，testCaseData参数必填');
    }
    result.testCaseCoverage = calculateTestCaseCoverage(testCaseData);
  }
  
  // 缺陷密度
  if (metrics === 'all' || metrics === 'defectDensity') {
    if (!defectData) {
      throw new Error('metrics=defectDensity时，defectData参数必填');
    }
    result.defectDensity = calculateDefectDensity(defectData);
  }
  
  // 测试效率
  if (metrics === 'all' || metrics === 'testEfficiency') {
    if (!efficiencyData) {
      throw new Error('metrics=testEfficiency时，efficiencyData参数必填');
    }
    result.testEfficiency = calculateTestEfficiency(efficiencyData);
  }
  
  // 综合质量评分
  if (metrics === 'all' || metrics === 'qualityScore') {
    if (!qualityData) {
      throw new Error('metrics=qualityScore时，qualityData参数必填');
    }
    result.qualityScore = calculateQualityScore(qualityData);
  }
  
  return result;
}

module.exports = {
  calculateCodeCoverage,
  calculateRequirementCoverage,
  calculateTestCaseCoverage,
  calculateDefectDensity,
  calculateTestEfficiency,
  calculateQualityScore,
  executeQualityMetrics
};
