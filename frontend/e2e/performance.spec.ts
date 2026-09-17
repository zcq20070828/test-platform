import { test, expect, Page } from "@playwright/test";

const BASE = "http://localhost:5174";
const API = "http://localhost:3888";

async function loginViaAPI(page: Page) {
  const timestamp = Date.now();
  const testUser = `e2e_${timestamp}`;
  await page.request.post(`${API}/api/auth/register`, {
    data: { username: testUser, password: "Test123456" }
  });
  const res = await page.request.post(`${API}/api/auth/login`, {
    data: { username: testUser, password: "Test123456" }
  });
  const body = await res.json();
  const { token = "", user = null } = body;
  await page.goto(`${BASE}/login`);
  await page.evaluate(
    ({ token, user }: { token: string; user: unknown }) => {
      localStorage.setItem("token", token);
      if (user) localStorage.setItem("user", JSON.stringify(user));
      localStorage.setItem("__test_auth__", "true");
    },
    { token, user }
  );
}

test.describe("性能监控", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginViaAPI(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("性能监控页面正确加载", async () => {
    await page.goto(`${BASE}/performance`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/performance/, { timeout: 10000 });
  });

  test("PerformanceMonitor组件渲染", async () => {
    await page.goto(`${BASE}/performance`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/performance/, { timeout: 10000 });
    const content = page.locator(".el-main, [class*='main'], [class*='panel']").first();
    await expect(content).toBeVisible({ timeout: 5000 });
  });

  test("页面加载时间小于5秒", async () => {
    const start = Date.now();
    await page.goto(`${BASE}/performance`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(/\/performance/, { timeout: 10000 });
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(5000);
  });
});
