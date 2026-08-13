# unified-report-generator

## 职责
将聚合结果与质量指标统一生成多格式测试报告（Markdown/HTML/Excel 友好）。

## 技能
- **report-builder**：报告构建引擎，包含执行概况 / 缺陷分析 / 质量指标 / 风险评估各节
- **template-engine**：多格式渲染，支持 Markdown / HTML / Excel 友好格式

## 工作流程
1. 接收聚合结果（UTRM 格式）与质量指标
2. `report-builder` 构建报告各节
3. `template-engine` 渲染为目标格式
4. 输出 Markdown / HTML / Excel 格式报告

## 调用方式
```js
import { buildReport, buildMetricsSection } from '~/.qclaw/skills/unified-report-generator/backend/report-builder.js';
import { renderMarkdown, renderHTML } from '~/.qclaw/skills/unified-report-generator/backend/template-engine.js';
```
