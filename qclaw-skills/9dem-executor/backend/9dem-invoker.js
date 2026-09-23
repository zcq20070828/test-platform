'use strict';

/**
 * 9DEM Invoker - 供 LLM tool-call 调用的统一入口
 * 封装九维穷举模型执行器，将易填的参数映射到 execute9DEM 所需格式
 */

const {
  execute9DEM,
  generateEquivalenceClasses,
  generateBoundaryValues,
  generatePairwiseCombinations
} = require('../executor');

/**
 * 从 task 文本构建 inputSpec（宽松推断）
 * @param {string} task - 需求或场景描述文本
 * @returns {Object} inputSpec
 */
function buildInputSpecFromTask(task) {
  // 简化：将整个任务当作一个字符串字段
  // 生产版可接入 NER 或 LLM 抽取字段
  const spec = {
    requirement: {
      type: 'string',
      minLength: 1,
      maxLength: Math.min(task.length || 500, 5000)
    }
  };

  // 尝试解析 "字段:类型" 格式的行
  const lines = (task || '').split('\n');
  for (const line of lines) {
    const m = line.match(/^[\s*-]*\s*([^\s:：]+)\s*[:：]\s*(\w+)/);
    if (m) {
      const name = m[1].trim();
      const typeStr = m[2].toLowerCase();
      const type = typeStr === 'number' || typeStr === '数值' ? 'number'
                 : typeStr === 'enum' || typeStr === '枚举' ? 'enum'
                 : 'string';
      spec[name] = type === 'number'
        ? { type: 'number', min: 0, max: 100 }
        : type === 'enum'
          ? { type: 'enum', values: ['value1', 'value2'] }
          : { type: 'string', minLength: 1, maxLength: 255 };
    }
  }

  // 如果解析出多个字段，移除占位的 requirement
  const keys = Object.keys(spec);
  if (keys.length > 1) {
    delete spec.requirement;
  }

  return spec;
}

/**
 * 从 params.fields 构建结构化 inputSpec
 * @param {Array<{name,type,min,max,minLength,maxLength,values}>} fields
 * @returns {Object} inputSpec
 */
function buildInputSpecFromFields(fields) {
  const spec = {};
  for (const f of fields || []) {
    const name = f.name || f.field || 'field';
    const type = f.type || 'string';
    const s = { type };
    if (type === 'number') {
      s.min = f.min ?? f.minimum ?? 0;
      s.max = f.max ?? f.maximum ?? 100;
    } else if (type === 'string') {
      s.minLength = f.minLength ?? f.min_length ?? 0;
      s.maxLength = f.maxLength ?? f.max_length ?? 255;
    } else if (type === 'enum') {
      s.values = f.values || [];
    }
    spec[name] = s;
  }
  return spec;
}

/**
 * invoke - LLM tool-call 入口
 * @param {Object} params
 * @param {string} [params.task] - 需求/场景文本（与 inputSpec 二选一）
 * @param {Object} [params.inputSpec] - 已结构化的输入规范（优先）
 * @param {Array<{name,type,min,max,minLength,maxLength,values}>} [params.fields] - 字段列表（三选一）
 * @param {Array<string>} [params.dimensions] - 维度列表，默认 ['data']
 * @param {Object} [params.options] - 扩展选项
 * @returns {Object} 执行结果
 */
async function invoke(params) {
  const {
    task,
    inputSpec,
    fields,
    dimensions = ['data'],
    options = {}
  } = params || {};

  // 构建 inputSpec
  let spec = inputSpec;
  if (!spec && fields && Array.isArray(fields) && fields.length > 0) {
    spec = buildInputSpecFromFields(fields);
  }
  if (!spec && task) {
    spec = buildInputSpecFromTask(task);
  }
  if (!spec) {
    // 兜底：返回方法论提示
    return {
      skill: '9dem-executor',
      success: false,
      error: '请提供 task（需求文本）、inputSpec（结构化规范）或 fields（字段列表）参数之一',
      hint: '九维穷举模型需要定义输入字段（字段名、类型、边界值等）才能生成等价类/边界值测试设计。'
    };
  }

  try {
    const result = execute9DEM({ inputSpec: spec, dimensions });

    // 附加上下文，帮助 LLM 理解结果
    return {
      skill: '9dem-executor',
      success: true,
      dimensions,
      inputSpec: spec,
      summary: {
        requestedDimensions: dimensions,
        dataEquivalenceClassesCount: result.data?.equivalenceClasses?.validClasses?.length || 0,
        dataBoundaryValuesCount: result.data?.boundaryValues?.length || 0,
        dataPairwiseCount: result.data?.pairwise?.length || 0
      },
      dimensionsResult: result,
      ...result
    };
  } catch (e) {
    return {
      skill: '9dem-executor',
      success: false,
      error: e.message,
      inputSpec: spec
    };
  }
}

module.exports = {
  invoke,
  buildInputSpecFromTask,
  buildInputSpecFromFields
};
