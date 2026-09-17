import { test as base, Page } from '@playwright/test'
import {
  LoginPage,
  RegisterPage,
  DashboardPage,
  AgentsPage,
  KnowledgePage,
  TasksPage,
  WorkflowPage,
  UserManagementPage
} from '../pages'

/**
 * 测试用户接口
 */
interface TestUser {
  email: string
  password: string
  username: string
  role: 'admin' | 'user'
}

/**
 * 扩展的测试 Fixtures
 */
export const test = base.extend<{
  loginPage: LoginPage
  registerPage: RegisterPage
  dashboardPage: DashboardPage
  agentsPage: AgentsPage
  knowledgePage: KnowledgePage
  tasksPage: TasksPage
  workflowPage: WorkflowPage
  userManagementPage: UserManagementPage
  testUser: TestUser
  authenticatedPage: Page
}>({
  // 页面对象 Fixtures
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page))
  },

  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page))
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page))
  },

  agentsPage: async ({ page }, use) => {
    await use(new AgentsPage(page))
  },

  knowledgePage: async ({ page }, use) => {
    await use(new KnowledgePage(page))
  },

  tasksPage: async ({ page }, use) => {
    await use(new TasksPage(page))
  },

  workflowPage: async ({ page }, use) => {
    await use(new WorkflowPage(page))
  },

  userManagementPage: async ({ page }, use) => {
    await use(new UserManagementPage(page))
  },

  // 测试用户 Fixture
  testUser: async ({}, use) => {
    const user: TestUser = {
      email: `test-${Date.now()}@example.com`,
      password: 'Test123!@#',
      username: `testuser-${Date.now()}`,
      role: 'user'
    }
    await use(user)
  },

  // 已认证的页面 Fixture - 使用正确的测试账号
  authenticatedPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()

    // 使用与后端 users.json 一致的测试账号
    const testCredentials = {
      username: process.env.TEST_USER_USERNAME || 'admin',
      password: process.env.TEST_USER_PASSWORD || 'I2ss56tb@'
    }

    // 执行登录
    await loginPage.login(testCredentials.username, testCredentials.password)

    // 等待登录成功跳转到仪表盘
    try {
      await page.waitForURL(/\/$|dashboard/i, { timeout: 15000 })
    } catch (error) {
      console.error('Login failed:', error)
      // 如果登录失败，输出页面内容以便调试
      const content = await page.content()
      console.error('Page content:', content.substring(0, 500))
      throw error
    }

    await use(page)
  },
})

export { expect } from '@playwright/test'
