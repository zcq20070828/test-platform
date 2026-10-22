/**
 * 目标平台自动识别
 * ============================================================
 * 需求背景(用户 2026-10-15 明确要求):
 *   UI/E2E 测试智能体要能根据"用例文件 / 测试脚本 / 需求描述"自动判断该次执行
 *   到底是 Web、移动 App(Android / iOS / 鸿蒙)还是 PC 客户端(macOS / Windows),
 *   不需要用户显式声明平台。
 *
 * 设计原则:
 *   ① 规则先行、零依赖、零外部调用 —— 判定必须稳定可复现、可单测;
 *   ② 不替代模型:把判定依据(reasons)与置信度回传给智能体,便于其向用户解释与纠偏;
 *   ③ 显式声明永远优先:任何情况下用户/调用方显式传的 platform 覆盖自动判定;
 *   ④ 判定失败不清空、不报错,回落到 web(最高频场景)并如实标注 assumed=true。
 *
 * 支持的平台:
 *   web / android / ios / harmony / windows / mac
 */

'use strict';

const { readMaybeFile } = require('./common');

// ============================================================
// 平台元数据
// ============================================================

/** 平台 → 族(决定由哪个执行器承接) */
const PLATFORM_FAMILIES = {
  web: 'web',
  android: 'mobile',
  ios: 'mobile',
  harmony: 'mobile',
  windows: 'desktop',
  mac: 'desktop',
};

/** 平台 → 建议执行器(skillId) */
const PLATFORM_INVOKERS = {
  web: 'ui-direct-invoker',
  android: 'mobile-e2e-invoker',
  ios: 'mobile-e2e-invoker',
  harmony: 'mobile-e2e-invoker',
  windows: 'desktop-e2e-invoker',
  mac: 'desktop-e2e-invoker',
};

const PLATFORM_LABELS = {
  web: 'Web',
  android: 'Android',
  ios: 'iOS',
  harmony: 'HarmonyOS(鸿蒙)',
  windows: 'Windows',
  mac: 'macOS',
};

/** 多平台写法归并到内部标准平台名 */
const PLATFORM_ALIASES = {
  web: 'web', webapp: 'web', webpage: 'web', browser: 'web', h5: 'web', chrome: 'web',
  firefox: 'web', safari: 'web', edge: 'web', 网页: 'web', 浏览器: 'web', 网站: 'web',

  android: 'android', ios: 'ios', iphone: 'ios', ipad: 'ios', ipados: 'ios',
  安卓: 'android', android_app: 'android', 苹果的应用: 'ios', 苹果端: 'ios', 苹果: 'ios',

  harmony: 'harmony', harmonyos: 'harmony', hongmeng: 'harmony', ark: 'harmony',
  arkts: 'harmony', ohos: 'harmony', openharmony: 'harmony', 鸿蒙: 'harmony', 欧拉: 'harmony',

  windows: 'windows', win: 'windows', win32: 'windows', winappdriver: 'windows',
  window: 'windows', pcwindow: 'windows', pc客户端: 'windows', windows客户端: 'windows',
  桌面: null, // "桌面端" 需结合其他线索,见 _refineDesktop 处理

  mac: 'mac', macos: 'mac', osx: 'mac', darwin: 'mac', macapp: 'mac', mac客户端: 'mac',
};

/**
 * 归一化平台名
 * @param {string} raw
 * @returns {string|null} 标准平台名,无法识别返回 null
 */
function normalizePlatform(raw) {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '');
  if (PLATFORM_ALIASES[k] === undefined) return null;
  if (PLATFORM_ALIASES[k] === null) return null;
  return PLATFORM_ALIASES[k];
}

// ============================================================
// 规则库
// ============================================================
// 每条规则: { re, w, platform, why }
// w = 权重(10=强特征几乎可确定 5=明确线索 3=中弱线索 2=弱线索)

const RULES = [
  // ── Android ──
  { re: /\.apk\b/i, w: 10, platform: 'android', why: '出现 Android 安装包 .apk' },
  { re: /appPackage\s*[:=]/i, w: 10, platform: 'android', why: '出现 Appium Android 能力项 appPackage' },
  { re: /appActivity\s*[:=]/i, w: 10, platform: 'android', why: '出现 Appium Android 能力项 appActivity' },
  { re: /platformName['"\s:=]+android/i, w: 10, platform: 'android', why: 'platformName 声明为 Android' },
  { re: /uiautomator/i, w: 8, platform: 'android', why: '出现 UiAutomator' },
  { re: /adb\s+(shell|install|devices)/i, w: 8, platform: 'android', why: '出现 adb 命令' },
  { re: /android\.widget\.\w+/i, w: 8, platform: 'android', why: '出现 Android 原生控件类名' },
  { re: /androidx\.test\.espresso|onView\(withId/i, w: 8, platform: 'android', why: '出现 Espresso 测试代码' },
  { re: /resource-?id|new UiSelector/i, w: 5, platform: 'android', why: '出现 Android 定位写法' },
  { re: /安卓|android|麒麟?\s*应用市场|应用宝|包名\s*[:：]\s*com\./i, w: 5, platform: 'android', why: '出现 Android 关键词或 com. 包名' },

  // ── iOS ──
  { re: /platformName['"\s:=]+ios/i, w: 10, platform: 'ios', why: 'platformName 声明为 iOS' },
  { re: /XCUIApplication|XCTest|XCUITest/i, w: 10, platform: 'ios', why: '出现 XCUITest/XCUIApplication 代码' },
  { re: /\.ipa\b/i, w: 9, platform: 'ios', why: '出现 iOS 安装包 .ipa' },
  { re: /bundleId\s*[:=]/i, w: 8, platform: 'ios', why: '出现 bundleId(XCUITest / iOS Appium 能力项)' },
  { re: /iphone|ipad|ios\s+app/i, w: 5, platform: 'ios', why: '出现 iPhone/iPad 关键词' },
  { re: /xcuitest|simulator|模拟器\s*\(?\s*iOS/i, w: 4, platform: 'ios', why: '出现 iOS 模拟器相关词' },
  { re: /苹果手机|苹果端|苹果客户端/i, w: 5, platform: 'ios', why: '出现苹果端关键词' },

  // ── HarmonyOS ──
  { re: /platformName['"\s:=]+harmony/i, w: 10, platform: 'harmony', why: 'platformName 声明为 HarmonyOS' },
  { re: /@ohos\.[A-Za-z.]+/i, w: 10, platform: 'harmony', why: '出现 @ohos.* 鸿蒙 SDK 引用' },
  { re: /\.hap\b/i, w: 10, platform: 'harmony', why: '出现鸿蒙应用包 .hap' },
  { re: /abilityName|bundleName\s*[:=]/i, w: 9, platform: 'harmony', why: '出现 abilityName/bundleName(鸿蒙能力项)' },
  { re: /UiTest|Hypium|OpenHarmony|ArkUI|ArkTS/i, w: 7, platform: 'harmony', why: '出现鸿蒙测试/开发框架关键词' },
  { re: /鸿蒙|harmony\s*os|HarmonyOSNEXT/i, w: 6, platform: 'harmony', why: '出现鸿蒙关键词' },
  { re: /\bhdc\b/i, w: 6, platform: 'harmony', why: '出现 hdc(鸿蒙调试工具)' },

  // ── Windows 桌面客户端 ──
  { re: /WinAppDriver|winappdriver\.exe/i, w: 10, platform: 'windows', why: '出现 WinAppDriver' },
  { re: /\.exe\b/i, w: 9, platform: 'windows', why: '出现 Windows 可执行文件 .exe' },
  { re: /AutomationId|appTopLevelWindow/i, w: 8, platform: 'windows', why: '出现 Windows UI 自动化属性' },
  { re: /[\w.-]+_[\w]+![\w.]+/, w: 9, platform: 'windows', why: '出现 Windows 应用标识(包名_xxxx!App)' },
  { re: /pywinauto|AutoIt|win32gui|pyautogui/i, w: 8, platform: 'windows', why: '出现 Windows 桌面自动化库' },
  { re: /platformName['"\s:=]+windows/i, w: 10, platform: 'windows', why: 'platformName 声明为 Windows' },
  { re: /\.msi\b|\.dll\b|C:\\\\|C:\\Users/i, w: 7, platform: 'windows', why: '出现 Windows 安装包/路径' },
  { re: /windows\s*(客户端|桌面|应用|桌面端)|win\s*客户端/i, w: 6, platform: 'windows', why: '出现 Windows 客户端关键词' },

  // ── macOS 桌面客户端 ──
  { re: /[\w-]+\.app\b/i, w: 6, platform: 'mac', why: '出现 macOS 应用包 .app' },
  { re: /platformName['"\s:=]+mac/i, w: 10, platform: 'mac', why: 'platformName 声明为 mac' },
  { re: /appium:mac2|\bmac2\b/i, w: 9, platform: 'mac', why: '出现 Appium mac2 驱动' },
  { re: /atomacos|AXUIElement|System Events|osascript/i, w: 8, platform: 'mac', why: '出现 macOS 无障碍/AppleScript 自动化' },
  { re: /\.dmg\b/i, w: 8, platform: 'mac', why: '出现 macOS 安装包 .dmg' },
  { re: /mac\s*(客户端|桌面|桌面端)|macOS\s*(客户端|桌面)/i, w: 6, platform: 'mac', why: '出现 macOS 客户端关键词' },

  // ── Web ──
  { re: /https?:\/\/[^\s"'，。；）]+/i, w: 4, platform: 'web', why: '出现 http(s) 访问地址' },
  { re: /playwright|puppeteer|selenium|cypress/i, w: 5, platform: 'web', why: '出现浏览器自动化框架' },
  { re: /page\.goto|browser\.newPage|locator\(|waitForSelector|cy\.visit/i, w: 6, platform: 'web', why: '出现 Web 自动化代码' },
  { re: /浏览器\s*(打开|访问)|打开\s*(网页|页面|浏览器)|回车\s*(登录)?页面/i, w: 4, platform: 'web', why: '出现浏览器操作描述' },
];

// ============================================================
// 语料收集
// ============================================================

/**
 * 把各种输入形态压平成一串待判定的文本
 * @param {object} input
 */
function buildCorpus(input) {
  const parts = [];
  const pushVal = (v) => {
    if (v === undefined || v === null) return;
    if (typeof v === 'string') parts.push(v);
    else {
      try {
        parts.push(JSON.stringify(v));
      } catch (_) { /* 忽略循环引用 */ }
    }
  };

  // 1) 显式自然语言描述
  for (const k of ['text', 'task', 'description', 'goal', 'requirement', 'content', 'query']) {
    pushVal(input[k]);
  }
  // 2) 用例文件 / 脚本:可能是路径也可能是正文
  for (const k of ['caseFile', 'casePath', 'testCaseFile', 'testScript', 'scriptPath', 'script', 'filePath', 'file']) {
    pushVal(readMaybeFile(input[k]));
  }
  // 3) 结构化用例 / 步骤
  for (const k of ['cases', 'steps', 'testCases', 'platform', 'platformName', 'target', 'url', 'baseUrl', 'appPath', 'appPackage', 'bundleId', 'bundleName']) {
    pushVal(input[k]);
  }

  return parts.filter(Boolean).join('\n').slice(0, 400000);
}

// ============================================================
// 应用配置抽取(供 invoker 组装 desired capabilities)
// ============================================================

function extractAppConfig(corpus) {
  const pick = (re) => {
    const m = corpus.match(re);
    return m ? m[1] : null;
  };
  return {
    appPath: pick(/["']?([\w./\\-]+\.(?:apk|ipa|app|hap|exe))["']?/i),
    appPackage: pick(/appPackage["'\s:=]+([A-Za-z0-9_.$-]+)/i),
    appActivity: pick(/appActivity["'\s:=]+([A-Za-z0-9_.$-]+)/i),
    bundleId: pick(/bundleId["'\s:=]+([A-Za-z0-9_.$-]+)/i),
    bundleName: pick(/bundleName["'\s:=]+([A-Za-z0-9_.$-]+)/i),
    abilityName: pick(/abilityName["'\s:=]+([A-Za-z0-9_.$-]+)/i),
    // WinAppDriver 的应用标识形如 Microsoft.WindowsCalculator_8wekyb3d8bbwe!App
    windowsAppId: pick(/([\w.-]+_[\w]+![\w.]+)/),
    deviceName: pick(/deviceName["'\s:=]+([A-Za-z0-9_.\s-]+)/i),
    udid: pick(/udid["'\s:=]+([A-Za-z0-9_.:-]+)/i),
    platformVersion: pick(/platformVersion["'\s:=]+([0-9.]+)/i),
    url: pick(/(https?:\/\/[^\s"']+)/i),
  };
}

/** 识别脚本使用的测试框架,便于回传给模型做执行通道选择 */
function detectFramework(corpus) {
  const table = [
    [/XCUIApplication|XCTest/i, 'xcuitest'],
    [/androidx\.test\.espresso|onView\(/i, 'espresso'],
    [/@ohos\.[A-Za-z.]+|UiTest|Hypium/i, 'harmony-uitest'],
    [/WinAppDriver|automationName["'\s:=]+windows/i, 'winappdriver'],
    [/pywinauto|AutoIt/i, 'pywinauto'],
    [/uiautomator/i, 'uiautomator2'],
    [/webdriverio|wdio|desiredCapabilities|AppiumBy/i, 'appium'],
    [/playwright/i, 'playwright'],
    [/puppeteer/i, 'puppeteer'],
    [/selenium/i, 'selenium'],
    [/cypress/i, 'cypress'],
  ];
  for (const [re, name] of table) {
    if (re.test(corpus)) return name;
  }
  return 'unknown';
}

// ============================================================
// 主判定入口
// ============================================================

/**
 * 自动判定目标平台
 * @param {object} input 任意形态的输入(见 buildCorpus)
 * @returns {{
 *   platform: string, family: string, invoker: string, label: string,
 *   confidence: 'high'|'medium'|'low', score: number, source: 'explicit'|'auto'|'fallback',
 *   assumed: boolean, reasons: string[], scores: object, app: object, framework: string,
 *   alternatives: string[]
 * }}
 */
function detectPlatform(input) {
  const p0 = (input && (input.platform || input.platformName)) || '';
  const explicit = normalizePlatform(p0);
  // Appium / WinAppDriver / Selenium Hub 的服务地址不是"被测页面地址",
  // 若把它计入 Web 信号,一段纯appium脚本(只有 127.0.0.1:4723)会被误判成 Web。
  // 故先屏蔽驱动端口再做规则匹配。
  const DRIVER_ENDPOINT_RE = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(?:4723|4727|4443|4444)\b\S*/gi;
  const corpus = buildCorpus(input || {}).replace(DRIVER_ENDPOINT_RE, '__DRIVER_ENDPOINT__');

  const scores = {};
  const reasons = [];
  for (const r of RULES) {
    if (r.re.test(corpus)) {
      scores[r.platform] = (scores[r.platform] || 0) + r.w;
      reasons.push(r.why);
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const app = extractAppConfig(corpus);
  const framework = detectFramework(corpus);

  let platform;
  let source;
  let score;

  if (explicit) {
    platform = explicit;
    source = 'explicit';
    score = scores[explicit] || 0;
  } else if (ranked.length > 0) {
    platform = ranked[0][0];
    score = ranked[0][1];
    source = 'auto';
  } else {
    platform = 'web';
    score = 0;
    source = 'fallback';
  }

  // 桌面端纠偏:"桌面端/PC 客户端"这类泛词不足以区分 windows / mac,
  // 若两条桌面规则都命中且分差小,按更强的次特征判;.app 同时是 mac 包后缀,
  // 出现 .exe / C:\ 等 Windows 强特征时应优先判 windows。
  if (platform === 'mac' && scores.windows && scores.windows >= scores.mac) {
    platform = 'windows';
  }
  if (platform === 'windows' && scores.mac && scores.mac > scores.windows + 2) {
    platform = 'mac';
  }

  const rest = Object.entries(scores)
    .filter(([k]) => k !== platform)
    .sort((a, b) => b[1] - a[1]);
  const gap = score - (rest[0] ? rest[0][1] : 0);

  let confidence = 'low';
  if (source === 'explicit') confidence = 'high';
  else if (score >= 10 && gap >= 5) confidence = 'high';
  else if (score >= 5) confidence = 'medium';

  return {
    platform,
    family: PLATFORM_FAMILIES[platform] || 'web',
    invoker: PLATFORM_INVOKERS[platform] || 'ui-direct-invoker',
    label: PLATFORM_LABELS[platform] || platform,
    confidence,
    score,
    source,
    assumed: source === 'fallback',
    reasons,
    scores,
    app,
    framework,
    alternatives: rest.map(([k, v]) => ({ platform: k, score: v, label: PLATFORM_LABELS[k] || k })),
  };
}

/** 某平台和族是否匹配(供 invoker 做"路由纠偏"用) */
function isFamily(platform, family) {
  return (PLATFORM_FAMILIES[normalizePlatform(platform) || platform] || '') === family;
}

module.exports = {
  detectPlatform,
  normalizePlatform,
  isFamily,
  extractAppConfig,
  detectFramework,
  PLATFORM_FAMILIES,
  PLATFORM_INVOKERS,
  PLATFORM_LABELS,
};
