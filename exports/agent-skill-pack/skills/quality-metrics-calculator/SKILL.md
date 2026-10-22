---
name: quality-metrics-calculator
description: 质量度量计算器。计算测试覆盖率、缺陷密度、测试效率等质量指标，生成综合质量评分。V1.0实现代码覆盖率、需求覆盖率、测试用例覆盖率、缺陷密度、测试效率、综合质量评分。
---

# 质量度量计算器（Quality Metrics Calculator）

## 角色定位

质量度量专家，基于测试过程和产品质量数据，计算各类质量指标并生成综合质量评分。

## 核心功能

### V1.0（当前版本）：质量度量计算
1. **代码覆盖率计算**（codeCoverage）
   - 行覆盖率（lineCoverage）
   - 分支覆盖率（branchCoverage）
   - 函数覆盖率（functionCoverage）
   - 语句覆盖率（statementCoverage）
   - 综合覆盖率（overall）

2. **需求覆盖率计算**（requirementCoverage）
   - 总需求数（totalRequirements）
   - 已覆盖需求数（coveredRequirements）
   - 覆盖率（coverageRate）
   - 未覆盖需求列表（uncoveredRequirements）
   - 详细覆盖情况（details）

3. **测试用例覆盖率计算**（testCaseCoverage）
   - 总测试用例数（totalTestCases）
   - 已执行测试用例数（executedTestCases）
   - 通过测试用例数（passedTestCases）
   - 失败测试用例数（failedTestCases）
   - 执行率（executionRate）
   - 通过率（passRate）
   - 按优先级覆盖率（coverageByPriority）
   - 按模块覆盖率（coverageByModule）

4. **缺陷密度计算**（defectDensity）
   - 总缺陷数（totalDefects）
   - 千行代码缺陷数（defectsPerKLOC）
   - 按严重程度分布（defectsBySeverity）
   - 按模块分布（defectsByModule）
   - 缺陷去除率（defectRemovalRate）
   - 缺陷泄漏率（defectLeakageRate）

5. **测试效率计算**（testEfficiency）
   - 每小时执行测试用例数（testCasesPerHour）
   - 每小时发现缺陷数（defectsFoundPerHour）
   - 测试执行总时间（testExecutionTime）
   - 缺陷发现率（defectDetectionRate）
   - 测试自动化率（testAutomationRate）

6. **综合质量评分**（qualityScore）
   - 综合评分（score，0-100分）
   - 质量等级（grade，A+/A/B/C/D/F）
   - 各维度评分（dimensions）
   - 改进建议（recommendations）

## 输入格式

### 代码覆盖率输入（coverageData）

```javascript
const coverageData = {
  lines: { covered: 850, total: 1000 },
  branches: { covered: 120, total: 150 },
  functions: { covered: 45, total: 50 },
  statements: { covered: 820, total: 980 }
};
```

### 需求覆盖率输入（requirementData）

```javascript
const requirementData = {
  requirements: [
    { 
      id: 'REQ-001', 
      name: '用户登录', 
      isCovered: true, 
      testCases: ['TC-001', 'TC-002'], 
      coverageSource: 'test_case' 
    },
    { 
      id: 'REQ-002', 
      name: '用户注册', 
      isCovered: false, 
      testCases: [], 
      coverageSource: 'none' 
    }
  ]
};
```

### 测试用例覆盖率输入（testCaseData）

```javascript
const testCaseData = {
  testCases: [
    { 
      id: 'TC-001', 
      priority: 'high', 
      module: 'auth', 
      status: 'passed' 
    },
    { 
      id: 'TC-002', 
      priority: 'medium', 
      module: 'auth', 
      status: 'failed' 
    },
    { 
      id: 'TC-003', 
      priority: 'low', 
      module: 'payment', 
      status: 'not_executed' 
    }
  ]
};
```

### 缺陷密度输入（defectData）

```javascript
const defectData = {
  defects: [
    { id: 'DEF-001', severity: 'critical', module: 'auth' },
    { id: 'DEF-002', severity: 'major', module: 'payment' }
  ],
  codeLines: 50000,  // 5万行代码
  preReleaseDefects: 4,
  postReleaseDefects: 1
};
```

### 测试效率输入（efficiencyData）

```javascript
const efficiencyData = {
  testCasesExecuted: 850,
  testExecutionHours: 120,
  defectsFound: 45,
  totalDefects: 50,
  automatedTestCases: 600,
  totalTestCases: 1000
};
```

### 综合质量评分输入（qualityData）

```javascript
const qualityData = {
  codeCoverage: {
    lineCoverage: '85.00%',
    branchCoverage: '80.00%',
    functionCoverage: '90.00%'
  },
  requirementCoverage: {
    coverageRate: '80.00%'
  },
  testCaseCoverage: {
    executionRate: '95.00%',
    passRate: '88.00%'
  },
  defectDensity: {
    defectsPerKLOC: '2.50'
  },
  testEfficiency: {
    testAutomationRate: '70.00%'
  },
  codeQuality: {
    maintainabilityIndex: 75
  }
};
```

## 输出格式

### 代码覆盖率输出

```javascript
const result = {
  lineCoverage: '85.00%',
  branchCoverage: '80.00%',
  functionCoverage: '90.00%',
  statementCoverage: '83.67%',
  overall: '84.67%'
};
```

### 需求覆盖率输出

```javascript
const result = {
  totalRequirements: 5,
  coveredRequirements: 3,
  coverageRate: '60.00%',
  uncoveredRequirements: ['REQ-003', 'REQ-005'],
  details: [
    { 
      id: 'REQ-001', 
      name: '用户登录', 
      isCovered: true, 
      testCases: ['TC-001', 'TC-002'], 
      coverageSource: 'test_case' 
    }
  ]
};
```

### 综合质量评分输出

```javascript
const result = {
  score: 81.37,
  grade: 'B',
  dimensions: {
    codeCoverage: { score: 85.00, weight: 0.25, weightedScore: 21.25 },
    requirementCoverage: { score: 80.00, weight: 0.2, weightedScore: 16.00 }
  },
  recommendations: [
    { 
      dimension: 'testEfficiency', 
      issue: '评分一般（70.00分）', 
      suggestion: '建议优化testEfficiency维度' 
    }
  ]
};
```

## 使用方法

### 通过Node.js调用

```javascript
const { executeQualityMetrics } = require('./backend/quality-metrics.js');

// 执行代码覆盖率计算
const result1 = await executeQualityMetrics({
  coverageData: coverageData,
  metrics: 'codeCoverage'
});

// 执行需求覆盖率计算
const result2 = await executeQualityMetrics({
  requirementData: requirementData,
  metrics: 'requirementCoverage'
});

// 执行全部质量度量计算
const result3 = await executeQualityMetrics({
  coverageData: coverageData,
  requirementData: requirementData,
  testCaseData: testCaseData,
  defectData: defectData,
  efficiencyData: efficiencyData,
  qualityData: qualityData,
  metrics: 'all'
});

console.log(result1, result2, result3);
```

### 通过命令行调用

```bash
# 运行所有示例
node examples/usage.js
```

## 工作流程

### 自动模式（默认）
接收到质量度量请求后，自动执行：
1. 解析输入数据（coverageData、requirementData等）
2. 调用相应的质量度量计算函数
3. 生成质量度量报告
4. 输出结构化质量度量文档

### 交互模式（可选）
如果用户要求交互式配置，则询问关键参数。

## 约束

- 输入的coverageData、requirementData等必须为非空对象
- 代码覆盖率计算时，total必须大于0
- 需求覆盖率计算时，requirements必须为数组
- 综合质量评分计算时，权重总和可以不为1（会自动归一化）
- 质量等级根据综合评分确定：A+（≥90）、A（≥85）、B（≥75）、C（≥60）、D（≥40）、F（<40）

## 工具集成

- **内置算法**：代码覆盖率计算、需求覆盖率计算、缺陷密度计算、测试效率计算、综合质量评分模型
- **扩展工具**（V2.0）：集成JaCoCo（Java代码覆盖率）、Istanbul（JavaScript代码覆盖率）、SonarQube（代码质量）

## 审核标准

输出后由 ai-quality-reviewer 审核：
- 计算准确性（40%）：各项指标计算是否正确
- 数据完整性（30%）：是否包含所有相关指标
- 格式规范（30%）：输出格式是否清晰

总分 ≥ 70 分且无一票否决，方可交付。

## 示例

参见 `examples/usage.js` 查看完整使用示例。

**运行示例：**

```bash
cd ~/.qclaw/skills/quality-metrics-calculator
node examples/usage.js
```

**示例输出：**

```
=== 示例1：计算代码覆盖率 ===

输出：代码覆盖率指标
  - 行覆盖率：85.00%
  - 分支覆盖率：80.00%
  - 函数覆盖率：90.00%
  - 综合覆盖率：84.67%

=== 示例5：计算综合质量评分 ===

输出：综合质量评分
  - 综合评分：81.37分
  - 质量等级：B
  - 各维度评分：
    - codeCoverage: 85.00分（权重0.25，加权21.25）
    - requirementCoverage: 80.00分（权重0.2，加权16.00）
  - 改进建议：
    1. testEfficiency维度：评分一般（70.00分），建议优化testEfficiency维度
```

## 版本历史

- V1.0（2026-07-03）：实现质量度量计算（代码覆盖率、需求覆盖率、测试用例覆盖率、缺陷密度、测试效率、综合质量评分）

## 文件结构

```
~/.qclaw/skills/quality-metrics-calculator/
├── SKILL.md                           # Skill描述和使用说明（本文件）
├── README.md                          # 项目说明
├── backend/
│   └── quality-metrics.js            # 质量度量计算器实现（V1.0）
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

# 测试代码覆盖率计算
node -e "const m = require('./backend/quality-metrics.js'); console.log(m.calculateCodeCoverage({lines:{covered:85,total:100}}))"
```

### 集成测试

```bash
# 测试与ai-quality-reviewer的集成
# （待实现）
```

## 已知限制

1. **代码覆盖率**：当前仅支持手动输入覆盖率数据，不支持自动采集
   - 解决方案：集成JaCoCo、Istanbul等覆盖率采集工具（V2.0）

2. **需求覆盖率**：当前仅支持简单的覆盖/未覆盖标记，不支持部分覆盖
   - 解决方案：扩展覆盖模型支持部分覆盖（V2.0）

3. **缺陷密度**：当前仅支持简单的缺陷计数，不支持缺陷权重
   - 解决方案：引入缺陷权重模型（V2.0）

4. **综合质量评分**：当前使用固定权重，不支持自定义权重
   - 解决方案：支持用户自定义权重配置（V2.0）

## 后续计划

### V1.0（2026-07-20前）
- ✅ 实现质量度量计算（代码覆盖率、需求覆盖率、测试用例覆盖率、缺陷密度、测试效率、综合质量评分）
- ⏳ 编写完整单元测试（test.js）
- ⏳ 集成到ai-quality-reviewer
- ⏳ 编写用户手册

### V2.0（2026-08-01前）
- ⏳ 集成JaCoCo、Istanbul等覆盖率采集工具
- ⏳ 扩展覆盖模型支持部分覆盖
- ⏳ 引入缺陷权重模型
- ⏳ 支持用户自定义权重配置
- ⏳ 编写完整文档

## 联系人

- 开发者：测试中台项目组
- 审核者：ai-quality-reviewer
- 用户：test-case-generator、api-executor、ui-e2e-executor智能体
