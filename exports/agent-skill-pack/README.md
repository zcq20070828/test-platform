# 通用测试智能体技能包

从测试中台抽取的可迁移资产：**18 个智能体提示词 + 核心 Skill（可执行后端 + SKILL.md）**。

- 不包含：`.env`、数据库、任务输出、平台私有数据。
- 可执行技能：直接 import 或通过 `invoke-skill.mjs` 调用。
- 提示词型智能体：把 `agents/<id>/prompt.md` 作为系统提示词即可。

## 目录

```text
agent-skill-pack/
├── AGENTS.md                 # 智能体 × 核心技能总览
├── manifest.json             # 机器可读清单（agent/skill/entry/参数）
├── invoke-skill.mjs          # 通用技能调用器
├── agents/<id>/AGENT.md      # 角色、能力、核心技能、提示词、调用示例
├── agents/<id>/prompt.md     # 系统提示词原文
└── skills/<skill>/           # SKILL.md + backend/ + scripts/ + references/
```

## 智能体总览

| 智能体 | ID | 系统提示词 | 核心可执行 Skill |
|---|---|---|---|
| 🧪 测试主控 | `test-master` | ✅ | 提示词型 |
| 🔍 需求分析 | `test-requirement-analyzer` | ✅ | `requirement-parser` |
| ✅ 测试用例生成 | `test-case-generator` | ✅ | `9dem-executor` |
| 📊 测试数据生成 | `test-data-generator` | ✅ | `test-data-generator-skill` |
| 🐛 缺陷分析 | `defect-analyzer` | ✅ | `defect-classifier`<br>`failure-root-cause-analyzer` |
| 📝 测试报告生成 | `test-reporter` | ✅ | `result-aggregator`<br>`quality-metrics-calculator` |
| 🔒 数据脱敏 | `data-masking` | ✅ | `data-masking-invoker` |
| ✍️ 测试脚本生成 | `test-script-generator` | ✅ | 提示词型 |
| 🖥️ UI/E2E测试 | `ui-e2e-executor` | ✅ | `ui-direct-invoker`<br>`ui-test-tool-invoker`<br>`mobile-e2e-invoker`<br>`desktop-e2e-invoker` |
| 🔌 API测试 | `api-executor` | ✅ | `api-direct-invoker`<br>`api-test-tool-invoker` |
| 📋 测试方案生成 | `test-scheme-generator` | ✅ | `test-strategy-designer` |
| 🛡️ AI质量审核-1 | `ai-quality-reviewer-1` | ✅ | 提示词型 |
| 🛡️ AI质量审核-2 | `ai-quality-reviewer-2` | ✅ | 提示词型 |
| 🛡️ AI质量审核-3 | `ai-quality-reviewer-3` | ✅ | 提示词型 |
| 📊 AI评估智能体(人工) | `ai-evaluation-agent` | ✅ | `evaluation-system`<br>`quality-metrics-calculator` |
| 🛡️ 安全测试 | `security-sentinel` | ✅ | 提示词型 |
| 📈 性能测试 | `performance-tester` | ⚠️ 源码无独立提示词 | `execute_perf_script` |
| 🧭 兼容性测试协调 | `compatibility-coordinator` | ✅ | `compatibility-coordinator-invoker` |

## 快速使用

### 1. 作为其他 Agent 的系统提示词

```text
读取 agents/test-case-generator/prompt.md，作为 system prompt；
输入需求文档，要求按提示词中的表格格式输出测试用例。
```

### 2. 调用真实 Skill

```bash
# 查看可执行 skill
node invoke-skill.mjs list

# 调用接口直执执行器（参数结构见 manifest.json）
node invoke-skill.mjs api-direct-invoker '{
  "baseUrl":"https://example.com",
  "cases":[{"name":"健康检查","method":"GET","url":"/health","expect":{"status":200}}]
}'
```

也可以直接 import：

```js
import { invoke } from './skills/api-direct-invoker/backend/api-direct-invoker.js';
const utrm = await invoke({ baseUrl: 'https://example.com', cases: [...] });
```

### 3. 与任意 Agent 框架集成

1. 从 `manifest.json` 读取 `agents[]`，用 `promptFile` 作为 system prompt。
2. 把 `skills[]` 注册成工具（`id` 为工具名，`parameters` 为 JSON Schema，`entry` 为执行文件）。
3. 工具执行时动态 import 入口文件，调用 `exportName`，把返回 JSON 回填给模型。

## 依赖

| 类别 | 依赖 |
|---|---|
| 运行时 | Node.js >= 22（全局 fetch；混合 CJS/ESM 需要语法自动检测） |
| UI / 兼容性 | 在包根目录 `npm i playwright playwright-core` + `npx playwright install chromium` |
| 移动 / 桌面 E2E | Appium Server + 对应驱动（UiAutomator2 / XCUITest / HarmonyOS / WinAppDriver / mac2） |
| 性能 | JMeter 或 k6 |
| 数据脱敏 / 文档 | Python 3.10+，安装 `skills/data-masking-skill/requirements.txt`（python-docx / opencv / Pillow；图片 OCR 可选 easyocr） |

> 部分 Skill 的后端是为测试中台运行时编写的（例如评估系统可能读取平台数据库、脱敏 skill 依赖本地 Python 脚本）。迁移到其他环境时，先看对应 `SKILL.md` 和 `backend/*.js` 的 import/require 依赖；提示词与算法可以独立复用。

## 安全说明

- 所有 Skill 均为只读/测试执行类，不包含平台鉴权密钥。
- 接口/UI 执行器会发起真实网络请求或启动浏览器，请仅在获得授权的目标上使用。
- 数据脱敏 skill 的文件路径限制在项目目录/临时目录内，迁移后请按你的运行环境重新配置路径白名单。

## 重新生成

```bash
node scripts/export-agent-skills.mjs
```


## 每个 Skill 的安装/使用手册

见 [SKILL-MANUALS.md](SKILL-MANUALS.md)，或直接打开 `skills/<skill>/MANUAL.md`。
