# self-healing

> UI 元素定位失败时，自动尝试替代定位策略，实现 E2E 测试自愈合，提升测试稳定性。

## 职责

当 UI-E2E 测试因选择器变更、动态 ID、iframe、Shadow DOM 等原因导致元素定位失败时，`self-healing` Skill 自动生成并应用替代定位器，使测试用例自我修复，无需人工干预。

## 核心能力

`self-healing` 由 **healing-engine** 提供驱动，healing-engine 实现了完整的五级定位策略降级管道：

| 等级 | 策略 | 说明 | 置信度基准 |
|------|------|------|-----------|
| 1 | **稳定属性回退** | data-testid > name > aria-label > role > id > class | 82–95% |
| 2 | **文本匹配** | button/link 精确文本、包含匹配、模糊匹配 | 70–75% |
| 3 | **相对定位** | 父元素+子序号、相邻兄弟 | 50–55% |
| 4 | **XPath/CSS 互转** | CSS → XPath / XPath → CSS | ~50% |
| 5 | **语义近似** | 关键词命中、行为/导航推断 | 45–85% |

## 工作流程

```
ui-e2e-executor 检测到定位失败
         │
         ▼
 healLocator(failedLocator, pageDom, context)
         │
         ├──→ 稳定属性回退
         ├──→ 文本匹配
         ├──→ 相对定位
         ├──→ XPath/CSS 互转
         └──→ 语义近似
         │
         ▼
   候选定位器数组（按置信度排序）
         │
         ▼
 scoreCandidates(candidates, context)
         │  ← 结合测试意图（"登录按钮"）重新打分
         ▼
   最佳候选 + finalScore
         │
         ▼
 applyHealing(originalTest, healedLocator)
         │  ← 写回测试脚本片段（替换 locator + 添加注释）
         ▼
 recordHeal(success, fromLocator, toLocator)
         │  ← 内存 Map 记录，用于学习
         ▼
 getHealStats() → 返回整体成功率 + 分策略明细
```

## 调用方式（ui-e2e-executor 使用）

```js
import {
  healLocator,
  scoreCandidates,
  applyHealing,
  recordHeal,
  getHealStats,
} from '~/.qclaw/skills/self-healing/backend/healing-engine.js';

// 1. 生成候选定位器
const candidates = healLocator('#btn-123', pageElements, {
  intent: 'login button',
  tag: 'button',
  role: 'button',
});

// 2. 结合意图重新打分
const ranked = scoreCandidates(candidates, { intent: 'login button', role: 'button' });

// 3. 写回测试脚本
const patched = applyHealing(testFileContent, ranked[0]);

// 4. 记录愈合结果
recordHeal(true, '#btn-123', ranked[0].locator);

// 5. 查看统计
const stats = getHealStats();
console.log(`自愈合成功率: ${(stats.overallRate * 100).toFixed(1)}%`);
```

## 导出函数

| 函数 | 入参 | 出参 | 说明 |
|------|------|------|------|
| `healLocator(failedLocator, pageDom, context)` | `string, Array\|object, object` | `Array<Candidate>` | 生成候选定位器（按置信度降序） |
| `scoreCandidates(candidates, context)` | `Array, object` | `Array<ScoredCandidate>` | 结合上下文重新打分 |
| `applyHealing(originalTest, healedLocator, opts?)` | `string, object, object` | `string` | 将愈合后的定位器写回测试脚本 |
| `recordHeal(success, fromLocator, toLocator)` | `boolean, string, string` | `void` | 记录愈合结果（内存 Map） |
| `getHealStats()` | — | `object` | 返回整体成功率 + 分策略明细 |

## 效果目标

- ✅ 自愈合成功率 ≥ **85%**
- ✅ 支持 5 大策略：稳定属性回退 / 文本匹配 / 相对定位 / XPath-CSS 互转 / 语义近似
- ✅ 无外部依赖，纯 ESM JavaScript，Node.js 直接运行
- ✅ 内置自测块：`node healing-engine.js` 可直接验证

## 适用场景

- 元素 `id` 每次构建后变化（如 React key hash）
- 动态生成的 `class` 名（minified production build）
- iframe / Shadow DOM 隔离元素
- 第三方嵌入页面（iframe cross-origin）
- 测试脚本和页面版本不同步

## 限制与注意事项

- 需要 `ui-e2e-executor` 提供 **页面 DOM 快照**（元素列表或根节点），healing-engine 无法独立访问实时页面
- 置信度低于 30% 的候选建议人工审核后再应用
- `recordHeal` 数据存储于进程内存，进程重启后丢失（生产环境建议持久化到文件/DB）
