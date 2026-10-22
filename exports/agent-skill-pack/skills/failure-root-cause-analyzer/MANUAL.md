# failure-root-cause-analyzer 安装与使用手册

> Skill ID：`failure-root-cause-analyzer` · 类型：可执行 Skill · 目录：`skills/failure-root-cause-analyzer`

## 1. 用途

对测试失败进行系统性根因分析（5-Why / 鱼骨图 / 因果链），输出根因链与改进建议优先级列表。

## 2. 目录结构

```text
failure-root-cause-analyzer/
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
  "failure": "登录接口返回 500",
  "logs": [
    "TypeError: Cannot read property name of null"
  ],
  "stackTrace": [
    "at UserService.getUser (user.service.js:42:15)"
  ]
}
JSON
node invoke-skill.mjs failure-root-cause-analyzer --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/failure-root-cause-analyzer/backend/rca-invoker.js';
const result = await skill.invoke({"failure":"登录接口返回 500","logs":["TypeError: Cannot read property name of null"],"stackTrace":["at UserService.getUser (user.service.js:42:15)"]});
console.log(result);
```

### 4.3 入口 `failure-root-cause-analyzer`

- 文件：`skills/failure-root-cause-analyzer/backend/rca-invoker.js`
- 导出：`invoke`
- 说明：根因分析器:对失败现象/日志/堆栈做 5Why + 鱼骨图 + 因果链的确定性根因分析。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `failure` | string | 是 | 失败现象/缺陷描述 |
| `logs` | array | 否 | 日志行数组 |
| `stackTrace` | array | 否 | 堆栈行数组 |
| `environment` | object | 否 | 环境信息 |
| `mode` | enum(full / 5why / fishbone) | 否 | 分析模式，默认 full |

**示例参数**

```json
{
  "failure": "登录接口返回 500",
  "logs": [
    "TypeError: Cannot read property name of null"
  ],
  "stackTrace": [
    "at UserService.getUser (user.service.js:42:15)"
  ]
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs failure-root-cause-analyzer --file params.json
```

**直接 import**

```js
import * as skill from './skills/failure-root-cause-analyzer/backend/rca-invoker.js';
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
