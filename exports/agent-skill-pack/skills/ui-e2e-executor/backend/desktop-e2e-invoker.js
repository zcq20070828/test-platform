/**
 * PC 客户端 E2E 执行器(Windows / macOS 桌面应用)
 * ============================================================
 * 承接 "PC 客户端功能测试":拉起桌面应用(.exe / .app),按用例步骤操作原生控件,
 * 产出与 Web 通道一致的 UTRM 结果。
 *
 * 两条驱动路径:
 *   Windows → Appium Windows 驱动(内部封装 WinAppDriver),或直接连 WinAppDriver
 *              (driverMode='winappdriver',此时 caps 不带 appium: 前缀)
 *   macOS   → Appium mac2 驱动(基于 macOS Accessibility / XCTest)
 *
 * 依赖说明:不引入任何 npm 依赖 cap;唯一的外部条件是"执行机上要有驱动服务在跑"。
 */

'use strict';

const { executeE2E } = require('./executor-core');

const DEFAULT_SERVER = 'http://127.0.0.1:4723';

/**
 * @param {string} platform windows / mac
 */
function buildCaps(platform, p, app) {
  if (platform === 'windows') {
    const direct = String(p.driverMode || '').toLowerCase() === 'winappdriver';
    const appId = p.windowsAppId || p.appId || app.windowsAppId || p.appPath || app.appPath || null;
    const base = {
      platformName: 'Windows',
      deviceName: p.deviceName || 'WindowsPC',
      'appium:automationName': p.automationName || 'Windows',
      'appium:newCommandTimeout': Number(p.newCommandTimeout || 240),
    };
    if (direct) {
      // WinAppDriver 自身不识别 appium: 前缀,直接传裸键,否则会话会挂到桌面根节点
      return {
        platformName: 'Windows',
        deviceName: p.deviceName || 'WindowsPC',
        app: appId,
        appTopLevelWindow: p.appTopLevelWindow || null,
      };
    }
    return {
      ...base,
      'appium:app': appId,
      'appium:appTopLevelWindow': p.appTopLevelWindow || null,
    };
  }

  // macOS —— Appium mac2 驱动
  const bundleId = p.bundleId || app.bundleId || null;
  const caps = {
    platformName: 'Mac',
    'appium:automationName': p.automationName || 'mac2',
    'appium:deviceName': p.deviceName || 'macOS',
    'appium:platformVersion': p.platformVersion || null,
    'appium:newCommandTimeout': Number(p.newCommandTimeout || 240),
    'appium:noReset': p.noReset === undefined ? true : !!p.noReset,
  };
  if (bundleId) caps['appium:bundleId'] = bundleId;
  else if (p.appPath || app.appPath) caps['appium:app'] = p.appPath || app.appPath;
  return caps;
}

function envGuide(platform) {
  if (platform === 'windows') {
    return [
      'Windows 客户端测试**必须跑在 Windows 执行机上**(本机为 macOS 时请把 winAppDriverUrl 指向那台机器)',
      '安装 WinAppDriver: https://github.com/microsoft/WinAppDriver/releases ,并在"设置 → 开发者选项"开启开发人员模式',
      '启动驱动服务: WinAppDriver.exe 4723(默认端口 4723,需放行防火墙)',
      '被测应用标识:用 Windows SDK 的 Inspect.exe 取到形如 "包名_xxxx!App" 的应用 ID,或传 .exe 绝对路径',
      '走 WinAppDriver 直连时请传 driverMode="winappdriver"(caps 不带 appium: 前缀)',
    ];
  }
  return [
    '安装 Appium mac2 驱动: npx appium driver install mac2',
    '在"系统设置 → 隐私与安全性 → 辅助功能"里勾选运行 Appium / 终端的宿主程序,否则拿不到控件树',
    '启动服务: npx appium --address 127.0.0.1 --port 4723',
    '被测应用:传 bundleId(如 com.apple.calculator)或 .app 绝对路径',
    '若是自研 App,需确认已做 Accessibility 标注,否则控件树里只有窗口没有子元素',
  ];
}

/**
 * @param {object} params
 * @returns {Promise<object>} UTRM
 */
async function executeDesktopE2E(params) {
  return executeE2E({
    params,
    family: 'desktop',
    tool: 'desktop-e2e',
    urlKeys: ['winAppDriverUrl', 'desktopUrl', 'appiumUrl', 'serverUrl', 'driverUrl'],
    defaultServerUrl: DEFAULT_SERVER,
    buildCaps,
    envGuide,
  });
}

module.exports = {
  executeDesktopE2E,
  invoke: executeDesktopE2E,
  buildCaps,
  envGuide,
  DEFAULT_SERVER,
};
