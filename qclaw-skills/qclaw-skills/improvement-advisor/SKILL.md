# improvement-advisor

持续改进建议器 - 基于评估结果生成结构化改进建议（优先级排序 + 预期收益 + 路线图）。

## 职责

基于评估结果（评分/趋势/异常）生成结构化的智能体改进建议，包括：
- 薄弱环节识别（评分 < 70 的维度）
- 短/中/长期行动计划
- 优先级排序与 ROI 估算
- 改进路线图规划

## 技能

### advisor-engine（改进建议引擎）
- `generateImprovements(evaluationResult, trendData, anomalyData)` - 主建议生成入口
- `identifyWeaknesses(metrics)` - 识别薄弱环节
- `generateActionPlan(weaknesses, constraints?)` - 生成可执行行动计划

### priority-scorer（优先级评分）
- `scoreAction(action, effort, expectedImpact, urgency)` - 综合评分（0~100）
- `rankActions(actions)` - 按评分排序
- `estimateROI(action)` - ROI 估算
- `generateRoadmap(actions, timelineConstraints)` - 生成改进路线图

## 工作流程

1. **接收输入**：评估结果 + 趋势数据 + 异常数据
2. **识别薄弱环节**：advisor-engine 分析指标，识别评分 < 70 的维度
3. **生成行动计划**：将薄弱环节转化为短/中/长期行动
4. **优先级评分**：priority-scorer 对行动综合评分，估算 ROI
5. **生成路线图**：按周/月分配行动，输出结构化改进建议文档

## 输出结构

```javascript
{
  shortTerm: [   // 快速见效（1周内）
    { action, reason, expectedImpact, effort, priority }
  ],
  midTerm: [     // 持续改进（1~4周）
    { action, reason, expectedImpact, effort, priority }
  ],
  longTerm: [    // 体系优化（1个月+）
    { action, reason, expectedImpact, effort, priority }
  ],
  priorityRoadmap: {
    week1: [...],
    week2_4: [...],
    monthPlus: [...]
  }
}
```

## 调用方式

```javascript
import { generateImprovements, identifyWeaknesses } from '~/.qclaw/skills/improvement-advisor/backend/advisor-engine.js';
import { scoreAction, generateRoadmap } from '~/.qclaw/skills/improvement-advisor/backend/priority-scorer.js';

// 完整流程
const result = generateImprovements(evaluationResult, trendData, anomalyData);
console.log(result.priorityRoadmap);

// 单独使用
const weaknesses = identifyWeaknesses(metrics);
const roadmap = generateRoadmap(actions, { weeks: 4 });
```

## 评分公式

综合评分 = `impact × 0.4 + urgency × 0.3 - effort × 0.3`

其中：
- `impact`：预期影响（0~100）
- `urgency`：紧急程度（0~100）
- `effort`：投入精力（0~100）

## 使用场景

- AI 评估后的改进建议生成
- 智能体性能优化规划
- 质量提升路线图制定
- 迭代改进优先级决策

## 依赖

- 无外部依赖，纯 JavaScript（ESM）
- Node.js >= 14.0.0
