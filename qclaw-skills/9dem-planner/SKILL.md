# 9dem-planner

> 九维穷举测试规划与执行调度引擎

## 职责

协调九维穷举模型（用户 / 数据 / 流程 / 操作 / 安全 / 性能 / 网络环境 / 终端环境 / 兼容性）各维度的测试规划与执行调度，基于依赖关系拓扑排序实现最优并行，在最大化覆盖率的同时控制用例规模，输出可直接交给各维度生成器的可执行任务计划。

## 九维定义

维度键、中文名、权重、必测点全部来自九维覆盖矩阵，与 `9dem-executor`、用例质量门禁**共用同一份定义**（`backend/dimension-matrix-data.js` 是 `backend/lib/dimension-matrix.js` 的自动镜像）：

| 维度 | 键 | 权重 | 必测点 | 必须覆盖的层级 |
|------|-----|------|--------|---------------|
| ① 用户 | `user` | ●● | 5 | 正常 / 边界 / 异常 |
| ② 数据 | `data` | ●● | 5 | 正常 / 边界 / 异常 |
| ③ 流程 | `process` | ●● | 5 | 正常 / 边界 / 异常 |
| ④ 操作 | `operation` | ● | 5 | 正常 / 边界 / 异常 |
| ⑤ 安全 | `security` | ● | 5 | 边界 / 异常 |
| ⑥ 性能 | `performance` | ● | 4 | 边界 / 异常 |
| ⑦ 网络环境 | `network` | ● | 5 | 正常 / 边界 / 异常 |
| ⑧ 终端环境 | `terminal` | ● | 4 | 正常 / 边界 / 异常 |
| ⑨ 兼容性 | `compatibility` | ● | 4 | 边界 / 异常 |

合计 **42 个必测点**。

## 维度依赖关系

依赖依据「前置信息是否已被产出」，不是产能：

```
[用户] ─┬────────────────┬──────────────┐
[数据] ─┴──▶ [流程] ──▶ [操作] ─┬──▶ [性能]
                    │           ├──▶ [网络环境]
                    └───────────┼──▶ [终端环境] ──▶ [兼容性]
[用户]+[数据] ──────▶ [安全]
```

- **用户 / 数据**：基础维度，无前置依赖，可并行
- **流程**：依赖 用户 + 数据
- **操作**：依赖 流程
- **安全**：依赖 用户 + 数据（要有身份才谈越权）
- **性能 / 网络环境 / 终端环境**：依赖 流程 + 操作，三者可并行
- **兼容性**：依赖 流程 + 终端环境，收尾执行

## 技能

### 1. dimension-planner（维度规划引擎）

**文件**：`backend/dimension-planner.js`

| 导出函数 | 说明 |
|----------|------|
| `planDimensions(requirement, existingDimensions?)` | 主规划入口，输入各维度规模信号 + 已有维度，输出九维规划 |
| `getDimensionDependencies()` | 返回九维依赖关系图 |
| `getExecutionOrder()` | 返回依赖拓扑排序后的执行顺序 |
| `estimateDimensionCases(dimension, complexity)` | 按必测点数 × 复杂度系数估算用例数量 |
| `identifyCoverageGaps(covered, required?)` | 识别未覆盖的维度缺口 |

### 2. execution-scheduler（执行调度器）

**文件**：`backend/execution-scheduler.js`

| 导出函数 | 说明 |
|----------|------|
| `scheduleExecution(plan, resourceLimit?)` | 基于规划结果生成调度序列与并行组 |
| `estimateTotalDuration(dimensions, caseCounts?)` | 估算九维穷举总耗时（天） |
| `suggestPriorities(plan)` | 基于风险 × 复杂度 × 权重 × 依赖度给出优先级建议 |

### 3. 9dem-planner-invoker（工具入口）

**文件**：`backend/9dem-planner-invoker.js`

对外注册为可执行技能 `9dem_planner`，供 LLM tool-call 调用。参数与 `9dem_executor` 对齐（都吃 `task` / `inputSpec`），输出：

```js
{
  skill: '9dem-planner',
  success: true,
  requirementShape: { roles, dataVariations, processSteps, ... },  // 从需求文本粗估
  plan: { dimensions, executionOrder, estimatedCases, completeness, coverageGap, summary },
  schedule: { sequence, parallelGroups, totalDuration, recommendations },
  priorities: [{ rank, dimension, label, score, priority, reason }],
  checklist: [{ dimension, label, weight, requiredLayers, probes }],
  summary: { totalDimensions, coveredCount, pendingCount, estimatedCases, recommendedDays, probeTotal, gapMessage, topPriority },
  hint: '本工具只做规划。具体用例请调用 9dem_executor（返回 design.cases 与 dimensionCases），两者共用同一份九维必测矩阵。'
}
```

## 工作流程

```
1. 接收需求结构 + 已覆盖维度（如有）
   ↓
2. dimension-planner.planDimensions()
   - 推断各维度复杂度
   - 按必测点数估算用例数量
   - 分析依赖关系确定执行顺序
   - 识别覆盖缺口
   ↓
3. execution-scheduler.scheduleExecution()
   - 划分并行执行组（组内并行，组间串行）
   - 生成调度序列（含阻塞关系）
   - 估算总工期
   ↓
4. execution-scheduler.suggestPriorities()
   - 基于风险/复杂度/权重/依赖度打分
   - 输出优先级排序
   ↓
5. 输出九维用例生成任务计划 + 42 项必测点清单
   交给 9dem_executor 展开为具体用例
```

## 调用示例

```js
// 作为工具调用（推荐）
const plan = await invoke({
  task: '统一消息中心：站内消息/短信/邮件，支持模板管理、权限控制、并发发送、弱网重连',
  inputSpec: { phone: { type: 'string', minLength: 11, maxLength: 11 } },
  coveredDimensions: [],
  resourceLimit: { maxParallel: 3, peoplePerDim: 1 },
});
console.log(plan.summary);          // 9 维 / 42 必测点 / 估算用例数 / 建议工期
console.log(plan.schedule.recommendations);

// 直接 import 函数
import { planDimensions } from './backend/dimension-planner.js';
import { scheduleExecution, suggestPriorities } from './backend/execution-scheduler.js';

const requirement = { roles: 3, dataVariations: 15, processSteps: 12, platforms: 4 };
const p = planDimensions(requirement, ['data']);
const schedule = scheduleExecution(p, { maxParallel: 3 });
const priorities = suggestPriorities(p);
```

## 输出结构示例

```js
planDimensions() 返回:
{
  dimensions: [{ name, label, weight, complexity, estimatedCases, requiredLayers, probeCount, probeIds, dependencies, alreadyCovered }],
  executionOrder: ['user', 'data', 'process', 'operation', 'security', 'performance', 'network', 'terminal', 'compatibility'],
  layers: ['正常', '边界', '异常'],
  estimatedCases: 108,
  coverageGap: [{ dimension, label, reason, priority }],
  completeness: 11,   // 百分比
  summary: { totalDimensions: 9, coveredCount: 1, pendingCount: 8, estimatedCases: 108 }
}

scheduleExecution() 返回:
{
  sequence: [{ step, dimension, label, estimatedCases, groupId, groupLabel, blockedBy, canRunInParallelWith, skip }],
  parallelGroups: [{ groupId, label, dimensions, parallelizable }],
  totalDuration: { sequentialDays, parallelDays, recommendedDays, dimDurations, groupDurations },
  recommendations: ['建议1', '建议2', ...]
}

suggestPriorities() 返回:
[
  { rank: 1, dimension: 'process', label: '③ 流程', score: 180, priority: 'critical', reason: '...' },
  ...
]
```

## 设计原则

- **纯 ESM**：无外部依赖（矩阵数据是同源镜像，不依赖仓库其它路径），可单独导出到技能包运行
- **单一事实源**：维度定义与必测点来自九维覆盖矩阵，改一处即可，`node scripts/sync-dimension-probes.mjs` 同步三份镜像，`backend/test/dimension-matrix.test.mjs` 校验一致性
- **拓扑排序**：按信息依赖排序，支持识别可并行维度
- **估算带注释**：每个估算结果附带 human-readable 说明
- **输入校验**：所有公开函数含 JSDoc + 参数校验，错误信息含上下文
- **可独立测试**：`node backend/dimension-planner.js` / `node backend/execution-scheduler.js` 各自含自测块（被 import 时不打印）

## 版本历史

### 2.0.0（2026-11-09）
- 口径从**五维**（数据/流程/环境/时间/依赖）统一为**九维**，与 `9dem-executor` 和门禁一致
- 维度定义、权重、必测点全部来自九维覆盖矩阵（单一事实源）
- 新增 `9dem-planner-invoker.js`，注册为可执行技能 `9dem_planner`（此前是「有代码没入口」）
- 用例估算改为「必测点数 × 复杂度系数」，不再使用拍定的绝对数字
- 并行组改为按信息依赖划分（用户×数据 → 流程×安全 → 操作 → 非功能三项 → 兼容性）
- 自测块改为仅在直接执行文件时运行，避免污染调用方日志

### 1.0.0
- 五维规划引擎 + 执行调度器
