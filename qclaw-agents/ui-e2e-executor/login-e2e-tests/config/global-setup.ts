/**
 * Global Setup - 全局环境准备
 * 
 * 在所有测试运行前执行一次：
 * 1. 清理测试环境
 * 2. 初始化测试数据
 * 3. 设置测试账户
 */

import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🚀 Global Setup: 初始化测试环境...');

  try {
    // 1. 清理测试数据（确保测试可重复）
    await cleanupTestData(page, config);

    // 2. 初始化测试账户
    await initializeTestAccounts(page, config);

    // 3. 预热关键接口
    await warmUpServices(page, config);

    console.log('✅ Global Setup 完成');
  } catch (error) {
    console.error('❌ Global Setup 失败:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

async function cleanupTestData(page: any, config: FullConfig) {
  console.log('🧹 清理测试数据...');
  
  const baseURL = config.projects[0].use.baseURL || process.env.BASE_URL;
  
  try {
    // 调用清理API（如果有）
    await page.request.post(`${baseURL}/api/test/cleanup`, {
      data: { preserveAccounts: true },
    });
    console.log('  - 测试数据清理完成');
  } catch (error) {
    // 清理失败不影响继续执行（可能没有清理API）
    console.log('  - 跳过数据清理（API不可用）');
  }
}

async function initializeTestAccounts(page: any, config: FullConfig) {
  console.log('👤 初始化测试账户...');
  
  // 读取测试账户配置
  const testAccounts = {
    valid: {
      phone: process.env.TEST_USER_PHONE || '13800138000',
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'Test@123',
    },
    invalid: {
      phone: '13999999999',
      email: 'nonexistent@example.com',
      password: 'WrongPassword',
    },
    locked: {
      phone: process.env.LOCKED_USER_PHONE || '13700137000',
      password: 'Test@123',
    },
  };

  // 将测试账户写入环境变量文件，供测试脚本读取
  const fs = await import('fs');
  const envPath = '.env.test';
  
  const envContent = Object.entries(testAccounts.valid)
    .map(([key, value]) => `TEST_USER_${key.toUpperCase()}=${value}`)
    .join('\n');

  fs.writeFileSync(envPath, envContent);
  console.log('  - 测试账户环境变量已写入 .env.test');
}

async function warmUpServices(page: any, config: FullConfig) {
  console.log('🔥 预热服务...');
  
  const baseURL = config.projects[0].use.baseURL || process.env.BASE_URL;
  
  try {
    await page.goto(`${baseURL}/health`, { waitUntil: 'domcontentloaded' });
    console.log('  - 健康检查通过');
  } catch (error) {
    console.log('  - 健康检查跳过（页面可能不存在）');
  }
}

export default globalSetup;
