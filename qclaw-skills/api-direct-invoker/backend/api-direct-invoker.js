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

// ============================================================
// UTRM 格式转换(与既有执行器保持一致)
// ============================================================

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
  const exp = c.expect || {};

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
  };
}

// ============================================================
// 统一入口
// ============================================================

/**
 * @param {object} params
 * @param {string} [params.baseUrl]               公共基地址
 * @param {object} [params.headers]               公共请求头
 * @param {object} [params.vars]                  初始变量(供 {{var}} 引用)
 * @param {number} [params.timeout=15000]         单请求超时(ms)
 * @param {Array}  [params.cases]                 用例数组(推荐)
 * @param {object} [params.spec]                  单用例简写(与 cases 二选一)
 * @param {boolean}[params.stopOnFail=false]      失败后是否中止后续用例
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invoke(params) {
  const p = params || {};
  const cases = Array.isArray(p.cases) ? p.cases : p.spec ? [p.spec] : [];

  if (cases.length === 0) {
    return toUTRM(
      { testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } },
      'api-direct',
      1,
      'cases/spec 为空:未提供任何用例。请传入 cases 数组(每项含 url 与 expect)。'
    );
  }

  const ctx = {
    baseUrl: p.baseUrl || '',
    headers: p.headers || {},
    vars: { ...(p.vars || {}) },
    timeout: p.timeout || 15000,
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
    const r = await runCase(c, ctx, i);
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

module.exports = { invoke, toUTRM, matchValue, getByPath, buildUrl };
