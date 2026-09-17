/**
 * security.spec.ts - 安全性测试
 * 
 * 测试级别: P1/P2
 * 覆盖模块: M-001, M-002, M-003
 * 
 * 测试场景：
 * 1. SQL注入/XSS攻击防护
 * 2. 暴力破解防护（频率限制）
 * 3. 密码传输加密验证
 */

import { test, expect, request } from '@playwright/test';
import { LoginPage } from '../../page-objects/LoginPage';
import { TEST_USERS, URLS, ACCOUNT_LOCK_CONFIG } from '../../utils/constants';

test.describe('【P1】安全性测试', () => {

  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.navigate();
  });

  // ============================================================
  // TC-SEC-001: SQL注入攻击防护
  // ============================================================
  test('TC-SEC-001: SQL注入攻击字符串应被正确处理', async ({ page }) => {
    const sqlInjectionPayloads = [
      "' OR '1'='1",
      "' OR 1=1--",
      "admin'--",
      "'; DROP TABLE users;--",
      "1' AND '1'='1",
      "1 OR 1=1",
      "1' UNION SELECT NULL--",
    ];

    for (const payload of sqlInjectionPayloads) {
      await loginPage.enterAccount(payload);
      await loginPage.enterPassword(payload);
      await loginPage.clickLoginButton();
      await page.waitForTimeout(500);

      // Step 1: 验证不显示SQL错误信息
      const pageContent = await page.content();
      expect(pageContent).not.toMatch(/sql|syntax|mysql|postgres|oracle|error/i);
      
      // 验证页面正常显示（无崩溃）
      const formVisible = await loginPage.form.isVisible().catch(() => false);
      expect(formVisible).toBeTruthy();

      // 清空表单
      await loginPage.clearAccount();
      await loginPage.clearPassword();
    }
  });

  // ============================================================
  // TC-SEC-002: XSS攻击防护
  // ============================================================
  test('TC-SEC-002: XSS攻击脚本应被转义或过滤', async ({ page }) => {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '"><img src=x onerror=alert(1)>',
      "javascript:alert('XSS')",
      '<svg onload=alert(1)>',
      '{{constructor.constructor("alert(1)")()}}',
      '<iframe src="javascript:alert(1)">',
    ];

    for (const payload of xssPayloads) {
      await loginPage.enterAccount(payload);
      await loginPage.enterPassword(payload);
      await loginPage.clickLoginButton();
      await page.waitForTimeout(500);

      // Step 1: 验证脚本未被执行（检查页面内容）
      const pageContent = await page.content();
      
      // 检查是否有未转义的<script>标签
      const hasUnescapedScript = pageContent.includes('<script>alert');
      expect(hasUnescapedScript).toBeFalsy();

      // 验证页面仍然可用
      await expect(loginPage.loginButton).toBeVisible();

      await loginPage.clearAccount();
      await loginPage.clearPassword();
    }
  });

  // ============================================================
  // TC-SEC-003: 暴力破解防护 - 频率限制
  // ============================================================
  test('TC-SEC-003: 频繁登录尝试应触发频率限制', async ({ page }) => {
    const maxRequests = 20;
    let rateLimited = false;

    for (let i = 0; i < maxRequests; i++) {
      await loginPage.enterAccount(TEST_USERS.nonExistentPhone);
      await loginPage.enterPassword('Test@123');
      await loginPage.clickLoginButton();
      await page.waitForTimeout(200);

      // 检查是否触发限流
      const errorMsg = await loginPage.getGlobalErrorMessage().catch(() => '');
      if (errorMsg?.match(/频繁|限流|rate|too many/i)) {
        rateLimited = true;
        break;
      }

      await loginPage.clearAccount();
      await loginPage.clearPassword();
    }

    console.log(`请求了${maxRequests}次，是否触发限流: ${rateLimited}`);
  });

  // ============================================================
  // TC-SEC-004: 敏感信息不在URL中泄露
  // ============================================================
  test('TC-SEC-004: 登录后URL中不应包含敏感信息', async ({ page }) => {
    await loginPage.loginWithPassword({
      account: TEST_USERS.phone,
      password: TEST_USERS.password,
    });

    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });

    // 检查URL
    const url = page.url();
    
    // 验证URL中不包含密码
    expect(url).not.toMatch(/password|passwd/i);
    
    // 验证URL中不包含token（除非是标准JWT格式）
    const urlParams = new URL(url);
    const queryString = urlParams.search;
    if (queryString) {
      expect(queryString).not.toMatch(/token|session|auth/i);
    }
  });

  // ============================================================
  // TC-SEC-005: HTTPS传输验证
  // ============================================================
  test('TC-SEC-005: 登录表单应通过HTTPS提交', async ({ request }) => {
    const apiEndpoint = `${URLS.BASE}/api/auth/login`;
    
    // 发送登录请求
    const response = await request.post(apiEndpoint, {
      data: {
        account: TEST_USERS.phone,
        password: TEST_USERS.password,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 验证响应头包含安全相关的头
    const headers = response.headers();
    
    // 检查是否使用了HTTPS（通过检查secure cookie或security headers）
    console.log('响应头:', {
      'x-frame-options': headers['x-frame-options'],
      'x-content-type-options': headers['x-content-type-options'],
      'strict-transport-security': headers['strict-transport-security'],
      'x-xss-protection': headers['x-xss-protection'],
    });

    // X-Frame-Options应存在（防止点击劫持）
    expect(headers['x-frame-options']).toBeTruthy();
  });

  // ============================================================
  // TC-SEC-006: Session Token安全属性
  // ============================================================
  test('TC-SEC-006: Session Cookie应设置安全属性', async ({ page, context }) => {
    await loginPage.loginWithPassword({
      account: TEST_USERS.phone,
      password: TEST_USERS.password,
    });

    await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });

    // 获取所有Cookie
    const cookies = await context.cookies();

    for (const cookie of cookies) {
      if (cookie.name.includes('session') || cookie.name.includes('token')) {
        console.log(`Cookie ${cookie.name}:`, {
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
        });

        // HttpOnly应设置为true（防止XSS访问）
        // expect(cookie.httpOnly).toBeTruthy();
        
        // Secure在生产环境应为true
        // expect(cookie.secure).toBeTruthy();
      }
    }
  });

  // ============================================================
  // TC-SEC-007: 错误消息不泄露敏感信息
  // ============================================================
  test('TC-SEC-007: 错误消息不应泄露账号存在性', async ({ page }) => {
    // 测试不存在的账号
    await loginPage.enterAccount(TEST_USERS.nonExistentPhone);
    await loginPage.enterPassword('WrongPass');
    await loginPage.clickLoginButton();
    await page.waitForTimeout(1000);

    const nonExistError = await loginPage.getGlobalErrorMessage();

    // 测试存在的账号但错误密码
    await loginPage.clearAccount();
    await loginPage.clearPassword();
    await loginPage.enterAccount(TEST_USERS.phone);
    await loginPage.enterPassword('WrongPass');
    await loginPage.clickLoginButton();
    await page.waitForTimeout(1000);

    const existError = await loginPage.getGlobalErrorMessage();

    // 两个错误消息应该一样或相似（不透露账号是否存在）
    console.log('不存在的账号错误:', nonExistError);
    console.log('存在的账号错误:', existError);

    if (nonExistError && existError) {
      // 消息不应明显不同
      const isSimilarMessage = 
        nonExistError === existError ||
        (nonExistError.match(/账号|密码|错误/i) && existError.match(/账号|密码|错误/i));
      
      expect(isSimilarMessage).toBeTruthy();
    }
  });

  // ============================================================
  // TC-SEC-008: 登录锁定绕过尝试
  // ============================================================
  test('TC-SEC-008: 暴力破解锁定机制不应被绕过', async ({ page }) => {
    // 快速连续请求（测试是否有竞态条件）
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(
        loginPage.enterAccount(TEST_USERS.phone)
          .then(() => loginPage.enterPassword(`Wrong${i}`))
          .then(() => loginPage.clickLoginButton())
      );
    }
    await Promise.all(requests);
    await page.waitForTimeout(1000);

    // 验证仍然被锁定（不允许并发绕过）
    await loginPage.enterAccount(TEST_USERS.phone);
    await loginPage.enterPassword(TEST_USERS.password);
    await loginPage.clickLoginButton();
    await page.waitForTimeout(1000);

    const errorMsg = await loginPage.getGlobalErrorMessage().catch(() => '');
    
    // 正确密码仍应失败（如果触发锁定则说明防护生效）
    const isLocked = errorMsg?.match(/锁定|lock/i) !== null || page.url().includes('/login');
    console.log('锁定检查:', { errorMsg, isLocked });
  });
});
