# jmeter-executor —— 性能压测脚本执行器

## 定位

`performance-tester`（性能测试智能体）的**必调工具** `execute_perf_script` 的实现。
负责把 JMX / k6 脚本变成真实压测并输出结构化指标（TPS、响应时间分位、错误率）。

- skill id：`execute_perf_script`
- 工具名（注册给 LLM）：`execute_perf_script`
- 实现文件：`backend/jmeter-invoker.js`
- 入口函数：`executeJmeter`（同时导出别名 `executePerfScript`）

> 与 server.js 的三处接线保持一致：`SKILL_EXECUTORS`（本文件）
> → `AGENT_EXECUTABLE_SKILLS['performance-tester']`
> → `AGENTS['performance-tester'].skills`。

## 设计原则

1. **只做真实压测，不造假数据**：调用本机真实安装的 k6 / JMeter 二进制。
2. **工具缺失时明确报 `ENV_NOT_READY`** 并附整改清单，不静默降级、不返回模拟指标。
3. **零 npm 依赖**：仅用 Node 内置 `fs / os / path / child_process`。

## 三种工具支持

| tool | 状态 | 执行方式 | 结果解析 |
|---|---|---|---|
| `k6`（默认） | ✅ 本机已装（`/opt/homebrew/bin/k6`，v2.2.0） | `k6 run --summary-export=<json> --vus N --duration Ns` | 解析 summary JSON，失败率取 `http_req_failed.value` |
| `jmeter` | ✅ 本机已装（`/opt/homebrew/bin/jmeter`） | `jmeter -n -t <jmx> -l <jtl> -Jthreads/-Jduration/-JrampUp` | 解析 JTL(CSV)，按 elapsed 算分位 |
| `locust` | ❌ 本机未装 | 检测到未安装 → `ENV_NOT_READY` | 已安装时返回 `NOT_IMPLEMENTED` 并推荐改用 k6 |

## 入参

必填其一：`script`（脚本内容）或 `target`（被测主机）。

| 参数 | 默认 | 说明 |
|---|---|---|
| `script` | — | 压测脚本正文（JMX XML 或 k6 JS） |
| `tool` | `k6` | `jmeter` / `k6` / `locust` |
| `duration` | 60 | 持续秒数 |
| `threads` | 100 | 并发虚拟用户数 |
| `rampUp` | 30 | 爬坡秒数（仅 JMeter；JMX 需使用 `${__P(rampUp,30)}` 才生效） |
| `target` `port` `protocol` `path` | — | 未传 `script` 时用于生成默认脚本 |
| `reportDir` | — | JMeter HTML 报告输出目录（`-e -o`） |
| `thresholds` | — | k6 阈值（透传记录，暂不做阈值判定） |

## 返回结构

```jsonc
{
  "success": true,
  "tool": "k6",
  "bin": "/opt/homebrew/bin/k6",
  "exitCode": 0,
  "durationSec": 3.2,
  "scriptPath": "/tmp/perf-xxx/script.js",
  "summary": {
    "requests": 60, "failures": 0, "errorRate": 0,
    "tps": 19.553,
    "avgRt": 1107.1, "minRt": 425, "medRt": 841,
    "p90": 1747.2, "p95": 2347.85, "maxRt": 6012
  },
  "checks": { "status is 200": { "passes": 60, "fails": 0 } },
  "iterations": 60
}
```

失败时：`error` 取 `BAD_TOOL` / `ENV_NOT_READY` / `BAD_INPUT` / `NO_RESULT` / `PARSE_FAILED` / `EXEC_ERROR`。

## 自测

```bash
node /tmp/test-perf.js   # 探测工具 + locust 缺失 + k6 真实压测 + 缺参校验
```

⚠️ 自测会真实发压，请对本机 dev 后端（3002）小并发短时进行，勿指向生产。
