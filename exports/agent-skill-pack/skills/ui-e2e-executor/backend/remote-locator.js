/**
 * 远程会话定位器(单步动作 → 目标元素)
 * ============================================================
 * 把用例里五花八门的定位写法统一翻译成可尝试的定位策略列表:
 *   id=com.x:id/btn        → resource-id(uiautomator2) / name(WDA)
 *   #com.x:id/btn          → 同上简写
 *   text=登录 / @登录       → 文本
 *   accessibilityId=我的   → accessibility id
 *   xpath=//...            → xpath
 *   class=android.widget.Button → class name
 *   name=登录(WDA)        → name
 *   ~我的(Appium 简写)    → accessibility id
 * 未命中任何前缀时,按 全文本 → accessibility id → resource-id → xpath 依次尝试。
 */
'use strict';

// Appium W3C 元素标识键名
const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * @param {string} raw selector / target / locator 原始串
 * @param {string} [platform] android / ios / harmony / windows / mac
 * @returns {Array<{using:string, value:string, from:string}>}
 */
function toStrategies(raw, platform) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return [];
  const out = [];
  const p = String(platform || '');

  const pair = s.match(/^(id|resourceId|resource-id|name|text|textContains|accessibilityId|accessibility-id|xpath|class|className|class-name|css|predicate|image)\s*[:=]\s*(.+)$/i);
  if (pair) {
    const [, k, v] = pair;
    const val = v.trim();
    switch (k.toLowerCase()) {
      case 'id':
      case 'resourceid':
      case 'resource-id':
        out.push({ using: 'id', value: val, from: '显式 id' });
        if (p === 'ios' || p === 'mac') out.push({ using: 'name', value: val, from: '显式 id→name' });
        break;
      case 'name':
        out.push({ using: 'name', value: val, from: '显式 name' });
        out.push({ using: 'accessibility id', value: val, from: '显式 name→a11y' });
        break;
      case 'text':
      case 'textcontains':
        out.push({ using: k.toLowerCase() === 'text' ? 'text' : '-custom', value: val, from: '显式 text', uiautomator: `new UiSelector().text("${val}")` });
        break;
      case 'accessibilityid':
      case 'accessibility-id':
        out.push({ using: 'accessibility id', value: val, from: '显式 accessibilityId' });
        break;
      case 'xpath':
        out.push({ using: 'xpath', value: val, from: '显式 xpath' });
        break;
      case 'class':
      case 'classname':
      case 'class-name':
        out.push({ using: 'class name', value: val, from: '显式 class name' });
        break;
      case 'css':
        out.push({ using: 'css selector', value: val, from: '显式 css' });
        break;
      case 'predicate':
        out.push({ using: '-ios predicate string', value: val, from: '显式 ios predicate' });
        out.push({ using: '-android uiautomator', value: val, from: '显式 predicate→uiautomator' });
        break;
      default:
        out.push({ using: 'xpath', value: val, from: '兜底 xpath' });
    }
    return dedupe(out);
  }

  if (s.startsWith('#') || s.startsWith('.')) {
    const val = s.slice(1);
    out.push({ using: 'id', value: val, from: '# 简写→id' });
    if (p === 'ios' || p === 'mac') out.push({ using: 'name', value: val, from: '# 简写→name' });
    return dedupe(out);
  }
  if (s.startsWith('~')) {
    return [{ using: 'accessibility id', value: s.slice(1), from: '~ 简写→accessibilityId' }];
  }
  if (s.startsWith('//') || s.startsWith('(')) {
    return [{ using: 'xpath', value: s, from: 'xpath 原文' }];
  }
  if (/^[\w.-]+![\w.]+$/.test(s)) {
    // WinAppDriver 的 app window 标识
    return [{ using: 'accessibility id', value: s, from: 'windows app id' }, { using: 'name', value: s, from: 'windows app id→name' }];
  }

  // ── 关键:resource-id 形态(com.xxx:id/login / pkg:id/btn)必须优先按 id 定位 ──
  // 若当成"人话文本"去匹配,真机 Appium 上必然找不到(resource-id 不等于文本)。
  if (/^[\w.-]+:\w+\/[\w.$/_-]+$/.test(s)) {
    return [
      { using: 'id', value: s, from: 'resource-id 形态→id' },
      { using: 'xpath', value: `//*[@resource-id="${s}"]`, from: 'resource-id 形态→xpath' },
      { using: 'accessibility id', value: s, from: 'resource-id 形态→a11y 兜底' },
    ];
  }

  // 无明显标点、非中文化的短串:优先当作"控件标识"(WinAppDriver/mac2 的 AutomationId 常是这样)
  if (/^[A-Za-z0-9_.-]+$/.test(s) && !/[\u4e00-\u9fa5]/.test(s)) {
    return [
      { using: 'accessibility id', value: s, from: '控件标识→accessibilityId' },
      { using: 'id', value: s, from: '控件标识→id' },
      { using: 'name', value: s, from: '控件标识→name' },
    ];
  }

  // 无前缀:视为人话/文本描述
  const val = s;
  out.push({ using: 'accessibility id', value: val, from: '语义:accessibilityId' });
  if (p === 'android') out.push({ using: 'uiautomator-text', value: val, from: '语义:uiautomator text', uiautomator: `new UiSelector().text("${val}")` });
  else out.push({ using: 'name', value: val, from: '语义:name' });
  out.push({ using: 'text', value: val, from: '语义:text' });
  out.push({ using: 'xpath', value: `//*[contains(@text,"${val}") or contains(@label,"${val}") or contains(@name,"${val}") or contains(@content-desc,"${val}")]`, from: '语义:xpath 文本包含' });
  return dedupe(out);
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    const k = `${it.using}|${it.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

module.exports = { toStrategies, W3C_ELEMENT_KEY };
