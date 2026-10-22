# web-compatibility 安装与使用手册

> Skill ID：`web-compatibility` · 类型：可执行 Skill · 目录：`skills/web-compatibility`

## 1. 用途

提供「web-compatibility」相关能力，详细语义与边界条件见同目录 `SKILL.md`。

## 2. 目录结构

```text
web-compatibility/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
- **Playwright**：`npm install playwright playwright-core`，然后 `npx playwright install chromium`。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "platform": "web",
  "url": "https://example.com",
  "matrix": {
    "browsers": [
      "chromium",
      "firefox",
      "webkit"
    ],
    "viewports": [
      {
        "name": "桌面",
        "width": 1366,
        "height": 768
      }
    ]
  }
}
JSON
node invoke-skill.mjs compatibility-coordinator-invoker --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/web-compatibility/backend/browser-matrix-invoker.js';
const result = await skill.executeBrowserMatrix({"platform":"web","url":"https://example.com","matrix":{"browsers":["chromium","firefox","webkit"],"viewports":[{"name":"桌面","width":1366,"height":768}]}});
console.log(result);
```

### 4.3 入口 `compatibility-coordinator-invoker`

- 文件：`skills/web-compatibility/backend/browser-matrix-invoker.js`
- 导出：`executeBrowserMatrix`
- 说明：兼容性测试统一执行器（由 compatibility-coordinator 调度）。Web 平台：真实驱动 Chromium/Firefox/WebKit × 多分辨率浏览器矩阵，采集控制台错误/页面异常/失败请求/CSS-JS 特性；移动端(android/ios/harmony)与 PC 端(windows/mac)：有 http(s) URL 时设备仿真实测，无 URL 时生成平台专属兼容性测试设计（九维穷举模型）。支持逗号分隔多平台（如 "android,ios,harmony"），逐平台串行执行并按平台分节汇总。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `platform` | string | 是 | 目标平台: web / android / ios / harmony / windows / mac，或逗号分隔多平台组合（如 android,ios,harmony）。Web 走真实浏览器矩阵；其余有 URL 走设备仿真实测、无 URL 走平台专属兼容性测试设计生成；多平台逐个执行后汇总。 |
| `url` | string | 否 | 待测 URL（Web 平台必填；移动/PC 有 URL 则设备仿真实测，设计生成可留空；多平台时所有平台共用该 URL） |
| `matrix` | object | 否 | Web 矩阵配置: { browsers:["chromium","firefox","webkit"], viewports:[{name,width,height}] }，留空用默认 3 浏览器 × 5 分辨率 |
| `timeout` | number | 否 | 单页面加载超时(ms)，默认 30000 |

**示例参数**

```json
{
  "platform": "web",
  "url": "https://example.com",
  "matrix": {
    "browsers": [
      "chromium",
      "firefox",
      "webkit"
    ],
    "viewports": [
      {
        "name": "桌面",
        "width": 1366,
        "height": 768
      }
    ]
  }
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs compatibility-coordinator-invoker --file params.json
```

**直接 import**

```js
import * as skill from './skills/web-compatibility/backend/browser-matrix-invoker.js';
const result = await skill.executeBrowserMatrix(/* 上面的示例参数 */);
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
- Playwright 解析失败：请确认在技能包根目录执行过 `npm install playwright playwright-core`，并且 `npx playwright install chromium` 已完成。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
