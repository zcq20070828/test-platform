/**
 * test-data.ts - 测试数据管理
 * 
 * 集中管理所有测试数据，支持从环境变量和配置文件加载
 */

export interface TestCredentials {
  valid: {
    phone: string;
    email: string;
    password: string;
  };
  invalid: {
    phone: string;
    email: string;
    password: string;
    smsCode: string;
  };
  locked: {
    phone: string;
    password: string;
  };
  unregistered: {
    phone: string;
    email: string;
  };
}

export interface TestUserProfile {
  name: string;
  avatar?: string;
  phone: string;
  email: string;
}

/**
 * 从环境变量加载测试配置
 */
function loadFromEnv(): Partial<TestCredentials> {
  return {
    valid: {
      phone: process.env.TEST_USER_PHONE || '13800138000',
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'Test@123',
    },
    invalid: {
      phone: '13999999999',
      email: 'nonexistent@example.com',
      password: 'WrongPassword',
      smsCode: '000000',
    },
    locked: {
      phone: process.env.LOCKED_USER_PHONE || '13700137000',
      password: 'Test@123',
    },
    unregistered: {
      phone: '13900000000',
      email: 'unregistered@example.com',
    },
  };
}

/**
 * 测试数据配置
 */
export const testData: TestCredentials = {
  ...loadFromEnv(),
} as TestCredentials;

/**
 * 测试用户档案
 */
export const testUserProfiles: TestUserProfile[] = [
  {
    name: '标准用户',
    phone: testData.valid.phone,
    email: testData.valid.email,
  },
  {
    name: '锁定用户',
    phone: testData.locked.phone,
    email: 'locked@example.com',
  },
];

/**
 * 获取有效登录凭证
 */
export function getValidCredentials(): { account: string; password: string } {
  return {
    account: testData.valid.phone,
    password: testData.valid.password,
  };
}

/**
 * 获取有效邮箱凭证
 */
export function getValidEmailCredentials(): { account: string; password: string } {
  return {
    account: testData.valid.email,
    password: testData.valid.password,
  };
}

/**
 * 获取无效登录凭证
 */
export function getInvalidCredentials(): { account: string; password: string } {
  return {
    account: testData.invalid.phone,
    password: testData.invalid.password,
  };
}

/**
 * 测试数据导出（用于调试）
 */
export function logTestDataSummary(): void {
  console.log('📋 测试数据摘要:');
  console.log(`  有效账号: ${testData.valid.phone} / ${testData.valid.email}`);
  console.log(`  无效账号: ${testData.invalid.phone}`);
  console.log(`  锁定账号: ${testData.locked.phone}`);
}
