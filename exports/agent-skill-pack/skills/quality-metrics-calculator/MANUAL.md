# 质量度量计算器（Quality Metrics Calculator） 安装与使用手册

> Skill ID：`quality-metrics-calculator` · 类型：可执行 Skill · 目录：`skills/quality-metrics-calculator`

## 1. 用途

质量度量计算器。计算测试覆盖率、缺陷密度、测试效率等质量指标，生成综合质量评分。V1.0实现代码覆盖率、需求覆盖率、测试用例覆盖率、缺陷密度、测试效率、综合质量评分。

## 2. 目录结构

```text
quality-metrics-calculator/
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
  "metrics": "defectDensity",
  "defectData": {
    "defects": [
      {
        "severity": "Major",
        "module": "login",
        "status": "closed"
      },
      {
        "severity": "Minor",
        "module": "login",
        "status": "open"
      }
    ],
    "codeLines": 5000,
    "preReleaseDefects": 8,
    "postReleaseDefects": 2
  }
}
JSON
node invoke-skill.mjs quality-metrics-calculator --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/quality-metrics-calculator/backend/quality-metrics-invoker.js';
const result = await skill.invoke({"metrics":"defectDensity","defectData":{"defects":[{"severity":"Major","module":"login","status":"closed"},{"severity":"Minor","module":"login","status":"open"}],"codeLines":5000,"preReleaseDefects":8,"postReleaseDefects":2}});
console.log(result);
```

### 4.3 入口 `quality-metrics-calculator`

- 文件：`skills/quality-metrics-calculator/backend/quality-metrics-invoker.js`
- 导出：`invoke`
- 说明：质量度量计算器:计算覆盖率、缺陷密度、测试效率、质量评分等指标。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `results` | array | 否 | UTRM 格式测试结果数组(自动推导各度量数据) |
| `coverageData` | object | 否 | 覆盖率数据(显式传入) |
| `defectData` | object | 否 | 缺陷数据 |
| `efficiencyData` | object | 否 | 效率数据 |
| `qualityData` | object | 否 | 质量评分数据 |
| `metrics` | enum(all / codeCoverage / requirementCoverage / testCaseCoverage / defectDensity / testEfficiency / qualityScore) | 否 | 计算哪些指标(all/codeCoverage/requirementCoverage/testCaseCoverage/defectDensity/testEfficiency/qualityScore) |

**示例参数**

```json
{
  "metrics": "defectDensity",
  "defectData": {
    "defects": [
      {
        "severity": "Major",
        "module": "login",
        "status": "closed"
      },
      {
        "severity": "Minor",
        "module": "login",
        "status": "open"
      }
    ],
    "codeLines": 5000,
    "preReleaseDefects": 8,
    "postReleaseDefects": 2
  }
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs quality-metrics-calculator --file params.json
```

**直接 import**

```js
import * as skill from './skills/quality-metrics-calculator/backend/quality-metrics-invoker.js';
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
