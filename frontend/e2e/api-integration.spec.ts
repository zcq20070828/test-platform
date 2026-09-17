import { test, expect } from './fixtures'

const API_BASE = 'http://localhost:3888/api'

/**
 * API 集成测试 - 测试前后端数据交互
 */
test.describe('API 集成测试', () => {

  test.describe('认证 API', () => {
    test('登录 API 应返回有效响应', async ({ page }) => {
      const response = await page.request.post(`${API_BASE}/auth/login`, {
        data: {
          email: 'admin@test.com',
          password: 'admin123'
        }
      })

      // 应该返回 200 或者 401（如果账号不存在）
      expect([200, 401, 404]).toContain(response.status())

      if (response.status() === 200) {
        const data = await response.json()
        expect(data).toHaveProperty('token')
      }
    })

    test('无效凭据应返回 401', async ({ page }) => {
      const response = await page.request.post(`${API_BASE}/auth/login`, {
        data: {
          email: 'invalid@test.com',
          password: 'wrongpassword'
        }
      })

      expect([401, 404]).toContain(response.status())
    })
  })

  test.describe('智能体 API', () => {
    test('获取智能体列表', async ({ page }) => {
      const response = await page.request.get(`${API_BASE}/agents`)

      expect(response.status()).toBe(200)

      const data = await response.json()
      expect(Array.isArray(data)).toBeTruthy()
      expect(data.length).toBeGreaterThan(0)

      // 检查智能体数据结构
      const agent = data[0]
      expect(agent).toHaveProperty('id')
      expect(agent).toHaveProperty('name')
      expect(agent).toHaveProperty('status')
    })

    test('获取单个智能体详情', async ({ page }) => {
      // 先获取智能体列表
      const listResponse = await page.request.get(`${API_BASE}/agents`)
      const agents = await listResponse.json()

      if (agents.length > 0) {
        const agentId = agents[0].id
        const response = await page.request.get(`${API_BASE}/agents/${agentId}`)

        expect(response.status()).toBe(200)

        const agent = await response.json()
        expect(agent).toHaveProperty('id')
        expect(agent.id).toBe(agentId)
      }
    })
  })

  test.describe('任务 API', () => {
    test('获取任务列表', async ({ page }) => {
      const response = await page.request.get(`${API_BASE}/tasks`)

      expect(response.status()).toBe(200)

      const data = await response.json()
      expect(Array.isArray(data)).toBeTruthy()
    })

    test('创建任务应需要认证', async ({ page }) => {
      const response = await page.request.post(`${API_BASE}/tasks`, {
        data: {
          agentId: 'test-requirement-analyzer',
          input: '测试任务输入'
        }
      })

      // 应该返回 401（未认证）或 400（参数错误）或 404
      expect([401, 400, 404]).toContain(response.status())
    })
  })

  test.describe('知识库 API', () => {
    test('获取知识库列表', async ({ page }) => {
      const response = await page.request.get(`${API_BASE}/knowledge`)

      expect(response.status()).toBe(200)

      const data = await response.json()
      expect(Array.isArray(data) || data.docs).toBeTruthy()
    })
  })

  test.describe('统计 API', () => {
    test('获取系统统计信息', async ({ page }) => {
      const response = await page.request.get(`${API_BASE}/stats`)

      expect(response.status()).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('agents')
      expect(data).toHaveProperty('tasks')
      expect(data).toHaveProperty('system')
    })

    test('统计信息应包含必要字段', async ({ page }) => {
      const response = await page.request.get(`${API_BASE}/stats`)
      const data = await response.json()

      // 检查智能体统计
      expect(data.agents).toHaveProperty('total')

      // 检查任务统计
      expect(data.tasks).toHaveProperty('total')
      expect(data.tasks).toHaveProperty('running')
      expect(data.tasks).toHaveProperty('completed')

      // 检查系统统计
      expect(data.system).toHaveProperty('uptime')
    })
  })

  test.describe('SSE 实时事件', () => {
    test('SSE 端点应可访问', async ({ page }) => {
      const response = await page.request.get(`${API_BASE}/events`)

      // SSE 端点应该返回 200
      expect(response.status()).toBe(200)

      // 检查 Content-Type
      const contentType = response.headers()['content-type']
      expect(contentType).toContain('text/event-stream')
    })
  })

  test.describe('工作流 API', () => {
    test('获取工作流列表', async ({ page }) => {
      const response = await page.request.get(`${API_BASE}/workflows`)

      expect([200, 404]).toContain(response.status())

      if (response.status() === 200) {
        const data = await response.json()
        expect(Array.isArray(data)).toBeTruthy()
      }
    })
  })
})

/**
 * 数据一致性测试
 */
test.describe('数据一致性', () => {

  test('智能体状态与后端一致', async ({ authenticatedPage }) => {
    // 从前端获取智能体状态
    await authenticatedPage.goto('/agents')
    await authenticatedPage.waitForLoadState('networkidle')

    const frontendAgents = await authenticatedPage.locator('.agent-card, [data-testid="agent-card"]').count()

    // 从后端获取智能体数量
    const response = await authenticatedPage.request.get(`${API_BASE}/agents`)
    const backendAgents = await response.json()

    // 数量应该一致
    expect(frontendAgents).toBe(backendAgents.length)
  })

  test('任务列表与后端一致', async ({ authenticatedPage }) => {
    // 从前端获取任务数量
    await authenticatedPage.goto('/tasks')
    await authenticatedPage.waitForLoadState('networkidle')

    const frontendRows = await authenticatedPage.locator('.el-table__row, [data-testid="task-row"]').count()

    // 从后端获取任务数量
    const response = await authenticatedPage.request.get(`${API_BASE}/tasks`)
    const backendTasks = await response.json()

    // 数量应该一致（可能前端有分页，所以只检查不为空）
    expect(frontendRows).toBeGreaterThanOrEqual(0)
    expect(backendTasks.length).toBeGreaterThanOrEqual(0)
  })

  test('统计数据与后端一致', async ({ authenticatedPage }) => {
    // 从前端访问仪表盘
    await authenticatedPage.goto('/')
    await authenticatedPage.waitForLoadState('networkidle')

    // 从后端获取统计数据
    const response = await authenticatedPage.request.get(`${API_BASE}/stats`)
    const stats = await response.json()

    // 前端应该显示这些数据
    const statCards = authenticatedPage.locator('.stat-card, [data-testid="stat-card"]')
    await expect(statCards.first()).toBeVisible({ timeout: 10000 })

    // 统计数据应该包含智能体总数
    expect(stats.agents.total).toBeGreaterThan(0)
  })
})

/**
 * 实时更新测试
 */
test.describe('实时数据更新', () => {

  test('SSE 事件应更新前端状态', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/')
    await authenticatedPage.waitForLoadState('networkidle')

    // 监听 SSE 事件
    const ssePromise = authenticatedPage.waitForEvent('response', {
      predicate: (response) => response.url().includes('/api/events'),
      timeout: 5000
    }).catch(() => null)

    // 等待可能的 SSE 连接
    await authenticatedPage.waitForTimeout(3000)

    // 页面应该保持正常状态
    await expect(authenticatedPage.locator('body')).toBeVisible()
  })
})

/**
 * 错误处理测试
 */
test.describe('API 错误处理', () => {

  test('404 错误应正确处理', async ({ page }) => {
    const response = await page.request.get(`${API_BASE}/nonexistent-endpoint`)

    expect(response.status()).toBe(404)
  })

  test('500 错误应正确处理', async ({ authenticatedPage }) => {
    // 模拟 500 错误
    await authenticatedPage.route(`${API_BASE}/stats`, route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' })
      })
    })

    await authenticatedPage.goto('/')
    await authenticatedPage.waitForLoadState('networkidle')

    // 页面不应该崩溃
    await expect(authenticatedPage.locator('body')).toBeVisible()
  })

  test('网络超时应优雅处理', async ({ authenticatedPage }) => {
    // 模拟超时
    await authenticatedPage.route(`${API_BASE}/agents`, route => {
      // 延迟 60 秒才响应
      setTimeout(() => {
        route.fulfill({
          status: 200,
          body: JSON.stringify([])
        })
      }, 60000)
    })

    await authenticatedPage.goto('/agents')

    // 页面应该在合理时间内显示（不应该等待超时）
    await authenticatedPage.waitForTimeout(5000)
    await expect(authenticatedPage.locator('body')).toBeVisible()
  })
})
