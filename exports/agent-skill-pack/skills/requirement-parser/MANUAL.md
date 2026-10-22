# requirement-parser 安装与使用手册

> Skill ID：`requirement-parser` · 类型：可执行 Skill · 目录：`skills/requirement-parser`

## 1. 用途

将各类格式的需求文档解析为结构化输出，供测试用例生成使用。

## 2. 目录结构

```text
requirement-parser/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
├── package.json      # Node 依赖
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **本目录 Node 依赖**：`cd skills/requirement-parser && npm install`（如目录内确有 package.json 依赖）。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "text": "# 用户中心需求\n\n## 功能需求\n1. 登录：支持手机号+验证码登录，密码错误5次锁定30分钟。\n2. 退出：清除会话并跳转登录页。\n\n## 验收标准\n- 登录成功返回JWT。\n- 锁定期间禁止登录。"
}
JSON
node invoke-skill.mjs requirement-parser --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/requirement-parser/backend/requirement-parser-invoker.js';
const result = await skill.invoke({"text":"# 用户中心需求\n\n## 功能需求\n1. 登录：支持手机号+验证码登录，密码错误5次锁定30分钟。\n2. 退出：清除会话并跳转登录页。\n\n## 验收标准\n- 登录成功返回JWT。\n- 锁定期间禁止登录。"});
console.log(result);
```

### 4.3 入口 `requirement-parser`

- 文件：`skills/requirement-parser/backend/requirement-parser-invoker.js`
- 导出：`invoke`
- 说明：需求解析器:从需求文本中确定性提取模块、功能点、验收标准、优先级与边界条件。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | 是 | 完整需求文本/用户故事/验收标准 |
| `options` | object | 否 | 解析选项（可选） |

**示例参数**

```json
{
  "text": "# 用户中心需求\n\n## 功能需求\n1. 登录：支持手机号+验证码登录，密码错误5次锁定30分钟。\n2. 退出：清除会话并跳转登录页。\n\n## 验收标准\n- 登录成功返回JWT。\n- 锁定期间禁止登录。"
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs requirement-parser --file params.json
```

**直接 import**

```js
import * as skill from './skills/requirement-parser/backend/requirement-parser-invoker.js';
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
