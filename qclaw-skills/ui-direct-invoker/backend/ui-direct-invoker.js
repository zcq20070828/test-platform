/**
 * UI 直执执行器 —— 免脚本直接驱动浏览器执行 UI/E2E 测试
 * ============================================================
 * 背景(为什么需要这个通道):
 *   原有 ui-test-tool-invoker 的必填入参是 testScript(Playwright/Selenium/Cypress 脚本
 *   路径或内容),导致「UI/E2E 测试」智能体必须先"造出一个脚本"才能执行测试。
 *   而前端/后端 node_modules 里已装有 playwright 可编程库,却只被用于 CLI 子进程方式,
 *   能力未被直接利用。
 *
 * 本通道的定位:
 *   不写脚本文件、不启动 test runner,由后端直接 require('playwright') 打开真实浏览器,
 *   按步骤序列(goto/click/fill/expect...)逐步驱动,输出与既有执行器一致的 UTRM 结果。
 *   → 智能体可以从"用例文档 / 测试步骤描述 / 测试URL+账号密码"直接执行。
 *
 * 依赖: playwright(优先 backend/node_modules,回退 frontend / cwd)
 *
 * 输出: UTRM 统一格式(与 ui-test-invoker / api-test-invoker 保持一致)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// ============================================================
// playwright 加载(跨目录解析 node_modules)
// ============================================================

let _pw = null;
function loadPlaywright() {
  if (_pw) return _pw;
  const { createRequire } = require('module');
  // __dirname = <root>/qclaw-skills/ui-direct-invoker/backend
  const roots = [
    path.resolve(__dirname, '..', '..', '..', 'backend'),
    path.resolve(__dirname, '..', '..', '..', 'frontend'),
    process.cwd(),
  ];
  for (const r of roots) {
    try {
      const req = createRequire(path.join(r, 'package.json'));
      _pw = req('playwright');
      return _pw;
    } catch (_) {
      /* 继续尝试下一个根目录 */
    }
  }
  return null;
}

// ============================================================
// UTRM 格式转换
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

function renderTemplate(value, vars) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (m, key) => {
      const v = vars[key];
      return v === undefined || v === null ? m : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[renderTemplate(k, vars)] = renderTemplate(v, vars);
    return out;
  }
  return value;
}

function joinUrl(baseUrl, url) {
  const u = String(url || '');
  if (/^https?:\/\//i.test(u) || /^file:\/\//i.test(u) || u.startsWith('data:')) return u;
  if (!baseUrl) return u;
  return String(baseUrl).replace(/\/+$/, '') + (u.startsWith('/') ? u : '/' + u);
}

function clip(s, max = 1500) {
  if (s == null) return null;
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (str == null) return null;
  return str.length > max ? str.slice(0, max) + `... [截断,共 ${str.length} 字符]` : str;
}

/** 截图:返回 { path, base64(可选) } */
async function takeScreenshot(page, label, opts = {}) {
  try {
    const dir = path.join(os.tmpdir(), 'ui-direct-shots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${label.replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`);
    const buf = await page.screenshot({ fullPage: !!opts.fullPage });
    fs.writeFileSync(file, buf);
    // base64 仅在小图时返回,避免结果体过大
    const out = { path: file, bytes: buf.length };
    if (buf.length <= 200 * 1024) out.base64 = buf.toString('base64');
    return out;
  } catch (e) {
    return { path: null, error: e && e.message };
  }
}

// ============================================================
// 步骤执行
// ============================================================

/**
 * 执行单个步骤
 * @returns {Promise<{ok: boolean, error?: string, detail?: string}>}
 */
async function runStep(page, rawStep, ctx, idx) {
  const step = renderTemplate(rawStep || {}, ctx.vars);
  const action = String(step.action || step.type || '').toLowerCase();
  const sel = step.selector || step.target || step.locator;
  const timeout = step.timeout || ctx.timeout || 15000;

  const need = (...names) => {
    for (const n of names) {
      if (step[n] === undefined || step[n] === null || step[n] === '') {
        return `步骤 ${idx + 1} (${action}) 缺少参数: ${n}`;
      }
    }
    return null;
  };

  switch (action) {
    case 'goto':
    case 'navigate': {
      const miss = need('url');
      if (miss) return { ok: false, error: miss };
      await page.goto(joinUrl(ctx.baseUrl, step.url), { waitUntil: step.waitUntil || 'domcontentloaded', timeout });
      return { ok: true, detail: `goto ${joinUrl(ctx.baseUrl, step.url)}` };
    }

    case 'click': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      await page.click(sel, { timeout, button: step.button || 'left', clickCount: step.clickCount || 1 });
      return { ok: true, detail: `click ${sel}` };
    }

    case 'dblclick': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      await page.dblclick(sel, { timeout });
      return { ok: true, detail: `dblclick ${sel}` };
    }

    case 'fill': {
      const miss = need('selector', 'value');
      if (miss) return { ok: false, error: miss };
      await page.fill(sel, String(step.value), { timeout });
      return { ok: true, detail: `fill ${sel}` };
    }

    case 'type': {
      const miss = need('selector', 'value');
      if (miss) return { ok: false, error: miss };
      await page.type(sel, String(step.value), { delay: step.delay || 0, timeout });
      return { ok: true, detail: `type ${sel}` };
    }

    case 'press': {
      const key = step.key || step.value;
      if (!key) return { ok: false, error: `步骤 ${idx + 1} (press) 缺少参数: key` };
      if (sel) await page.press(sel, key, { timeout });
      else await page.keyboard.press(key);
      return { ok: true, detail: `press ${key}` };
    }

    case 'select': {
      const miss = need('selector', 'value');
      if (miss) return { ok: false, error: miss };
      await page.selectOption(sel, String(step.value), { timeout });
      return { ok: true, detail: `select ${sel}` };
    }

    case 'check': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      await page.check(sel, { timeout });
      return { ok: true, detail: `check ${sel}` };
    }

    case 'uncheck': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      await page.uncheck(sel, { timeout });
      return { ok: true, detail: `uncheck ${sel}` };
    }

    case 'hover': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      await page.hover(sel, { timeout });
      return { ok: true, detail: `hover ${sel}` };
    }

    case 'wait': {
      const ms = Number(step.ms || step.value || 1000);
      await page.waitForTimeout(ms);
      return { ok: true, detail: `wait ${ms}ms` };
    }

    case 'waitfor': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      await page.waitForSelector(sel, { state: step.state || 'visible', timeout });
      return { ok: true, detail: `waitFor ${sel} (${step.state || 'visible'})` };
    }

    case 'waitforurl': {
      const miss = need('url');
      if (miss) return { ok: false, error: miss };
      await page.waitForURL(joinUrl(ctx.baseUrl, step.url), { timeout });
      return { ok: true, detail: `waitForURL ${step.url}` };
    }

    case 'reload': {
      await page.reload({ waitUntil: step.waitUntil || 'domcontentloaded', timeout });
      return { ok: true, detail: 'reload' };
    }

    case 'goback': {
      await page.goBack({ timeout });
      return { ok: true, detail: 'goBack' };
    }

    case 'screenshot': {
      const shot = await takeScreenshot(page, step.name || `step-${idx + 1}`, { fullPage: step.fullPage });
      return { ok: true, detail: 'screenshot', screenshot: shot };
    }

    // ── 断言类 ──
    case 'expecttext':
    case 'expect_text': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      const text = await page.textContent(sel, { timeout });
      const actual = (text || '').trim();
      const want = String(step.text !== undefined ? step.text : step.value || '');
      const hit = step.contains === false ? actual === want : actual.includes(want);
      if (!hit) {
        return { ok: false, error: `文本断言失败 ${sel}: 期望${step.contains === false ? '等于' : '包含'} "${clip(want, 200)}",实际 "${clip(actual, 200)}"` };
      }
      return { ok: true, detail: `expectText ${sel}` };
    }

    case 'expectvisible': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      const visible = await page.isVisible(sel);
      if (!visible) return { ok: false, error: `可见性断言失败: ${sel} 不可见` };
      return { ok: true, detail: `expectVisible ${sel}` };
    }

    case 'expecthidden': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      const visible = await page.isVisible(sel);
      if (visible) return { ok: false, error: `隐藏断言失败: ${sel} 仍然可见` };
      return { ok: true, detail: `expectHidden ${sel}` };
    }

    case 'expecturl': {
      const want = step.url !== undefined ? step.url : step.value;
      if (want === undefined) return { ok: false, error: `步骤 ${idx + 1} (expectUrl) 缺少参数: url` };
      const actual = page.url();
      const hit = step.contains === false ? actual === String(want) : actual.includes(String(want));
      if (!hit) return { ok: false, error: `URL 断言失败: 当前 "${clip(actual, 200)}",期望${step.contains === false ? '等于' : '包含'} "${clip(String(want), 200)}"` };
      return { ok: true, detail: 'expectUrl' };
    }

    case 'expecttitle': {
      const want = step.title !== undefined ? step.title : step.value;
      if (want === undefined) return { ok: false, error: `步骤 ${idx + 1} (expectTitle) 缺少参数: title` };
      const actual = await page.title();
      const hit = step.equals === true ? actual === String(want) : String(actual).includes(String(want));
      if (!hit) return { ok: false, error: `标题断言失败: 当前 "${clip(actual, 200)}",期望包含 "${clip(String(want), 200)}"` };
      return { ok: true, detail: 'expectTitle' };
    }

    case 'expectcount': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      const count = await page.locator(sel).count();
      if (count !== Number(step.count)) {
        return { ok: false, error: `数量断言失败 ${sel}: 期望 ${step.count} 个,实际 ${count} 个` };
      }
      return { ok: true, detail: `expectCount ${sel}` };
    }

    case 'expectvalue': {
      const miss = need('selector');
      if (miss) return { ok: false, error: miss };
      const actual = await page.inputValue(sel, { timeout });
      if (actual !== String(step.value)) {
        return { ok: false, error: `取值断言失败 ${sel}: 期望 "${clip(String(step.value), 200)}",实际 "${clip(actual, 200)}"` };
      }
      return { ok: true, detail: `expectValue ${sel}` };
    }

    case 'expectattribute': {
      const miss = need('selector', 'attr');
      if (miss) return { ok: false, error: miss };
      const actual = await page.getAttribute(sel, step.attr, { timeout });
      const want = String(step.value !== undefined ? step.value : '');
      const hit = step.contains === true ? String(actual || '').includes(want) : actual === want;
      if (!hit) {
        return { ok: false, error: `属性断言失败 ${sel}@${step.attr}: 期望 "${clip(want, 200)}",实际 "${clip(actual, 200)}"` };
      }
      return { ok: true, detail: `expectAttribute ${sel}@${step.attr}` };
    }

    default:
      return { ok: false, error: `未知步骤类型: "${action || '(空)'}"` };
  }
}

/** 变量提取: text:selector / attr:selector@attr / url / title */
async function extractVars(page, extractSpec, vars) {
  if (!extractSpec || typeof extractSpec !== 'object') return;
  for (const [name, spec] of Object.entries(extractSpec)) {
    try {
      const s = String(spec);
      if (s === 'url') {
        vars[name] = page.url();
      } else if (s === 'title') {
        vars[name] = await page.title();
      } else if (s.startsWith('attr:')) {
        const rest = s.slice(5);
        const [sel, attr] = rest.split('@');
        vars[name] = await page.getAttribute(sel, attr, { timeout: 5000 });
      } else if (s.startsWith('text:')) {
        vars[name] = (await page.textContent(s.slice(5), { timeout: 5000 })) || '';
      }
    } catch (_) {
      /* 提取失败不影响主流程 */
    }
  }
}

// ============================================================
// 场景(case)执行
// ============================================================

async function runCase(rawCase, ctx, browserCtx, index) {
  const started = Date.now();
  const name = rawCase.name || rawCase.title || `case-${index + 1}`;
  const steps = Array.isArray(rawCase.steps) ? rawCase.steps : [];

  const page = await browserCtx.newPage();
  if (ctx.viewport) await page.setViewportSize(ctx.viewport);
  page.setDefaultTimeout(ctx.timeout || 15000);

  const vars = { ...ctx.vars, ...(rawCase.vars || {}) };
  const caseCtx = { ...ctx, vars };

  const executed = [];
  let failedAt = -1;
  let errorMsg = null;
  let screenshot = null;

  try {
    for (let i = 0; i < steps.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await runStep(page, steps[i], caseCtx, i);
      executed.push({ step: i + 1, action: (steps[i] || {}).action, ok: r.ok, detail: r.detail, error: r.error });
      if (!r.ok) {
        failedAt = i + 1;
        errorMsg = r.error;
        break;
      }
      if (steps[i] && steps[i].extract) {
        // eslint-disable-next-line no-await-in-loop
        await extractVars(page, steps[i].extract, vars);
      }
    }
    if (rawCase.extract) await extractVars(page, rawCase.extract, vars);
  } catch (e) {
    failedAt = executed.length + 1;
    errorMsg = `未捕获异常: ${e && e.message}`;
  }

  const duration = Date.now() - started;
  const status = errorMsg ? 'failed' : 'passed';

  if (status === 'failed' && ctx.screenshotOnFail !== false) {
    screenshot = await takeScreenshot(page, `case-${index + 1}-fail`);
  } else if (status === 'passed' && ctx.screenshotOnSuccess) {
    screenshot = await takeScreenshot(page, `case-${index + 1}-pass`);
  }

  const lastUrl = (() => {
    try {
      return page.url();
    } catch (_) {
      return null;
    }
  })();

  await page.close();

  return {
    name,
    classname: 'ui-direct',
    status,
    duration,
    error: errorMsg,
    stack: errorMsg ? `步骤 ${failedAt} 失败: ${errorMsg}\n已执行: ${executed.map((e) => `${e.step}.${e.action || ''}${e.ok ? '' : '(FAIL)'}`).join(' → ')}` : null,
    steps: executed,
    url: lastUrl,
    screenshot,
  };
}

// ============================================================
// 统一入口
// ============================================================

/**
 * @param {object} params
 * @param {string} [params.baseUrl]
 * @param {string} [params.browser='chromium']   chromium / firefox / webkit
 * @param {boolean}[params.headless=true]
 * @param {object} [params.viewport]             { width, height }
 * @param {number} [params.timeout=15000]        单步超时(ms)
 * @param {boolean}[params.screenshotOnFail=true]
 * @param {boolean}[params.screenshotOnSuccess=false]
 * @param {Array}  [params.cases]                场景数组(推荐)
 * @param {Array}  [params.steps]                单场景简写(与 cases 二选一)
 * @param {boolean}[params.stopOnFail=false]
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invoke(params) {
  const p = params || {};
  const cases = Array.isArray(p.cases) ? p.cases : Array.isArray(p.steps) ? [{ name: 'UI 直执场景', steps: p.steps }] : [];

  if (cases.length === 0) {
    const r = toUTRM({ testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } }, 'ui-direct', 1, 'cases/steps 为空:未提供任何步骤。');
    r.error = 'MISSING_STEPS';
    return r;
  }

  const playwright = loadPlaywright();
  if (!playwright) {
    const r = toUTRM({ testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } }, 'ui-direct', 1, '未能加载 playwright 模块');
    r.error = 'TOOL_NOT_FOUND';
    r.installCommands = { playwright: 'cd backend && npm install playwright && npx playwright install chromium' };
    return r;
  }

  const browserName = String(p.browser || 'chromium').toLowerCase();
  const launcher = playwright[browserName] || playwright.chromium;

  const ctx = {
    baseUrl: p.baseUrl || '',
    timeout: p.timeout || 15000,
    viewport: p.viewport || null,
    vars: { ...(p.vars || {}) },
    screenshotOnFail: p.screenshotOnFail !== false,
    screenshotOnSuccess: !!p.screenshotOnSuccess,
  };

  let browser;
  try {
    browser = await launcher.launch({ headless: p.headless !== false });
  } catch (e) {
    const r = toUTRM({ testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } }, 'ui-direct', 1, `浏览器启动失败: ${e && e.message}`);
    r.error = 'BROWSER_LAUNCH_FAILED';
    r.installCommands = { playwright: 'npx playwright install chromium' };
    return r;
  }

  const testcases = [];
  const logs = [];
  let skipped = 0;

  try {
    const browserCtx = await browser.newContext({
      viewport: ctx.viewport || { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (!c || c.skip || !Array.isArray(c.steps) || c.steps.length === 0) {
        skipped++;
        testcases.push({
          name: (c && (c.name || c.title)) || `case-${i + 1}`,
          classname: 'ui-direct',
          status: 'skipped',
          duration: 0,
          error: !c || c.skip ? null : 'MISSING_STEPS',
          stack: !c || c.skip ? null : '场景缺少 steps 数组',
        });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await runCase(c, ctx, browserCtx, i);
      testcases.push(r);
      logs.push(`${r.status === 'passed' ? 'PASS' : 'FAIL'} ${r.name} (${r.duration}ms)${r.error ? ' :: ' + r.error : ''}`);
      if (r.status === 'failed' && p.stopOnFail) {
        for (let j = i + 1; j < cases.length; j++) {
          skipped++;
          testcases.push({
            name: (cases[j] && (cases[j].name || cases[j].title)) || `case-${j + 1}`,
            classname: 'ui-direct',
            status: 'skipped',
            duration: 0,
            error: null,
            stack: '因前序场景失败且 stopOnFail=true,未执行',
          });
        }
        break;
      }
    }

    await browserCtx.close();
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {
        /* 关闭失败忽略 */
      }
    }
  }

  const summary = {
    total: testcases.length,
    passed: testcases.filter((t) => t.status === 'passed').length,
    failed: testcases.filter((t) => t.status === 'failed').length,
    skipped: testcases.filter((t) => t.status === 'skipped').length,
    duration: testcases.reduce((s, t) => s + (t.duration || 0), 0),
  };

  return toUTRM({ testcases, summary }, 'ui-direct', summary.failed > 0 ? 1 : 0, logs.join('\n'));
}

module.exports = { invoke, toUTRM, runStep, loadPlaywright };
