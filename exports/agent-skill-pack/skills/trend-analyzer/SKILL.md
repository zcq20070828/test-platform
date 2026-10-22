# trend-analyzer

## 职责
分析智能体评估数据的时间序列趋势（上升/下降/平稳），识别周期性规律和异常点，为 ai-evaluation-agent 提供趋势洞察与异常告警。

## 技能
- **trend-engine**：趋势分析引擎（线性回归/移动平均/周期性检测/趋势分段/转折点识别）
- **anomaly-detector**：异常检测（偏离检测/漂移检测/自然语言摘要）

## 工作流程
1. 接收带时间戳的评估数据序列 `[{ date, value }]`
2. `trend-engine` 分析整体趋势方向与斜率
3. `anomaly-detector` 检测异常点与漂移
4. 生成自然语言趋势摘要

## 调用方式

```js
import { analyzeTrend, detectChangePoints, calculateMovingAverage, comparePeriods } from '~/.qclaw/skills/trend-analyzer/backend/trend-engine.js';
import { detectAnomalies, detectGradualDrift, summarizeTrend } from '~/.qclaw/skills/trend-analyzer/backend/anomaly-detector.js';
```

## 输出结构

### trend-engine.analyzeTrend
```js
{
  direction: 'rising' | 'falling' | 'stable',
  slope: number,           // 线性回归斜率
  rSquared: number,         // 拟合优度
  changeRate: number,       // 环比变化率%
  periodicity?: { type: 'monthly'|'weekly'|string, confidence: number },
  segments: [{ start, end, direction, avg }],
  forecast?: [{ date, value }],
  meta: { totalPoints, dateRange }
}
```

### trend-engine.detectChangePoints
```js
[{ index, date, from: 'rising'|'falling', to, value }]
```

### trend-engine.calculateMovingAverage
```js
[{ date, value, _partial?: boolean }]
```

### trend-engine.comparePeriods
```js
{
  periodA: { range, count, avg, min, max, stdDev },
  periodB: { ... },
  comparison: { avgDiff, avgDiffPct, trendShift }
}
```

### anomaly-detector.detectAnomalies
```js
{
  anomalies: [{ date, value, score, type: 'high'|'low' }],
  normalRange: { lower, upper, mean, stdDev }
}
```

### anomaly-detector.detectGradualDrift
```js
{
  drifts: [{ startDate, endDate, duration, direction, avgDeviation, severity }],
  baseline: number,
  deviations: [{ date, deviation, 偏离 }]
}
```

### anomaly-detector.summarizeTrend
```js
// 返回自然语言字符串
"📈 本周评分均值85.3，较上期+3.2分（+3.8%），呈上升趋势。最低78分（2025-07-08），最高92分（2025-07-12），相对稳定（CV=5.2%）。覆盖2025-07-07至2025-07-13，共7条记录。"
```
