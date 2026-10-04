---
name: ui-direct-invoker
description: 免脚本 UI/E2E 测试直执执行器。直接用 Playwright 驱动真实浏览器按步骤执行（goto/click/fill/断言），输出 UTRM 标准结果，不需要先生成 Playwright/Selenium/Cypress 脚本文件。当用户提供测试用例、操作步骤、测试URL+账号密码并要求"直接执行/跑一遍UI测试"时使用本技能，避免先产出脚本中间物。
---

# UI 直执执行器（ui-direct-invoker）

## 定位

`ui-test-tool-invoker` 要求先有 `testScript`（脚本路径或内容）才能执行，
导致 UI/E2E 测试链路必须先"造脚本"。本技能**跳过这一步**：直接驱动真实浏览器逐步执行。

- 依赖：`playwright` 可编程库（backend/node_modules 已装），**不写脚本文件、不启动 test runner**
- 输出：UTRM 标准格式（与 `api-test-invoker`、`api-direct-invoker` 一致，可被 `result-aggregator` 消费）
- 失败自动截图（返回文件路径 + 小于 200KB 时附 base64）

## 何时用

| 场景 | 用哪个 |
|---|---|
| 用户给了用例/步骤/URL+账号密码，要求直接执行 | **本技能** |
| 用户明确要可复用的 Playwright 脚本资产 | `test-script-generator` + `ui-test-tool-invoker` |
| 需接入 CI、长期回归 | 生成脚本（脚本更适合沉淀） |

## 输入参数

调用入口：`invoke(params)`

| 参数 | 类型 | 说明 |
|---|---|---|
| `baseUrl` | string | 基地址，步骤中 `url` 可写相对路径 |
| `browser` | string | `chromium`（默认）/ `firefox` / `webkit` |
| `headless` | boolean | 默认 true |
| `viewport` | object | `{ width, height }`，默认 1280×720 |
| `timeout` | number | 单步超时(ms)，默认 15000 |
| `screenshotOnFail` | boolean | 默认 true |
| `screenshotOnSuccess` | boolean | 默认 false |
| `cases` | array | 场景数组（推荐），每个场景一个 UTRM testcase |
| `steps` | array | 单场景简写（与 `cases` 二选一） |
| `vars` | object | 初始变量，供 `{{var}}` 引用 |
| `stopOnFail` | boolean | 失败后中止后续场景，默认 false |

### 场景结构

```json
{
  "name": "用户登录成功",
  "steps": [
    { "action": "goto",    "url": "/login" },
    { "action": "fill",    "selector": "#username", "value": "admin" },
    { "action": "fill",    "selector": "#password", "value": "123456" },
    { "action": "click",   "selector": "button[type=submit]" },
    { "action": "waitFor", "selector": ".dashboard", "state": "visible" },
    { "action": "expectText", "selector": ".user-name", "text": "admin" },
    { "action": "expectUrl", "url": "/home" }
  ]
}
```

## 支持的步骤类型

### 操作类

| action | 必填参数 | 说明 |
|---|---|---|
| `goto` / `navigate` | `url` | 打开页面（支持 `waitUntil`，默认 domcontentloaded） |
| `click` | `selector` | 点击（可加 `button`、`clickCount`） |
| `dblclick` | `selector` | 双击 |
| `fill` | `selector`, `value` | 填入（会先清空） |
| `type` | `selector`, `value` | 逐字输入（可加 `delay`） |
| `press` | `key`（可选 `selector`） | 按键，如 `Enter` |
| `select` | `selector`, `value` | 下拉选择 |
| `check` / `uncheck` | `selector` | 勾选 / 取消 |
| `hover` | `selector` | 悬停 |
| `wait` | `ms` | 固定等待 |
| `waitFor` | `selector` | 等待元素（`state`: visible/hidden/attached/detached） |
| `waitForUrl` | `url` | 等待 URL 跳转 |
| `reload` / `goBack` | — | 刷新 / 后退 |
| `screenshot` | — | 截图（可加 `name`、`fullPage`） |

### 断言类

| action | 必填参数 | 说明 |
|---|---|---|
| `expectText` | `selector`, `text` | 默认"包含"；`contains:false` 改精确相等 |
| `expectVisible` / `expectHidden` | `selector` | 可见 / 隐藏 |
| `expectUrl` | `url` | 默认"包含"；`contains:false` 改精确相等 |
| `expectTitle` | `title` | 默认"包含"；`equals:true` 改精确相等 |
| `expectCount` | `selector`, `count` | 元素个数 |
| `expectValue` | `selector`, `value` | 输入框取值 |
| `expectAttribute` | `selector`, `attr`, `value` | 属性值（`contains:true` 改包含） |

## 变量联动

步骤中的字符串支持 `{{var}}`，变量来源：

1. `vars` 初始传入
2. 步骤或场景上的 `extract`：
   ```json
   "extract": { "orderNo": "text:.order-no", "csrf": "attr:meta[name=csrf]@content", "cur": "url" }
   ```
   支持前缀：`text:选择器` / `attr:选择器@属性` / `url` / `title`

## 输出（UTRM）

```json
{
  "tool": "ui-direct",
  "summary": { "total": 1, "passed": 0, "failed": 1, "skipped": 0, "duration": 2310 },
  "testcases": [
    {
      "name": "用户登录成功",
      "classname": "ui-direct",
      "status": "failed",
      "duration": 2310,
      "error": "文本断言失败 .user-name: 期望包含 \"admin\",实际 \"\"",
      "stack": "步骤 6 失败: ...\n已执行: 1.goto → 2.fill → ... → 6.expectText(FAIL)",
      "steps": [ { "step": 1, "action": "goto", "ok": true, "detail": "goto http://..." } ],
      "url": "http://.../login",
      "screenshot": { "path": "/tmp/ui-direct-shots/xxx.png", "bytes": 51233 }
    }
  ],
  "exitCode": 1,
  "raw": "FAIL 用户登录成功 (2310ms) :: 文本断言失败 ..."
}
```

## 使用约束

1. 选择器用 CSS 或 Playwright 支持的语法；元素定位失败是最常见的失败原因，优先用稳定的 `id`/`data-testid`。
2. 页面加载慢时调大 `timeout`，或先加 `waitFor` 再断言，避免断言早于渲染。
3. 场景之间共享同一个 browser context（cookie 连续），适合"登录→下单"这类连续流程。
4. 单场景步骤建议 ≤ 30 步；场景数建议 ≤ 20。
5. 断言失败会立即终止该场景（不再执行后续步骤），便于精确定位。

## 失败排查

| error | 含义 | 处理 |
|---|---|---|
| `TOOL_NOT_FOUND` | 未加载到 playwright | 在 backend 目录安装 playwright |
| `BROWSER_LAUNCH_FAILED` | 浏览器二进制缺失 | `npx playwright install chromium` |
| `未知步骤类型` | action 拼错 | 对照上表修正 |
| `缺少参数` | 步骤必填参数缺失 | 补齐 `selector` / `value` 等 |
| 元素超时 | 选择器不匹配或未渲染 | 加大 timeout 或加 `waitFor` |
