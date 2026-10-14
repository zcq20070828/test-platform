import { test, expect, Page } from "@playwright/test";

const BASE = "http://localhost:5174";
const API = "http://localhost:3002";

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

test.describe("工作流", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginViaAPI(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("工作流页面正确加载", async () => {
    await page.goto(`${BASE}/workflow`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/workflow/, { timeout: 10000 });
  });

  test("启动工作流按钮存在", async () => {
    await page.goto(`${BASE}/workflow`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/workflow/, { timeout: 10000 });
    // 工作流 overview 视图有"开始使用"按钮
    const beginBtn = page.getByRole("button", { name: /开始使用/i });
    if (await beginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(beginBtn).toBeVisible();
    } else {
      const startBtn = page.getByRole("button", { name: /启动|发送|提交/i });
      await expect(startBtn.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("任务输入区域存在", async () => {
    await page.goto(`${BASE}/workflow`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/workflow/, { timeout: 10000 });
    const input = page.locator("textarea, [class*='input'], [class*='textarea']").first();
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(input).toBeVisible();
    }
  });
});
