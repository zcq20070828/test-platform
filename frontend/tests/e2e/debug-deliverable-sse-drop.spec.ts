import { test, expect } from '@playwright/test'

test('SSE断开时, 轮询兜底仍应显示交付物卡片', async ({ page }) => {
  // 彻底掐断 SSE (/api/events): 每次连接都 abort, 模拟断线丢事件
  await page.route('**/api/events', (route) => route.abort())

  await page.goto('http://localhost:5174/')
  await page.waitForURL('**/login')
  await page.locator('input[placeholder="用户名"]').fill('admin')
  await page.locator('input[placeholder="密码"]').fill(process.env.TEST_USER_PASSWORD || '')
  await page.locator('button:has-text("登 录")').click()
  await page.waitForURL('**/', { timeout: 10000 })

  await page.waitForSelector('textarea', { timeout: 5000 })
  const textarea = page.locator('textarea').first()
  await textarea.click()
  await textarea.fill('分析订单功能的测试需求')
  await textarea.press('Enter')

  let found = false
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(5000)
    const n = await page.locator('.artifact-card').count()
    if (n > 0) {
      found = true
      console.log(`✓ 第${i + 1}次轮询发现 ${n} 个交付物卡片 (SSE已断, 纯靠轮询兜底)`)
      break
    }
    console.log(`  第${i + 1}次: 卡片0`)
  }
  await page.screenshot({ path: 'tests/e2e/screenshots/debug-deliverable-sse-drop.png' })
  expect(found, 'SSE断开时, 轮询兜底应仍能显示交付物卡片').toBe(true)
})
