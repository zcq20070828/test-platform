# 九维穷举模型执行器（9DEM Executor） 安装与使用手册

> Skill ID：`9dem-executor` · 类型：可执行 Skill · 目录：`skills/9dem-executor`

## 1. 用途

九维穷举模型执行器。基于用户、数据、流程、操作、安全、性能、网络环境、终端环境、兼容性九个维度（9DEM）的穷举测试，生成高覆盖率测试用例。数据维度具备等价类划分、边界值分析、Pairwise 自动化计算；其余维度提供结构化方法论引导。V2.0集成PICT工具、测试脚本生成器、测试框架集成。

## 2. 目录结构

```text
9dem-executor/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Playwright**：`npm install playwright playwright-core`，然后 `npx playwright install chromium`。
- **Python 3.10+（可选）**：仅在使用 pytest / Python 脚本模式时需要；纯 Node 模式可忽略。
- **外部工具**：PICT（可选，缺失时降级）（按 SKILL.md 中的命令确认版本）。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "task": "用户登录功能测试，支持手机号+验证码、账号密码登录",
  "fields": [
    {
      "name": "phone",
      "type": "string",
      "minLength": 11,
      "maxLength": 11
    },
    {
      "name": "password",
      "type": "string",
      "minLength": 8,
      "maxLength": 32
    }
  ],
  "dimensions": [
    "user",
    "data",
    "process",
    "operation",
    "security"
  ]
}
JSON
node invoke-skill.mjs 9dem-executor --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/9dem-executor/backend/9dem-invoker.js';
const result = await skill.invoke({"task":"用户登录功能测试，支持手机号+验证码、账号密码登录","fields":[{"name":"phone","type":"string","minLength":11,"maxLength":11},{"name":"password","type":"string","minLength":8,"maxLength":32}],"dimensions":["user","data","process","operation","security"]});
console.log(result);
```

### 4.3 入口 `9dem-executor`

- 文件：`skills/9dem-executor/backend/9dem-invoker.js`
- 导出：`invoke`
- 说明：九维穷举模型执行器:基于用户/数据/流程/操作/安全/性能/网络环境/终端环境/兼容性九维,生成等价类划分、边界值分析、Pairwise 组合等专业测试设计。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task` | string | 否 | 需求/场景描述文本(与 inputSpec 二选一) |
| `inputSpec` | object | 否 | 结构化输入规范(优先),如 {field:{type:"string",minLength:1,maxLength:100}} |
| `fields` | array | 否 | 字段列表(三选一),每项 {name,type,min,max,minLength,maxLength,values} |
| `dimensions` | array | 否 | 计算维度,默认 ["data"];可选全部九维:user/data/process/operation/security/performance/network/terminal/compatibility |

**示例参数**

```json
{
  "task": "用户登录功能测试，支持手机号+验证码、账号密码登录",
  "fields": [
    {
      "name": "phone",
      "type": "string",
      "minLength": 11,
      "maxLength": 11
    },
    {
      "name": "password",
      "type": "string",
      "minLength": 8,
      "maxLength": 32
    }
  ],
  "dimensions": [
    "user",
    "data",
    "process",
    "operation",
    "security"
  ]
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs 9dem-executor --file params.json
```

**直接 import**

```js
import * as skill from './skills/9dem-executor/backend/9dem-invoker.js';
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
