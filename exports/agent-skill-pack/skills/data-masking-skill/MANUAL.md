# Data Masking Skill - 数据脱敏技能 安装与使用手册

> Skill ID：`data-masking-skill` · 类型：可执行 Skill · 目录：`skills/data-masking-skill`

## 1. 用途

提供专业的数据脱敏能力，支持 Word 文档、图片和批量文件的敏感信息处理。

## 2. 目录结构

```text
data-masking-skill/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
├── scripts/
├── requirements.txt  # Python 依赖
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Python 依赖**：`pip install -r skills/data-masking-skill/requirements.txt`（Python 3.10+）。
- **Python 依赖仅用于 docx/图片脱敏**；纯文本脱敏由 Node 完成，可不安装 Python 依赖。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "text": "姓名 张三；手机号 13800138000；邮箱 zhangsan@example.com"
}
JSON
node invoke-skill.mjs data-masking-invoker --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/data-masking-skill/backend/data-masking-invoker.js';
const result = await skill.invoke({"text":"姓名 张三；手机号 13800138000；邮箱 zhangsan@example.com"});
console.log(result);
```

### 4.3 入口 `data-masking-invoker`

- 文件：`skills/data-masking-skill/backend/data-masking-invoker.js`
- 导出：`invoke`
- 说明：数据脱敏执行器:对文本做确定性正则脱敏（手机号/身份证/邮箱/银行卡/姓名/口令/地址），对服务器内 docx/图片调用 mask_wrapper.py 真实脱敏。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | 否 | 待脱敏文本 |
| `filePath` | string | 否 | 服务器内待脱敏文件绝对路径（项目目录或临时目录内） |
| `method` | enum(blur / block) | 否 | 图片脱敏方式，默认 blur |

**示例参数**

```json
{
  "text": "姓名 张三；手机号 13800138000；邮箱 zhangsan@example.com"
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs data-masking-invoker --file params.json
```

**直接 import**

```js
import * as skill from './skills/data-masking-skill/backend/data-masking-invoker.js';
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
