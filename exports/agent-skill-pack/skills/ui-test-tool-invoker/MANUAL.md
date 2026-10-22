# SKILL.md — ui-test-tool-invoker 安装与使用手册

> Skill ID：`ui-test-tool-invoker` · 类型：可执行 Skill · 目录：`skills/ui-test-tool-invoker`

## 1. 用途

封装 Playwright、Selenium、Cypress 三个主流 UI 自动化测试工具的调用逻辑，供 ui-e2e-executor 智能体在执行 UI 测试时自动调用。

## 2. 目录结构

```text
ui-test-tool-invoker/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Playwright**：`npm install playwright playwright-core`，然后 `npx playwright install chromium`。
- **按 `testFramework` 选装执行器**：Playwright（`npm i -D @playwright/test && npx playwright install`）或 Appium。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "testScript": "./tests/ui/login.spec.ts",
  "testFramework": "playwright"
}
JSON
node invoke-skill.mjs ui-test-tool-invoker --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/ui-test-tool-invoker/backend/ui-test-invoker.js';
const result = await skill.invoke({"testScript":"./tests/ui/login.spec.ts","testFramework":"playwright"});
console.log(result);
```

### 4.3 入口 `ui-test-tool-invoker`

- 文件：`skills/ui-test-tool-invoker/backend/ui-test-invoker.js`
- 导出：`invoke`
- 说明：UI/E2E 测试工具调用:执行 Playwright/Selenium/Cypress 脚本并返回 UTRM 标准结果。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `testScript` | string | 是 | 测试脚本路径或脚本内容 |
| `testFramework` | string | 否 | 强制指定框架: playwright/selenium/cypress;留空则自动检测 |
| `testType` | string | 否 | 测试类型(可选) |
| `testPattern` | string | 否 | 测试匹配模式(可选) |
| `env` | object | 否 | 执行环境变量 |
| `options` | object | 否 | 执行选项(workers/timeout/retries/coverage/verbose/debug) |

**示例参数**

```json
{
  "testScript": "./tests/ui/login.spec.ts",
  "testFramework": "playwright"
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs ui-test-tool-invoker --file params.json
```

**直接 import**

```js
import * as skill from './skills/ui-test-tool-invoker/backend/ui-test-invoker.js';
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
