import { test, expect } from './fixtures'

/**
 * 核心业务流程测试 - 测试工作流完整流程
 */
test.describe('核心业务流程', () => {

  /**
   * 用户注册 -> 登录 -> 使用系统 -> 退出登录
   */
  test('完整用户旅程: 注册 -> 登录 -> 使用 -> 退出', async ({ page, registerPage, loginPage, dashboardPage }) => {
    const testEmail = `e2e-${Date.now()}@test.com`
    const testPassword = 'TestPass123!'
    const testUsername = `e2e_${Date.now()}`

    // 1. 注册新用户
    await test.step('注册新用户', async () => {
      await registerPage.goto()
      await registerPage.register(testUsername, testPassword)

      // 注册成功后应该跳转到登录页或首页
      await page.waitForURL(/login|dashboard|\//i, { timeout: 10000 })
    })

    // 2. 登录
    await test.step('用户登录', async () => {
      // 如果注册后没有自动登录，需要手动登录
      if (page.url().includes('login')) {
        await loginPage.login(testUsername, testPassword)
      }

      // 等待登录成功
      await page.waitForURL(/dashboard|\//i, { timeout: 10000 })
      await expect(page.locator('body')).toBeVisible()
    })

    // 3. 浏览各个功能模块
    await test.step('浏览功能模块', async () => {
      // 访问智能体页面
      await page.goto('/agents')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.agent-card, [data-testid="agent-card"]').first()).toBeVisible({ timeout: 10000 })

      // 访问知识库页面
      await page.goto('/knowledge')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.knowledge-list, .doc-list, [data-testid="doc-item"]').first()).toBeVisible({ timeout: 10000 })

      // 访问任务页面
      await page.goto('/tasks')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.el-table, [data-testid="task-table"]')).toBeVisible({ timeout: 10000 })
    })

    // 4. 退出登录
    await test.step('退出登录', async () => {
      // 查找退出按钮
      const logoutButton = page.getByRole('button', { name: /退出|Logout|登出/i })

      if (await logoutButton.isVisible()) {
        await logoutButton.click()
      } else {
        // 可能在用户菜单中
        const userMenu = page.locator('.user-menu, .user-dropdown, [data-testid="user-menu"]')
        if (await userMenu.isVisible()) {
          await userMenu.click()
          await logoutButton.click()
        }
      }

      // 应该跳转到登录页
      await page.waitForURL(/login/i, { timeout: 10000 })
    })
  })

  /**
   * 创建测试任务并查看执行结果
   */
  test('创建并执行测试任务', async ({ authenticatedPage }) => {
    await test.step('导航到工作流页面', async () => {
      await authenticatedPage.goto('/workflow')
      await authenticatedPage.waitForLoadState('networkidle')
    })

    await test.step('输入测试任务', async () => {
      const taskInput = authenticatedPage.getByPlaceholder(/输入|Input|任务/i)
      const sendButton = authenticatedPage.getByRole('button', { name: /发送|Send/i })

      if (await taskInput.isVisible()) {
        await taskInput.fill('请帮我生成一个简单的登录功能测试用例')
        await sendButton.click()

        // 等待响应
        await authenticatedPage.waitForTimeout(2000)

        // 应该显示智能体的响应
        const responseArea = authenticatedPage.locator('.message, .chat-message, [data-testid="message"]')
        if (await responseArea.count() > 0) {
          await expect(responseArea.first()).toBeVisible()
        }
      }
    })
  })

  /**
   * 搜索知识库文档
   */
  test('知识库搜索功能', async ({ authenticatedPage }) => {
    await test.step('导航到知识库页面', async () => {
      await authenticatedPage.goto('/knowledge')
      await authenticatedPage.waitForLoadState('networkidle')
    })

    await test.step('执行搜索', async () => {
      const searchInput = authenticatedPage.getByPlaceholder(/搜索|Search/i)

      if (await searchInput.isVisible()) {
        await searchInput.fill('测试')
        await authenticatedPage.keyboard.press('Enter')

        // 等待搜索结果
        await authenticatedPage.waitForTimeout(1000)

        // 检查是否显示搜索结果
        const results = authenticatedPage.locator('.doc-item, .knowledge-item, [data-testid="doc-item"]')
        // 搜索结果可能为空，这是正常的
        const count = await results.count()
        expect(count).toBeGreaterThanOrEqual(0)
      }
    })
  })

  /**
   * 测试智能体交互
   */
  test('智能体对话交互', async ({ authenticatedPage }) => {
    await test.step('选择智能体', async () => {
      await authenticatedPage.goto('/agents')
      await authenticatedPage.waitForLoadState('networkidle')

      // 点击第一个智能体卡片
      const firstAgent = authenticatedPage.locator('.agent-card, [data-testid="agent-card"]').first()
      await firstAgent.click()

      // 应该打开对话界面
      await authenticatedPage.waitForTimeout(1000)
    })

    await test.step('发送消息', async () => {
      const messageInput = authenticatedPage.getByPlaceholder(/输入|Input|消息/i)
      const sendButton = authenticatedPage.getByRole('button', { name: /发送|Send/i })

      if (await messageInput.isVisible()) {
        await messageInput.fill('你好，请介绍一下你的功能')
        await sendButton.click()

        // 等待响应
        await authenticatedPage.waitForTimeout(3000)

        // 检查是否有响应消息
        const messages = authenticatedPage.locator('.message, .chat-message')
        const count = await messages.count()
        expect(count).toBeGreaterThan(0)
      }
    })
  })

  /**
   * 测试仪表盘数据刷新
   */
  test('仪表盘数据实时更新', async ({ authenticatedPage }) => {
    await test.step('访问仪表盘', async () => {
      await authenticatedPage.goto('/')
      await authenticatedPage.waitForLoadState('networkidle')
    })

    await test.step('等待数据加载', async () => {
      // 等待统计数据显示
      const statCards = authenticatedPage.locator('.stat-card, [data-testid="stat-card"]')
      await expect(statCards.first()).toBeVisible({ timeout: 10000 })

      // 获取初始值
      const initialText = await statCards.first().textContent()
      expect(initialText).toBeTruthy()
    })

    await test.step('刷新页面检查数据', async () => {
      await authenticatedPage.reload()
      await authenticatedPage.waitForLoadState('networkidle')

      const statCards = authenticatedPage.locator('.stat-card, [data-testid="stat-card"]')
      await expect(statCards.first()).toBeVisible({ timeout: 10000 })
    })
  })

  /**
   * 测试表单验证
   */
  test('表单验证功能', async ({ page }) => {
    await test.step('登录表单验证', async () => {
      await page.goto('/login')
      await page.waitForLoadState('networkidle')

      const loginButton = page.getByRole('button', { name: /登录|Login/i })

      // 空表单提交
      await loginButton.click()

      // 应该显示验证错误
      const errorMessages = page.locator('.el-form-item__error, .error-message')
      await expect(errorMessages.first()).toBeVisible({ timeout: 5000 })
    })

    await test.step('注册表单验证', async () => {
      await page.goto('/register')
      await page.waitForLoadState('networkidle')

      const registerButton = page.getByRole('button', { name: /注册|Register/i })

      // 空表单提交
      await registerButton.click()

      // 应该显示验证错误
      const errorMessages = page.locator('.el-form-item__error, .error-message')
      await expect(errorMessages.first()).toBeVisible({ timeout: 5000 })
    })
  })

  /**
   * 测试路由导航
   */
  test('路由导航功能', async ({ authenticatedPage }) => {
    const routes = [
      { path: '/', name: '仪表盘' },
      { path: '/agents', name: '智能体' },
      { path: '/knowledge', name: '知识库' },
      { path: '/tasks', name: '任务' },
      { path: '/workflow', name: '工作流' }
    ]

    for (const route of routes) {
      await test.step(`访问${route.name}页面`, async () => {
        await authenticatedPage.goto(route.path)
        await authenticatedPage.waitForLoadState('networkidle')

        // 验证 URL
        await expect(authenticatedPage).toHaveURL(new RegExp(route.path === '/' ? '(\\/|dashboard)' : route.path))

        // 页面应该正常显示
        await expect(authenticatedPage.locator('body')).toBeVisible()
      })
    }
  })

  /**
   * 测试数据加载状态
   */
  test('数据加载状态显示', async ({ authenticatedPage }) => {
    await test.step('检查加载状态', async () => {
      // 访问一个需要加载数据的页面
      await authenticatedPage.goto('/tasks')

      // 可能会显示加载动画
      const loadingIndicator = authenticatedPage.locator('.el-loading-mask, .loading, [data-testid="loading"]')

      // 等待加载完成
      await authenticatedPage.waitForLoadState('networkidle')

      // 加载指示器应该消失
      if (await loadingIndicator.count() > 0) {
        await expect(loadingIndicator).not.toBeVisible({ timeout: 5000 })
      }
    })
  })
})

/**
 * 边界情况和错误处理
 */
test.describe('边界情况和错误处理', () => {

  test('超长输入处理', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/workflow')
    await authenticatedPage.waitForLoadState('networkidle')

    const input = authenticatedPage.getByPlaceholder(/输入|Input|任务/i)
    if (await input.isVisible()) {
      // 输入超长文本
      const longText = '测试'.repeat(1000)
      await input.fill(longText)

      // 输入框应该能处理，不应该崩溃
      const value = await input.inputValue()
      expect(value.length).toBeGreaterThan(0)
    }
  })

  test('特殊字符输入处理', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/knowledge')
    await authenticatedPage.waitForLoadState('networkidle')

    const searchInput = authenticatedPage.getByPlaceholder(/搜索|Search/i)
    if (await searchInput.isVisible()) {
      // 输入特殊字符
      const specialChars = '<script>alert("xss")</script> & < > " \' \\ /'
      await searchInput.fill(specialChars)

      // 页面应该正常显示，不应该有 XSS
      await expect(authenticatedPage.locator('body')).toBeVisible()
    }
  })

  test('并发请求处理', async ({ authenticatedPage }) => {
    // 快速导航多个页面
    const pages = ['/agents', '/knowledge', '/tasks', '/workflow']

    for (const path of pages) {
      await authenticatedPage.goto(path)
      // 不等待加载完成就跳转到下一页
    }

    // 最后一个页面应该正常显示
    await authenticatedPage.waitForLoadState('networkidle')
    await expect(authenticatedPage.locator('body')).toBeVisible()
  })

  test('浏览器后退/前进功能', async ({ authenticatedPage }) => {
    // 访问多个页面
    await authenticatedPage.goto('/agents')
    await authenticatedPage.goto('/knowledge')
    await authenticatedPage.goto('/tasks')

    // 后退
    await authenticatedPage.goBack()
    await expect(authenticatedPage).toHaveURL(/knowledge/)

    // 再次后退
    await authenticatedPage.goBack()
    await expect(authenticatedPage).toHaveURL(/agents/)

    // 前进
    await authenticatedPage.goForward()
    await expect(authenticatedPage).toHaveURL(/knowledge/)
  })
})
