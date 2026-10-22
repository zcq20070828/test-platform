# test-strategy-designer 安装与使用手册

> Skill ID：`test-strategy-designer` · 类型：可执行 Skill · 目录：`skills/test-strategy-designer`

## 1. 用途

制定完整测试策略（分层策略/资源分配/工具选型/里程碑），指导测试方案生成，为后续用例设计、自动化规划和执行提供战略框架。

## 2. 目录结构

```text
test-strategy-designer/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Playwright**：`npm install playwright playwright-core`，然后 `npx playwright install chromium`。
- **Appium**：启动 Appium Server，并安装对应驱动（UiAutomator2 / XCUITest / HarmonyOS / WinAppDriver / mac2）。
- **JMeter**：安装 Apache JMeter，并确保 `jmeter` 在 PATH 中。
- **k6**：安装 k6，并确保 `k6` 在 PATH 中。
- **Locust**：`pip install locust`。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "requirement": "用户登录功能，支持手机号/密码/第三方登录",
  "constraints": {
    "timeBudget": 7,
    "teamSize": 3,
    "techStack": [
      "Spring Boot",
      "Vue"
    ]
  }
}
JSON
node invoke-skill.mjs test-strategy-designer --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/test-strategy-designer/backend/test-strategy-invoker.js';
const result = await skill.invoke({"requirement":"用户登录功能，支持手机号/密码/第三方登录","constraints":{"timeBudget":7,"teamSize":3,"techStack":["Spring Boot","Vue"]}});
console.log(result);
```

### 4.3 入口 `test-strategy-designer`

- 文件：`skills/test-strategy-designer/backend/test-strategy-invoker.js`
- 导出：`invoke`
- 说明：测试策略设计器:根据需求与约束确定性生成测试模式、层级策略、里程碑、工具链与风险缓解。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `requirement` | string | 是 | 需求文本或需求摘要 |
| `constraints` | object | 否 | 约束 { timeBudget, budget, teamSize, techStack, excludeLevels, riskPreference } |

**示例参数**

```json
{
  "requirement": "用户登录功能，支持手机号/密码/第三方登录",
  "constraints": {
    "timeBudget": 7,
    "teamSize": 3,
    "techStack": [
      "Spring Boot",
      "Vue"
    ]
  }
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs test-strategy-designer --file params.json
```

**直接 import**

```js
import * as skill from './skills/test-strategy-designer/backend/test-strategy-invoker.js';
const result = await skill.invoke(/* 上面的示例参数 */);
```

## 5. 输出说明

返回 JSON 对象；通用字段为 `success`（是否成功）、`tool`（技能标识），其余字段随 Skill 而定。失败时返回 `{ "success": false, "error": "原因" }`，不会伪造成功结果。

## 6. 限制与排错

- 工具未安装或不在 PATH：返回失败/`TOOL_NOT_FOUND`，不会伪造测试通过；先按第 3 节安装。
- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。
- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。
- Playwright 解析失败：请确认在技能包根目录执行过 `npm install playwright playwright-core`，并且 `npx playwright install chromium` 已完成。
- Appium 连接失败：检查 Appium Server 地址、设备/模拟器是否在线、驱动版本是否匹配。
- 压测工具失败：检查 `jmeter`/`k6` 是否在 PATH，脚本是否使用了对应工具的语法。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
