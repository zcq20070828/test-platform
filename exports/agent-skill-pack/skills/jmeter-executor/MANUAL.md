# jmeter-executor —— 性能压测脚本执行器 安装与使用手册

> Skill ID：`jmeter-executor` · 类型：可执行 Skill · 目录：`skills/jmeter-executor`

## 1. 用途

performance-tester（性能测试智能体）的必调工具 execute_perf_script 的实现。 负责把 JMX / k6 脚本变成真实压测并输出结构化指标（TPS、响应时间分位、错误率）。

## 2. 目录结构

```text
jmeter-executor/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。
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
  "tool": "k6",
  "duration": 30,
  "threads": 20,
  "target": "https://example.com",
  "script": "import http from \"k6/http\"; export default function(){ http.get(\"https://example.com\"); }"
}
JSON
node invoke-skill.mjs execute_perf_script --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/jmeter-executor/backend/jmeter-invoker.js';
const result = await skill.executeJmeter({"tool":"k6","duration":30,"threads":20,"target":"https://example.com","script":"import http from \"k6/http\"; export default function(){ http.get(\"https://example.com\"); }"});
console.log(result);
```

### 4.3 入口 `execute_perf_script`

- 文件：`skills/jmeter-executor/backend/jmeter-invoker.js`
- 导出：`executeJmeter`
- 说明：JMeter/k6 压测脚本执行器:执行 JMX 或 k6 JS 脚本,返回 TPS/RT/错误率等结构化指标。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `script` | string | 是 | 压测脚本内容（JMX XML 或 k6 JS） |
| `tool` | enum(jmeter / k6 / locust) | 否 | 压测工具类型 |
| `duration` | number | 否 | 压测持续时间（秒） |
| `threads` | number | 否 | 并发线程数/虚拟用户数 |
| `rampUp` | number | 否 | 爬坡时间（秒），仅 JMeter |
| `target` | string | 否 | 被测目标主机 |
| `port` | number | 否 | 被测目标端口 |
| `protocol` | string | 否 | 协议 http/https |
| `path` | string | 否 | 被测路径 |
| `reportDir` | string | 否 | JMeter HTML 报告输出目录 |
| `thresholds` | string | 否 | k6 阈值 JSON（仅 k6） |
| `out` | string | 否 | k6 输出格式 |

**示例参数**

```json
{
  "tool": "k6",
  "duration": 30,
  "threads": 20,
  "target": "https://example.com",
  "script": "import http from \"k6/http\"; export default function(){ http.get(\"https://example.com\"); }"
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs execute_perf_script --file params.json
```

**直接 import**

```js
import * as skill from './skills/jmeter-executor/backend/jmeter-invoker.js';
const result = await skill.executeJmeter(/* 上面的示例参数 */);
```

## 5. 输出说明

返回 JSON 对象；通用字段为 `success`（是否成功）、`tool`（技能标识），其余字段随 Skill 而定。失败时返回 `{ "success": false, "error": "原因" }`，不会伪造成功结果。

## 6. 限制与排错

- 工具未安装或不在 PATH：返回失败/`TOOL_NOT_FOUND`，不会伪造测试通过；先按第 3 节安装。
- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。
- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。
- 压测工具失败：检查 `jmeter`/`k6` 是否在 PATH，脚本是否使用了对应工具的语法。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
