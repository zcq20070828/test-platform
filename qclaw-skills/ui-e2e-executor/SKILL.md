# ui-e2e-executor —— 多端 UI/E2E 执行器

承接「UI/E2E 测试」智能体(ui-e2e-executor)的**移动 App** 与 **PC 客户端**功能测试执行能力。

| 平台 | 族 | 驱动 | 默认服务地址 |
|------|------|------|------|
| Android | mobile | Appium + UiAutomator2 | http://127.0.0.1:4723 |
| iOS | mobile | Appium + XCUITest | 同上 |
| HarmonyOS(鸿蒙) | mobile | Appium Harmony 驱动 | 同上 |
| Windows 桌面客户端 | desktop | Appium Windows 驱动 / WinAppDriver | 同上 |
| macOS 桌面客户端 | desktop | Appium mac2 驱动 | 同上 |

> Web 不在本包职责内,仍由 `ui-direct-invoker`(Playwright)承接。

## 目录结构

```
backend/
  platform-detect.js   平台自动识别:用例文件 / 测试脚本 / 需求描述 → 平台
  remote-locator.js    定位写法归一化:id= / text= / xpath= / 人话 / resource-id
  remote-driver.js     W3C REST 会话客户端(零 npm 依赖)
  step-runner.js       步骤执行引擎(script 模式)
  intent-runner.js     执行↔推理闭环(intent 模式)
  executor-core.js     移动端/PC 端共用内核(判定→探活→会话→用例循环→UTRM)
  mobile-e2e-invoker.js    Android / iOS / 鸿蒙  入口 executeMobileE2E
  desktop-e2e-invoker.js   Windows / macOS       入口 executeDesktopE2E
```

## 平台自动判定(核心诉求)

`platform-detect.js` 用加权规则对输入语料打分,输出 `{platform, family, invoker, confidence, reasons, alternatives}`:

- 语料来源:`text/task/description/goal`、`caseFile/testScript/script`(支持本地文件路径自动读取)、`cases/steps/url/appPackage/bundleId` 等
- 显式传 `platform` 时**永远覆盖**自动判定
- 判定结果为 Web 时,`mobile-*` / `desktop-*` 会返回 `ROUTE_MISMATCH`,并在 `route.recommendedTool` 指明应改调的工具
- 无信号时回落到 `web` 并标注 `assumed=true`

判定信号示例:`.apk / appPackage / appActivity / UiAutomator / adb` → android;`XCUITest / bundleId / .ipa` → ios;`@ohos / .hap / abilityName / UiTest` → harmony;`WinAppDriver / .exe / AutomationId / pywinauto` → windows;`atomacos / AXUIElement / .app / mac2` → mac。

## 步骤动作词汇表

与 `ui-direct-invoker`(Web)同名同语义,故跨端用例可平移。

| 动作 | 说明 | 平台差异 |
|------|------|---------|
| `click` / `tap` | 点击 | — |
| `fill` / `type` | 先 clear 再输入 | 规避移动端输入法追加 |
| `clear` | 清空输入 | — |
| `press` | 按键 | Android 走 keycode(66=Enter/4=Back),其余走 W3C 键值 |
| `swipe` / `scroll` | 滑动/滚动 | 比例坐标 0~1,内部换算像素 |
| `wait` | 固定等待 ms | — |
| `waitFor` / `expectVisible` | 等待并检查可见 | — |
| `expectText` | 文本断言 | 无 selector 时回退整屏控件树文本 |
| `expectHidden` / `expectNotExists` | 不存在断言 | — |
| `screenshot` | 截图落盘 | 输出到 `$TMPDIR/<family>-e2e-shots/` |
| `launch` / `restart` / `close` | 应用生命周期 | — |
| `goto` | deep link 拉起页面 | PC 客户端不支持(返回明确提示) |

selector 写法:`com.demo:id/login`(resource-id)、`text=登录`、`xpath=//…`、`accessibilityId=我的`、Windows `AutomationId`、macOS `AXIdentifier`,也可直接写人话(会按 accessibilityId → text → xpath 依次尝试)。

## 输出

统一 UTRM(`tool/summary/testcases/exitCode/raw`),与 `api-direct-invoker`、`ui-direct-invoker` 完全同构,`result-aggregator` 无需改动即可聚合。

附加字段:

- `route`:本次平台判定详情(平台、置信度、依据、使用的 capabilities、sessionId)
- `error: ROUTE_MISMATCH`:判定平台不在本执行器范围,`route.recommendedTool` 给出应调用的工具
- `error: ENV_NOT_READY` + `envGuide`:驱动服务不可用,给出可直接执行的整改清单(不抛异常)

## 环境要求

驱动服务必须在**执行机**上运行(可以是远程机器,把地址传给 `appiumUrl` 即可):

- Android: `npx appium driver install uiautomator2` + `adb devices` 可见设备
- iOS: `npx appium driver install xcuitest`(仅 macOS 主机)
- 鸿蒙:安装对应社区驱动,必要时用 `automationName` 覆盖默认名
- Windows: WinAppDriver + 开发人员模式(仅 Windows 主机)
- macOS: `npx appium driver install mac2` + 辅助功能权限授权

本执行器不引入任何 npm 依赖。
