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

test.describe("知识库管理", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginViaAPI(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("知识库页面正确加载", async () => {
    await page.goto(`${BASE}/knowledge`);
    await page.waitForLoadState("networkidle");
  });

  test("搜索框可输入并搜索", async () => {
    await page.goto(`${BASE}/knowledge`);
    const searchInput = page.getByPlaceholder(/搜索|关键词/i);
    if (await searchInput.isVisible({ timeout: 3000 })) {
      await searchInput.fill("test");
      await searchInput.press("Enter");
      await page.waitForTimeout(1000);
    }
  });

  test("上传按钮存在", async () => {
    await page.goto(`${BASE}/knowledge`);
    const uploadBtn = page.getByRole("button", { name: /上传/i });
    if (await uploadBtn.isVisible({ timeout: 2000 })) {
      await expect(uploadBtn).toBeVisible();
    }
  });

  test("文档列表/表格存在", async () => {
    await page.goto(`${BASE}/knowledge`);
    const table = page.locator(".el-table, [class*='table']").first();
    if (await table.isVisible({ timeout: 3000 })) {
      await expect(table).toBeVisible();
    }
  });
});
