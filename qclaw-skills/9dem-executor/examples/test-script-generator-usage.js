/**
 * 测试脚本生成器使用示例
 * 演示如何生成多种框架的测试脚本
 */

const {
  generateJestScript,
  generatePytestScript,
  generatePlaywrightScript,
  generateApiTestScript,
  generateTestScript
} = require('../backend/test-script-generator.js');

console.log('=== 测试脚本生成器使用示例 ===\n');

// 测试数据
const testData = {
  testSuite: {
    name: '用户登录测试',
    description: '测试用户登录功能的完整流程'
  },
  testCases: [
    {
      id: 'TC-001',
      name: '正常登录',
      priority: 'high',
      steps: [
        { action: 'navigate', target: '/login' },
        { action: 'fill', target: '#username', value: 'testuser' },
        { action: 'fill', target: '#password', value: 'password123' },
        { action: 'click', target: '#login-button' },
        { action: 'assert', target: '.welcome-message', expected: '欢迎回来' }
      ],
      expected: '登录成功'
    },
    {
      id: 'TC-002',
      name: '用户名为空',
      priority: 'medium',
      steps: [
        { action: 'navigate', target: '/login' },
        { action: 'fill', target: '#password', value: 'password123' },
        { action: 'click', target: '#login-button' },
        { action: 'assert', target: '.error-message', expected: '用户名不能为空' }
      ],
      expected: '显示错误提示'
    }
  ]
};

// API测试数据
const apiTestData = {
  testSuite: {
    name: '用户API测试',
    description: '测试用户相关API接口'
  },
  testCases: [
    {
      id: 'TC-API-001',
      name: '获取用户列表',
      priority: 'high',
      steps: [
        {
          action: 'request',
          method: 'get',
          endpoint: '/api/users',
          expected: {
            status: 200,
            data: { success: true }
          }
        }
      ]
    },
    {
      id: 'TC-API-002',
      name: '创建用户',
      priority: 'high',
      steps: [
        {
          action: 'request',
          method: 'post',
          endpoint: '/api/users',
          data: {
            username: 'newuser',
            email: 'newuser@example.com'
          },
          expected: {
            status: 201,
            data: { success: true }
          }
        }
      ]
    }
  ]
};

// 示例1：生成Jest测试脚本
console.log('【示例1】Jest测试脚本\n');
const jestScript = generateJestScript(testData);
console.log(jestScript);
console.log('\n' + '='.repeat(80) + '\n');

// 示例2：生成Pytest测试脚本
console.log('【示例2】Pytest测试脚本\n');
const pytestScript = generatePytestScript(testData);
console.log(pytestScript);
console.log('\n' + '='.repeat(80) + '\n');

// 示例3：生成Playwright测试脚本
console.log('【示例3】Playwright E2E测试脚本\n');
const playwrightScript = generatePlaywrightScript(testData, {
  useTypeScript: true
});
console.log(playwrightScript);
console.log('\n' + '='.repeat(80) + '\n');

// 示例4：生成API测试脚本（Axios）
console.log('【示例4】API测试脚本（Axios）\n');
const axiosScript = generateApiTestScript(apiTestData, {
  framework: 'axios',
  useTypeScript: true
});
console.log(axiosScript);
console.log('\n' + '='.repeat(80) + '\n');

// 示例5：生成API测试脚本（Supertest）
console.log('【示例5】API测试脚本（Supertest）\n');
const supertestScript = generateApiTestScript(apiTestData, {
  framework: 'supertest',
  useTypeScript: false
});
console.log(supertestScript);
console.log('\n' + '='.repeat(80) + '\n');

// 示例6：统一生成接口
console.log('【示例6】统一生成接口\n');
const result1 = generateTestScript(testData, { framework: 'jest' });
console.log('Jest生成结果:');
console.log(`  成功: ${result1.success}`);
console.log(`  行数: ${result1.lineCount}`);
console.log(`  测试用例数: ${result1.testCaseCount}`);
console.log('');

const result2 = generateTestScript(testData, { framework: 'pytest' });
console.log('Pytest生成结果:');
console.log(`  成功: ${result2.success}`);
console.log(`  行数: ${result2.lineCount}`);
console.log(`  测试用例数: ${result2.testCaseCount}`);
console.log('');

// 示例7：批量生成所有框架
console.log('【示例7】批量生成所有框架\n');
const frameworks = ['jest', 'pytest', 'playwright', 'api'];
const results = {};

frameworks.forEach(framework => {
  const result = generateTestScript(
    framework === 'api' ? apiTestData : testData,
    { framework }
  );
  results[framework] = result;

  console.log(`${framework}:`);
  console.log(`  成功: ${result.success}`);
  console.log(`  行数: ${result.lineCount}`);
  console.log(`  测试用例数: ${result.testCaseCount}`);
  console.log('');
});

console.log('=== 示例运行完成 ===');
