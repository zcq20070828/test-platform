/**
 * 数据维度穷举 - 等价类划分、边界值分析、组合测试
 * 5DEM Executor - Data Dimension
 */

const fs = require('fs');
const path = require('path');

/**
 * 等价类划分
 * @param {Object} inputSpec - 输入规格说明
 * @returns {Object} 等价类划分结果
 */
function equivalenceClassPartitioning(inputSpec) {
  const result = {
    validClasses: [],    // 有效等价类
    invalidClasses: [],  // 无效等价类
    testCases: []        // 生成的测试用例
  };
  
  // 遍历每个输入条件
  for (const [field, spec] of Object.entries(inputSpec)) {
    const fieldResult = {
      field,
      valid: [],
      invalid: []
    };
    
    // 检查跨字段约束（dependsOn）
    if (spec.dependsOn) {
      const { field: dependField, condition, value, required } = spec.dependsOn;
      
      // 添加依赖字段的等价类
      if (required) {
        // 当条件满足时，此字段必填（添加无效等价类：未提供）
        fieldResult.invalid.push({
          class: `无效等价类_${field}_未提供（当${dependField}${condition || '='}${value || condition}）`,
          condition: `${field} 未提供 且 ${dependField}${condition || '='}${value || condition}`,
          examples: [undefined]
        });
      }
    }
    
    // 根据类型进行等价类划分
    switch (spec.type) {
      case 'integer':
      case 'number':
        // 数值类型：有效范围、无效范围
        if (spec.range) {
          const [min, max] = spec.range;
          fieldResult.valid.push({
            class: `有效等价类_${field}_范围内`,
            condition: `${min} <= ${field} <= ${max}`,
            examples: [Math.floor((min + max) / 2)]  // 典型值
          });
          fieldResult.invalid.push({
            class: `无效等价类_${field}_小于最小值`,
            condition: `${field} < ${min}`,
            examples: [min - 1]
          });
          fieldResult.invalid.push({
            class: `无效等价类_${field}_大于最大值`,
            condition: `${field} > ${max}`,
            examples: [max + 1]
          });
          
          // 语义划分（如果提供了semanticPartitions）
          if (spec.semanticPartitions && Array.isArray(spec.semanticPartitions)) {
            spec.semanticPartitions.forEach(partition => {
              const { name, range } = partition;
              if (range && range.length === 2) {
                const [pMin, pMax] = range;
                if (pMin >= min && pMax <= max) {  // 确保在总范围内
                  fieldResult.valid.push({
                    class: `有效等价类_${field}_${name}（${pMin}-${pMax}）`,
                    condition: `${pMin} <= ${field} <= ${pMax}`,
                    examples: [Math.floor((pMin + pMax) / 2)]
                  });
                }
              }
            });
          }
        }
        break;
        
      case 'string':
        // 字符串类型：长度、格式
        if (spec.length) {
          const [minLen, maxLen] = spec.length;
          fieldResult.valid.push({
            class: `有效等价类_${field}_长度合法`,
            condition: `${minLen} <= len(${field}) <= ${maxLen}`,
            examples: ['A'.repeat(Math.floor((minLen + maxLen) / 2))]
          });
          fieldResult.invalid.push({
            class: `无效等价类_${field}_长度过短`,
            condition: `len(${field}) < ${minLen}`,
            examples: ['A'.repeat(Math.max(0, minLen - 1))]
          });
          fieldResult.invalid.push({
            class: `无效等价类_${field}_长度过长`,
            condition: `len(${field}) > ${maxLen}`,
            examples: ['A'.repeat(maxLen + 1)]
          });
        }
        if (spec.pattern) {
          fieldResult.valid.push({
            class: `有效等价类_${field}_格式正确`,
            condition: `${field} 匹配 ${spec.pattern}`,
            examples: [spec.example || 'valid_example']
          });
          fieldResult.invalid.push({
            class: `无效等价类_${field}_格式错误`,
            condition: `${field} 不匹配 ${spec.pattern}`,
            examples: [spec.counterExample || 'invalid!@#']
          });
        }
        break;
        
      case 'enum':
        // 枚举类型：有效值、无效值
        if (spec.values) {
          spec.values.forEach(val => {
            fieldResult.valid.push({
              class: `有效等价类_${field}_${val}`,
              condition: `${field} = ${val}`,
              examples: [val]
            });
          });
          fieldResult.invalid.push({
            class: `无效等价类_${field}_非法值`,
            condition: `${field} 不在 ${JSON.stringify(spec.values)}`,
            examples: ['INVALID_VALUE']
          });
        }
        break;
        
      case 'boolean':
        // 布尔类型：true、false
        fieldResult.valid.push({
          class: `有效等价类_${field}_true`,
          condition: `${field} = true`,
          examples: [true]
        });
        fieldResult.valid.push({
          class: `有效等价类_${field}_false`,
          condition: `${field} = false`,
          examples: [false]
        });
        break;
    }
    
    result.validClasses.push(...fieldResult.valid);
    result.invalidClasses.push(...fieldResult.invalid);
  }
  
  // 生成测试用例（每个等价类至少一个测试用例）
  result.validClasses.forEach(ec => {
    result.testCases.push({
      type: 'valid',
      description: `测试${ec.class}`,
      input: ec.examples[0],
      expected: '通过'
    });
  });
  
  result.invalidClasses.forEach(ec => {
    result.testCases.push({
      type: 'invalid',
      description: `测试${ec.class}`,
      input: ec.examples[0],
      expected: '失败'
    });
  });
  
  return result;
}

/**
 * 边界值分析
 * @param {Object} inputSpec - 输入规格说明
 * @returns {Object} 边界值分析结果
 */
function boundaryValueAnalysis(inputSpec) {
  const result = {
    boundaries: [],   // 边界点
    testCases: []     // 生成的测试用例
  };
  
  // 遍历每个输入条件
  for (const [field, spec] of Object.entries(inputSpec)) {
    if (spec.type === 'integer' || spec.type === 'number') {
      if (spec.range) {
        const [min, max] = spec.range;
        
        // 边界值：最小值、最小值+1、最大值-1、最大值
        const boundaries = [
          { value: min, type: 'min', description: `${field} = 最小值 ${min}` },
          { value: min + 1, type: 'min+1', description: `${field} = 最小值+1 ${min + 1}` },
          { value: Math.floor((min + max) / 2), type: 'nominal', description: `${field} = 典型值 ${Math.floor((min + max) / 2)}` },
          { value: max - 1, type: 'max-1', description: `${field} = 最大值-1 ${max - 1}` },
          { value: max, type: 'max', description: `${field} = 最大值 ${max}` }
        ];
        
        result.boundaries.push(...boundaries);
        
        // 生成测试用例
        boundaries.forEach(b => {
          result.testCases.push({
            field,
            boundary: b.type,
            value: b.value,
            description: b.description,
            expected: (b.value >= min && b.value <= max) ? '通过' : '失败'
          });
        });
        
        // 边界外值：最小值-1、最大值+1
        result.testCases.push({
          field,
          boundary: 'min-1',
          value: min - 1,
          description: `${field} = 最小值-1 ${min - 1}（边界外）`,
          expected: '失败'
        });
        result.testCases.push({
          field,
          boundary: 'max+1',
          value: max + 1,
          description: `${field} = 最大值+1 ${max + 1}（边界外）`,
          expected: '失败'
        });
      }
    }
  }
  
  return result;
}

/**
 * Pairwise组合测试
 * @param {Object} inputSpec - 输入规格说明
 * @returns {Object} Pairwise组合测试结果
 */
function pairwiseTesting(inputSpec) {
  const result = {
    factors: [],      // 因子
    combinations: [],  // 最优组合
    testCases: []     // 生成的测试用例
  };
  
  // 提取因子和水平
  const factors = [];
  for (const [field, spec] of Object.entries(inputSpec)) {
    const factor = {
      name: field,
      levels: []
    };
    
    switch (spec.type) {
      case 'enum':
        factor.levels = spec.values || [];
        break;
      case 'boolean':
        factor.levels = [true, false];
        break;
      case 'integer':
      case 'number':
        // 数值类型：使用边界值和典型值作为水平
        if (spec.range) {
          const [min, max] = spec.range;
          factor.levels = [min, Math.floor((min + max) / 2), max];
        } else {
          factor.levels = [0, 1, 100];  // 默认值
        }
        break;
      case 'string':
        // 字符串类型：使用典型值
        factor.levels = [spec.example || 'test', ''];
        break;
      default:
        factor.levels = ['valid', 'invalid'];
    }
    
    factors.push(factor);
  }
  
  result.factors = factors;
  
  // 生成Pairwise组合（简化版：使用全组合的前N个）
  // 注：生产环境应使用PICT工具或ACTS工具
  const allCombinations = generateAllCombinations(factors);
  
  // 简化算法：选择覆盖所有2-way组合的最小集合
  const pairwiseCoverage = selectPairwiseCombinations(allCombinations, factors);
  
  result.combinations = pairwiseCoverage.combinations;
  result.coverage = pairwiseCoverage.coverage;
  
  // 生成测试用例
  result.combinations.forEach((combo, idx) => {
    const testCase = {
      id: `pairwise_${idx + 1}`,
      inputs: {},
      expected: '通过'
    };
    
    combo.forEach((value, factorIdx) => {
      testCase.inputs[factors[factorIdx].name] = value;
    });
    
    result.testCases.push(testCase);
  });
  
  return result;
}

/**
 * 生成全组合
 * @param {Array} factors - 因子数组
 * @returns {Array} 全组合
 */
function generateAllCombinations(factors) {
  if (factors.length === 0) return [[]];
  
  const [first, ...rest] = factors;
  const restCombinations = generateAllCombinations(rest);
  
  const result = [];
  for (const level of first.levels) {
    for (const combo of restCombinations) {
      result.push([level, ...combo]);
    }
  }
  
  return result;
}

/**
 * 选择Pairwise组合
 * @param {Array} allCombinations - 全组合
 * @param {Array} factors - 因子数组
 * @returns {Object} 选中的组合和覆盖率
 */
function selectPairwiseCombinations(allCombinations, factors) {
  const selected = [];
  const coveredPairs = new Set();
  
  // 贪心算法：每次选择覆盖最多未覆盖pair的组合
  let remaining = [...allCombinations];
  
  while (remaining.length > 0) {
    let bestCombo = null;
    let bestScore = 0;
    
    for (const combo of remaining) {
      const pairs = getPairs(combo, factors);
      const newPairs = pairs.filter(p => !coveredPairs.has(p));
      if (newPairs.length > bestScore) {
        bestScore = newPairs.length;
        bestCombo = combo;
      }
    }
    
    if (bestScore === 0) break;
    
    selected.push(bestCombo);
    const pairs = getPairs(bestCombo, factors);
    pairs.forEach(p => coveredPairs.add(p));
    remaining = remaining.filter(c => c !== bestCombo);
  }
  
  // 计算覆盖率
  const totalPairs = calculateTotalPairs(factors);
  const coverage = (coveredPairs.size / totalPairs) * 100;
  
  return {
    combinations: selected,
    coverage: coverage.toFixed(2) + '%'
  };
}

/**
 * 获取组合中的所有2-way pairs
 * @param {Array} combo - 组合
 * @param {Array} factors - 因子数组
 * @returns {Array} pairs数组
 */
function getPairs(combo, factors) {
  const pairs = [];
  for (let i = 0; i < combo.length; i++) {
    for (let j = i + 1; j < combo.length; j++) {
      pairs.push(`${factors[i].name}:${combo[i]}_${factors[j].name}:${combo[j]}`);
    }
  }
  return pairs;
}

/**
 * 计算总的2-way pairs数
 * @param {Array} factors - 因子数组
 * @returns {Number} 总的pairs数
 */
function calculateTotalPairs(factors) {
  let total = 0;
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      total += factors[i].levels.length * factors[j].levels.length;
    }
  }
  return total;
}

/**
 * 主函数：执行数据维度穷举
 * @param {Object} options - 选项
 * @param {Object} options.inputSpec - 输入规格说明
 * @param {string} options.method - 方法（equivalence, boundary, pairwise, all）
 * @returns {Object} 执行结果
 */
async function executeDataDimension(options) {
  const { inputSpec, method = 'all' } = options;
  
  // 输入验证
  const validMethods = ['all', 'equivalence', 'boundary', 'pairwise'];
  if (!validMethods.includes(method)) {
    throw new Error(`无效method：${method}。有效值：${validMethods.join(', ')}`);
  }
  
  // 输入规格验证
  if (!inputSpec || typeof inputSpec !== 'object') {
    throw new Error('inputSpec必须为非空对象');
  }
  
  const result = {
    timestamp: new Date().toISOString(),
    method,
    inputSpec,
    equivalence: null,
    boundary: null,
    pairwise: null
  };
  
  if (method === 'all' || method === 'equivalence') {
    result.equivalence = equivalenceClassPartitioning(inputSpec);
  }
  
  if (method === 'all' || method === 'boundary') {
    result.boundary = boundaryValueAnalysis(inputSpec);
  }
  
  if (method === 'all' || method === 'pairwise') {
    result.pairwise = pairwiseTesting(inputSpec);
  }
  
  return result;
}

// 导出
module.exports = {
  equivalenceClassPartitioning,
  boundaryValueAnalysis,
  pairwiseTesting,
  executeDataDimension
};
