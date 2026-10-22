# test-data-generator-skill 安装与使用手册

> Skill ID：`test-data-generator-skill` · 类型：可执行 Skill · 目录：`skills/test-data-generator-skill`

## 1. 用途

生成测试数据（等价类/边界值/组合数据/特殊值），支持多格式输出，自动应用脱敏规则。

## 2. 目录结构

```text
test-data-generator-skill/
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
  "spec": [
    {
      "field": "phone",
      "type": "phone"
    },
    {
      "field": "age",
      "type": "number",
      "min": 18,
      "max": 60
    }
  ],
  "count": 5,
  "mode": "random"
}
JSON
node invoke-skill.mjs test-data-generator-skill --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/test-data-generator-skill/backend/test-data-generator-invoker.js';
const result = await skill.invoke({"spec":[{"field":"phone","type":"phone"},{"field":"age","type":"number","min":18,"max":60}],"count":5,"mode":"random"});
console.log(result);
```

### 4.3 入口 `test-data-generator-skill`

- 文件：`skills/test-data-generator-skill/backend/test-data-generator-invoker.js`
- 导出：`invoke`
- 说明：测试数据生成器:按字段规格生成真实测试数据，支持随机/边界值/组合（pairwise）三种模式。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `mode` | enum(random / boundary / combinations) | 否 | 生成模式 |
| `spec` | object | 否 | 单字段规格 {field,type,min,max,minLength,maxLength,values}；多字段请用 fields |
| `fields` | array | 否 | 多字段规格数组，每项 {field,type,min,max,minLength,maxLength,values} |
| `count` | number | 否 | 生成条数（默认 10，最大 200） |
| `min` | number | 否 | boundary 模式下限 |
| `max` | number | 否 | boundary 模式上限 |
| `type` | string | 否 | boundary 模式类型 number/string/date |
| `factors` | array | 否 | combinations 模式的因子数组 |
| `strategy` | string | 否 | 组合策略 all/pairwise/random |

**示例参数**

```json
{
  "spec": [
    {
      "field": "phone",
      "type": "phone"
    },
    {
      "field": "age",
      "type": "number",
      "min": 18,
      "max": 60
    }
  ],
  "count": 5,
  "mode": "random"
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs test-data-generator-skill --file params.json
```

**直接 import**

```js
import * as skill from './skills/test-data-generator-skill/backend/test-data-generator-invoker.js';
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
