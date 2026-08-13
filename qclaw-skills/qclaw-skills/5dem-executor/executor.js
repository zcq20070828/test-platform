/**
 * 五维穷举模型执行器（5DEM Executor）
 * 
 * 实现数据、流程、环境、时间、依赖五个维度的穷举测试
 * 当前版本：实现数据维度（等价类、边界值、Pairwise）
 */

const fs = require('fs');
const path = require('path');

/**
 * 数据维度：等价类划分
 * @param {Object} inputSpec - 输入规范
 * @returns {Object} 等价类划分结果
 */
function generateEquivalenceClasses(inputSpec) {
  const result = {
    validClasses: [],
    invalidClasses: []
  };

  // 解析输入规范，生成等价类
  for (const [field, spec] of Object.entries(inputSpec)) {
    if (spec.type === 'string') {
      // 字符串类型
      result.validClasses.push({
        field,
        type: 'valid',
        values: ['正常字符串', '空字符串', '边界长度字符串']
      });
      result.invalidClasses.push({
        field,
        type: 'invalid',
        values: ['null', 'undefined', '超长字符串']
      });
    } else if (spec.type === 'number') {
      // 数值类型
      result.validClasses.push({
        field,
        type: 'valid',
        values: [spec.min || 0, spec.max || 100, (spec.min + spec.max) / 2]
      });
      result.invalidClasses.push({
        field,
        type: 'invalid',
        values: ['非数字', spec.min - 1, spec.max + 1]
      });
    } else if (spec.type === 'enum') {
      // 枚举类型
      result.validClasses.push({
        field,
        type: 'valid',
        values: spec.values
      });
      result.invalidClasses.push({
        field,
        type: 'invalid',
        values: ['不在枚举中的值']
      });
    }
  }

  return result;
}

/**
 * 数据维度：边界值分析
 * @param {Object} inputSpec - 输入规范
 * @returns {Object} 边界值分析结果
 */
function generateBoundaryValues(inputSpec) {
  const result = [];

  for (const [field, spec] of Object.entries(inputSpec)) {
    if (spec.type === 'number') {
      const min = spec.min || 0;
      const max = spec.max || 100;
      
      // 边界值：最小值、最小值+1、最大值-1、最大值
      result.push({
        field,
        boundaries: [
          { value: min, type: 'min' },
          { value: min + 1, type: 'min+1' },
          { value: max - 1, type: 'max-1' },
          { value: max, type: 'max' }
        ]
      });
    } else if (spec.type === 'string') {
      const minLen = spec.minLength || 0;
      const maxLen = spec.maxLength || 255;
      
      // 字符串长度边界
      result.push({
        field,
        boundaries: [
          { value: minLen, type: 'minLength' },
          { value: minLen + 1, type: 'minLength+1' },
          { value: maxLen - 1, type: 'maxLength-1' },
          { value: maxLen, type: 'maxLength' }
        ]
      });
    }
  }

  return result;
}

/**
 * 数据维度：Pairwise组合测试
 * @param {Object} factors - 因子定义（每个因子的值数组）
 * @returns {Array} Pairwise组合用例
 */
function generatePairwiseCombinations(factors) {
  // 简化版Pairwise算法（实际应使用PICT工具）
  const combinations = [];
  const factorNames = Object.keys(factors);
  
  // 生成所有组合（简化版，实际应使用正交数组）
  function generateCombinations(index, current) {
    if (index === factorNames.length) {
      combinations.push({ ...current });
      return;
    }
    
    const factorName = factorNames[index];
    let values = factors[factorName];

    // 兼容对象格式 {type, min, max, values, minLength, maxLength}
    // （5dem-invoker 的 buildInputSpecFromFields 输出对象格式，
    //  与 generateEquivalenceClasses / generateBoundaryValues 保持一致）
    if (!Array.isArray(values) && values && typeof values === 'object') {
      const spec = values;
      if (spec.type === 'number') {
        const min = spec.min ?? 0;
        const max = spec.max ?? 100;
        values = [min, min + 1, max - 1, max];
      } else if (spec.type === 'enum') {
        values = spec.values || [];
      } else { // string（默认）
        const minLen = spec.minLength ?? 0;
        const maxLen = spec.maxLength ?? 255;
        values = [minLen, minLen + 1, maxLen - 1, maxLen];
      }
    }

    // 确保values是数组
    if (!Array.isArray(values)) {
      console.error(`Factor ${factorName} values is not an array:`, values);
      return;
    }
    
    for (const value of values) {
      current[factorName] = value;
      generateCombinations(index + 1, current);
    }
  }
  
  generateCombinations(0, {});
  
  // 去重（简化版）
  const uniqueCombinations = Array.from(
    new Set(combinations.map(c => JSON.stringify(c)))
  ).map(c => JSON.parse(c));
  
  return uniqueCombinations;
}

/**
 * 主函数：执行五维穷举模型
 * @param {Object} options - 执行选项
 * @returns {Object} 生成的测试用例
 */
function execute5DEM(options) {
  const { inputSpec, dimensions = ['data'] } = options;
  
  const result = {
    data: null,
    process: null,
    environment: null,
    time: null,
    dependency: null
  };
  
  // 数据维度
  if (dimensions.includes('data')) {
    result.data = {
      equivalenceClasses: generateEquivalenceClasses(inputSpec),
      boundaryValues: generateBoundaryValues(inputSpec),
      pairwise: generatePairwiseCombinations(inputSpec)
    };
  }
  
  // 其他维度（V2.0实现）
  // if (dimensions.includes('process')) { ... }
  // if (dimensions.includes('environment')) { ... }
  // if (dimensions.includes('time')) { ... }
  // if (dimensions.includes('dependency')) { ... }
  
  return result;
}

module.exports = {
  execute5DEM,
  generateEquivalenceClasses,
  generateBoundaryValues,
  generatePairwiseCombinations
};
