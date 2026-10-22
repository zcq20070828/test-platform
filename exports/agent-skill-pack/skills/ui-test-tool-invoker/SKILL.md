# SKILL.md — ui-test-tool-invoker

## 技能名称
`ui-test-tool-invoker`

## 分类
测试工具封装 / 自动化测试执行层

---

## 职责

封装 Playwright、Selenium、Cypress 三个主流 UI 自动化测试工具的调用逻辑，供 `ui-e2e-executor` 智能体在执行 UI 测试时自动调用。

**工具优先级：** Playwright（推荐首选）> Selenium（次选）> Cypress（备选）

---

## 工具说明

### 1. Playwright（首选）
- **定位：** 微软出品的现代端到端测试框架，支持 Chromium / Firefox / WebKit
- **优势：** 跨浏览器原生支持、自动等待、内置追踪与截图、API 简洁
- **执行方式：** `npx playwright` 或本地 `playwright` CLI
- **配置文件：** 自动发现 `playwright.config.*`
- **推荐使用场景：** 新项目、跨浏览器覆盖、快速迭代

### 2. Selenium（次选）
- **定位：** 老牌 Web 自动化框架，生态最广
- **优势：** 支持多语言、多浏览器、支持 `.side` Selenium IDE 文件
- **执行方式：** `selenium-side-runner` 或 `selenium-webdriver` Node.js API
- **支持浏览器：** Chrome / Firefox / Edge / Safari
- **推荐使用场景：** 已有 Selenium 资产、需要 Legacy 浏览器支持

### 3. Cypress（备选）
- **定位：** 为开发者设计的端到端测试框架，侧重开发体验
- **优势：** 时间旅行调试、实时重载、内置等待、网络控制
- **执行方式：** `cypress run`（CI）/ `cypress open`（交互）
- **配置文件：** 自动发现项目根目录 `cypress.json`（Cypress 10+ 为 `cypress.config.*`）
- **推荐使用场景：** React/Vue 项目、需要深度调试体验

---

## 工作流程

```
输入参数
    ↓
工具选择（selectBestTool）
    ↓
命令构建（invokePlaywright / invokeSelenium / invokeCypress）
    ↓
子进程执行（spawn）
    ↓
输出捕获（stdout / stderr）
    ↓
结果解析（parseJUnitXML / parseNativeOutput）
    ↓
UTRM 格式转换（toUTRM）
    ↓
返回标准化 JSON 结果
```

---

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `testScript` | `string` | 是 | 测试脚本路径（`.spec.js` / `.test.js` / `.side` 等）或内联脚本内容 |
| `testFramework` | `string` | 否 | 显式指定工具：`playwright` / `selenium` / `cypress`；默认自动选择 |
| `testType` | `string` | 否 | 测试类型：`e2e`（默认）/ `smoke` / `regression` |
| `env` | `object` | 否 | 环境变量键值对，注入测试进程 |
| `options` | `object` | 否 | 工具特定选项（见下方） |

### options 参数

**Playwright options：**
| 选项 | 类型 | 说明 |
|------|------|------|
| `headed` | `boolean` | 是否显示浏览器窗口，默认 `false` |
| `reporter` | `string` | 报告格式：`list`（默认）/ `junit` / `html` / `json` |
| `project` | `string` | 指定项目配置名称 |
| `timeout` | `number` | 超时毫秒数，默认 30000 |
| `browser` | `string` | 浏览器：`chromium` / `firefox` / `webkit`，默认 `chromium` |
| `baseUrl` | `string` | 基础 URL |

**Selenium options：**
| 选项 | 类型 | 说明 |
|------|------|------|
| `browser` | `string` | 浏览器：`chrome`（默认）/ `firefox` / `edge` |
| `headless` | `boolean` | 无头模式，默认 `true` |
| `timeout` | `number` | 超时毫秒数，默认 30000 |

**Cypress options：**
| 选项 | 类型 | 说明 |
|------|------|------|
| `headed` | `boolean` | 显示浏览器，默认 `false` |
| `browser` | `string` | 指定浏览器 |
| `record` | `boolean` | 是否上传 Cypress Dashboard 记录 |
| `key` | `string` | Cypress Dashboard 记录 key |
| `spec` | `string` | 指定运行的 spec 文件（支持 glob） |
| `config` | `object` | Cypress 配置覆盖 |
| `timeout` | `number` | 超时毫秒数，默认 30000 |

---

## 输出：UTRM 格式

所有工具执行完成后，统一转换为 UTRM（Unified Test Report Model）格式：

```json
{
  "tool": "playwright",
  "timestamp": "2026-07-13T11:30:00.000Z",
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 1,
    "skipped": 1,
    "duration": 45230
  },
  "testcases": [
    {
      "name": "用户登录流程 - 正确凭据",
      "status": "passed",
      "duration": 2340,
      "error": null,
      "stack": null
    },
    {
      "name": "用户登录流程 - 错误密码",
      "status": "failed",
      "duration": 1230,
      "error": "AssertionError: expected 401 but got 200",
      "stack": "AssertionError at LoginPage.login (/tests/login.spec.js:24:18)"
    }
  ],
  "exitCode": 0,
  "raw": "原始输出（可选）"
}
```

---

## 工具检测

在执行前，Skill 会自动检测环境中已安装的工具：

```javascript
// 检测顺序（优先级从高到低）
const tools = [
  'node_modules/.bin/playwright',   // 本地 playwright
  'node_modules/.bin/selenium-side-runner', // selenium-side-runner
  'node_modules/.bin/cypress'       // cypress
];
```

---

## 依赖安装命令

如果检测到工具未安装，提供以下安装指引：

### Playwright（推荐）
```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
# 或安装所有浏览器：
npx playwright install --with-deps
```

### Selenium
```bash
npm install -g selenium-side-runner selenium-webdriver
# 浏览器驱动（可选，selenium-side-runner 会自动下载）
webdriver-manager update
```

### Cypress
```bash
npm install cypress
# 首次运行后自动下载 Electron：
npx cypress install
```

---

## 错误处理

| 场景 | 行为 |
|------|------|
| 工具未安装 | 返回 `error: "TOOL_NOT_FOUND"` + 安装命令 |
| 脚本路径不存在 | 返回 `error: "SCRIPT_NOT_FOUND"` |
| 执行超时 | 返回 `error: "TIMEOUT"` + 已收集的部分结果 |
| 进程异常退出 | 返回 `exitCode` + `stderr` 内容 |
| 解析失败 | 返回 `error: "PARSE_ERROR"` + 原始输出 |

---

## 与 ui-e2e-executor 的集成方式

`ui-e2e-executor` 通过以下方式调用本 Skill：

```javascript
// 伪代码示例
const invoker = require('./backend/ui-test-invoker.js');

const result = await invoker.invoke({
  testScript: '/path/to/tests/login.spec.js',
  testFramework: 'playwright',          // 可选，自动选择
  testType: 'e2e',
  env: { BASE_URL: 'https://staging.example.com' },
  options: { headed: false, reporter: 'junit' }
});

console.log(result);
// → UTRM 格式 JSON
```

---

## 文件结构

```
ui-test-tool-invoker/
├── SKILL.md                          # 本文件，技能说明
└── backend/
    └── ui-test-invoker.js            # 核心调用逻辑
```
