'use strict';

/**
 * browser-matrix-invoker.js
 * 兼容性测试统一执行器（由 compatibility-coordinator 调度，亦被 POST /api/compatibility/web 直接调用）
 *
 * 能力边界（重要，务必如实理解）：
 *  - Web 平台：真实执行。基于 Playwright 驱动浏览器 × 多分辨率视口，
 *    采集控制台错误、页面异常、失败请求、CSS/JS 特性支持情况，输出可量化矩阵报告。
 *    - 优先使用本地已安装的 Chromium（/Applications/GPT Chrome.app/.../GptBrowser），避免联网下载浏览器二进制。
 *    - Firefox / WebKit 需要各自浏览器二进制；本 dev 环境若无对应二进制，相关单元格如实标注 unavailable。
 *  - 移动端（android / ios / harmony）与 PC 端（windows / mac）：
 *    - 目标为【网页/H5/WebView 页面】（提供 http(s) URL）→ 真实执行：Chromium 设备仿真
 *      （真机型视口 + UA + 触控 + DPR + deviceScaleFactor）驱动页面，采集错误与特性。
 *      仿真保真度按平台如实标注（android 高 / windows·mac 高 / ios 中 / harmony 低-中）。
 *    - 目标为【原生 App 包】（无 URL）→ 产出【平台专属兼容性测试设计】（九维穷举模型），
 *      标注 executionMode='design'，供后续接入真机/设备农场后切换为完全真实执行。
 *
 * 设计原则：require('playwright-core') 仅在真实执行分支内懒加载，设计路径不依赖 playwright，
 * 因此即便浏览器不可用，设计生成也能正常运行。
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

// 从 backend/node_modules 解析 playwright（执行器位于 qclaw-skills/.../backend，
// Node 默认只向上找祖先 node_modules，找不到兄弟目录 backend/node_modules，故显式指定）。
function loadPlaywright() {
  const bases = [
    path.resolve(__dirname, '../../../backend'), // test-platform/backend
    path.resolve(__dirname, '../../..'),         // test-platform
  ];
  for (const b of bases) {
    try { return require('playwright-core'); } catch (_) {}
    try { return createRequire(path.join(b, 'package.json'))('playwright-core'); } catch (_) {}
    try { return createRequire(path.join(b, 'package.json'))('playwright'); } catch (_) {}
  }
  return require('playwright-core'); // 兜底（失败时抛出，由调用方捕获）
}

// 本地 Chromium（GPT Chrome.app 内置 GptBrowser，版本 128，等价于 Chrome/Chromium）
const LOCAL_CHROMIUM = '/Applications/GPT Chrome.app/Contents/MacOS/GptBrowser';

// ─── 默认视口矩阵（Web）────────────────────────────────────────────────────
const DEFAULT_VIEWPORTS = [
  { name: '桌面 1920×1080', width: 1920, height: 1080 },
  { name: '笔记本 1366×768', width: 1366, height: 768 },
  { name: '平板竖屏 768×1024', width: 768, height: 1024 },
  { name: '手机 375×667', width: 375, height: 667 },
  { name: '手机大屏 414×896', width: 414, height: 896 },
];

const WEB_BROWSERS = ['chromium', 'firefox', 'webkit'];

// 简易 CSS/JS 特性探测清单（跨浏览器兼容性关注点）
const FEATURE_PROBES = [
  { key: 'cssGrid', probe: "CSS.supports('display','grid')" },
  { key: 'cssFlex', probe: "CSS.supports('display','flex')" },
  { key: 'sticky', probe: "CSS.supports('position','sticky')" },
  { key: 'backdropFilter', probe: "CSS.supports('backdrop-filter','blur(1px)')" },
  { key: 'webp', probe: "document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp')===0" },
  { key: 'fetch', probe: "typeof window.fetch==='function'" },
  { key: 'intersectionObserver', probe: "typeof window.IntersectionObserver==='function'" },
  { key: 'touchSupport', probe: "typeof window.ontouchstart!=='undefined' || (navigator.maxTouchPoints||0)>0" },
  { key: 'webgl', probe: "(function(){try{var c=document.createElement('canvas');return !!(c.getContext('webgl')||c.getContext('experimental-webgl'));}catch(e){return false;}})()" },
  { key: 'es2020', probe: "(function(){try{eval('const a={a:1};const {a}=a;return a===1;');return true;}catch(e){return false;}})()" },
  { key: 'prefersReducedMotion', probe: "typeof window.matchMedia==='function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches!==undefined" },
];

function isWebPlatform(platform) {
  return !platform || platform === 'web' || platform === 'Web' || platform === 'WEB';
}

function hasLocalChromium() {
  try { return fs.existsSync(LOCAL_CHROMIUM); } catch (_) { return false; }
}

// 解析某浏览器的启动参数；无可用二进制时返回 null（调用方标注 unavailable）
function resolveLaunchOptions(browserName) {
  if (browserName === 'chromium' && hasLocalChromium()) {
    return { executablePath: LOCAL_CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] };
  }
  // firefox / webkit：依赖 playwright 自带二进制（本环境通常缺失）
  return { headless: true, args: ['--no-sandbox'] };
}

// ─── 通用矩阵执行内核（Web 视口矩阵 与 设备仿真矩阵 共用）────────────────
async function runMatrixCells({ url, playwright, cells, timeout = 30000, platform, executionMode, browserEngine, extraMeta }) {
  const results = [];
  let total = 0, passed = 0, failed = 0, errored = 0, unavailable = 0;

  // 按浏览器分组，每组只启动一次浏览器实例
  const byBrowser = new Map();
  for (const c of cells) {
    if (!byBrowser.has(c.browser)) byBrowser.set(c.browser, []);
    byBrowser.get(c.browser).push(c);
  }

  for (const [browserName, group] of byBrowser) {
    let browser;
    try {
      browser = await playwright[browserName].launch(resolveLaunchOptions(browserName));
    } catch (e) {
      for (const spec of group) {
        total++; unavailable++;
        results.push({
          browser: spec.name, viewport: `${spec.width}×${spec.height}`, status: 'unavailable',
          error: `浏览器二进制不可用: ${e.message.split('\n')[0]}`,
          consoleErrors: [], pageErrors: [], failedRequests: [], features: {},
        });
      }
      continue;
    }

    for (const spec of group) {
      total++;
      const cell = {
        browser: spec.name, viewport: `${spec.width}×${spec.height}`,
        width: spec.width, height: spec.height,
        userAgent: spec.ua || null,
        status: 'passed', consoleErrors: [], pageErrors: [], failedRequests: [], features: {},
        navigationMs: null,
      };
      let page;
      try {
        const ctxOpts = {
          viewport: { width: spec.width, height: spec.height },
          deviceScaleFactor: spec.dpr || 1,
          isMobile: !!spec.isMobile,
          hasTouch: !!spec.hasTouch,
        };
        if (spec.ua) ctxOpts.userAgent = spec.ua;
        const context = await browser.newContext(ctxOpts);
        page = await context.newPage();

        const consoleErrors = [];
        const pageErrors = [];
        const failedRequests = [];
        page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
        page.on('pageerror', err => pageErrors.push(err.message));
        page.on('requestfailed', req => failedRequests.push({ url: req.url(), failure: req.failure() && req.failure().errorText }));

        const start = Date.now();
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        cell.navigationMs = Date.now() - start;
        // 仅对 http(s) 校验状态码；data:/about:/file: 等非 HTTP 协议无状态码，跳过避免误判
        if (/^https?:\/\//i.test(url) && (!resp || resp.status() >= 400)) {
          cell.status = 'failed';
          cell.consoleErrors.push(`HTTP 状态异常: ${resp ? resp.status() : '无响应'}`);
        }

        try {
          cell.features = await page.evaluate((probes) => {
            const out = {};
            for (const p of probes) {
              try { out[p.key] = eval(p.probe); } catch (e) { out[p.key] = 'err:' + e.message; }
            }
            return out;
          }, FEATURE_PROBES);
        } catch (e) {
          cell.features = { probeError: e.message };
        }

        cell.consoleErrors.push(...consoleErrors);
        cell.pageErrors.push(...pageErrors);
        cell.failedRequests.push(...failedRequests);

        if (cell.consoleErrors.length || cell.pageErrors.length || cell.failedRequests.length) {
          cell.status = 'failed';
        }
        await context.close();
      } catch (e) {
        cell.status = 'errored';
        cell.error = e.message;
      } finally {
        if (page && typeof page.isClosed === 'function' && !page.isClosed()) { try { await page.close(); } catch (_) {} }
      }

      if (cell.status === 'passed') passed++;
      else if (cell.status === 'failed') failed++;
      else if (cell.status === 'errored') errored++;
      else unavailable++;
      results.push(cell);
    }
    try { await browser.close(); } catch (_) {}
  }

  const score = total ? Math.round((passed / total) * 100) : 0;
  return {
    platform,
    executionMode,
    browserEngine,
    url,
    ...(extraMeta || {}),
    summary: { total, passed, failed, errored, unavailable, score },
    results,
  };
}

// ─── Web 真实浏览器矩阵执行 ────────────────────────────────────────────────
async function runWebMatrix({ url, matrix, timeout = 30000 }) {
  // 懒加载 playwright（避免设计路径也触碰该依赖）
  // 注意：执行器位于 qclaw-skills/.../backend，Node 默认向上找祖先 node_modules 找不到
  // 兄弟目录 backend/node_modules/playwright-core，必须用 loadPlaywright() 显式解析。
  let playwright;
  try {
    playwright = loadPlaywright();
  } catch (e) {
    return {
      platform: 'web', executionMode: 'unavailable',
      error: `无法加载 playwright/playwright-core：${e.message}`,
      summary: { total: 0, passed: 0, failed: 0, errored: 1, score: 0 }, results: [],
    };
  }

  const localChromium = hasLocalChromium();
  // 默认浏览器列表：本环境仅本地 Chromium 可用时，默认只跑 chromium（保证默认运行真实可跑）
  let browsers = (matrix && Array.isArray(matrix.browsers) && matrix.browsers.length)
    ? matrix.browsers.filter(b => WEB_BROWSERS.includes(b))
    : (localChromium ? ['chromium'] : WEB_BROWSERS);
  if (!browsers.length) browsers = localChromium ? ['chromium'] : WEB_BROWSERS;

  const viewports = (matrix && Array.isArray(matrix.viewports) && matrix.viewports.length)
    ? matrix.viewports
    : DEFAULT_VIEWPORTS;

  const cells = [];
  for (const b of browsers) {
    for (const vp of viewports) {
      cells.push({ browser: b, name: `${b} · ${vp.name}`, width: vp.width, height: vp.height });
    }
  }

  return runMatrixCells({
    url, playwright, cells, timeout,
    platform: 'web', executionMode: 'real',
    browserEngine: localChromium ? 'local-chromium' : 'playwright-bundled',
  });
}

// ─── 移动端 / PC 端 设备仿真真实执行 ──────────────────────────────────────
// 每个平台的设备画像：真机型视口 + 真实 UA + 触控 + DPR。目标为网页/H5/WebView 页面。
const DEVICE_PROFILES = {
  android: [
    { name: '安卓 · Pixel 8 旗舰 (Android 14 / Chrome 128)', width: 412, height: 915, dpr: 2.625, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36' },
    { name: '安卓 · Redmi Note 12 中端机 (Android 13 / Chrome 120)', width: 393, height: 873, dpr: 2.75, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (Linux; Android 13; 2201117TY) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
    { name: '安卓 · MatePad 平板 (Android 12 / Chrome 120)', width: 800, height: 1280, dpr: 2, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (Linux; Android 12; MatePad 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  ],
  ios: [
    { name: 'iOS · iPhone 15 Pro (iOS 18 / Safari)', width: 393, height: 852, dpr: 3, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
    { name: 'iOS · iPhone SE 3 小屏 (iOS 16 / Safari)', width: 375, height: 667, dpr: 2, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' },
    { name: 'iOS · iPad Air (iPadOS 17 / Safari)', width: 820, height: 1180, dpr: 2, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  ],
  harmony: [
    { name: '鸿蒙 · Mate 60 (HarmonyOS NEXT 5.0 / ArkWeb)', width: 400, height: 880, dpr: 3, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 ArkWeb/5.0.0' },
    { name: '鸿蒙 · nova 12 (HarmonyOS 4.2 / ArkWeb)', width: 384, height: 840, dpr: 3, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (Phone; OpenHarmony 4.2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 ArkWeb/4.2.0' },
    { name: '鸿蒙 · MatePad Pro 平板 (HarmonyOS 4 / ArkWeb)', width: 800, height: 1280, dpr: 2.5, isMobile: true, hasTouch: true,
      ua: 'Mozilla/5.0 (Tablet; OpenHarmony 4.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.0.0' },
  ],
  windows: [
    { name: 'Windows 11 · Chrome 128 (1080p 台式机)', width: 1920, height: 1080, dpr: 1,
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
    { name: 'Windows 10 · Edge 128 (1366×768 笔记本)', width: 1366, height: 768, dpr: 1,
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2743' },
    { name: 'Windows 11 · 150% DPI 高分屏笔记本', width: 1536, height: 864, dpr: 1.5,
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
  ],
  mac: [
    { name: 'macOS · Chrome 128 (1440×900 MacBook)', width: 1440, height: 900, dpr: 2,
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
    { name: 'macOS · 5K 外接显示器视口 (2560×1440)', width: 2560, height: 1440, dpr: 2,
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
    { name: 'macOS · Safari 18 UA (1512×982)', width: 1512, height: 982, dpr: 2,
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' },
  ],
};

// 仿真保真度（如实标注，不夸大）
const FIDELITY_NOTES = {
  android: '高：安卓系统 WebView / Chrome 本身即 Chromium 内核，设备仿真（视口/UA/触控/DPR）与真机表现高度一致。',
  ios: '中：视口/UA/触控/DPR 已按真机型仿真，但渲染引擎为 Chromium 而非真机 WebKit(Safari)；Safari 专属行为（如滚动回弹、日期控件样式）需真机复核。',
  harmony: '低-中：ArkWeb 基于 Chromium，UA/视口已仿真，但鸿蒙原生渲染与系统级特性无法仿真，需真机复核。',
  windows: '高：浏览器引擎真实为 Chromium；操作系统环境（UA/高分屏缩放）为仿真，非 Windows 真机，IE 模式等系统级特性需真机复核。',
  mac: '高：本机即 macOS，Chromium 引擎真实运行；Safari UA 单元仅仿真 UA，Safari 专属行为需另装 Safari 复核。',
};

async function runDeviceEmulatedMatrix({ url, platformKey, matrix, timeout = 30000 }) {
  let playwright;
  try {
    playwright = loadPlaywright();
  } catch (e) {
    return {
      platform: platformKey, executionMode: 'unavailable',
      error: `无法加载 playwright/playwright-core：${e.message}`,
      summary: { total: 0, passed: 0, failed: 0, errored: 1, score: 0 }, results: [],
    };
  }
  if (!hasLocalChromium()) {
    return {
      platform: platformKey, executionMode: 'unavailable',
      error: '本地 Chromium 不可用，无法执行设备仿真矩阵。',
      summary: { total: 0, passed: 0, failed: 0, errored: 1, score: 0 }, results: [],
    };
  }

  const profiles = DEVICE_PROFILES[platformKey] || [];
  const cells = profiles.map(p => ({
    browser: 'chromium',
    name: p.name, width: p.width, height: p.height,
    dpr: p.dpr, ua: p.ua, isMobile: p.isMobile, hasTouch: p.hasTouch,
  }));

  return runMatrixCells({
    url, playwright, cells, timeout,
    platform: platformKey, executionMode: 'real',
    browserEngine: 'local-chromium-device-emulated',
    extraMeta: {
      executionDetail: 'device-emulated',
      fidelityNote: FIDELITY_NOTES[platformKey] || null,
      targetKind: 'web/h5/webview 页面',
    },
  });
}

// ─── 移动端 / PC 端 原生 App 兼容性测试设计生成（九维穷举模型）─────────────
const PLATFORM_PROFILES = {
  android: {
    label: '安卓 (Android)',
    devices: ['主流机型(小米/华为/OPPO/vivo/Samsung)', '低端机(2GB RAM)', '折叠屏/平板'],
    osVersions: ['Android 14/15', 'Android 12/13', 'Android 10/11(长尾)'],
    kernels: ['系统 WebView(Chromium)', '各厂商定制浏览器', '微信/QQ 内置 X5 内核'],
  },
  ios: {
    label: 'iOS',
    devices: ['iPhone 15/16 系列', 'iPhone SE(小屏)', 'iPad'],
    osVersions: ['iOS 17/18', 'iOS 15/16', 'iOS 13/14(长尾)'],
    kernels: ['Safari(WKWebView)', '微信/支付宝 小程序 WebView'],
  },
  harmony: {
    label: '鸿蒙 (HarmonyOS)',
    devices: ['华为 Mate/Pura 系列', '华为 nova 系列', '鸿蒙平板'],
    osVersions: ['HarmonyOS NEXT 5.0', 'HarmonyOS 4.x'],
    kernels: ['ArkWeb(系统 WebView)', '鸿蒙原生 ArkUI 混合渲染'],
  },
  windows: {
    label: 'Windows PC',
    devices: ['台式机/笔记本', 'Surface 触控设备', '高 DPI(125%/150%) 屏'],
    osVersions: ['Windows 11', 'Windows 10', 'Windows Server(无 UI)'],
    kernels: ['Edge(Chromium)', 'Chrome', 'IE 模式(兼容旧系统)'],
  },
  mac: {
    label: 'macOS',
    devices: ['MacBook(视网膜屏)', 'iMac(5K)', '外接显示器(不同缩放)'],
    osVersions: ['macOS 15 Sequoia', 'macOS 14 Sonoma', 'macOS 12/13'],
    kernels: ['Safari', 'Chrome', 'Edge', 'Firefox'],
  },
};

// 九维：用户/数据/流程/操作/安全/性能/网络环境/终端环境/兼容性
function buildDesign(platform) {
  const p = PLATFORM_PROFILES[platform] || PLATFORM_PROFILES.android;
  const dims = [
    {
      dim: '① 用户', items: [
        `覆盖设备档次：${p.devices.join('、')}`,
        `系统版本分布：${p.osVersions.join('、')}`,
        '不同用户群组(新/老用户、无障碍设置、深色模式偏好)',
      ],
    },
    {
      dim: '② 数据', items: [
        '预置账号/游客态/未登录态',
        '本地化数据(中文/英文/多语言)与脏数据边界',
        '大数据量列表/长文本/特殊字符(emoji、RTL)',
      ],
    },
    {
      dim: '③ 流程', items: [
        '核心业务主链路在目标平台的完整走通',
        '关键分支(授权回调、分享、支付、上传)在端侧的适配',
        '冷启动/热启动/后台切回的状态恢复',
      ],
    },
    {
      dim: '④ 操作', items: [
        '触控手势(滑动/长按/双击/缩放)在目标设备上的响应',
        '系统级交互(返回键/手势导航/分屏/悬浮窗)',
        '横竖屏切换与旋屏后布局',
      ],
    },
    {
      dim: '⑤ 安全', items: [
        '权限申请(相机/定位/存储/通讯录)在端侧的弹窗与拒绝处理',
        '数据本地存储加密与传输安全',
        '越权/防截屏/防录屏等平台安全策略',
      ],
    },
    {
      dim: '⑥ 性能', items: [
        '冷启动耗时、首屏可交互时间(FMP)',
        '列表滚动帧率、内存占用与 OOM 风险',
        '弱网下的加载与超时策略',
      ],
    },
    {
      dim: '⑦ 网络环境', items: [
        '弱网(高延迟/丢包)、断网重连、2G/3G/4G/5G/WiFi 切换',
        '代理/企业网络/证书校验',
        '后台下载/同步在限速网络下的表现',
      ],
    },
    {
      dim: '⑧ 终端环境', items: [
        `内核/WebView：${p.kernels.join('、')}`,
        '系统字体/深色模式/动态字体大小适配',
        '厂商 ROM 定制(推送/权限/后台限制/电池优化)',
      ],
    },
    {
      dim: '⑨ 兼容性', items: [
        '分辨率/屏幕比例/DPI/刘海/挖孔/灵动岛适配',
        '不同浏览器内核的 CSS/JS 特性支持矩阵',
        '第三方 SDK(地图/支付/统计)在目标平台的兼容',
      ],
    },
  ];

  const results = dims.map(d => ({
    dimension: d.dim,
    checkpoints: d.items,
  }));

  const total = dims.reduce((s, d) => s + d.items.length, 0);
  return {
    platform: p.label,
    platformKey: platform,
    executionMode: 'design',
    note: '目标是原生 App 包（未提供可访问的网页 URL），且当前 dev 环境无真机/模拟器/云设备农场，本结果为【平台专属兼容性测试设计】(九维穷举模型)，用于指导测试执行；接入设备农场后可切换为真实执行。若被测对象是网页/H5/WebView 页面，请提供 http(s) URL，将自动切换为设备仿真实测。',
    summary: { total, passed: 0, failed: 0, errored: 0, score: null, checkpointCount: total },
    results,
  };
}

// ─── 统一入口 ──────────────────────────────────────────────────────────────
// 单平台执行（原统一入口逻辑）
async function runSinglePlatform(opts) {
  opts = opts || {};
  const { url, platform } = opts;
  const key = String(platform || '').toLowerCase();

  if (isWebPlatform(platform)) {
    if (!url) {
      return { platform: 'web', executionMode: 'unavailable', error: '缺少 url 参数', summary: { total: 0, passed: 0, failed: 0, errored: 1, score: 0 }, results: [] };
    }
    return runWebMatrix(opts);
  }

  if (PLATFORM_PROFILES[key]) {
    // 提供了 http(s) URL（网页/H5/WebView 页面）→ 设备仿真实测
    if (url && /^https?:\/\//i.test(url)) {
      return runDeviceEmulatedMatrix({ ...opts, platformKey: key });
    }
    // 原生 App 包或无 URL → 九维设计生成
    return buildDesign(key);
  }

  // 未知平台：回退为 Web
  if (!url) {
    return { platform: 'unknown', executionMode: 'unavailable', error: `未知平台 "${platform}" 且缺少 url`, summary: { total: 0, passed: 0, failed: 0, errored: 1, score: 0 }, results: [] };
  }
  return runWebMatrix(opts);
}

// 统一入口：支持逗号分隔多平台（如 "android,ios,harmony"）→ 逐平台串行执行后按平台分节汇总
async function executeBrowserMatrix(opts) {
  opts = opts || {};
  const rawPlatform = String(opts.platform || '').trim();
  const keys = rawPlatform.split(',').map((s) => s.trim()).filter(Boolean);

  if (keys.length > 1) {
    const sections = [];
    const results = [];
    const modes = new Set();
    let total = 0, passed = 0, failed = 0, errored = 0;
    const scores = [];
    for (const k of keys) {
      const one = await runSinglePlatform({ ...opts, platform: k });
      sections.push(one);
      results.push(...(one.results || []));
      const s = one.summary || {};
      total += s.total || 0;
      passed += s.passed || 0;
      failed += s.failed || 0;
      errored += s.errored || 0;
      if (typeof s.score === 'number') scores.push(s.score);
      modes.add(one.executionMode || 'unknown');
    }
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    return {
      platform: keys.join(','),
      executionMode: [...modes].join('+'),
      multiPlatform: true,
      note: `多平台组合执行（${keys.join(' / ')}），以下按平台分节汇总；各平台执行模式以分节内标注为准。`,
      sections,
      summary: { total, passed, failed, errored, score: avg },
      results,
    };
  }

  return runSinglePlatform(opts);
}

module.exports = {
  executeBrowserMatrix,
  runWebMatrix,
  runDeviceEmulatedMatrix,
  buildDesign,
  DEVICE_PROFILES,
  FIDELITY_NOTES,
  LOCAL_CHROMIUM,
};
