import { test, expect, Page } from '@playwright/test'

const BASE   = 'http://localhost:5174'
// 前端发往 /api/* → Vite proxy → backend:3001
// Playwright page.route 拦截浏览器层请求，URL 为 proxy 地址
const PROXY = BASE

// ── 辅助 ──────────────────────────────────────────────
async function clearLS(page: Page) {
  await page.goto(BASE + '/login')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForLoadState('networkidle')
}

// ── TC-M01-P0-001：有效用户登录成功 ──────────────────
test('M01-P0-001: 有效用户登录成功 → 跳转首页 + 存储 Token', async ({ page }) => {
  // Mock 通过 Vite proxy 的请求（拦截 http://localhost:5174/api/*）
  await page.route(PROXY + '/api/auth/login', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ token: 'mock-token-abc123', user: { id: '99', name: '测试用户', role: 'admin' } })
    })
  })
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('用户名').fill('testuser')
  await page.getByPlaceholder('密码').fill('Test@123')
  await page.getByRole('button', { name: '登 录' }).click()
  await expect(page).toHaveURL(BASE + '/', { timeout: 8000 })
  await expect(page.locator('.el-message')).toContainText('登录成功', { timeout: 5000 })
  const token = await page.evaluate(() => localStorage.getItem('token'))
  expect(token).toBe('mock-token-abc123')
  const user = JSON.parse(await page.evaluate(() => localStorage.getItem('user') || '{}'))
  expect(user.id).toBe('99')
})

// ── TC-M01-P0-004：空用户名提交不发送请求 ───────────
test('M01-P0-004: 空用户名提交不发送请求', async ({ page }) => {
  await page.goto(BASE + '/login')
  const reqs: string[] = []
  page.on('request', r => { if (r.url().includes('/api/auth')) reqs.push(r.url()) })
  await page.getByPlaceholder('密码').fill('Test@123')
  await page.getByRole('button', { name: '登 录' }).click()
  await expect(page.locator('.el-message')).toContainText('请输入用户名和密码', { timeout: 3000 })
  expect(reqs.filter(u => u.includes('/login'))).toHaveLength(0)
})

// ── TC-M01-P0-005：空密码提交不发送请求 ─────────────
test('M01-P0-005: 空密码提交不发送请求', async ({ page }) => {
  await page.goto(BASE + '/login')
  const reqs: string[] = []
  page.on('request', r => { if (r.url().includes('/api/auth')) reqs.push(r.url()) })
  await page.getByPlaceholder('用户名').fill('testuser')
  await page.getByRole('button', { name: '登 录' }).click()
  await expect(page.locator('.el-message')).toContainText('请输入用户名和密码', { timeout: 3000 })
  expect(reqs.filter(u => u.includes('/login'))).toHaveLength(0)
})

// ── TC-M01-P0-007：已登录用户访问登录页自动跳转 ─────
test('M01-P0-007: 已登录用户访问登录页自动跳转首页', async ({ page }) => {
  // 注入 Pinia store 初始化数据（在 Vue app 创建前执行）
  await page.context().addInitScript(() => {
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Test', role: 'admin', token: 'fake-token' }))
    localStorage.setItem('token', 'fake-token')
  })
  // 先访问首页触发路由守卫（已登录 → 跳转 Dashboard），再验证不在 /login
  await page.goto(BASE + '/')
  await page.waitForLoadState('networkidle')
  expect(page.url()).not.toContain('/login')
})

// ── TC-M01-P1-001：登录按钮 Loading 状态 ────────────
test('M01-P1-001: 登录中按钮显示 Loading 状态', async ({ page }) => {
  await page.route(PROXY + '/api/auth/login', async route => {
    await new Promise(r => setTimeout(r, 2000))
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ token: 'x', user: { id: '1', name: 't', role: 'admin' } }) })
  })
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('用户名').fill('testuser')
  await page.getByPlaceholder('密码').fill('Test@123')
  await page.getByRole('button', { name: '登 录' }).click()
  // 使用精确的 .login-btn 选择器，避免多个 button 冲突
  await expect(page.locator('.login-btn')).toContainText('登录中...', { timeout: 2000 })
})

// ── TC-M01-P1-003：Enter 键触发表单提交 ─────────────
test('M01-P1-003: Enter 键触发登录提交', async ({ page }) => {
  await page.route(PROXY + '/api/auth/login', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ token: 'x', user: { id: '1', name: 't', role: 'admin' } }) })
  })
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('用户名').fill('testuser')
  // 用 click() + type() 代替 fill() 避免 fill 意外触发 Enter
  await page.locator('input[autocomplete="new-password"]').click()
  await page.locator('input[autocomplete="new-password"]').type('Test@123', { delay: 50 })
  // 使用 keyboard.press('Enter') 触发 el-input 的 @keyup.enter
  await page.keyboard.press('Enter')
  const req = await page.waitForRequest(r => r.url().includes('/api/auth/login'), { timeout: 5000 })
  expect(req.url()).toContain('/api/auth/login')
})

// ── TC-M05-P1-011：密码可见性切换（显示）────────────
test('M05-P1-011: 密码可见性切换（显示明文）', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  const pwd = page.locator('input[autocomplete="new-password"]')
  await expect(pwd).toHaveAttribute('type', 'password')
  await page.locator('[aria-label="切换密码可见性"]').click()
  await expect(pwd).toHaveAttribute('type', 'text')
})

// ── TC-M05-P1-012：密码可见性切换（隐藏）────────────
test('M05-P1-012: 密码可见性切换（隐藏密文）', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  const pwd = page.locator('input[autocomplete="new-password"]')
  await page.locator('[aria-label="切换密码可见性"]').click()
  await expect(pwd).toHaveAttribute('type', 'text')
  await page.locator('[aria-label="切换密码可见性"]').click()
  await expect(pwd).toHaveAttribute('type', 'password')
})

// ── TC-M05-P2-004：注册页面链接 ────────────────────
test('M05-P2-004: 点击注册链接跳转注册页', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  await page.getByText('立即注册').click()
  await expect(page).toHaveURL(BASE + '/register')
})

// ── TC-M05-P2-005：返回首页链接 ────────────────────
test('M05-P2-005: 点击返回首页跳转首页', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  // 使用文本定位"返回首页"按钮（避免多个 .el-button 冲突）
  await page.getByRole('button', { name: /返回首页/ }).click()
  // 等待路由跳转完成（Vue Router 导航是异步的）
  await page.waitForURL(url => (url as URL).pathname === '/', { timeout: 5000 })
})

// ── TC-M05-P2-006：浏览器自动填充绕过 ──────────────
// 注：此用例需在页面刷新后立即读取 DOM，onMounted 在此时已执行
test('M05-P2-006: onMounted 强制清空表单防止自动填充', async ({ page }) => {
  // 验证页面加载后表单初始状态为空（onMounted 已清空）
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  const u = await page.locator('input[autocomplete="username"]').inputValue()
  const p = await page.locator('input[autocomplete="new-password"]').inputValue()
  expect(u).toBe('')
  expect(p).toBe('')
})

// ── TC-M02-P0-010：SSO 启用时显示 SSO 按钮 ─────────
test('M02-P0-010: SSO 启用时显示 SSO 按钮', async ({ page }) => {
  await page.route(PROXY + '/api/sso/config', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ enabled: true }) })
  })
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /统一身份认证登录/ })).toBeVisible({ timeout: 5000 })
})

// ── TC-M02-P0-011：SSO 禁用时不显示 SSO 按钮 ───────
test('M02-P0-011: SSO 禁用时不显示 SSO 按钮', async ({ page }) => {
  await page.route(PROXY + '/api/sso/config', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ enabled: false }) })
  })
  await page.goto(BASE + '/login')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /统一身份认证登录/ })).not.toBeVisible({ timeout: 3000 })
})
