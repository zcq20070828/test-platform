# 9dem-planner

> 九维穷举测试规划与执行调度引擎

## 职责

协调九维穷举模型（用户 / 数据 / 流程 / 操作 / 安全 / 性能 / 网络环境 / 终端环境 / 兼容性）各维度的测试规划与执行调度，基于依赖关系拓扑排序实现最优并行，在最大化覆盖率的同时控制用例规模，输出可直接交给各维度生成器的可执行任务计划。

## 五维定义

| 维度 | 英文 | 说明 | 风险 |
|------|------|------|------|
| 数据维度 | `data` | 数据边界、空值、类型、编码、长度等变体 | 低 |
| 流程维度 | `process` | 业务流程路径、分支、异常流 | 高 |
| 环境维度 | `environment` | 浏览器/OS/网络/分辨率/硬件组合 | 中 |
| 时间维度 | `time` | 时效/窗口/时区/并发/负载/周期 | 极高 |
| 依赖维度 | `dependency` | 外部依赖（API/DB/第三方服务/缓存） | 极高 |

## 维度依赖关系

```
[数据] ──┬──▶ [流程] ──┬──▶ [环境]
         │             ├──▶ [时间]
         │             │
         └─────────────┴──▶ [依赖]
```

- **数据维度**：无前置依赖，优先级最低
- **流程维度**：依赖数据维度
- **环境维度**：依赖数据 + 流程维度
- **时间维度**：依赖流程维度（可与环境并行）
- **依赖维度**：依赖全部四维，必须最后执行

## 技能

### 1. dimension-planner（维度规划引擎）

**文件**：`backend/dimension-planner.js`

| 导出函数 | 说明 |
|----------|------|
| `planDimensions(requirement, existingDimensions?)` | 主规划入口，输入需求结构+已有维度，输出五维规划 |
| `getDimensionDependencies()` | 返回五维依赖关系图 |
| `getExecutionOrder()` | 返回依赖拓扑排序后的执行顺序 |
| `estimateDimensionCases(dimension, complexity)` | 估算指定维度用例数量 |
| `identifyCoverageGaps(covered, required?)` | 识别未覆盖的维度缺口 |

### 2. execution-scheduler（执行调度器）

**文件**：`backend/execution-scheduler.js`

| 导出函数 | 说明 |
|----------|------|
| `scheduleExecution(plan, resourceLimit?)` | 基于规划结果生成调度序列与并行组 |
| `estimateTotalDuration(dimensions, caseCounts?)` | 估算九维穷举总耗时（天） |
| `suggestPriorities(plan)` | 基于风险/复杂度/依赖度给出优先级建议 |

## 工作流程

```
1. 接收需求结构 + 已覆盖维度（如有）
   ↓
2. dimension-planner.planDimensions()
   - 推断各维度复杂度
   - 估算用例数量
   - 分析依赖关系确定执行顺序
   - 识别覆盖缺口
   ↓
3. execution-scheduler.scheduleExecution()
   - 划分并行执行组（组内并行，组间串行）
   - 生成调度序列（含阻塞关系）
   - 估算总工期
   ↓
4. execution-scheduler.suggestPriorities()
   - 基于风险/复杂度/依赖度打分
   - 输出优先级排序
   ↓
5. 输出可执行的五维用例生成任务计划
   交给各维度生成器（test-data-generator / test-flow-generator 等）
```

## 调用示例

```js
// 导入
import { planDimensions, getDimensionDependencies } from '~/.qclaw/skills/9dem-planner/backend/dimension-planner.js';
import { scheduleExecution, suggestPriorities } from '~/.qclaw/skills/9dem-planner/backend/execution-scheduler.js';

// Step 1: 规划
const requirement = {
  dataVariations: 15,   // 数据变体数 → 推断复杂度
  processSteps: 12,     // 流程步骤数
  envCount: 8,          // 环境组合数
  timeFactors: 6,       // 时间因子数
  depCount: 5,          // 依赖项数
};
const existingDimensions = ['data']; // 已完成数据维度
const plan = planDimensions(requirement, existingDimensions);

// Step 2: 调度
const schedule = scheduleExecution(plan, { maxParallel: 3 });

// Step 3: 优先级
const priorities = suggestPriorities(plan);

console.log(plan.estimatedCases);      // 总用例数估算
console.log(schedule.parallelGroups);   // 并行执行组
console.log(priorities);               // 优先级排序
```

## 输出结构示例

```js
planDimensions() 返回:
{
  dimensions: [{ name, label, complexity, estimatedCases, dependencies, alreadyCovered }],
  executionOrder: ['data', 'process', 'environment', 'time', 'dependency'],
  estimatedCases: 123,
  coverageGap: [{ dimension, label, reason, priority }],
  completeness: 20,   // 百分比
  summary: { totalDimensions: 5, coveredCount: 1, pendingCount: 4, estimatedCases: 123 }
}

scheduleExecution() 返回:
{
  sequence: [{ step, dimension, label, estimatedCases, groupId, blockedBy, skip }],
  parallelGroups: [{ groupId, label, dimensions, parallelizable }],
  totalDuration: { sequentialDays, parallelDays, recommendedDays },
  recommendations: ['建议1', '建议2', ...]
}

suggestPriorities() 返回:
[
  { rank: 1, dimension: 'process', label: '流程维度', score: 300, priority: 'critical', reason: '...' },
  ...
]
```

## 设计原则

- **纯 ESM**：无外部依赖，仅使用 Node.js 内置 API
- **拓扑排序**：按依赖链排序，支持识别可并行维度
- **估算带注释**：每个估算结果附带 human-readable 说明
- **输入校验**：所有公开函数含 JSDoc + 参数校验，错误信息含上下文
- **可独立测试**：`node dimension-planner.js` / `node execution-scheduler.js` 各自含自测块
