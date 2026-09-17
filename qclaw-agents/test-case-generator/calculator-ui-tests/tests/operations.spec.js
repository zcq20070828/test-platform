/**
 * 操作功能测试
 * 测试目标: 验证正负切换、清除、退格等操作功能
 */
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('操作功能测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.allClear();
  });
  
  // ==================== 正负切换(±) ====================
  
  test.describe('正负切换', () => {
    
    test('TC-OP-001: 正数切换为负数', async () => {
      await calculator.inputNumber(123);
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-123');
    });
    
    test('TC-OP-002: 负数切换为正数', async () => {
      await calculator.inputNumber(-456);
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('456');
    });
    
    test('TC-OP-003: 零的正负切换', async () => {
      await calculator.inputNumber(0);
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      // 允许显示 0 或 -0
      expect(result.trim()).toMatch(/^-?0$/);
    });
    
    test('TC-OP-004: 运算后切换符号', async () => {
      await calculator.inputExpression('5+3=');
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-8');
    });
    
    test('TC-OP-005: 输入中切换符号后继续输入', async () => {
      await calculator.inputNumber(123);
      await calculator.toggleSign();
      // 切换后继续输入数字
      await calculator.clickDigit('4');
      await calculator.clickDigit('5');
      await calculator.clickDigit('6');
      const result = await calculator.getDisplayValue();
      // 可能显示 -123456 或 -123
      expect(result.trim()).toMatch(/^-123\d*/);
    });
    
    test('TC-OP-006: 小数切换符号', async () => {
      await calculator.inputNumber(1.5);
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-1.5');
    });
    
    test('TC-OP-007: 连续切换符号', async () => {
      await calculator.inputNumber(100);
      await calculator.toggleSign();
      await calculator.toggleSign();
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      // 奇数次切换应为负数
      expect(result.trim()).toBe('-100');
    });
    
    test('TC-OP-007a: 偶数次切换应恢复原值', async () => {
      await calculator.inputNumber(100);
      await calculator.toggleSign();
      await calculator.toggleSign();
      await calculator.toggleSign();
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('100');
    });
    
  });
  
  // ==================== 清除功能(C/AC) ====================
  
  test.describe('清除功能', () => {
    
    test('TC-OP-008: C清除当前输入', async () => {
      await calculator.inputNumber(123);
      await calculator.clickOperator('+');
      await calculator.inputNumber(456);
      await calculator.clear();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-009: AC全部清除', async () => {
      await calculator.inputExpression('123+456');
      await calculator.allClear();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-010: 运算后清除', async () => {
      await calculator.inputExpression('10+20=');
      await calculator.allClear();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-011: 清除后重新运算', async () => {
      await calculator.inputNumber(123);
      await calculator.allClear();
      await calculator.inputExpression('5+3=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('8');
    });
    
    test('TC-OP-012: 连续清除', async () => {
      await calculator.inputNumber(123);
      await calculator.allClear();
      await calculator.allClear();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-013: 错误后清除', async () => {
      // 触发除零错误
      await calculator.inputExpression('10÷0=');
      const isError = await calculator.isErrorDisplayed();
      expect(isError).toBeTruthy();
      
      // 清除错误
      await calculator.allClear();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
  });
  
  // ==================== 退格功能(⌫/DEL) ====================
  
  test.describe('退格功能', () => {
    
    test('TC-OP-013: 删除最后一位', async () => {
      await calculator.inputNumber(1234);
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('123');
    });
    
    test('TC-OP-014: 连续退格到零', async () => {
      await calculator.inputNumber(1234);
      for (let i = 0; i < 4; i++) {
        await calculator.backspace();
      }
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-015: 小数退格', async () => {
      await calculator.inputExpression('12.34');
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('12.3');
    });
    
    test('TC-OP-016: 删除小数点', async () => {
      await calculator.inputExpression('12.3');
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('12');
    });
    
    test('TC-OP-017: 负号退格', async () => {
      await calculator.inputNumber(-123);
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-12');
    });
    
    test('TC-OP-018: 退格到空显示零', async () => {
      await calculator.inputNumber(1);
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-019: 退格运算符的行为', async () => {
      await calculator.inputExpression('123+');
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      // 可能删除运算符或无操作
      expect(result.trim()).toMatch(/123|\+/);
    });
    
    test('TC-OP-020: 结果显示时退格', async () => {
      await calculator.inputExpression('10+20=');
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      // 可能删除结果的最后一位或清除结果
      expect(result.trim()).toMatch(/3|0/);
    });
    
    test('TC-OP-021: 空输入时退格', async () => {
      await calculator.allClear();
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-022: 多位小数退格', async () => {
      await calculator.inputExpression('1.234567');
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('1.23456');
    });
    
  });
  
  // ==================== 组合操作测试 ====================
  
  test.describe('组合操作测试', () => {
    
    test('TC-OP-023: 正负切换后清除', async () => {
      await calculator.inputNumber(123);
      await calculator.toggleSign();
      await calculator.allClear();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-024: 输入后退格再切换符号', async () => {
      await calculator.inputNumber(1234);
      await calculator.backspace();
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-123');
    });
    
    test('TC-OP-025: 运算-切换-退格组合', async () => {
      await calculator.inputExpression('10+5=');
      await calculator.toggleSign();
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      // 结果为-15,退格后可能为-1
      expect(result.trim()).toMatch(/-1|-15/);
    });
    
    test('TC-OP-026: 清除后切换符号', async () => {
      await calculator.inputNumber(123);
      await calculator.allClear();
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/^-?0$/);
    });
    
    test('TC-OP-027: 连续操作后验证', async () => {
      // 复杂操作序列
      await calculator.inputNumber(123);
      await calculator.toggleSign(); // -123
      await calculator.backspace(); // -12
      await calculator.backspace(); // -1
      await calculator.clickOperator('+');
      await calculator.inputNumber(5);
      await calculator.clickOperator('='); // -1+5=4
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('4');
    });
    
  });
  
});
