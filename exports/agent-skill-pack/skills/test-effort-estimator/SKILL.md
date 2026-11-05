---
name: test-effort-estimator
description: 测试任务人工工作量估算器。根据智能体类型与任务输入的业务规模（需求条目、接口数量、边界/异常线索、文档长度、涉及模块数）确定性估算人工执行所需人天与工时，供测试中台记录 manualHours 与节省成本。不调用 LLM，同一输入结果稳定可复现。
version: 1.0.0
---

# test-effort-estimator · 人工工作量估算

## 定位

测试中台在任务启动前需要给出「这个任务如果由人工做，要花多久」。该值用于：

- 任务的 `manualHours` 字段；
- 工作流汇总工时（`workflows.manual_hours`）；
- 成本统计里的「节省成本 = 人工成本 − Token 成本」。

估算必须是**确定性**的（同一输入同一结果），否则成本统计无法复核。

## 输入

```js
estimateEffort({
  taskType: 'test-case-generator',   // 智能体 ID
  taskInput: '<需求文本/报告全文>',   // 任务输入
})
```

## 输出

```js
{
  taskType: 'test-case-generator',
  complexity: 'medium',        // low | medium | high | very_high
  complexityScore: 4,          // 0..10，用于复核
  basePersonDays: 1,           // 该智能体的基准人天
  scale: 1.35,                 // 规模系数
  factors: {                   // 各维度命中情况（可解释性）
    inputLength: { raw: 12695, level: 'medium', weight: 1.1 },
    requirements: { count: 12, weight: 1.2 },
    apis: { count: 21, weight: 1.3 },
    modules: { count: 5, weight: 1.1 },
    risks: { count: 3, weight: 1.05 },
  },
  totalPersonDays: 1.35,
  totalHours: 10.8,            // 1 人天 = 8 小时
  basis: '按基准人天 × 规模系数；基准来自 test-case-generation 的人工经验值',
}
```

## 基准人天（人工执行一次该阶段）

| 智能体 | 基准人天 |
|---|---|
| test-requirement-analyzer | 0.5 |
| test-scheme-generator | 0.75 |
| test-case-generator | 1.0 |
| test-data-generator | 0.25 |
| test-script-generator | 1.0 |
| api-executor | 0.5 |
| ui-e2e-executor | 1.0 |
| performance-tester | 1.0 |
| security-sentinel | 1.0 |
| compatibility-coordinator | 1.0 |
| defect-analyzer | 0.5 |
| data-masking | 0.25 |
| test-reporter | 0.75 |
| test-master / 其他 | 0.5 |

## 规模系数

规模系数 = 各维度权重相乘，最终夹在 `[0.6, 2.5]`：

| 维度 | 判定 | 权重 |
|---|---|---|
| 输入长度 | <2k → 0.9 / 2k–8k → 1.0 / 8k–30k → 1.1 / >30k → 1.2 | 0.9–1.2 |
| 需求条目数 | 统计 `FR-xxx`/`NFR-xxx`/`需求编号` 行；<5 → 1.0 / 5–15 → 1.2 / 16–40 → 1.4 / >40 → 1.6 | 1.0–1.6 |
| 接口数量 | 统计 `API-xxx` 或 `GET/POST/PUT/DELETE` 清单行；0 → 1.0 / 1–5 → 1.1 / 6–20 → 1.3 / >20 → 1.5 | 1.0–1.5 |
| 涉及模块数 | 输入中 `模块`/`子系统`/`一级功能` 出现次数；<3 → 1.0 / 3–6 → 1.1 / >6 → 1.2 | 1.0–1.2 |
| 风险/边界线索 | 出现 `边界|异常|并发|幂等|越权|超时|回滚|并发` 的次数；<3 → 1.0 / 3–8 → 1.05 / >8 → 1.1 | 1.0–1.1 |

复杂度按最终人天映射：`<0.5 → low`、`0.5–1.5 → medium`、`1.5–3 → high`、`>3 → very_high`。

## 调用方式

```js
import { estimateEffort } from './backend/estimate.js';
const r = estimateEffort({ taskType: 'test-case-generator', taskInput: text });
```

测试中台在 `server.js` 的 `estimateManualEffort()` 中按此签名调用；脚本缺失时会退回默认 0.5 人天并打印告警。

## 单元测试

```bash
node test/estimate.test.js
```

## 限制

- 只使用输入文本的结构特征，不判断业务难度本身；极端复杂的算法类需求可能被低估。
- 输入为空时返回该智能体基准人天，不做臆测。
- 若业务侧已有更权威的工时基准，调整 `BASE_PERSON_DAYS` 即可，无需改调用方。
