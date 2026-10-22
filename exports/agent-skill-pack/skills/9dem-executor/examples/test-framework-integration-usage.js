/**
 * 测试框架集成模块使用示例
 * 演示如何使用test-framework-integration.js
 */

const {
  detectTestFramework,
  isFrameworkInstalled,
  executeJestTests,
  executePytestTests,
  executePlaywrightTests,
  executeTests,
  generateTestReport
} = require('../backend/test-framework-integration');

console.log('=== 测试框架集成模块使用示例 ===\n');

// 示例1：检测测试框架
console.log('示例1：检测测试框架');
console.log('--------------------------------------');

const testPath1 = '/root/.qclaw/skills/9dem-executor';
const framework1 = detectTestFramework(testPath1);
console.log(`测试路径: ${testPath1}`);
console.log(`检测到的框架: ${framework1 || '未检测到'}`);
console.log();

// 示例2：检测测试框架是否已安装
console.log('示例2：检测测试框架是否已安装');
console.log('--------------------------------------');

const frameworks = ['jest', 'pytest', 'playwright'];
frameworks.forEach(fw => {
  const installed = isFrameworkInstalled(fw);
  console.log(`${fw}: ${installed ? '已安装 ✅' : '未安装 ❌'}`);
});
console.log();

// 示例3：执行Jest测试（模拟）
console.log('示例3：执行Jest测试');
console.log('--------------------------------------');

// 注意：这里只是演示调用方式，实际需要真实的Jest项目
const jestConfig = {
  testPath: '/path/to/jest/project',
  framework: 'jest',
  options: {
    coverage: true,
    verbose: true,
    timeout: 30000
  }
};

console.log('Jest配置:');
console.log(JSON.stringify(jestConfig, null, 2));
console.log('\n执行测试: executeJestTests(testPath, options)');
console.log('（需要真实的Jest项目才能执行）\n');

// 示例4：执行Pytest测试（模拟）
console.log('示例4：执行Pytest测试');
console.log('--------------------------------------');

const pytestConfig = {
  testPath: '/path/to/pytest/project',
  framework: 'pytest',
  options: {
    coverage: true,
    verbose: true,
    timeout: 30000
  }
};

console.log('Pytest配置:');
console.log(JSON.stringify(pytestConfig, null, 2));
console.log('\n执行测试: executePytestTests(testPath, options)');
console.log('（需要真实的Pytest项目才能执行）\n');

// 示例5：执行Playwright测试（模拟）
console.log('示例5：执行Playwright测试');
console.log('--------------------------------------');

const playwrightConfig = {
  testPath: '/path/to/playwright/project',
  framework: 'playwright',
  options: {
    verbose: true,
    parallel: false,
    browsers: ['chromium', 'firefox']
  }
};

console.log('Playwright配置:');
console.log(JSON.stringify(playwrightConfig, null, 2));
console.log('\n执行测试: executePlaywrightTests(testPath, options)');
console.log('（需要真实的Playwright项目才能执行）\n');

// 示例6：自动检测并执行测试（统一接口）
console.log('示例6：自动检测并执行测试');
console.log('--------------------------------------');

const autoConfig = {
  testPath: '/path/to/project',
  options: {
    coverage: true,
    verbose: true
  }
};

console.log('自动检测配置:');
console.log(JSON.stringify(autoConfig, null, 2));
console.log('\n执行测试: executeTests(config)');
console.log('（会自动检测框架类型并执行）\n');

// 示例7：生成测试报告
console.log('示例7：生成测试报告');
console.log('--------------------------------------');

const mockResults = {
  success: true,
  framework: 'jest',
  results: {
    total: 10,
    passed: 8,
    failed: 2,
    skipped: 0,
    duration: 1234
  },
  coverage: {
    lines: 85.5,
    statements: 87.2,
    branches: 78.9,
    functions: 90.1
  }
};

console.log('模拟测试结果:');
console.log(JSON.stringify(mockResults, null, 2));
console.log('\nMarkdown报告:');
console.log('--------------------------------------');
console.log(generateTestReport(mockResults, 'markdown'));
console.log('\nJSON报告:');
console.log('--------------------------------------');
console.log(generateTestReport(mockResults, 'json').substring(0, 200) + '...');
console.log();

// 示例8：批量执行多个测试项目
console.log('示例8：批量执行多个测试项目');
console.log('--------------------------------------');

const testProjects = [
  { testPath: '/path/to/project1', framework: 'jest' },
  { testPath: '/path/to/project2', framework: 'pytest' },
  { testPath: '/path/to/project3', framework: 'playwright' }
];

console.log('测试项目列表:');
testProjects.forEach((proj, i) => {
  console.log(`${i + 1}. ${proj.testPath} (${proj.framework})`);
});
console.log('\n批量执行: Promise.all(testProjects.map(config => executeTests(config)))');
console.log('（需要真实项目才能执行）\n');

// 示例9：完整的测试执行流程
console.log('示例9：完整的测试执行流程');
console.log('--------------------------------------');
console.log('步骤1: detectTestFramework(testPath) - 检测框架');
console.log('步骤2: isFrameworkInstalled(framework) - 检测是否安装');
console.log('步骤3: executeTests(config) - 执行测试');
console.log('步骤4: generateTestReport(results, format) - 生成报告');
console.log('步骤5: 展示结果或保存报告\n');

console.log('=== 示例演示完成 ===');
console.log('\n提示：实际使用时需要替换为真实的测试项目路径');
