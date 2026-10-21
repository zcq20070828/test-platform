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
// 需要"元素定位"的动作:意图驱动下这些动作通常只有人话 target、没有 selector
const LOCATOR_ACTIONS = new Set([
  'click', 'dblclick', 'fill', 'type', 'select', 'check', 'uncheck', 'hover',
  'waitfor', 'expecttext', 'expect_text', 'expectvisible', 'expecthidden',
  'expectcount', 'expectvalue', 'expectattribute',
]);

/** 需要落到"可输入控件"上的动作 —— 定位时优先输入框,避免命中图标/按钮 */
const FILLABLE_ACTIONS = new Set(['fill', 'type']);

async function runStep(page, rawStep, ctx, idx) {
  const step = renderTemplate(rawStep || {}, ctx.vars);
  const action = String(step.action || step.type || '').toLowerCase();
  const timeout = step.timeout || ctx.timeout || 15000;

  const need = (...names) => {
    for (const n of names) {
      if (step[n] === undefined || step[n] === null || step[n] === '') {
      return `步骤 ${idx + 1} (${action}) 缺少参数: ${n}`;
        }
    }
    return null;
  };

  // ── 意图驱动核心:语义定位 + 自愈 ──
  // 步骤没有显式 selector 时(意图模式常见),把人话 target 解析成真实可用的选择器。
  // 于是 UI 改版导致 selector 失效时,会自动回退到 text/role/label 等语义候选。
  ctx.lastLocate = null;
  if (LOCATOR_ACTIONS.has(action) && !step.selector && step.target) {
    const located = await locateWithHeal(page, { ...step, fillable: FILLABLE_ACTIONS.has(action) });
    if (!located.selector) {
      return { ok: false, error: located.error, detail: located.detail, tried: located.tried || [] };
    }
    step.selector = located.selector;
    ctx.lastLocate = {
      strategy: located.strategy,
      selfHealed: located.selfHealed,
      tried: located.tried,
    };
  }

  const sel = step.selector || step.target || step.locator;

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
// 意图驱动(intent-driven)支撑能力:语义定位 / 自愈 / 页面观察 / 视觉基线
// ------------------------------------------------------------
// 对标 Harness "AI-Powered Intent Testing" 五步:
//   ② AI 推理与探索:observePage() 提供紧凑 DOM,decide 由模型决定下一步
//   ③ 执行↔推理闭环:每步执行后回传 observation,再取下一步
//   ④ 视觉 + DOM 双重校验:assertion 客观校验 + compareVisualBaseline()
// 关键设计:不依赖硬编码选择器 —— resolveSemantic() 把"人话目标"展开成
// 多个候选定位,locateWithHeal() 依次尝试,原选择器失效时自动改用语义候选。
// ============================================================

// 视觉基线目录: <root>/backend/output/ui-baseline/
const VISUAL_OUTPUT_DIR = path.join(
  path.resolve(__dirname, '..', '..', '..', 'backend'),
  'output',
  'ui-baseline'
);

function sanitizeKey(s) {
  return String(s || 'case')
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .slice(0, 60);
}

/**
 * 生成"字符间允许任意空白"的正则源,用于「登 录」↔「登录」这类宽松匹配。
 * 中文按钮常带排版空格(登 录 / 确 定 / 取 消),与模型输出的紧凑写法字面不同,
 * 不做这层归一化,语义定位必然失效 —— 这是自愈能力的关键一环。
 */
function flexSpaceSource(t) {
  const chars = Array.from(String(t || '').replace(/\s+/g, ''));
  if (!chars.length) return '';
  return chars
    .map((c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
    .join('\\s*');
}

/**
 * 把"人话目标"或显式选择器展开成**候选选择器字符串**列表
 * 返回字符串而非 Locator,好处:可自愈、可记录、可回流知识库、可跨步骤复用。
 * @returns {Array<{selector: string, strategy: string}>}
 */
function resolveSemantic(target, fallbackSelector, opts = {}) {
  const t = String(target || '').trim();
  const cands = [];
  const push = (selector, strategy) => cands.push({ selector, strategy });

  if (fallbackSelector) {
    push(String(fallbackSelector), 'explicit-selector');
  }

  if (!t) return cands;

  // 显式语义表达式(text=/role=/label=/placeholder=)
  const textM = t.match(/^text=(.+)$/i);
  const roleM = t.match(/^role=([\w]+)(?:\s*\[\s*name\s*=\s*["']?([^\]"']*)["']?\s*\])?/i);
  const labelM = t.match(/^label=(.+)$/i);
  const phM = t.match(/^placeholder=(.+)$/i);

  if (textM) {
    push(`text=${textM[1]}`, 'getByText');
    return cands;
  }

  if (roleM) {
    push(`role=${roleM[1]}[name="${roleM[2] || ''}"]`, `getByRole:${roleM[1]}`);
  } else if (labelM) {
    push(`label=${labelM[1]}`, 'getByLabel');
  } else if (phM) {
    push(`placeholder=${phM[1]}`, 'getByPlaceholder');
  } else if (/^[#.\[]/.test(t) || /\w+\s*[~^$*+]?=/.test(t)) {
    push(t, 'css');
  }

  // 人话兜底:同一语义的多种定位尝试 —— 这就是"自愈"的来源
  if (!textM && !roleM && !labelM && !phM) {
    const flex = flexSpaceSource(t);
    const noSpace = t.replace(/\s+/g, '');
    const hasFlex = flex && flex !== t;

    const byText = () => {
      push(`text=${t}`, 'getByText');
      // 宽松空白:命中「登 录」这类带排版空格的按钮
      if (hasFlex) push(`text=/${flex}/`, 'getByText:flexSpace');
    };

    // 可输入型动作(fill/type)优先命中真正的输入控件:
    // 否则「密码」会先命中"切换密码可见性"这类 role=button 的图标而 fill 失败
    const byEditable = () => {
      push(`input[placeholder*="${t}"]`, 'css:input[placeholder]');
      if (hasFlex) push(`input[placeholder*="${noSpace}"]`, 'css:input[placeholder]:noSpace');
      if (/密\s*码|pwd|pass/i.test(t)) push('input[type="password"]', 'css:input[type=password]');
      push(`input[name*="${t}"]`, 'css:input[name]');
      push(`input[id*="${t}"]`, 'css:input[id]');
      push(`textarea[placeholder*="${t}"]`, 'css:textarea[placeholder]');
      push(`role=textbox[name="${t}"]`, 'getByRole:textbox');
    };

    const byRole = () => {
      push(`role=button[name="${t}"]`, 'getByRole:button');
      if (hasFlex) push(`role=button[name=/${flex}/]`, 'getByRole:button:flexSpace');
      push(`role=link[name="${t}"]`, 'getByRole:link');
      if (hasFlex) push(`role=link[name=/${flex}/]`, 'getByRole:link:flexSpace');
      push(`role=textbox[name="${t}"]`, 'getByRole:textbox');
      push(`role=checkbox[name="${t}"]`, 'getByRole:checkbox');
      push(`role=radio[name="${t}"]`, 'getByRole:radio');
      push(`role=combobox[name="${t}"]`, 'getByRole:combobox');
    };

    const byAttr = () => {
      // 说明:Playwright 没有 label= / placeholder= 选择器引擎(会抛 Unknown engine),
      //      这里改用等价的 CSS 属性匹配。
      push(`[aria-label*="${t}"]`, 'attr:aria-label');
      push(`[placeholder*="${t}"]`, 'attr:placeholder');
      push(`[title*="${t}"]`, 'attr:title');
      push(`[name*="${t}"]`, 'attr:name');
      push(`[id*="${t}"]`, 'attr:id');
      if (noSpace && noSpace !== t) {
        push(`[aria-label*="${noSpace}"]`, 'attr:aria-label:noSpace');
        push(`[placeholder*="${noSpace}"]`, 'attr:placeholder:noSpace');
        push(`[id*="${noSpace}"]`, 'attr:id:noSpace');
      }
    };

    if (opts.fillable) {
      byEditable();
      byAttr();
      byRole();
      byText();
    } else {
      byText();
      byRole();
      byAttr();
    }
  }

  return cands;
}

/**
 * 带自愈的元素定位:先试显式选择器,失效则按语义候选依次回退
 * @returns {Promise<{selector: string|null, strategy: string, selfHealed: boolean, tried: string[], error?: string, detail?: string}>}
 */
async function locateWithHeal(page, step) {
  const cands = resolveSemantic(step.target, step.selector, { fillable: !!step.fillable });
  const requireVisible = step.requireVisible !== false;
  const tried = [];

  if (cands.length === 0) {
    return { selector: null, strategy: '', selfHealed: false, tried, error: '缺少定位信息(selector 或 target)' };
  }

  for (let i = 0; i < cands.length; i++) {
    const { selector, strategy } = cands[i];
    try {
      const loc = page.locator(selector);
      // eslint-disable-next-line no-await-in-loop
      const n = await loc.count();
      if (n > 0) {
        // eslint-disable-next-line no-await-in-loop
        const visible = await loc.first().isVisible().catch(() => false);
        // expectHidden 只需元素存在;其余动作要求可见
        if (visible || !requireVisible) {
          // 填充类动作必须落到可输入控件上:命中图标/按钮会导致 fill 抛错,
          // 这里把它当作"候选不成立",继续回退 —— 自愈的关键判定
          if (step.fillable) {
            // eslint-disable-next-line no-await-in-loop
            const editable = await loc
              .first()
              .evaluate((el) => {
                const tag = (el.tagName || '').toLowerCase();
                return (
                  tag === 'input' ||
                  tag === 'textarea' ||
                  tag === 'select' ||
                  el.isContentEditable === true
                );
              })
              .catch(() => false);
            if (!editable) {
              tried.push(`${strategy}: 匹配 ${n} 个但不可输入`);
              continue;
            }
          }
          return {
            selector,
            strategy,
            // 第 0 个候选是显式选择器;命中非它,或压根没给显式选择器,都算发生过自愈
            selfHealed: i > 0 || !step.selector,
            tried,
          };
        }
        tried.push(`${strategy}: 匹配 ${n} 个但不可见`);
      } else {
        tried.push(`${strategy}: 未匹配`);
      }
    } catch (e) {
      tried.push(`${strategy}: ${e && e.message}`);
    }
  }

  const desc = step.target || step.description || '(未指定目标)';
  return {
    selector: null,
    strategy: '',
    selfHealed: false,
    tried,
    error: `无法定位目标「${desc}」`,
    detail: tried.join('; '),
  };
}

/**
 * 采集紧凑 DOM 快照(供模型决策):URL / 标题 / 可见文本 / 可交互元素
 */
async function observePage(page, opts = {}) {
  const maxElements = opts.maxElements || 40;
  try {
    return await page.evaluate((limit) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      const labelOf = (el) => {
        const parts = [
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
          el.getAttribute('title'),
          el.getAttribute('name'),
          el.id ? `#${el.id}` : '',
          (el.textContent || '').trim(),
        ].filter(Boolean);
        return parts.join(' | ').trim().slice(0, 80);
      };

      const elements = Array.from(
        document.querySelectorAll(
          'a, button, input, select, textarea, [role=button], [role=link], [role=textbox], [role=checkbox], [role=radio], [role=combobox], [onclick]'
        )
      )
        .filter(vis)
        .slice(0, limit)
        .map((el, i) => {
          const r = el.getBoundingClientRect();
          return {
            idx: i,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            label: labelOf(el),
            box: [
              Math.round(r.x / 8) * 8,
              Math.round(r.y / 8) * 8,
              Math.round(r.width / 8) * 8,
              Math.round(r.height / 8) * 8,
            ],
          };
        });

      const errorSelectors = [
        '.el-message--error',
        '.ant-message-error',
        '.el-form-item__error',
        '[role=alert]',
        '.error-message',
      ];
      const errors = [];
      errorSelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          const t = (el.textContent || '').trim();
          if (t && !errors.includes(t)) errors.push(t.slice(0, 200));
        });
      });

      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();

      return {
        url: window.location.href,
        title: document.title || '',
        text: bodyText.slice(0, 1500),
        headings: Array.from(document.querySelectorAll('h1,h2,h3'))
          .map((h) => (h.textContent || '').trim())
          .filter(Boolean)
          .slice(0, 10),
        elements,
        errors: errors.slice(0, 10),
      };
    }, maxElements);
  } catch (e) {
    return {
      url: null,
      title: null,
      text: '',
      headings: [],
      elements: [],
      errors: [],
      observeError: String(e && e.message),
    };
  }
}

/**
 * 判断是否落到了登录页(URL 命中 /login 或页面存在密码框)
 * —— 意图驱动的前置条件探测:未认证时 SPA 会重定向到登录页,
 *    若不识别,模型会在登录页上臆造"返回首页"之类不存在的元素。
 */
async function looksLikeLoginPage(page) {
  try {
    const u = String(page.url() || '');
    if (/\/(login|signin|sign-in|auth)(\?|#|$)/i.test(u)) return true;
    const hasPwd = await page
      .locator('input[type="password"]')
      .count()
      .catch(() => 0);
    return hasPwd > 0;
  } catch (_) {
    return false;
  }
}

/**
 * 轮询等待"离开登录页"。
 * 不能用 waitForLoadState('networkidle'):平台有 SSE 长连接,网络永不静默,
 * 固定等待会误判为"登录失败"。这里直接轮询登录态特征。
 * @returns {Promise<boolean>} true=已登录(离开登录页)
 */
async function waitForLoginResult(page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const stillLogin = await looksLikeLoginPage(page);
    if (!stillLogin) return true;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }
  return !(await looksLikeLoginPage(page));
}

/**
 * 登录自愈:用语义定位填用户名/密码并点登录按钮。
 * 凭证只在运行时通过 vars 注入({{username}}/{{password}}),不落库、不写日志。
 * @returns {Promise<{ok: boolean, detail: string, error?: string}>}
 */
async function performLogin(page, creds, ctx) {
  const t = ctx?.timeout || 15000;
  const tried = [];
  try {
    const u = creds.username || ctx?.vars?.username || '';
    const p = creds.password || ctx?.vars?.password || '';
    if (!u || !p) {
      return { ok: false, detail: '', error: '提供了 credentials 但缺少 username/password,跳过自动登录' };
    }

    const userSel = await locateWithHeal(page, {
      target: '用户名',
      selector: creds.usernameSelector || '',
      fillable: true,
    });
    if (!userSel.selector) {
      // 兜底:登录页常见选择器
      const fallbacks = [
        'input[type="text"]',
        'input[name="username"]',
        'input[placeholder*="用户名"], input[placeholder*="账号"], input[placeholder*="邮箱"]',
        '#username',
      ];
      for (const sel of fallbacks) {
        // eslint-disable-next-line no-await-in-loop
        const n = await page.locator(sel).count().catch(() => 0);
        if (n > 0) {
          userSel.selector = sel;
          userSel.strategy = 'fallback:username';
          break;
        }
        tried.push(`username fallback ${sel}: 未匹配`);
      }
    }
    if (!userSel.selector) {
      return { ok: false, detail: tried.join('; '), error: '登录自愈失败:未找到用户名输入框' };
    }

    // eslint-disable-next-line no-await-in-loop
    await page.locator(userSel.selector).first().fill(u, { timeout: t });

    const pwdSel = await locateWithHeal(page, {
      target: '密码',
      selector: creds.passwordSelector || '',
      fillable: true,
    });
    const pwdFinal = pwdSel.selector || 'input[type="password"]';
    // eslint-disable-next-line no-await-in-loop
    await page.locator(pwdFinal).first().fill(p, { timeout: t });

    const btnSel = await locateWithHeal(page, { target: '登录', selector: creds.submitSelector || '' });
    let btnFinal = btnSel.selector;
    if (!btnFinal) {
      // 兜底:登录页常见提交按钮(带排版空格的中文文案已被 flexSpace 覆盖,这里再补结构型兜底)
      for (const sel of ['button[type="submit"]', 'form button.primary', '.login-btn', 'form button']) {
        // eslint-disable-next-line no-await-in-loop
        const n = await page.locator(sel).count().catch(() => 0);
        if (n > 0) {
          btnFinal = sel;
          break;
        }
        tried.push(`submit fallback ${sel}: 未匹配`);
      }
    }
    if (!btnFinal) {
      return { ok: false, detail: tried.join('; '), error: '登录自愈失败:未找到登录按钮' };
    }
    // eslint-disable-next-line no-await-in-loop
    await page.locator(btnFinal).first().click({ timeout: t });

    const loggedIn = await waitForLoginResult(page, 15000);
    return {
      ok: loggedIn,
      detail: `自动登录(用户名字段=${userSel.strategy}) 完成,当前地址 ${page.url()}`,
      error: loggedIn ? undefined : '自动登录后仍停留在登录页,可能凭证有误或登录接口超时',
    };
  } catch (e) {
    return { ok: false, detail: tried.join('; '), error: `自动登录异常: ${e && e.message}` };
  }
}

/** 结构签名:元素 (tag:label:box) —— 用于视觉/布局回归比对 */
function signatureOf(obs) {
  return (obs.elements || []).map((e) => `${e.tag}:${e.label}:${e.box.join(',')}`);
}

/** 视觉回归:结构签名比对 + 截图留存 */
async function compareVisualBaseline({ page, caseName, mode = 'compare', threshold = 0.15 }) {
  const key = sanitizeKey(caseName);
  const baseFile = path.join(VISUAL_OUTPUT_DIR, `${key}.json`);
  const shot = await takeScreenshot(page, `visual-${key}`, { fullPage: true });
  const obs = await observePage(page);
  const sig = signatureOf(obs);

  const result = {
    mode,
    threshold,
    screenshot: shot,
    elementCount: sig.length,
    baselineFile: baseFile,
    verdict: 'skipped',
    missing: [],
    added: [],
    moved: [],
    diffRatio: 0,
    note: '',
  };

  if (mode === 'off') {
    result.note = '视觉回归已关闭';
    return result;
  }

  try {
    fs.mkdirSync(VISUAL_OUTPUT_DIR, { recursive: true });
    const existed = fs.existsSync(baseFile);
    const prev = existed ? JSON.parse(fs.readFileSync(baseFile, 'utf-8')) : null;
    const prevSig = Array.isArray(prev?.signature) ? prev.signature : [];

    if (mode === 'update' || !existed || prevSig.length === 0) {
      fs.writeFileSync(
        baseFile,
        JSON.stringify(
          { key, signature: sig, updatedAt: new Date().toISOString(), screenshot: shot?.path || null },
          null,
          2
        ),
        'utf-8'
      );
      result.verdict = mode === 'update' ? 'updated' : 'baseline_created';
      result.note = mode === 'update' ? '已更新视觉基线' : '首次执行,已建立视觉基线';
      return result;
    }

    const keyOf = (s) => s.split(':').slice(0, 2).join(':');
    const boxOf = (s) => s.split(':').slice(2).join(':');
    const prevMap = new Map(prevSig.map((s) => [keyOf(s), boxOf(s)]));
    const curMap = new Map(sig.map((s) => [keyOf(s), boxOf(s)]));

    const missing = prevSig.filter((s) => !curMap.has(keyOf(s))).map((s) => keyOf(s));
    const added = sig.filter((s) => !prevMap.has(keyOf(s))).map((s) => keyOf(s));
    const moved = [];
    curMap.forEach((box, k) => {
      if (prevMap.has(k) && prevMap.get(k) !== box) moved.push({ element: k, from: prevMap.get(k), to: box });
    });

    const changed = missing.length + added.length + moved.length;
    const denom = Math.max(prevSig.length, sig.length, 1);
    result.diffRatio = Number((changed / denom).toFixed(3));
    result.missing = missing.slice(0, 20);
    result.added = added.slice(0, 20);
    result.moved = moved.slice(0, 20);
    result.verdict = result.diffRatio <= threshold ? 'pass' : 'fail';
    result.note =
      result.verdict === 'pass'
        ? `与基线一致(差异率 ${result.diffRatio})`
        : `检测到疑似视觉/布局回归(差异率 ${result.diffRatio} > 阈值 ${threshold})`;
    return result;
  } catch (e) {
    result.verdict = 'error';
    result.note = `视觉比对失败: ${e && e.message}`;
    return result;
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
      executed.push({
        step: i + 1,
        action: (steps[i] || {}).action,
        ok: r.ok,
        detail: r.detail,
        error: r.error,
        locate: caseCtx.lastLocate || undefined,
        screenshot: r.screenshot || undefined,
      });
      caseCtx.lastLocate = null;
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
// 意图驱动(intent)模式:执行 ↔ 推理闭环
// ------------------------------------------------------------
// goal → parseIntent(①) → goto(entry) → 循环 { observe(②) → 断言校验(④)
//   → 模型决定下一步(③) → 执行 } → 视觉基线比对(④) → UTRM
// 失败不立即退出:把失败反馈给模型,让它换路径/换定位重试(自愈 + 迭代发现)。
// ============================================================

let _engine = null;
function getIntentEngine() {
  if (_engine !== null) return _engine;
  try {
    // __dirname = <root>/qclaw-skills/ui-direct-invoker/backend
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

/** 客观校验一条断言(模型只负责提断言点,判定在这里完成) */
async function checkAssertion(page, a) {
  const type = String((a && a.type) || 'text').toLowerCase();
  // 字段名兼容:parseIntent 输出 expectation,autoAssertions 输出 expected
  const expected = a && (a.expected !== undefined ? a.expected : a.expectation);
  const target = (a && a.target) || '';
  const base = {
    id: (a && a.id) || '',
    description: (a && a.description) || '',
    expected,
    target,
    type,
  };

  try {
    if (type === 'text') {
      const bodyText = String((await page.evaluate(() => document.body?.innerText || '')) || '');
      let actual = bodyText;
      let scope = '整页文本';
      let located = false;
      if (target) {
        const r = await locateWithHeal(page, { target, requireVisible: false });
        if (r.selector) {
          actual = String(
            (await page.locator(r.selector).first().textContent({ timeout: 5000 })) || ''
          );
          scope = `目标「${target}」(${r.strategy})`;
          located = true;
        } else {
          // 目标定位不到时回退整页文本:否则 actual 恒为空,判定结果会"证据失真"
          scope = `目标「${target}」未定位,回退整页文本`;
        }
      }
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const compact = (s) => String(s || '').replace(/\s+/g, '');
      const aNorm = norm(actual);
      let eNorm = norm(expected);
      // 中文排版空格(如「登 录」)会让字面比对失败,用去空格比对兜底
      let passed = eNorm
        ? aNorm.includes(eNorm) || compact(actual).includes(compact(expected))
        : false;
      let healNote = '';
      // 断言自愈:模型常把 expected 写成描述句(如"导航项文本可见")而非字面值。
      // 此时只要 target 这个干净字面量确实命中,就判定达成(不会掩盖真实失败,
      // 因为若目标真不存在,located 会是 false)。
      if (!passed && located && norm(target) && aNorm.includes(norm(target))) {
        passed = true;
        eNorm = norm(target);
        healNote = ' (模型 expected 写成描述句,已按 target 字面量判定)';
      }
      return {
        ...base,
        expected: eNorm,
        passed,
        actual: clip(aNorm, 300),
        evidence: passed
          ? `命中(${scope})${healNote}`
          : `页面未见期望文本「${expected}」(判定范围:${scope})`,
      };
    }

    if (type === 'visible') {
      const r = await locateWithHeal(page, { target, requireVisible: true });
      const passed = !!r.selector;
      return {
        ...base,
        passed,
        actual: passed ? '元素可见' : '元素未找到/不可见',
        evidence: passed ? '' : (r.tried || []).join('; '),
    };
  }

  if (type === 'url') {
    const actual = page.url();
    const passed = actual.includes(String(expected));
    return {
      ...base,
      passed,
      actual,
      evidence: passed ? '' : `当前 URL 未包含「${expected}」`,
    };
  }

  // UI 场景:dom / visual 断言 —— 语义定位确认目标存在即可
  // (视觉/布局差异由视觉基线比对覆盖,这里只做存在性校验,不臆造判定)
  if (type === 'dom' || type === 'visual') {
    const r = await locateWithHeal(page, { target, requireVisible: false });
    const passed = !!r.selector;
    return {
      ...base,
      passed,
      actual: passed ? '目标存在' : '目标未找到',
      evidence: passed ? '' : (r.tried || []).join('; '),
    };
  }

  return {
    ...base,
    passed: null,
    actual: null,
    evidence: '该断言类型不在 UI 执行器客观校验范围内(text/visible/url/dom/visual)',
  };
  } catch (e) {
    return { ...base, passed: false, actual: null, evidence: String(e && e.message) };
  }
}

/**
 * 意图模式:单场景执行(模型临场决策)
 */
async function runIntentCase(rawCase, ctx, browserCtx, index) {
  const engine = getIntentEngine();
  const started = Date.now();
  const name = rawCase.name || rawCase.title || `intent-${index + 1}`;
  const goal = rawCase.goal || rawCase.description || ctx.goal || '';

  const page = await browserCtx.newPage();
  if (ctx.viewport) await page.setViewportSize(ctx.viewport);
  page.setDefaultTimeout(ctx.timeout || 15000);

  const vars = { ...ctx.vars, ...(rawCase.vars || {}) };
  const caseCtx = { ...ctx, vars, goal, lastLocate: null };

  const executed = [];
  const reasoning = [];
  let assertionResults = [];
  let llmCalls = 0;
  let errorMsg = null;
  let steps = 0;

  try {
    // ① 解析意图(若调用方已给出结构化 intent 则直接复用)
    let intent = rawCase.intent;
    if (!intent) {
      intent = await engine.parseIntent({
        kind: 'ui',
        input: goal || rawCase.raw || '',
        baseUrl: ctx.baseUrl || '',
        env: sanitizeVars(vars),
      });
      llmCalls++;
    }

    // 断言来源:用例显式给出 > 意图解析结果;统一字段名(expected/expectation)与字面量
    const normAssertions = (list) =>
      (Array.isArray(list) ? list : []).map((a, i) => {
        if (!a || typeof a !== 'object') return a;
        const expected = a.expected !== undefined ? a.expected : a.expectation;
        return {
          ...a,
          id: a.id || `A${i + 1}`,
          expected: engine.normalizeExpected ? engine.normalizeExpected(expected) : expected,
          target: engine.normalizeTarget ? engine.normalizeTarget(a.target) : a.target,
        };
      });

    let assertions = normAssertions(
      Array.isArray(rawCase.assertions) && rawCase.assertions.length
        ? rawCase.assertions
        : (intent.assertions || [])
    );

    // 起始 URL 决策:用例 > 意图 > 基地址
    let startUrlUsed = '';
    const start = rawCase.startUrl || intent.entry?.startUrl || ctx.baseUrl || '';
    if (start) {
      const url = joinUrl(ctx.baseUrl, start);
      startUrlUsed = url;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ctx.timeout || 15000 });
      // SPA 首屏需要时间渲染:等网络静默 + 固定缓冲,再做观察与断言,避免误判"页面无内容"
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch (_) {
        /* 页面持续有请求时忽略 */
      }
      await page.waitForTimeout(800);
      executed.push({ step: ++steps, action: 'goto', ok: true, detail: `goto ${url}` });
    }

    // ①.5 前置条件自愈:未认证时 SPA 会重定向到登录页,先自动登录再交给模型决策,
    //      否则模型会在登录页臆造"返回首页"之类快照中不存在的元素。
    if (ctx.credentials && await looksLikeLoginPage(page)) {
      // eslint-disable-next-line no-await-in-loop
      const lr = await performLogin(page, ctx.credentials, ctx);
      executed.push({
        step: ++steps,
        action: 'login',
        target: ctx.credentials.username || '{{username}}',
        ok: lr.ok,
        detail: lr.detail,
        error: lr.error,
      });
      if (!lr.ok) errorMsg = lr.error;
    }

    let consecutiveFailures = 0;
    const maxConsecutiveFailures = Number(ctx.maxConsecutiveFailures || 2);

    while (steps < (ctx.maxSteps || 25) && llmCalls < (ctx.maxLlmCalls || 12)) {
      // ② 观察当前应用状态
      // eslint-disable-next-line no-await-in-loop
      const obs = await observePage(page, { maxElements: ctx.maxElements || 40 });

      // ③ 让模型决定下一步(单次决策失败不终止整个用例,记录后退出循环)
      let d;
      try {
        // eslint-disable-next-line no-await-in-loop
        d = await engine.decideNext({
          kind: 'ui',
          intent,
          observation: obs,
          history: executed,
          remaining: (ctx.maxSteps || 25) - steps,
          startUrl: startUrlUsed,
          lastError: errorMsg || '',
        });
      } catch (de) {
        llmCalls++;
        const msg = `决策失败: ${de && de.message}`;
        reasoning.push(msg);
        errorMsg = msg;
        break;
      }
      llmCalls++;
      reasoning.push(d.reasoning);

      if (d.done || !d.action || !d.action.action || d.action.action === 'finish') {
        break;
      }

      // 执行模型给出的动作(语义定位 + 自愈在 runStep 内完成)
      // eslint-disable-next-line no-await-in-loop
      const r = await runStep(page, d.action, caseCtx, steps);
      executed.push({
        step: steps + 1,
        action: d.action.action,
        target: d.action.target,
        ok: r.ok,
        detail: r.detail,
        error: r.error,
        locate: caseCtx.lastLocate || undefined,
      });
      caseCtx.lastLocate = null;

      if (!r.ok) {
        consecutiveFailures++;
        errorMsg = r.error;
        if (consecutiveFailures > maxConsecutiveFailures) {
          errorMsg = `连续 ${consecutiveFailures} 步失败,判定阻塞: ${r.error}`;
          break;
        }
        // 不退出:把失败回传给模型,让它换路径重试(迭代发现 + 自愈)
      } else {
        consecutiveFailures = 0;
        errorMsg = null;
      }
      steps++;
    }

    // ④ 断言:模型提点(无显式断言时按最终页面状态临时生成) + 执行器本地客观判定
    if (!assertions.length && ctx.autoAssert !== false && llmCalls < (ctx.maxLlmCalls || 12)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const finalObs = await observePage(page, { maxElements: ctx.maxElements || 40 });
        // eslint-disable-next-line no-await-in-loop
        const generated = await engine.autoAssertions({ kind: 'ui', intent, observation: finalObs });
        llmCalls++;
        assertions = (Array.isArray(generated) ? generated : []).filter(
          (a) => a && a.expected !== undefined && a.expected !== null && String(a.expected) !== ''
        );
      } catch (e) {
        /* 断言生成失败不影响主流程判定 */
      }
    }

    if (assertions.length) {
      assertionResults = [];
      for (const a of assertions) {
        // eslint-disable-next-line no-await-in-loop
        assertionResults.push(await checkAssertion(page, a));
      }
    }

    // ④ 视觉回归:结构签名比对 + 截图留存
    const visual = await compareVisualBaseline({
      page,
      caseName: name,
      mode: ctx.visualMode || 'compare',
      threshold: ctx.visualThreshold,
    });

    const duration = Date.now() - started;
    const failedAssertions = assertionResults.filter((x) => x.passed === false);
    const status = errorMsg || failedAssertions.length > 0 ? 'failed' : 'passed';

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
      classname: 'ui-direct-intent',
      status,
      duration,
      error: errorMsg || (failedAssertions[0] ? failedAssertions[0].description : null),
      stack: failedAssertions.map((f) => `${f.id}: ${f.description} — ${f.evidence}`).join('\n') || errorMsg,
      steps: executed,
      reasoning,
      url: lastUrl,
      screenshot: visual?.screenshot || null,
      intent: {
        goal: intent.goal || goal,
        successSignal: intent.successSignal || '',
        assertions: assertionResults,
      },
      visual,
      llmCalls,
    };
  } catch (e) {
    await page.close().catch(() => {});
    return {
      name,
      classname: 'ui-direct-intent',
      status: 'failed',
      duration: Date.now() - started,
      error: `意图执行异常: ${e && e.message}`,
      stack: String(e && e.stack),
      steps: executed,
      reasoning,
      llmCalls,
    };
  }
}

/** 意图模式用例归一化:支持 cases 数组或单个 goal */
function normalizeIntentCases(p) {
  if (Array.isArray(p.cases) && p.cases.length) return p.cases;
  if (p.goal) {
    return [{ name: p.name || '意图场景', goal: p.goal, startUrl: p.startUrl || '' }];
  }
  return [];
}

/**
 * 意图模式前置校验
 * @returns {{ok: true, cases: Array} | {ok: false, utr: object}}
 */
function prepareIntent(p) {
  const engine = getIntentEngine();
  const fail = (error, raw) => {
    const r = toUTRM(
      { testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } },
      'ui-direct',
      1,
      raw
    );
    r.error = error;
    return { ok: false, utr: r };
  };

  if (!engine) return fail('ENGINE_NOT_FOUND', '未能加载 intent-engine');
  if (!engine.isAvailable()) {
    return fail(
      'NO_LLM_KEY',
      '未配置 DEEPSEEK_API_KEY,intent 模式不可用;请改用 mode="script" 并传入 steps/cases。'
    );
  }

  const cases = normalizeIntentCases(p);
  if (cases.length === 0) {
    return fail('MISSING_INTENT', 'intent 模式需要 goal 或非空 cases');
  }

  return { ok: true, cases };
}

// ============================================================
// 统一入口
// ============================================================

/**
 * @param {object} params
 * @param {string} [params.mode='script']       script=按 steps/cases 执行(默认);
 *                                              intent=意图驱动(模型临场决定每一步,支持自愈与视觉回归)
 * @param {string} [params.baseUrl]
 * @param {string} [params.browser='chromium']   chromium / firefox / webkit
 * @param {boolean}[params.headless=true]
 * @param {object} [params.viewport]             { width, height }
 * @param {number} [params.timeout=15000]        单步超时(ms)
 * @param {boolean}[params.screenshotOnFail=true]
 * @param {boolean}[params.screenshotOnSuccess=false]
 * @param {Array}  [params.cases]                场景数组(script 模式:每项含 steps;intent 模式:每项含 goal)
 * @param {Array}  [params.steps]                单场景简写(script 模式,与 cases 二选一)
 * @param {string} [params.goal]                 意图模式:自然语言测试目标
 * @param {number} [params.maxSteps=25]           intent 模式最大步骤数
 * @param {number} [params.maxLlmCalls=12]        intent 模式最大模型调用次数(成本控制)
 * @param {string} [params.visualMode='compare'] compare(默认)/update/off —— 视觉回归基线
 * @param {number} [params.visualThreshold=0.15]  视觉差异率阈值,超出判 fail
 * @param {object} [params.credentials]           登录凭证 {username,password},注入 {{username}}/{{password}}
 * @param {boolean}[params.stopOnFail=false]
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invoke(params) {
  const p = params || {};
  const intentMode = String(p.mode || '').toLowerCase() === 'intent';

  // intent 模式:先做前置校验(模型可用性 / 目标是否给出)
  let cases;
  if (intentMode) {
    const prepared = prepareIntent(p);
    if (!prepared.ok) return prepared.utr;
    cases = prepared.cases;
  } else {
    cases = Array.isArray(p.cases)
      ? p.cases
      : Array.isArray(p.steps)
      ? [{ name: 'UI 直执场景', steps: p.steps }]
      : [];
  }

  if (cases.length === 0) {
    const r = toUTRM({ testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } }, 'ui-direct', 1, intentMode ? 'intent 模式需要 goal 或非空 cases' : 'cases/steps 为空:未提供任何步骤。');
    r.error = intentMode ? 'MISSING_INTENT' : 'MISSING_STEPS';
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
    // ── intent 模式参数 ──
    intentMode,
    goal: p.goal || '',
    credentials: p.credentials || null,
    maxSteps: p.maxSteps || 25,
    maxLlmCalls: p.maxLlmCalls || 12,
    maxConsecutiveFailures: p.maxConsecutiveFailures === undefined ? 2 : p.maxConsecutiveFailures,
    maxElements: p.maxElements || 40,
    visualMode: p.visualMode || 'compare',
    visualThreshold: p.visualThreshold === undefined ? 0.15 : p.visualThreshold,
    lastLocate: null,
  };

  // intent 模式:凭证注入为 {{username}} / {{password}} 变量,供模型生成的步骤引用
  if (intentMode && p.credentials) {
    if (p.credentials.username) ctx.vars.username = p.credentials.username;
    if (p.credentials.password) ctx.vars.password = p.credentials.password;
  }

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
      // script 模式要求 steps 非空;intent 模式只要求给出 goal(或结构化 intent)
      const valid = intentMode
        ? !!(c && (c.goal || c.intent))
        : !!(c && Array.isArray(c.steps) && c.steps.length > 0);
      if (!c || c.skip || !valid) {
        skipped++;
        testcases.push({
          name: (c && (c.name || c.title)) || `case-${i + 1}`,
          classname: 'ui-direct',
          status: 'skipped',
          duration: 0,
          error: !c || c.skip ? null : intentMode ? 'MISSING_INTENT' : 'MISSING_STEPS',
          stack: !c || c.skip ? null : intentMode ? '场景缺少 goal' : '场景缺少 steps 数组',
        });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = intentMode
        ? // eslint-disable-next-line no-await-in-loop
          await runIntentCase(c, ctx, browserCtx, i)
        : // eslint-disable-next-line no-await-in-loop
          await runCase(c, ctx, browserCtx, i);
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

module.exports = {
  invoke,
  toUTRM,
  runStep,
  runIntentCase,
  observePage,
  compareVisualBaseline,
  resolveSemantic,
  locateWithHeal,
  loadPlaywright,
};
