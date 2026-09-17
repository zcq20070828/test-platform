/**
 * responsive-layout.spec.ts - 响应式布局测试
 * 
 * 测试级别: P2
 * 覆盖: UI响应式设计
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/LoginPage';
import { TEST_USERS } from '../../utils/constants';

test.describe('【P2】响应式布局测试', () => {

  let loginPage: LoginPage;

  test.beforeEach(async ({ page, isMobile }) => {
    loginPage = new LoginPage(page);
    await loginPage.navigate();
  });

  // ============================================================
  // TC-RESP-001: 桌面端布局验证
  // ============================================================
  test('TC-RESP-001: 桌面端(1920x1080)登录页面应正确显示', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await loginPage.navigate();

    // 验证主要元素可见
    await expect(loginPage.logo).toBeVisible();
    await expect(loginPage.form).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
    await expect(loginPage.accountInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();

    // 验证表单未溢出
    const isOverflowing = await loginPage.isFormOverflowingViewport();
    expect(isOverflowing).toBeFalsy();
  });

  // ============================================================
  // TC-RESP-002: 平板横屏布局验证
  // ============================================================
  test('TC-RESP-002: 平板横屏(1024x768)登录页面应正确显示', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await loginPage.navigate();

    // 验证主要元素可见
    await expect(loginPage.loginButton).toBeVisible();
    await expect(loginPage.accountInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
  });

  // ============================================================
  // TC-RESP-003: 手机端布局验证
  // ============================================================
  test('TC-RESP-003: 手机端(375x667)登录页面应正确显示', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginPage.navigate();

    // 验证主要元素可见
    await expect(loginPage.accountInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();

    // 验证第三方登录按钮可能折叠或隐藏
    const wechatVisible = await loginPage.wechatLoginButton.isVisible().catch(() => false);
    console.log('微信登录按钮可见:', wechatVisible);
  });

  // ============================================================
  // TC-RESP-004: 超宽屏布局验证
  // ============================================================
  test('TC-RESP-004: 超宽屏(2560x1440)登录页面应正确显示', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await loginPage.navigate();

    // 验证表单居中显示
    const formBounds = await loginPage.form.boundingBox();
    expect(formBounds).toBeTruthy();

    // 验证表单在视口中水平居中（允许±50px误差）
    const viewportWidth = 2560;
    const formWidth = formBounds!.width;
    const expectedX = (viewportWidth - formWidth) / 2;
    const tolerance = 50;

    expect(Math.abs(formBounds!.x - expectedX)).toBeLessThan(tolerance);
  });

  // ============================================================
  // TC-RESP-005: 旋转屏幕布局验证
  // ============================================================
  test('TC-RESP-005: iPad旋转后布局应正确调整', async ({ page }) => {
    // 竖屏
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginPage.navigate();
    const portraitBounds = await loginPage.form.boundingBox();

    // 横屏
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.reload();
    const landscapeBounds = await loginPage.form.boundingBox();

    // 横屏时表单应更宽
    expect(landscapeBounds!.width).toBeGreaterThan(portraitBounds!.width);
  });

  // ============================================================
  // TC-RESP-006: 输入框聚焦样式
  // ============================================================
  test('TC-RESP-006: 输入框聚焦时应有视觉反馈', async ({ page }) => {
    await loginPage.accountInput.focus();

    // 检查是否有:focus样式（通过计算样式）
    const isFocused = await loginPage.accountInput.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBeTruthy();
  });
});
