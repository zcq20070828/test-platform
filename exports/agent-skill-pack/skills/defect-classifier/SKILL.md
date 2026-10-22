# defect-classifier

## 职责
对缺陷进行标准化分类（类型/严重度/优先级/模块/根因），生成缺陷画像与分布报告。

## 技能
- **classifier**：缺陷分类引擎（日志推断 / 堆栈解析 / 文本分类）
- **profile-builder**：缺陷画像与分布报告构建

## 工作流程
1. 接收缺陷原始信息（标题 / 描述 / 日志 / 堆栈）
2. `classifier` 执行标准化分类（类型 / 严重度 / 优先级 / 模块）
3. `profile-builder` 生成单缺陷画像与整体分布报告
4. 输出分类结果与 Markdown 汇总

## 调用方式
```js
import { classifyDefect, classifyByLog, classifyByStack, calculatePriority } from '~/.qclaw/skills/defect-classifier/backend/classifier.js';
import { buildDefectProfile, buildDistribution, generateDefectSummary } from '~/.qclaw/skills/defect-classifier/backend/profile-builder.js';
```

### 分类维度说明

| 维度 | 可选值 |
|------|--------|
| **type** | `功能` / `性能` / `安全` / `兼容` / `UI` / `接口` / `数据` / `环境` / `逻辑` |
| **severity** | `Blocker` / `Critical` / `Major` / `Minor` / `Cosmetic` |
| **priority** | `P0` / `P1` / `P2` / `P3` |
| **module** | 业务模块字符串，由分类器推断 |
| **rootCauseCategory** | `需求缺陷` / `设计缺陷` / `编码缺陷` / `测试缺陷` / `环境缺陷` / `第三方缺陷` |
| **reproductionDifficulty** | 整数 1~5（1=极易复现，5=极难复现） |
