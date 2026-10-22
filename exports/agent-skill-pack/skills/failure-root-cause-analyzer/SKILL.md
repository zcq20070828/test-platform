# failure-root-cause-analyzer

## 职责

对测试失败进行系统性根因分析（5-Why / 鱼骨图 / 因果链），输出根因链与改进建议优先级列表。

## 背景

方案 V3.0 辅助 Skill 之一，挂在 `defect-analyzer` 智能体下。当 `defect-analyzer` 需要对某次测试失败深挖根因时，调用本 Skill 进行系统性分析。

## 技能模块

### rca-engine（根因分析引擎）

- `analyzeRootCause(failure, context?)`：主分析入口，输入失败描述+上下文（日志/堆栈/环境），输出完整分析报告
- `apply5Why(symptom, context?)`：应用 5-Why 分析法，从症状逐层追问 5 层为什么
- `applyFishbone(effect)`：返回鱼骨图 6 大维度（人员/机器/材料/方法/环境/测量），每类含可能原因及似然度

### causal-chain（因果链构建）

- `buildCausalChain(failure, evidence)`：从失败现象+证据构建 AND/OR 门因果链节点图
- `scoreRootCause(rootCause, evidence)`：根据证据支撑度对根因置信度打分（0~1）
- `prioritizeFixes(recommendations, effort, impact)`：对改进建议按「收益/投入」排序，输出优先级列表（P0~P3）

## 分析输出结构

```js
{
  rootCause: string,                  // 根因描述（5Why 最后一级）
  causalChain: {                      // 因果链
    topEffect: string,
    rootCandidate: string,
    chain: string[],                  // 每层 Why → Answer
    gateType: 'AND' | 'OR'
  },
  fiveWhy: [                          // 5-Why 推导链
    { level, question, answer, inference }
  ],
  fishbone: [                         // 鱼骨图维度
    {
      dimension, dimensionZh,
      causes: [{ cause, likelihood }]
    }
  ],
  confidence: number,                 // 置信度 0~1
  confidenceJustification: string,   // 置信度说明
  recommendations: [                  // 改进建议（已按优先级排序）
    { text, effort, impact }
  ]
}
```

## 工作流程

1. **接收输入**：失败现象描述 + 证据（日志片段/堆栈行/环境信息）
2. **5-Why 分析**：调用 `apply5Why()` 从症状逐层追问，输出 5 层推导链
3. **鱼骨图分析**：调用 `applyFishbone()` 枚举 6 大维度的可能原因
4. **因果链构建**：调用 `buildCausalChain()` 构建 AND/OR 门节点图
5. **置信度打分**：调用 `scoreRootCause()` 根据证据支撑度计算置信度
6. **优先级排序**：调用 `prioritizeFixes()` 按「收益/投入」排序改进建议
7. **输出报告**：汇总根因链 + 置信度 + 优先级建议

## 调用示例

```js
import { analyzeRootCause, apply5Why, applyFishbone } from
  '~/.qclaw/skills/failure-root-cause-analyzer/backend/rca-engine.js';
import { buildCausalChain, scoreRootCause, prioritizeFixes } from
  '~/.qclaw/skills/failure-root-cause-analyzer/backend/causal-chain.js';

// 方式一：一条命令完成全部分析
const result = analyzeRootCause('API 请求超时，返回 504', {
  logs: ['net::ERR_CONNECTION_TIMED_OUT', 'database query timeout'],
  stackTrace: ['at TimeoutHandler.onTimeout (handler.js:45)'],
  environment: { region: 'cn-east-1', node: 'v18.0.0' },
});
console.log(result.rootCause);         // 根因
console.log(result.confidence);         // 置信度 0~1
console.log(result.recommendations);    // 优先级建议

// 方式二：分步调用
const chain = buildCausalChain('CI 流水线失败', [
  'FAIL user.test.js',
  'Expected 200 but got 500',
]);
const score = scoreRootCause('代码逻辑错误', ['Expected 200 but got 500']);
const prioritized = prioritizeFixes(
  ['修复代码逻辑', '补充测试用例'],
  [5, 3],
  [9, 6]
);
```

## 适用场景

- CI/CD 流水线测试失败，需要快速定位根因
- 生产环境告警，需要系统性分析而非逐行排查
- 测试用例失败率居高不下，需要结构性根因诊断
- 回归测试失败，需要区分代码变更引入 vs 环境问题

## 注意事项

- 置信度基于关键词匹配 + 证据数量计算，结果为辅助参考
- 5-Why 链基于预定义场景库，特殊场景可能触发通用链
- 鱼骨图 likelihood 高的原因优先生成改进建议
- 改进建议的 effort/impact 默认为 5，需结合实际情况调整
