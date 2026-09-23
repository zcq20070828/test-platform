/**
 * 环境维度（Environment Dimension）
 * 正交设计、资源约束分析、环境组合优化
 * Environment Dimension for 9DEM (Nine-Dimensional Exhaustive Method)
 */

/**
 * 正交设计（Orthogonal Array Design）
 * @param {Object} spec - 正交设计规格
 * @returns {Object} 正交设计结果
 */
function orthogonalArrayDesign(spec) {
  const { factors, levels, interactions = [] } = spec;
  
  // 验证输入
  if (!Array.isArray(factors) || factors.length === 0) {
    throw new Error('factors必须为非空数组');
  }
  
  if (!Array.isArray(levels) || levels.length !== factors.length) {
    throw new Error('levels必须为与factors长度相同的数组');
  }
  
  // 计算总自由度
  const totalDegreesOfFreedom = factors.reduce((sum, _, idx) => {
    return sum + (levels[idx] - 1);
  }, 1);
  
  // 选择正交表
  const orthogonalArray = selectOrthogonalArray(factors.length, levels, totalDegreesOfFreedom);
  
  // 映射因素和水平到正交表
  const testCases = mapFactorsToOrthogonalArray(orthogonalArray, factors, levels);
  
  return {
    method: 'orthogonal_array_design',
    factors: factors,
    levels: levels,
    totalDegreesOfFreedom,
    orthogonalArrayType: orthogonalArray.type,
    totalRuns: orthogonalArray.runs,
    testCases: testCases,
    summary: `正交设计：${factors.length}个因素，总试验次数${orthogonalArray.runs}次（全组合需${calculateFullCombinations(levels)}次）`
  };
}

/**
 * 选择正交表
 * @param {number} numFactors - 因素数量
 * @param {Array} levels - 各因素的水平数
 * @param {number} dof - 总自由度
 * @returns {Object} 正交表
 */
function selectOrthogonalArray(numFactors, levels, dof) {
  // 标准正交表库
  const standardArrays = {
    'L4': { runs: 4, factors: 3, levels: 2, array: [[1,1,1],[1,2,2],[2,1,2],[2,2,1]] },
    'L8': { runs: 8, factors: 7, levels: 2, array: [[1,1,1,1,1,1,1],[1,1,1,2,2,2,2],[1,2,2,1,1,2,2],[1,2,2,2,2,1,1],[2,1,2,1,2,1,2],[2,1,2,2,1,2,1],[2,2,1,1,2,2,1],[2,2,1,2,1,1,2]] },
    'L9': { runs: 9, factors: 4, levels: 3, array: [[1,1,1,1],[1,2,2,2],[1,3,3,3],[2,1,2,3],[2,2,3,1],[2,3,1,2],[3,1,3,2],[3,2,1,3],[3,3,2,1]] },
    'L12': { runs: 12, factors: 11, levels: 2, array: generateL12() },
    'L16': { runs: 16, factors: 15, levels: 2, array: generateL16() },
    'L18': { runs: 18, factors: 8, levels: [1,1,1,1,1,1,1,3], array: generateL18() },
    'L25': { runs: 25, factors: 6, levels: 5, array: generateL25() }
  };
  
  // 选择合适的正交表
  if (numFactors <= 3 && levels.every(l => l === 2)) {
    return { type: 'L4', ...standardArrays['L4'] };
  } else if (numFactors <= 7 && levels.every(l => l === 2)) {
    return { type: 'L8', ...standardArrays['L8'] };
  } else if (numFactors <= 4 && levels.every(l => l === 3)) {
    return { type: 'L9', ...standardArrays['L9'] };
  } else if (numFactors <= 11 && levels.every(l => l === 2)) {
    return { type: 'L12', ...standardArrays['L12'] };
  } else if (numFactors <= 15 && levels.every(l => l === 2)) {
    return { type: 'L16', ...standardArrays['L16'] };
  } else if (numFactors <= 8 && levels.filter(l => l === 3).length >= 1) {
    return { type: 'L18', ...standardArrays['L18'] };
  } else if (numFactors <= 6 && levels.every(l => l === 5)) {
    return { type: 'L25', ...standardArrays['L25'] };
  }
  
  // 如果没有合适的标准正交表，使用混合水平正交表
  return generateMixedLevelArray(numFactors, levels, dof);
}

/**
 * 映射因素和水平到正交表
 * @param {Object} oa - 正交表
 * @param {Array} factors - 因素数组
 * @param {Array} levels - 水平数组
 * @returns {Array} 测试用例数组
 */
function mapFactorsToOrthogonalArray(oa, factors, levels) {
  const testCases = [];
  
  for (let runIdx = 0; runIdx < oa.runs; runIdx++) {
    const testCase = {
      id: `TC-OA-${runIdx + 1}`,
      name: `正交试验${runIdx + 1}`,
      factors: {},
      levelCombination: []
    };
    
    for (let factorIdx = 0; factorIdx < factors.length; factorIdx++) {
      const levelValue = oa.array[runIdx][factorIdx];
      const levelIdx = Math.min(levelValue - 1, levels[factorIdx] - 1);
      
      testCase.factors[factors[factorIdx]] = `水平${levelValue}`;
      testCase.levelCombination.push({
        factor: factors[factorIdx],
        level: levelValue,
        levelIndex: levelIdx
      });
    }
    
    testCases.push(testCase);
  }
  
  return testCases;
}

/**
 * 计算全组合数量
 * @param {Array} levels - 水平数组
 * @returns {number} 全组合数量
 */
function calculateFullCombinations(levels) {
  return levels.reduce((product, level) => product * level, 1);
}

/**
 * 资源约束分析（Resource Constraint Analysis）
 * @param {Object} spec - 资源约束规格
 * @returns {Object} 资源约束分析结果
 */
function resourceConstraintAnalysis(spec) {
  const { resources, constraints, requirements } = spec;
  
  // 验证输入
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('resources必须为非空数组');
  }
  
  // 识别资源依赖关系
  const dependencies = identifyResourceDependencies(resources, constraints);
  
  // 分析资源可用性
  const availability = analyzeResourceAvailability(resources, constraints);
  
  // 检测资源冲突
  const conflicts = detectResourceConflicts(resources, constraints, requirements);
  
  // 生成资源约束测试用例
  const testCases = generateResourceConstraintTestCases(resources, constraints, conflicts);
  
  return {
    method: 'resource_constraint_analysis',
    resources: resources,
    dependencies: dependencies,
    availability: availability,
    conflicts: conflicts,
    testCases: testCases,
    summary: `资源约束分析：${resources.length}个资源，${conflicts.length}个冲突，生成${testCases.length}个测试用例`
  };
}

/**
 * 识别资源依赖关系
 * @param {Array} resources - 资源数组
 * @param {Array} constraints - 约束数组
 * @returns {Array} 依赖关系数组
 */
function identifyResourceDependencies(resources, constraints) {
  const dependencies = [];
  
  for (const constraint of constraints || []) {
    if (constraint.type === 'dependency') {
      dependencies.push({
        from: constraint.from,
        to: constraint.to,
        relationship: constraint.relationship || 'requires',
        description: constraint.description || ''
      });
    }
  }
  
  return dependencies;
}

/**
 * 分析资源可用性
 * @param {Array} resources - 资源数组
 * @param {Array} constraints - 约束数组
 * @returns {Object} 资源可用性分析结果
 */
function analyzeResourceAvailability(resources, constraints) {
  const availability = {
    total: resources.length,
    available: 0,
    constrained: 0,
    unavailable: 0
  };
  
  for (const resource of resources) {
    const resourceConstraints = (constraints || []).filter(c => 
      c.resource === resource.id || c.resources?.includes(resource.id)
    );
    
    if (resourceConstraints.length === 0) {
      availability.available++;
    } else if (resource.status === 'unavailable') {
      availability.unavailable++;
    } else {
      availability.constrained++;
    }
  }
  
  return availability;
}

/**
 * 检测资源冲突
 * @param {Array} resources - 资源数组
 * @param {Array} constraints - 约束数组
 * @param {Array} requirements - 需求数组
 * @returns {Array} 冲突数组
 */
function detectResourceConflicts(resources, constraints, requirements) {
  const conflicts = [];
  
  // 检测互斥资源冲突
  for (const constraint of constraints || []) {
    if (constraint.type === 'mutual_exclusion') {
      conflicts.push({
        type: 'mutual_exclusion',
        resources: constraint.resources,
        description: constraint.description || '资源互斥冲突',
        severity: 'high'
      });
    }
  }
  
  // 检测资源容量冲突
  const resourceUsage = {};
  for (const req of requirements || []) {
    for (const resId of req.requiredResources || []) {
      resourceUsage[resId] = (resourceUsage[resId] || 0) + 1;
    }
  }
  
  for (const resource of resources) {
    const usage = resourceUsage[resource.id] || 0;
    if (resource.capacity && usage > resource.capacity) {
      conflicts.push({
        type: 'capacity_exceeded',
        resource: resource.id,
        required: usage,
        available: resource.capacity,
        description: `资源${resource.id}容量不足（需要${usage}，可用${resource.capacity}）`,
        severity: 'medium'
      });
    }
  }
  
  return conflicts;
}

/**
 * 生成资源约束测试用例
 * @param {Array} resources - 资源数组
 * @param {Array} constraints - 约束数组
 * @param {Array} conflicts - 冲突数组
 * @returns {Array} 测试用例数组
 */
function generateResourceConstraintTestCases(resources, constraints, conflicts) {
  const testCases = [];
  
  // 为每个冲突生成测试用例
  for (let idx = 0; idx < conflicts.length; idx++) {
    const conflict = conflicts[idx];
    
    testCases.push({
      id: `TC-RC-${idx + 1}`,
      name: `资源冲突测试-${conflict.type}`,
      type: 'resource_constraint',
      conflict: conflict,
      expectedResult: conflict.severity === 'high' ? 'fail' : 'warning',
      description: `测试${conflict.description}`
    });
  }
  
  // 如果没有冲突，生成资源可用性测试用例
  if (testCases.length === 0) {
    for (let idx = 0; idx < resources.length; idx++) {
      testCases.push({
        id: `TC-RC-${idx + 1}`,
        name: `资源可用性测试-${resources[idx].name || resources[idx].id}`,
        type: 'resource_availability',
        resource: resources[idx].id,
        expectedResult: 'available',
        description: `验证资源${resources[idx].name || resources[idx].id}可用性`
      });
    }
  }
  
  return testCases;
}

/**
 * 环境组合优化（Environment Combination Optimization）
 * @param {Object} spec - 环境组合规格
 * @returns {Object} 环境组合优化结果
 */
function environmentCombinationOptimization(spec) {
  const { environments, constraints, optimization } = spec;
  
  // 验证输入
  if (!Array.isArray(environments) || environments.length === 0) {
    throw new Error('environments必须为非空数组');
  }
  
  // 生成环境组合矩阵
  const matrix = generateEnvironmentMatrix(environments, constraints);
  
  // 优化环境组合
  const optimizedCombinations = optimizeEnvironmentCombinations(matrix, optimization);
  
  // 生成兼容性测试用例
  const testCases = generateCompatibilityTestCases(optimizedCombinations);
  
  return {
    method: 'environment_combination_optimization',
    environments: environments,
    totalCombinations: matrix.total,
    optimizedCombinations: optimizedCombinations.length,
    reductionRate: ((1 - optimizedCombinations.length / matrix.total) * 100).toFixed(2) + '%',
    testCases: testCases,
    summary: `环境组合优化：从${matrix.total}个组合优化到${optimizedCombinations.length}个（减少${((1 - optimizedCombinations.length / matrix.total) * 100).toFixed(2)}%）`
  };
}

/**
 * 生成环境矩阵
 * @param {Array} environments - 环境数组
 * @param {Array} constraints - 约束数组
 * @returns {Object} 环境矩阵
 */
function generateEnvironmentMatrix(environments, constraints) {
  const matrix = {
    total: 1,
    combinations: []
  };
  
  // 计算总组合数
  for (const env of environments) {
    matrix.total *= (env.values || []).length;
  }
  
  // 生成所有组合（如果组合数不大）
  if (matrix.total <= 1000) {
    matrix.combinations = generateAllCombinations(environments);
  } else {
    // 如果组合数太大，使用采样
    matrix.combinations = sampleCombinations(environments, 100);
  }
  
  return matrix;
}

/**
 * 生成所有组合
 * @param {Array} environments - 环境数组
 * @returns {Array} 所有组合
 */
function generateAllCombinations(environments) {
  if (environments.length === 0) return [[]];
  
  const [first, ...rest] = environments;
  const restCombinations = generateAllCombinations(rest);
  
  const combinations = [];
  for (const value of first.values || []) {
    for (const restComb of restCombinations) {
      combinations.push([{ factor: first.name, value }, ...restComb]);
    }
  }
  
  return combinations;
}

/**
 * 采样组合
 * @param {Array} environments - 环境数组
 * @param {number} sampleSize - 采样大小
 * @returns {Array} 采样组合
 */
function sampleCombinations(environments, sampleSize) {
  const samples = [];
  for (let i = 0; i < sampleSize; i++) {
    const combination = environments.map(env => ({
      factor: env.name,
      value: (env.values || [])[Math.floor(Math.random() * (env.values || []).length)]
    }));
    samples.push(combination);
  }
  return samples;
}

/**
 * 优化环境组合
 * @param {Object} matrix - 环境矩阵
 * @param {Object} optimization - 优化选项
 * @returns {Array} 优化后的组合
 */
function optimizeEnvironmentCombinations(matrix, optimization) {
  // 如果组合数已经很少，直接返回
  if (matrix.combinations.length <= 20) {
    return matrix.combinations;
  }
  
  // 使用启发式方法选择代表性组合
  const selected = [];
  const usedValues = new Map();
  
  for (const combination of matrix.combinations) {
    // 检查是否增加了新的值覆盖
    let addsValue = false;
    for (const item of combination) {
      const key = `${item.factor}=${item.value}`;
      if (!usedValues.has(key)) {
        usedValues.set(key, true);
        addsValue = true;
      }
    }
    
    if (addsValue || selected.length < 10) {
      selected.push(combination);
    }
    
    if (selected.length >= 20) break;
  }
  
  return selected;
}

/**
 * 生成兼容性测试用例
 * @param {Array} combinations - 环境组合数组
 * @returns {Array} 测试用例数组
 */
function generateCompatibilityTestCases(combinations) {
  return combinations.map((combination, idx) => ({
    id: `TC-ENV-${idx + 1}`,
    name: `环境兼容性测试${idx + 1}`,
    type: 'compatibility',
    environment: combination,
    description: `测试环境：${combination.map(c => `${c.factor}=${c.value}`).join(', ')}`
  }));
}

/**
 * 生成L12正交表
 */
function generateL12() {
  // L12(2^11) 正交表
  return [
    [1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,2,2,2,2,2,2],
    [1,1,2,2,2,1,1,1,2,2,2],
    [1,2,1,2,2,1,2,2,1,1,2],
    [1,2,2,1,2,2,1,2,1,2,1],
    [1,2,2,2,1,2,2,1,2,1,1],
    [2,1,2,2,1,1,2,2,1,2,1],
    [2,1,2,1,2,2,2,1,1,1,2],
    [2,1,1,2,2,2,1,2,2,1,1],
    [2,2,2,1,1,1,1,2,2,2,1],
    [2,2,1,2,1,2,1,1,1,2,2],
    [2,2,1,1,2,1,2,1,2,2,1]
  ];
}

/**
 * 生成L16正交表
 */
function generateL16() {
  // L16(2^15) 正交表
  const l16 = [];
  for (let i = 0; i < 16; i++) {
    const row = [];
    for (let j = 0; j < 15; j++) {
      row.push(((i >> (j % 4)) & 1) + 1);
    }
    l16.push(row);
  }
  return l16;
}

/**
 * 生成L18正交表
 */
function generateL18() {
  // L18(2^1 * 3^7) 正交表（简化版）
  return Array.from({ length: 18 }, (_, i) => {
    const row = [(i % 2) + 1];
    for (let j = 0; j < 7; j++) {
      row.push((i % 3) + 1);
    }
    return row;
  });
}

/**
 * 生成L25正交表
 */
function generateL25() {
  // L25(5^6) 正交表
  const l25 = [];
  for (let i = 0; i < 25; i++) {
    const row = [];
    for (let j = 0; j < 6; j++) {
      row.push((i % 5) + 1);
    }
    l25.push(row);
  }
  return l25;
}

/**
 * 生成混合水平正交表
 */
function generateMixedLevelArray(numFactors, levels, dof) {
  // 简化实现：使用乘积法生成近似正交表
  const runs = Math.max(8, Math.ceil(Math.log2(dof)) * 2);
  const array = [];
  
  for (let run = 0; run < runs; run++) {
    const row = [];
    for (let factor = 0; factor < numFactors; factor++) {
      row.push((run % levels[factor]) + 1);
    }
    array.push(row);
  }
  
  return {
    type: `Mixed-${runs}`,
    runs: runs,
    factors: numFactors,
    levels: levels,
    array: array
  };
}

/**
 * 执行环境维度分析
 * @param {Object} options - 分析选项
 * @returns {Object} 环境维度分析结果
 */
async function executeEnvironmentDimension(options) {
  const { method, spec } = options;
  
  // 验证输入
  if (!method) {
    throw new Error('method是必填参数');
  }
  
  if (!spec) {
    throw new Error('spec是必填参数');
  }
  
  const result = {
    method: method,
    timestamp: new Date().toISOString()
  };
  
  switch (method) {
    case 'orthogonal_array_design':
      result.orthogonal = orthogonalArrayDesign(spec);
      break;
      
    case 'resource_constraint_analysis':
      result.resourceConstraint = resourceConstraintAnalysis(spec);
      break;
      
    case 'environment_combination_optimization':
      result.environmentCombination = environmentCombinationOptimization(spec);
      break;
      
    default:
      throw new Error(`不支持的方法：${method}。支持的方法：orthogonal_array_design, resource_constraint_analysis, environment_combination_optimization`);
  }
  
  return result;
}

module.exports = {
  orthogonalArrayDesign,
  resourceConstraintAnalysis,
  environmentCombinationOptimization,
  executeEnvironmentDimension
};
