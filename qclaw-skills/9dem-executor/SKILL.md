---
name: 9dem-executor
description: 九维穷举模型执行器（9DEM + 9 种黑盒设计方法）。基于用户、数据、流程、操作、安全、性能、网络环境、终端环境、兼容性九个维度穷举测试范围，并用等价类划分、边界值分析、因果图、判定表、正交试验、错误推测、场景法、状态迁移、功能图 9 种方法确定性生成用例；跨方法自动去重，输出可直接落表的用例清单与维度覆盖矩阵。V3.0 集成设计方法引擎、PICT、测试脚本生成器、测试框架集成。
version: 3.0.0
---

# 九维穷举模型执行器（9DEM Executor）

## 角色定位

测试方法论专家，用「维度 × 方法」二维模型生成高覆盖率测试用例，并自动生成测试脚本和执行测试。

- **维度（9DEM）回答「测哪里」**：用户 / 数据 / 流程 / 操作 / 安全 / 性能 / 网络环境 / 终端环境 / 兼容性；
- **方法（黑盒 9 法）回答「怎么设计」**：等价类划分、边界值分析、因果图、判定表、正交试验、错误推测、场景法、状态迁移、功能图；
- 两条轴正交：同一维度可用多种方法设计，同一方法可覆盖多个维度。生成结果按「输入+步骤+预期」跨方法去重，避免同一条用例被重复计数。

九维定义（权重裁剪依据需求类型动态调整）：

| 维度 | 键 | 关注点 | 典型层级 |
|------|-----|--------|---------|
| ① 用户 | user | 登录态/角色/数据隔离/越权 | 正常/边界/异常 |
| ② 数据 | data | 业务数据、接口参数、LLM输出，BVA七点集 | 正常/边界/异常 |
| ③ 流程 | process | 多阶段状态机，合法+非法迁移 | 正常/边界/异常 |
| ④ 操作 | operation | 重复操作/中断恢复/幂等 | 正常/边界/异常 |
| ⑤ 安全 | security | 鉴权/越权/敏感信息脱敏/注入 | 边界/异常 |
| ⑥ 性能 | performance | 超时/并发/大数据量/宕机恢复 | 边界/异常 |
| ⑦ 网络环境 | network | 弱网/断网/切网/SSE断流/超时重试 | 正常/边界/异常 |
| ⑧ 终端环境 | terminal | 浏览器与系统级中断（切后台/锁屏） | 正常/边界/异常 |
| ⑨ 兼容性 | compatibility | 浏览器矩阵/SSE EventSource/渲染布局一致性 | 边界/异常 |

黑盒 9 种设计方法（权重与维度正交，按输入信息可用性自动启用）：

| 方法 | 键 | 典型适用维度 | 输入要求 | 输出 |
|------|-----|-------------|---------|------|
| 等价类划分法 | equivalence | ② 数据 / ① 用户 | inputSpec/fields | 有效/无效等价类各至少 1 条 |
| 边界值分析法 | boundary | ② 数据 | inputSpec/fields 的区间或长度 | min-1/min/min+1/内点/max-1/max/max+1 |
| 因果图法 | causeEffect | ② 数据 / ③ 流程 | causes + effects + rules | 每条规则 1 条 + 取反反例 |
| 判定表法 | decisionTable | ② 数据 / ③ 流程 | rules（conditions/actions） | 每条规则列 1 条 + 全不满足默认规则 |
| 正交试验法 | orthogonal | ⑨ 兼容性 / ② 数据 | factors（≥2 因子，每因子 ≥2 水平） | 2-wise 覆盖组合（超限时贪心，≤64 条） |
| 错误推测法 | errorGuessing | ② 数据 / ⑤ 安全 / ④ 操作 | inputSpec/fields | 空值/null/超长/特殊字符/SQLi/XSS/全角/负数/重复提交/并发 |
| 场景法 | scenario | ③ 流程 | scenarios（基本流/备选流/异常流） | 每条业务路径 1 条 |
| 状态迁移法 | stateTransition | ③ 流程 | states + transitions | 合法迁移全覆盖 + 非法迁移抽样（≤12 条） |
| 功能图法 | functionGraph | ④ 操作 | functions（前后置条件/依赖） | 每功能正常调用 + 前置条件不满足反例 |

去重规则：以「输入 + 步骤 + 预期」归一化后作为唯一键；同一键只保留一条，`methods` / `dimensions` 字段合并标注全部命中方法（如「等价类划分法+边界值分析法」）。

## 核心功能

### V2.0：九维穷举（9DEM）
1. **数据维度**（data，自动化计算）
   - 等价类划分
   - 边界值分析（BVA 七点集）
   - Pairwise 组合测试
2. **其余维度**（user/process/operation/security/performance/network/terminal/compatibility）
   - 提供该维度关注点的结构化引导（focus + guidance）
   - 由 LLM 结合需求补充具体用例，并标注层级（正常/边界/异常）

### V2.0：PICT集成 + 测试脚本生成 + 测试框架集成
1. **PICT集成**（pict-integration.js）
   - 2-wise、3-wise、4-wise覆盖
   - 性能优化（1142倍提升）
   - 批量处理

2. **测试脚本生成器**（test-script-generator.js）
   - Jest测试脚本生成
   - Pytest测试脚本生成
   - Playwright E2E测试脚本生成
   - API测试脚本生成

3. **测试框架集成**（test-framework-integration.js）
   - Jest测试执行
   - Pytest测试执行
   - Playwright测试执行
   - 测试报告生成

## 输入格式

### 数据维度输入
```javascript
const inputSpec = {
  username: {
    type: 'string',
    length: [3, 20],
    pattern: '^[a-zA-Z0-9_]+$'
  },
  age: {
    type: 'integer',
    range: [18, 120]
  }
};

// 九维调用示例：仅计算 data；或传入全部九维键获取各维度引导
const result = execute9DEM({ inputSpec, dimensions: ['data'] });
const resultAll = execute9DEM({ inputSpec, dimensions: ['user','data','process','operation','security','performance','network','terminal','compatibility'] });
```

### 设计方法输入（designInput，全部可选，按需提供）

```javascript
const designInput = {
  // M1 等价类 / M2 边界值 / M6 错误推测：字段规格（与 inputSpec 同结构，可不填，会自动复用）
  inputSpec: { username: { type: 'string', length: [3, 20] } },

  // M3 因果图 / M4 判定表
  causes: ['已登录', '余额充足'],
  effects: ['下单成功', '提示余额不足'],
  rules: [
    { id: 'R1', conditions: { C1: true, C2: true }, actions: { 下单成功: true } },
    { id: 'R2', conditions: { C1: true, C2: false }, actions: { 提示余额不足: true } },
  ],

  // M5 正交试验
  factors: { 平台: ['iOS', 'Android', 'Web'], 网络: ['4G', 'WiFi', '弱网'] },

  // M7 场景法
  scenarios: [
    { name: '正常下单', type: 'basic', steps: ['选商品', '提交订单', '支付'] },
    { name: '余额不足', type: 'exception', steps: ['选商品', '提交订单'] },
  ],

  // M8 状态迁移
  states: {
    states: ['待支付', '已支付', '已取消'],
    transitions: [
      { from: '待支付', to: '已支付', event: '支付成功' },
      { from: '待支付', to: '已取消', event: '取消' },
    ],
  },

  // M9 功能图
  functions: [
    { id: 'F1', name: '创建订单', preconditions: ['已登录'], postconditions: ['订单状态=待支付'], dependsOn: ['登录'] },
  ],
};

const result = invoke({
  inputSpec: { username: { type: 'string', length: [3, 20] } },
  methods: ['equivalence', 'boundary', 'scenario', 'stateTransition'], // 缺省=全部 9 种
  designInput,
  includeDesignCases: true, // 缺省 true
  dedupe: true,             // 缺省 true，跨方法去重
});
```

### 测试脚本生成输入
```javascript
const testData = {
  name: '用户登录测试',
  description: '测试用户登录功能的完整流程',
  testCases: [
    {
      id: 'TC-001',
      name: '正常登录',
      steps: [
        { action: 'navigate', target: '/login' },
        { action: 'fill', target: '#username', value: 'testuser' },
        { action: 'click', target: '#login-button' }
      ]
    }
  ]
};

const script = generateTestScript(testData, 'jest');
```

### 测试框架集成输入
```javascript
const config = {
  testPath: '/path/to/tests',
  framework: 'jest', // 可选，自动检测
  options: {
    coverage: true,
    verbose: true,
    timeout: 30000
  }
};

const results = await executeTests(config);
```

## 输出格式

### 数据维度输出（自动化计算）
```javascript
{
  data: {
    equivalenceClasses: [
      { name: '有效用户名', values: ['user123', 'test_user'], count: 2 },
      { name: '无效用户名', values: ['ab', 'verylongusername...'], count: 2 }
    ],
    boundaryValues: [
      { field: 'age', boundary: 18, type: 'min' },
      { field: 'age', boundary: 120, type: 'max' }
    ],
    pairwise: {
      total: 18,
      combinations: [...]
    }
  }
}
```

### 设计方法输出（design，V3.0 新增）
```javascript
{
  methods: [
    { method: 'equivalence', methodKey: 'M1', methodLabel: '等价类划分法', caseCount: 8, skipped: false },
    { method: 'causeEffect', methodKey: 'M3', methodLabel: '因果图法', caseCount: 0, skipped: true,
      reason: '缺少 causes / effects / rules', guidance: '把输入条件作为「原因」…' }
  ],
  cases: [
    {
      methodKey: 'M1', methods: ['等价类划分法'], methodLabel: '等价类划分法',
      dimensions: ['② 数据'], dimension: '② 数据', layer: '异常',
      name: '等价类-username-长度过短',
      precondition: '系统已部署且可访问对应功能',
      input: 'username=""', steps: '', expected: '拒绝并提示长度不足',
      priority: '中', trace: '无效等价类 len(username)<3',
      mergedCount: 2   // 若被多方法命中，合并计数
    }
  ],
  duplicates: [ { kept: '边界值-age-min(18)', mergedFrom: 'equivalence 等价类-age-范围内有效值' } ],
  stats: {
    requestedMethods: 9, methodsWithCases: 7, skippedMethods: ['M3', 'M4'],
    totalCasesBeforeDedupe: 90, uniqueCases: 88, duplicatesRemoved: 2,
    byMethod: { M1: 12, M2: 15, M3: 4 }, methodCoverage: 78,
    dimensionsCovered: ['② 数据', '③ 流程', '⑤ 安全']
  }
}
```

### 其余维度输出（结构化引导）
```javascript
{
  user: {
    dimension: 'user',
    label: '① 用户',
    focus: '登录态/角色/数据隔离/越权，正常-边界-异常三层',
    guidance: '按九维穷举模型，在该维度下运用等价类划分、边界值分析、状态迁移、场景法、错误推测等方法设计用例，并标注层级（正常/边界/异常）。'
  }
}
```

### 测试脚本输出
```javascript
{
  success: true,
  framework: 'jest',
  code: `describe('用户登录测试', () => {
  test('TC-001: 正常登录', async () => {
    await page.goto('/login');
    await page.fill('#username', 'testuser');
    await page.click('#login-button');
  });
});`
}
```

### 测试框架集成输出
```javascript
{
  success: true,
  framework: 'jest',
  results: {
    total: 10,
    passed: 8,
    failed: 2,
    skipped: 0,
    duration: 1234
  },
  coverage: {
    lines: 85.5,
    statements: 87.2,
    branches: 78.9,
    functions: 90.1
  },
  report: {
    html: '/path/to/coverage/report.html',
    json: '/path/to/coverage/coverage-final.json'
  }
}
```

## 使用示例

### 示例1：等价类划分
```javascript
const { generateEquivalenceClasses } = require('./backend/data-dimension');

const inputSpec = {
  username: {
    type: 'string',
    length: [3, 20],
    pattern: '^[a-zA-Z0-9_]+$'
  }
};

const result = generateEquivalenceClasses(inputSpec);
console.log(result);
// 输出：{ equivalenceClasses: [...], coverage: '100%' }
```

### 示例2：PICT集成
```javascript
const { generatePairwiseWithPict } = require('./backend/pict-integration');

const factors = {
  浏览器: ['Chrome', 'Firefox', 'Safari'],
  操作系统: ['Windows', 'macOS', 'Linux'],
  语言: ['中文', '英文']
};

const result = generatePairwiseWithPict(factors, { wise: 2 });
console.log(result);
// 输出：{ combinations: [...], count: 9, wise: 2 }
```

### 示例3：测试脚本生成
```javascript
const { generateTestScript } = require('./backend/test-script-generator');

const testData = {
  name: 'API测试',
  testCases: [
    { id: 'TC-001', name: '获取用户列表', steps: [...] }
  ]
};

const script = generateTestScript(testData, 'jest');
console.log(script.code);
```

### 示例4：测试框架集成
```javascript
const { executeTests } = require('./backend/test-framework-integration');

const config = {
  testPath: '/path/to/jest/project',
  framework: 'jest',
  options: { coverage: true }
};

const results = await executeTests(config);
console.log(results.coverage);
```

## API接口

### 后端API
- `POST /api/test-framework/execute` - 执行测试
- `GET /api/test-framework/detect` - 检测测试框架
- `GET /api/test-framework/check` - 检查测试框架是否已安装

### 前端组件
- `TestRunnerView.vue` - 测试运行界面（待开发）

## 文件结构

```
9dem-executor/
├── SKILL.md                    # 本文档
├── executor.js                 # 九维穷举主入口（execute9DEM）
├── backend/
│   ├── design-methods.js       # 黑盒 9 法确定性生成 + 跨方法去重（V3.0）
│   ├── data-dimension.js       # 数据维度（等价类/边界值/Pairwise 自动化计算）
│   ├── pict-integration.js     # PICT集成
│   ├── test-script-generator.js # 测试脚本生成器
│   └── test-framework-integration.js # 测试框架集成
├── examples/
└── test/
```

## 版本历史

### V3.0（2026-11-04）
- ✅ 新增黑盒 9 种设计方法确定性生成器（design-methods.js）：等价类/边界值/因果图/判定表/正交试验/错误推测/场景法/状态迁移/功能图
- ✅ 跨方法去重（输入+步骤+预期 归一化唯一键），同一条用例合并标注全部命中方法
- ✅ 9dem-invoker 新增 methods / designInput / includeDesignCases / dedupe 参数，返回 design.cases 可直接落表
- ✅ 方法按维度自动归类（数据/流程/安全/操作/兼容性），与 agent 输出的「维度覆盖矩阵」对齐
- ✅ 9dem-executor 成为 test-case-generator 的唯一强制工具，产出的用例必须带方法标注

### V2.1（2026-09-20）
- ✅ 五维穷举模型升级为九维穷举模型（9DEM）：用户/数据/流程/操作/安全/性能/网络环境/终端环境/兼容性
- ✅ execute9DEM 维度键扩展为九维，未实现的维度返回结构化方法论引导（不再静默丢弃）
- ✅ 9dem-invoker 动态返回所有请求维度的结果

### V2.0（2026-07-05）
- ✅ 集成PICT工具（性能提升1142倍）
- ✅ 实现测试脚本生成器（支持Jest/Pytest/Playwright/API测试）
- ✅ 实现测试框架集成（支持Jest/Pytest/Playwright执行）
- ✅ 添加后端API路由

### V1.0（2026-07-03）
- ✅ 实现数据维度（等价类、边界值、Pairwise）
- ✅ 实现流程维度（状态机、决策表）
- ✅ 实现环境维度（正交设计、资源约束）
- ✅ 实现时间维度（时序依赖、并发冲突）
- ✅ 实现依赖维度（服务依赖图、故障注入）

## 依赖工具

### 必需
- Node.js >= 18
- Python >= 3.8（用于Pytest）
- PICT >= 3.7（可选，用于Pairwise优化）

### 可选
- Jest - JavaScript测试框架
- Pytest - Python测试框架
- Playwright - E2E测试框架

## 单元测试

- 数据维度：10个测试用例，100%通过
- PICT集成：12个测试用例，100%通过
- 测试脚本生成器：20个测试用例，100%通过
- 测试框架集成：20个测试用例，100%通过

**总计**：62个测试用例，100%通过率

## 最佳实践

1. **数据维度**：优先使用等价类划分，边界值补充极端情况
2. **PICT集成**：大规模组合（>5因子）使用PICT，小规模使用贪心算法
3. **测试脚本生成**：先验证测试数据格式，再生成脚本
4. **测试框架集成**：确保测试框架已安装，配置正确

## 注意事项

1. PICT工具需单独安装（Windows/Linux/macOS）
2. 测试框架需在目标项目中安装
3. 覆盖率报告路径可能因配置不同而变化
4. 超时时间需根据测试复杂度调整

## 更新日志

### 2026-09-20
- 五维穷举模型升级为九维穷举模型（9DEM）
- execute9DEM 维度键扩展，未实现维度返回结构化引导

### 2026-07-05
- 完成M3里程碑：测试框架集成
- 完成M2里程碑：测试脚本生成器
- 完成M1里程碑：PICT工具集成

### 2026-07-03
- 完成V1.0五维穷举模型
