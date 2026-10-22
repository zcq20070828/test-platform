# api-test-tool-invoker 安装与使用手册

> Skill ID：`api-test-tool-invoker` · 类型：可执行 Skill · 目录：`skills/api-test-tool-invoker`

## 1. 用途

封装 Postman/Newman、RestAssured（Java）、pytest（Python + requests）三个主流 API 测试工具的统一调用逻辑，供 api-executor 智能体在执行 API 测试时自动调用。输出统一的 UTRM（Uniform Test Result Model）格式。

## 2. 目录结构

```text
api-test-tool-invoker/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Python 3.10+（可选）**：仅在使用 pytest / Python 脚本模式时需要；纯 Node 模式可忽略。
- **按 `testFramework` 选装执行器**：Newman `npm i -g newman`；RestAssured 需要 JDK 17+ 与 Maven/Gradle；pytest 需要 `pip install pytest requests`。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "testScript": "./tests/api/postman_collection.json",
  "testFramework": "newman"
}
JSON
node invoke-skill.mjs api-test-tool-invoker --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/api-test-tool-invoker/backend/api-test-invoker.js';
const result = await skill.invoke({"testScript":"./tests/api/postman_collection.json","testFramework":"newman"});
console.log(result);
```

### 4.3 入口 `api-test-tool-invoker`

- 文件：`skills/api-test-tool-invoker/backend/api-test-invoker.js`
- 导出：`invoke`
- 说明：API 测试工具调用:执行 Newman/RestAssured/pytest 接口测试并返回 UTRM 标准结果。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `testScript` | string | 是 | 测试脚本路径或集合文件 |
| `testFramework` | string | 否 | 强制指定框架: newman/restassured/pytest;留空则自动检测 |
| `env` | object | 否 | 执行环境变量 |
| `options` | object | 否 | 执行选项(workers/timeout/retries/coverage/verbose/debug) |

**示例参数**

```json
{
  "testScript": "./tests/api/postman_collection.json",
  "testFramework": "newman"
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs api-test-tool-invoker --file params.json
```

**直接 import**

```js
import * as skill from './skills/api-test-tool-invoker/backend/api-test-invoker.js';
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
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
