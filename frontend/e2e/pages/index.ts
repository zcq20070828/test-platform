import { Page, Locator, expect } from '@playwright/test'

/**
 * 登录页面对象模型
 */
export class LoginPage {
  readonly page: Page
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly loginButton: Locator
  readonly registerLink: Locator
  readonly ssoButton: Locator
  readonly errorMessage: Locator
  readonly successMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.emailInput = page.getByPlaceholder(/用户名|Username/i)
    this.passwordInput = page.getByPlaceholder(/密码|Password/i)
    // Use .login-btn to avoid matching "未登录" nav button
    this.loginButton = page.locator('.login-btn')
    this.registerLink = page.getByRole('link', { name: /注册|Register/i })
    this.ssoButton = page.getByRole('button', { name: /SSO|统一认证/i })
    this.errorMessage = page.locator('.el-message--error, [role="alert"]')
    this.successMessage = page.locator('.el-message--success')
  }

  async goto() {
    await this.page.goto('/login')
    await this.page.waitForLoadState('networkidle')
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.loginButton.click()
  }

  async expectLoginSuccess() {
    await expect(this.page).toHaveURL(/\/$|dashboard/i, { timeout: 10000 })
  }

  async expectLoginError(message?: string) {
    await expect(this.errorMessage).toBeVisible({ timeout: 5000 })
    if (message) {
      await expect(this.errorMessage).toContainText(message)
    }
  }
}

/**
 * 注册页面对象模型
 */
export class RegisterPage {
  readonly page: Page
  readonly usernameInput: Locator
  readonly nameInput: Locator
  readonly passwordInput: Locator
  readonly confirmPasswordInput: Locator
  readonly registerButton: Locator
  readonly loginLink: Locator
  readonly errorMessage: Locator
  readonly successMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.usernameInput = page.getByPlaceholder(/用户名|Username/i)
    this.nameInput = page.getByPlaceholder(/姓名|Name/i)
    this.passwordInput = page.locator('input').nth(1) // username(0) + password(1)
    this.confirmPasswordInput = page.getByPlaceholder(/再次输入密码|Confirm/i)
    this.registerButton = page.getByRole('button', { name: /注册|Register/i })
    this.loginLink = page.getByRole('link', { name: /登录|Login/i })
    this.errorMessage = page.locator('.el-message--error, [role="alert"]')
    this.successMessage = page.locator('.el-message--success')
  }

  async goto() {
    await this.page.goto('/register')
    await this.page.waitForLoadState('networkidle')
  }

  async register(username: string, password: string, name?: string) {
    await this.usernameInput.fill(username)
    await this.passwordInput.fill(password)
    await this.confirmPasswordInput.fill(password)
    if (name) await this.nameInput.fill(name)
    await this.registerButton.click()
  }
}

/**
 * 仪表盘页面对象模型
 */
export class DashboardPage {
  readonly page: Page
  readonly welcomeMessage: Locator
  readonly statCards: Locator
  readonly quickTaskInput: Locator
  readonly agentSelector: Locator
  readonly realtimeLogs: Locator
  readonly navItems: Locator

  constructor(page: Page) {
    this.page = page
    this.welcomeMessage = page.locator('h1, .welcome').first()
    this.statCards = page.locator('.stat-card, [data-testid="stat-card"]')
    this.quickTaskInput = page.getByPlaceholder(/输入任务|Enter task/i)
    this.agentSelector = page.locator('.agent-selector, [data-testid="agent-selector"]')
    this.realtimeLogs = page.locator('.realtime-logs, [data-testid="realtime-logs"]')
    this.navItems = page.locator('nav a, .el-menu-item')
  }

  async goto() {
    await this.page.goto('/')
    // Dashboard uses SSE long connections, cannot use 'networkidle'
    await this.page.waitForLoadState('load')
    // Wait for Vue to mount and initial data to render
    await this.page.waitForSelector('[data-testid="dashboard-page"]', { timeout: 10000 })
  }

  async expectStatsVisible() {
    await expect(this.statCards.first()).toBeVisible({ timeout: 10000 })
  }

  async navigateTo(name: string) {
    await this.page.getByText(name, { exact: false }).first().click()
    await this.page.waitForURL('**', { timeout: 10000 })
  }
}

/**
 * 智能体列表页面对象模型
 */
export class AgentsPage {
  readonly page: Page
  readonly agentCards: Locator
  readonly searchInput: Locator
  readonly filterButtons: Locator

  constructor(page: Page) {
    this.page = page
    this.agentCards = page.locator('.agent-card, [data-testid="agent-card"]')
    this.searchInput = page.getByPlaceholder(/搜索|Search/i)
    this.filterButtons = page.locator('.filter-button, [data-testid="filter"]')
  }

  async goto() {
    await this.page.goto('/agents')
    await this.page.waitForLoadState('load')
    await this.page.waitForSelector('[data-testid="agents-page"], .agents-view', { timeout: 10000 }).catch(() => {})
  }

  async expectAgentsVisible() {
    await expect(this.agentCards.first()).toBeVisible({ timeout: 10000 })
  }

  async getAgentCount() {
    return await this.agentCards.count()
  }

  async clickAgent(name: string) {
    await this.agentCards.filter({ hasText: name }).first().click()
  }
}

/**
 * 知识库页面对象模型
 */
export class KnowledgePage {
  readonly page: Page
  readonly docList: Locator
  readonly searchInput: Locator
  readonly uploadButton: Locator
  readonly createButton: Locator
  readonly deleteButton: Locator

  constructor(page: Page) {
    this.page = page
    this.docList = page.locator('.el-table, [data-testid="knowledge-table"]')
    this.searchInput = page.getByPlaceholder(/搜索|Search/i)
    this.uploadButton = page.getByRole('button', { name: /上传|Upload/i })
    this.createButton = page.getByRole('button', { name: /创建|Create|新建/i })
    this.deleteButton = page.getByRole('button', { name: /删除|Delete/i })
  }

  async goto() {
    await this.page.goto('/knowledge')
    await this.page.waitForLoadState('load')
    await this.page.waitForSelector('[data-testid="knowledge-page"], .knowledge-view', { timeout: 10000 }).catch(() => {})
  }

  async expectDocsVisible() {
    await expect(this.docList.first()).toBeVisible({ timeout: 10000 })
  }

  async searchDoc(keyword: string) {
    await this.searchInput.fill(keyword)
    await this.page.keyboard.press('Enter')
    // Wait for search results to appear
    await this.page.waitForSelector('.el-table__row, [data-testid="knowledge-row"], .no-results', { timeout: 10000 }).catch(() => {})
  }
}

/**
 * 任务列表页面对象模型
 */
export class TasksPage {
  readonly page: Page
  readonly taskTable: Locator
  readonly taskRows: Locator
  readonly createButton: Locator
  readonly refreshButton: Locator
  readonly filterSelect: Locator

  constructor(page: Page) {
    this.page = page
    this.taskTable = page.locator('.el-table, [data-testid="task-table"]')
    this.taskRows = page.locator('.el-table__row, [data-testid="task-row"]')
    this.createButton = page.getByRole('button', { name: /创建|Create|新建/i })
    this.refreshButton = page.getByRole('button', { name: /刷新|Refresh/i })
    this.filterSelect = page.locator('.el-select, [data-testid="status-filter"]')
  }

  async goto() {
    await this.page.goto('/tasks')
    await this.page.waitForLoadState('load')
    await this.page.waitForSelector('[data-testid="tasks-page"], .tasks-view', { timeout: 10000 }).catch(() => {})
  }

  async expectTableVisible() {
    await expect(this.taskTable).toBeVisible({ timeout: 10000 })
  }

  async getTaskCount() {
    return await this.taskRows.count()
  }

  async refresh() {
    await this.refreshButton.click()
    // Wait for tasks to reload (not networkidle - SSE may keep connection open)
    await this.page.waitForSelector('.el-table__row, [data-testid="task-row"]', { timeout: 10000 }).catch(() => {})
  }
}

/**
 * 工作流页面对象模型
 */
export class WorkflowPage {
  readonly page: Page
  readonly overviewTab: Locator
  readonly executionTab: Locator
  readonly chatPanel: Locator
  readonly startButton: Locator
  readonly backButton: Locator
  readonly taskInput: Locator
  readonly sendMessage: Locator
  readonly phaseCards: Locator

  constructor(page: Page) {
    this.page = page
    this.overviewTab = page.getByRole('tab', { name: /概览|Overview/i })
    this.executionTab = page.getByRole('tab', { name: /执行|Execution/i })
    this.chatPanel = page.locator('#workflow-chat-messages, .quick-start, [data-testid="chat-panel"]')
    this.startButton = page.getByRole('button', { name: /启动|Start|开始/i })
    this.backButton = page.getByRole('button', { name: /返回|Back/i })
    this.taskInput = page.getByPlaceholder(/输入|Input|任务/i)
    this.sendMessage = page.getByRole('button', { name: /发送|Send/i })
    this.phaseCards = page.locator('.stage-card, [data-testid="stage-card"], [data-testid="phase-card"]')
  }

  async goto() {
    await this.page.goto('/workflow')
    // Workflow uses SSE long connections, cannot use 'networkidle'
    await this.page.waitForLoadState('load')
    await this.page.waitForSelector('[data-testid="workflow-page"], .workflow-view', { timeout: 10000 }).catch(() => {
      // Fallback: just wait briefly
    })
  }

  async expectOverviewVisible() {
    await expect(this.phaseCards.first()).toBeVisible({ timeout: 10000 })
  }

  async startWorkflow(task: string) {
    await this.taskInput.fill(task)
    await this.sendMessage.click()
  }

  async switchToExecution() {
    await this.executionTab.click()
    await this.page.waitForSelector('.task-list-view, [data-testid="task-list"]', { timeout: 10000 }).catch(() => {})
  }
}

/**
 * 用户管理页面对象模型
 */
export class UserManagementPage {
  readonly page: Page
  readonly userTable: Locator
  readonly userRows: Locator
  readonly createButton: Locator
  readonly searchInput: Locator

  constructor(page: Page) {
    this.page = page
    this.userTable = page.locator('.el-table, [data-testid="user-table"]')
    this.userRows = page.locator('.el-table__row, [data-testid="user-row"]')
    this.createButton = page.getByRole('button', { name: /创建|Create|新建|添加/i })
    this.searchInput = page.getByPlaceholder(/搜索|Search/i)
  }

  async goto() {
    await this.page.goto('/users')
    await this.page.waitForLoadState('load')
    await this.page.waitForSelector('[data-testid="users-page"], .user-management', { timeout: 10000 }).catch(() => {})
  }

  async expectTableVisible() {
    await expect(this.userTable).toBeVisible({ timeout: 10000 })
  }
}
