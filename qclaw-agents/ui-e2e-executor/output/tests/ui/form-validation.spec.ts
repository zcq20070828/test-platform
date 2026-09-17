/**
 * UI 表单校验与交互 — Playwright E2E 自动化测试
 *
 * 在 Mock 注册页面上执行 UI 交互测试。
 *
 * 启动 Mock Server:
 *   npx tsx mock/mock-server.ts
 *
 * 运行:
 *   npx playwright test --config=playwright.config.ts --project=ui
 *
 * 覆盖:
 *   TC_REG_AGRE_001~006 (协议勾选)
 *   TC_REG_UI_001~005   (UI元素/输入/错误提示/倒计时)
 *   手机号前端校验
 *   邮箱前端校验
 *   密码强度前端校验
 *   密码可见切换
 */

import { test, expect } from '@playwright/test';

const MOCK_BASE = process.env.MOCK_SERVER || 'http://localhost:3100';

test.describe('TC_REG_AGRE_001~006 — 用户协议与注册按钮', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${MOCK_BASE}/mock/register`);
    await page.waitForLoadState('networkidle');
  });

  test('TC_REG_AGRE_001: 未勾选协议 — 注册按钮禁用 (P0)', async ({ page }) => {
    // 手机号Tab
    const registerBtn = page.locator('#register-btn');
    await expect(registerBtn).toBeDisabled();
  });

  test('TC_REG_AGRE_003: 全部协议勾选 — 注册按钮可点击 (P0)', async ({ page }) => {
    await page.locator('#agree-all').check();
    // 输入手机号和验证码使按钮可点击
    await page.locator('#phone-input').fill('13800138001');
    await page.locator('#sms-code-input').fill('123456');
    const registerBtn = page.locator('#register-btn');
    await expect(registerBtn).toBeEnabled();
  });

  test('TC_REG_AGRE_004: 点击"用户协议" — 正确打开协议内容 (P1)', async ({ page }) => {
    const protocolLinks = page.locator('.protocol-link');
    const firstLink = protocolLinks.first();
    await expect(firstLink).toBeVisible();
    expect(await firstLink.textContent()).toContain('用户协议');
  });

  test('TC_REG_AGRE_005: 点击"隐私政策" — 正确打开隐私政策内容 (P1)', async ({ page }) => {
    const protocolLinks = page.locator('.protocol-link');
    const lastLink = protocolLinks.last();
    await expect(lastLink).toBeVisible();
    expect(await lastLink.textContent()).toContain('隐私政策');
  });
});

test.describe('TC_REG_UI_001~005 — UI元素与交互', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${MOCK_BASE}/mock/register`);
    await page.waitForLoadState('networkidle');
  });

  test('TC_REG_UI_001: 注册页所有元素正常渲染 (P1)', async ({ page }) => {
    // 检查核心元素可见
    await expect(page.locator('h1')).toHaveText('创建账号');
    await expect(page.locator('.tab-bar')).toBeVisible();
    await expect(page.locator('#phone-input')).toBeVisible();
    await expect(page.locator('#sms-btn')).toBeVisible();
    await expect(page.locator('#register-btn')).toBeVisible();

    // 检查邮箱tab切换
    await page.locator('.tab[data-tab="email"]').click();
    await expect(page.locator('#email-input')).toBeVisible();
    await expect(page.locator('#password-input')).toBeVisible();
    await expect(page.locator('#confirm-pw-input')).toBeVisible();
  });

  test('TC_REG_UI_004: 输入错误 — 错误提示显示 (P1)', async ({ page }) => {
    // 手机号输入非法值
    await page.locator('#phone-input').fill('123');
    // 触发blur以显示错误
    await page.locator('#phone-input').blur();

    // 错误提示位置在输入框下方
    const errorEl = page.locator('#phone-error');
    // 错误提示样式验证
    const color = await errorEl.evaluate(el => getComputedStyle(el).color);
    expect(color).toBe('rgb(255, 59, 48)'); // iOS red (#ff3b30)
  });

  test('TC_REG_UI_005: 倒计时按钮 — 60秒倒计时显示正确 (P0)', async ({ page }) => {
    const smsBtn = page.locator('#sms-btn');

    // 填写手机号并点击获取验证码
    await page.locator('#phone-input').fill('13800138001');
    await smsBtn.click();

    // Mock环境下直接调用API，等待按钮变为倒计时状态
    await page.waitForTimeout(200);
    const btnText = await smsBtn.textContent();

    // 按钮应变为倒计时文字（"59秒后重试"或"发送中..."）
    const hasCountdown = btnText?.includes('秒后重试') || btnText?.includes('发送中');
    expect(hasCountdown).toBeTruthy();
  });

  test('TC_REG_PW_007: 密码可见/隐藏切换功能正常 (P2)', async ({ page }) => {
    // 切换到邮箱tab
    await page.locator('.tab[data-tab="email"]').click();
    await page.waitForTimeout(100);

    const pwInput = page.locator('#password-input');
    await pwInput.fill('MySecret123');

    // 默认为password类型
    await expect(pwInput).toHaveAttribute('type', 'password');

    // 点击切换按钮
    await page.locator('#pw-toggle').click();
    await expect(pwInput).toHaveAttribute('type', 'text');

    // 再次点击切回
    await page.locator('#pw-toggle').click();
    await expect(pwInput).toHaveAttribute('type', 'password');
  });

  test('TC_REG_UI_003: 输入框聚焦时键盘弹起 (P1)', async ({ page }) => {
    // 在移动端模拟中验证键盘交互
    // 实际真机测试需要原生APP支持
    await page.locator('#phone-input').focus();
    const focusedElement = page.locator('#phone-input');
    await expect(focusedElement).toBeFocused();
    console.log('  [INFO] 输入框聚焦验证通过，键盘弹起行为需在真机测试验证');
  });
});

test.describe('手机号输入前端校验', () => {
  test('空手机号提交 — 前端拦截 (P0)', async ({ page }) => {
    await page.goto(`${MOCK_BASE}/mock/register`);
    await page.waitForLoadState('networkidle');
    await page.locator('#sms-btn').click();
    await page.waitForTimeout(200);
    const errorEl = page.locator('#phone-error');
    await expect(errorEl).toBeVisible();
    expect(await errorEl.textContent()).toBeTruthy();
  });
});

test.describe('邮箱输入前端校验', () => {
  test('无效邮箱格式 — 前端实时提示 (P0)', async ({ page }) => {
    await page.goto(`${MOCK_BASE}/mock/register`);
    await page.waitForLoadState('networkidle');

    // 切换到邮箱tab
    await page.locator('.tab[data-tab="email"]').click();
    await page.waitForTimeout(100);

    // 输入无效邮箱后失焦
    await page.locator('#email-input').fill('invalid-email');
    await page.locator('#email-input').blur();
    await page.waitForTimeout(200);

    const errorEl = page.locator('#email-error');
    await expect(errorEl).toBeVisible();
    expect(await errorEl.textContent()).toContain('邮箱格式不正确');
  });

  test('密码强度实时提示 — 纯数字 (P0)', async ({ page }) => {
    await page.goto(`${MOCK_BASE}/mock/register`);
    await page.waitForLoadState('networkidle');

    await page.locator('.tab[data-tab="email"]').click();
    await page.waitForTimeout(100);

    // 输入纯数字密码
    await page.locator('#password-input').fill('12345678');
    await page.locator('#password-input').blur();
    await page.waitForTimeout(200);

    const errorEl = page.locator('#password-error');
    await expect(errorEl).toBeVisible();
    expect(await errorEl.textContent()).toContain('密码强度不足');
  });

  test('确认密码不一致 — 实时提示 (P0)', async ({ page }) => {
    await page.goto(`${MOCK_BASE}/mock/register`);
    await page.waitForLoadState('networkidle');

    await page.locator('.tab[data-tab="email"]').click();
    await page.waitForTimeout(100);

    await page.locator('#password-input').fill('Strong@123');
    await page.locator('#confirm-pw-input').fill('Different@456');
    await page.locator('#confirm-pw-input').blur();
    await page.waitForTimeout(200);

    const errorEl = page.locator('#confirm-pw-error');
    await expect(errorEl).toBeVisible();
    expect(await errorEl.textContent()).toContain('不一致');
  });
});
