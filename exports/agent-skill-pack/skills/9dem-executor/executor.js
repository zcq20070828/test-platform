/**
 * 九维穷举模型执行器（9DEM Executor）
 *
 * 基于九维穷举模型（用户/数据/流程/操作/安全/性能/网络环境/终端环境/兼容性）
 * 生成高覆盖率测试用例的方法论支撑。
 * 当前版本：data（数据）维度具备自动化计算（等价类、边界值、Pairwise）；
 * 其余维度返回该维度关注点的结构化引导，由 LLM 结合需求补充具体用例。
 */

const fs = require('fs');
const path = require('path');

/**
 * 九维定义：维度键 -> 中文名 + 关注点
 */
const DIMENSIONS = {
  user:         { label: '① 用户',         focus: '登录态/角色/数据隔离/越权，正常-边界-异常三层' },
  data:         { label: '② 数据',         focus: '业务数据、接口参数、LLM输出，BVA七点集' },
  process:      { label: '③ 流程',         focus: '多阶段状态机，合法+非法迁移，正常-边界-异常三层' },
  operation:    { label: '④ 操作',         focus: '重复操作/中断恢复/幂等，正常-边界-异常三层' },
  security:     { label: '⑤ 安全',         focus: '鉴权/越权/敏感信息脱敏/注入，边界-异常层' },
  performance:  { label: '⑥ 性能',         focus: '超时/并发/大数据量/宕机恢复，边界-异常层' },
  network:      { label: '⑦ 网络环境',     focus: '弱网/断网/切网/SSE断流/超时重试，正常-边界-异常三层' },
  terminal:     { label: '⑧ 终端环境',     focus: '浏览器与系统级中断（切后台/锁屏），正常-边界-异常三层' },
  compatibility:{ label: '⑨ 兼容性',       focus: '浏览器矩阵/SSE EventSource/渲染布局一致性，边界-异常层' }
};

const ALL_DIMENSION_KEYS = Object.keys(DIMENSIONS);

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
    // （9dem-invoker 的 buildInputSpecFromFields 输出对象格式，
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
 * 计算单个维度的穷举结果。
 * data 维度返回自动化计算结果；其余维度返回结构化引导，供 LLM 结合需求补充。
 * @param {string} dim - 维度键
 * @param {Object} inputSpec - 输入规范
 * @returns {Object}
 */
function computeDimension(dim, inputSpec) {
  if (dim === 'data') {
    return {
      equivalenceClasses: generateEquivalenceClasses(inputSpec),
      boundaryValues: generateBoundaryValues(inputSpec),
      pairwise: generatePairwiseCombinations(inputSpec)
    };
  }
  const meta = DIMENSIONS[dim];
  return {
    dimension: dim,
    label: meta ? meta.label : dim,
    focus: meta ? meta.focus : '',
    guidance: '按九维穷举模型，在该维度下运用等价类划分、边界值分析、状态迁移、场景法、错误推测等方法设计用例，并标注层级（正常/边界/异常）。'
  };
}

/**
 * 主函数：执行九维穷举模型
 * @param {Object} options - 执行选项
 * @param {Object} options.inputSpec - 结构化输入规范
 * @param {Array<string>} [options.dimensions] - 维度列表，默认 ['data']
 * @returns {Object} 各维度计算结果（仅包含请求的维度）
 */
function execute9DEM(options) {
  const { inputSpec, dimensions = ['data'] } = options;

  const result = {};
  for (const dim of ALL_DIMENSION_KEYS) {
    if (dimensions.includes(dim)) {
      result[dim] = computeDimension(dim, inputSpec);
    }
  }

  return result;
}

module.exports = {
  execute9DEM,
  generateEquivalenceClasses,
  generateBoundaryValues,
  generatePairwiseCombinations,
  DIMENSIONS,
  ALL_DIMENSION_KEYS
};
