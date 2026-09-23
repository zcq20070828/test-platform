/**
 * 测试脚本生成器单元测试
 */

const assert = require('assert');
const {
  parseTestData,
  generateJestScript,
  generatePytestScript,
  generatePlaywrightScript,
  generateApiTestScript,
  generateTestScript
} = require('../backend/test-script-generator.js');

console.log('=== 测试脚本生成器单元测试 ===\n');

let passCount = 0;
let failCount = 0;

function runTest(testName, testFn) {
  try {
    testFn();
    console.log(`✅ ${testName}`);
    passCount++;
  } catch (error) {
    console.log(`❌ ${testName}`);
    console.log(`   错误: ${error.message}`);
    failCount++;
  }
}

// 测试数据
const testData = {
  testSuite: {
    name: '登录测试',
    description: '测试登录功能'
  },
  testCases: [
    {
      id: 'TC-001',
      name: '正常登录',
      steps: [
        { action: 'navigate', target: '/login' },
        { action: 'fill', target: '#username', value: 'user' },
        { action: 'click', target: '#login-btn' },
        { action: 'assert', target: '.msg', expected: '成功' }
      ]
    }
  ]
};

const apiTestData = {
  testSuite: {
    name: 'API测试',
    description: '测试API接口'
  },
  testCases: [
    {
      id: 'TC-API-001',
      name: '获取用户',
      steps: [
        {
          action: 'request',
          method: 'get',
          endpoint: '/api/users',
          expected: { status: 200 }
        }
      ]
    }
  ]
};

// 测试1：测试数据解析
runTest('测试1：测试数据解析', () => {
  const result = parseTestData(testData);
  assert.strictEqual(result.suite.name, '登录测试');
  assert.strictEqual(result.cases.length, 1);
  assert.strictEqual(result.cases[0].id, 'TC-001');
});

// 测试2：无效测试数据
runTest('测试2：无效测试数据验证', () => {
  assert.throws(() => {
    parseTestData(null);
  }, /测试数据格式无效/);
});

// 测试3：Jest脚本生成
runTest('测试3：Jest脚本生成', () => {
  const script = generateJestScript(testData);
  assert.strictEqual(typeof script, 'string');
  assert.strictEqual(script.includes('describe(\'登录测试\''), true);
  assert.strictEqual(script.includes('test(\'TC-001: 正常登录\''), true);
  assert.strictEqual(script.includes('await page.goto(\'/login\')'), true);
  assert.strictEqual(script.includes('toHaveText(\'成功\')'), true);
});

// 测试4：Pytest脚本生成
runTest('测试4：Pytest脚本生成', () => {
  const script = generatePytestScript(testData);
  assert.strictEqual(typeof script, 'string');
  assert.strictEqual(script.includes('class Test登录测试'), true);
  assert.strictEqual(script.includes('def test_tc_001'), true);
  assert.strictEqual(script.includes('page.goto(\'/login\')'), true);
});

// 测试5：Playwright脚本生成
runTest('测试5：Playwright脚本生成', () => {
  const script = generatePlaywrightScript(testData, { useTypeScript: true });
  assert.strictEqual(typeof script, 'string');
  assert.strictEqual(script.includes('import { test, expect }'), true);
  assert.strictEqual(script.includes('test.describe(\'登录测试\''), true);
});

// 测试6：API测试脚本生成（Axios）
runTest('测试6：API测试脚本生成（Axios）', () => {
  const script = generateApiTestScript(apiTestData, { framework: 'axios' });
  assert.strictEqual(typeof script, 'string');
  assert.strictEqual(script.includes('axios.get'), true);
  assert.strictEqual(script.includes('/api/users'), true);
  assert.strictEqual(script.includes('expect(response.status).toBe(200)'), true);
});

// 测试7：API测试脚本生成（Supertest）
runTest('测试7：API测试脚本生成（Supertest）', () => {
  const script = generateApiTestScript(apiTestData, { framework: 'supertest' });
  assert.strictEqual(typeof script, 'string');
  assert.strictEqual(script.includes('request('), true);
  assert.strictEqual(script.includes('.get(\'/api/users\')'), true);
});

// 测试8：统一生成接口（Jest）
runTest('测试8：统一生成接口（Jest）', () => {
  const result = generateTestScript(testData, { framework: 'jest' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.framework, 'jest');
  assert.strictEqual(result.testCaseCount, 1);
  assert.strictEqual(result.lineCount > 0, true);
});

// 测试9：统一生成接口（Pytest）
runTest('测试9：统一生成接口（Pytest）', () => {
  const result = generateTestScript(testData, { framework: 'pytest' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.framework, 'pytest');
});

// 测试10：统一生成接口（Playwright）
runTest('测试10：统一生成接口（Playwright）', () => {
  const result = generateTestScript(testData, { framework: 'playwright' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.framework, 'playwright');
});

// 测试11：统一生成接口（API）
runTest('测试11：统一生成接口（API）', () => {
  const result = generateTestScript(apiTestData, { framework: 'api' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.framework, 'api');
});

// 测试12：不支持的框架
runTest('测试12：不支持的框架处理', () => {
  const result = generateTestScript(testData, { framework: 'invalid' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.includes('不支持的测试框架'), true);
});

// 测试13：多测试用例
runTest('测试13：多测试用例生成', () => {
  const multiTestData = {
    testSuite: { name: '测试套件', description: '多测试用例' },
    testCases: [
      { id: 'TC-001', name: '测试1', steps: [{ action: 'navigate', target: '/page1' }] },
      { id: 'TC-002', name: '测试2', steps: [{ action: 'navigate', target: '/page2' }] },
      { id: 'TC-003', name: '测试3', steps: [{ action: 'navigate', target: '/page3' }] }
    ]
  };

  const result = generateTestScript(multiTestData, { framework: 'jest' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.testCaseCount, 3);
  assert.strictEqual(result.script.includes('TC-001'), true);
  assert.strictEqual(result.script.includes('TC-002'), true);
  assert.strictEqual(result.script.includes('TC-003'), true);
});

// 测试14：包含导入语句
runTest('测试14：包含导入语句', () => {
  const script = generateJestScript(testData, { includeImports: true });
  assert.strictEqual(script.includes('require(\'@playwright/test\')'), true);
});

// 测试15：不包含导入语句
runTest('测试15：不包含导入语句', () => {
  const script = generateJestScript(testData, { includeImports: false });
  assert.strictEqual(script.includes('require('), false);
});

// 测试16：TypeScript支持
runTest('测试16：TypeScript支持', () => {
  const script = generatePlaywrightScript(testData, { useTypeScript: true });
  assert.strictEqual(script.includes('import { test, expect }'), true);
});

// 测试17：动作映射（fill）
runTest('测试17：动作映射（fill）', () => {
  const script = generateJestScript(testData);
  assert.strictEqual(script.includes('page.fill(\'#username\', \'user\')'), true);
});

// 测试18：动作映射（click）
runTest('测试18：动作映射（click）', () => {
  const script = generateJestScript(testData);
  assert.strictEqual(script.includes('page.click(\'#login-btn\')'), true);
});

// 测试19：动作映射（assert）
runTest('测试19：动作映射（assert）', () => {
  const script = generateJestScript(testData);
  assert.strictEqual(script.includes('toHaveText(\'成功\')'), true);
});

// 测试20：空测试用例
runTest('测试20：空测试用例处理', () => {
  const emptyTestData = {
    testSuite: { name: '空测试', description: '无测试用例' },
    testCases: []
  };

  const result = generateTestScript(emptyTestData, { framework: 'jest' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.testCaseCount, 0);
});

console.log('\n=== 测试结果 ===');
console.log(`✅ 通过: ${passCount}`);
console.log(`❌ 失败: ${failCount}`);
console.log(`总计: ${passCount + failCount}`);

if (failCount === 0) {
  console.log('\n🎉 所有测试通过！');
  process.exit(0);
} else {
  console.log('\n⚠️  部分测试失败');
  process.exit(1);
}
