# context-manager

> 上下文分层管理 · 压缩 · 智能淘汰

## 职责
管理 AI 智能体的长上下文（分层分级、压缩、智能淘汰），降低 Token 消耗、避免注意力稀释。  
专为 `test-requirement-analyzer`（需求分析）和 `test-case-generator`（用例生成）智能体设计，处理长文档/大量数据时自动调用。

---

## 核心能力

### 🏗️ 上下文分层（L0-L4）

| 层级 | 名称 | 淘汰策略 | 说明 |
|------|------|----------|------|
| L0 | 系统/角色设定 | ❌ 永不淘汰 | 系统提示词、角色定义 |
| L1 | 当前任务目标 | ❌ 尽量保留 | 当前任务、目标、指令 |
| L2 | 近期交互/输入 | ⚠️ 可压缩 | 最近的对话消息、用户输入 |
| L3 | 历史上下文 | ✅ 可淘汰 | 历史对话、已处理内容 |
| L4 | 参考资料/冗余 | ✅ 优先淘汰 | 附件、引用、冗余内容 |

### 📦 模块结构

```
context-manager/
├── SKILL.md
└── backend/
    ├── layered-architecture.js   # L0-L4 分层分级
    ├── compression.js             # 压缩与要点提取
    └── elimination.js             # 智能淘汰与去重
```

---

## API 调用示例

### 第一步：分层

```js
import { buildLayers, classify } from '~/.qclaw/skills/context-manager/backend/layered-architecture.js';

const chunks = [
  { id: 'c1', text: '系统角色：你是一个测试需求分析师。' },
  { id: 'c2', text: '任务：分析电商登录模块的测试需求。' },
  { id: 'c3', text: '用户：请测试购物车功能。' },
  { id: 'c4', text: '历史记录：上次生成了50条用例。' },
  { id: 'c5', text: '参考资料：参考了TestNG官方文档。' },
];

const layers = buildLayers(chunks);
// → { L0: [...], L1: [...], L2: [...], L3: [...], L4: [...] }
```

### 第二步：压缩低优先级层

```js
import { compress, summarizePoints, compressLayer } from '~/.qclaw/skills/context-manager/backend/compression.js';
import { estimateTokens } from '~/.qclaw/skills/context-manager/backend/compression.js';

// 压缩至 50%
const result = compress(longText, 0.5);

// 提取 5 个关键要点
const points = summarizePoints(longText, 5);

// 按 Token 预算压缩一层
const compressed = compressLayer(layerText, 500); // 500 tokens 预算
```

### 第三步：淘汰冗余

```js
import { evictLowPriority, deduplicate, shouldEvict } from '~/.qclaw/skills/context-manager/backend/elimination.js';

// 淘汰除 L0/L1 之外的低优先级内容
const { layers: cleanLayers, evictedCount } = evictLowPriority(layers, ['L0', 'L1']);

// 对块列表去重
const { unique, removedCount } = deduplicate(chunks);

// 评估单个块是否应淘汰
const { evict, score, reason } = shouldEvict(chunk, layers);
```

### 完整工作流

```js
import { buildLayers, summarizeLayers }  from './backend/layered-architecture.js';
import { compress, compressLayer }        from './backend/compression.js';
import { evictLowPriority, deduplicate } from './backend/elimination.js';

function manageContext(rawChunks, tokenBudget = 2000) {
  // 1. 分层
  let layers = buildLayers(rawChunks);

  // 2. 去重
  const deduped = deduplicate(layers.L2.concat(layers.L3));
  layers = { ...layers, L2: deduped.unique.filter(c => c._layer === 'L2'),
                       L3: deduped.unique.filter(c => c._layer === 'L3') };

  // 3. 压缩 L3/L4
  const budget = Math.floor(tokenBudget * 0.3); // L3/L4 占 30%
  const l3text = layers.L3.map(c => c.text).join('\n');
  const l4text = layers.L4.map(c => c.text).join('\n');
  if (l3text) layers.L3 = [{ text: compressLayer(l3text, budget).compressed, _layer: 'L3' }];
  if (l4text) layers.L4 = [{ text: compressLayer(l4text, budget).compressed, _layer: 'L4' }];

  // 4. 淘汰低优先级
  const { layers: finalLayers } = evictLowPriority(layers, ['L0', 'L1', 'L2']);

  return finalLayers;
}
```

---

## 函数清单

### layered-architecture.js

| 导出 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `classify(chunk)` | `string` | `{layer, priority, reason}` | 文本块 → L0-L4 分层 |
| `buildLayers(chunks)` | `Chunk[]` | `layers` 对象 | 批量分层 |
| `getPriority(layer)` | `L0-L4` | `number` | 层优先级数值 |

### compression.js

| 导出 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `compress(text, ratio)` | `string, number` | `{compressed, retentionRate}` | 抽取式压缩 |
| `summarizePoints(text, n)` | `string, number` | `{points[]}` | 提取关键要点 |
| `compressLayer(text, budgetTokens)` | `string, number` | `{compressed, compressedTokens}` | 按 Token 预算压缩 |
| `estimateTokens(text)` | `string` | `number` | 估算 token 数 |

### elimination.js

| 导出 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `shouldEvict(chunk, layers, window)` | `Chunk, layers, number` | `{evict, score, reason}` | 评估是否淘汰 |
| `evictLowPriority(layers, keepLayers)` | `layers, string[]` | `{layers, evictedCount}` | 执行淘汰 |
| `deduplicate(chunks)` | `Chunk[]` | `{unique, duplicates}` | 去重（SimHash+重叠率） |

---

## 效果目标

| 指标 | 目标值 |
|------|--------|
| Token 消耗降低 | 50-80% |
| 关键信息保留率 | ≥ 90% |
| 响应时间（100块） | < 50ms |
| 重复检测准确率 | > 85% |

---

## 使用场景

- **test-requirement-analyzer** 处理超长需求文档（> 10万字）时
- **test-case-generator** 批量生成用例时历史用例积累过多
- 任何 LLM 对话轮次 > 20 轮后的上下文清理
