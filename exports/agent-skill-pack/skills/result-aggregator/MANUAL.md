# 结果聚合器（Result Aggregator） 安装与使用手册

> Skill ID：`result-aggregator` · 类型：可执行 Skill · 目录：`skills/result-aggregator`

## 1. 用途

结果聚合器。收集、聚合、去重、排序测试结果，生成最终报告。V1.0实现结果收集、聚合、去重、排序、报告生成（Markdown/HTML/JSON）。

## 2. 目录结构

```text
result-aggregator/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "results": [
    {
      "tool": "api-direct-invoker",
      "summary": {
        "total": 2,
        "passed": 2,
        "failed": 0,
        "skipped": 0,
        "duration": 9
      },
      "testcases": []
    }
  ]
}
JSON
node invoke-skill.mjs result-aggregator --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/result-aggregator/backend/result-aggregator-invoker.js';
const result = await skill.invoke({"results":[{"tool":"api-direct-invoker","summary":{"total":2,"passed":2,"failed":0,"skipped":0,"duration":9},"testcases":[]}]});
console.log(result);
```

### 4.3 入口 `result-aggregator`

- 文件：`skills/result-aggregator/backend/result-aggregator-invoker.js`
- 导出：`invoke`
- 说明：结果聚合器:聚合多工具测试结果,生成统一报告(Markdown/HTML/JSON)。

**参数**

该入口未声明 JSON Schema 参数，具体入参请参考同目录 `SKILL.md` 或后端实现。

**示例参数**

```json
{
  "results": [
    {
      "tool": "api-direct-invoker",
      "summary": {
        "total": 2,
        "passed": 2,
        "failed": 0,
        "skipped": 0,
        "duration": 9
      },
      "testcases": []
    }
  ]
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs result-aggregator --file params.json
```

**直接 import**

```js
import * as skill from './skills/result-aggregator/backend/result-aggregator-invoker.js';
const result = await skill.invoke(/* 上面的示例参数 */);
```

## 5. 输出说明

返回 JSON 对象；通用字段为 `success`（是否成功）、`tool`（技能标识），其余字段随 Skill 而定。失败时返回 `{ "success": false, "error": "原因" }`，不会伪造成功结果。

## 6. 限制与排错

- 工具未安装或不在 PATH：返回失败/`TOOL_NOT_FOUND`，不会伪造测试通过；先按第 3 节安装。
- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。
- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
