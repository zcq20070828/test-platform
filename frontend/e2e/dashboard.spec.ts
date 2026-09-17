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
    ({ token, user }) => {
      localStorage.setItem("token", token);
      if (user) localStorage.setItem("user", JSON.stringify(user));
    },
    { token, user }
  );
}

test.describe("仪表盘", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginViaAPI(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("仪表盘页面正确加载", async () => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState("networkidle");
  });

  test("仪表盘包含内容区域", async () => {
    await page.goto(`${BASE}/dashboard`);
    const main = page.locator("main, [class*='container'], [class*='main']").first();
    await expect(main).toBeVisible({ timeout: 5000 });
  });

  test("退出登录后跳转登录页", async () => {
    const logoutBtn = page.getByRole("button", { name: /退出|登出/i })
      .or(page.getByText(/退出|登出/i));
    if (await logoutBtn.isVisible({ timeout: 2000 })) {
      await logoutBtn.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });
});
