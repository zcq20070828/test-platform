/**
 * 边界值测试
 * 测试目标: 验证最大值、最小值、精度临界值的表现
 */
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('边界值测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.allClear();
  });
  
  // ==================== 最大值边界 ====================
  
  test.describe('最大值边界', () => {
    
    test('TC-BV-001: 最大支持数值加法溢出', async () => {
      // 假设计算器最大支持9位整数: 999999999
      await calculator.inputExpression('999999999+1=');
      const result = await calculator.getDisplayValue();
      
      // 应显示溢出提示或科学计数法
      expect(
        /error|overflow|1e\+9|1\.0e\+9|1000000000/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-BV-002: 最大值减1运算', async () => {
      await calculator.inputExpression('999999999-1=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('999999998');
    });
    
    test('TC-BV-003: 最大值乘法溢出', async () => {
      await calculator.inputExpression('999999999×2=');
      const result = await calculator.getDisplayValue();
      
      // 应显示溢出提示或科学计数法
      expect(
        /error|overflow|\d+e\+\d+/i.test(result)
      ).toBeTruthy();
    });
    
  });
  
  // ==================== 最小值边界 ====================
  
  test.describe('最小值边界', () => {
    
    test('TC-BV-004: 最小负数运算溢出', async () => {
      // 假设计算器最小支持-999999999
      await calculator.inputNumber(-999999999);
      await calculator.clickOperator('-');
      await calculator.inputNumber(1);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      // 应显示溢出提示或科学计数法
      expect(
        /error|overflow|-1e\+9/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-BV-005: 最小值加1运算', async () => {
      await calculator.inputNumber(-999999999);
      await calculator.clickOperator('+');
      await calculator.inputNumber(1);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-999999998');
    });
    
  });
  
  // ==================== 精度边界 ====================
  
  test.describe('精度边界', () => {
    
    test('TC-BV-006: 小数精度上限', async () => {
      await calculator.inputExpression('1.123456789+0.000000001=');
      const result = await calculator.getDisplayValue();
      
      // 验证精度处理,允许四舍五入
      expect(result.trim()).toMatch(/1\.12345679\d*/);
    });
    
    test('TC-BV-007: 小数精度下限', async () => {
      await calculator.inputExpression('0.00000001×100000000=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('1');
    });
    
    test('TC-BV-008: 非常小的小数运算', async () => {
      await calculator.inputExpression('0.0000000001+0.0000000001=');
      const result = await calculator.getDisplayValue();
      
      // 可能显示科学计数法或极小数
      expect(
        /2e-10|0\.0000000002/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-BV-009: 浮点精度问题 - 0.1 + 0.2 = 0.3', async () => {
      await calculator.inputExpression('0.1+0.2=');
      const result = await calculator.getDisplayValue();
      
      // 这是最经典的浮点精度测试
      // 错误结果: 0.30000000000000004
      // 正确结果: 0.3
      expect(result.trim()).toBe('0.3');
    });
    
  });
  
  // ==================== 显示位数边界 ====================
  
  test.describe('显示位数边界', () => {
    
    test('TC-BV-010: 最大显示位数', async () => {
      // 输入最大显示位数(如10位)
      await calculator.inputNumber(1234567890);
      const result = await calculator.getDisplayValue();
      
      // 应完整显示
      expect(result.trim()).toBe('1234567890');
    });
    
    test('TC-BV-011: 超出显示位数', async () => {
      // 输入超出显示位数的数值
      await calculator.inputNumber(123456789012);
      const result = await calculator.getDisplayValue();
      
      // 应显示科学计数法或滚动显示
      expect(
        /1\.23e\+11|123456789012/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-BV-012: 小数位数截断 - 1 ÷ 3', async () => {
      await calculator.inputExpression('1÷3=');
      const result = await calculator.getDisplayValue();
      
      // 无限循环小数,应按精度规则截断
      expect(result.trim()).toMatch(/0\.33{2,}/);
    });
    
    test('TC-BV-013: 显示位数加法', async () => {
      await calculator.inputExpression('999999999+999999999=');
      const result = await calculator.getDisplayValue();
      
      // 结果超出显示位数
      expect(
        /error|overflow|1\.999999998e\+9|1999999998/i.test(result)
      ).toBeTruthy();
    });
    
  });
  
  // ==================== 极值运算 ====================
  
  test.describe('极值运算', () => {
    
    test('TC-BV-014: 大数乘法', async () => {
      await calculator.inputExpression('99999999×99999999=');
      const result = await calculator.getDisplayValue();
      
      // 结果应正确或显示科学计数法
      const resultNum = parseFloat(result.replace(/,/g, ''));
      expect(resultNum).toBeGreaterThan(9.9e15);
    });
    
    test('TC-BV-015: 大数除小数', async () => {
      await calculator.inputExpression('999999999÷0.0001=');
      const result = await calculator.getDisplayValue();
      
      // 结果应为大数
      expect(
        /error|overflow|\d+e\+\d+|9999999990000/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-BV-016: 小数除大数', async () => {
      await calculator.inputExpression('0.0001÷999999999=');
      const result = await calculator.getDisplayValue();
      
      // 结果应为极小数
      expect(
        /1e-13|0\.0000000000001/i.test(result)
      ).toBeTruthy();
    });
    
  });
  
});
