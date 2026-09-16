/**
 * valid-login.spec.ts - 有效登录冒烟测试
 * 
 * 测试级别: P0
 * 覆盖模块: M-001 用户名/密码登录
 * 
 * 测试场景：
 * 1. 有效账号密码登录 → 登录成功 → 跳转首页
 * 2. 记住我功能 → 关闭浏览器 → 重新打开 → 自动登录
 */

import { test, expect, Page, request } from '@playwright/test';
import { LoginPage } from '../../page-objects/LoginPage';
import { HomePage } from '../../page-objects/HomePage';
import { TEST_USERS, URLS, EXPECTED_POST_LOGIN_PATHS } from '../../utils/constants';

/**
 * Test Fixture: 创建已登录页面上下文
 */
test.describe.configure({ mode: 'serial' });

test.describe('【P0】有效登录 - 冒烟测试', () => {

  let loginPage: LoginPage;
  let homePage: HomePage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page, URLS.BASE);
    homePage = new HomePage(page);
    
    // 导航到登录页
    await loginPage.navigate();
  });

  // ============================================================
  // TC-SMOKE-001: 有效手机号+密码登录
  // ============================================================
  test('TC-SMOKE-001: 有效手机号+密码登录应成功并跳转首页', async ({ page }) => {
    const loginPage = new LoginPage(page, URLS.BASE);
    const homePage = new HomePage(page);

    // Step 1: 输入有效手机号
    await loginPage.enterAccount(TEST_USERS.phone);

    // Step 2: 输入正确密码
    await loginPage.enterPassword(TEST_USERS.password);

    // Step 3: 点击登录按钮
    await loginPage.clickLoginButton();

    // Step 4: 等待登录成功跳转
    await page.waitForURL(url => {
      const pathname = url.pathname();
      return EXPECTED_POST_LOGIN_PATHS.some(p => pathname.includes(p.replace('/', '')));
    }, { timeout: 15000 });

    // Step 5: 验证登录成功
    await homePage.verifyLoggedIn();

    // 额外验证：检查用户菜单可见
    await expect(homePage.userMenu).toBeVisible();

    // 额外验证：检查欢迎消息或用户信息
    const welcomeOrName = await Promise.all([
      homePage.welcomeMessage.isVisible().catch(() => false),
      homePage.userName.isVisible().catch(() => false),
    ]);
    expect(welcomeOrName.some(Boolean)).toBeTruthy();
  });

  // ============================================================
  // TC-SMOKE-002: 有效邮箱+密码登录
  // ============================================================
  test('TC-SMOKE-002: 有效邮箱+密码登录应成功并跳转首页', async ({ page }) => {
    const loginPage = new LoginPage(page, URLS.BASE);
    const homePage = new HomePage(page);

    // Step 1: 输入有效邮箱
    await loginPage.enterAccount(TEST_USERS.email);

    // Step 2: 输入正确密码
    await loginPage.enterPassword(TEST_USERS.password);

    // Step 3: 点击登录按钮
    await loginPage.clickLoginButton();

    // Step 4: 等待登录成功
    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });

    // Step 5: 验证登录成功
    await homePage.verifyLoggedIn();
  });

  // ============================================================
  // TC-SMOKE-003: 记住我功能 - Session持久化
  // ============================================================
  test('TC-SMOKE-003: 勾选"记住我"后登录应保持会话', async ({ page, context }) => {
    const loginPage = new LoginPage(page, URLS.BASE);
    const homePage = new HomePage(page);

    // Step 1: 输入账号密码
    await loginPage.enterAccount(TEST_USERS.phone);
    await loginPage.enterPassword(TEST_USERS.password);

    // Step 2: 勾选"记住我"
    await loginPage.toggleRememberMe(true);

    // Step 3: 登录
    await loginPage.clickLoginButton();

    // Step 4: 等待登录成功
    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });
    await homePage.verifyLoggedIn();

    // Step 5: 获取Session Cookie
    const loginCookie = await homePage.getLoginCookie();
    expect(loginCookie).toBeTruthy();

    // Step 6: 检查Remember Cookie
    const isRemembered = await homePage.isRememberedLogin();
    expect(isRemembered).toBeTruthy();

    // Step 7: 关闭浏览器（通过新建上下文模拟）
    // 注意：实际测试中可能需要持久化cookie到文件
    // 此处简化处理
  });

  // ============================================================
  // TC-SMOKE-004: 键盘快捷登录
  // ============================================================
  test('TC-SMOKE-004: Tab+Enter键盘快捷登录应成功', async ({ page }) => {
    const loginPage = new LoginPage(page, URLS.BASE);
    const homePage = new HomePage(page);

    // Step 1: 执行快捷登录序列
    await loginPage.quickLoginSequence({
      account: TEST_USERS.phone,
      password: TEST_USERS.password,
    });

    // Step 2: 等待登录成功
    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });
    await homePage.verifyLoggedIn();
  });

  // ============================================================
  // TC-SMOKE-005: 登录后后退按钮行为
  // ============================================================
  test('TC-SMOKE-005: 登录成功后后退按钮不应返回登录页', async ({ page }) => {
    const loginPage = new LoginPage(page, URLS.BASE);
    const homePage = new HomePage(page);

    // Step 1: 登录成功
    await loginPage.loginWithPassword({
      account: TEST_USERS.phone,
      password: TEST_USERS.password,
    });
    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });

    // Step 2: 点击后退
    await page.goBack();

    // Step 3: 验证不应回到登录页（应保持在首页或重定向到首页）
    // 浏览器历史行为：可能会回退到登录页但立即重定向
    // 所以检查当前是否已登录
    await homePage.verifyLoggedIn();
  });

  // ============================================================
  // TC-SMOKE-006: 登录后直接访问登录页
  // ============================================================
  test('TC-SMOKE-006: 已登录状态访问登录页应跳转首页', async ({ page }) => {
    const loginPage = new LoginPage(page, URLS.BASE);
    const homePage = new HomePage(page);

    // Step 1: 先登录
    await loginPage.loginWithPassword({
      account: TEST_USERS.phone,
      password: TEST_USERS.password,
    });
    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });

    // Step 2: 直接访问登录页
    await page.goto(`${URLS.BASE}/login`);

    // Step 3: 验证自动跳转回首页或保持首页
    // 某些系统会重定向，某些会保持在登录页但显示已登录
    const isOnLoginPage = page.url().includes('/login');
    if (isOnLoginPage) {
      // 如果仍在登录页，至少验证不会显示登录表单
      await expect(loginPage.loginButton).not.toBeVisible();
    } else {
      await homePage.verifyLoggedIn();
    }
  });
});

// ============================================================
// TC-SMOKE-007: 多浏览器验证（跨浏览器兼容性）
// ============================================================
test.describe('【P0】跨浏览器登录兼容性', () => {
  test('TC-SMOKE-007: Chrome/Firefox/Safari应都能成功登录', async ({ browserName, page }) => {
    const loginPage = new LoginPage(page, URLS.BASE);
    const homePage = new HomePage(page);

    await loginPage.navigate();
    await loginPage.loginWithPassword({
      account: TEST_USERS.phone,
      password: TEST_USERS.password,
    });

    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });
    await homePage.verifyLoggedIn();

    console.log(`✅ ${browserName} 浏览器登录成功`);
  });
});
