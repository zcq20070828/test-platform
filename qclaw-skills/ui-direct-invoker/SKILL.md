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

## 执行模式

| `mode` | 含义 | 何时用 |
|---|---|---|
| `script`（默认） | 按传入的 `cases`/`steps` 逐步执行 | 已有明确操作步骤 |
| `intent` | **意图驱动**：模型临场决定每一步，元素定位用语义描述、失效自动自愈 | 用户只给目标/URL+账号，没有现成步骤 |

意图驱动对标 Harness "AI-Powered Intent Testing" 五步：

1. **NL → 结构化 Test Intent**：解析目标、前置条件、入口 URL、断言点、数据依赖
2. **AI 推理 + 应用状态探索**：每步执行后采集紧凑 DOM 快照（URL/标题/可见文本/可交互元素）回传模型
3. **执行 ↔ 推理闭环**：模型据当前状态决定下一步；某步失败不立即终止，把失败反馈给模型换路径重试
4. **视觉 + DOM 双重校验**：DOM 断言 + 视觉/布局基线比对（结构签名差异率）
5. **知识回流**：执行结束产出可复用的 flow / element / contract 摘要

## 输入参数

调用入口：`invoke(params)`

| 参数 | 类型 | 说明 |
|---|---|---|
| `mode` | string | `script`（默认）/ `intent`（意图驱动） |
| `goal` | string | `intent` 模式：自然语言测试目标（如"验证用户能登录并看到用户名"） |
| `baseUrl` | string | 基地址，步骤中 `url` 可写相对路径 |
| `browser` | string | `chromium`（默认）/ `firefox` / `webkit` |
| `headless` | boolean | 默认 true |
| `viewport` | object | `{ width, height }`，默认 1280×720 |
| `timeout` | number | 单步超时(ms)，默认 15000 |
| `screenshotOnFail` | boolean | 默认 true |
| `screenshotOnSuccess` | boolean | 默认 false |
| `credentials` | object | 登录凭证 `{username, password}`，注入为 `{{username}}`/`{{password}}`；也可带 `usernameSelector`/`passwordSelector`/`submitSelector` 兜底 |
| `maxSteps` | number | `intent` 模式最大执行步数，默认 25 |
| `maxLlmCalls` | number | `intent` 模式最大模型调用次数（成本控制），默认 12 |
| `maxConsecutiveFailures` | number | `intent` 模式连续失败多少步判定阻塞，默认 2 |
| `maxElements` | number | `intent` 模式每次观察采集的可交互元素上限，默认 40（越大越准、token 越贵） |
| `visualMode` | string | `compare`（默认）/ `update` / `off` —— 视觉回归基线 |
| `visualThreshold` | number | 视觉差异率阈值，默认 0.15，超出判 fail |
| `cases` | array | 场景数组（推荐），每个场景一个 UTRM testcase |
| `steps` | array | 单场景简写（与 `cases` 二选一） |
| `vars` | object | 初始变量，供 `{{var}}` 引用 |
| `stopOnFail` | boolean | 失败后中止后续场景，默认 false |

## 语义定位（不再依赖硬编码选择器）

`intent` 模式下步骤里的 `target` 写**人话**即可，例如「用户名输入框」「登录按钮」「右上角的用户名」。
执行器会把它展开成多个候选定位并依次尝试：

`text=xxx` → `role=button[name="xxx"]` → `role=link` → `role=textbox` → `label=` → `placeholder=` → `aria-label` → `title` → `name` → `id`

**自愈**：原选择器/首选定位失效时，自动落到后续语义候选；命中的不是首选时会在结果里记录
`selfHealed: true` 与所用策略，便于人工确认是否需要更新基线定位。

**中文排版空格归一化**：按钮文案常写成「登 录」「确 定」（字间带排版空格），与模型输出的紧凑写法
「登录」字面不等。执行器会额外生成"字符间允许任意空白"的正则候选，并额外尝试去空格后的
`placeholder` / `aria-label` / `id` 匹配，避免这类误判。

**按动作类型排序候选**：`fill` / `type` 这类"可输入"动作会优先匹配 `input` / `textarea` /
`select` / `[contenteditable]`，并校验元素确实可编辑。否则「密码」会先命中
「切换密码可见性」这类 `role=button` 图标，导致 fill 抛错。

## 自动登录（前置条件自愈）

大多数 SPA 未认证时会重定向到登录页。若 `intent` 模式直接把登录页快照交给模型，
模型会在登录页上臆造"返回首页"之类快照中不存在的元素，导致执行阻塞。

执行器因此内置**登录前置自愈**：起始 `goto` 之后，若探测到当前是登录页
（URL 命中 `/login`、`/signin`、`/auth`，或页面存在 `input[type=password]`），
且调用方传入了 `credentials`，则自动执行：

1. 语义定位用户名输入框 → `fill({{username}})`
2. 语义定位密码输入框 → `fill({{password}})`（兜底 `input[type="password"]`）
3. 语义定位登录按钮 → `click`（兜底 `button[type="submit"]` / `form button`）
4. **轮询等待离开登录页**（最多 15s）

结果以一条 `action: "login"` 步骤记入 `steps`，失败时带明确错误文案。

> 注意：此处**不能**用 `waitForLoadState('networkidle')` 等待登录完成 —— 平台有 SSE 长连接，
> 网络永不静默，固定等待会误判为"登录失败"。必须用轮询判定登录态特征。

**安全约定**：`credentials` 只在运行时通过 `vars` 注入为 `{{username}}` / `{{password}}`，
不写入数据库、不写入日志；`sanitizeVars()` 会在传给模型前过滤掉
`pass / pwd / secret / token / cookie / authorization` 等敏感键。

## 视觉回归

`visualMode='compare'`（默认）时，每次执行采集页面结构签名（元素 tag:label:量化 bbox）
与基线比对，输出 `diffRatio` 与结论（pass/fail）；首次执行自动建立基线；
UI 有意改版时用 `visualMode='update'` 刷新基线；`off` 关闭。

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
