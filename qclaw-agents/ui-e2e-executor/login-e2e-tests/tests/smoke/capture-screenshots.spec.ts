/**
 * capture-screenshots.spec.ts - 截取测试场景截图作为报告证据
 */

import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:3000';

const VALID_USER = { account: 'admin', password: 'Test@123' };
const WRONG_PASSWORD = 'WrongPass!@#';
const NONEXISTENT_ACCOUNT = 'nonexistent_user_xyz';

const SCREENSHOT_DIR = path.resolve(__dirname, '../../reports/screenshots');

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test.describe('截图记录 - 测试场景证据', () => {

  test('SC-001: 正向用例 - 正确用户名密码 → 登录成功首页', async ({ page }) => {
    await page.goto(`${BASE_URL}/mock-login.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    // 填写表单
    await page.fill('[data-testid="account-input"]', VALID_USER.account);
    await page.fill('[data-testid="password-input"]', VALID_USER.password);
    await page.click('[data-testid="login-button"]');

    // 等待跳转到首页
    await page.waitForURL('**/mock-home.html', { timeout: 10000 });
    await page.waitForTimeout(500);

    // 截图首页
    await page.screenshot({ 
      path: path.join(SCREENSHOT_DIR, 'TC-LOGIN-001-login-success.png'),
      fullPage: true 
    });
  });

  test('SC-002: 反向用例 - 错误密码 → 密码错误提示', async ({ page }) => {
    await page.goto(`${BASE_URL}/mock-login.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    await page.fill('[data-testid="account-input"]', VALID_USER.account);
    await page.fill('[data-testid="password-input"]', WRONG_PASSWORD);
    await page.click('[data-testid="login-button"]');

    // 等待错误提示
    await page.waitForSelector('[data-testid="global-error"].visible', { timeout: 5000 });
    await page.waitForTimeout(300);

    await page.screenshot({ 
      path: path.join(SCREENSHOT_DIR, 'TC-LOGIN-002-wrong-password.png'),
      fullPage: true 
    });
  });

  test('SC-003: 反向用例 - 不存在的账号 → 账号不存在提示', async ({ page }) => {
    await page.goto(`${BASE_URL}/mock-login.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    await page.fill('[data-testid="account-input"]', NONEXISTENT_ACCOUNT);
    await page.fill('[data-testid="password-input"]', VALID_USER.password);
    await page.click('[data-testid="login-button"]');

    // 等待错误提示
    await page.waitForSelector('[data-testid="global-error"].visible', { timeout: 5000 });
    await page.waitForTimeout(300);

    await page.screenshot({ 
      path: path.join(SCREENSHOT_DIR, 'TC-LOGIN-003-nonexistent-account.png'),
      fullPage: true 
    });
  });
});
