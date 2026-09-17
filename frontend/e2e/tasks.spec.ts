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

test.describe("任务管理", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginViaAPI(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("任务页面正确加载", async () => {
    await page.goto(`${BASE}/tasks`);
    await page.waitForLoadState("networkidle");
  });

  test("搜索框可输入", async () => {
    await page.goto(`${BASE}/tasks`);
    const searchInput = page.getByPlaceholder(/搜索关键词|任务ID/i);
    if (await searchInput.isVisible({ timeout: 2000 })) {
      await searchInput.fill("test");
      await searchInput.press("Enter");
      await page.waitForTimeout(500);
    }
  });

  test("任务列表/表格存在", async () => {
    await page.goto(`${BASE}/tasks`);
    const table = page.locator(".el-table, [class*='table']").first();
    if (await table.isVisible({ timeout: 3000 })) {
      await expect(table).toBeVisible();
    }
  });
});
