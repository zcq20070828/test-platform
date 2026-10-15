/**
 * 多端步骤执行引擎(移动端 / PC 客户端共用)
 * ============================================================
 * 动作词汇表刻意与 ui-direct-invoker(Web)保持同名同语义,差异部分才做平台适配。
 * 好处:模型从用例文档翻译出来的 steps 无需区分平台;同一份意图/步骤
 * 在 Web 与移动/桌面之间可平移。
 *
 * 动作: click / tap / fill / type / clear / press / swipe / scroll / wait /
 *      waitFor / expectVisible / expectHidden / expectExists / expectText /
 *      expectNotExists / screenshot / launch / restart / back / hideKeyboard / goto
 *
 * 平台差异处理:
 *   - goto 在移动/桌面没有地址栏概念 → 走 deep link(Appium)或直接报"不适用"
 *   - press 在 Android 映射为 keycode,其他平台映射为 W3C 键值
 *   - fill 前自动 clear,规避移动端输入法追加内容的问题
 */

'use strict';

const { saveShot, renderTemplate, clip } = require('./common');
const { DriverError } = require('./remote-driver');

/** 需要元素定位的动作 */
const LOCATOR_ACTIONS = new Set([
  'click', 'tap', 'dblclick', 'fill', 'type', 'clear', 'sendkeys',
  'waitfor', 'expectvisible', 'expecthidden', 'expectexists',
  'expecttext', 'expectnotexists', 'expectvalue',
]);

/** 缺失 selector 时是否允许回退到"整屏文本/源码"判定 */
const SOURCE_FALLBACK_ACTIONS = new Set(['expecttext', 'expectvisible', 'expectexists', 'expectnotexists', 'expecthidden', 'waitfor']);

// 常用按键: Android keycode / W3C 键值
const ANDROID_KEYS = { enter: 66, back: 4, home: 3, search: 84, menu: 82, power: 26,volume_up: 24, volume_down: 25 };
const W3C_KEYS = { enter: '\uE007', backspace: '\uE003', delete: '\uE017', escape: '\uE00C', tab: '\uE004', space: '\uE00D', back: '\uE007' };

/**
 * 执行单个步骤
 * @param {import('./remote-driver').RemoteSession} session
 * @param {object} rawStep
 * @param {object} ctx { vars, timeout, platform, tag }
 * @param {number} idx
 * @returns {Promise<{ok:boolean, detail?:string, error?:string, locate?:object}>}
 */
async function runStep(session, rawStep, ctx, idx) {
  const step = renderTemplate(rawStep || {}, ctx.vars);
  const action = String(step.action || step.type || '').toLowerCase().replace(/[_-]/g, '');
  const timeout = Number(step.timeout || ctx.timeout || 15000);
  const platform = (ctx.platform || step.platform || '').toLowerCase();

  const need = (...names) => {
    for (const n of names) {
      if (step[n] === undefined || step[n] === null || step[n] === '') return `步骤 ${idx + 1} (${action}) 缺少参数: ${n}`;
    }
    return null;
  };
  const sel = step.selector !== undefined ? step.selector : (step.target !== undefined ? step.target : step.locator);

  /** 统一取元素 */
  const resolveEl = async () => {
    const found = await session.elements(sel, { timeoutMs: timeout, platform });
    return found;
  };

  try {
    switch (action) {
      // ── 应用级动作 ──
      case 'launch':
      case 'launchapp': {
        await session.launchApp(step.appId || step.bundleId || step.appPackage || null);
        return { ok: true, detail: `launch app ${step.appId || step.bundleId || step.appPackage || '(当前会话应用)'}` };
      }
      case 'restart':
      case 'restartapp': {
        await session.closeApp();
        await new Promise((r) => setTimeout(r, 500));
        await session.launchApp(step.appId || step.bundleId || step.appPackage || null);
        return { ok: true, detail: 'restart app' };
      }
      case 'close':
      case 'closeapp': {
        await session.closeApp();
        return { ok: true, detail: 'close app' };
      }
      case 'back': {
        if (platform === 'android') await session.pressKey(ANDROID_KEYS.back);
        else await session.executeScript('mobile: pressButton', [{ name: 'back' }]).catch(() => null);
        return { ok: true, detail: 'press back' };
      }
      case 'hidekeyboard': {
        await session.executeScript('mobile: hideKeyboard', []).catch(() => null);
        return { ok: true, detail: 'hide keyboard' };
      }

      // ── 页面/导航 ──
      case 'goto':
      case 'navigate': {
        const miss = need('url');
        if (miss) return { ok: false, error: miss };
        const url = String(step.url);
        if (platform === 'windows' || platform === 'mac') {
          return { ok: false, error: `PC 客户端不支持 goto 地址栏,请改用 click 打开应用内入口。若确为网页场景请改用 ui-direct-invoker(Web)` };
        }
        // 移动端:deep link 拉起指定页面
        await session.executeScript('mobile: deepLink', [{ url, package: step.appPackage || step.bundleId }]).catch(async (e) => {
          throw new DriverError('DEEPLINK_FAILED', `deep link 拉起失败(${url}): ${e && e.message}`, null);
        });
        return { ok: true, detail: `deep link ${url}` };
      }

      // ── 元素交互 ──
      case 'click':
      case 'tap': {
        const miss = need('selector');
        if (miss && !sel) return { ok: false, error: miss };
        const f = await resolveEl();
        await session.click(f.el);
        return { ok: true, detail: `click ${sel}`, locate: { strategy: f.using, value: f.value, from: f.from } };
      }
      case 'dblclick': {
        if (!sel) return { ok: false, error: `步骤 ${idx + 1} (dblclick) 缺少参数: selector` };
        const f = await resolveEl();
        await session.click(f.el);
        await session.click(f.el);
        return { ok: true, detail: `dblclick ${sel}` };
      }
      case 'fill':
      case 'type':
      case 'sendkeys': {
        const miss = need('value');
        if (miss) return { ok: false, error: miss };
        if (!sel) return { ok: false, error: `步骤 ${idx + 1} (${action}) 缺少参数: selector` };
        const f = await resolveEl();
        if (action === 'fill' || action === 'type') {
          try { await session.clear(f.el); } catch (_) { /* 部分控件不支持 clear */ }
        }
        await session.sendKeys(f.el, String(step.value));
        return { ok: true, detail: `${action} ${sel}`, locate: { strategy: f.using, value: f.value, from: f.from } };
      }
      case 'clear': {
        if (!sel) return { ok: false, error: `步骤 ${idx + 1} (clear) 缺少参数: selector` };
        const f = await resolveEl();
        await session.clear(f.el);
        return { ok: true, detail: `clear ${sel}` };
      }
      case 'press': {
        const key = String(step.key || step.value || '').toLowerCase();
        if (!key) return { ok: false, error: `步骤 ${idx + 1} (press) 缺少参数: key` };
        if (platform === 'android' && ANDROID_KEYS[key]) {
          await session.pressKey(ANDROID_KEYS[key]);
        } else if (sel) {
          await session.sendKeys((await resolveEl()).el, W3C_KEYS[key] || key);
        } else {
          // 无元素时:用 W3C 键盘动作在当前焦点输入
          await session.req('POST', `/session/${session.sessionId}/actions`, {
            actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: W3C_KEYS[key] || key }, { type: 'keyUp', value: W3C_KEYS[key] || key }] }],
          });
        }
        return { ok: true, detail: `press ${key}` };
      }
      case 'swipe':
      case 'scroll': {
        const { startX = 0.5, startY = 0.8, endX = 0.5, endY = 0.2, durationMs = 600, viewport = { width: 1080, height: 1920 } } = step;
        const w = Number(viewport.width) || 1080;
        const h = Number(viewport.height) || 1920;
        await session.swipe({
          startX: Math.round(Number(startX) * w), startY: Math.round(Number(startY) * h),
          endX: Math.round(Number(endX) * w), endY: Math.round(Number(endY) * h),
          durationMs: Number(durationMs) || 600,
        });
        return { ok: true, detail: `swipe (${startX},${startY})→(${endX},${endY})` };
      }
      case 'wait': {
        const ms = Number(step.ms || step.value || 1000);
        await new Promise((r) => setTimeout(r, ms));
        return { ok: true, detail: `wait ${ms}ms` };
      }
      case 'screenshot': {
        const b64 = await session.screenshotBase64();
        const shot = saveShot(b64, ctx.tag || 'remote', step.name || `step-${idx + 1}`);
        return { ok: true, detail: 'screenshot', screenshot: shot };
      }

      // ── 断言 ──
      case 'waitfor':
      case 'expectvisible':
      case 'expectexists': {
        if (!sel) {
          if (!SOURCE_FALLBACK_ACTIONS.has(action)) return { ok: false, error: `步骤 ${idx + 1} (${action}) 缺少参数: selector` };
          const src = await session.source();
          if (!src.includes(String(step.text || step.value || ''))) return { ok: false, error: `整屏未找到内容: ${clip(step.text || step.value, 200)}` };
          return { ok: true, detail: `expectExists(source contains)"${clip(step.text || step.value, 60)}"` };
        }
        const f = await resolveEl();
        const visible = await session.displayed(f.el).catch(() => true);
        if (action === 'expectvisible' && !visible) return { ok: false, error: `可见性断言失败: ${sel} 存在但不可见` };
        return { ok: true, detail: `${action} ${sel}`, locate: { strategy: f.using, value: f.value, from: f.from } };
      }
      case 'expecthidden':
      case 'expectnotexists': {
        if (!sel) return { ok: false, error: `步骤 ${idx + 1} (${action}) 缺少参数: selector` };
        try {
          const f = await session.elements(sel, { timeoutMs: Math.min(timeout, 2000), platform });
          const visible = await session.displayed(f.el).catch(() => true);
          return { ok: false, error: `${action === 'expecthidden' ? '隐藏' : '不存在'}断言失败: ${sel} 仍然存在${visible ? '且可见' : ''}` };
        } catch (e) {
          if (e && e.code === 'ELEMENT_NOT_FOUND') return { ok: true, detail: `${action} ${sel}` };
          throw e;
        }
      }
      case 'expecttext':
      case 'expect_text': {
        const want = String(step.text !== undefined ? step.text : step.value || '');
        if (!sel) {
          const src = await session.source();
          if (!src.includes(want)) return { ok: false, error: `整屏文本断言失败: 未找到 "${clip(want, 200)}"` };
          return { ok: true, detail: `expectText(source)"${clip(want, 60)}"` };
        }
        const f = await resolveEl();
        const actual = String(await session.text(f.el) || '');
        if (!actual.includes(want)) {
          return { ok: false, error: `文本断言失败 ${sel}: 期望包含 "${clip(want, 200)}",实际 "${clip(actual, 200)}"` };
        }
        return { ok: true, detail: `expectText ${sel}`, locate: { strategy: f.using, value: f.value, from: f.from } };
      }
      case 'expectvalue': {
        const miss = need('value');
        if (miss) return { ok: false, error: miss };
        const f = await resolveEl();
        const actual = String(await session.text(f.el) || '');
        if (actual.trim() !== String(step.value).trim()) {
          return { ok: false, error: `取值断言失败 ${sel}: 期望 "${clip(String(step.value), 200)}",实际 "${clip(actual, 200)}"` };
        }
        return { ok: true, detail: `expectValue ${sel}` };
      }

      default:
        return { ok: false, error: `未知步骤类型: "${step.action || step.type || '(空)'}"` };
    }
  } catch (e) {
    const code = e && e.code;
    // 元素找不到:附带多一点上下文,便于模型自愈换定位
    if (code === 'ELEMENT_NOT_FOUND') {
      return { ok: false, error: `${e.message}`, locate: { tried: e.detail && e.detail.tried } };
    }
    return { ok: false, error: `${code ? `[${code}] ` : ''}${e && e.message}` };
  }
}

/**
 * 执行一个场景的全部步骤
 * @returns {Promise<{name:string, status:string, duration:number, error:string|null, stack:string|null, steps:Array, screenshot:object|null}>}
 */
async function runCase(session, rawCase, ctx, index) {
  const started = Date.now();
  const name = rawCase.name || rawCase.title || `case-${index + 1}`;
  const steps = Array.isArray(rawCase.steps) ? rawCase.steps : [];
  const vars = { ...(ctx.vars || {}), ...(rawCase.vars || {}) };
  const caseCtx = { ...ctx, vars };

  const executed = [];
  let failedAt = -1;
  let errorMsg = null;
  let screenshot = null;

  for (let i = 0; i < steps.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const r = await runStep(session, steps[i], caseCtx, i);
    executed.push({
      step: i + 1,
      action: (steps[i] || {}).action || (steps[i] || {}).type,
      ok: r.ok,
      detail: r.detail,
      error: r.error,
      locate: r.locate,
    });
    if (!r.ok) {
      failedAt = i + 1;
      errorMsg = r.error;
      break;
    }
    // 变量提取:text:selector
    if (steps[i] && steps[i].extract) {
      // eslint-disable-next-line no-await-in-loop
      await extractVars(session, steps[i].extract, vars, ctx);
    }
  }

  const duration = Date.now() - started;
  const status = errorMsg ? 'failed' : 'passed';

  if (status === 'failed' && ctx.screenshotOnFail !== false) {
    try {
      screenshot = saveShot(await session.screenshotBase64(), ctx.tag || 'remote', `case-${index + 1}-fail`);
    } catch (_) { /* 截图失败不影响结果 */ }
  } else if (status === 'passed' && ctx.screenshotOnSuccess) {
    try {
      screenshot = saveShot(await session.screenshotBase64(), ctx.tag || 'remote', `case-${index + 1}-pass`);
    } catch (_) { /* ignore */ }
  }

  return {
    name,
    classname: ctx.tool || 'remote-e2e',
    status,
    duration,
    error: errorMsg,
    stack: errorMsg ? `步骤 ${failedAt} 失败: ${errorMsg}\n已执行: ${executed.map((e) => `${e.step}.${e.action || ''}${e.ok ? '' : '(FAIL)'}`).join(' → ')}` : null,
    steps: executed,
    screenshot,
  };
}

/** 变量提取: { 变量名: "text:selector" } */
async function extractVars(session, spec, vars, ctx) {
  try {
    for (const [key, expr] of Object.entries(spec || {})) {
      const m = String(expr).match(/^text\s*[:=]\s*(.+)$/i);
      if (!m) continue;
      // eslint-disable-next-line no-await-in-loop
      const f = await session.elements(m[1], { timeoutMs: 5000, platform: ctx.platform });
      // eslint-disable-next-line no-await-in-loop
      vars[key] = String(await session.text(f.el) || '');
    }
  } catch (_) {
    /* 提取失败不阻断主流程 */
  }
}

module.exports = { runStep, runCase, LOCATOR_ACTIONS, SOURCE_FALLBACK_ACTIONS, ANDROID_KEYS, W3C_KEYS };
