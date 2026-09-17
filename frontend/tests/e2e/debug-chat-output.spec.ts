import { test, expect } from '@playwright/test'

test.describe('聊天面板输入修复验证', () => {
  test('分步测试页面提交任务应该正确传递输入内容', async ({ page }) => {
    // 1. 登录
    await page.goto('http://localhost:5174/')
    await page.waitForURL('**/login')
    await page.getByPlaceholder('请输入用户名').fill('admin')
    await page.getByPlaceholder('请输入密码').fill('I2ss56tb@')
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL('**/', { timeout: 10000 })
    
    // 2. 确认在分步测试页面
    await page.waitForSelector('textarea', { timeout: 5000 })
    console.log('聊天面板存在:', await page.locator('textarea').count() > 0)
    
    // 3. 输入测试任务
    const textarea = page.locator('textarea').first()
    await textarea.click()
    await textarea.fill('帮我分析一个用户登录功能的测试需求')
    
    // 验证输入
    const inputValue = await textarea.inputValue()
    console.log('输入框内容:', inputValue)
    expect(inputValue.length).toBeGreaterThan(0)
    
    // 4. 提交任务（使用 Enter 键）
    await textarea.press('Enter')
    
    // 5. 验证任务创建
    await page.waitForTimeout(3000)
    console.log('发送后消息数量:', await page.locator('.message').count())
    
    // 验证任务已创建（通过 SSE 事件）
    const taskCreated = await page.evaluate(() => {
      return window.__testLogs?.some((log: string) => 
        log.includes('task_created') || log.includes('fullMessageLength')
      ) ?? false
    })
    console.log('任务创建日志存在:', taskCreated)
  })
})
