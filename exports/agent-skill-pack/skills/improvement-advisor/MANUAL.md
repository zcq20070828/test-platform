# improvement-advisor 安装与使用手册

> Skill ID：`improvement-advisor` · 类型：代码/脚本型 Skill（未注册通用入口） · 目录：`skills/improvement-advisor`

## 1. 用途

基于评估结果（评分/趋势/异常）生成结构化的智能体改进建议，包括： - 薄弱环节识别（评分 < 70 的维度） - 短/中/长期行动计划 - 优先级排序与 ROI 估算 - 改进路线图规划

## 2. 目录结构

```text
improvement-advisor/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（第 4 节的 import 路径以包根为基准）。
- 本 Skill **未注册为通用入口**，不能通过 `invoke-skill.mjs improvement-advisor` 调用；请按第 4 节直接 import 或运行脚本。

## 4. 快速开始

本目录没有注册到 `invoke-skill.mjs` 的通用入口，但包含可复用代码/脚本：

| JS/Node 文件 | 导出符号（静态提取，最多 12 个） |
|---|---|
| `backend/advisor-engine.js` | `generateImprovements`, `identifyWeaknesses`, `generateActionPlan` |
| `backend/priority-scorer.js` | `scoreAction`, `rankActions`, `estimateROI`, `generateRoadmap` |

```bash
node -e "import('./skills/improvement-advisor/backend/advisor-engine.js').then(m => console.log(Object.keys(m)))"
```

```js
import { generateImprovements, identifyWeaknesses, generateActionPlan } from './skills/improvement-advisor/backend/advisor-engine.js';
// 函数签名、参数与返回值以源码为准
```

> 这些模块原本由测试中台 `server.js` 直接 import，可能依赖平台内部的任务对象、数据库连接或 LLM 客户端；对外使用时需要自行注入等价上下文。

## 5. 输出说明

输出由模块/脚本自身决定，通用调用器不会自动包装成 UTRM。调用前先查看第 4 节列出的导出符号或脚本参数；这些代码原本由测试中台内部直接 import，迁移后需要自行注入任务对象、数据库、LLM 等上下文。

## 6. 限制与排错

- 模块依赖未安装或导入路径错误：按 Node/Python 的报错安装依赖；本模块不经过工具调用器，不存在 `TOOL_NOT_FOUND`。
- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。
- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。
- 未注册通用入口：不要执行 `invoke-skill.mjs <本 Skill>`；按第 4 节直接 import 或运行脚本。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
