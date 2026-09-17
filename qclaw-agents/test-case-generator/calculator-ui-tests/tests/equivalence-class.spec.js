/**
 * 等价类划分测试
 * 测试目标: 验证整数、小数、负数、零的各种运算组合
 */
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('等价类划分测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    // 访问计算器页面
    await page.goto('/');
    calculator = new CalculatorPage(page);
    // 确保初始状态为空
    await calculator.allClear();
  });
  
  // ==================== 整数运算 ====================
  
  test.describe('整数运算', () => {
    
    test('TC-EQ-001: 正整数加法 - 123 + 456 = 579', async () => {
      await calculator.inputExpression('123+456=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('579');
    });
    
    test('TC-EQ-002: 正整数减法 - 999 - 123 = 876', async () => {
      await calculator.inputExpression('999-123=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('876');
    });
    
    test('TC-EQ-003: 正整数乘法 - 12 × 34 = 408', async () => {
      await calculator.inputExpression('12×34=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('408');
    });
    
    test('TC-EQ-004: 正整数除法(整除) - 100 ÷ 5 = 20', async () => {
      await calculator.inputExpression('100÷5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('20');
    });
    
    test('TC-EQ-005: 正整数除法(非整除) - 10 ÷ 3 ≈ 3.33', async () => {
      await calculator.inputExpression('10÷3=');
      const result = await calculator.getDisplayValue();
      // 允许精度差异
      expect(result.trim()).toMatch(/3\.33{1,}/);
    });
    
    test('TC-EQ-006: 零的加法 - 0 + 123 = 123', async () => {
      await calculator.inputExpression('0+123=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('123');
    });
    
    test('TC-EQ-007: 零的乘法 - 999 × 0 = 0', async () => {
      await calculator.inputExpression('999×0=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
  });
  
  // ==================== 小数运算 ====================
  
  test.describe('小数运算', () => {
    
    test('TC-EQ-008: 小数加法 - 1.5 + 2.3 = 3.8', async () => {
      await calculator.inputExpression('1.5+2.3=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3.8');
    });
    
    test('TC-EQ-009: 小数减法 - 5.5 - 2.2 = 3.3', async () => {
      await calculator.inputExpression('5.5-2.2=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3.3');
    });
    
    test('TC-EQ-010: 小数乘法 - 2.5 × 4 = 10', async () => {
      await calculator.inputExpression('2.5×4=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('10');
    });
    
    test('TC-EQ-011: 小数除法 - 7.5 ÷ 2.5 = 3', async () => {
      await calculator.inputExpression('7.5÷2.5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3');
    });
    
    test('TC-EQ-012: 纯小数运算 - 0.1 + 0.2 = 0.3 (验证精度处理)', async () => {
      await calculator.inputExpression('0.1+0.2=');
      const result = await calculator.getDisplayValue();
      // 期望正确处理浮点精度,显示0.3而非0.30000000000000004
      expect(result.trim()).toBe('0.3');
    });
    
    test('TC-EQ-013: 多位小数运算 - 1.234 + 5.678 = 6.912', async () => {
      await calculator.inputExpression('1.234+5.678=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('6.912');
    });
    
    test('TC-EQ-014: 小数点后连续零 - 1.001 × 1000 = 1001', async () => {
      await calculator.inputExpression('1.001×1000=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('1001');
    });
    
  });
  
  // ==================== 负数运算 ====================
  
  test.describe('负数运算', () => {
    
    test('TC-EQ-015: 负数加正数 - -5 + 10 = 5', async () => {
      await calculator.inputNumber(-5);
      await calculator.clickOperator('+');
      await calculator.inputNumber(10);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('5');
    });
    
    test('TC-EQ-016: 负数加负数 - -3 + (-7) = -10', async () => {
      await calculator.inputNumber(-3);
      await calculator.clickOperator('+');
      await calculator.inputNumber(-7);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-10');
    });
    
    test('TC-EQ-017: 正数减负数 - 5 - (-3) = 8', async () => {
      await calculator.inputNumber(5);
      await calculator.clickOperator('-');
      await calculator.inputNumber(-3);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('8');
    });
    
    test('TC-EQ-018: 负数减正数 - -5 - 3 = -8', async () => {
      await calculator.inputNumber(-5);
      await calculator.clickOperator('-');
      await calculator.inputNumber(3);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-8');
    });
    
    test('TC-EQ-019: 负数乘正数 - -4 × 5 = -20', async () => {
      await calculator.inputNumber(-4);
      await calculator.clickOperator('×');
      await calculator.inputNumber(5);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-20');
    });
    
    test('TC-EQ-020: 负数乘负数 - -3 × -4 = 12', async () => {
      await calculator.inputNumber(-3);
      await calculator.clickOperator('×');
      await calculator.inputNumber(-4);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('12');
    });
    
    test('TC-EQ-021: 负数除正数 - -12 ÷ 4 = -3', async () => {
      await calculator.inputNumber(-12);
      await calculator.clickOperator('÷');
      await calculator.inputNumber(4);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-3');
    });
    
    test('TC-EQ-022: 负数除负数 - -20 ÷ -5 = 4', async () => {
      await calculator.inputNumber(-20);
      await calculator.clickOperator('÷');
      await calculator.inputNumber(-5);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('4');
    });
    
  });
  
  // ==================== 零的特殊场景 ====================
  
  test.describe('零的特殊场景', () => {
    
    test('TC-EQ-023: 零除正数 - 0 ÷ 5 = 0', async () => {
      await calculator.inputExpression('0÷5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-EQ-024: 零除负数 - 0 ÷ -5 = 0', async () => {
      await calculator.inputNumber(0);
      await calculator.clickOperator('÷');
      await calculator.inputNumber(-5);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      // 允许显示 0 或 -0
      expect(result.trim()).toMatch(/^-?0$/);
    });
    
    test('TC-EQ-025: 零的连续运算 - 0 + 0 = 0', async () => {
      await calculator.inputExpression('0+0=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
  });
  
});
