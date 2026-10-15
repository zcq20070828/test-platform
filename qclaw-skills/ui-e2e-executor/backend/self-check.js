/**
 * ui-e2e-executor 自测脚本
 * ============================================================
 * 运行: node qclaw-skills/ui-e2e-executor/backend/self-check.js
 *
 * 内置一个"假 Appium 服务"(实现本次用到的 W3C 端点),因此**不需要**真的装 Appium /
 * 连真机也能验证:平台自动判定、会话建立、步骤执行、断言、路由纠偏、环境降级。
 * 改动本包任何文件后都应跑一次,防止能力悄悄失效。
 */

'use strict';

const http = require('http');
const path = require('path');

const HERE = __dirname;
const { detectPlatform } = require(path.join(HERE, 'platform-detect.js'));
const mobile = require(path.join(HERE, 'mobile-e2e-invoker.js'));
const desktop = require(path.join(HERE, 'desktop-e2e-invoker.js'));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

// ============================================================
// 假驱动:按 Appium / WinAppDriver 的 W3C 端点返回数据
// ============================================================
const SCREENS = {
  login: '<hierarchy><android.widget.EditText resource-id="com.demo:id/user" text="" clickable="true"/><android.widget.EditText resource-id="com.demo:id/pwd" text="" clickable="true"/><android.widget.Button resource-id="com.demo:id/login" text="登录" clickable="true"/></hierarchy>',
  home: '<hierarchy><android.widget.TextView resource-id="com.demo:id/title" text="欢迎 测试用户" clickable="false"/><android.widget.Button resource-id="com.demo:id/logout" text="退出" clickable="true"/></hierarchy>',
  win: '<Window><Button AutomationId="btnCalc" Name="计算器" /><Text AutomationId="txtTitle" Name="欢迎使用PC客户端" /></Window>',
  mac: '<AXApplication><AXButton AXIdentifier="btnStart" AXValue="开始" /><AXStaticText AXIdentifier="lblHello" AXValue="欢迎 测试用户" /></AXApplication>',
};

function parseAttrs(xml) {
  const out = [];
  const re = /<([A-Za-z0-9_.:-]+)\s([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = {};
    const aRe = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = aRe.exec(m[2])) !== null) attrs[am[1]] = am[2];
    out.push(attrs);
  }
  return out;
}

function startFakeDriver(port, initialScreen) {
  const state = { screen: initialScreen || 'login', values: {}, sessionId: 'sess-selfcheck' };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p = {};
      try { p = body ? JSON.parse(body) : {}; } catch (_) { /* ignore */ }
      const url = req.url;
      const send = (o, code) => {
        res.writeHead(code || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (url === '/status') return send({ value: { ready: true } });
      if (url === '/session' && req.method === 'POST') return send({ value: { sessionId: state.sessionId } });
      if (url === `/session/${state.sessionId}/source`) return send({ value: SCREENS[state.screen] });
      if (url === `/session/${state.sessionId}/screenshot`) return send({ value: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFbBQjxAAAAAElFTkSuQmCC' });
      if (url === `/session/${state.sessionId}/element` && req.method === 'POST') {
        const v = String(p.value || '');
        const nodes = parseAttrs(SCREENS[state.screen]);
        let hit = null;
        if (['id', 'name', 'accessibility id'].indexOf(p.using) >= 0) {
          hit = nodes.find((n) => n['resource-id'] === v || n.AutomationId === v || n.AXIdentifier === v);
        }
        if (!hit && String(p.using).indexOf('uiautomator') >= 0) {
          const tm = v.match(/text\("([^"]+)"\)/);
          if (tm) hit = nodes.find((n) => n.text === tm[1] || n.Name === tm[1]);
        }
        if (!hit && p.using === 'xpath') {
          const cm = v.match(/@text,"([^"]+)"|@label,"([^"]+)"|@Name,"([^"]+)"|@name,"([^"]+)"|@resource-id="([^"]+)"/);
          const want = cm ? (cm[1] || cm[2] || cm[3] || cm[4]) : null;
          if (want) hit = nodes.find((n) => (n.text || n.Name || n.AXValue || '').indexOf(want) >= 0);
          if (!hit && cm && cm[5]) hit = nodes.find((n) => n['resource-id'] === cm[5]);
        }
        if (!hit) return send({ value: { error: 'no such element', message: `no such element (${p.using}=${v})` } }, 404);
        return send({ value: { 'element-6066-11e4-a52e-4f735466cecf': hit['resource-id'] || hit.AutomationId || hit.AXIdentifier } });
      }
      const el = url.match(new RegExp(`^/session/${state.sessionId}/element/(.+)/([a-zA-Z]+)$`));
      if (el) {
        const id = decodeURIComponent(el[1]);
        const op = el[2];
        if (op === 'value') state.values[id] = String(p.text || '');
        if (op === 'clear') delete state.values[id];
        if (op === 'click' && id === 'com.demo:id/login' && state.values['com.demo:id/user'] && state.values['com.demo:id/pwd']) state.screen = 'home';
        if (op === 'text') {
          const n = parseAttrs(SCREENS[state.screen]).find((x) => (x['resource-id'] || x.AutomationId || x.AXIdentifier) === id);
          return send({ value: n ? (n.text || n.Name || n.AXValue || '') : '' });
        }
        if (op === 'displayed') return send({ value: true });
        return send({ value: null });
      }
      if (url === `/session/${state.sessionId}/appium/app/close` && req.method === 'POST') { state.screen = 'login'; state.values = {}; return send({ value: null }); }
      if (url === `/session/${state.sessionId}` && req.method === 'DELETE') return send({ value: null });
      if (url === `/session/${state.sessionId}/timeouts`) return send({ value: null });
      if (url === `/session/${state.sessionId}/actions`) return send({ value: null });
      if (url === `/session/${state.sessionId}/appium/app/launch`) return send({ value: null });
      return send({ value: null });
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

// ============================================================
(async () => {
  console.log('\n=== 1. 平台自动判定 ===');
  const cases = [
    ['Web 用例', { text: '打开 https://example.com/login 登录' }, 'web'],
    ['Android(apk+包名)', { text: '测试安卓App', caseFile: '/tmp/demo.apk', appPackage: 'com.demo.app', appActivity: '.Main' }, 'android'],
    ['Android(UiAutomator脚本)', { testScript: 'd.find_element(AppiumBy.android_uiautomator, "new UiSelector().text(\\"登录\\")")' }, 'android'],
    ['iOS(XCUITest)', { testScript: 'let app = XCUIApplication(); bundleId: com.demo.ios' }, 'ios'],
    ['鸿蒙(hap+ability)', { caseFile: '/tmp/demo.hap', abilityName: 'EntryAbility', bundleName: 'com.demo.ohos' }, 'harmony'],
    ['鸿蒙(@ohos 脚本)', { testScript: "import { Driver, ON } from '@ohos.UiTest'" }, 'harmony'],
    ['Windows(WinAppDriver)', { testScript: "webdriver.Remote('http://127.0.0.1:4723', {'app': 'Demo_abc1!App'})" }, 'windows'],
    ['Windows(pywinauto+exe)', { testScript: 'Application().start(r"C:\\Program Files\\Demo\\demo.exe")' }, 'windows'],
    ['macOS(atomacos)', { testScript: "atomacos.getAppRefByBundleId('com.demo.mac')" }, 'mac'],
    ['空输入回落 Web', { text: '随便测一下' }, 'web'],
  ];
  for (const [label, input, expect] of cases) {
    const d = detectPlatform(input);
    check(`${label} → ${expect}`, d.platform === expect, { got: d.platform, scores: d.scores });
  }
  check('显式 platform 优先于自动判定', (() => {
    const d = detectPlatform({ platform: 'harmony', text: 'https://a.com appPackage: com.x' });
    return d.platform === 'harmony' && d.source === 'explicit';
  })());

  const srvM = await startFakeDriver(4799, 'login');
  const srvW = await startFakeDriver(4798, 'win');
  const srvMac = await startFakeDriver(4797, 'mac');
  const MOBILE_URL = 'http://127.0.0.1:4799';
  const WIN_URL = 'http://127.0.0.1:4798';
  const MAC_URL = 'http://127.0.0.1:4797';

  console.log('\n=== 2. 移动端全链路(未传 platform,执行器自动判定)===');
  const m = await mobile.executeMobileE2E({
    text: '安卓App登录测试',
    caseFile: '/tmp/demo.apk',
    appPackage: 'com.demo.app',
    appiumUrl: MOBILE_URL,
    restartAppBetweenCases: true,
    timeout: 8000,
    cases: [
      { name: 'E2E-001 资源id定位', steps: [
        { action: 'fill', selector: 'com.demo:id/user', value: 'tester' },
        { action: 'fill', selector: 'com.demo:id/pwd', value: '123456' },
        { action: 'click', selector: 'com.demo:id/login' },
        { action: 'expectText', selector: 'com.demo:id/title', text: '欢迎' },
      ] },
      { name: 'E2E-002 语义定位(人话 target)', steps: [
        { action: 'fill', selector: 'com.demo:id/user', value: 'u2' },
        { action: 'fill', selector: 'com.demo:id/pwd', value: 'p2' },
        { action: 'click', target: '登录' },
        { action: 'expectText', text: '欢迎' },
      ] },
      { name: 'E2E-003 断言失败路径', steps: [{ action: 'expectText', selector: 'com.demo:id/none', text: '不存在' }] },
    ],
  });
  console.log(`  → platform=${m.platform} summary=${JSON.stringify(m.summary)}`);
  check('自动判定为 android', m.platform === 'android', m.platform);
  check('2 通过 1 失败', m.summary.passed === 2 && m.summary.failed === 1, m.summary);
  check('失败用例带堆栈与截图', !!m.testcases[2].stack && !!m.testcases[2].screenshot);
  check('route 回传判定依据', m.route.confidence === 'high' && m.route.reasons.length > 0);

  console.log('\n=== 3. PC 客户端全链路(Windows / macOS)===');
  const w = await desktop.executeDesktopE2E({
    text: 'Windows 客户端登录后可以看到欢迎语',
    testScript: "webdriver.Remote('http://127.0.0.1:4723', {'app': 'Demo_abc1!App'}) // WinAppDriver",
    winAppDriverUrl: WIN_URL,
    timeout: 8000,
    cases: [{ name: 'PC-001', steps: [
      { action: 'click', selector: 'btnCalc' },
      { action: 'expectText', selector: 'txtTitle', text: '欢迎使用PC客户端' },
    ] }],
  });
  console.log(`  → platform=${w.platform} summary=${JSON.stringify(w.summary)}`);
  check('windows 自动判定并通过', w.platform === 'windows' && w.summary.passed === 1, w.summary);

  const macres = await desktop.executeDesktopE2E({
    text: 'macOS 桌面客户端登录后可以看到欢迎语',
    testScript: "atomacos.getAppRefByBundleId('com.demo.mac')",
    bundleId: 'com.demo.mac',
    winAppDriverUrl: MAC_URL,
    timeout: 8000,
    cases: [{ name: 'MAC-001', steps: [
      { action: 'click', selector: 'btnStart' },
      { action: 'expectText', selector: 'lblHello', text: '欢迎' },
    ] }],
  });
  console.log(`  → platform=${macres.platform} summary=${JSON.stringify(macres.summary)}`);
  check('mac 自动判定并通过', macres.platform === 'mac' && macres.summary.passed === 1, macres.summary);

  console.log('\n=== 4. 路由纠偏(平台判给别的工具)===');
  const wrong = await desktop.executeDesktopE2E({
    text: '安卓App登录测试', caseFile: '/tmp/demo.apk', appPackage: 'com.demo.app',
    winAppDriverUrl: WIN_URL, timeout: 3000,
    cases: [{ name: '误发', steps: [{ action: 'click', target: '登录' }] }],
  });
  check('返回 ROUTE_MISMATCH', wrong.error === 'ROUTE_MISMATCH', wrong.error);
  check('建议改调 mobile-e2e-invoker', wrong.route.recommendedTool === 'mobile-e2e-invoker', wrong.route.recommendedTool);
  const webWrong = await mobile.executeMobileE2E({
    text: '打开 https://example.com/login 完成登录',
    appiumUrl: MOBILE_URL, timeout: 3000,
    cases: [{ name: 'W', steps: [{ action: 'goto', url: 'https://example.com/login' }] }],
  });
  check('Web 内容路由到 ui-direct-invoker', webWrong.error === 'ROUTE_MISMATCH' && webWrong.route.recommendedTool === 'ui-direct-invoker', webWrong.route.recommendedTool);

  console.log('\n=== 5. 环境不可用的降级(不抛异常)===');
  const envFail = await mobile.executeMobileE2E({
    text: '安卓App登录测试', caseFile: '/tmp/demo.apk',
    appiumUrl: 'http://127.0.0.1:1', timeout: 2000,
    cases: [{ name: 'X', steps: [{ action: 'click', target: '登录' }] }],
  });
  check('返回 ENV_NOT_READY', envFail.error === 'ENV_NOT_READY', envFail.error);
  check('带可执行整改清单', Array.isArray(envFail.envGuide) && envFail.envGuide.length >= 3);

  srvM.close(); srvW.close(); srvMac.close();
  console.log(`\n===== 自测结果: ${pass} 通过 / ${fail} 失败 =====\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('自测脚本异常:', e); process.exit(1); });
