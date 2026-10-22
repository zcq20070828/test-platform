/**
 * 远程驱动会话(Appium / WinAppDriver 通用)
 * ============================================================
 * 为什么用 HTTP REST 而不是引入 webdriverio / appium 客户端包:
 *   ① 零新增 npm 依赖 —— Appium 全家桶(含 node-gyp 原生模块)体积大、
 *      安装慢且易在版本升级时炸掉;而 W3C WebDriver 协议本身就是一个 HTTP API;
 *   ② Appium Server / Appium mac2 驱动 / WinAppDriver 三者的会话端点基本同构
 *      (POST /session、/element、/click、/screenshot ...),一个客户端全搞定;
 *   ③ 驱动进程可以跑在另一台机器上(如 Windows 物理机跑 WDA、Mac 跑 mac2),
 *      本模块只要拿到 URL 就能连,天然支持"真机/模拟器在执行机"的部署形态。
 *
 * 覆盖: Android(uiautomator2) / iOS(XCUITest) / HarmonyOS / macOS(mac2) / Windows(WinAppDriver)
 */

'use strict';

const { toStrategies, W3C_ELEMENT_KEY } = require('./remote-locator');

class DriverError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

function stripSlash(u) {
  return String(u || '').replace(/\/+$/, '');
}

/** W3C 与老协议返回的 element id 键名不同,统一提取 */
function extractElementId(value) {
  if (!value || typeof value !== 'object') return null;
  if (value[W3C_ELEMENT_KEY]) return value[W3C_ELEMENT_KEY];
  if (value.ELEMENT) return value.ELEMENT;
  if (value.elementId) return value.elementId;
  if (typeof value.element === 'string') return value.element;
  return null;
}

function extractSessionId(json) {
  if (!json) return null;
  if (json.sessionId) return json.sessionId;
  if (json.value && typeof json.value === 'object' && json.value.sessionId) return json.value.sessionId;
  if (typeof json.value === 'string') return json.value;
  return null;
}

/**
 * 把内部策略名翻译成具体驱动支持的 W3C / Appium 方言
 * @returns {Array<{using:string, value:string}>}
 */
function mapStrategy(strategy, platform) {
  const { using, value, uiautomator } = strategy;
  const p = String(platform || '');
  switch (using) {
    case 'uiautomator-text':
      return [{ using: '-android uiautomator', value: uiautomator || `new UiSelector().text("${value}")` }];
    case 'text':
      if (p === 'android') return [{ using: '-android uiautomator', value: `new UiSelector().text("${value}")` }];
      if (p === 'ios' || p === 'mac') {
        return [{ using: '-ios predicate string', value: `type == 'XCUIElementTypeAny' AND (name CONTAINS '${value}' OR label CONTAINS '${value}' OR value CONTAINS '${value}')` }];
      }
      return [{ using: 'xpath', value: `//*[contains(@Name,"${value}") or contains(@AutomationId,"${value}")]` }];
    case 'name':
      if (p === 'ios' || p === 'mac') {
        return [
          { using: 'name', value },
          { using: '-ios predicate string', value: `name == '${value}'` },
        ];
      }
      return [{ using: 'name', value }];
    case 'id':
      if (p === 'android') return [{ using: 'id', value }];
      return [{ using: 'id', value }, { using: 'accessibility id', value }];
    default:
      return [{ using, value }];
  }
}

/** 会话建立一次即可复用 */
class RemoteSession {
  constructor({ baseUrl, sessionId, platform }) {
    this.baseUrl = stripSlash(baseUrl);
    this.sessionId = sessionId;
    this.platform = platform || '';
  }

  async req(method, relPath, body, timeoutMs = 30000) {
    const url = `${this.baseUrl}${relPath}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new DriverError(
        isTimeout ? 'DRIVER_TIMEOUT' : 'DRIVER_UNREACHABLE',
        isTimeout ? `驱动请求超时(${timeoutMs}ms): ${method} ${relPath}` : `无法连接驱动服务(${this.baseUrl}): ${e && e.message}`,
        { url, method }
      );
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      /* 部分驱动返回非 JSON */
    }
    if (!res.ok) {
      const msg = (json && (json.value && (json.value.message || json.value.error))) || (json && json.message) || text;
      throw new DriverError('DRIVER_ERROR', `驱动返回错误(${res.status}): ${String(msg).slice(0, 500)}`, { status: res.status, body: String(text).slice(0, 1000) });
    }
    if (json && json.status && json.status !== 0 && json.value && json.value.message) {
      throw new DriverError('DRIVER_ERROR', `驱动返回失败: ${json.value.message}`, json.value);
    }
    return json;
  }

  setImplicitWait(ms) {
    return this.req('POST', `/session/${this.sessionId}/timeouts`, { implicit: Number(ms) || 0 });
  }

  async source() {
    const j = await this.req('GET', `/session/${this.sessionId}/source`);
    return (j && j.value) || '';
  }

  async screenshotBase64() {
    const j = await this.req('GET', `/session/${this.sessionId}/screenshot`);
    return (j && j.value) || null;
  }

  async elements(raw, { timeoutMs = 8000, platform } = {}) {
    const strategies = toStrategies(raw, platform || this.platform);
    const tries = [];
    for (const st of strategies) {
      for (const mapped of mapStrategy(st, platform || this.platform)) {
        tries.push({ ...mapped, from: st.from });
      }
    }
    if (tries.length === 0) throw new DriverError('NO_LOCATOR', `无法从 "${raw}" 解析出任何定位策略`);
    return this._findAny(tries, timeoutMs, false);
  }

  /** 逐个策略尝试直到命中;返回 { el, using, value, from, tried } */
  async _findAny(tries, timeoutMs, single) {
    void single;
    const deadline = Date.now() + timeoutMs;
    // 轮询会重复尝试同一批策略 —— 只按策略去重记录,避免 tried 数组爆炸式膨胀
    const attempted = new Map();
    let lastErr = null;
    let rounds = 0;
    do {
      rounds++;
      for (const t of tries) {
        const key = `${t.using}|${t.value}`;
        try {
          // eslint-disable-next-line no-await-in-loop
          const j = await this.req('POST', `/session/${this.sessionId}/element`, { using: t.using, value: t.value }, 10000);
          const id = extractElementId(j && j.value);
          if (!id) continue;
          attempted.set(key, `✓ ${t.from}: ${t.using}="${t.value}"`);
          return {
            el: id, using: t.using, value: t.value, from: t.from,
            tried: Array.from(attempted.values()),
          };
        } catch (e) {
          if (!attempted.has(key)) attempted.set(key, `✗ ${t.from}: ${t.using}="${t.value}" (${e.code || 'ERR'})`);
          lastErr = e;
          // 元素未找到是常见的策略回退场景,继续尝试下一个策略
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 400));
    } while (Date.now() < deadline);
    throw new DriverError('ELEMENT_NOT_FOUND', `未找到元素,已尝试 ${attempted.size} 种定位策略 / 轮询 ${rounds} 轮: ${Array.from(attempted.values()).join('; ')}`, { tried: Array.from(attempted.values()), rounds, lastError: lastErr && lastErr.message });
  }

  /**
   * 元素级操作路径
   * 说明:Appium 返回的 element id 是不透明串,部分驱动(如 UiAutomator2)会给出含 : 与 /
   * 的 resource-id 形态。直接拼进路径会造成路径分段歧义(把 id 当成两层),
   * 因此统一转义 —— 常规 id(字母数字短横线)转义后值不变,不受影响。
   */
  elUrl(el, op) {
    return `/session/${this.sessionId}/element/${encodeURIComponent(el)}/${op}`;
  }

  async click(el) {
    return this.req('POST', this.elUrl(el, 'click'), {});
  }

  async clear(el) {
    return this.req('POST', this.elUrl(el, 'clear'), {});
  }

  async sendKeys(el, text) {
    // W3C: value 为字符数组;部分驱动也接受字符串,统一用数组最稳
    return this.req('POST', this.elUrl(el, 'value'), { text: String(text), value: String(text).split('') });
  }

  async text(el) {
    const j = await this.req('GET', this.elUrl(el, 'text'));
    return j && j.value;
  }

  async displayed(el) {
    const j = await this.req('GET', this.elUrl(el, 'displayed'));
    return !!(j && j.value);
  }

  async attr(el, name) {
    const j = await this.req('GET', this.elUrl(el, `attribute/${encodeURIComponent(name)}`));
    return j && j.value;
  }

  async pressKey(keycode) {
    return this.req('POST', `/session/${this.sessionId}/appium/device/press_keycode`, { keycode });
  }

  /** 触屏滑动(百分比坐标请在调用侧换算为像素) */
  async swipe({ startX, startY, endX, endY, durationMs = 600 }) {
    const actions = [
      {
        type: 'pointer', id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: startX, y: startY },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 100 },
          { type: 'pointerMove', duration: durationMs, x: endX, y: endY },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ];
    return this.req('POST', `/session/${this.sessionId}/actions`, { actions });
  }

  async executeScript(script, args = []) {
    const j = await this.req('POST', `/session/${this.sessionId}/execute/sync`, { script, args });
    return j && j.value;
  }

  async launchApp(appId) {
    return this.req('POST', `/session/${this.sessionId}/appium/app/launch`, appId ? { appId } : {}).catch(() => null);
  }

  async closeApp() {
    return this.req('POST', `/session/${this.sessionId}/appium/app/close`, {}).catch(() => null);
  }

  async terminate() {
    await this.closeApp();
  }

  async deleteSession() {
    try {
      await this.req('DELETE', `/session/${this.sessionId}`, undefined, 15000);
    } catch (_) {
      /* 会话清理失败不影响结果 */
    }
  }
}

/**
 * 建立会话。兼容三种形态:
 *   ① Appium 2: { capabilities: { alwaysMatch, firstMatch } }
 *   ② 老协议 Appium 1 / WinAppDriver: { desiredCapabilities: {...} }
 *   ③ Appium 挂载路径带 /wd/hub 的情况自动追加重试
 */
async function createSession({ baseUrl, caps, timeoutMs = 60000 }) {
  const base = stripSlash(baseUrl);
  const errors = [];

  const attempts = [
    { url: `${base}/session`, body: { capabilities: { alwaysMatch: caps, firstMatch: [{}] } }, label: 'W3C(capabilities.alwaysMatch)' },
    { url: `${base}/session`, body: { desiredCapabilities: caps, capabilities: { alwaysMatch: caps, firstMatch: [{}] } }, label: 'desiredCapabilities' },
  ];
  // Windows / 旧环境常见 /wd/hub 挂载
  if (!/\/wd\/hub$/i.test(base)) {
    for (const a of [...attempts]) {
      attempts.push({ ...a, url: `${base}/wd/hub/session`, label: `${a.label} @ /wd/hub` });
    }
  }

  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify(a.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { /* ignore */ }
      const sid = extractSessionId(json);
      if (res.ok && sid) {
        return { ok: true, sessionId: sid, baseUrl: a.url.replace(/\/session$/, ''), via: a.label };
      }
      errors.push(`${a.label} → HTTP ${res.status}: ${String((json && json.value && json.value.message) || text).slice(0, 300)}`);
    } catch (e) {
      errors.push(`${a.label} → ${e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? '请求超时' : (e.message || '连接失败')}`);
    }
  }
  return { ok: false, errors };
}

/** 探活:判断 Appium / WinAppDriver 服务是否在跑 */
async function probe(baseUrl, timeoutMs = 5000) {
  const base = stripSlash(baseUrl);
  try {
    const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      let json = null;
      try { json = await res.json(); } catch (_) { /* ignore */ }
      return { ok: true, info: (json && json.value) || null };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? '连接超时' : String(e && e.message) };
  }
}

module.exports = { RemoteSession, createSession, probe, DriverError, extractElementId, mapStrategy };
