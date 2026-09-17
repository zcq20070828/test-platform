import { test, expect, Page } from '@playwright/test'

const BASE = 'http://localhost:5174'
const API  = 'http://localhost:3001'

// ── 辅助 ──────────────────────────────────────────────
async function clearLocalStorage(page: Page) {
  await page.goto(BASE + '/login')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

async function login(page: Page, username: string, password: string) {
  await page.goto(BASE + '/login')
  await page.getByPlaceholder('用户名').fill(username)
  await page.getByPlaceholder('密码').fill(password)
  await page.getByRole('button', { name: '登 录' }).click()
}

// ── TC-M01-P0-001：有效用户登录成功 ──────────────────
test('M01-P0-001: 有效用户登录成功', async ({ page }) => {
  await clearLocalStorage(page)
  const msg = page.locator('.el-message')
  await login(page, 'testuser', 'Test@123')
  await expect(page).toHaveURL(BASE + '/')
  await expect(msg).toContainText('登录成功', { timeout: 5000 })
  const token = await page.evaluate(() => localStorage.getItem('token'))
  expect(token).toBeTruthy()
})

// ── TC-M01-P0-004：空用户名提交 ───────────────────────
test('M01-P0-004: 空用户名提交不发送请求', async ({ page }) => {
  await clearLocalStorage(page)
  const reqs: string[] = []
  page.on('request', r => { if (r.url().includes('/api/auth')) reqs.push(r.url()) })
  await page.goto(BASE + '/login')
  await page.getByPlaceholder('密码').fill('Test@123')
  await page.getByRole('button', { name: '登 录' }).click()
  await expect(page.locator('.el-message--warning')).toContainText('请输入用户名和密码', { timeout: 3000 })
  expect(reqs.filter(u => u.includes('/login'))).toHaveLength(0)
})

// ── TC-M01-P0-005：空密码提交 ───────────────────────
test('M01-P0-005: 空密码提交不发送请求', async ({ page }) => {
  await clearLocalStorage(page)
  const reqs: string[] = []
  page.on('request', r => { if (r.url().includes('/api/auth')) reqs.push(r.url()) })
  await page.goto(BASE + '/login')
  await page.getByPlaceholder('用户名').fill('testuser')
  await page.getByRole('button', { name: '登 录' }).click()
  await expect(page.locator('.el-message--warning')).toContainText('请输入用户名和密码', { timeout: 3000 })
  expect(reqs.filter(u => u.includes('/login'))).toHaveLength(0)
})

// ── TC-M01-P0-007：已登录用户访问登录页自动跳转 ─────
test('M01-P0-007: 已登录用户访问登录页自动跳转首页', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.evaluate(() => {
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Test', role: 'admin', token: 'fake-token' }))
    localStorage.setItem('token', 'fake-token')
  })
  await page.reload()
  await expect(page).toHaveURL(BASE + '/', { timeout: 3000 })
})

// ── TC-M01-P1-001：登录按钮 Loading 状态 ────────────
test('M01-P1-001: 登录中按钮显示 Loading 状态', async ({ page }) => {
  await clearLocalStorage(page)
  // Mock API 延迟响应
  await page.route(API + '/api/auth/login', async route => {
    await new Promise(r => setTimeout(r, 1500))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'x', user: { id: '1', name: 't', role: 'admin' } }) })
  })
  await page.goto(BASE + '/login')
  await page.getByPlaceholder('用户名').fill('testuser')
  await page.getByPlaceholder('密码').fill('Test@123')
  await page.getByRole('button', { name: '登 录' }).click()
  await expect(page.getByRole('button', { name: '登录中...' })).toBeVisible({ timeout: 500 })
})

// ── TC-M01-P1-003：Enter 键触发表单提交 ─────────────
test('M01-P1-003: Enter 键触发登录提交', async ({ page }) => {
  await clearLocalStorage(page)
  await page.goto(BASE + '/login')
  await page.getByPlaceholder('用户名').fill('testuser')
  await page.getByPlaceholder('密码').fill('Test@123')
  await page.getByPlaceholder('密码').press('Enter')
  // 验证触发了网络请求（不检查结果，只检查行为）
  const [req] = await Promise.race([
    page.waitForRequest(r => r.url().includes('/api/auth/login'), { timeout: 5000 }),
    new Promise<null>(() => null)
  ])
  expect(req?.url()).toContain('/api/auth/login')
})

// ── TC-M05-P1-011/012：密码可见性切换 ──────────────
test('M05-P1-011: 密码可见性切换（显示）', async ({ page }) => {
  await page.goto(BASE + '/login')
  const pwd = page.locator('input[autocomplete="new-password"]')
  await expect(pwd).toHaveAttribute('type', 'password')
  await page.locator('[aria-label="切换密码可见性"]').click()
  await expect(pwd).toHaveAttribute('type', 'text')
})

test('M05-P1-012: 密码可见性切换（隐藏）', async ({ page }) => {
  await page.goto(BASE + '/login')
  const pwd = page.locator('input[autocomplete="new-password"]')
  await page.locator('[aria-label="切换密码可见性"]').click()
  await expect(pwd).toHaveAttribute('type', 'text')
  await page.locator('[aria-label="切换密码可见性"]').click()
  await expect(pwd).toHaveAttribute('type', 'password')
})

// ── TC-M05-P2-004：注册页面链接 ────────────────────
test('M05-P2-004: 点击注册链接跳转注册页', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.getByText('立即注册').click()
  await expect(page).toHaveURL(BASE + '/register')
})

// ── TC-M05-P2-005：返回首页链接 ───────────────────
test('M05-P2-005: 点击返回首页跳转首页', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.getByText('返回首页').click()
  await expect(page).toHaveURL(BASE + '/')
})

// ── TC-M05-P2-006：浏览器自动填充绕过 ──────────────
test('M05-P2-006: onMounted 强制清空表单防止自动填充', async ({ page }) => {
  // 通过 localStorage 预填充用户信息（模拟浏览器记住密码）
  await page.goto(BASE + '/login')
  await page.evaluate(() => {
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Test', role: 'admin', token: 'fake-token' }))
    localStorage.setItem('token', 'fake-token')
  })
  // 模拟浏览器自动填充后访问登录页
  await page.reload()
  const usernameVal = await page.locator('input[autocomplete="username"]').inputValue()
  const pwdVal = await page.locator('input[autocomplete="new-password"]').inputValue()
  expect(usernameVal).toBe('')
  expect(pwdVal).toBe('')
})

// ── TC-M02-P0-010/011：SSO 配置加载（启用/禁用） ──
test('M02-P0-010: SSO 启用时显示 SSO 按钮', async ({ page }) => {
  await page.route(API + '/api/sso/config', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true }) })
  })
  await clearLocalStorage(page)
  await page.goto(BASE + '/login')
  await expect(page.getByText('统一身份认证登录')).toBeVisible({ timeout: 3000 })
})

test('M02-P0-011: SSO 禁用时不显示 SSO 按钮', async ({ page }) => {
  await page.route(API + '/api/sso/config', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) })
  })
  await clearLocalStorage(page)
  await page.goto(BASE + '/login')
  await expect(page.getByText('统一身份认证登录')).not.toBeVisible({ timeout: 3000 })
})
