# 计算器UI自动化测试套件

基于 Playwright 的计算器功能自动化测试,涵盖等价类划分、边界值、优先级、操作功能和异常场景测试。

## 📋 测试范围

- ✅ **等价类划分测试** (25个用例)
  - 整数运算
  - 小数运算
  - 负数运算
  - 零的特殊场景

- ✅ **边界值测试** (16个用例)
  - 最大值边界
  - 最小值边界
  - 精度边界
  - 显示位数边界

- ✅ **优先级测试** (24个用例)
  - 无括号基础运算
  - 单层括号
  - 多层嵌套括号
  - 混合优先级

- ✅ **操作功能测试** (27个用例)
  - 正负切换(±)
  - 清除功能(C/AC)
  - 退格功能(⌫/DEL)
  - 组合操作

- ✅ **异常场景测试** (31个用例)
  - 除零错误
  - 溢出错误
  - 非法输入
  - 其他异常

**总计**: 123个测试用例

## 🚀 快速开始

### 1. 安装依赖

```bash
cd calculator-ui-tests
npm install
```

### 2. 安装浏览器

```bash
npx playwright install
```

### 3. 运行测试

```bash
# 运行所有测试
npm test

# 运行特定类型的测试
npm run test:equivalence  # 等价类测试
npm run test:boundary     # 边界值测试
npm run test:priority     # 优先级测试
npm run test:operations   # 操作功能测试
npm run test:exceptions   # 异常场景测试

# 以可视化模式运行
npm run test:ui

# 以调试模式运行
npm run test:debug

# 以浏览器可见模式运行
npm run test:headed

# 查看测试报告
npm run test:report
```

## 📁 项目结构

```
calculator-ui-tests/
├── playwright.config.js       # Playwright配置文件
├── package.json               # 项目依赖配置
├── pages/
│   └── CalculatorPage.js      # 计算器页面对象模型(POM)
├── tests/
│   ├── equivalence-class.spec.js  # 等价类划分测试
│   ├── boundary-value.spec.js     # 边界值测试
│   ├── priority.spec.js           # 优先级测试
│   ├── operations.spec.js         # 操作功能测试
│   └── exceptions.spec.js         # 异常场景测试
└── playwright-report/         # 测试报告目录(自动生成)
```

## ⚙️ 配置说明

### 修改测试目标URL

编辑 `playwright.config.js`:

```javascript
use: {
  baseURL: 'http://localhost:3000',  // 修改为你的计算器应用地址
}
```

或使用环境变量:

```bash
BASE_URL=https://your-calculator-app.com npm test
```

### 修改元素定位器

如果你的计算器应用使用不同的选择器,请修改 `pages/CalculatorPage.js`:

```javascript
// 示例:修改数字按钮定位器
this.digitButtons = {
  '0': page.locator('#btn-0'),  // 修改为实际的选择器
  '1': page.locator('#btn-1'),
  // ...
};
```

### 支持的浏览器

默认配置支持:
- Chromium (Chrome/Edge)
- Firefox
- WebKit (Safari)
- 移动端 Chrome (Pixel 5)
- 移动端 Safari (iPhone 12)

## 🔧 测试用例映射

### 等价类测试 (tests/equivalence-class.spec.js)

| 用例范围 | 测试内容 | 用例数量 |
|---------|---------|---------|
| TC-EQ-001 ~ TC-EQ-007 | 整数运算 | 7 |
| TC-EQ-008 ~ TC-EQ-014 | 小数运算 | 7 |
| TC-EQ-015 ~ TC-EQ-022 | 负数运算 | 8 |
| TC-EQ-023 ~ TC-EQ-025 | 零的特殊场景 | 3 |

### 边界值测试 (tests/boundary-value.spec.js)

| 用例范围 | 测试内容 | 用例数量 |
|---------|---------|---------|
| TC-BV-001 ~ TC-BV-003 | 最大值边界 | 3 |
| TC-BV-004 ~ TC-BV-005 | 最小值边界 | 2 |
| TC-BV-006 ~ TC-BV-009 | 精度边界 | 4 |
| TC-BV-010 ~ TC-BV-013 | 显示位数边界 | 4 |
| TC-BV-014 ~ TC-BV-016 | 极值运算 | 3 |

### 优先级测试 (tests/priority.spec.js)

| 用例范围 | 测试内容 | 用例数量 |
|---------|---------|---------|
| TC-PR-001 ~ TC-PR-004a | 无括号基础运算 | 5 |
| TC-PR-005 ~ TC-PR-010 | 单层括号 | 6 |
| TC-PR-011 ~ TC-PR-015 | 多层嵌套括号 | 5 |
| TC-PR-016 ~ TC-PR-024 | 混合优先级 | 8 |

### 操作功能测试 (tests/operations.spec.js)

| 用例范围 | 测试内容 | 用例数量 |
|---------|---------|---------|
| TC-OP-001 ~ TC-OP-007a | 正负切换 | 8 |
| TC-OP-008 ~ TC-OP-013 | 清除功能 | 6 |
| TC-OP-013 ~ TC-OP-022 | 退格功能 | 10 |
| TC-OP-023 ~ TC-OP-027 | 组合操作 | 5 |

### 异常场景测试 (tests/exceptions.spec.js)

| 用例范围 | 测试内容 | 用例数量 |
|---------|---------|---------|
| TC-EX-001 ~ TC-EX-007 | 除零错误 | 7 |
| TC-EX-007 ~ TC-EX-010 | 溢出错误 | 4 |
| TC-EX-012 ~ TC-EX-021 | 非法输入 | 10 |
| TC-EX-022 ~ TC-EX-031 | 其他异常 | 10 |

## 📊 测试报告

测试完成后,HTML报告自动生成在 `playwright-report/` 目录:

```bash
# 查看报告
npm run test:report
```

报告内容包括:
- 测试执行统计
- 通过/失败详情
- 失败截图
- 执行视频回放
- 执行trace

## 🎯 最佳实践

### 1. 元素定位策略

优先使用 `data-testid` 属性:

```html
<!-- 推荐的HTML结构 -->
<button data-testid="digit-5">5</button>
<button data-testid="operator-plus">+</button>
<div data-testid="calculator-display">0</div>
```

### 2. 测试数据管理

测试数据直接在测试用例中定义,便于理解和维护:

```javascript
test('加法运算 - 123 + 456 = 579', async () => {
  await calculator.inputExpression('123+456=');
  expect(await calculator.getDisplayValue()).toBe('579');
});
```

### 3. 等待策略

Playwright自动等待元素可见和可操作,无需手动添加等待:

```javascript
// ❌ 不推荐
await page.waitForTimeout(1000);
await calculator.clickDigit('5');

// ✅ 推荐
await calculator.clickDigit('5');  // Playwright自动等待
```

### 4. 断言优化

使用精确断言,避免模糊匹配:

```javascript
// ❌ 不推荐
expect(result).toBeTruthy();

// ✅ 推荐
expect(result.trim()).toBe('579');
```

## 🐛 调试技巧

### 1. 调试模式

```bash
# 打开Playwright Inspector
npm run test:debug
```

### 2. 可视化模式

```bash
# 使用UI模式查看测试执行
npm run test:ui
```

### 3. 查看失败详情

```bash
# 以headed模式运行,查看浏览器行为
npm run test:headed
```

### 4. Trace查看

失败时自动生成trace,可在报告中查看:

```bash
npx playwright show-trace trace.zip
```

## 📝 扩展测试

### 添加新的测试用例

1. 在对应的测试文件中添加test块:

```javascript
test('TC-XXX-XXX: 测试标题', async () => {
  await calculator.inputExpression('1+1=');
  expect(await calculator.getDisplayValue()).toBe('2');
});
```

### 添加新的测试类型

1. 创建新的测试文件: `tests/new-test-type.spec.js`
2. 在 `package.json` 中添加快捷命令:

```json
{
  "scripts": {
    "test:new": "playwright test tests/new-test-type.spec.js"
  }
}
```

## 🔗 相关文档

- [测试用例文档](../calculator_test_cases_20250701.md)
- [Playwright官方文档](https://playwright.dev/)
- [Page Object Model模式](https://playwright.dev/docs/pom)

## 📧 问题反馈

如有问题或建议,请联系测试团队。

---

**最后更新**: 2025-07-01  
**维护人**: 测试团队
