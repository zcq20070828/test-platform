/**
 * logout.spec.ts - 登出功能冒烟测试
 * 
 * 测试级别: P0
 * 覆盖模块: M-006 登出功能
 * 
 * 测试场景：
 * 1. 正常退出登录 → 返回登录页
 * 2. 退出后Session应失效
 * 3. 退出确认弹窗行为
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/LoginPage';
import { HomePage } from '../../page-objects/HomePage';
import { TEST_USERS, URLS } from '../../utils/constants';

test.describe('【P0】登出功能 - 冒烟测试', () => {

  let loginPage: LoginPage;
  let homePage: HomePage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page, URLS.BASE);
    homePage = new HomePage(page);

    // 登录以便测试登出
    await loginPage.navigate();
    await loginPage.loginWithPassword({
      account: TEST_USERS.phone,
      password: TEST_USERS.password,
    });
    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });
    await homePage.verifyLoggedIn();
  });

  // ============================================================
  // TC-SMOKE-LOGOUT-001: 正常退出登录
  // ============================================================
  test('TC-SMOKE-LOGOUT-001: 点击退出应成功登出并跳转登录页', async ({ page }) => {
    // Step 1: 执行退出
    await homePage.logout();

    // Step 2: 验证已跳转回登录页
    await expect(page).toHaveURL(/\/login/);

    // Step 3: 验证登录表单可见
    await expect(loginPage.loginButton).toBeVisible();

    // Step 4: 验证Session已清除
    const loginCookie = await homePage.getLoginCookie();
    expect(loginCookie).toBeFalsy();
  });

  // ============================================================
  // TC-SMOKE-LOGOUT-002: 退出后Session应失效
  // ============================================================
  test('TC-SMOKE-LOGOUT-002: 退出后再次访问受保护页面应被重定向', async ({ page }) => {
    // Step 1: 先退出
    await homePage.logout();

    // Step 2: 尝试访问受保护页面（如首页或Dashboard）
    await page.goto(`${URLS.BASE}/home`);

    // Step 3: 应被重定向到登录页
    await expect(page).toHaveURL(/\/login/);

    // Step 4: 验证显示登录表单
    await expect(loginPage.loginButton).toBeVisible();
  });

  // ============================================================
  // TC-SMOKE-LOGOUT-003: 取消退出应保持登录状态
  // ============================================================
  test('TC-SMOKE-LOGOUT-003: 取消退出登录应保持登录状态', async ({ page }) => {
    // Step 1: 取消退出
    await homePage.cancelLogout();

    // Step 2: 验证仍在登录状态
    await homePage.verifyLoggedIn();

    // Step 3: 验证Session Cookie仍在
    const loginCookie = await homePage.getLoginCookie();
    expect(loginCookie).toBeTruthy();
  });

  // ============================================================
  // TC-SMOKE-LOGOUT-004: 多次退出操作幂等性
  // ============================================================
  test('TC-SMOKE-LOGOUT-004: 重复点击退出应幂等执行', async ({ page }) => {
    // Step 1: 第一次退出
    await homePage.logout();
    await expect(page).toHaveURL(/\/login/);

    // Step 2: 再次尝试退出（应该幂等）
    await homePage.logout();
    await expect(page).toHaveURL(/\/login/);
  });

  // ============================================================
  // TC-SMOKE-LOGOUT-005: 退出后可以重新登录
  // ============================================================
  test('TC-SMOKE-LOGOUT-005: 退出后应能重新登录', async ({ page }) => {
    const loginPage = new LoginPage(page, URLS.BASE);
    const homePage = new HomePage(page);

    // Step 1: 先退出
    await homePage.logout();

    // Step 2: 重新登录
    await loginPage.loginWithPassword({
      account: TEST_USERS.phone,
      password: TEST_USERS.password,
    });

    // Step 3: 验证再次登录成功
    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });
    await homePage.verifyLoggedIn();
  });

  // ============================================================
  // TC-SMOKE-LOGOUT-006: 退出后Cookie应被清除
  // ============================================================
  test('TC-SMOKE-LOGOUT-006: 退出后所有认证Cookie应被清除', async ({ page, context }) => {
    // Step 1: 获取退出前的Cookie
    const cookiesBefore = await context.cookies();

    // Step 2: 退出
    await homePage.logout();

    // Step 3: 获取退出后的Cookie
    const cookiesAfter = await context.cookies();

    // Step 4: 验证认证相关Cookie已清除
    const authCookieNames = cookiesBefore
      .filter(c => c.name.includes('session') || c.name.includes('token') || c.name.includes('auth'))
      .map(c => c.name);

    const authCookiesAfter = cookiesAfter.filter(c => authCookieNames.includes(c.name));
    expect(authCookiesAfter.length).toBe(0);
  });
});
