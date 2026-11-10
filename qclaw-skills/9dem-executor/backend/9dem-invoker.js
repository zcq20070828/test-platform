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

const { executeDesignMethods, METHODS: DESIGN_METHODS, METHOD_KEYS: DESIGN_METHOD_KEYS } = require('./design-methods');
const { generateDimensionCases, renderChecklist } = require('./dimension-cases');

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
 * @param {Array<string>} [params.methods] - 黑盒设计方法，默认全部 9 种
 * @param {Object} [params.designInput] - 设计方法的结构化输入（causes/effects/rules/factors/scenarios/states/transitions/functions）
 * @param {boolean} [params.includeDesignCases=true] - 是否输出黑盒方法生成的具体用例
 * @param {boolean} [params.dedupe=true] - 是否跨方法去重
 * @param {boolean} [params.includeDimensionCases=true] - 是否输出九维必测点确定性用例（默认输出）
 * @param {Object} [params.options] - 扩展选项（module/target/maxPerDimension）
 * @returns {Object} 执行结果
 */
async function invoke(params) {
  const {
    task,
    inputSpec,
    fields,
    dimensions = ['data'],
    methods,
    designInput = {},
    includeDesignCases = true,
    dedupe = true,
    includeDimensionCases = true,
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

  const hasDesignInput = designInput && typeof designInput === 'object' && Object.keys(designInput).length > 0;
  if (!spec && !hasDesignInput) {
    // 兜底：返回方法论提示
    return {
      skill: '9dem-executor',
      success: false,
      error: '请提供 task（需求文本）、inputSpec（结构化规范）、fields（字段列表）或 designInput（设计方法输入）参数之一',
      hint: '九维穷举模型需要输入字段才能生成等价类/边界值；因果图/判定表/场景法/状态迁移/功能图需要 designInput 中对应的 causes/rules/scenarios/transitions/functions。'
    };
  }

  try {
    const result = spec ? execute9DEM({ inputSpec: spec, dimensions }) : {};

    // 黑盒 9 种设计方法：与九维维度正交，输出可直接落表的用例
    let design = null;
    if (includeDesignCases) {
      const merged = { ...designInput };
      if (!merged.inputSpec && !merged.spec && spec) merged.inputSpec = spec;
      design = executeDesignMethods({ input: merged, methods, dedupe });
    }

    const designStats = design ? design.stats : null;

    // 九维必测点 → 确定性用例（2026-11-09）
    // 过去只有「数据」维是确定性计算的，其余八维只回一段「关注点 + 指引」，模型写不写没人管，
    // 「九维覆盖率」因此只是标注。这里把九维必测点直接展开成可落表用例，
    // 门禁用同一份探针清单判定，覆盖率成为约束。
    // 注意：无论调用方请求了哪几个维度，必测点一律九维全量——
    // 门禁是按九维判定的，少生成一维就等于少一维无法通过。
    const dimensionGen = includeDimensionCases
      ? generateDimensionCases({
        task,
        module: options.module || options.target,
        inputSpec: spec,
        maxPerDimension: options.maxPerDimension,
      })
      : { cases: [], checklist: [], stats: { total: 0, dimensionCount: 0, byDimension: {} } };

    const pairwise = result.data?.pairwise;
    const pairwiseMeta = pairwise ? {
      mode: pairwise.mode || 'full',
      originalTotal: pairwise.originalTotal || pairwise.length,
      factorCount: pairwise.factorCount != null ? pairwise.factorCount : (spec ? Object.keys(spec).length : 0),
      excludedFields: pairwise.excludedFields || [],
      compressed: (pairwise.mode || 'full') !== 'full',
    } : null;

    // 工具结果会被 JSON.stringify 后塞进 LLM messages：组合数过大时必须裁剪输出，
    // 否则单条工具结果可达十几 MB，既撑爆上下文也拖高堆内存。
    const PAIRWISE_OUTPUT_LIMIT = Number(process.env.NINEDEM_PAIRWISE_OUTPUT_LIMIT) || 200;
    function capPairwise(container) {
      const arr = container && container.pairwise;
      if (!Array.isArray(arr) || arr.length <= PAIRWISE_OUTPUT_LIMIT) return container;
      const capped = arr.slice(0, PAIRWISE_OUTPUT_LIMIT);
      capped.mode = arr.mode;
      capped.originalTotal = arr.originalTotal;
      capped.excludedFields = arr.excludedFields;
      capped.factorCount = arr.factorCount;
      capped.outputTruncated = true;
      capped.outputTotal = arr.length;
      if (container && typeof container === 'object') container.pairwise = capped;
      return container;
    }
    if (pairwiseMeta) {
      pairwiseMeta.outputLimit = PAIRWISE_OUTPUT_LIMIT;
      pairwiseMeta.outputTruncated = (pairwise?.length || 0) > PAIRWISE_OUTPUT_LIMIT;
    }
    const resultForOutput = result.data ? { ...result, data: capPairwise({ ...result.data }) } : result;

    return {
      skill: '9dem-executor',
      success: true,
      dimensions,
      inputSpec: spec,
      methods: design ? design.methods.map((m) => ({
        method: m.method,
        methodKey: m.methodKey,
        methodLabel: m.methodLabel,
        caseCount: m.caseCount,
        skipped: m.skipped,
        reason: m.reason,
        guidance: m.guidance,
        mode: m.mode,
      })) : undefined,
      summary: {
        requestedDimensions: dimensions,
        dataEquivalenceClassesCount: result.data?.equivalenceClasses?.validClasses?.length || 0,
        dataBoundaryValuesCount: result.data?.boundaryValues?.length || 0,
        dataPairwiseCount: pairwise?.length || 0,
        pairwise: pairwiseMeta,
        designMethodCoverage: designStats ? designStats.methodCoverage : 0,
        designUniqueCases: designStats ? designStats.uniqueCases : 0,
        designDuplicatesRemoved: designStats ? designStats.duplicatesRemoved : 0,
        dimensionProbeCount: dimensionGen.stats.total,
        dimensionCoveredCount: dimensionGen.stats.dimensionCount,
        dimensionCasesByDimension: dimensionGen.stats.byDimension,
        totalDeterministicCases: (designStats ? designStats.uniqueCases : 0) + dimensionGen.stats.total,
      },
      design,
      dimensionCases: dimensionGen.cases,
      dimensionChecklist: dimensionGen.checklist,
      dimensionChecklistText: renderChecklist(dimensionGen.checklist),
      dimensionsResult: resultForOutput,
      ...resultForOutput
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
