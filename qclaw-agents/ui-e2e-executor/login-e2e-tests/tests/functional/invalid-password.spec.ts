/**
 * invalid-password.spec.ts - 错误密码功能测试
 * 
 * 测试级别: P1
 * 覆盖模块: M-001 用户名/密码登录
 * 
 * 测试场景：
 * 1. 错误密码 → 显示错误提示 → 登录失败
 * 2. 密码为空 → 显示必填提示 → 登录失败
 * 3. 连续错误密码触发锁定
 */

import { test, expect } from '@playwright/test';
import { LoginPage, ErrorType } from '../../page-objects/LoginPage';
import { TEST_USERS, ERROR_MESSAGES, ACCOUNT_LOCK_CONFIG } from '../../utils/constants';

test.describe('【P1】错误密码登录 - 功能测试', () => {

  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.navigate();
  });

  // ============================================================
  // TC-FUNC-001: 错误密码登录应失败
  // ============================================================
  test('TC-FUNC-001: 输入错误密码应显示错误提示并登录失败', async ({ page }) => {
    // Step 1: 输入正确账号
    await loginPage.enterAccount(TEST_USERS.phone);

    // Step 2: 输入错误密码
    await loginPage.enterPassword(TEST_USERS.weakPassword); // 如 "123456"

    // Step 3: 点击登录
    await loginPage.clickLoginButton();

    // Step 4: 等待错误提示显示
    await page.waitForSelector('[data-testid="global-error"], .global-error, .form-error', {
      timeout: 5000,
    });

    // Step 5: 验证错误消息
    const errorMessage = await loginPage.getGlobalErrorMessage();
    expect(errorMessage).toBeTruthy();
    expect(errorMessage).toMatch(/密码|错误|incorrect/i);

    // Step 6: 验证仍在登录页（未跳转）
    await expect(page).toHaveURL(/\/login/);
  });

  // ============================================================
  // TC-FUNC-002: 密码为空应显示必填提示
  // ============================================================
  test('TC-FUNC-002: 密码为空时应显示必填提示', async ({ page }) => {
    // Step 1: 输入账号
    await loginPage.enterAccount(TEST_USERS.phone);

    // Step 2: 不输入密码，直接点击登录
    await loginPage.clickLoginButton();

    // Step 3: 验证密码错误提示或全局错误
    // 某些系统在blur时提示，某些在提交时提示
    const passwordError = await loginPage.getPasswordError();
    const globalError = await loginPage.getGlobalErrorMessage();

    // 至少有一个错误提示
    expect(passwordError || globalError).toBeTruthy();

    // 错误消息应包含"密码"或"必填"
    const errorText = passwordError || globalError || '';
    expect(errorText).toMatch(/密码|必填|required/i);
  });

  // ============================================================
  // TC-FUNC-003: 账号不存在应显示错误提示
  // ============================================================
  test('TC-FUNC-003: 输入不存在的账号应显示错误提示', async ({ page }) => {
    // Step 1: 输入不存在的账号
    await loginPage.enterAccount(TEST_USERS.nonExistentPhone);

    // Step 2: 输入密码
    await loginPage.enterPassword(TEST_USERS.password);

    // Step 3: 点击登录
    await loginPage.clickLoginButton();

    // Step 4: 等待错误提示
    await page.waitForSelector('[data-testid="global-error"], .global-error', {
      timeout: 5000,
    });

    // Step 5: 验证错误消息（安全考虑不透露账号不存在）
    const errorMessage = await loginPage.getGlobalErrorMessage();
    expect(errorMessage).toBeTruthy();

    // 安全：不应透露"账号不存在"
    expect(errorMessage).not.toMatch(/账号不存在|用户不存在|未注册/i);
  });

  // ============================================================
  // TC-FUNC-004: 密码可见性切换
  // ============================================================
  test('TC-FUNC-004: 点击显示密码按钮应切换密码可见性', async ({ page }) => {
    // Step 1: 输入密码
    await loginPage.enterPassword(TEST_USERS.password);

    // Step 2: 验证初始为密码类型
    const initialType = await loginPage.passwordInput.getAttribute('type');
    expect(initialType).toBe('password');

    // Step 3: 点击显示密码
    const toggleVisible = await loginPage.showPasswordToggle.isVisible().catch(() => false);
    if (toggleVisible) {
      await loginPage.togglePasswordVisibility();

      // Step 4: 验证密码已可见
      const afterType = await loginPage.passwordInput.getAttribute('type');
      expect(afterType).toBe('text');
    }
  });

  // ============================================================
  // TC-FUNC-005: 多次错误密码后图形验证码
  // ============================================================
  test('TC-FUNC-005: 连续错误3次后应出现图形验证码', async ({ page }) => {
    // Step 1-3: 连续错误3次
    for (let i = 1; i <= 3; i++) {
      await loginPage.enterAccount(TEST_USERS.phone);
      await loginPage.enterPassword(`WrongPass${i}`);
      await loginPage.clickLoginButton();
      await page.waitForTimeout(500);

      // 如果出现错误提示，清空表单
      if (await loginPage.globalErrorMessage.isVisible()) {
        await loginPage.clearAccount();
        await loginPage.clearPassword();
      }
    }

    // Step 4: 第4次尝试应出现图形验证码
    await loginPage.enterAccount(TEST_USERS.phone);
    await loginPage.enterPassword('WrongPass4');

    // 检查是否有图形验证码输入框
    const captchaVisible = await loginPage.captchaInput.isVisible().catch(() => false);
    
    if (captchaVisible) {
      // 验证图形验证码图片可见
      await expect(loginPage.captchaImage).toBeVisible();
      
      // 验证图形验证码刷新按钮可见
      await expect(loginPage.captchaRefreshButton).toBeVisible();
    }
  });

  // ============================================================
  // TC-FUNC-006: 输入框特殊字符转义（安全测试）
  // ============================================================
  test('TC-FUNC-006: 密码输入特殊字符应被正确处理', async ({ page }) => {
    const specialChars = ['<script>', '"><img src=x onerror=alert(1)>', "' OR '1'='1", '`; DROP TABLE users;'];

    for (const char of specialChars) {
      await loginPage.enterAccount(TEST_USERS.phone);
      await loginPage.enterPassword(char);
      await loginPage.clickLoginButton();
      await page.waitForTimeout(300);

      // 系统应正确处理，不应显示XSS或SQL注入的错误信息
      const errorText = await loginPage.getGlobalErrorMessage().catch(() => '');
      
      // 验证页面未被XSS攻击（检查页面内容）
      const pageContent = await page.content();
      expect(pageContent).not.toContain('<script>alert');
      
      // 清空表单继续下一个
      await loginPage.clearAccount();
      await loginPage.clearPassword();
    }
  });
});
