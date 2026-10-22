# defect-knowledge-queryer

## 归属智能体
`defect-analyzer`（缺陷分析智能体）

## 职责
查询历史缺陷知识库，匹配相似缺陷，提取缺陷模式，辅助 defect-analyzer 进行根因分析。

## 技能
- `knowledge-graph`：缺陷知识图谱构建与相似查询
- `query-engine`：多条件缺陷检索与相关性排序
- `pattern-matcher`：缺陷模式提取与匹配

## 工作流程
1. 接收 defect-analyzer 传入的当前缺陷（标题/类型/模块/症状）
2. 调用 `query-engine` 按条件检索历史相似缺陷
3. 调用 `knowledge-graph` 计算相似度 Top-K
4. 调用 `pattern-matcher` 提取并匹配缺陷模式
5. 返回：相似缺陷列表 + 推荐根因 + 推荐修复方案

## 调用方式（defect-analyzer 使用）

```js
import { queryDefects, rankByRelevance, summarize } from '~/.qclaw/skills/defect-knowledge-queryer/backend/query-engine.js';
import { buildGraph, querySimilar, getPatterns } from '~/.qclaw/skills/defect-knowledge-queryer/backend/knowledge-graph.js';
import { extractPattern, matchPattern, learnPattern } from '~/.qclaw/skills/defect-knowledge-queryer/backend/pattern-matcher.js';
```

### 示例调用

```js
// 1. 构建知识图谱
const graph = buildGraph(historicalDefects);

// 2. 查询相似缺陷
const similar = querySimilar(graph, currentDefect, 5);
console.log(similar);
// [{ id: 'DEF-001', similarity: 0.875, rootCause: '...', fix: '...' }]

// 3. 多条件过滤
const filtered = queryDefects(historicalDefects, {
  type: 'UI缺陷',
  module: 'auth',
  keyword: '白屏',
  limit: 10,
});

// 4. 提取缺陷模式
const pattern = extractPattern('登录页面白屏，CSS未加载');
console.log(pattern);
// { type: 'UI缺陷', symptomKeywords: ['白屏'], rootCauseKeywords: ['CSS未加载'], confidence: 0.75 }

// 5. 匹配已知模式库
const matched = matchPattern(currentDefect, knownPatterns);

// 6. 从缺陷集合挖掘高频模式
const learned = learnPattern(defectList, 3);

// 7. 汇总统计
const summary = summarize(defectList);
// { total: 50, byType: {...}, byModule: {...}, bySeverity: {...}, recentTrend: [...] }
```

## 输出格式

```
相似缺陷: [{ id, title, similarity, rootCause, fix }]
推荐根因: <文本>
推荐修复: <文本>
匹配模式: <模式名 + 置信度>
```

## 缺陷对象标准格式

```ts
interface Defect {
  id: string;
  title: string;
  type: string;        // e.g. '功能缺陷' | 'UI缺陷' | '性能缺陷'
  module: string;      // e.g. 'auth' | 'user' | 'order'
  symptom: string;     // 症状描述
  rootCause: string;   // 根因描述
  fix: string;         // 修复方案
  severity?: string;   // 'high' | 'medium' | 'low'
  createdAt?: string; // ISO date string
}
```

## backend 文件说明

| 文件 | 导出函数 |
|------|---------|
| `knowledge-graph.js` | `buildGraph`, `addDefect`, `querySimilar`, `getPatterns` |
| `query-engine.js` | `queryDefects`, `rankByRelevance`, `summarize` |
| `pattern-matcher.js` | `extractPattern`, `matchPattern`, `learnPattern` |

## 相似度算法说明

`querySimilar` 使用加权多维度相似度：

- **症状 Jaccard 相似度 × 60%**：对 symptom 提取中英文 token，计算 Jaccard 系数
- **模块精确匹配 × 25%**：模块名完全一致时加分
- **类型精确匹配 × 15%**：缺陷类型完全一致时加分

最终 similarity 分数范围 0~1。
