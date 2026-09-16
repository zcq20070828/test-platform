/**
 * 异常场景测试
 * 测试目标: 验证除零、溢出、非法输入等异常的处理
 */
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('异常场景测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.allClear();
  });
  
  // ==================== 除零错误 ====================
  
  test.describe('除零错误', () => {
    
    test('TC-EX-001: 正数除零', async () => {
      await calculator.inputExpression('10÷0=');
      const result = await calculator.getDisplayValue();
      
      // 应显示错误提示
      expect(
        /error|infinity|除数不能为0|undefined/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-002: 负数除零', async () => {
      await calculator.inputNumber(-10);
      await calculator.clickOperator('÷');
      await calculator.inputNumber(0);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|-infinity|除数不能为0/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-003: 零除零', async () => {
      await calculator.inputExpression('0÷0=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|nan|未定义|indeterminate|除数不能为0/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-004: 小数除零', async () => {
      await calculator.inputExpression('1.5÷0=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|infinity/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-005: 连续运算中除零', async () => {
      await calculator.inputExpression('10÷0×5=');
      const result = await calculator.getDisplayValue();
      
      // 应中断运算并显示错误
      expect(
        /error|infinity/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-006: 括号内除零', async () => {
      await calculator.inputExpression('(10÷0)+5=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|infinity/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-007: 复杂表达式中除零', async () => {
      await calculator.inputExpression('100÷(5-5)=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|infinity/i.test(result)
      ).toBeTruthy();
    });
    
  });
  
  // ==================== 溢出错误 ====================
  
  test.describe('溢出错误', () => {
    
    test('TC-EX-007: 加法溢出', async () => {
      // 假设最大支持9位数
      await calculator.inputExpression('999999999+1=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|overflow|1e\+9/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-008: 乘法溢出', async () => {
      await calculator.inputExpression('99999999×99999999=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|overflow|\d+e\+\d+/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-009: 负数下溢', async () => {
      await calculator.inputNumber(-999999999);
      await calculator.clickOperator('-');
      await calculator.inputNumber(1);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|overflow|-1e\+9/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-010: 幂运算溢出(如支持)', async () => {
      // 如果计算器支持幂运算,测试大数幂
      // 这里假设用连续乘法模拟
      await calculator.inputExpression('9×9×9×9×9×9×9×9×9×9×9=');
      const result = await calculator.getDisplayValue();
      
      // 结果应正确或显示溢出
      const resultNum = parseFloat(result.replace(/,/g, ''));
      expect(resultNum > 1e10 || /error|overflow/i.test(result)).toBeTruthy();
    });
    
  });
  
  // ==================== 非法输入 ====================
  
  test.describe('非法输入', () => {
    
    test('TC-EX-012: 连续输入运算符', async () => {
      await calculator.inputExpression('10++5=');
      const result = await calculator.getDisplayValue();
      
      // 应忽略重复运算符或报错
      expect(result.trim()).toMatch(/15|error/i);
    });
    
    test('TC-EX-013: 连续输入小数点', async () => {
      await calculator.inputExpression('1.2.3');
      const result = await calculator.getDisplayValue();
      
      // 应忽略第二个小数点
      expect(result.trim()).toMatch(/1\.23?|error/i);
    });
    
    test('TC-EX-014: 运算符开头', async () => {
      await calculator.clickOperator('+');
      await calculator.inputNumber(5);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      // 可能显示5或报错
      expect(result.trim()).toMatch(/5|error/i);
    });
    
    test('TC-EX-015: 运算符结尾', async () => {
      await calculator.inputExpression('10+');
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      // 应提示表达式不完整或忽略
      expect(
        /error|10|不完整/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-016: 括号不匹配-缺右括号', async () => {
      await calculator.inputExpression('(10+5=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|括号|parenthes/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-017: 括号不匹配-缺左括号', async () => {
      await calculator.inputExpression('10+5)=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|\d+|括号|parenthes/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-018: 空括号', async () => {
      await calculator.inputExpression('()=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|0/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-019: 括号内只有运算符', async () => {
      await calculator.inputExpression('(+5)=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-020: 多个连续运算符', async () => {
      await calculator.inputExpression('10+-×5=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|\d+|invalid/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-021: 只有运算符', async () => {
      await calculator.inputExpression('++--×÷=');
      const result = await calculator.getDisplayValue();
      
      expect(
        /error|invalid/i.test(result)
      ).toBeTruthy();
    });
    
  });
  
  // ==================== 其他异常 ====================
  
  test.describe('其他异常', () => {
    
    test('TC-EX-022: 连续点击等号', async () => {
      await calculator.inputExpression('5+3=');
      await calculator.clickOperator('=');
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      // 应保持结果8或重复运算
      expect(result.trim()).toMatch(/8|16/);
    });
    
    test('TC-EX-023: 空表达式计算', async () => {
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      expect(result.trim()).toBe('0');
    });
    
    test('TC-EX-024: 超长表达式', async () => {
      // 构造超长表达式
      let longExpr = '1';
      for (let i = 0; i < 50; i++) {
        longExpr += '+1';
      }
      longExpr += '=';
      
      await calculator.inputExpression(longExpr);
      const result = await calculator.getDisplayValue();
      
      // 应正确计算或提示超出限制
      expect(
        /51|error|limit/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-025: 错误后继续运算', async () => {
      // 触发错误
      await calculator.inputExpression('10÷0=');
      
      // 清除后继续
      await calculator.allClear();
      await calculator.inputExpression('5+3=');
      const result = await calculator.getDisplayValue();
      
      expect(result.trim()).toBe('8');
    });
    
    test('TC-EX-026: 快速连续输入', async () => {
      // 快速连续点击数字按钮
      for (let i = 0; i < 10; i++) {
        await calculator.clickDigit('9');
      }
      const result = await calculator.getDisplayValue();
      
      // 应正确显示所有输入
      expect(result.trim()).toMatch(/9{10}/);
    });
    
    test('TC-EX-027: 负数的负数运算', async () => {
      await calculator.inputNumber(-10);
      await calculator.clickOperator('-');
      await calculator.inputNumber(-5);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      expect(result.trim()).toBe('-5');
    });
    
    test('TC-EX-028: 非常大的小数运算', async () => {
      await calculator.inputExpression('0.0000001÷0.0000001=');
      const result = await calculator.getDisplayValue();
      
      expect(result.trim()).toBe('1');
    });
    
  });
  
  // ==================== 边界异常 ====================
  
  test.describe('边界异常', () => {
    
    test('TC-EX-029: 最小正数除以最大数', async () => {
      await calculator.inputExpression('0.000001÷999999999=');
      const result = await calculator.getDisplayValue();
      
      // 结果应为极小数
      expect(
        /\d+e-\d+|0\.0+/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-030: 最大数除以最小正数', async () => {
      await calculator.inputExpression('999999999÷0.000001=');
      const result = await calculator.getDisplayValue();
      
      // 结果应为大数或溢出
      expect(
        /error|overflow|\d+e\+\d+|999999999000000/i.test(result)
      ).toBeTruthy();
    });
    
    test('TC-EX-031: 负零运算', async () => {
      await calculator.inputNumber(0);
      await calculator.toggleSign(); // -0
      await calculator.clickOperator('+');
      await calculator.inputNumber(5);
      await calculator.clickOperator('=');
      const result = await calculator.getDisplayValue();
      
      expect(result.trim()).toBe('5');
    });
    
  });
  
});
