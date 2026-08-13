---
name: quality-self-checker
description: 测试脚本质量自检Skill。对生成的测试脚本进行覆盖率、可维护性、边界条件等多维度质量检查，给出改进建议。
version: 1.0.0
---

# 测试脚本质量自检（Quality Self-Checker）

## 角色定位

脚本质量评审专家。在测试脚本生成后，自动进行多维度质量检查，确保脚本符合规范、可维护、可执行，并给出具体改进建议。

## 核心能力

### 一、质量检查维度

#### 1. 覆盖率检查
- **代码覆盖率**：函数/分支/语句覆盖
- **场景覆盖率**：正向/反向/边界/异常场景
- **数据覆盖率**：有效等价类/无效等价类/边界值

#### 2. 可维护性检查
- 元素定位器稳定性（优先 data-testid > aria-label > role）
- 页面对象模型（Page Object）模式使用
- 重复代码检测（重复片段建议抽取公共方法）
- 硬编码值检测（超时/URL/凭证/测试数据）

#### 3. 断言质量检查
- 断言粒度（避免过度断言/断言不足）
- 断言消息可读性
- 异常断言 vs 软断言使用场景
- 动态内容等待策略（显式等待 vs 固定 sleep）

#### 4. 边界条件检查
- 空值/Null/undefined 输入
- 超长字符串/超界数值
- 特殊字符（SQL注入/XSS/emoji）
- 并发/竞态条件场景

#### 5. 安全与最佳实践
- 凭证/密钥硬编码检测
- 敏感数据泄露检查（phone/email/ID/card）
- 异步操作完整性（await/async 配对）
- 测试隔离性（用例间无依赖）

### 二、质量评分

```
质量分 = 覆盖率分 × 0.3 + 可维护性分 × 0.25 + 断言分 × 0.2 + 边界分 × 0.15 + 安全分 × 0.1
```

评分标准：
- **A (90-100)**：优秀，可直接使用
- **B (75-89)**：良好，小问题可忽略
- **C (60-74)**：一般，建议修复后使用
- **D (40-59)**：较差，必须修复关键问题
- **E (<40)**：不合格，建议重写

### 三、输出格式

```json
{
  "qualityGrade": "B",
  "qualityScore": 82,
  "dimensions": {
    "coverage": { "score": 88, "issues": [] },
    "maintainability": { "score": 79, "issues": ["硬编码超时值: sleep(5000)", "重复选择器: .btn-submit"] },
    "assertion": { "score": 85, "issues": [] },
    "boundary": { "score": 75, "issues": ["缺少空值测试用例"] },
    "security": { "score": 95, "issues": [] }
  },
  "summary": "脚本整体质量良好，主要改进点：统一超时策略、增加空值边界用例。",
  "suggestions": [
    "将 sleep(5000) 替换为 waitForSelector() 显式等待",
    "抽取 .btn-submit 到 PageObject 的 submitButton() 方法"
  ],
  "actionItems": [
    { "priority": "high", "issue": "缺少空值边界用例", "fix": "添加 test('should handle null input')" },
    { "priority": "medium", "issue": "超时值硬编码", "fix": "提取为 config.TIMEOUT 常量" }
  ]
}
```

### 四、使用场景

1. **脚本生成后自动触发**：test-script-generator 生成脚本后自动调用自检
2. **CI/CD 前置检查**：将质量分低于 60 的脚本标记为不可发布
3. **代码审查辅助**：人工 review 前先运行自检减少工作量
4. **回归对比**：与历史版本质量分对比，监控脚本退化

### 五、集成方式

Skill 提供 `checkScriptQuality(code, framework, options)` 函数：

```javascript
import { checkScriptQuality } from './backend/script-quality-checker.js'

const result = await checkScriptQuality({
  code: testScriptString,
  framework: 'playwright',  // playwright | jest | pytest | postman
  options: {
    minQualityScore: 60,
    checkSecurity: true,
    checkBoundary: true
  }
})
```

## 触发规则

当执行以下任务时，必须调用本 Skill：
- 脚本生成完成后
- 脚本修改后（人工或自动）
- CI/CD 流水线中
- 人工要求质量评审时
