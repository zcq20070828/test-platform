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
// 从需求文本确定性推导设计输入（2026-11-20）：
// 因果图/判定表/功能图/状态迁移长期 skipped，因为它们要求模型在调用时
// 显式构造 rules/functions/states，而模型不会凭空编业务规则。
// 但需求文档里本来就有「若…则…」「A→B→C」「变为」这些结构，可确定性解析。
const { deriveDesignInput } = require('./design-input-derive.js');
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
 * 判断 inputSpec 的键到底是「可测字段」还是别的东西（2026-11-26）
 *
 * 模型传 inputSpec 时经常把这三类东西当成字段：
 *   ① 接口路径：`/custody/validate`、`/api/v1/order`
 *   ② 请求头集合：`commonHeaders`、`headers`、`请求头`
 *   ③ 统计说明文字：`接口要素完整度（按要素计数，非接口计数）`、`可用性分区`
 * 它们都不是可测字段。按「长度等价类/边界值」展开后，
 * 用例名会变成「等价类-/custody/validate-长度合法」，输入是 `/custody/validate=""`——
 * 执行者根本不知道该怎么"改这个字段的长度"。实测任务 26a56e33 因此 183 条全不可执行。
 *
 * @returns {{spec:Object, removed:string[]}}
 */
function filterRealFields(spec) {
  if (!spec || typeof spec !== 'object') return { spec: {}, removed: [] };
  const out = {};
  const removed = [];
  for (const [key, val] of Object.entries(spec)) {
    const k = String(key || '').trim();
    if (!k) { removed.push(key); continue; }

    // ① 接口路径：以 / 开头，或含 /xxx/ 形态
    if (/^\//.test(k) || /^[a-z]+:\/\//i.test(k)) { removed.push(key); continue; }

    // ② 请求头集合：字段名不含具体字段语义，而是「一堆头」的统称
    if (/^(?:common)?headers?$|^请求头$|^公共请求头$|^requestHeaders$/i.test(k)) { removed.push(key); continue; }
    if (/headers?$/i.test(k) && !/^[a-z]*(?:id|code|token|key)$/i.test(k)) { removed.push(key); continue; }

    // ③ 说明文字：含括号/顿号/「按…计数」「说明」「分区」「完整度」等
    if (/[（(]/u.test(k)) { removed.push(key); continue; }
    if (/说明|分区|统计|口径|完整度|要素|矩阵|清单|备注/.test(k)) { removed.push(key); continue; }

    // ④ 过长且含空格/标点的，是句子不是字段名
    if (k.length > 24 && /[\s、，,。；;]/.test(k)) { removed.push(key); continue; }

    out[key] = val;
  }
  // 全被剔光时不要返回空 spec，让调用方走 designInput / 提示路径
  return { spec: out, removed };
}

/**
 * 从 params.fields 构建结构化 inputSpec
 * @param {Array<{name,type,min,max,minLength,maxLength,values}>} fields
 * @returns {Object} inputSpec
 */
function buildInputSpecFromFields(fields) {  const spec = {};
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
  // 过滤掉「不是字段」的键（2026-11-26）
  //
  // 模型传 inputSpec 时常把接口路径、请求头集合、统计说明当成字段：
  // 实测任务 26a56e33 的交付物里出现
  //   「等价类-/custody/validate-长度合法」 输入是 /custody/validate=""
  //   「等价类-commonHeaders-长度合法」     输入是 commonHeaders="abcdefg..."
  // 这些不是可测字段，按「长度」展开后 183 条用例全部不可执行，
  // 审核判 6 个 blocker 一票否决（「把接口路径当作可变字段做等价类与边界值」）。
  const specFilter = filterRealFields(spec);
  spec = specFilter.spec;
  if (specFilter.removed.length) {
    console.warn(`[9dem] inputSpec 剔除 ${specFilter.removed.length} 个非字段键: ${specFilter.removed.join(', ')}`);
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
    // 声明在 if 之外：下面的 return 要用它，放在 if 里会 ReferenceError（实测踩到）
    let derivedInfo = [];
    if (includeDesignCases) {
      const merged = { ...designInput };
      if (!merged.inputSpec && !merged.spec && spec) merged.inputSpec = spec;
      // 字段→接口归属（2026-11-26）：让生成器知道每个字段属于哪个接口，
      // 用例才能落到正确的接口上，而不是一律调第一个。
      if (!merged.fieldEndpointMap && requirementContext && requirementContext.fieldEndpointMap) {
        merged.fieldEndpointMap = requirementContext.fieldEndpointMap;
      }

      // 用需求文本补齐缺失的设计输入（已有的一律不覆盖，只补空）
      try {
        const d = deriveDesignInput(task || '', merged);
        Object.assign(merged, d.input);
        derivedInfo = d.derived;
        if (derivedInfo.length) {
          console.log(`[DesignDerive] 从需求文本推导出: ${derivedInfo.join('、')}`);
        }
      } catch (deriveErr) {
        console.warn(`[DesignDerive] 推导失败(不影响主流程): ${deriveErr.message}`);
      }

      design = executeDesignMethods({ input: merged, methods, dedupe });
    }

    const designStats = design ? design.stats : null;

    // 九维必测点 → 确定性用例（2026-11-09）
    // 过去只有「数据」维是确定性计算的，其余八维只回一段「关注点 + 指引」，模型写不写没人管，
    // 「九维覆盖率」因此只是标注。这里把九维必测点直接展开成可落表用例，
    // 门禁用同一份探针判定，覆盖率成为约束。
    // 注意：无论调用方请求了哪几个维度，必测点一律九维全量——
    // 门禁是按九维判定的，少生成一维就等于少一维无法通过。
    //
    // 需求上下文（2026-11-26）：探针断言里写死了 code=0 / HTTP 200 / 「6-32 位」，
    // 不看需求实际定义了什么。实测任务 7fd39497：229 行交付物 200 行来自这套模板，
    // 101 行断言 code=0 而需求唯一成功码是 103000，审核判 36 分 + 一票否决。
    // 所以把需求原文一并传进去，让生成器把断言/步骤换成需求里的真值。
    const requirementContext = params.requirementContext && typeof params.requirementContext === 'object'
      ? params.requirementContext
      : null;
    const dimensionGen = includeDimensionCases
      ? generateDimensionCases({
        task,
        module: options.module || options.target,
        inputSpec: spec,
        maxPerDimension: options.maxPerDimension,
        requirementContext,
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

    // 组合数口径（2026-11-20 按用户口径修正）：
    //   - 「要不要压缩」由 executor.js 的 PAIRWISE_ENUMERATION_LIMIT = 65536 决定
    //     （全组合 ≤65536 全枚举，超过才走 2-wise 贪心）。这条**不许动**。
    //   - 这里只处理「塞进 LLM 上下文太大」的问题，与上面的压缩口径无关。
    //     早先写成 200，等于把 65536 以内本该全枚举的组合又砍回 200 条，
    //     与既定口径冲突（用户指出）。
    //
    // 现在的分层做法：
    //   - 全量 pairwise 明细**不进** LLM messages（否则 8 字段就有 12MB，撑爆上下文）；
    //   - 但也不丢：随工具结果完整返回给调用方（服务端内存里有），
    //     需要明细时由系统直接用它生成用例，不经过模型；
    //   - 给模型的是 meta（总数/模式/因子数），足够它写「组合覆盖」说明。
    const PAIRWISE_OUTPUT_LIMIT = Number(process.env.NINEDEM_PAIRWISE_OUTPUT_LIMIT) || 65536;
    // 进 LLM 上下文的明细条数上限（只是为了让模型看到样例，不是业务口径）
    const PAIRWISE_PROMPT_SAMPLE = Number(process.env.NINEDEM_PAIRWISE_PROMPT_SAMPLE) || 50;
    // 全量明细（不进 prompt，供服务端生成用例用）
    const pairwiseFull = Array.isArray(pairwise) ? pairwise : [];

    function capPairwise(container) {
      const arr = container && container.pairwise;
      if (!Array.isArray(arr) || arr.length <= PAIRWISE_PROMPT_SAMPLE) return container;
      // 给模型的只是样例；真实条数写在 meta 里，避免模型误判「总共就这么多」
      const capped = arr.slice(0, PAIRWISE_PROMPT_SAMPLE);
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
      pairwiseMeta.outputLimit = PAIRWISE_PROMPT_SAMPLE;
      pairwiseMeta.outputTruncated = (pairwise?.length || 0) > PAIRWISE_PROMPT_SAMPLE;
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
        derivedDesignInput: derivedInfo,
        designUniqueCases: designStats ? designStats.uniqueCases : 0,
        designDuplicatesRemoved: designStats ? designStats.duplicatesRemoved : 0,
        dimensionProbeCount: dimensionGen.stats.total,
        dimensionCoveredCount: dimensionGen.stats.dimensionCount,
        dimensionCasesByDimension: dimensionGen.stats.byDimension,
        totalDeterministicCases: (designStats ? designStats.uniqueCases : 0) + dimensionGen.stats.total,
      },
      design,
      // 全量组合明细：供服务端确定性生成用例，不随 prompt 下发（体积可能很大）
      pairwiseFull,
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
  buildInputSpecFromFields,
  filterRealFields,
};
