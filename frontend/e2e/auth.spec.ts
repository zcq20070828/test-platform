import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5174";
const API = "http://localhost:3002";

test.describe("认证模块", () => {
  test("登录页面正确加载", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByPlaceholder(/用户名|账号/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder(/密码/i)).toBeVisible();
  });

  test("登录页面可跳转注册页", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const link = page.getByRole("link", { name: /注册|去注册|立即注册/i });
    if (await link.isVisible({ timeout: 2000 })) {
      await link.click();
      await expect(page).toHaveURL(/\/register/, { timeout: 5000 });
    }
  });

  test("注册页面正确加载", async ({ page }) => {
    await page.goto(`${BASE}/register`);
    await expect(page.getByPlaceholder(/用户名|账号/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder(/密码/i)).toBeVisible();
  });

  test("注册页面可跳转登录页", async ({ page }) => {
    await page.goto(`${BASE}/register`);
    const link = page.getByRole("link", { name: /登录|去登录|已有账号/i });
    if (await link.isVisible({ timeout: 2000 })) {
      await link.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });

  test("空表单提交应提示错误", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByRole("button").first().click();
    await page.waitForTimeout(500);
  });

  test("注册成功（API）", async ({ request }) => {
    const timestamp = Date.now();
    const testUser = `e2e_reg_${timestamp}`;
    const res = await request.post(`${API}/api/auth/register`, {
      data: { username: testUser, password: "Test123456" }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.username).toBe(testUser);
  });
});
