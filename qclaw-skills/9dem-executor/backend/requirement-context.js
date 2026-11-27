'use strict';

/**
 * 需求上下文提取（2026-11-26）
 *
 * 背景：九维必测点用例过去是「凭空展开」的 —— 42 个探针的断言里写死
 * `code=0`、`HTTP 200`、`400`、「长度需在 6-32 位之间」，完全不看需求实际定义了什么。
 *
 * 实测代价（任务 7fd39497）：229 行交付物里 200 行来自这套模板，
 *   · 101 行断言 code=0，而需求唯一成功码是 103000
 *   · 196 行步骤写「触发对应操作并观察接口响应」，无法照做
 *   · 37 处 0~255 长度，需求从未提及
 * 审核判 36 分 + 一票否决，理由是「系统检查仅核结构」。
 *
 * 修法：把断言里的这些值变成**从需求里查到的**值；查不到就不写具体值，
 * 改成中性的可观测表述（例如「返回业务成功码」而不是「返回 code=0」）。
 * 绝不用行业默认值兜底 —— 那正是要根治的毛病。
 */

/** 需求里出现过的 HTTP 状态码（白名单，避免把版本号/年份当状态码） */
const HTTP_CODES = [200, 201, 202, 204, 400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503, 504];

/**
 * 从需求文本里提取业务成功码
 *
 * 实测形态：
 *   · `resultcode="103000"`              ← 引号包裹，最常见
 *   · `resultCode=“103000”`              ← 中文引号
 *   · `resultcode=103000`
 *   · `成功码 103000` / `成功码为 103000`
 *   · `原文 resultcode=“103000”、resultDesc=“成功”`
 *
 * @returns {{ code:string, field:string }|null} 找不到返回 null，调用方必须走降级
 */
function extractSuccessCode(text) {
  const src = String(text || '');
  if (!src) return null;

  // 明确写了「成功码」的，优先级最高：它一定是业务码
  const labeled = src.match(/(?:成功码|成功返回码|成功\s*code|业务成功码)[^\d]{0,12}(\d{3,8})/i);
  if (labeled) return { code: labeled[1], field: '业务成功码' };

  // resultcode / resultCode / code 后面跟数字（引号可有可无）
  // 只认 4 位以上：3 位多半是 HTTP 状态码或行内编号
  const candidates = [];
  const re = /(?:result_?code|resultCode|statusCode|\bcode)\s*[=:：]\s*["“'']?(\d{3,8})["”'']?/gi;
  for (const m of src.matchAll(re)) {
    const v = Number(m[1]);
    if (!Number.isFinite(v)) continue;
    // 排除 HTTP 状态码（它们确实会以 code=200 的形式出现在文档里）
    if (HTTP_CODES.includes(v)) continue;
    candidates.push({ code: m[1], raw: m[0] });
  }
  if (!candidates.length) return null;

  // 同一个值出现多次 → 很可能就是全局成功码
  const freq = new Map();
  for (const c of candidates) freq.set(c.code, (freq.get(c.code) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];

  // 只有 1 个候选且只出现 1 次时也接受：需求只定义了一个码
  const fieldMatch = top && candidates.find((c) => c.code === top[0]);
  const fieldName = fieldMatch
    ? (/result_?code/i.test(fieldMatch.raw) ? 'resultcode' : 'code')
    : '业务成功码';
  return { code: top[0], field: fieldName };
}

/**
 * 提取失败时的错误码（用于「异常输入应被拒绝」类断言）
 *
 * 需求常写「返回 103308」「错误码 130059」这类。找不到就返回空数组，
 * 断言改用「返回非成功码 / 业务错误码」这种中性表述。
 */
function extractErrorCodes(text) {
  const src = String(text || '');
  const codes = new Set();
  for (const m of src.matchAll(/(?:错误码|失败码|返回码|响应码)\s*[=:：是为]?\s*["“'']?(\d{3,8})/gi)) {
    const v = Number(m[1]);
    if (!HTTP_CODES.includes(v)) codes.add(m[1]);
  }
  // 码表写法：`103308＝手机号不合法`、`103008＝「手机号不合法」`
  // 全角/半角等号都算，等号后面可以是中文（实测需求里不带引号）
  for (const m of src.matchAll(/(\d{4,8})\s*[=＝]\s*[「“"\u4e00-\u9fa5]/g)) {
    const v = Number(m[1]);
    if (!HTTP_CODES.includes(v)) codes.add(m[1]);
  }
  // 「原文码表 103308」「码表 130059」「原文 130059」「错误 103308」
  // 「原文」和数字之间可能有空格，用 \s* 但要限定前缀，避免抓到普通数字
  for (const m of src.matchAll(/(?:码表|错误|失败|异常|原文)\s*(\d{4,8})/g)) {
    const v = Number(m[1]);
    if (!HTTP_CODES.includes(v)) codes.add(m[1]);
  }
  return [...codes].filter((c) => c.length >= 4).slice(0, 12);
}

/**
 * 提取需求里出现的 HTTP 状态码
 *
 * 只认明确写成「HTTP 200」「状态码 403」的，不认随便出现的数字。
 */
function extractHttpCodes(text) {
  const src = String(text || '');
  const found = new Set();
  for (const m of src.matchAll(/(?:HTTP|http|状态码|StatusCode|status)\s*[=:：\s]\s*(\d{3})/g)) {
    if (HTTP_CODES.includes(Number(m[1]))) found.add(Number(m[1]));
  }
  return [...found].sort();
}

/**
 * 提取接口定义（路径 + 方法）
 *
 * 实测形态：`POST /custody/preAuth`、`/custody/validate`、`GET /api/v1/order`
 */
function extractEndpoints(text) {
  const src = String(text || '');
  const eps = [];
  const seen = new Set();
  const re = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[\w\-./{}$:]+)/gi;
  for (const m of src.matchAll(re)) {
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    eps.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  // 只有路径没有方法的（需求里常这么写）
  for (const m of src.matchAll(/[（(\s`"「](\/[\w\-]+\/[\w\-./{}$:]+)/g)) {
    const p = m[2] || m[1];
    if (!p || seen.has(p)) continue;
    if (eps.some((e) => e.path === p)) continue;
    // 过滤掉明显不是接口路径的（如 / 分隔的普通文本）
    if (!/^\/[a-z][\w\-]*\//i.test(p)) continue;
    seen.add(p);
    eps.push({ method: '', path: p });
  }
  return eps.slice(0, 20);
}

/**
 * 提取状态机的状态取值
 *
 * 实测形态：「待处理 → 处理中 → 已解决」、「状态变为『已完成』」
 *
 * 两轮收紧（都踩过）：
 *   ① 只按「中文词 + 箭头」抓，把「业务服务端→IDaaS」「否则…」
 *      这类流程叙述当成了状态值（7fd39497 抓到 8 个全是噪声）；
 *   ② 再按「状态 X」抓，又把「timestamp 防重放：重放请求拒绝 状态 重放判定」
 *      这种**约束条目里的名词**抓了进来（同一份需求）。
 *
 * 所以判据改为：状态词必须自身以状态前缀开头（待/已/未/处理中…），
 * 或者明确是箭头序列的一环。宁可返回空数组（调用方会降级成中性表述），
 * 也不要拿噪声去替换断言 —— 替换错了比不替换更糟。
 */
function extractStateValues(text) {
  const src = String(text || '');
  const vals = new Set();

  // 状态词前缀白名单。不在这个表里的词一律不当状态
  const STATE_PREFIX = /^(?:待|已|未|正在|处理中|进行中|完成|关闭|取消|驳回|通过|审核中|复核中|草稿|新建|已提交|提交中|支付中|已支付|发货|已发货|收货|已收货|退款|已退款|归档|已归档|失效|已失效|激活|已激活|锁定|已锁定|解绑|已解绑|绑定|已绑定|授权|已授权|冻结|已冻结|上线|已上线|下线|已下线)/;

  const isStateWord = (v) => {
    if (!v) return false;
    const s = v.trim();
    if (s.length < 2 || s.length > 8) return false;
    if (/(?:服务端|客户端|系统|平台|用户|接口|页面|IDaaS|否则|上述|如下|判定|约束|字段|枚举)/.test(s)) return false;
    return STATE_PREFIX.test(s);
  };

  // ① 箭头序列：A → B → C，两端都必须是状态词
  const chainRe = /[「“']?([\u4e00-\u9fa5]{2,8})[」”']?\s*(?:→|->|=>)\s*[「“']?([\u4e00-\u9fa5]{2,8})[」”']?/g;
  for (const m of src.matchAll(chainRe)) {
    if (isStateWord(m[1])) vals.add(m[1].trim());
    if (isStateWord(m[2])) vals.add(m[2].trim());
  }

  // ② 中文流程叙述：「提交后为待处理，领取后变为处理中，完成变为已解决」
  //
  // 这类需求不用箭头，靠「为/变为/转为」串起状态。
  // 两端都取，且必须都是状态词 —— 只取变化后的值会漏掉起始态（如「待处理」）。
  const verbRe = /[「“']?([\u4e00-\u9fa5]{2,8})[」”']?\s*(?:后|时|之后)?\s*(?:变为|变成|转为|置为|更新为|为)\s*[「“']?([\u4e00-\u9fa5]{2,8})[」”']?/g;
  for (const m of src.matchAll(verbRe)) {
    if (isStateWord(m[1])) vals.add(m[1].trim());
    if (isStateWord(m[2])) vals.add(m[2].trim());
  }

  // ③ 「状态变为X」「状态流转到X」——动词必须是变更语义
  for (const m of src.matchAll(/状态(?:值|字段)?\s*(?:变为|变成|转为|流转到|更新为)\s*[「“']?([\w\u4e00-\u9fa5]{2,10})[」”']?/g)) {
    const v = m[1].trim();
    if (v.length >= 2 && v.length <= 10) vals.add(v);
  }

  // ④ 英文状态常量（需求里直接用英文枚举时）
  for (const m of src.matchAll(/\b(pending|processing|in_progress|completed|approved|rejected|failed|cancelled|canceled|open|closed|resolved|paid|shipped)\b/gi)) {
    vals.add(m[1].toLowerCase());
  }

  // 至少要凑出一个「链条」才算这份需求真有状态机：
  // 只有 1 个孤立的词时，多半是从某句话里误抓的，不足以支撑替换断言。
  return vals.size >= 2 ? [...vals].slice(0, 12) : [];
}

/**
 * 提取字段的长度/取值范围约束
 *
 * 只认需求里**明确写了**的，例如「最长 64 位」「1-100 字符」「不超过 200」。
 * 没写就返回空 —— 调用方不得自己补一个默认值。
 */
function extractFieldConstraints(text) {
  const src = String(text || '');
  const out = [];
  // 「clawUid 最长 64 位」「标题 1-100 字符」「最多 200 字符」
  for (const m of src.matchAll(/([\w\u4e00-\u9fa5]{2,20})\s*[^。；\n]{0,10}?(?:最长|最多|不超过|上限|长度)\s*(?:为|是|：|:)?\s*(\d{1,6})\s*(?:个)?\s*(?:字符|字节|位)?/g)) {
    const n = Number(m[2]);
    if (n > 0 && n < 1000000) out.push({ field: m[1].trim(), max: n });
  }
  // 「1-100 字符」「6~32 位」
  for (const m of src.matchAll(/([\w\u4e00-\u9fa5]{2,20})\s*[^。；\n]{0,10}?(\d{1,6})\s*[-~～]\s*(\d{1,6})\s*(?:个)?\s*(?:字符|字节|位)/g)) {
    const lo = Number(m[2]);
    const hi = Number(m[3]);
    if (lo > 0 && hi > lo && hi < 1000000) out.push({ field: m[1].trim(), min: lo, max: hi });
  }
  return out.slice(0, 20);
}

/**
 * 提取「字段 → 所属接口」的映射
 *
 * 用例名说的是字段（如「等价类-creditToken-长度合法」），不含接口名。
 * 光按用例名匹配接口必然匹配不到，全部落到第一个接口 —— 实测任务 26a56e33
 * 就是 183 条用例的步骤**一律**写「调用 /custody/preAuth」，
 * 而 creditToken 属于 validate、loginName 属于 smsSend。
 *
 * 做法：找出每个接口定义所在的那一行/那一段，把它附近的字段名记到该接口名下。
 * 只在需求确实写了「某接口用哪些字段」时才有结果，猜不到就返回空。
 *
 * @returns {Object} 字段名 → {method, path}
 */
function extractFieldEndpointMap(text) {
  const src = String(text || '');
  const map = {};
  if (!src) return map;

  // 逐行扫：一行里既有接口路径、又有「必填/选填 字段列表」的，建立归属
  for (const line of src.split(/\r?\n/)) {
    const epMatch = line.match(/(GET|POST|PUT|PATCH|DELETE)?\s*(\/[\w\-]+\/[\w\-./{}$:]+)/i);
    if (!epMatch) continue;
    const ep = {
      method: (epMatch[1] || '').toUpperCase(),
      path: epMatch[2],
    };

    // 该行里的字段名：中文/英文标识符，出现在「必填」「选填」「Body」「参数」附近
    const fieldPart = line.match(/(?:必填|选填|Body|参数|请求头|headers?)[:：]?\s*([^|。；\n]{2,200})/i);
    const scope = fieldPart ? fieldPart[1] : line;
    for (const m of scope.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]{2,30})\b/g)) {
      const name = m[1];
      // 过滤掉中文语境里的普通英文单词与接口自身片段
      if (/^(?:http|https|json|body|post|get|put|delete|true|false|null|string|number)$/i.test(name)) continue;
      if (ep.path.includes(`/${name}`)) continue;
      if (!map[name]) map[name] = ep;
    }
  }
  return map;
}

/**
 * 判断需求描述的被测对象有没有「可测的 UI」
 *
 * 不能只看有没有「页面」二字。实测托管系统需求里有 14 处页面/H5/浏览器，
 * 但全是「H5 页面仅做流程状态与页面跳转结果验证，不做 UI 视觉与适配性验证」——
 * 据此判 hasUI=true，就会生成「页面加载返回 200、按钮可见可点击、控制台无 JS 报错」
 * 这类与接口无关的断言（审核判「与 preAuth 接口无关」）。
 *
 * 判据：必须出现**UI 动作词**（按钮/点击/输入框/表单/弹窗/下拉/勾选），
 * 或者在明确否定 UI 之外、UI 名词出现得足够多（≥3 次且没有「不做 UI」声明）。
 */
function detectHasUI(text) {
  const t = String(text || '');
  if (!t) return false;
  // 需求明说不做 UI，直接判无 UI
  if (/不做\s*(?:UI|视觉|适配|前端)|无前端|不含前端|仅以\s*URL|仅做流程状态/.test(t)) return false;
  // 有真实 UI 动作 → 一定是 UI 系统
  if (/按钮|点击|输入框|表单|弹窗|下拉|勾选|菜单项|悬浮|拖拽/.test(t)) return true;

  // 只有 UI 名词、没有动作词的，看有没有接口定义：
  // 接口文档里「页面」「H5」会大量出现（授权页/H5 页面/页面跳转），
  // 但它们不是被测 UI —— 实测托管系统需求 14 处页面/H5，0 处按钮/点击，
  // 却有 10 个接口，判成有 UI 就会生成「页面元素可见」这种无关断言。
  const uiNouns = (t.match(/页面|浏览器|前端|H5|控制台|图标|菜单|布局/g) || []).length;
  if (uiNouns < 3) return false;
  const hasEndpoints = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/|\/[\w-]+\/[\w/-]+/.test(t);
  return !hasEndpoints;
}

/**
 * 一次性提取完整需求上下文
 *
 * @param {string} requirementText - 原始需求文本
 * @returns {Object} 上下文；各字段可能为 null/空数组，调用方必须能处理缺失
 */
function deriveRequirementContext(requirementText) {
  const text = String(requirementText || '');
  const success = extractSuccessCode(text);
  const endpoints = extractEndpoints(text);
  return {
    successCode: success,
    errorCodes: extractErrorCodes(text),
    httpCodes: extractHttpCodes(text),
    endpoints,
    fieldEndpointMap: extractFieldEndpointMap(text),
    hasUI: detectHasUI(text),
    stateValues: extractStateValues(text),
    fieldConstraints: extractFieldConstraints(text),
    // 有没有真正拿到可用的需求上下文（决定模板要不要降级）
    hasAny: !!(success || endpoints.length || extractHttpCodes(text).length),
  };
}

module.exports = {
  deriveRequirementContext,
  detectHasUI,
  extractSuccessCode,
  extractErrorCodes,
  extractHttpCodes,
  extractEndpoints,
  extractFieldEndpointMap,
  extractStateValues,
  extractFieldConstraints,
};
