# 🚀 快速启动指南

## 📦 生成的文件

### 1️⃣ 测试用例文档
- **文件**: `calculator_test_cases_20250701.md` (39KB)
- **内容**: 100个详细测试用例,涵盖等价类、边界值、优先级、操作和异常场景

### 2️⃣ UI自动化测试套件
- **目录**: `calculator-ui-tests/`
- **脚本**: 123个Playwright自动化测试用例
- **框架**: Page Object Model设计模式

### 3️⃣ 总结文档
- **文件**: `calculator_test_summary_20250701.md`
- **内容**: 测试生成总结、统计和建议

## ⚡ 快速开始 (3步)

### 第1步: 安装依赖
```bash
cd calculator-ui-tests
npm install
npx playwright install
```

### 第2步: 启动示例应用
```bash
# 在浏览器中打开示例计算器
open sample-calculator.html
# 或
python3 -m http.server 8080
# 然后访问 http://localhost:8080/sample-calculator.html
```

### 第3步: 运行测试
```bash
# 方式1: 直接运行
npm test

# 方式2: 使用交互式脚本
./run-tests.sh

# 方式3: 运行特定测试
npm run test:equivalence  # 等价类测试
npm run test:boundary     # 边界值测试
npm run test:priority     # 优先级测试
npm run test:operations   # 操作功能测试
npm run test:exceptions   # 异常场景测试
```

## 📊 测试覆盖

| 测试类型 | 用例数 | 文件 |
|---------|-------|------|
| 等价类划分 | 25 | `equivalence-class.spec.js` |
| 边界值测试 | 16 | `boundary-value.spec.js` |
| 优先级测试 | 24 | `priority.spec.js` |
| 操作功能 | 27 | `operations.spec.js` |
| 异常场景 | 31 | `exceptions.spec.js` |
| **总计** | **123** | - |

## 🎯 核心特性

✅ **完整的测试覆盖** - 100个手工用例 + 123个自动化用例  
✅ **标准化文档** - 符合测试用例编写规范  
✅ **可维护性强** - Page Object Model设计模式  
✅ **多浏览器支持** - Chrome/Firefox/Safari/移动端  
✅ **详细报告** - HTML报告+截图+视频回放  
✅ **示例应用** - 提供可测试的HTML计算器  
✅ **交互式脚本** - 友好的命令行界面  

## 🔧 定制化

### 修改测试目标URL
编辑 `playwright.config.js`:
```javascript
baseURL: 'http://your-app-url.com'
```

### 修改元素定位器
编辑 `pages/CalculatorPage.js`:
```javascript
this.digitButtons = {
  '0': page.locator('[data-testid="digit-0"]'),
};
```

## 📖 文档导航

- 📄 [测试用例文档](calculator_test_cases_20250701.md) - 完整的测试用例
- 📄 [测试总结](calculator_test_summary_20250701.md) - 生成总结和建议
- 📄 [README](calculator-ui-tests/README.md) - 详细使用说明

## 💡 提示

1. **首次运行**: 需要安装依赖和浏览器
2. **调试模式**: 使用 `npm run test:ui` 可视化调试
3. **测试报告**: 运行后执行 `npm run test:report` 查看报告
4. **单步调试**: 使用 `npm run test:debug` 打开Playwright Inspector

## 🎓 测试方法

本次测试基于以下方法论:
- **等价类划分法** - 减少测试用例数量,保证覆盖率
- **边界值分析法** - 发现边界附近的缺陷
- **场景分析法** - 基于用户真实使用场景
- **错误推测法** - 预测可能的缺陷

## 📞 需要帮助?

查看详细文档:
- `calculator-ui-tests/README.md` - 使用说明
- `calculator_test_cases_20250701.md` - 测试用例详情
- `calculator_test_summary_20250701.md` - 测试总结

---

**生成日期**: 2025-07-01  
**工具**: OpenClaw + Playwright
