/**
 * API 直执执行器 —— 免脚本直接执行接口测试
 * ============================================================
 * 背景(为什么需要这个通道):
 *   原有 api-test-tool-invoker 的必填入参是 testScript(Postman 集合 / pytest / RestAssured
 *   脚本路径),导致「接口测试」智能体必须先"造出一个脚本"才能执行测试。
 *   而 dev/生产环境 newman 并未安装,首选工具不可用,链路被迫绕道,脆弱且冗长。
 *
 * 本通道的定位:
 *   不依赖任何外部测试框架(不装 newman / 不写 pytest),由后端直接用 Node 内置 fetch
 *   发出 HTTP 请求并做断言,输出与既有执行器完全一致的 UTRM 结果。
 *   → 智能体可以从"用例文档 / 接口说明 / 用户描述"直接执行,无需先生成脚本交付物。
 *
 * 依赖: 仅 Node 内置能力(>=18 提供全局 fetch)。零 npm 依赖、零外部进程。
 *
 * 输出: UTRM 统一格式(与 ui-test-invoker / api-test-invoker 保持一致)
 *   {
 *     tool, timestamp,
 *     summary: { total, passed, failed, skipped, duration },
 *     testcases: [{ name, classname, status, duration, error, stack, ... }],
 *     exitCode, raw
 *   }
 */

'use strict';

const path = require('path');

// ============================================================
// 意图引擎(Harness 五步的模型侧能力)—— 懒加载,不可用时可降级
// ============================================================

let _engine = null;
function getIntentEngine() {
  if (_engine !== null) return _engine;
  try {
    // __dirname = <root>/qclaw-skills/api-direct-invoker/backend
    _engine = require(path.resolve(__dirname, '..', '..', '..', 'backend', 'llm', 'intent-engine.js'));
  } catch (_) {
    _engine = false;
  }
  return _engine;
}

/** 脱敏:剔除变量中的敏感键,避免凭证随结果落库/展示 */
function sanitizeVars(vars) {
  const out = {};
  for (const [k, v] of Object.entries(vars || {})) {
    if (/pass|pwd|secret|token|cookie|authorization/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function toUTRM(results, tool, exitCode, rawOutput) {
  const { testcases = [], summary = {} } = results;
  return {
    tool,
    timestamp: new Date().toISOString(),
    summary: {
      total: summary.total || testcases.length,
      passed: summary.passed || testcases.filter((t) => t.status === 'passed').length,
      failed: summary.failed || testcases.filter((t) => t.status === 'failed').length,
      skipped: summary.skipped || testcases.filter((t) => t.status === 'skipped').length,
      duration: summary.duration || testcases.reduce((s, t) => s + (t.duration || 0), 0),
    },
    testcases,
    exitCode: exitCode || 0,
    raw: rawOutput || null,
  };
}

// ============================================================
// 工具函数
// ============================================================

/** 按点路径取值: data.token / items[0].id / header:Content-Type */
function getByPath(obj, p) {
  if (obj == null || !p) return undefined;
  const s = String(p).trim();
  // 支持 header:xxx / headers.xxx 前缀
  if (/^headers?[.:]/i.test(s)) {
    const key = s.replace(/^headers?[.:]/i, '');
    if (!obj || !obj.headers) return undefined;
    const lower = key.toLowerCase();
    for (const k of Object.keys(obj.headers)) {
      if (k.toLowerCase() === lower) return obj.headers[k];
    }
    return undefined;
  }
  const norm = s.replace(/\[(\d+)\]/g, '.$1');
  const parts = norm.split('.').filter((x) => x !== '');
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** 渲染 {{var}} 模板 */
function renderTemplate(value, vars) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (m, key) => {
      const v = getByPath(vars, key);
      return v === undefined || v === null ? m : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderTemplate(v, vars);
    return out;
  }
  return value;
}

/** 拼接 URL: 支持相对路径 + query */
function buildUrl(baseUrl, url, query) {
  let full;
  const u = String(url || '');
  if (/^https?:\/\//i.test(u)) {
    full = u;
  } else if (baseUrl) {
    const b = String(baseUrl).replace(/\/+$/, '');
    full = b + (u.startsWith('/') ? u : '/' + u);
  } else {
    full = u;
  }
  if (query && Object.keys(query).length > 0) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    full += (full.includes('?') ? '&' : '?') + qs;
  }
  return full;
}

/**
 * 期望值匹配: 支持普通值 / 嵌套对象 / 数组,以及操作符
 *   $contains: 子串或数组包含
 *   $regex:    正则匹配(字符串形式)
 *   $gt/$gte/$lt/$lte: 数值比较
 *   $exists:   是否存在
 *   $ne:       不等于
 * @returns {{ok: boolean, path?: string, expected?: any, actual?: any}}
 */
function matchValue(actual, expected, path = '') {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    // 操作符
    const keys = Object.keys(expected);
    if (keys.length > 0 && keys.every((k) => k.startsWith('$'))) {
      for (const [op, arg] of Object.entries(expected)) {
        switch (op) {
          case '$contains':
            if (Array.isArray(actual)) {
              if (!actual.includes(arg)) return { ok: false, path, expected: arg, actual };
            } else if (typeof actual !== 'string' || !actual.includes(String(arg))) {
              return { ok: false, path, expected: arg, actual };
            }
            break;
          case '$regex': {
            let re;
            try {
              re = new RegExp(arg);
            } catch (e) {
              return { ok: false, path, expected: arg, actual };
            }
            if (typeof actual !== 'string' || !re.test(actual)) {
              return { ok: false, path, expected: arg, actual };
            }
            break;
          }
          case '$gt':
            if (!(Number(actual) > Number(arg))) return { ok: false, path, expected: arg, actual };
            break;
          case '$gte':
            if (!(Number(actual) >= Number(arg))) return { ok: false, path, expected: arg, actual };
            break;
          case '$lt':
            if (!(Number(actual) < Number(arg))) return { ok: false, path, expected: arg, actual };
            break;
          case '$lte':
            if (!(Number(actual) <= Number(arg))) return { ok: false, path, expected: arg, actual };
            break;
          case '$exists':
            if (arg === true && actual === undefined) return { ok: false, path, expected: arg, actual };
            if (arg === false && actual !== undefined) return { ok: false, path, expected: arg, actual };
            break;
          case '$ne':
            if (actual === arg) return { ok: false, path, expected: arg, actual };
            break;
          default:
            return { ok: false, path, expected, actual };
        }
      }
      return { ok: true };
    }
    // 普通对象:逐键递归(actual 必须是对象)
    if (actual === null || typeof actual !== 'object') return { ok: false, path, expected, actual };
    for (const [k, want] of Object.entries(expected)) {
      const got = Array.isArray(actual) ? actual[Number(k)] : actual[k];
      const r = matchValue(got, want, path ? `${path}.${k}` : k);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return { ok: false, path, expected, actual };
    }
    for (let i = 0; i < expected.length; i++) {
      const r = matchValue(actual[i], expected[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  if (actual !== expected) return { ok: false, path, expected, actual };
  return { ok: true };
}

/** 尝试把响应文本解析为 JSON,失败返回 null */
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/** 安全截断,避免 raw 日志过大 */
function clip(s, max = 2000) {
  if (s == null) return null;
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (str == null) return null;
  return str.length > max ? str.slice(0, max) + `... [截断,共 ${str.length} 字符]` : str;
}

// ============================================================
// 意图驱动(intent)附加能力
// ------------------------------------------------------------
// ④ 自动断言:用例没写 expect 时,由模型基于"意图 + 真实响应"提出断言点,
//    但**判定在本地客观完成**(模型不打分),保证结果可复核、不幻觉。
// ============================================================

/** 精简描述 JSON 结构(只保留形状不保留值),供模型设计断言 */
function summarizeShape(value, depth = 0, maxDepth = 2) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t !== 'object') return t;
  if (depth >= maxDepth) return Array.isArray(value) ? 'array' : 'object';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array(0)';
    return `array(${value.length})<${summarizeShape(value[0], depth + 1, maxDepth)}>`;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = summarizeShape(v, depth + 1, maxDepth);
  return out;
}

/**
 * 清洗断言期望:剔除模型产出的空值键。
 * 典型坑:模型给 notContains:"" —— 空串必然"包含于"任何响应体,导致用例被误判为失败。
 */
function sanitizeExpect(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return {};
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v)) {
      const cleaned = v.filter(
        (x) => x !== undefined && x !== null && !(typeof x === 'string' && x.trim() === '')
      );
      if (cleaned.length) out[k] = cleaned;
      continue;
    }
    if (typeof v === 'object') {
      const cleaned = sanitizeExpect(v);
      if (Object.keys(cleaned).length) out[k] = cleaned;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** 客观校验模型生成的断言(模型只提点,不判定) */
function evaluateGeneratedAssertions(generated, resp, duration) {
  const failures = [];
  const results = [];

  for (const a of generated || []) {
    const type = String((a && a.type) || '').toLowerCase();
    const expected = a && a.expected;
    const hasExpected =
      expected !== undefined && expected !== null && String(expected).trim() !== '';
    let actual = null;
    let passed = null;

    // 空期望值没有判定意义(尤其 notContains:"" 必然命中),跳过以免误判失败
    if (['contains', 'notcontains', 'equals'].includes(type) && !hasExpected) continue;
    if ((type === 'status' || type === 'duration') && !Number.isFinite(Number(expected))) continue;

    try {
      if (type === 'status') {
        actual = resp.status;
        passed = Number(actual) === Number(a.expected);
      } else if (type === 'duration') {
        actual = duration;
        passed = duration <= Number(a.expected);
      } else if (type === 'json') {
        const r = matchValue(resp.json, a.expected, '');
        passed = r.ok;
        actual = r.ok ? '(子集匹配通过)' : `字段 ${r.path || '(根)'}: 期望 ${clip(r.expected, 200)},实际 ${clip(r.actual, 200)}`;
      } else if (type === 'jsonpath') {
        const got = getByPath(resp.json !== null ? resp.json : { text: resp.text }, a.target);
        const r = matchValue(got, a.expected, a.target);
        passed = r.ok;
        actual = r.ok ? clip(got, 200) : `期望 ${clip(a.expected, 200)},实际 ${clip(got, 200)}`;
      } else if (type === 'contains') {
        actual = resp.text || '';
        passed = actual.includes(String(a.expected));
      } else if (type === 'notcontains') {
        actual = resp.text || '';
        passed = !actual.includes(String(a.expected));
      } else if (type === 'equals') {
        actual = resp.text || '';
        passed = actual === String(a.expected);
      } else if (type === 'header') {
        actual = resp.headers ? resp.headers[a.target] : undefined;
        passed = String(actual || '').includes(String(a.expected));
      }
    } catch (e) {
      passed = false;
      actual = String(e && e.message);
    }

    const item = {
      id: (a && a.id) || '',
      description: (a && a.description) || '',
      type,
      target: (a && a.target) || '',
      expected: a && a.expected,
      actual: clip(actual, 200),
      passed,
      source: 'auto-generated',
    };
    results.push(item);
    if (passed === false) {
      failures.push(`[自动断言] ${item.description}: 期望 ${clip(a && a.expected, 120)},实际 ${clip(actual, 120)}`);
    }
  }

  return { failures, results };
}

/** 401/403 自动重登:按 auth.login 取 token 注入公共请求头,只重试一次 */
async function doLogin(ctx) {
  const cfg = (ctx.auth && ctx.auth.login) || null;
  if (!cfg || !cfg.url) return null;

  const url = buildUrl(ctx.baseUrl, cfg.url, cfg.query);
  const method = String(cfg.method || 'POST').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(cfg.headers || {}) };
  const body =
    cfg.body === undefined || cfg.body === null
      ? undefined
      : typeof cfg.body === 'string'
      ? cfg.body
      : JSON.stringify(cfg.body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout || ctx.timeout || 15000);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }

    const scope = { json, headers: respHeadersToObject(res.headers), text };
    const token = getByPath(scope, cfg.tokenPath || 'json.token');
    if (!token) return null;

    const injectAs = (ctx.auth && ctx.auth.injectAs) || 'Authorization';
    const raw = String(token);
    const isAuthHeader = /^authorization$/i.test(injectAs);
    ctx.headers[injectAs] = isAuthHeader && !/^(bearer|basic)\s/i.test(raw) ? `Bearer ${raw}` : raw;
    ctx.vars[(ctx.auth && ctx.auth.tokenVar) || 'token'] = token;
    ctx.auth._used = true;
    return token;
  } finally {
    clearTimeout(timer);
  }
}

/** Headers 对象 -> 普通对象 */
function respHeadersToObject(h) {
  const out = {};
  try {
    if (h && typeof h.forEach === 'function') h.forEach((v, k) => { out[k] = v; });
    else if (h && typeof h.entries === 'function') for (const [k, v] of h.entries()) out[k] = v;
  } catch (_) {
    /* 忽略 */
  }
  return out;
}

/**
 * 自动断言兜底:用例未声明 expect 时,由模型提出断言点并本地客观校验
 */
async function buildAutoExpect(rawCase, ctx, resp, duration) {
  const own = rawCase.expect || {};
  if (Object.keys(own).length > 0) return { expect: own, generated: [] };
  if (!ctx.autoAssert || !ctx.intentAutoAssert) return { expect: {}, generated: [] };

  try {
    const generated = await ctx.intentAutoAssert({
      kind: 'api',
      intent: { goal: ctx.goal || rawCase.name || '' },
      observation: {
        request: { method: rawCase.method || 'GET', url: rawCase.url || '' },
        status: resp.status,
        headers: resp.headers,
        durationMs: duration,
        bodySample: clip(resp.text, 1200),
        jsonShape: resp.json ? summarizeShape(resp.json) : null,
      },
    });
    return { expect: {}, generated: Array.isArray(generated) ? generated : [] };
  } catch (_) {
    return { expect: {}, generated: [] };
  }
}

// ============================================================
// 单条用例执行
// ============================================================

async function runCase(rawCase, ctx, index) {
  const started = Date.now();
  const name = rawCase.name || rawCase.title || `case-${index + 1}`;
  const base = {
    name,
    classname: rawCase.classname || 'api-direct',
    status: 'passed',
    duration: 0,
    error: null,
    stack: null,
  };

  // 变量代入
  const vars = { ...ctx.vars, ...(rawCase.vars || {}) };
  const c = {
    method: (rawCase.method || 'GET').toUpperCase(),
    url: renderTemplate(rawCase.url, vars),
    headers: { ...ctx.headers, ...renderTemplate(rawCase.headers || {}, vars) },
    query: renderTemplate(rawCase.query || {}, vars),
    body: renderTemplate(rawCase.body, vars),
    expect: rawCase.expect || {},
    extract: rawCase.extract || {},
  };

  if (!c.url) {
    return {
      ...base,
      status: 'failed',
      error: 'MISSING_URL',
      stack: '用例缺少 url,且未配置 baseUrl',
      duration: Date.now() - started,
    };
  }

  const fullUrl = buildUrl(ctx.baseUrl, c.url, c.query);
  let parsed;
  try {
    parsed = new URL(fullUrl);
  } catch (_) {
    return {
      ...base,
      status: 'failed',
      error: 'INVALID_URL',
      stack: `URL 非法: ${fullUrl}`,
      duration: Date.now() - started,
    };
  }
  // 仅允许 http/https,避免误用 file:// 等协议
  if (!/^https?:$/.test(parsed.protocol)) {
    return {
      ...base,
      status: 'failed',
      error: 'UNSUPPORTED_PROTOCOL',
      stack: `仅支持 http/https,当前为 ${parsed.protocol}`,
      duration: Date.now() - started,
    };
  }

  // 构造 body
  let bodyPayload;
  const hasBody = c.body !== undefined && c.body !== null && c.method !== 'GET' && c.method !== 'HEAD';
  if (hasBody) {
    const ct = Object.keys(c.headers).find((k) => k.toLowerCase() === 'content-type');
    if (typeof c.body === 'string') {
      bodyPayload = c.body;
      if (!ct) c.headers['Content-Type'] = 'text/plain;charset=UTF-8';
    } else {
      bodyPayload = JSON.stringify(c.body);
      if (!ct) c.headers['Content-Type'] = 'application/json;charset=UTF-8';
    }
  }

  // 超时控制
  const controller = new AbortController();
  const timeoutMs = rawCase.timeout || ctx.timeout || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  let resText = '';
  let resJson = null;
  let resHeaders = {};
  try {
    res = await fetch(parsed.toString(), {
      method: c.method,
      headers: c.headers,
      body: bodyPayload,
      redirect: rawCase.followRedirects === false ? 'manual' : 'follow',
      signal: controller.signal,
    });
    resText = await res.text();
    resJson = tryParseJson(resText);
    res.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
    return {
      ...base,
      status: 'failed',
      duration: Date.now() - started,
      error: aborted ? 'TIMEOUT' : 'REQUEST_ERROR',
      stack: aborted ? `请求超时(${timeoutMs}ms): ${c.method} ${fullUrl}` : `${e && e.message}`,
      request: { method: c.method, url: fullUrl, headers: c.headers, body: clip(bodyPayload) },
    };
  }
  clearTimeout(timer);

  const duration = Date.now() - started;
  const resp = { status: res.status, headers: resHeaders, text: resText, json: resJson };
  const failures = [];

  // ── 断言 ──
  // 意图驱动:用例未声明 expect 时,由模型基于"意图 + 真实响应"提出断言点
  const auto = await buildAutoExpect(rawCase, ctx, resp, duration);
  // 清洗空期望值(模型常见的 notContains:""),否则必然误判
  const exp = sanitizeExpect(auto.expect);

  if (exp.status !== undefined) {
    const wanted = Array.isArray(exp.status) ? exp.status : [exp.status];
    if (!wanted.map(Number).includes(res.status)) {
      failures.push(`状态码: 期望 ${wanted.join('/')},实际 ${res.status}`);
    }
  } else if (res.status >= 400) {
    // 未显式声明 status 时,4xx/5xx 视为失败(常见预期)
    failures.push(`状态码: 实际 ${res.status}(未显式期望,默认要求 < 400)`);
  }

  if (exp.maxDurationMs !== undefined && duration > Number(exp.maxDurationMs)) {
    failures.push(`响应时间: 期望 <= ${exp.maxDurationMs}ms,实际 ${duration}ms`);
  }

  if (exp.json !== undefined) {
    if (resJson === null) {
      failures.push(`响应体: 期望 JSON 匹配,但响应不是合法 JSON(前 200 字符: ${clip(resText, 200)})`);
    } else {
      const r = matchValue(resJson, exp.json, '');
      if (!r.ok) {
        failures.push(`响应体字段 ${r.path || '(根)'}: 期望 ${clip(r.expected, 200)},实际 ${clip(r.actual, 200)}`);
      }
    }
  }

  if (Array.isArray(exp.jsonPath)) {
    for (const item of exp.jsonPath) {
      const got = getByPath(resJson !== null ? resJson : { text: resText }, item.path);
      if (!matchValue(got, item.equals !== undefined ? item.equals : item.value, item.path).ok) {
        failures.push(`路径 ${item.path}: 期望 ${clip(item.equals !== undefined ? item.equals : item.value, 200)},实际 ${clip(got, 200)}`);
      }
    }
  } else if (exp.jsonPath && typeof exp.jsonPath === 'object') {
    const item = exp.jsonPath;
    const got = getByPath(resJson !== null ? resJson : { text: resText }, item.path);
    if (!matchValue(got, item.equals !== undefined ? item.equals : item.value, item.path).ok) {
      failures.push(`路径 ${item.path}: 期望 ${clip(item.equals !== undefined ? item.equals : item.value, 200)},实际 ${clip(got, 200)}`);
    }
  }

  const containsList = exp.contains === undefined ? [] : Array.isArray(exp.contains) ? exp.contains : [exp.contains];
  for (const needle of containsList) {
    if (!resText.includes(String(needle))) failures.push(`响应体缺少内容: ${clip(needle, 120)}`);
  }

  const notContainsList = exp.notContains === undefined ? [] : Array.isArray(exp.notContains) ? exp.notContains : [exp.notContains];
  for (const needle of notContainsList) {
    if (resText.includes(String(needle))) failures.push(`响应体不应包含: ${clip(needle, 120)}`);
  }

  if (exp.equals !== undefined && resText !== String(exp.equals)) {
    failures.push(`响应体完全相等: 期望 ${clip(exp.equals, 200)},实际 ${clip(resText, 200)}`);
  }

  if (exp.header && typeof exp.header === 'object') {
    for (const [hk, hv] of Object.entries(exp.header)) {
      const got = resHeaders[hk] !== undefined ? resHeaders[hk] : getByPath({ headers: resHeaders }, `header:${hk}`);
      if (!matchValue(got, hv, hk).ok) {
        failures.push(`响应头 ${hk}: 期望 ${clip(hv, 120)},实际 ${clip(got, 120)}`);
      }
    }
  }

  // ── 变量提取(供后续用例复用) ──
  for (const [varName, varPath] of Object.entries(c.extract || {})) {
    const src = String(varPath).startsWith('header') ? { headers: resHeaders } : resJson !== null ? resJson : { text: resText };
    const val = getByPath(src, varPath);
    if (val !== undefined) ctx.vars[varName] = val;
  }

  // ④ 自动断言:模型提出断言点 -> 本地客观校验(模型不参与判定)
  const generatedAssertions = evaluateGeneratedAssertions(auto.generated, resp, duration);
  for (const f of generatedAssertions.failures) failures.push(f);

  const status = failures.length > 0 ? 'failed' : 'passed';
  return {
    ...base,
    status,
    duration,
    error: status === 'failed' ? failures[0] : null,
    stack: status === 'failed' ? failures.join('\n') : null,
    request: { method: c.method, url: fullUrl, headers: c.headers, body: clip(bodyPayload) },
    response: { status: res.status, headers: resHeaders, body: clip(resText, 3000) },
    assertions: failures,
    autoAssertions: generatedAssertions.results || [],
    authExpired: res.status === 401 || res.status === 403,
  };
}

// ============================================================
// 统一入口
// ============================================================

/**
 * 意图模式:把自然语言目标解析成可执行请求序列(①),再回到通用执行流程
 */
async function invokeIntent(p) {
  const engine = getIntentEngine();
  const fail = (error, raw) => {
    const r = toUTRM(
      { testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } },
      'api-direct',
      1,
      raw
    );
    r.error = error;
    return r;
  };

  if (!engine) return fail('ENGINE_NOT_FOUND', '未能加载 intent-engine');
  if (!engine.isAvailable()) {
    return fail(
      'NO_LLM_KEY',
      '未配置 DEEPSEEK_API_KEY,intent 模式不可用;请改用 mode="script" 并传入 cases。'
    );
  }

  let cases = [];
  let intent = null;
  try {
    if (Array.isArray(p.cases) && p.cases.length) {
      cases = p.cases;
    } else if (p.goal) {
      intent = await engine.parseIntent({
        kind: 'api',
        input: String(p.goal),
        baseUrl: p.baseUrl || '',
        env: sanitizeVars(p.vars),
      });
      cases = Array.isArray(intent.requests) ? intent.requests : [];
    }

    if (cases.length === 0) {
      return fail('MISSING_INTENT', 'intent 模式需要 goal 或非空 cases');
    }

    // 解析出的意图作为执行上下文的一部分,供自动断言使用
    p.__intent = intent;
    return executeCases(cases, p, { autoAssert: true });
  } catch (e) {
    return fail('INTENT_PARSE_FAILED', `意图解析失败: ${e && e.message}`);
  }
}

/**
 * 通用执行流程(script / intent 共用)
 * intent 模式下用例缺 expect 时,会自动调用模型生成兜底断言(判定仍在本地客观完成)。
 */
async function executeCases(cases, p, { autoAssert = false } = {}) {
  const ctx = {
    baseUrl: p.baseUrl || '',
    headers: p.headers || {},
    vars: { ...(p.vars || {}) },
    timeout: p.timeout || 15000,
    goal: p.goal || '',
    intent: p.__intent || null,
    autoAssert,
    intentAutoAssert:
      autoAssert && getIntentEngine() ? (args) => getIntentEngine().autoAssertions(args) : null,
    auth: p.auth || null,
  };

  const testcases = [];
  const logs = [];
  let skipped = 0;
  let stopped = false;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (!c || c.skip) {
      skipped++;
      testcases.push({
        name: (c && (c.name || c.title)) || `case-${i + 1}`,
        classname: 'api-direct',
        status: 'skipped',
        duration: 0,
        error: null,
        stack: null,
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    let r = await runCase(c, ctx, i);

    // 自愈:401/403(token 过期)且配置了 auth.login 时,自动重登后重试一次
    if (r.authExpired && ctx.auth && ctx.auth.login && !ctx.auth._used) {
      // eslint-disable-next-line no-await-in-loop
      const token = await doLogin(ctx);
      if (token) {
        // eslint-disable-next-line no-await-in-loop
        r = await runCase(c, ctx, i);
        r.retriedAfterLogin = true;
      }
    }

    testcases.push(r);
    logs.push(`${r.status === 'passed' ? 'PASS' : 'FAIL'} ${r.name} (${r.duration}ms)${r.error ? ' :: ' + r.error : ''}`);
    if (r.status === 'failed' && p.stopOnFail) {
      stopped = true;
      break;
    }
  }

  if (stopped) {
    // 被中止的剩余用例记为 skipped,保证 total 与实际用例数一致
    for (let j = testcases.length; j < cases.length; j++) {
      skipped++;
      testcases.push({
        name: (cases[j] && (cases[j].name || cases[j].title)) || `case-${j + 1}`,
        classname: 'api-direct',
        status: 'skipped',
        duration: 0,
        error: null,
        stack: '因前序用例失败且 stopOnFail=true,未执行',
      });
    }
  }

  const summary = {
    total: testcases.length,
    passed: testcases.filter((t) => t.status === 'passed').length,
    failed: testcases.filter((t) => t.status === 'failed').length,
    skipped: testcases.filter((t) => t.status === 'skipped').length,
    duration: testcases.reduce((s, t) => s + (t.duration || 0), 0),
  };

  return toUTRM({ testcases, summary }, 'api-direct', summary.failed > 0 ? 1 : 0, logs.join('\n'));
}

/**
 * @param {object} params
 * @param {string} [params.mode='script']   script=按 cases 执行(默认);
 *                                          intent=意图驱动(先用模型把目标解析成请求序列)
 * @param {string} [params.baseUrl]               公共基地址
 * @param {object} [params.headers]               公共请求头
 * @param {object} [params.vars]                  初始变量(供 {{var}} 引用)
 * @param {number} [params.timeout=15000]         单请求超时(ms)
 * @param {Array}  [params.cases]                 用例数组(推荐)
 * @param {object} [params.spec]                  单用例简写(与 cases 二选一)
 * @param {string} [params.goal]                  意图模式:自然语言测试目标
 * @param {object} [params.auth]                  鉴权配置 { login:{url,method,body,tokenPath}, injectAs, tokenVar }
 * @param {boolean}[params.autoAssert=true]        用例未声明 expect 时自动生成断言(intent 模式默认开)
 * @param {boolean}[params.stopOnFail=false]      失败后是否中止后续用例
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invoke(params) {
  const p = params || {};

  if (String(p.mode || '').toLowerCase() === 'intent') {
    return invokeIntent(p);
  }

  const cases = Array.isArray(p.cases) ? p.cases : p.spec ? [p.spec] : [];
  if (cases.length === 0) {
    return toUTRM(
      { testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } },
      'api-direct',
      1,
      'cases/spec 为空:未提供任何用例。请传入 cases 数组(每项含 url 与 expect)。'
    );
  }

  return executeCases(cases, p, { autoAssert: p.autoAssert !== false });
}

module.exports = { invoke, toUTRM, matchValue, getByPath, buildUrl };
