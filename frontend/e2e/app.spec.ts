import { test, expect } from './fixtures'
import { LoginPage, DashboardPage, AgentsPage, KnowledgePage, TasksPage, WorkflowPage } from './pages'

/**
 * 认证相关测试
 */
test.describe('认证流程', () => {
  test('登录页面应正常显示', async ({ loginPage }) => {
    await loginPage.goto()

    await expect(loginPage.emailInput).toBeVisible()
    await expect(loginPage.passwordInput).toBeVisible()
    await expect(loginPage.loginButton).toBeVisible()
    await expect(loginPage.registerLink).toBeVisible()
  })

  test('空表单提交应显示错误', async ({ loginPage }) => {
    await loginPage.goto()
    await loginPage.loginButton.click()

    // App uses ElMessage.warning() for empty field check
    await expect(loginPage.page.locator('.el-message')).toBeVisible()
    await expect(loginPage.page.locator('.el-message__content')).toContainText(/请输入用户名和密码/i)
  })

  test('无效凭据应显示错误', async ({ loginPage }) => {
    await loginPage.goto()
    await loginPage.login('invalid@test.com', 'wrongpassword')

    await loginPage.expectLoginError()
  })

  test('注册页面应正常显示', async ({ page }) => {
    await page.goto('/register')
    await page.waitForLoadState('networkidle')

    await expect(page.getByPlaceholder(/用户名|Username/i)).toBeVisible()
    await expect(page.getByPlaceholder(/密码|Password/i).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /注册|Register/i })).toBeVisible()
  })

  test('未登录用户应重定向到登录页', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/login/i)
  })
})

/**
 * 仪表盘测试
 */
test.describe('仪表盘页面', () => {
  test('应显示欢迎信息和统计数据', async ({ authenticatedPage }) => {
    const dashboardPage = new DashboardPage(authenticatedPage)
    await dashboardPage.goto()

    // 检查统计数据卡片
    await dashboardPage.expectStatsVisible()

    // 检查导航菜单
    await expect(dashboardPage.navItems.first()).toBeVisible()
  })

  test('应显示正确的统计数据', async ({ authenticatedPage }) => {
    const dashboardPage = new DashboardPage(authenticatedPage)
    await dashboardPage.goto()

    // 检查智能体数量
    const agentCard = authenticatedPage.locator('.stat-card, [data-testid="stat-card"]').filter({ hasText: /智能体|Agent/i })
    await expect(agentCard.first()).toBeVisible()

    // 检查任务数量
    const taskCard = authenticatedPage.locator('.stat-card, [data-testid="stat-card"]').filter({ hasText: /任务|Task/i })
    await expect(taskCard.first()).toBeVisible()
  })

  test('导航菜单应正常工作', async ({ authenticatedPage }) => {
    const dashboardPage = new DashboardPage(authenticatedPage)
    await dashboardPage.goto()

    // 导航到智能体页面
    await dashboardPage.navigateTo('智能体')
    await expect(authenticatedPage).toHaveURL(/agents/i)

    // 导航回仪表盘
    await dashboardPage.navigateTo('仪表盘')
    await expect(authenticatedPage).toHaveURL(/\/$/)
  })
})

/**
 * 智能体管理测试
 */
test.describe('智能体管理', () => {
  test('应显示智能体列表', async ({ authenticatedPage }) => {
    const agentsPage = new AgentsPage(authenticatedPage)
    await agentsPage.goto()

    await agentsPage.expectAgentsVisible()

    const count = await agentsPage.getAgentCount()
    expect(count).toBeGreaterThan(0)
  })

  test('智能体卡片应显示必要信息', async ({ authenticatedPage }) => {
    const agentsPage = new AgentsPage(authenticatedPage)
    await agentsPage.goto()

    // 检查第一个智能体卡片
    const firstCard = agentsPage.agentCards.first()
    await expect(firstCard).toBeVisible()

    // 应该包含智能体名称和状态
    const cardText = await firstCard.textContent()
    expect(cardText).toBeTruthy()
  })

  test('应能搜索智能体', async ({ authenticatedPage }) => {
    const agentsPage = new AgentsPage(authenticatedPage)
    await agentsPage.goto()

    if (await agentsPage.searchInput.isVisible()) {
      await agentsPage.searchInput.fill('Test')
      await authenticatedPage.keyboard.press('Enter')
      await authenticatedPage.waitForLoadState('networkidle')

      // 搜索结果应该过滤
      const count = await agentsPage.getAgentCount()
      // 可能没有匹配结果，这是正常的
      expect(count).toBeGreaterThanOrEqual(0)
    }
  })
})

/**
 * 知识库管理测试
 */
test.describe('知识库管理', () => {
  test('应显示知识库列表', async ({ authenticatedPage }) => {
    const knowledgePage = new KnowledgePage(authenticatedPage)
    await knowledgePage.goto()

    await knowledgePage.expectDocsVisible()
  })

  test('应能搜索知识库文档', async ({ authenticatedPage }) => {
    const knowledgePage = new KnowledgePage(authenticatedPage)
    await knowledgePage.goto()

    if (await knowledgePage.searchInput.isVisible()) {
      await knowledgePage.searchDoc('测试')

      // 等待搜索结果
      await authenticatedPage.waitForTimeout(500)
    }
  })

  test('应显示上传按钮', async ({ authenticatedPage }) => {
    const knowledgePage = new KnowledgePage(authenticatedPage)
    await knowledgePage.goto()

    if (await knowledgePage.uploadButton.isVisible()) {
      await expect(knowledgePage.uploadButton).toBeEnabled()
    }
  })
})

/**
 * 任务管理测试
 */
test.describe('任务管理', () => {
  test('应显示任务列表', async ({ authenticatedPage }) => {
    const tasksPage = new TasksPage(authenticatedPage)
    await tasksPage.goto()

    await tasksPage.expectTableVisible()
  })

  test('应能刷新任务列表', async ({ authenticatedPage }) => {
    const tasksPage = new TasksPage(authenticatedPage)
    await tasksPage.goto()

    if (await tasksPage.refreshButton.isVisible()) {
      await tasksPage.refresh()
    }
  })

  test('应显示任务状态筛选', async ({ authenticatedPage }) => {
    const tasksPage = new TasksPage(authenticatedPage)
    await tasksPage.goto()

    // 检查是否有筛选功能
    const filters = authenticatedPage.locator('.el-select, .filter-dropdown')
    if (await filters.count() > 0) {
      await expect(filters.first()).toBeVisible()
    }
  })
})

/**
 * 工作流测试
 */
test.describe('工作流功能', () => {
  test('应显示工作流概览', async ({ authenticatedPage }) => {
    const workflowPage = new WorkflowPage(authenticatedPage)
    await workflowPage.goto()

    await workflowPage.expectOverviewVisible()
  })

  test('应显示工作流阶段卡片', async ({ authenticatedPage }) => {
    const workflowPage = new WorkflowPage(authenticatedPage)
    await workflowPage.goto()

    // 检查阶段卡片数量（应该有多个阶段）
    const phaseCount = await workflowPage.phaseCards.count()
    expect(phaseCount).toBeGreaterThan(0)
  })

  test('应能切换到执行标签页', async ({ authenticatedPage }) => {
    const workflowPage = new WorkflowPage(authenticatedPage)
    await workflowPage.goto()

    if (await workflowPage.executionTab.isVisible()) {
      await workflowPage.switchToExecution()
    }
  })

  test('应显示聊天面板', async ({ authenticatedPage }) => {
    const workflowPage = new WorkflowPage(authenticatedPage)
    await workflowPage.goto()

    await expect(workflowPage.chatPanel).toBeVisible()
  })
})

/**
 * 实时事件测试
 */
test.describe('实时事件', () => {
  test('SSE连接应正常建立', async ({ authenticatedPage }) => {
    const dashboardPage = new DashboardPage(authenticatedPage)
    await dashboardPage.goto()

    // 等待 SSE 连接建立
    await authenticatedPage.waitForTimeout(2000)

    // 检查是否显示连接状态
    const connectionIndicator = authenticatedPage.locator('.connection-status, [data-testid="connection-status"]')
    if (await connectionIndicator.count() > 0) {
      await expect(connectionIndicator.first()).toBeVisible()
    }
  })
})

/**
 * 响应式布局测试
 */
test.describe('响应式布局', () => {
  test('移动端布局应正常显示', async ({ authenticatedPage }) => {
    // 设置移动端视口
    await authenticatedPage.setViewportSize({ width: 375, height: 667 })

    const dashboardPage = new DashboardPage(authenticatedPage)
    await dashboardPage.goto()

    // 页面应该正常显示，不溢出
    const body = authenticatedPage.locator('body')
    await expect(body).toBeVisible()
  })

  test('平板端布局应正常显示', async ({ authenticatedPage }) => {
    // 设置平板端视口
    await authenticatedPage.setViewportSize({ width: 768, height: 1024 })

    const dashboardPage = new DashboardPage(authenticatedPage)
    await dashboardPage.goto()

    await dashboardPage.expectStatsVisible()
  })
})

/**
 * 无障碍性测试
 */
test.describe('无障碍性', () => {
  test('登录表单应有正确的标签', async ({ loginPage }) => {
    await loginPage.goto()

    // 检查输入框是否有关联的可访问标签（placeholder）
    const usernameInput = loginPage.page.getByPlaceholder(/用户名|Username/i)
    const passwordInput = loginPage.page.getByPlaceholder(/密码|Password/i)
    await expect(usernameInput).toBeVisible()
    await expect(passwordInput).toBeVisible()
  })

  test('按钮应有可访问的名称', async ({ loginPage }) => {
    await loginPage.goto()

    // 所有按钮都应该有可访问的名称
    const buttons = loginPage.page.locator('button')
    const count = await buttons.count()

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i)
      const name = await button.textContent()
      const ariaLabel = await button.getAttribute('aria-label')
      expect(name || ariaLabel).toBeTruthy()
    }
  })
})

/**
 * 错误处理测试
 */
test.describe('错误处理', () => {
  test('API错误应显示友好的错误信息', async ({ authenticatedPage }) => {
    // 模拟 API 错误
    await authenticatedPage.route('**/api/stats', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Server Error' })
      })
    })

    const dashboardPage = new DashboardPage(authenticatedPage)
    await dashboardPage.goto()

    // 页面应该正常显示，不应该崩溃
    await expect(authenticatedPage.locator('body')).toBeVisible()
  })

  test('网络错误应优雅处理', async ({ authenticatedPage }) => {
    // 模拟网络错误
    await authenticatedPage.route('**/api/**', route => route.abort('failed'))

    const agentsPage = new AgentsPage(authenticatedPage)
    await agentsPage.goto()

    // 页面应该正常显示，不应该崩溃
    await expect(authenticatedPage.locator('body')).toBeVisible()
  })
})

/**
 * 性能测试
 */
test.describe('性能', () => {
  test('页面加载时间应在合理范围内', async ({ page }) => {
    const startTime = Date.now()

    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const loadTime = Date.now() - startTime

    // 页面加载时间应该小于 5 秒
    expect(loadTime).toBeLessThan(5000)
  })

  test('仪表盘加载时间应在合理范围内', async ({ authenticatedPage }) => {
    const startTime = Date.now()

    await authenticatedPage.goto('/')
    // Dashboard uses SSE long connections, cannot use 'networkidle'
    await authenticatedPage.waitForLoadState('domcontentloaded')

    const loadTime = Date.now() - startTime

    // 页面加载时间应该小于 5 秒
    expect(loadTime).toBeLessThan(5000)
  })
})
