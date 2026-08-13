---
name: result-aggregator
description: 结果聚合器。收集、聚合、去重、排序测试结果，生成最终报告。V1.0实现结果收集、聚合、去重、排序、报告生成（Markdown/HTML/JSON）。
---

# 结果聚合器（Result Aggregator）

## 角色定位

结果聚合专家，收集各智能体返回的测试结果，进行聚合、去重、排序，生成最终测试报告。

## 核心功能

### V1.0（当前版本）：结果聚合处理
1. **结果收集**（collectResults）
   - 收集各智能体返回的结果
   - 按来源分组（bySource）
   - 按状态分组（byStatus）
   - 按优先级分组（byPriority）

2. **结果聚合**（aggregateResults）
   - 统计总测试数、通过数、失败数、跳过数、错误数
   - 计算通过率（passRate）、失败率（failureRate）
   - 生成详细结果列表（details）
   - 生成摘要（summary）

3. **去重处理**（deduplicateResults）
   - 基于指定字段去重（keyFields：id、name等）
   - 支持多种保留策略（keepStrategy：first、last、best）
   - 记录重复项详情（duplicates）

4. **排序优化**（sortResults）
   - 按优先级排序（priority：critical > high > medium > low）
   - 按状态排序（status：failed > error > skipped > passed）
   - 按执行时间排序（duration）
   - 按时间戳排序（timestamp）
   - 支持升序/降序（sortOrder：asc、desc）

5. **报告生成**（generateReport）
   - 支持Markdown格式（format：markdown）
   - 支持HTML格式（format：html）
   - 支持JSON格式（format：json）
   - 支持按状态/优先级/来源分组（groupBy）

## 输入格式

### 测试结果数组（results）

```javascript
const results = [
  {
    id: 'TC-001',
    name: '用户登录测试',
    status: 'passed',        // passed、failed、skipped、error
    priority: 'high',        // critical、high、medium、low
    source: 'api-executor', // 来源智能体
    duration: 1200,          // 执行时间（毫秒）
    message: '登录成功',     // 结果消息
    timestamp: '2026-07-03T22:00:00Z'
  },
  {
    id: 'TC-002',
    name: '用户注册测试',
    status: 'failed',
    priority: 'high',
    source: 'api-executor',
    duration: 1500,
    message: '邮箱已存在',
    timestamp: '2026-07-03T22:01:00Z'
  }
];
```

## 输出格式

### 聚合结果（aggregated）

```javascript
const aggregated = {
  total: 5,
  passed: 2,
  failed: 1,
  skipped: 1,
  error: 1,
  passRate: '40.00%',
  failureRate: '20.00%',
  details: [
    {
      id: 'TC-001',
      name: '用户登录测试',
      status: 'passed',
      priority: 'high',
      source: 'api-executor',
      duration: 1200,
      message: '登录成功',
      timestamp: '2026-07-03T22:00:00Z'
    }
  ],
  summary: '总共5个测试，通过2个（40.00%），失败1个（20.00%）'
};
```

### 去重结果（deduplicated）

```javascript
const deduplicated = {
  total: 5,
  unique: 3,
  removed: 2,
  duplicates: [
    { original: 0, duplicate: 1, key: 'TC-001|用户登录测试' }
  ],
  uniqueResults: [
    { id: 'TC-001', name: '用户登录测试', status: 'passed', ... }
  ]
};
```

### 聚合报告（report）

```javascript
const report = {
  title: '测试聚合报告',
  timestamp: '2026-07-03T13:45:38.558Z',
  summary: '总共5个测试，通过2个（40.00%），失败1个（20.00%）',
  total: 5,
  passRate: '40.00%',
  failureRate: '20.00%',
  details: [
    {
      group: 'failed',
      count: 1,
      items: [...]
    }
  ],
  content: '# 测试聚合报告\n\n...',  // Markdown或HTML内容
  format: 'markdown'
};
```

## 使用方法

### 通过Node.js调用

```javascript
const { executeResultAggregator } = require('./backend/result-aggregator.js');

// 执行完整结果聚合分析
const result = await executeResultAggregator({
  results: results,                    // 测试结果数组
  collectOptions: {},                  // 收集选项
  aggregateOptions: {},                // 聚合选项
  deduplicateOptions: {                // 去重选项
    keyFields: ['id', 'name'],
    keepStrategy: 'best'              // first、last、best
  },
  sortOptions: {                      // 排序选项
    sortBy: ['priority', 'status'],
    sortOrder: 'desc',                // asc、desc
    priorityOrder: ['critical', 'high', 'medium', 'low'],
    statusOrder: ['failed', 'error', 'skipped', 'passed']
  },
  reportOptions: {                    // 报告选项
    format: 'markdown',               // markdown、html、json
    includeDetails: true,
    groupBy: 'status'                // status、priority、source
  }
});

console.log(result);
```

### 通过命令行调用

```bash
# 运行所有示例
node examples/usage.js
```

## 工作流程

### 自动模式（默认）
接收到结果聚合请求后，自动执行：
1. 收集结果（collectResults）
2. 聚合结果（aggregateResults）
3. 去重处理（deduplicateResults）
4. 排序优化（sortResults）
5. 生成报告（generateReport）
6. 输出结构化聚合报告

### 交互模式（可选）
如果用户要求交互式配置，则询问关键参数。

## 约束

- 输入的results必须为非空数组
- 去重字段（keyFields）必须能唯一标识一个结果
- 保留策略（keepStrategy）：
  - `first`：保留第一次出现的结果
  - `last`：保留最后一次出现的结果
  - `best`：保留状态最好的结果（passed > skipped > failed > error）
- 报告格式（format）：
  - `markdown`：生成Markdown格式报告
  - `html`：生成HTML格式报告
  - `json`：生成JSON格式报告
- 分组方式（groupBy）：
  - `status`：按状态分组
  - `priority`：按优先级分组
  - `source`：按来源分组

## 工具集成

- **内置算法**：结果收集、聚合、去重、排序、报告生成
- **扩展工具**（V2.0）：集成ELK Stack（日志聚合）、Grafana（可视化）

## 审核标准

输出后由 ai-quality-reviewer 审核：
- 聚合准确性（40%）：聚合结果是否正确
- 去重有效性（30%）：是否有效去除重复项
- 排序合理性（20%）：排序是否符合预期
- 报告完整性（10%）：报告是否包含所有必要信息

总分 ≥ 70 分且无一票否决，方可交付。

## 示例

参见 `examples/usage.js` 查看完整使用示例。

**运行示例：**

```bash
cd ~/.qclaw/skills/result-aggregator
node examples/usage.js
```

**示例输出：**

```
=== 示例1：结果收集与聚合 ===

输出：聚合结果
  - 总测试数：5
  - 通过：2个（40.00%）
  - 失败：1个（20.00%）
  - 跳过：1个
  - 错误：1个
  - 摘要：总共5个测试，通过2个（40.00%），失败1个（20.00%）

=== 示例2：去重处理 ===

输出：去重结果
  - 原始结果数：5
  - 唯一结果数：3
  - 移除重复数：2
  - 重复项详情：2处

=== 示例4：生成聚合报告（Markdown格式） ===

输出：Markdown格式报告
---报告内容开始---
# 测试聚合报告

**生成时间**：2026-07-03T13:45:38.558Z

## 摘要

- 总测试数：5
- 通过率：40.00%
- 失败率：20.00%
...
```

## 版本历史

- V1.0（2026-07-03）：实现结果聚合处理（收集、聚合、去重、排序、报告生成）

## 文件结构

```
~/.qclaw/skills/result-aggregator/
├── SKILL.md                           # Skill描述和使用说明（本文件）
├── README.md                          # 项目说明
├── backend/
│   └── result-aggregator.js          # 结果聚合器实现（V1.0）
├── examples/
│   └── usage.js                      # 使用示例
└── test/
    └── test.js                       # 单元测试
```

## 测试方法

### 单元测试

```bash
# 运行所有测试
node test/test.js

# 测试结果收集
node -e "const m = require('./backend/result-aggregator.js'); console.log(m.collectResults([{id:'TC-001',status:'passed'}]))"
```

### 集成测试

```bash
# 测试与ai-quality-reviewer的集成
# （待实现）
```

## 已知限制

1. **去重处理**：当前仅支持基于字段的去重，不支持基于相似度的去重
   - 解决方案：引入相似度算法（如编辑距离、余弦相似度）（V2.0）

2. **排序优化**：当前排序逻辑可能有误（desc排序按优先级降序排列）
   - 解决方案：修复排序逻辑（V1.1）

3. **报告生成**：当前仅支持简单的Markdown和HTML格式，不支持PDF、Excel等格式
   - 解决方案：集成PDF、Excel导出功能（V2.0）

4. **结果收集**：当前仅支持同步收集，不支持异步收集
   - 解决方案：支持异步收集（V2.0）

## 后续计划

### V1.0（2026-07-20前）
- ✅ 实现结果聚合处理（收集、聚合、去重、排序、报告生成）
- ⏳ 修复排序逻辑（V1.1）
- ⏳ 编写完整单元测试（test.js）
- ⏳ 集成到ai-quality-reviewer
- ⏳ 编写用户手册

### V2.0（2026-08-01前）
- ⏳ 引入相似度算法（编辑距离、余弦相似度）
- ⏳ 修复排序逻辑
- ⏳ 集成PDF、Excel导出功能
- ⏳ 支持异步收集
- ⏳ 集成ELK Stack、Grafana
- ⏳ 编写完整文档

## 联系人

- 开发者：测试中台项目组
- 审核者：ai-quality-reviewer
- 用户：test-case-generator、api-executor、ui-e2e-executor智能体
