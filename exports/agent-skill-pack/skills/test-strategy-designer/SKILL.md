# test-strategy-designer

> 测试策略设计器 —— 方案 V3.0 辅助 Skill，挂在 `test-scheme-generator` 智能体下

## 职责

制定完整测试策略（分层策略/资源分配/工具选型/里程碑），指导测试方案生成，为后续用例设计、自动化规划和执行提供战略框架。

## 技能模块

| 模块 | 文件 | 核心能力 |
|------|------|----------|
| **strategy-engine** | `backend/strategy-engine.js` | 复杂度评估、测试模式选择、里程碑规划、工具链推荐 |
| **resource-allocator** | `backend/resource-allocator.js` | 资源分配、工时估算、成本计算、自动化推进计划 |

## 核心 API

### strategy-engine

```js
import { designStrategy, assessComplexity, selectApproach, generateMilestonePlan } 
  from '~/.qclaw/skills/test-strategy-designer/backend/strategy-engine.js';
```

| 函数 | 说明 | 返回值 |
|------|------|--------|
| `assessComplexity(requirement)` | 评估需求复杂度（1-5分） | `{ score, dimensions }` 含功能/集成/数据/风险/变更频率等6个维度 |
| `selectApproach(complexity, risk?, timeBudget?)` | 选择测试模式 | `{ approach, rationale, coverage }` 四种模式：exploratory/hybrid/scripted-heavy/ai-driven |
| `generateMilestonePlan(durationDays, complexity)` | 生成时间里程碑 | `Milestone[]` 含6个标准阶段及交付触发条件 |
| `designStrategy(requirement, constraints?)` | **主入口**：生成完整测试策略 | `Strategy` 含测试分层、工具选型、里程碑、风险缓解 |

### resource-allocator

```js
import { allocateResources, estimateTestDuration, calcToolCost } 
  from '~/.qclaw/skills/test-strategy-designer/backend/resource-allocator.js';
```

| 函数 | 说明 | 返回值 |
|------|------|--------|
| `estimateTestDuration(usecaseCount, complexity, teamSize)` | 估算测试执行总工期 | `{ totalDays, byLevel, notes }` 含各层工时明细 |
| `calcToolCost(toolChain)` | 计算工具链成本 | `{ breakdown, monthly, yearly }` 自动识别开源/商业工具 |
| `allocateResources(requirement, availableBudget, options?)` | **主入口**：分配测试资源 | `{ allocation, costSummary, warnings, recommendations }` 含人力/工具/环境/自动化计划 |

## 工作流程

```
┌──────────────────────────────────────────────────────────────┐
│  1. 输入：需求结构 + 约束条件（时间/资源/风险偏好）          │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  2. strategy-engine:                                           │
│     ├─ assessComplexity    → 复杂度评分(1-5) + 6维度明细      │
│     ├─ selectApproach      → 测试模式(探索/混合/脚本/AI驱动)  │
│     ├─ generateMilestonePlan → 里程碑计划(6阶段)              │
│     └─ designStrategy      → 完整策略文档                     │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  3. resource-allocator:                                        │
│     ├─ estimateTestDuration → 工时估算(各层明细)              │
│     ├─ calcToolCost         → 工具链成本(开源/商业/月均)       │
│     └─ allocateResources    → 完整资源分配方案                 │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  4. 输出：完整测试策略文档                                     │
│     · testLevels[]     各测试分层策略（目标/重点/覆盖率/手段） │
│     · approach          测试模式 + 理由                        │
│     · toolSelection     推荐工具链                            │
│     · milestonePlan[]   时间里程碑（含交付触发条件）          │
│     · riskMitigation[]   风险识别 + 缓解措施                   │
│     · costSummary        成本分配 + 超支预警                   │
│     · recommendations[]  优化建议                             │
└──────────────────────────────────────────────────────────────┘
```

## 典型调用示例

```js
// === 完整工作流 ===
import { designStrategy } from '~/.qclaw/skills/test-strategy-designer/backend/strategy-engine.js';
import { allocateResources } from '~/.qclaw/skills/test-strategy-designer/backend/resource-allocator.js';

const requirement = '电商订单系统，含支付流程、库存同步、第三方物流接口，需在10天内完成';

// 策略生成
const strategy = designStrategy(requirement, {
  timeBudget: 10,
  budget: 5,
  teamSize: 3,
  techStack: ['Java', 'Spring Boot', 'PostgreSQL'],
  riskPreference: 4,
});

console.log(`测试模式: ${strategy.approach}`);      // ai-driven / scripted-heavy / hybrid / exploratory
console.log(`复杂度: ${strategy.meta.complexityScore}/5`);
console.log('里程碑:', strategy.milestonePlan.map(m => `${m.label}(Day${m.startDay}-${m.endDay})`));

// 资源分配
const resources = allocateResources(requirement, 5, {
  teamSize: 3,
  durationDays: 10,
  automationTarget: 0.5,
  costPreference: 'balanced',
});

console.log(`总成本: ¥${resources.costSummary.total}`);
console.log(`工期: ${resources.allocation.automationPlan.targetRate}%自动化下需 ${estimateTestDuration(50, strategy.meta.complexityScore, 3).totalDays} 天`);
```

## 设计原则

- **纯 JavaScript（ESM）**，无外部依赖，可直接在任何 Node.js 环境中运行
- 所有函数带完整 JSDoc 类型标注与输入校验
- 算法透明：复杂度评分、覆盖率计算等均有可读的权重公式
- 输出可嵌入：策略文档结构化，适合作为 AI 智能体的下一步输入

## 适用场景

- 测试方案生成前的策略规划阶段
- 评估项目规模、时间/资源约束下的可行性
- 为管理者提供测试投入/产出预估依据
- 指导自动化测试的优先级与工具选型决策
