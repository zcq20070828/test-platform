const { defineConfig, devices } = require('@playwright/test');

/**
 * 计算器UI自动化测试配置
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  // 测试目录
  testDir: './tests',
  
  // 完全并行执行
  fullyParallel: true,
  
  // CI环境下禁止only标记
  forbidOnly: !!process.env.CI,
  
  // CI环境下重试2次
  retries: process.env.CI ? 2 : 0,
  
  // CI环境下单线程执行
  workers: process.env.CI ? 1 : undefined,
  
  // 报告器
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list']
  ],
  
  // 全局配置
  use: {
    // 基础URL - 根据实际计算器应用修改
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    
    // 失败时收集trace
    trace: 'on-first-retry',
    
    // 失败时截图
    screenshot: 'only-on-failure',
    
    // 失败时录制视频
    video: 'on-first-retry',
    
    // 超时时间
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  
  // 测试项目配置
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // 移动端测试
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  
  // 测试前启动服务(可选)
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
  
  // 超时配置
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
});
