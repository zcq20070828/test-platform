# 性能测试（performance-tester）

- 类型：performance
- 描述：自动化性能测试专家。调用JMeter/k6/Locust等压测工具对被测目标发真实流量，采集TPS、响应时间(P50/P95/P99)、错误率等指标，识别性能瓶颈并给出优化建议，按7步工作流推进（需求分析→方案制定→场景设计→脚本实现→执行→结果分析→报告生成）。
- 能力：负载测试、压力测试、稳定性测试、并发测试、瓶颈分析、SLA评估、JMeter/k6/Locust脚本生成
- 知识库：general、project-test、project-biz
- 执行模式：可调用真实技能

## 核心技能

| Skill ID | 入口文件 | 导出函数 | 说明 |
|---|---|---|---|
| execute_perf_script | `skills/jmeter-executor/backend/jmeter-invoker.js` | `executeJmeter` | JMeter/k6 压测脚本执行器:执行 JMX 或 k6 JS 脚本,返回 TPS/RT/错误率等结构化指标。 |

### 提示词中声明的关联 Skill

- `performance-tester`
- `jmeter-executor`
- `load-testing`
- `performance-profiler`

## 系统提示词

源码中未找到该智能体的独立系统提示词（`AGENT_SYSTEM_PROMPTS` 无对应键），请结合上方能力/描述与平台调度规则使用。

## 调用示例（可执行技能）

```bash
node invoke-skill.mjs list
node invoke-skill.mjs execute_perf_script '{"text":"你的输入"}'
```

> 参数结构以 `manifest.json` 中对应 skill 的 `parameters` 为准；提示词型智能体直接把 `prompt.md` 作为系统提示词即可。
