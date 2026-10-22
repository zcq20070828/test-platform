# evaluation-system Skill 安装与使用手册

> Skill ID：`evaluation-system` · 类型：可执行 Skill · 目录：`skills/evaluation-system`

## 1. 用途

evaluation-system 是测试中台的三层五级智能体评估系统，负责对系统中各智能体的能力、输出质量和业务价值进行持续评估，驱动迭代优化。

## 2. 目录结构

```text
evaluation-system/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Playwright**：`npm install playwright playwright-core`，然后 `npx playwright install chromium`。

> ⚠️ 本 Skill 的部分实现面向测试中台数据库/服务，迁移到其他环境时需要替换数据源或注入对应配置。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "action": "evaluate",
  "agentId": "test-case-generator",
  "daysBack": 30
}
JSON
node invoke-skill.mjs evaluation-system --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/evaluation-system/backend/evaluation-system-invoker.js';
const result = await skill.invoke({"action":"evaluate","agentId":"test-case-generator","daysBack":30});
console.log(result);
```

### 4.3 入口 `evaluation-system`

- 文件：`skills/evaluation-system/backend/evaluation-system-invoker.js`
- 导出：`invoke`
- 说明：三层五级智能体评估系统:自动收集任务数据,深度评估智能体能力/质量/业务价值,生成趋势报告。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | enum(autoCollect / evaluate / evaluateAll / getHistory / listReports / getTrend) | 是 | 操作类型 |
| `agentId` | string | 否 | 智能体ID(用于 getHistory/listReports/getTrend) |
| `taskId` | string | 否 | 任务ID(用于 evaluateByTaskId) |
| `daysBack` | integer | 否 | 回溯天数(默认30) |
| `limitPerAgent` | integer | 否 | 每智能体最多任务数(默认20) |
| `scope` | array | 否 | 评估范围(capability/quality/business,默认全开) |
| `taskType` | string | 否 | 任务类型(用于 evaluate) |
| `output` | string | 否 | 智能体输出内容(用于 evaluate) |
| `metadata` | object | 否 | 元数据 |

**示例参数**

```json
{
  "action": "evaluate",
  "agentId": "test-case-generator",
  "daysBack": 30
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs evaluation-system --file params.json
```

**直接 import**

```js
import * as skill from './skills/evaluation-system/backend/evaluation-system-invoker.js';
const result = await skill.invoke(/* 上面的示例参数 */);
```

## 5. 输出说明

返回 JSON 对象；通用字段为 `success`（是否成功）、`tool`（技能标识），其余字段随 Skill 而定。失败时返回 `{ "success": false, "error": "原因" }`，不会伪造成功结果。

## 6. 限制与排错

- 工具未安装或不在 PATH：返回失败/`TOOL_NOT_FOUND`，不会伪造测试通过；先按第 3 节安装。
- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。
- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。
- Playwright 解析失败：请确认在技能包根目录执行过 `npm install playwright playwright-core`，并且 `npx playwright install chromium` 已完成。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
