# quality-metrics-definer

> 质量指标定义器 — 为每个测试需求定义量化质量指标，使评估有标准可循。

## 职责

为测试需求定义量化质量指标，提供覆盖率目标、缺陷密度阈值、回归比例等可度量标准，让测试质量可量化、可追踪、可验收。

## 技能

| 技能 | 文件 | 说明 |
|---|---|---|
| `metrics-definer` | `backend/metrics-definer.js` | 指标定义引擎，按模块类型推荐量化指标集 |
| `target-calculator` | `backend/target-calculator.js` | 目标值计算，通过率/效率/格式化输出 |

## 工作流程

```
输入：测试需求结构 { module, priority?, type?, currentCoverage?, acceptanceCriteria? }
         │
         ▼
① metrics-definer.defineMetrics()  →  生成量化指标集
         │
         ▼
② target-calculator.calcPassRateFloor()  →  计算具体通过率目标
         │
         ▼
③ target-calculator.calcTestEfficiency()  →  计算效率指标（可选）
         │
         ▼
④ target-calculator.formatMetricsSummary()  →  输出 Markdown 汇总表格
```

## 量化指标集结构

`defineMetrics()` 返回以下指标：

| 字段 | 类型 | 说明 |
|---|---|---|
| `testCoverageTarget` | `{ value, display, reason }` | 代码覆盖率目标（0.6~1.0） |
| `defectDensityThreshold` | `{ value, display, reason }` | 缺陷密度阈值（缺陷/千行代码） |
| `regressionRatio` | `{ value, display, reason }` | 回归测试比例（0.2~1.0） |
| `criticalBlockerThreshold` | `{ value, display, reason }` | 严重缺陷上限（恒为0） |
| `passRateFloor` | `{ value, display, reason }` | 通过率下限 |

## 调用方式

### 基础用法

```js
import { defineMetrics } from '~/.qclaw/skills/quality-metrics-definer/backend/metrics-definer.js';
import { calcPassRateFloor, calcTestEfficiency, formatMetricsSummary } from '~/.qclaw/skills/quality-metrics-definer/backend/target-calculator.js';

// 步骤1：定义质量指标
const metrics = defineMetrics({
  module: '支付模块',
  priority: 'P0',
  currentCoverage: 0.88,
});

// 步骤2：计算通过率下限
const passRate = calcPassRateFloor(metrics._internal?.currentCoverage ?? 0, metrics.testCoverageTarget.value);

// 步骤3：计算测试效率（执行后）
const efficiency = calcTestEfficiency({
  defects: 23,
  testcases: 500,
  duration: 180, // 分钟
});

// 步骤4：输出 Markdown 汇总
const report = formatMetricsSummary(metrics, {
  '实际执行通过率': '94.2%',
  '缺陷密度实际值': '0.38/千行',
});
console.log(report);
```

### 单独使用 metrics-definer

```js
import { suggestCoverageTarget, getDefectSeverityThresholds, calculateRegressionRatio } from '~/.qclaw/skills/quality-metrics-definer/backend/metrics-definer.js';

// 推荐模块覆盖率
const { target, reason } = suggestCoverageTarget('payment'); // target=0.95

// 缺陷严重度阈值
const thresholds = getDefectSeverityThresholds();
// { critical: { max: 0 }, high: { max: 3 }, medium: { max: 10 }, low: { max: Infinity } }

// 基于覆盖率推荐回归比例
const { ratio } = calculateRegressionRatio(0.85); // ratio=0.80
```

### 单独使用 target-calculator

```js
import { calcPassRateFloor, calcTestEfficiency } from '~/.qclaw/skills/quality-metrics-definer/backend/target-calculator.js';

// 计算最低通过率
calcPassRateFloor(0.80, 0.90);
// → { passRateFloor: 0.855, status: '差距较大', ... }

// 计算测试效率
calcTestEfficiency(45, 300, 120);
// → { defectDiscoveryRate: {...}, testCaseEfficiency: {...}, efficiencyLevel: '极高' }
```

## 模块类型 → 覆盖率映射表

| 模块类型 | 目标覆盖率 |
|---|---|
| payment / transaction | 95% |
| core / auth / login / order | 90% |
| api / integration | 85% |
| search / data / file | 80% |
| report / notification | 75% |
| admin | 70% |
| 其他 | 80%（默认） |

## 严重度阈值

| 严重度 | 上限 | 处理策略 |
|---|---|---|
| Critical（严重） | 0 | 发布前必须全部修复，阻塞发布 |
| High（高） | 3 | 超过需专项评审，确认影响范围 |
| Medium（中） | 10 | 超出需质量评审，记录跟踪 |
| Low（低） | 不限 | 建议控制在 20 以内，随版本消化 |

## 优先级对指标的影响

| 优先级 | 覆盖率调整 | 缺陷密度阈值 |
|---|---|---|
| P0 | +5% | ≤0.5 缺陷/千行 |
| P1 | +5% | ≤0.5 缺陷/千行 |
| P2 | 不调整 | ≤1.0 缺陷/千行 |
| P3 | -5%（最低60%） | ≤2.0 缺陷/千行 |
