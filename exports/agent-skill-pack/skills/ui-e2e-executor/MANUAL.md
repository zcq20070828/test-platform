# ui-e2e-executor —— 多端 UI/E2E 执行器 安装与使用手册

> Skill ID：`ui-e2e-executor` · 类型：可执行 Skill · 目录：`skills/ui-e2e-executor`

## 1. 用途

Web 不在本包职责内,仍由 ui-direct-invoker(Playwright)承接。

## 2. 目录结构

```text
ui-e2e-executor/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Playwright**：`npm install playwright playwright-core`，然后 `npx playwright install chromium`。
- **Appium**：启动 Appium Server，并安装对应驱动（UiAutomator2 / XCUITest / HarmonyOS / WinAppDriver / mac2）。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "platform": "android",
  "appPackage": "com.example.app",
  "appActivity": ".MainActivity",
  "cases": [
    {
      "name": "启动",
      "steps": [
        {
          "action": "launch"
        },
        {
          "action": "expectVisible",
          "selector": "~home"
        }
      ]
    }
  ]
}
JSON
node invoke-skill.mjs mobile-e2e-invoker --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/ui-e2e-executor/backend/mobile-e2e-invoker.js';
const result = await skill.executeMobileE2E({"platform":"android","appPackage":"com.example.app","appActivity":".MainActivity","cases":[{"name":"启动","steps":[{"action":"launch"},{"action":"expectVisible","selector":"~home"}]}]});
console.log(result);
```

### 4.3 入口 `mobile-e2e-invoker`

- 文件：`skills/ui-e2e-executor/backend/mobile-e2e-invoker.js`
- 导出：`executeMobileE2E`
- 说明：移动App功能测试执行器(Android / iOS / HarmonyOS 鸿蒙):通过 Appium W3C 协议驱动真机/模拟器,按用例步骤操作原生控件并产出 UTRM 结果。platform 不传时,执行器会根据【用例文件/测试脚本/需求描述】自动判定目标平台;若判定结果不是移动端,会返回 ROUTE_MISMATCH 并指明应改调的工具。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `platform` | enum(android / ios / harmony) | 否 | 目标平台 android / ios / harmony。**留空则由执行器自动判定**(推荐,智能体无需人工声明) |
| `text` | string | 否 | 需求描述 / 测试范围说明,参与平台自动判定 |
| `caseFile` | string | 否 | 用例文件路径(.xlsx/.csv/.md/.json)或用例正文,参与平台自动判定 |
| `testScript` | string | 否 | 测试脚本路径或脚本内容(Appium/Espresso/XCUITest/Hypium 等),参与平台自动判定 |
| `goal` | string | 否 | mode=intent 时的自然语言测试目标 |
| `mode` | enum(script / intent) | 否 | script(默认)=按 steps 执行; intent=意图驱动:模型临场观察控件树决定下一步并自动生成断言 |
| `cases` | array | 否 | 场景数组。每项 { name, steps:[...] };intent 模式下每项可只给 { name, goal }。action 支持 click/tap/fill/type/clear/press/swipe/scroll/wait/waitFor/expectVisible/expectHidden/expectNotExists/expectText/expectValue/screenshot/launch/restart/close/back/hideKeyboard/goto |
| `steps` | array | 否 | 单场景简写(与 cases 二选一) |
| `appPath` | string | 否 | 安装包路径(.apk / .ipa / .hap) |
| `appPackage` | string | 否 | Android 包名(与 appActivity 配对,要求 App 已安装) |
| `appActivity` | string | 否 | Android 入口 Activity |
| `bundleId` | string | 否 | iOS Bundle ID |
| `bundleName` | string | 否 | 鸿蒙 bundleName |
| `abilityName` | string | 否 | 鸿蒙 abilityName |
| `deviceName` | string | 否 | 设备/模拟器名称 |
| `platformVersion` | string | 否 | 系统版本 |
| `udid` | string | 否 | 设备唯一标识(多设备时强烈建议传入) |
| `automationName` | string | 否 | 覆盖默认驱动名(UiAutomator2 / XCUITest / HarmonyOS) |
| `noReset` | boolean | 否 | 不重置应用状态,默认 true |
| `fullReset` | boolean | 否 | 执行前卸载重装应用,默认 false |
| `appiumUrl` | string | 否 | Appium Server 地址,默认 http://127.0.0.1:4723;执行机在远端时填远端地址 |
| `capabilities` | object | 否 | 额外的 Appium capabilities,会合并覆盖默认值 |
| `timeout` | number | 否 | 单步超时(ms),默认 15000 |
| `vars` | object | 否 | 初始变量,供 {{var}} 引用 |
| `restartAppBetweenCases` | boolean | 否 | 每个用例前重启 App,保证用例互相隔离 |
| `screenshotOnFail` | boolean | 否 | 失败时截图,默认 true |
| `screenshotOnSuccess` | boolean | 否 | 成功时截图,默认 false |
| `stopOnFail` | boolean | 否 | 失败后中止后续场景,默认 false |

**示例参数**

```json
{
  "platform": "android",
  "appPackage": "com.example.app",
  "appActivity": ".MainActivity",
  "cases": [
    {
      "name": "启动",
      "steps": [
        {
          "action": "launch"
        },
        {
          "action": "expectVisible",
          "selector": "~home"
        }
      ]
    }
  ]
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs mobile-e2e-invoker --file params.json
```

**直接 import**

```js
import * as skill from './skills/ui-e2e-executor/backend/mobile-e2e-invoker.js';
const result = await skill.executeMobileE2E(/* 上面的示例参数 */);
```

### 4.4 入口 `desktop-e2e-invoker`

- 文件：`skills/ui-e2e-executor/backend/desktop-e2e-invoker.js`
- 导出：`executeDesktopE2E`
- 说明：PC客户端功能测试执行器(Windows / macOS 桌面应用):通过 Appium Windows 驱动 / WinAppDriver / mac2 驱动操作原生桌面控件并产出 UTRM 结果。platform 不传时按【用例文件/测试脚本/需求描述】自动判定;Windows 用例需在 Windows 执行机上运行并把地址传给 winAppDriverUrl。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `platform` | enum(windows / mac) | 否 | 目标平台 windows / mac。**留空则由执行器自动判定** |
| `text` | string | 否 | 需求描述 / 测试范围说明,参与平台自动判定 |
| `caseFile` | string | 否 | 用例文件路径或正文,参与平台自动判定 |
| `testScript` | string | 否 | 测试脚本路径或内容(WinAppDriver / pywinauto / atomacos 等),参与平台自动判定 |
| `goal` | string | 否 | mode=intent 时的自然语言测试目标 |
| `mode` | enum(script / intent) | 否 | script(默认)=按 steps 执行; intent=意图驱动 |
| `cases` | array | 否 | 场景数组,每项 { name, steps:[...] };动作同移动端执行器 |
| `steps` | array | 否 | 单场景简写 |
| `windowsAppId` | string | 否 | Windows 应用标识(形如 Microsoft.WindowsCalculator_8wekyb3d8bbwe!App) |
| `appPath` | string | 否 | 应用路径(.exe / .app) |
| `bundleId` | string | 否 | macOS Bundle ID |
| `appTopLevelWindow` | string | 否 | Windows 顶层窗口句柄(十六进制字符串) |
| `driverMode` | enum(appium / winappdriver) | 否 | winappdriver=直连 WinAppDriver(caps 不带 appium: 前缀);留空走 Appium |
| `winAppDriverUrl` | string | 否 | WinAppDriver / Appium 地址,默认 http://127.0.0.1:4723 |
| `automationName` | string | 否 | 覆盖默认驱动名(Windows / mac2) |
| `capabilities` | object | 否 | 额外的 capabilities,会合并覆盖默认值 |
| `timeout` | number | 否 | 单步超时(ms),默认 15000 |
| `vars` | object | 否 | 初始变量,供 {{var}} 引用 |
| `restartAppBetweenCases` | boolean | 否 | 每个用例前重启应用 |
| `screenshotOnFail` | boolean | 否 | 失败时截图,默认 true |
| `stopOnFail` | boolean | 否 | 失败后中止后续场景,默认 false |

**示例参数**

```json
{
  "platform": "mac",
  "bundleId": "com.example.app",
  "cases": [
    {
      "name": "启动",
      "steps": [
        {
          "action": "launch"
        }
      ]
    }
  ]
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs desktop-e2e-invoker --file params.json
```

**直接 import**

```js
import * as skill from './skills/ui-e2e-executor/backend/desktop-e2e-invoker.js';
const result = await skill.executeDesktopE2E(/* 上面的示例参数 */);
```

## 5. 输出说明

返回 **UTRM** 统一结果：

```json
{
  "tool": "工具名",
  "timestamp": "ISO 时间",
  "summary": { "total": 1, "passed": 1, "failed": 0, "skipped": 0, "duration": 123 },
  "testcases": [ { "name": "用例名", "status": "passed", "duration": 100, "error": null, "steps": [] } ],
  "exitCode": 0,
  "raw": null
}
```

可直接交给 `result-aggregator` 聚合，或作为测试证据落库。

## 6. 限制与排错

- 工具未安装或不在 PATH：返回失败/`TOOL_NOT_FOUND`，不会伪造测试通过；先按第 3 节安装。
- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。
- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。
- Playwright 解析失败：请确认在技能包根目录执行过 `npm install playwright playwright-core`，并且 `npx playwright install chromium` 已完成。
- Appium 连接失败：检查 Appium Server 地址、设备/模拟器是否在线、驱动版本是否匹配。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
