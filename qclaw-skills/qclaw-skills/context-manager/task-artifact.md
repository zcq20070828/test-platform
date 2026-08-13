# context-manager Skill 创建完成

## 任务
为 OpenClaw 创建 `context-manager` Skill（L0-L4 上下文分层管理·压缩·智能淘汰）。

## 完成内容

### 目录结构
```
~/.qclaw/skills/context-manager/
├── SKILL.md                          # 技能说明文档
└── backend/
    ├── layered-architecture.js       # L0-L4 分层分级
    ├── compression.js                 # 压缩与要点提取
    └── elimination.js                 # 智能淘汰与去重
```

### backend/layered-architecture.js
- `classify(chunk)` → `{layer, priority, reason}` — 文本 → L0-L4 分层（关键词匹配 + 长度辅助）
- `buildLayers(chunks)` → `layers` 对象 — 批量分层
- `getPriority(layer)` → `number` — 层优先级数值
- `getLayerPolicy(layer)` → 层级元信息（淘汰策略、压缩策略）
- `summarizeLayers(layers)` → 统计摘要字符串

### backend/compression.js
- `compress(text, ratio)` → `{compressed, originalLength, compressedLength, retentionRate}` — 抽取式压缩
- `summarizePoints(text, maxPoints)` → `{points[], originalLength}` — 关键要点提取
- `compressLayer(layerText, budgetTokens)` → `{compressed, originalTokens, compressedTokens, compressedRatio}` — Token 预算压缩
- `estimateTokens(text)` → `number` — 估算 token 数（中文 1.5/字，英文 0.25/字）

### backend/elimination.js
- `shouldEvict(chunk, layers, window)` → `{evict, score, reason}` — 淘汰评估（层优先级+未访问衰减+冗余度）
- `evictLowPriority(layers, keepLayers)` → `{layers, evictedCount, evictedChars, stats}` — 执行淘汰
- `deduplicate(chunks)` → `{unique, duplicates, removedCount}` — SimHash 海明距离 + 重叠率双重去重
- `simpleSimHash(text, n)` — 64位 SimHash 指纹
- `hammingDistance(a, b)` → 0-64
- `textOverlap(a, b)` → Jaccard 相似度

## 验证结果

**layered-architecture.js** ✅
```
  L0 → 0 | L3 → 3 | L4 → 4
✅ layered-architecture.js 验证通过
```

**compression.js** ✅
```
原文：573字，约591 tokens
压缩至50%：保留率50.0%
Token预算150压缩：591→260 tokens，压缩比0.44
✅ compression.js 验证通过
```

**elimination.js** ✅
```
SimHash测试：相同文本距离=0，不同文本距离=28
去重：5块→3块，移除2块
✅ elimination.js 验证通过
```

## 关键设计决策
1. 纯 ESM JavaScript，无外部依赖，node 可直接引入
2. `LAYER_PRIORITY` 从 `layered-architecture.js` 导出，供 `elimination.js` 使用
3. SimHash 采用 FNV-1a 简化哈希 + 64位向量，海明距离阈值=10
4. JSDoc 全覆盖，含输入校验和自测块
5. SKILL.md 包含完整 API 示例和完整工作流代码
