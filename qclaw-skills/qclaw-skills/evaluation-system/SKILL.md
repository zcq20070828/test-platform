# evaluation-system Skill

## 概述

`evaluation-system` 是测试中台的三层五级智能体评估系统，负责对系统中各智能体的能力、输出质量和业务价值进行持续评估，驱动迭代优化。

## 职责边界

- **ai-quality-reviewer（质量审核）**：门禁角色，对任务输出做通过/不通过的二值判断（Gate Keeper）
- **ai-evaluation-agent（能力评估）**：评估角色，对智能体能力做持续性多维评分（Performance Evaluator）

两者互补，不重复。

## 三层五级评估模型

### 第一层：智能体能力评估（权重 30%）

对智能体本身的运行时能力打分：

| 指标 | 说明 | 权重 |
|------|------|------|
| 意图理解准确率 | Agent 理解用户意图的能力 | 0.25 |
| 工具调用成功率 | Skill/MCP 工具调用成功率 | 0.30 |
| 上下文管理效率 | Token 消耗 vs 有效信息密度 | 0.20 |
| 错误恢复能力 | 任务失败后自动恢复的比例 | 0.25 |

### 第二层：输出质量评估（权重 40%）

对任务输出文本的质量打分：

| 指标 | 说明 | 权重 |
|------|------|------|
| 语法正确率 | 输出代码/文档的语法正确性 | 0.25 |
| 逻辑完整率 | 覆盖所有必要逻辑分支 | 0.30 |
| 规范符合率 | 符合测试行业标准（ISTQB/IEEE 829） | 0.25 |
| 可执行率 | 输出可直接执行的比例 | 0.20 |

### 第三层：业务价值评估（权重 30%）

对业务结果的价值打分：

| 指标 | 说明 | 权重 |
|------|------|------|
| 缺陷发现率 | 每周期发现的新缺陷数趋势 | 0.25 |
| 覆盖率提升 | 需求/代码覆盖率提升幅度 | 0.25 |
| 效率提升率 | 相比人工的效率倍数 | 0.25 |
| 漏报率/误报率 | 缺陷分类准确性 | 0.25 |

## 评分规则

- 每项指标：0-100 分
- 层均分 = Σ(指标分 × 权重)
- 总分 = 能力层均分 × 30% + 质量层均分 × 40% + 业务层均分 × 30%
- 等级：
  - S: ≥90
  - A: ≥80
  - B: ≥70
  - C: ≥60
  - D: <60

## 使用方式

```js
// 直接使用 evaluation-engine
import { evaluate } from './backend/evaluation-engine.js';

const input = {
  agentId: 'test-case-generator',
  taskId: 'task-001',
  taskType: 'case-generation',
  output: '生成的测试用例文本...',
  metadata: {
    duration: 3500,
    tokenUsed: 1200,
    retryCount: 0,
    errorCount: 0
  }
};

const report = await evaluate(input);
console.log(report.overall); // { score: 82, grade: 'A', level: 2 }
```

## 存储结构

```
~/.qclaw/data/evaluations/
  {agentId}/
    {timestamp}.json   ← 每份报告独立文件（JSON Lines）
    trends.json        ← 趋势数据
```
