import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 * 用户登录功能 UI/E2E 测试框架配置
 * 
 * 技术栈：Playwright + TypeScript + Allure
 * 
 * 环境配置：
 *   - test: 本地 Mock 服务器 (http://localhost:3000)
 *   - staging: 预发布环境
 *   - production: 生产环境
 */

export type Environment = 'test' | 'staging' | 'production';

export interface EnvironmentConfig {
  baseURL: string;
  apiURL: string;
  timeout: number;
  headless: boolean;
}

const envConfigs: Record<Environment, EnvironmentConfig> = {
  test: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    apiURL: process.env.API_URL || 'http://localhost:3000/api',
    timeout: 30000,
    headless: true,
  },
  staging: {
    baseURL: process.env.BASE_URL || 'https://staging.example.com',
    apiURL: process.env.API_URL || 'https://staging.example.com/api',
    timeout: 45000,
    headless: false,
  },
  production: {
    baseURL: process.env.BASE_URL || 'https://www.example.com',
    apiURL: process.env.API_URL || 'https://www.example.com/api',
    timeout: 60000,
    headless: false,
  },
};

const currentEnv = (process.env.TEST_ENV as Environment) || 'test';
const envConfig = envConfigs[currentEnv];

export default defineConfig({
  // === 基础配置 ===
  testDir: './tests',
  fullyParallel: process.env.CI !== 'true',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  // === 报告配置 ===
  reporter: [
    ['list'],
    ['allure', {
      outputDir: './reports/allure-results',
      suiteTitle: '用户登录功能 UI/E2E 测试',
    }],
    ['html', {
      outputFolder: './reports/html',
      open: 'never',
    }],
    ['json', {
      outputFile: './reports/results.json',
    }],
  ],

  // === 全局超时配置 ===
  timeout: envConfig.timeout,
  expect: {
    timeout: 10000,
  },

  // === 全局钩子 ===
  globalSetup: './config/global-setup.ts',
  globalTeardown: './config/global-teardown.ts',

  // === 验证配置 ===
  use: {
    baseURL: envConfig.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    
    // 请求拦截配置
    extraHTTPHeaders: {
      'X-Test-Environment': currentEnv,
      'X-Test-Framework': 'Playwright',
    },

    // BDD风格截图
    screenshotOptions: {
      fullPage: true,
    },
  },

  // === 项目配置 ===
  projects: [
    // === 1. 桌面端配置 ===
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        headless: envConfig.headless,
        viewport: { width: 1920, height: 1080 },
        channel: undefined,
      },
    },
    {
      name: 'firefox-desktop',
      use: {
        ...devices['Desktop Firefox'],
        headless: envConfig.headless,
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
        headless: envConfig.headless,
      },
    },

    // === 2. 移动端配置 ===
    {
      name: 'iphone-14',
      use: {
        ...devices['iPhone 14'],
        headless: envConfig.headless,
      },
    },
    {
      name: 'android-chrome',
      use: {
        ...devices['Pixel 5'],
        headless: envConfig.headless,
      },
    },
  ],

  // === 钩子配置 ===
  webServer: process.env.CI ? undefined : {
    command: 'cd ../mock-server && python3 -m http.server 3000',
    url: envConfig.baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

export { currentEnv, envConfig };
