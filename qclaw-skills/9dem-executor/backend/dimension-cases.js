'use strict';

/**
 * 九维必测点 → 确定性用例（2026-11-09）
 *
 * 背景：九维里只有「数据」维是确定性计算的，其余八维过去只给模型一段
 * 「关注点 + 指引」，「九维覆盖率」因此只是一个标注而不是约束。
 *
 * 这里把 dimension-probes.js 里每个维度的必测点直接展开成**可落表的用例**：
 *   - 执行步骤和预期结果都是写死的（含状态码、字段名、可观测证据），不靠模型编；
 *   - 维度 / 层级 / 设计方法三项标注齐全，能通过门禁的维度列检查；
 *   - 门禁用同一份探针关键词判定交付物是否真的覆盖了这些点。
 *
 * 生成侧与判定侧共用同一份矩阵 → 覆盖率从「标注」变成「约束」。
 */

const { DIMENSION_MATRIX } = require('./dimension-probes');
const { deriveRequirementContext } = require('./requirement-context');

/** 维度的默认设计方法（与矩阵里的 method 一致，缺省时兜底） */
const DIMENSION_METHOD = {
  user: '场景法+错误推测法',
  data: '等价类划分法+边界值分析法+错误推测法',
  process: '场景法+状态迁移法',
  operation: '功能图法+错误推测法',
  security: '错误推测法',
  performance: '边界值分析法',
  network: '场景法',
  terminal: '场景法',
  compatibility: '正交试验法',
};

/** 维度 → 用例编号前缀，保证生成的编号不与模型用例冲突 */
const DIMENSION_PREFIX = {
  user: 'UD',
  data: 'DD',
  process: 'PD',
  operation: 'OD',
  security: 'SD',
  performance: 'PF',
  network: 'NW',
  terminal: 'TM',
  compatibility: 'CP',
};

/** 从输入里推断被测对象名称（用于把泛化步骤落到具体功能上） */
function inferTarget(params = {}) {
  const raw = params.module || params.target || '';
  if (raw) return String(raw).trim().slice(0, 40);

  const task = String(params.task || '');
  // 别把文档包裹标记当成被测对象名。
  // 实测传进来的需求以「【用户上传的文档内容】=== 附件: xxx.docx ===」开头，
  // 直接取第一行短句会得到「【用户上传的文档内容】」这种噪音。
  const NOISE = /^[【\[（(]|^\s*附件|^\s*===|^\s*#+\s*$|上传的文档|文档内容/;
  const line = task
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && l.length <= 60 && !NOISE.test(l));
  if (line) return line.replace(/^#+\s*/, '').replace(/^[【\[（(]|[】\]）)]$/g, '').slice(0, 40);
  return '被测功能';
}

/**
 * 输入字段名列表（让数据/安全维的用例落到真实字段上）
 *
 * 必须滤掉「不是字段」的键。实测任务 26a56e33：模型把 `/custody/validate`、
 * `commonHeaders` 当字段传进来，于是生成了
 * 「等价类-/custody/validate-长度合法」、输入 `/custody/validate=""` 这种用例，
 * 执行者根本不知道该怎么改一个 URL 路径的"长度"。审核判 blocker。
 * 判据与 design-methods.js 的 isRealFieldName 保持一致。
 */
function inferFields(inputSpec) {
  const spec = inputSpec && typeof inputSpec === 'object' ? inputSpec : {};
  const isRealFieldName = (k) => {
    const s = String(k || '').trim();
    if (!s) return false;
    if (/^\//.test(s) || /^[a-z]+:\/\//i.test(s)) return false;
    if (/^(?:common)?headers?$|^请求头$|^公共请求头$|^requestHeaders$/i.test(s)) return false;
    if (/headers?$/i.test(s) && !/^[a-z]*(?:id|code|token|key)$/i.test(s)) return false;
    if (/[（(]/u.test(s)) return false;
    if (/说明|分区|统计|口径|完整度|要素|矩阵|清单|备注/.test(s)) return false;
    if (s.length > 24 && /[\s、，,。；;]/.test(s)) return false;
    return true;
  };
  return Object.keys(spec)
    .filter((k) => k && k !== 'requirement' && isRealFieldName(k))
    .slice(0, 3);
}

/** 按字段规格给一个真实值（避免生成「按探针要求构造」这类占位描述） */
function sampleValue(name, spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  if (s.type === 'number') {
    const min = Number.isFinite(s.min) ? s.min : 1;
    return String(min + 1);
  }
  if (s.type === 'enum') return String((s.values && s.values[0]) || 'default');
  if (/手机|phone|mobile/i.test(name)) return '13800138000';
  if (/邮箱|email|mail/i.test(name)) return 'tester@example.com';
  if (/密码|password|pwd/i.test(name)) return 'Abc12345';
  return `sample_${String(name).replace(/[^\w]/g, '')}`;
}

/** 数据类维度才把真实字段值写进「输入数据」；其余维度由步骤承载构造条件 */
const FIELD_DRIVEN_DIMENSIONS = new Set(['data', 'security']);

function normalizeLayer(layer, requiredLayers) {
  if (layer) return layer;
  return requiredLayers[requiredLayers.length - 1] || '异常';
}

/**
 * 用需求上下文改写探针断言（2026-11-26）
 *
 * 探针断言是通用模板，里面写死了 `code=0`、`HTTP 200`、`400`、
 * 「长度需在 6-32 位之间」。这些值对任何需求都一样，所以必然与真实需求冲突 ——
 * 实测托管系统需求的成功码是 103000，模板却全表写 code=0，
 * 229 行交付物里 200 行来自模板，审核判 36 分 + 一票否决。
 *
 * 改法：需求里查得到就换成真值；查不到就**降级成中性表述**，绝不填默认值。
 * 这是与「禁止套用行业默认值」同一条原则在生成端的落地。
 *
 * @param {string} assertion - 探针原始断言
 * @param {Object} ctx - deriveRequirementContext 的返回值
 * @returns {string} 改写后的断言
 */
function adaptAssertion(assertion, ctx) {
  let out = String(assertion || '');
  if (!out) return out;

  const success = ctx && ctx.successCode;
  const errorCodes = (ctx && ctx.errorCodes) || [];
  const endpoints = (ctx && ctx.endpoints) || [];
  const httpCodes = (ctx && ctx.httpCodes) || [];

  // ① 业务成功码：需求有 → 用真值；没有 → 去掉具体值
  //
  // `code=0` 是最恶劣的一个：它有 101 条用例受影响，而且看起来像是
  // 「行业惯例所以肯定对」。需求定义了自己的码表时，它就是错的。
  if (/code\s*=\s*0|code=0|业务成功码\s*code\s*=\s*0/i.test(out)) {
    if (success && success.code) {
      // 需求里那个字段叫什么就写什么；提不出字段名时写「业务成功码 103000」
      const spelled = success.field && success.field !== '业务成功码'
        ? `${success.field}=${success.code}`
        : `业务成功码 ${success.code}`;
      // 先把「业务成功码 code=0」整体换掉，再处理剩下的裸 code=0。
      // 顺序反了会留下「业务成功码 业务成功码=103000」（实测踩到）。
      if (/业务成功码\s*code\s*=\s*0/i.test(out)) {
        out = out.replace(/业务成功码\s*code\s*=\s*0/gi, spelled);
      } else {
        out = out.replace(/code\s*=\s*0/gi, spelled);
      }
      // 「响应体 code=0」会变成「响应体 resultcode=103000」，补个逗号更顺；
      // 但「响应体，业务成功码 103000」这种没字段名的读着别扭，不加逗号
      out = out.replace(/(响应体)\s+(result_?code=|code=)/gi, '$1，$2');
    } else {
      // 需求没定义成功码：不能编一个，只能说「返回业务成功码」
      out = out.replace(/业务成功码\s*code\s*=\s*0/gi, '返回业务成功码');
      out = out.replace(/响应体\s*code\s*=\s*0/gi, '响应体返回业务成功码');
      out = out.replace(/code\s*=\s*0/gi, '业务成功码');
    }
  }

  // ② 「长度需在 6-32 位之间」这种具体数值：需求没写就不能出现在断言里
  const rangeHint = out.match(/长度需在\s*(\d+)\s*[-~]\s*(\d+)\s*位之间/);
  if (rangeHint) {
    const cons = (ctx && ctx.fieldConstraints) || [];
    const hit = cons.find((c) => c.min === Number(rangeHint[1]) && c.max === Number(rangeHint[2]));
    if (!hit) {
      out = out.replace(rangeHint[0], '提示长度不符合要求（具体区间以需求为准）');
    }
  }

  // ③ 异常输入「返回 400」：需求定义了业务错误码就用错误码，否则保留 400
  //
  // 这里保留 HTTP 400 是有意的：HTTP 状态码是协议层事实，不像业务码那样
  // 每个系统各不相同。但「返回 400 且响应体含 INVALID_FORMAT」里的
  // 业务错误码常量是编的，要换掉。
  if (/INVALID_FORMAT|INVALID_PARAM|DUPLICATE_SUBMIT/.test(out)) {
    if (errorCodes.length) {
      out = out.replace(/INVALID_FORMAT|INVALID_PARAM|DUPLICATE_SUBMIT/g, errorCodes[0]);
    } else {
      out = out.replace(/，?\s*响应体含错误码\s*(?:INVALID_FORMAT|INVALID_PARAM|DUPLICATE_SUBMIT)\s*与字段名/gi, '，响应体给出错误说明与字段名');
      out = out.replace(/响应体含错误码\s*(?:INVALID_FORMAT|INVALID_PARAM|DUPLICATE_SUBMIT)/gi, '响应体给出错误说明');
    }
  }

  // ④ 需求里连 HTTP 状态码都没写时，「返回 200」降级为「请求成功」
  if (!httpCodes.length) {
    out = out.replace(/接口返回\s*HTTP\s*200/gi, '接口返回成功状态');
    out = out.replace(/均返回\s*200/gi, '均返回成功状态');
    out = out.replace(/写操作返回\s*200/gi, '写操作成功');
    out = out.replace(/返回\s*200\s*或\s*400/gi, '返回成功或错误状态');
    out = out.replace(/返回\s*200(?=[；，。])/gi, '返回成功状态');
  }

  // ⑤ 写死的终态（「已完成」/completed、approved/rejected）也要对需求核实  //
  // 探针里的终态是通用流程假设。托管系统这类接口没有「已完成」这个状态，
  // 照抄就成了需求外的编造。需求里查不到就降级为中性表述。
  const stateValues = (ctx && ctx.stateValues) || [];
  const hasStateMachine = stateValues.length >= 2;
  if (hasStateMachine) {
    // 需求有状态机 → 用需求里最后出现的那个状态作为终态
    const finalState = stateValues[stateValues.length - 1];
    out = out.replace(/状态变为「已完成」/g, `状态变为「${finalState}」`);
    out = out.replace(/状态字段值为\s*completed/g, '状态字段值与需求定义一致');
  } else {
    // 需求没有状态机描述 → 不能断言具体状态
    out = out.replace(/状态变为「已完成」/g, '状态变更为需求定义的目标状态');
    out = out.replace(/状态字段值为\s*completed/g, '状态字段值与需求定义一致');
  }
  // approved/rejected 是探针里的英文常量名，与需求状态机无关，一律降级
  out = out.replace(/（状态字段分别为\s*approved\s*与\s*rejected）/g, '（状态字段分别为需求定义的两个分支取值）');
  out = out.replace(/状态字段分别为\s*approved\s*与\s*rejected/g, '状态字段分别为需求定义的两个分支取值');

  return out;
}

/**
 * 用需求上下文改写执行步骤
 *
 * 模板步骤是「触发对应操作并观察接口响应与页面反馈」——196 条全一样，
 * 没有任何可执行信息。审核原话是「步骤不可照做」。
 *
 * 有接口定义就落到具体接口上；没有就把动作本身说清楚，不再用「触发对应操作」。
 */
function adaptSteps(steps, probe, ctx, target) {
  let out = String(steps || '');
  const endpoints = (ctx && ctx.endpoints) || [];

  if (!endpoints.length && !/触发对应操作/.test(out)) return out;

  // 挑一个与该探针语义最相关的真实接口
  const ep = endpoints.length ? pickEndpointForProbe(probe, endpoints) : null;
  const call = ep ? `${ep.method ? ep.method + ' ' : ''}${ep.path}` : '';
  // 通用兜底句：无论探针原句怎么措辞，都把「观察接口响应」落到真实接口上
  if (/观察接口响应与页面反馈/.test(out)) {
    out = out.replace(
      /观察接口响应与页面反馈/g,
      call ? `记录 ${call} 的响应体与时序` : '记录接口响应体与时序',
    );
  }
  if (/触发对应操作/.test(out)) {
    out = out.replace(
      /触发对应操作并观察接口响应与页面反馈/g,
      call ? `调用 ${call} 并记录响应体` : `执行 ${target || '被测功能'} 的对应操作并记录响应`,
    );
    // 单独出现的「触发对应操作」（后面没跟「并观察…」）
    out = out.replace(
      /触发对应操作/g,
      call ? `调用 ${call}` : `执行 ${target || '被测功能'} 的对应操作`,
    );
  }
  return out;
}

/** 按探针语义挑一个最相关的接口（都挑不到就返回第一个真实接口） */
function pickEndpointForProbe(probe, endpoints) {
  const text = `${probe.title || ''} ${probe.action || ''}`;
  const byKeyword = [
    { re: /登录|授权|认证|凭证/, prefer: /auth|login|token|oauth/i },
    { re: /短信|验证码/, prefer: /sms|code|captcha/i },
    { re: /用户信息|资料/, prefer: /user|info|profile/i },
    { re: /解绑|绑定/, prefer: /bind|unbind/i },
    { re: /校验|验证/, prefer: /validate|verify|check/i },
  ];
  for (const k of byKeyword) {
    if (k.re.test(text)) {
      const hit = endpoints.find((e) => k.prefer.test(e.path));
      if (hit) return hit;
    }
  }
  return endpoints[0];
}

/**
 * 按「用例名/输入里点名的接口或字段」挑接口（2026-11-26）
 *
 * 两层判据，从强到弱：
 *   ① 用例文本里直接出现的接口路径 —— 最可靠；
 *   ② 用例文本里的字段名经 fieldEndpointMap 反查所属接口 ——
 *      用例名说的是字段（「等价类-creditToken-长度合法」），不含接口名，
 *      但 creditToken 属于 /custody/validate，靠需求里的字段归属能反查出来。
 *
 * 为什么必须这么做：九维探针标题都是通用描述，只按探针语义匹配会全部落到
 * endpoints[0]。实测任务 26a56e33：183 条用例的步骤**一律**写「调用 /custody/preAuth」，
 * 而用例名说的是 validate/getUserInfo/smsSend/unbinding，
 * 审核判 blocker「步骤与用例名所述接口不符，断言无法验证被测接口」。
 */
function pickEndpointForCase(caseText, endpoints, fallback, fieldEndpointMap) {
  if (!endpoints.length) return null;
  const text = String(caseText || '');
  if (!text) return fallback || endpoints[0];

  // ① 用例文本里直接出现的接口路径
  for (const ep of endpoints) {
    if (text.includes(ep.path)) return ep;
  }
  // ①' 接口末段名（validate / smsSend）出现在用例文本里
  for (const ep of endpoints) {
    const seg = ep.path.split('/').filter(Boolean).pop();
    if (seg && seg.length >= 3 && new RegExp(`\\b${seg}\\b`, 'i').test(text)) return ep;
  }
  // ② 字段名反查所属接口
  const map = fieldEndpointMap && typeof fieldEndpointMap === 'object' ? fieldEndpointMap : {};
  for (const [field, ep] of Object.entries(map)) {
    if (!field || field.length < 3) continue;
    if (new RegExp(`\\b${field}\\b`, 'i').test(text)) {
      // 需求里记的接口必须在当前接口清单里（避免拿到别处的陈旧项）
      const hit = endpoints.find((e) => e.path === ep.path);
      if (hit) return hit;
    }
  }
  return fallback || endpoints[0];
}

/**
 * 生成九维必测点用例
 *
 * @param {Object} [params]
 * @param {string} [params.task] - 需求/场景文本（用于推断被测对象 + 提取需求上下文）
 * @param {string} [params.module] - 模块名（优先）
 * @param {Object} [params.inputSpec] - 字段规格（用于把探针落到真实字段）
 * @param {Object} [params.requirementContext] - 已提取的需求上下文（缺省时从 task 现提）
 * @param {string[]} [params.dimensions] - 只生成这些维度，缺省=九维全量
 * @param {number} [params.maxPerDimension=8] - 每维最多生成几条（保护输出体积）
 * @returns {{cases:Array, checklist:Array, stats:Object}}
 */
function generateDimensionCases(params = {}) {
  const target = inferTarget(params);
  const spec = params.inputSpec && typeof params.inputSpec === 'object' ? params.inputSpec : {};
  const fields = inferFields(spec);
  const wanted = Array.isArray(params.dimensions) && params.dimensions.length
    ? params.dimensions
    : DIMENSION_MATRIX.map((d) => d.key);
  const maxPerDimension = Number(params.maxPerDimension) > 0 ? Number(params.maxPerDimension) : 8;

  // 需求上下文（2026-11-26）：探针断言里写死的 code=0 / 200 / 6-32 位
  // 必须换成需求里查到的真值；查不到就降级，不许用行业默认值兜底。
  const reqCtx = params.requirementContext && typeof params.requirementContext === 'object'
    ? params.requirementContext
    : deriveRequirementContext(params.task || '');

  // 数据/安全维把输入落到真实字段上；其余维度不给「输入数据」，
  // 由执行步骤描述构造条件——否则会出现「输入=按探针要求构造」这种占位描述被门禁判为不合格。
  const fieldInput = fields.length
    ? fields.map((f) => `${f}=${sampleValue(f, spec[f])}`).join(', ')
    : '';

  const cases = [];
  const checklist = [];

  for (const dim of DIMENSION_MATRIX) {
    if (!wanted.includes(dim.key)) continue;

    const method = dim.method || DIMENSION_METHOD[dim.key] || '错误推测法';
    const prefix = DIMENSION_PREFIX[dim.key] || 'DC';
    const probes = dim.probes.slice(0, maxPerDimension);
    const useFields = FIELD_DRIVEN_DIMENSIONS.has(dim.key);

    probes.forEach((p, idx) => {
      const layer = normalizeLayer(p.layer, dim.requiredLayers);
      const seq = String(idx + 1).padStart(3, '0');

      // 把泛化的「该功能」替换成真实被测对象
      const action = p.action.split('该功能').join(target || '被测功能');

      const rawSteps = `1. ${action}\n2. 观察接口响应与页面反馈\n3. 核对数据库/日志中的落库结果`;

      cases.push({
        id: `${prefix}-${seq}`,
        method: 'dimensionProbe',
        methodKey: `D-${p.id}`,
        methodLabel: method,
        name: `${dim.label.replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, '')}-${p.title}`,
        dimension: `${dim.label} / ${method}`,
        layer,
        precondition: `系统已部署，${target || '被测功能'} 可访问；已准备测试账号与基础业务数据`,
        input: useFields ? fieldInput : '无特定输入（按执行步骤构造条件）',
        // 断言与步骤都要过需求上下文（2026-11-26）：
        // 断言里的 code=0/200/6-32 位换成需求真值，步骤里的「触发对应操作」落到真实接口
        steps: adaptSteps(rawSteps, p, reqCtx, target),
        expected: adaptAssertion(p.assertion, reqCtx),
        priority: dim.weight >= 2 ? '高' : '中',
        trace: `九维必测点 ${p.id}`,
        probeId: p.id,
      });

      checklist.push({
        dimension: dim.key,
        label: dim.label,
        probeId: p.id,
        caseId: `${prefix}-${seq}`,
        layer,
        title: p.title,
      });
    });
  }

  const byDimension = {};
  for (const c of cases) {
    const key = DIMENSION_MATRIX.find((d) => c.dimension.startsWith(d.label))?.key || 'other';
    byDimension[key] = (byDimension[key] || 0) + 1;
  }

  return {
    cases,
    checklist,
    stats: {
      total: cases.length,
      dimensionCount: Object.keys(byDimension).length,
      byDimension,
      target,
      fields,
    },
  };
}

/**
 * 渲染成「必测清单」文本，供提示词注入
 * 模型需要把这些行原样落进用例清单（可改写业务语言，但不得删减）
 */
function renderChecklist(checklist, options = {}) {
  const maxItems = Number(options.maxItems) > 0 ? Number(options.maxItems) : 60;
  if (!Array.isArray(checklist) || !checklist.length) return '';
  const lines = ['【九维必测清单（确定性生成，必须全部落入用例清单；可按业务语言改写名称与步骤，不得删减、不得改判定结论）】'];
  lines.push('| 建议编号 | 维度 | 层级 | 必测点 |');
  lines.push('| --- | --- | --- | --- |');
  for (const item of checklist.slice(0, maxItems)) {
    lines.push(`| ${item.caseId} | ${item.label} | ${item.layer} | ${item.title} |`);
  }
  if (checklist.length > maxItems) {
    lines.push(`| … | … | … | 其余 ${checklist.length - maxItems} 个必测点见工具返回的 dimensionCases |`);
  }
  return lines.join('\n');
}

module.exports = {
  generateDimensionCases,
  renderChecklist,
  adaptAssertion,
  adaptSteps,
  pickEndpointForCase,
  DIMENSION_METHOD,
  DIMENSION_PREFIX,
};
