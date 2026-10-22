/**
 * 移动端 E2E 执行器(Android / iOS / HarmonyOS)
 * ============================================================
 * 承接 "移动 App 功能测试":安装/拉起被测 App,按用例步骤驱动真实控件,
 * 产出与 Web 通道一致的 UTRM 结果,可直接被 result-aggregator 聚合。
 *
 * 协议:Appium W3C REST(不引入任何 npm 依赖,见 remote-driver.js 说明)
 * 默认服务地址:http://127.0.0.1:4723(可用 appiumUrl 覆盖,支持远程执行机)
 */

'use strict';

const { executeE2E } = require('./executor-core');

const DEFAULT_SERVER = 'http://127.0.0.1:4723';

/**
 * 组装 Appium desired capabilities
 * @param {string} platform android / ios / harmony
 * @param {object} p 工具入参(显式参数优先)
 * @param {object} app 自动抽取到的应用配置
 */
function buildCaps(platform, p, app) {
  const deviceName = p.deviceName || app.deviceName || (platform === 'ios' ? 'iPhone Simulator' : platform === 'harmony' ? 'HarmonyOS Device' : 'Android Emulator');
  const common = {
    'appium:deviceName': deviceName,
    'appium:platformVersion': p.platformVersion || app.platformVersion || null,
    'appium:udid': p.udid || app.udid || null,
    'appium:noReset': p.noReset === undefined ? true : !!p.noReset,
    'appium:fullReset': !!p.fullReset,
    'appium:newCommandTimeout': Number(p.newCommandTimeout || 240),
    'appium:autoGrantPermissions': p.autoGrantPermissions === undefined ? true : !!p.autoGrantPermissions,
  };

  const appPath = p.appPath || p.app || app.appPath || null;

  if (platform === 'android') {
    const caps = {
      platformName: 'Android',
      ...common,
      'appium:automationName': p.automationName || 'UiAutomator2',
    };
    const pkg = p.appPackage || app.appPackage;
    const act = p.appActivity || app.appActivity;
    if (pkg) caps['appium:appPackage'] = pkg;
    if (act) caps['appium:appActivity'] = act;
    if (!pkg && appPath) caps['appium:app'] = appPath;
    return caps;
  }

  if (platform === 'ios') {
    const caps = { platformName: 'iOS', ...common };
    caps['appium:automationName'] = p.automationName || 'XCUITest';
    const bundleId = p.bundleId || app.bundleId;
    if (bundleId) caps['appium:bundleId'] = bundleId;
    if (!bundleId && appPath) caps['appium:app'] = appPath;
    return caps;
  }

  // harmony:不同版本 Appium 鸿蒙驱动的 automationName 命名不统一(HarmonyOS / Ohos / UiAutomator),
  // 默认给 HarmonyOS,可通过 automationName 入参覆盖。
  const caps = { platformName: p.platformName || 'HarmonyOS', ...common };
  caps['appium:automationName'] = p.automationName || 'HarmonyOS';
  const bundleName = p.bundleName || app.bundleName;
  const abilityName = p.abilityName || app.abilityName;
  if (bundleName) caps['appium:bundleName'] = bundleName;
  if (abilityName) caps['appium:abilityName'] = abilityName;
  if (!bundleName && appPath) caps['appium:app'] = appPath;
  return caps;
}

function envGuide(platform) {
  const base = [
    '确认 Appium Server 已启动: npx appium --address 127.0.0.1 --port 4723(远程执行机请把地址填到 appiumUrl 参数)',
    '确认被测主机已连接设备/模拟器: adb devices 能列出设备序号(有 udid 时建议显式传入)',
  ];
  if (platform === 'android') {
    return [
      ...base,
      '确认已安装 Appium UiAutomator2 驱动: npx appium driver install uiautomator2',
      '准备被测包:传入 appPath(.apk)或 appPackage + appActivity(后者要求 App 已安装)',
      '首次跑真机请在设备上授权 USB 调试,并在 caps 里保留 autoGrantPermissions=true',
    ];
  }
  if (platform === 'ios') {
    return [
      ...base,
      '确认已安装 XCUITest 驱动: npx appium driver install xcuitest',
      'iOS 真机需要有效的开发者签名:appium driver run xcuitest authorize-iOS',
      '改用模拟器更省事:caps 里传 deviceName="iPhone Simulator" + platformVersion',
      '该平台和 iOS 相关的驱动依赖只能在 macOS 主机上跑完(WDA 依赖 XCTest)',
    ];
  }
  return [
    ...base,
    '确认已安装鸿蒙 Appium 驱动(社区版名称不一,以实际安装的 driver 为准): npx appium driver list --installed',
    '若 automationName 与实际驱动不符,请在入参里显式传 automationName 覆盖',
    '准备被测包:传入 appPath(.hap)或 bundleName + abilityName',
    '鸿蒙设备需开启开发者模式并允许 hdc 调试',
  ];
}

/**
 * @param {object} params
 * @returns {Promise<object>} UTRM
 */
async function executeMobileE2E(params) {
  return executeE2E({
    params,
    family: 'mobile',
    tool: 'mobile-e2e',
    urlKeys: ['appiumUrl', 'serverUrl', 'driverUrl'],
    defaultServerUrl: DEFAULT_SERVER,
    buildCaps,
    envGuide,
  });
}

module.exports = {
  executeMobileE2E,
  invoke: executeMobileE2E,   // 与 ui-direct-invoker 命名习惯对齐
  buildCaps,
  envGuide,
  DEFAULT_SERVER,
};
