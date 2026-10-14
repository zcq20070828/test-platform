import { test, expect, Page } from "@playwright/test";

const BASE = "http://localhost:5174";
const API = "http://localhost:3002";

test.describe("智能体管理", () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();

    // 使用现有的管理员账号登录
    const loginRes = await page.request.post(`${API}/api/auth/login`, {
      data: { username: "admin", password: "I2ss56tb@" }
    });

    const body = await loginRes.json();
    const { token, user } = body;

    // 访问登录页并设置认证状态
    await page.goto(`${BASE}/login`);
    await page.evaluate(
      ({ token, user }: { token: string; user: any }) => {
        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(user));
      },
      { token, user }
    );

    // 导航到主页以确保认证生效
    await page.goto(`${BASE}/`);
    await page.waitForLoadState("networkidle");
  });

  test.afterEach(async () => {
    await page.close();
  });

  test("智能体页面正确加载", async () => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/agents/, { timeout: 15000 });

    // 检查页面标题
    const title = page.locator("h2, .page-title");
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test("页面包含布局容器", async () => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/agents/, { timeout: 15000 });

    // 检查布局容器
    const content = page.locator("[data-testid=\"agents-page\"]").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("刷新页面能正常加载", async () => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/agents/, { timeout: 15000 });

    // 刷新页面
    await page.reload();
    await page.waitForLoadState("networkidle");

    // 应该仍在智能体页面（不会重定向到登录）
    await expect(page).toHaveURL(/\/agents/, { timeout: 15000 });
  });

  test("智能体卡片显示必要信息", async () => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/agents/, { timeout: 15000 });

    // 等待智能体数据加载
    await page.waitForTimeout(2000);

    // 检查智能体卡片
    const agentCards = page.locator(".agent-card");
    const cardCount = await agentCards.count();

    // 应该至少有一个智能体卡片
    if (cardCount > 0) {
      const firstCard = agentCards.first();

      // 检查卡片包含必要信息
      await expect(firstCard).toBeVisible();

      // 检查智能体名称
      const agentName = firstCard.locator(".agent-name");
      await expect(agentName).toBeVisible();

      // 检查智能体描述
      const agentDesc = firstCard.locator(".agent-desc");
      await expect(agentDesc).toBeVisible();
    }
  });

  test("智能体卡片可点击", async () => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/agents/, { timeout: 15000 });

    // 等待智能体数据加载
    await page.waitForTimeout(2000);

    const agentCards = page.locator(".agent-card");
    const cardCount = await agentCards.count();

    if (cardCount > 0) {
      // 点击第一个智能体卡片
      await agentCards.first().click();

      // 等待交互响应
      await page.waitForTimeout(1000);

      // 页面应该正常响应（不会崩溃）
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("智能体状态正确显示", async () => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/agents/, { timeout: 15000 });

    // 等待智能体数据加载
    await page.waitForTimeout(2000);

    // 检查智能体列表是否加载
    const agentCards = page.locator(".agent-card");
    const count = await agentCards.count();

    // 应该有智能体数据
    expect(count).toBeGreaterThan(0);
  });
});
