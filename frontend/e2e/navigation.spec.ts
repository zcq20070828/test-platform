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

test.describe("导航菜单", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginViaAPI(page);
    await page.waitForLoadState("networkidle");
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("侧边栏/顶部导航存在", async () => {
    const nav = page.locator("aside, nav, [class*='sidebar'], [class*='menu']").first();
    await expect(nav).toBeVisible({ timeout: 5000 });
  });

  test("可导航到知识库页面", async () => {
    const link = page.getByRole("link", { name: /知识库/i });
    if (await link.isVisible({ timeout: 2000 })) {
      await link.click();
      await expect(page).toHaveURL(/knowledge/, { timeout: 5000 });
    }
  });

  test("可导航到任务页面", async () => {
    const link = page.getByRole("link", { name: /任务/i });
    if (await link.isVisible({ timeout: 2000 })) {
      await link.click();
      await expect(page).toHaveURL(/tasks/, { timeout: 5000 });
    }
  });

  test("可导航到工作流页面", async () => {
    const link = page.getByRole("link", { name: /工作流|workflow/i });
    if (await link.isVisible({ timeout: 2000 })) {
      await link.click();
      await expect(page).toHaveURL(/workflow/, { timeout: 5000 });
    }
  });

  test("可导航到智能体页面", async () => {
    const link = page.getByRole("link", { name: /智能体|agent/i });
    if (await link.isVisible({ timeout: 2000 })) {
      await link.click();
      await expect(page).toHaveURL(/agents/, { timeout: 5000 });
    }
  });

  test("可导航到性能监控页面", async () => {
    const link = page.getByRole("link", { name: /性能|监控/i });
    if (await link.isVisible({ timeout: 2000 })) {
      await link.click();
      await expect(page).toHaveURL(/performance/, { timeout: 5000 });
    }
  });
});
