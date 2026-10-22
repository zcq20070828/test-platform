# UI 直执执行器（ui-direct-invoker） 安装与使用手册

> Skill ID：`ui-direct-invoker` · 类型：可执行 Skill · 目录：`skills/ui-direct-invoker`

## 1. 用途

免脚本 UI/E2E 测试直执执行器。直接用 Playwright 驱动真实浏览器按步骤执行（goto/click/fill/断言），输出 UTRM 标准结果，不需要先生成 Playwright/Selenium/Cypress 脚本文件。当用户提供测试用例、操作步骤、测试URL+账号密码并要求"直接执行/跑一遍UI测试"时使用本技能，避免先产出脚本中间物。

## 2. 目录结构

```text
ui-direct-invoker/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Playwright**：`npm install playwright playwright-core`，然后 `npx playwright install chromium`。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "baseUrl": "https://example.com",
  "browser": "chromium",
  "steps": [
    {
      "action": "goto",
      "url": "/"
    },
    {
      "action": "expectTitle",
      "value": "Example"
    }
  ]
}
JSON
node invoke-skill.mjs ui-direct-invoker --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/ui-direct-invoker/backend/ui-direct-invoker.js';
const result = await skill.invoke({"baseUrl":"https://example.com","browser":"chromium","steps":[{"action":"goto","url":"/"},{"action":"expectTitle","value":"Example"}]});
console.log(result);
```

### 4.3 入口 `ui-direct-invoker`

- 文件：`skills/ui-direct-invoker/backend/ui-direct-invoker.js`
- 导出：`invoke`
- 说明：UI/E2E 测试免脚本直执:直接用 Playwright 驱动真实浏览器按步骤序列执行(goto/click/fill/断言),返回 UTRM 结果。不需要先生成 Playwright/Selenium/Cypress 脚本文件;当输入是用例文档、操作步骤或 测试URL+账号密码 时使用。失败自动截图。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `baseUrl` | string | 否 | 基地址,步骤 url 可写相对路径 |
| `browser` | string | 否 | chromium(默认)/firefox/webkit |
| `headless` | boolean | 否 | 无头模式,默认 true |
| `viewport` | object | 否 | { width, height },默认 1280x720 |
| `timeout` | number | 否 | 单步超时(ms),默认 15000 |
| `mode` | enum(script / intent) | 否 | script(默认)=按 steps/cases 执行; intent=意图驱动:模型临场观察页面决定下一步,元素用语义描述定位、失效自愈 |
| `goal` | string | 否 | mode=intent 时必填:自然语言测试目标,如「验证用户能登录并看到用户名」 |
| `credentials` | object | 否 | 登录凭证 { username, password },注入为 {{username}}/{{password}} 供模型生成的填表步骤引用 |
| `maxSteps` | number | 否 | mode=intent 时最大执行步数,默认 25 |
| `maxLlmCalls` | number | 否 | mode=intent 时最大模型调用次数(成本控制),默认 12 |
| `visualMode` | enum(compare / update / off) | 否 | compare(默认)=与视觉基线比对; update=刷新基线; off=关闭 |
| `visualThreshold` | number | 否 | 视觉差异率阈值,默认 0.15,超出判 fail |
| `screenshotOnFail` | boolean | 否 | 失败时截图,默认 true |
| `screenshotOnSuccess` | boolean | 否 | 成功时截图,默认 false |
| `cases` | array | 否 | 场景数组。每项: { name, steps:[ {action,selector,value,url,...} ], extract:{变量名:"text:.sel"} }。action 支持 goto/click/dblclick/fill/type/press/select/check/uncheck/hover/wait/waitFor/waitForUrl/reload/goBack/screenshot/expectText/expectVisible/expectHidden/expectUrl/expectTitle/expectCount/expectValue/expectAttribute |
| `steps` | array | 否 | 单场景简写(与 cases 二选一) |
| `vars` | object | 否 | 初始变量,供 {{var}} 引用 |
| `stopOnFail` | boolean | 否 | 失败后中止后续场景,默认 false |

**示例参数**

```json
{
  "baseUrl": "https://example.com",
  "browser": "chromium",
  "steps": [
    {
      "action": "goto",
      "url": "/"
    },
    {
      "action": "expectTitle",
      "value": "Example"
    }
  ]
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs ui-direct-invoker --file params.json
```

**直接 import**

```js
import * as skill from './skills/ui-direct-invoker/backend/ui-direct-invoker.js';
const result = await skill.invoke(/* 上面的示例参数 */);
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
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
