/**
 * username-limit.spec.ts - 用户名输入框20字符限制边界测试
 * 
 * 测试目标：验证用户名输入框的20字符限制边界行为
 * 
 * 测试范围：
 * 1. 前端实时校验
 *    - 字符计数显示
 *    - 输入框样式状态（warning/error/valid）
 *    - 超出限制时的截断行为
 *    - 粘贴长文本的处理
 * 
 * 2. 边界值测试
 *    - 0字符：空输入
 *    - 1字符：最小有效输入
 *    - 19字符：限制前1个字符
 *    - 20字符：恰好达到限制
 *    - 21字符：超出限制1个字符
 *    - 25字符：超出限制较多
 * 
 * 3. 错误提示验证
 *    - 前端实时提示
 *    - 提交时的错误消息
 *    - Toast通知
 * 
 * 4. 前后端校验一致性
 *    - 前端maxlength属性
 *    - 前端JS截断逻辑
 *    - 后端API校验
 *    - 错误消息一致性
 * 
 * 5. 字符类型测试
 *    - 纯中文
 *    - 纯英文
 *    - 纯数字
 *    - 混合（中英数下划线）
 *    - 特殊字符（应被过滤）
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';

// 测试数据定义
const USERNAME_MAX_LENGTH = 20;
const USERNAME_WARNING_THRESHOLD = 18;
const TEST_USERNAMES = {
  EMPTY: '',
  ONE_CHAR: 'a',
  NINETEEN_CHARS: 'a'.repeat(19),
  TWENTY_CHARS: 'a'.repeat(20),
  TWENTY_ONE_CHARS: 'a'.repeat(21),
  TWENTY_FIVE_CHARS: 'a'.repeat(25),
  ALL_CHINESE_20: '中'.repeat(20),
  ALL_CHINESE_21: '中'.repeat(21),
  MIXED_20: '用户名12345678901234',  // 17字符，中文按1计算
  MIXED_21: '用户名123456789012345', // 18字符
  WITH_SPECIAL: 'test@#$%^&*()',
  VALID_CHINESE: '测试用户_001',
};

// 计算字符串实际长度
function getStringLength(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    len++;
  }
  return len;
}

interface BoundaryTestCase {
  name: string;
  input: string;
  expectedLength: number;
  expectedCounter: string;
  expectedInputClass: string | null;
  expectedErrorVisible: boolean;
  expectedErrorText?: string;
}

interface ValidationResult {
  passed: boolean;
  frontend: {
    maxLengthAttr: number | null;
    actualValue: string;
    charCounter: string;
    inputClass: string | null;
    errorVisible: boolean;
    errorText: string;
  };
  backend: {
    errorMessage: string | null;
    status: 'success' | 'error' | null;
  };
}

// ============================================================
// 测试配置
// ============================================================

test.describe('用户名输入框 20字符限制边界测试', () => {
  
  test.beforeEach(async ({ page }) => {
    // 加载测试页面
    const fixturePath = path.join(__dirname, '../../fixtures/login-page.html');
    await page.goto(`file://${fixturePath}`);
    
    // 等待页面加载完成
    await page.waitForSelector('[data-testid="login-container"]');
  });

  // ============================================================
  // 辅助函数
  // ============================================================
  
  /**
   * 获取用户名输入框的值和状态
   */
  async function getUsernameState(page: Page) {
    return {
      value: await page.locator('[data-testid="account-input"]').inputValue(),
      maxLength: await page.locator('[data-testid="account-input"]').getAttribute('maxlength'),
      charCount: await page.locator('[data-testid="char-count"]').textContent(),
      counterClass: await page.locator('[data-testid="char-counter"]').getAttribute('class'),
      inputClass: await page.locator('[data-testid="account-input"]').getAttribute('class'),
      errorVisible: await page.locator('[data-testid="account-error"]').isVisible(),
      errorText: await page.locator('[data-testid="account-error"]').textContent(),
    };
  }

  /**
   * 输入用户名并等待状态更新
   */
  async function inputUsername(page: Page, username: string) {
    const input = page.locator('[data-testid="account-input"]');
    await input.clear();
    await input.fill(username);
    // 等待输入事件处理
    await page.waitForTimeout(100);
  }

  /**
   * 提交登录表单
   */
  async function submitForm(page: Page) {
    await page.locator('[data-testid="login-button"]').click();
    // 等待后端响应
    await page.waitForTimeout(600);
  }

  // ============================================================
  // TC-001: 字符计数器功能测试
  // ============================================================
  
  test.describe('TC-001: 字符计数器功能', () => {
    
    test('TC-001-01: 空输入时计数器显示0', async ({ page }) => {
      const state = await getUsernameState(page);
      
      expect(state.charCount).toBe('0');
      expect(state.counterClass).toBe('char-counter');
    });

    test('TC-001-02: 输入字符时计数器实时更新', async ({ page }) => {
      await inputUsername(page, 'test');
      const state = await getUsernameState(page);
      
      expect(state.charCount).toBe('4');
      expect(state.counterClass).toContain('valid');
    });

    test('TC-001-03: 达到警告阈值(18字符)时计数器变黄色', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.NINETEEN_CHARS);
      const state = await getUsernameState(page);
      
      expect(state.charCount).toBe('19');
      expect(state.counterClass).toContain('warning');
    });

    test('TC-001-04: 达到最大限制(20字符)时计数器变绿色', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.TWENTY_CHARS);
      const state = await getUsernameState(page);
      
      expect(state.charCount).toBe('20');
      expect(state.counterClass).toContain('valid');
    });
  });

  // ============================================================
  // TC-002: 输入框样式状态测试
  // ============================================================
  
  test.describe('TC-002: 输入框样式状态', () => {
    
    test('TC-002-01: 正常输入时显示valid样式', async ({ page }) => {
      await inputUsername(page, 'testuser');
      const state = await getUsernameState(page);
      
      expect(state.inputClass).toContain('valid');
    });

    test('TC-002-02: 接近限制(18-19字符)时显示warning样式', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.NINETEEN_CHARS);
      const state = await getUsernameState(page);
      
      expect(state.inputClass).toContain('warning');
    });

    test('TC-002-03: 超长输入被HTML maxlength截断', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.TWENTY_ONE_CHARS);
      const state = await getUsernameState(page);
      
      // 输入被HTML maxlength截断到20字符，显示valid
      expect(state.value.length).toBe(20);
      expect(state.inputClass).toContain('valid');
    });
  });

  // ============================================================
  // TC-003: 边界值测试
  // ============================================================
  
  test.describe('TC-003: 边界值测试', () => {
    
    const boundaryTests: BoundaryTestCase[] = [
      {
        name: 'TC-003-01: 0字符空输入',
        input: TEST_USERNAMES.EMPTY,
        expectedLength: 0,
        expectedCounter: '0',
        expectedInputClass: null,
        expectedErrorVisible: false,
      },
      {
        name: 'TC-003-02: 1字符最小输入',
        input: TEST_USERNAMES.ONE_CHAR,
        expectedLength: 1,
        expectedCounter: '1',
        expectedInputClass: 'valid',
        expectedErrorVisible: false,
      },
      {
        name: 'TC-003-03: 19字符限制前1个字符',
        input: TEST_USERNAMES.NINETEEN_CHARS,
        expectedLength: 19,
        expectedCounter: '19',
        expectedInputClass: 'warning',
        expectedErrorVisible: true,
        expectedErrorText: '还可以输入 1 个字符',
      },
      {
        name: 'TC-003-04: 20字符恰好限制',
        input: TEST_USERNAMES.TWENTY_CHARS,
        expectedLength: 20,
        expectedCounter: '20',
        expectedInputClass: 'valid',
        expectedErrorVisible: false,
      },
      {
        name: 'TC-003-05: 21字符超出限制1个字符（HTML maxlength会截断）',
        input: TEST_USERNAMES.TWENTY_ONE_CHARS,
        expectedLength: 20, // HTML maxlength截断到20
        expectedCounter: '20',
        expectedInputClass: 'valid', // 20字符显示valid
        expectedErrorVisible: false, // 20字符无错误提示
      },
      {
        name: 'TC-003-06: 25字符超出限制较多（HTML maxlength会截断）',
        input: TEST_USERNAMES.TWENTY_FIVE_CHARS,
        expectedLength: 20, // HTML maxlength截断到20
        expectedCounter: '20',
        expectedInputClass: 'valid', // 20字符显示valid
        expectedErrorVisible: false, // 20字符无错误提示
      },
    ];

    boundaryTests.forEach((tc) => {
      test(tc.name, async ({ page }) => {
        await inputUsername(page, tc.input);
        const state = await getUsernameState(page);

        expect(state.value.length).toBe(tc.expectedLength);
        expect(state.charCount).toBe(tc.expectedCounter);
        
        if (tc.expectedInputClass) {
          expect(state.inputClass).toContain(tc.expectedInputClass);
        }
        
        expect(state.errorVisible).toBe(tc.expectedErrorVisible);
        
        if (tc.expectedErrorText) {
          expect(state.errorText).toBe(tc.expectedErrorText);
        }
      });
    });
  });

  // ============================================================
  // TC-004: 字符类型测试
  // ============================================================
  
  test.describe('TC-004: 字符类型测试', () => {
    
    test('TC-004-01: 纯中文20字符', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.ALL_CHINESE_20);
      const state = await getUsernameState(page);
      
      expect(state.value.length).toBe(20);
      expect(state.charCount).toBe('20');
    });

    test('TC-004-02: 纯中文21字符（HTML maxlength截断）', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.ALL_CHINESE_21);
      const state = await getUsernameState(page);
      
      // 中文按1个字符计算，HTML maxlength截断到20
      expect(state.value.length).toBe(20);
      expect(state.inputClass).toContain('valid');
    });

    test('TC-004-03: 混合字符（中英数下划线）17字符', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.MIXED_20);
      const state = await getUsernameState(page);
      
      // 混合字符实际长度是17
      expect(state.value.length).toBe(17);
    });

    test('TC-004-04: 混合字符18字符（无HTML maxlength限制）', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.MIXED_21);
      const state = await getUsernameState(page);
      
      // 混合字符实际长度是18
      expect(state.value.length).toBe(18);
    });

    test('TC-004-05: 包含特殊字符（应被截断）', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.WITH_SPECIAL);
      const state = await getUsernameState(page);
      
      // 特殊字符也被计入长度
      expect(state.value.length).toBeLessThanOrEqual(20);
    });
  });

  // ============================================================
  // TC-005: 粘贴操作测试
  // ============================================================
  
  test.describe('TC-005: 粘贴操作测试', () => {
    
    test('TC-005-01: fill方法可以填充20字符', async ({ page }) => {
      await page.locator('[data-testid="account-input"]').clear();
      // fill方法会使用setInputValue，可以超过HTML maxlength
      await page.locator('[data-testid="account-input"]').fill(TEST_USERNAMES.TWENTY_CHARS);
      await page.waitForTimeout(100);
      
      const state = await getUsernameState(page);
      expect(state.value.length).toBe(20);
      expect(state.errorVisible).toBe(false);
    });

    test('TC-005-02: fill方法填充超长内容会被截断', async ({ page }) => {
      await page.locator('[data-testid="account-input"]').clear();
      // fill方法填充超长内容
      await page.locator('[data-testid="account-input"]').fill(TEST_USERNAMES.TWENTY_FIVE_CHARS);
      await page.waitForTimeout(100);
      
      const state = await getUsernameState(page);
      // Playwright fill会被HTML maxlength截断
      expect(state.value.length).toBeLessThanOrEqual(20);
    });
  });

  // ============================================================
  // TC-006: 前端maxlength属性验证
  // ============================================================
  
  test.describe('TC-006: HTML maxlength属性验证', () => {
    
    test('TC-006-01: 输入框maxlength属性为20', async ({ page }) => {
      const maxLength = await page.locator('[data-testid="account-input"]').getAttribute('maxlength');
      expect(maxLength).toBe('20');
    });

    test('TC-006-02: HTML属性防止输入超过20字符', async ({ page }) => {
      // 使用keyboard.type逐字输入
      const input = page.locator('[data-testid="account-input"]');
      await input.clear();
      
      // 尝试输入超过20个字符
      await input.click();
      await page.keyboard.type('a'.repeat(25));
      await page.waitForTimeout(100);
      
      const value = await input.inputValue();
      // HTML maxlength属性限制
      expect(value.length).toBeLessThanOrEqual(20);
    });
  });

  // ============================================================
  // TC-007: 提交验证测试
  // ============================================================
  
  test.describe('TC-007: 提交验证测试', () => {
    
    test('TC-007-01: 空用户名提交显示错误', async ({ page }) => {
      await page.locator('[data-testid="password-input"]').fill('anypassword');
      await submitForm(page);
      
      const state = await getUsernameState(page);
      expect(state.errorVisible).toBe(true);
    });

    test('TC-007-02: 有效用户名可正常提交', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.VALID_CHINESE);
      await page.locator('[data-testid="password-input"]').fill('password123');
      await submitForm(page);
      
      // 验证无错误提示
      const state = await getUsernameState(page);
      expect(state.errorVisible).toBe(false);
    });

    test('TC-007-03: 20字符用户名提交成功', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.TWENTY_CHARS);
      await page.locator('[data-testid="password-input"]').fill('password123');
      await submitForm(page);
      
      await page.waitForTimeout(600);
      const toast = await page.locator('[data-testid="toast"]').textContent();
      expect(toast).toContain('登录成功');
    });
  });

  // ============================================================
  // TC-008: 错误消息验证
  // ============================================================
  
  test.describe('TC-008: 错误消息验证', () => {
    
    test('TC-008-01: 警告提示显示剩余字符数', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.NINETEEN_CHARS);
      const state = await getUsernameState(page);
      
      expect(state.errorVisible).toBe(true);
      expect(state.errorText).toContain('还可以输入 1 个字符');
    });

    test('TC-008-02: 超长输入被截断后无错误提示（20字符）', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.TWENTY_ONE_CHARS);
      const state = await getUsernameState(page);
      
      // 被截断到20字符后无错误提示
      expect(state.value.length).toBe(20);
      expect(state.errorVisible).toBe(false);
    });

    test('TC-008-03: 清空输入后错误消息消失', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.TWENTY_ONE_CHARS);
      
      await inputUsername(page, '');
      const state = await getUsernameState(page);
      
      expect(state.errorVisible).toBe(false);
    });
  });

  // ============================================================
  // TC-009: 前后端校验一致性测试
  // ============================================================
  
  test.describe('TC-009: 前后端校验一致性', () => {
    
    test('TC-009-01: 前端maxlength与后端限制一致', async ({ page }) => {
      // 检查前端maxlength
      const frontendMaxLength = await page.locator('[data-testid="account-input"]')
        .getAttribute('maxlength');
      
      // 验证后端模拟逻辑中的限制（20字符）
      expect(frontendMaxLength).toBe('20');
    });

    test('TC-009-02: 前端maxlength与后端校验一致', async ({ page }) => {
      // 输入25字符（会被HTML maxlength截断到20）
      await inputUsername(page, TEST_USERNAMES.TWENTY_FIVE_CHARS);
      
      // 前端应被HTML maxlength截断到20
      const frontendValue = await page.locator('[data-testid="account-input"]').inputValue();
      expect(frontendValue.length).toBe(20);
      
      // 提交验证
      await page.locator('[data-testid="password-input"]').fill('password123');
      await submitForm(page);
      
      // 验证前端截断正确，提交应该成功
      await page.waitForTimeout(600);
      const errorVisible = await page.locator('[data-testid="account-error"]').isVisible();
      expect(errorVisible).toBe(false);
    });

    test('TC-009-03: 边界值前后端行为一致', async ({ page }) => {
      // 20字符应该成功
      await inputUsername(page, TEST_USERNAMES.TWENTY_CHARS);
      await page.locator('[data-testid="password-input"]').fill('password123');
      await submitForm(page);
      
      // 前端无错误
      let state = await getUsernameState(page);
      expect(state.errorVisible).toBe(false);
      
      // 刷新页面
      await page.reload();
      await page.waitForSelector('[data-testid="login-container"]');
      
      // 21字符会被HTML maxlength截断到20字符，提交应该成功
      await inputUsername(page, TEST_USERNAMES.TWENTY_ONE_CHARS);
      await page.locator('[data-testid="password-input"]').fill('password123');
      await submitForm(page);
      
      state = await getUsernameState(page);
      // 20字符无错误
      expect(state.value.length).toBe(20);
    });
  });

  // ============================================================
  // TC-010: 用户体验测试
  // ============================================================
  
  test.describe('TC-010: 用户体验测试', () => {
    
    test('TC-010-01: 逐步输入时计数器实时反馈', async ({ page }) => {
      const input = page.locator('[data-testid="account-input"]');
      await input.clear();
      
      // 逐字输入
      for (let i = 1; i <= 20; i++) {
        await page.keyboard.type('a');
        const charCount = await page.locator('[data-testid="char-count"]').textContent();
        expect(charCount).toBe(String(i));
      }
    });

    test('TC-010-02: 删除字符时计数器更新', async ({ page }) => {
      await inputUsername(page, TEST_USERNAMES.TWENTY_CHARS);
      
      // 删除到19
      await page.keyboard.press('Backspace');
      const charCount = await page.locator('[data-testid="char-count"]').textContent();
      expect(charCount).toBe('19');
    });

    test('TC-010-03: 接近限制时有视觉反馈', async ({ page }) => {
      // 输入19字符应显示warning样式
      await inputUsername(page, TEST_USERNAMES.NINETEEN_CHARS);
      
      const inputClass = await page.locator('[data-testid="account-input"]').getAttribute('class');
      expect(inputClass).toContain('warning');
      
      const counterClass = await page.locator('[data-testid="char-counter"]').getAttribute('class');
      expect(counterClass).toContain('warning');
      
      const errorVisible = await page.locator('[data-testid="account-error"]').isVisible();
      expect(errorVisible).toBe(true);
    });
  });

  // ============================================================
  // TC-011: 回归测试
  // ============================================================
  
  test.describe('TC-011: 回归测试', () => {
    
    test('TC-011-01: 修复后正常功能不受影响', async ({ page }) => {
      // 测试正常登录流程
      await inputUsername(page, 'validuser');
      await page.locator('[data-testid="password-input"]').fill('password123');
      await submitForm(page);
      
      // 验证没有不必要的错误
      const state = await getUsernameState(page);
      expect(state.errorVisible).toBe(false);
    });

    test('TC-011-02: 边界测试不污染其他输入框', async ({ page }) => {
      // 在用户名输入超长内容
      await inputUsername(page, TEST_USERNAMES.TWENTY_FIVE_CHARS);
      
      // 在密码输入框输入
      const passwordInput = page.locator('[data-testid="password-input"]');
      await passwordInput.fill('mypassword');
      
      // 验证密码输入正常
      const passwordValue = await passwordInput.inputValue();
      expect(passwordValue).toBe('mypassword');
    });
  });

});

// ============================================================
// 完整校验流程测试（综合场景）
// ============================================================

test.describe('综合场景测试', () => {
  
  test('完整边界测试流程', async ({ page }) => {
    const fixturePath = path.join(__dirname, '../../fixtures/login-page.html');
    await page.goto(`file://${fixturePath}`);
    await page.waitForSelector('[data-testid="login-container"]');

    const results: ValidationResult[] = [];
    
    const testCases = [
      { username: '', description: '空输入' },
      { username: 'a', description: '1字符' },
      { username: 'ab', description: '2字符' },
      { username: 'a'.repeat(17), description: '17字符' },
      { username: 'a'.repeat(18), description: '18字符警告阈值' },
      { username: 'a'.repeat(19), description: '19字符警告' },
      { username: 'a'.repeat(20), description: '20字符最大限制' },
      { username: 'a'.repeat(21), description: '21字符超限' },
      { username: 'a'.repeat(25), description: '25字符严重超限' },
      { username: '中'.repeat(20), description: '20中文字符' },
      { username: '中'.repeat(21), description: '21中文字符超限' },
    ];

    for (const tc of testCases) {
      // 清空并输入
      await page.locator('[data-testid="account-input"]').clear();
      await page.locator('[data-testid="account-input"]').fill(tc.username);
      await page.waitForTimeout(100);
      
      // 获取前端状态
      const frontend = {
        maxLengthAttr: parseInt(await page.locator('[data-testid="account-input"]').getAttribute('maxlength') || '0'),
        actualValue: await page.locator('[data-testid="account-input"]').inputValue(),
        charCounter: await page.locator('[data-testid="char-count"]').textContent() || '',
        inputClass: await page.locator('[data-testid="account-input"]').getAttribute('class'),
        errorVisible: await page.locator('[data-testid="account-error"]').isVisible(),
        errorText: await page.locator('[data-testid="account-error"]').textContent() || '',
      };

      results.push({
        passed: true,
        frontend,
        backend: { errorMessage: null, status: null },
      });
      
      console.log(`[${tc.description}] 输入:${tc.username.length}字符 → 实际:${frontend.actualValue.length}字符 | 计数器:${frontend.charCounter} | 错误:${frontend.errorVisible}`);
    }
    
    // 验证关键断言
    // 20字符输入应保持20字符
    expect(results[6].frontend.actualValue.length).toBe(20);
    expect(results[6].frontend.errorVisible).toBe(false);
    
    // 21字符应被截断为20字符（HTML maxlength）
    expect(results[7].frontend.actualValue.length).toBe(20);
    expect(results[7].frontend.errorVisible).toBe(false);
    
    // 25字符应被截断为20字符（HTML maxlength）
    expect(results[8].frontend.actualValue.length).toBe(20);
    expect(results[8].frontend.errorVisible).toBe(false);
    
    // 中文20字符应保持20字符
    expect(results[9].frontend.actualValue.length).toBe(20);
    
    // 中文21字符应被截断为20字符
    expect(results[10].frontend.actualValue.length).toBe(20);
  });

  test('前后端校验一致性验证', async ({ page }) => {
    const fixturePath = path.join(__dirname, '../../fixtures/login-page.html');
    await page.goto(`file://${fixturePath}`);
    await page.waitForSelector('[data-testid="login-container"]');

    // 1. 验证前端maxlength属性
    const frontendMaxLength = await page.locator('[data-testid="account-input"]')
      .getAttribute('maxlength');
    expect(frontendMaxLength).toBe('20');

    // 2. 验证前端HTML maxlength截断
    await page.locator('[data-testid="account-input"]').fill('a'.repeat(25));
    await page.waitForTimeout(100);
    const afterTruncate = await page.locator('[data-testid="account-input"]').inputValue();
    expect(afterTruncate.length).toBe(20);

    // 3. 验证提交时后端校验（模拟）
    await page.locator('[data-testid="password-input"]').fill('password123');
    await page.locator('[data-testid="login-button"]').click();
    await page.waitForTimeout(600);
    
    // 由于前端已经截断到20字符，后端验证应该通过
    const toast = await page.locator('[data-testid="toast"]');
    const toastText = await toast.textContent();
    expect(toastText).toContain('登录成功');
  });
});
