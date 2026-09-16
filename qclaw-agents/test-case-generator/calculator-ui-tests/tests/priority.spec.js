/**
 * 括号优先级测试
 * 测试目标: 验证运算符优先级和括号嵌套的正确性
 */
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('优先级测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.allClear();
  });
  
  // ==================== 无括号基础运算 ====================
  
  test.describe('无括号基础运算', () => {
    
    test('TC-PR-001: 同级运算从左到右 - 10 - 5 - 2 = 3', async () => {
      await calculator.inputExpression('10-5-2=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3');
    });
    
    test('TC-PR-002: 乘除优先于加减 - 2 + 3 × 4 = 14', async () => {
      await calculator.inputExpression('2+3×4=');
      const result = await calculator.getDisplayValue();
      // 先算乘法: 3×4=12, 再加: 2+12=14
      expect(result.trim()).toBe('14');
    });
    
    test('TC-PR-003: 混合运算优先级 - 10 ÷ 2 + 3 × 4 - 5 = 12', async () => {
      await calculator.inputExpression('10÷2+3×4-5=');
      const result = await calculator.getDisplayValue();
      // 计算顺序: 10÷2=5, 3×4=12, 然后 5+12-5=12
      expect(result.trim()).toBe('12');
    });
    
    test('TC-PR-004: 连续乘除运算 - 20 ÷ 4 × 5 = 25', async () => {
      await calculator.inputExpression('20÷4×5=');
      const result = await calculator.getDisplayValue();
      // 从左到右: 20÷4=5, 5×5=25
      expect(result.trim()).toBe('25');
    });
    
    test('TC-PR-004a: 连续乘除运算(不同顺序)', async () => {
      await calculator.inputExpression('5×20÷4=');
      const result = await calculator.getDisplayValue();
      // 从左到右: 5×20=100, 100÷4=25
      expect(result.trim()).toBe('25');
    });
    
  });
  
  // ==================== 单层括号 ====================
  
  test.describe('单层括号', () => {
    
    test('TC-PR-005: 括号改变优先级 - (2 + 3) × 4 = 20', async () => {
      await calculator.inputExpression('(2+3)×4=');
      const result = await calculator.getDisplayValue();
      // 先算括号: (2+3)=5, 然后 5×4=20
      expect(result.trim()).toBe('20');
    });
    
    test('TC-PR-006: 括号内加减运算 - 10 - (5 + 2) = 3', async () => {
      await calculator.inputExpression('10-(5+2)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3');
    });
    
    test('TC-PR-007: 括号内乘除运算 - 2 × (3 + 4) = 14', async () => {
      await calculator.inputExpression('2×(3+4)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('14');
    });
    
    test('TC-PR-008: 括号在开头 - (10 - 5) ÷ 5 = 1', async () => {
      await calculator.inputExpression('(10-5)÷5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('1');
    });
    
    test('TC-PR-009: 括号在结尾 - 10 ÷ (2 + 3) = 2', async () => {
      await calculator.inputExpression('10÷(2+3)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('2');
    });
    
    test('TC-PR-010: 单个数字括号 - 5 × (10) = 50', async () => {
      await calculator.inputExpression('5×(10)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('50');
    });
    
  });
  
  // ==================== 多层嵌套括号 ====================
  
  test.describe('多层嵌套括号', () => {
    
    test('TC-PR-011: 两层括号嵌套 - ((2 + 3) × 4) = 20', async () => {
      await calculator.inputExpression('((2+3)×4)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('20');
    });
    
    test('TC-PR-012: 三层括号嵌套 - ((2 + (3 × 4)) - 5) = 9', async () => {
      await calculator.inputExpression('((2+(3×4))-5)=');
      const result = await calculator.getDisplayValue();
      // 计算顺序: 3×4=12, 2+12=14, 14-5=9
      expect(result.trim()).toBe('9');
    });
    
    test('TC-PR-013: 四层括号嵌套 - (((1 + 2) + 3) + 4) = 10', async () => {
      await calculator.inputExpression('(((1+2)+3)+4)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('10');
    });
    
    test('TC-PR-014: 复杂嵌套表达式 - ((10 - 5) × (2 + 3)) = 25', async () => {
      await calculator.inputExpression('((10-5)×(2+3))=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('25');
    });
    
    test('TC-PR-015: 深度嵌套边界 - 测试5层嵌套', async () => {
      await calculator.inputExpression('(((((1+1)+1)+1)+1))=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('5');
    });
    
  });
  
  // ==================== 混合优先级 ====================
  
  test.describe('混合优先级', () => {
    
    test('TC-PR-016: 括号与混合运算 - 2 + 3 × (4 + 5) = 29', async () => {
      await calculator.inputExpression('2+3×(4+5)=');
      const result = await calculator.getDisplayValue();
      // 先括号: (4+5)=9, 再乘: 3×9=27, 最后加: 2+27=29
      expect(result.trim()).toBe('29');
    });
    
    test('TC-PR-017: 多个括号表达式 - (2 + 3) × (4 - 1) = 15', async () => {
      await calculator.inputExpression('(2+3)×(4-1)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('15');
    });
    
    test('TC-PR-018: 嵌套与混合运算 - 10 - (2 × (3 + 4)) = -4', async () => {
      await calculator.inputExpression('10-(2×(3+4))=');
      const result = await calculator.getDisplayValue();
      // 计算顺序: (3+4)=7, 2×7=14, 10-14=-4
      expect(result.trim()).toBe('-4');
    });
    
    test('TC-PR-019: 复杂综合表达式 - ((10 ÷ 2) + 3) × (4 - 1) = 24', async () => {
      await calculator.inputExpression('((10÷2)+3)×(4-1)=');
      const result = await calculator.getDisplayValue();
      // 计算顺序: 10÷2=5, 5+3=8, 4-1=3, 8×3=24
      expect(result.trim()).toBe('24');
    });
    
    test('TC-PR-020: 多重混合 - 100 ÷ ((5 + 5) × 2) = 5', async () => {
      await calculator.inputExpression('100÷((5+5)×2)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('5');
    });
    
    test('TC-PR-021: 负数与括号 - - (5 + 3) = -8', async () => {
      await calculator.inputNumber(0);
      await calculator.clickOperator('-');
      await calculator.inputExpression('(5+3)=');
      const result = await calculator.getDisplayValue();
      // 注意: 这里测试的是 0-(5+3) 的情况
      expect(result.trim()).toBe('-8');
    });
    
  });
  
  // ==================== 运算符优先级边界 ====================
  
  test.describe('运算符优先级边界', () => {
    
    test('TC-PR-022: 连续括号 - (2 + 3)(4 + 5) (无乘号)', async () => {
      // 如果计算器支持省略乘号
      await calculator.inputExpression('(2+3)(4+5)=');
      const result = await calculator.getDisplayValue();
      
      // 可能报错或自动添加乘号
      if (!await calculator.isErrorDisplayed()) {
        expect(result.trim()).toMatch(/45|error/i);
      }
    });
    
    test('TC-PR-023: 括号嵌套与除法 - (20 ÷ (2 + 3)) × 5 = 20', async () => {
      await calculator.inputExpression('(20÷(2+3))×5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('20');
    });
    
    test('TC-PR-024: 括号与负数 - 10 + (-5)', async () => {
      await calculator.inputNumber(10);
      await calculator.clickOperator('+');
      await calculator.inputNumber(-5);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('5');
    });
    
  });
  
});
