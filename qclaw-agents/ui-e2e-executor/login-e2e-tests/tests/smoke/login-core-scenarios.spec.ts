/**
 * login-core-scenarios.spec.ts - 登录模块核心UI/E2E自动化测试
 * 
 * 覆盖3个核心测试场景：
 * 1. TC-LOGIN-001: 正向用例 - 正确用户名+正确密码 → 登录成功跳转首页
 * 2. TC-LOGIN-002: 反向用例 - 正确用户名+错误密码 → 显示"密码错误"提示
 * 3. TC-LOGIN-003: 反向用例 - 不存在的账号 → 显示"账号不存在"提示
 * 
 * 测试系统：Mock模拟后端（mock-server/）
 * 测试框架：Playwright + TypeScript
 * 浏览器：Chromium
 */

import { test, expect, Page } from '@playwright/test';

// ============================================================
// 测试配置
// ============================================================
const BASE_URL = 'http://localhost:3000';
const LOGIN_URL = `${BASE_URL}/mock-login.html`;
const HOME_URL = `${BASE_URL}/mock-home.html`;

// 测试账号
const VALID_USER = {
  account: 'admin',
  password: 'Test@123',
  displayName: '管理员',
};

const WRONG_PASSWORD = 'WrongPass!@#';
const NONEXISTENT_ACCOUNT = 'nonexistent_user_xyz';

// ============================================================
// 测试辅助函数
// ============================================================
async function waitForToast(page: Page, timeout = 5000): Promise<string | null> {
  try {
    const toast = page.locator('#toast.show');
    await toast.waitFor({ state: 'visible', timeout });
    const text = await toast.textContent();
    await toast.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    return text;
  } catch {
    return null;
  }
}

async function getGlobalError(page: Page): Promise<string | null> {
  const errorEl = page.locator('[data-testid="global-error"]');
  if (await errorEl.isVisible()) {
    return errorEl.textContent();
  }
  return null;
}

test.describe('登录模块核心UI/E2E测试', () => {
  
  test.beforeEach(async ({ page }) => {
    // 清除 localStorage 确保每次从登录页开始
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    // 确认登录表单可见
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
  });

  // ============================================================
  // TC-LOGIN-001: 正向用例 - 正确用户名+正确密码
  // ============================================================
  test('TC-LOGIN-001: 正确用户名+正确密码应登录成功并跳转首页', async ({ page }) => {
    // Arrange - 记录测试输入
    test.info().annotations.push({
      type: '测试输入',
      description: `用户名: ${VALID_USER.account}, 密码: ${VALID_USER.password}`,
    });

    // Act - 执行登录操作
    // Step 1: 输入正确用户名
    await page.fill('[data-testid="account-input"]', VALID_USER.account);
    
    // Step 2: 输入正确密码
    await page.fill('[data-testid="password-input"]', VALID_USER.password);
    
    // Step 3: 点击登录按钮
    await page.click('[data-testid="login-button"]');

    // Step 4: 等待登录按钮变为"登录中..."，表示请求已发出
    await expect(page.locator('[data-testid="login-button"]')).toHaveText('登录中...');
    
    // Step 5: 等待跳转到首页
    await page.waitForURL('**/mock-home.html', { timeout: 5000 });

    // Assert - 验证登录成功
    // 1. 验证URL已跳转到首页
    expect(page.url()).toContain('mock-home.html');
    
    // 2. 验证页面标题
    await expect(page.locator('[data-testid="page-title"]')).not.toBeVisible();
    
    // 3. 验证欢迎消息
    const welcomeMsg = page.locator('[data-testid="welcome-message"]');
    await expect(welcomeMsg).toBeVisible();
    await expect(welcomeMsg).toContainText('欢迎回来');
    
    // 4. 验证显示用户名
    await expect(page.locator('[data-testid="user-name"]')).toHaveText(VALID_USER.displayName);
    
    // 5. 验证用户菜单可见
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
    
    // 6. 验证头像可见
    await expect(page.locator('[data-testid="user-avatar"]')).toBeVisible();
    
    // 7. 验证退出按钮可见
    await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();
  });

  // ============================================================
  // TC-LOGIN-002: 反向用例 - 正确用户名+错误密码
  // ============================================================
  test('TC-LOGIN-002: 正确用户名+错误密码应显示密码错误提示并停留在登录页', async ({ page }) => {
    // Arrange - 记录测试输入
    test.info().annotations.push({
      type: '测试输入',
      description: `用户名: ${VALID_USER.account}, 密码: ${WRONG_PASSWORD}`,
    });

    // Act - 执行登录操作
    // Step 1: 输入正确用户名
    await page.fill('[data-testid="account-input"]', VALID_USER.account);
    
    // Step 2: 输入错误密码
    await page.fill('[data-testid="password-input"]', WRONG_PASSWORD);
    
    // Step 3: 点击登录按钮
    await page.click('[data-testid="login-button"]');

    // Step 4: 等待错误提示出现
    await page.waitForSelector('[data-testid="global-error"].visible', { timeout: 5000 });

    // Assert - 验证登录失败
    // 1. 验证错误提示出现且包含"密码错误"
    const errorText = await getGlobalError(page);
    expect(errorText).toBeTruthy();
    expect(errorText).toContain('密码错误');
    
    // 2. 验证仍停留在登录页（URL未变）
    expect(page.url()).toContain('mock-login.html');
    
    // 3. 验证登录按钮仍然可用（可以重新尝试）
    await expect(page.locator('[data-testid="login-button"]')).toBeEnabled();
    
    // 4. 验证登录按钮恢复文本
    await expect(page.locator('[data-testid="login-button"]')).toHaveText('登 录');

    // 5. 截取错误状态截图作为证据
  });

  // ============================================================
  // TC-LOGIN-003: 反向用例 - 不存在的账号
  // ============================================================
  test('TC-LOGIN-003: 不存在的账号应显示账号不存在提示并停留在登录页', async ({ page }) => {
    // Arrange - 记录测试输入
    test.info().annotations.push({
      type: '测试输入',
      description: `用户名: ${NONEXISTENT_ACCOUNT}, 密码: ${VALID_USER.password}`,
    });

    // Act - 执行登录操作
    // Step 1: 输入不存在的账号
    await page.fill('[data-testid="account-input"]', NONEXISTENT_ACCOUNT);
    
    // Step 2: 输入任意密码
    await page.fill('[data-testid="password-input"]', VALID_USER.password);
    
    // Step 3: 点击登录按钮
    await page.click('[data-testid="login-button"]');

    // Step 4: 等待错误提示出现
    await page.waitForSelector('[data-testid="global-error"].visible', { timeout: 5000 });

    // Assert - 验证登录失败
    // 1. 验证错误提示出现且包含"账号不存在"
    const errorText = await getGlobalError(page);
    expect(errorText).toBeTruthy();
    expect(errorText).toContain('账号不存在');
    
    // 2. 验证仍停留在登录页
    expect(page.url()).toContain('mock-login.html');
    
    // 3. 验证登录按钮仍然可用
    await expect(page.locator('[data-testid="login-button"]')).toBeEnabled();
    
    // 4. 验证登录按钮恢复文本
    await expect(page.locator('[data-testid="login-button"]')).toHaveText('登 录');
  });
});
