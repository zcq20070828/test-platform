import { defineConfig, devices } from '@playwright/test';

/**
 * APP 用户注册功能 E2E 测试配置
 *
 * 项目拆分:
 *   - api:        后端接口测试（注册/验证码/参数校验）
 *   - ui:         UI表单校验与交互测试（需 mock-server）
 *   - security:   安全测试（SQL注入/XSS/HTTPS/短信轰炸）
 *   - performance:性能与并发测试
 *   - regression: 回归测试（幂等性/登录联调/数据一致性）
 *
 * 环境变量:
 *   BASE_URL       — 被测 APP API 地址 (默认: http://localhost:3000)
 *   MOCK_SERVER    — Mock UI 服务地址  (默认: http://localhost:3100)
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 2,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list', { printSteps: true }],
  ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'api',
      testMatch: 'api/**/*.spec.ts',
      use: {
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
      },
    },
    {
      name: 'ui',
      testMatch: 'ui/**/*.spec.ts',
      use: {
        ...devices['iPhone 13'],
        baseURL: process.env.MOCK_SERVER || 'http://localhost:3100',
      },
    },
    {
      name: 'security',
      testMatch: 'security/**/*.spec.ts',
      use: {
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
      },
    },
    {
      name: 'performance',
      testMatch: 'performance/**/*.spec.ts',
      use: {
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
      },
    },
    {
      name: 'regression',
      testMatch: 'regression/**/*.spec.ts',
      use: {
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
      },
    },
  ],
});
