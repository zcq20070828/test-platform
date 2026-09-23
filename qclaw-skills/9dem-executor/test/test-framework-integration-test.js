/**
 * 测试框架集成模块单元测试
 */

const assert = require('assert');
const path = require('path');
const {
  detectTestFramework,
  isFrameworkInstalled,
  parseJestCoverage,
  parsePytestCoverage,
  generateTestReport,
  generateMarkdownReport,
  generateHtmlReport
} = require('../backend/test-framework-integration');

console.log('=== 测试框架集成模块单元测试 ===\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failCount++;
    console.log(`❌ ${name}`);
    console.log(`   错误: ${error.message}`);
  }
}

// 测试1：检测不存在的测试路径
test('测试1：检测不存在的测试路径', () => {
  const result = detectTestFramework('/nonexistent/path');
  assert.strictEqual(result, null);
});

// 测试2：检测无配置的测试路径
test('测试2：检测无配置的测试路径', () => {
  const result = detectTestFramework('/tmp');
  assert.strictEqual(result, null);
});

// 测试3：检测Jest是否已安装
test('测试3：检测Jest是否已安装', () => {
  const result = isFrameworkInstalled('jest');
  assert.strictEqual(typeof result, 'boolean');
});

// 测试4：检测Pytest是否已安装
test('测试4：检测Pytest是否已安装', () => {
  const result = isFrameworkInstalled('pytest');
  assert.strictEqual(typeof result, 'boolean');
});

// 测试5：检测Playwright是否已安装
test('测试5：检测Playwright是否已安装', () => {
  const result = isFrameworkInstalled('playwright');
  assert.strictEqual(typeof result, 'boolean');
});

// 测试6：检测不支持的框架
test('测试6：检测不支持的框架', () => {
  const result = isFrameworkInstalled('unsupported-framework');
  assert.strictEqual(result, false);
});

// 测试7：解析Jest覆盖率数据
test('测试7：解析Jest覆盖率数据', () => {
  const coverageMap = {
    'file1.js': {
      l: { total: 100, covered: 80 },
      s: { total: 120, covered: 100 },
      b: { total: 50, covered: 40 },
      f: { total: 30, covered: 25 }
    },
    'file2.js': {
      l: { total: 50, covered: 45 },
      s: { total: 60, covered: 55 },
      b: { total: 20, covered: 18 },
      f: { total: 10, covered: 9 }
    }
  };

  const result = parseJestCoverage(coverageMap);

  assert.strictEqual(typeof result.lines, 'string');
  assert.strictEqual(typeof result.statements, 'string');
  assert.strictEqual(typeof result.branches, 'string');
  assert.strictEqual(typeof result.functions, 'string');

  // 验证计算正确性
  const expectedLines = ((80 + 45) / (100 + 50) * 100).toFixed(2);
  assert.strictEqual(result.lines, expectedLines);
});

// 测试8：解析空的Jest覆盖率数据
test('测试8：解析空的Jest覆盖率数据', () => {
  const coverageMap = {};
  const result = parseJestCoverage(coverageMap);

  assert.strictEqual(result.lines, 0);
  assert.strictEqual(result.statements, 0);
  assert.strictEqual(result.branches, 0);
  assert.strictEqual(result.functions, 0);
});

// 测试9：解析Pytest覆盖率数据
test('测试9：解析Pytest覆盖率数据', () => {
  const coverageData = {
    files: {
      'file1.py': {
        summary: {
          num_statements: 100,
          covered_lines: 85
        }
      },
      'file2.py': {
        summary: {
          num_statements: 50,
          covered_lines: 40
        }
      }
    }
  };

  const result = parsePytestCoverage(coverageData);

  assert.strictEqual(typeof result.lines, 'string');

  // 验证计算正确性
  const expectedLines = ((85 + 40) / (100 + 50) * 100).toFixed(2);
  assert.strictEqual(result.lines, expectedLines);
});

// 测试10：解析空的Pytest覆盖率数据
test('测试10：解析空的Pytest覆盖率数据', () => {
  const coverageData = { files: {} };
  const result = parsePytestCoverage(coverageData);

  assert.strictEqual(result.lines, 0);
});

// 测试11：生成Markdown格式报告
test('测试11：生成Markdown格式报告', () => {
  const results = {
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

  const report = generateTestReport(results, 'markdown');

  assert.strictEqual(typeof report, 'string');
  assert.ok(report.includes('# 测试报告'));
  assert.ok(report.includes('jest'));
  assert.ok(report.includes('覆盖率'));
});

// 测试12：生成JSON格式报告
test('测试12：生成JSON格式报告', () => {
  const results = {
    success: true,
    framework: 'jest',
    results: {
      total: 10,
      passed: 8,
      failed: 2,
      skipped: 0,
      duration: 1234
    }
  };

  const report = generateTestReport(results, 'json');

  assert.strictEqual(typeof report, 'string');
  const parsed = JSON.parse(report);
  assert.strictEqual(parsed.framework, 'jest');
});

// 测试13：生成HTML格式报告
test('测试13：生成HTML格式报告', () => {
  const results = {
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
      lines: 85.5
    }
  };

  const report = generateTestReport(results, 'html');

  assert.strictEqual(typeof report, 'string');
  assert.ok(report.includes('<!DOCTYPE html>'));
  assert.ok(report.includes('测试报告'));
  assert.ok(report.includes('jest'));
});

// 测试14：生成不带覆盖率的报告
test('测试14：生成不带覆盖率的报告', () => {
  const results = {
    success: true,
    framework: 'jest',
    results: {
      total: 10,
      passed: 10,
      failed: 0,
      skipped: 0,
      duration: 1234
    }
  };

  const report = generateMarkdownReport(results);

  assert.strictEqual(typeof report, 'string');
  assert.ok(report.includes('测试结果'));
  assert.ok(!report.includes('覆盖率'));
});

// 测试15：验证Markdown报告格式
test('测试15：验证Markdown报告格式', () => {
  const results = {
    success: true,
    framework: 'pytest',
    results: {
      total: 20,
      passed: 18,
      failed: 1,
      skipped: 1,
      duration: 2345
    }
  };

  const report = generateMarkdownReport(results);

  assert.ok(report.includes('| 总用例数 | 20 |'));
  assert.ok(report.includes('| 通过数 | 18 |'));
  assert.ok(report.includes('| 失败数 | 1 |'));
  assert.ok(report.includes('| 跳过数 | 1 |'));
});

// 测试16：验证HTML报告格式
test('测试16：验证HTML报告格式', () => {
  const results = {
    success: true,
    framework: 'playwright',
    results: {
      total: 5,
      passed: 5,
      failed: 0,
      skipped: 0,
      duration: 5000
    }
  };

  const report = generateHtmlReport(results);

  assert.ok(report.includes('<td>总用例数</td>'));
  assert.ok(report.includes('<td>5</td>'));
  assert.ok(report.includes('playwright'));
});

// 测试17：测试默认报告格式
test('测试17：测试默认报告格式', () => {
  const results = {
    success: true,
    framework: 'jest',
    results: {
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      duration: 100
    }
  };

  const report = generateTestReport(results);

  // 默认应该是Markdown格式
  assert.ok(report.includes('# 测试报告'));
  assert.ok(report.includes('jest'));
});

// 测试18：测试通过率计算
test('测试18：测试通过率计算', () => {
  const results = {
    success: true,
    framework: 'jest',
    results: {
      total: 100,
      passed: 80,
      failed: 15,
      skipped: 5,
      duration: 10000
    }
  };

  const report = generateMarkdownReport(results);

  // 验证通过率 = 80/100 * 100 = 80.00%
  assert.ok(report.includes('| 通过率 | 80.00% |'));
});

// 测试19：测试覆盖率百分比格式
test('测试19：测试覆盖率百分比格式', () => {
  const results = {
    success: true,
    framework: 'jest',
    results: {
      total: 10,
      passed: 10,
      failed: 0,
      skipped: 0,
      duration: 1000
    },
    coverage: {
      lines: 95.67,
      statements: 98.23,
      branches: 85.45,
      functions: 92.11
    }
  };

  const report = generateMarkdownReport(results);

  // 验证覆盖率数值格式正确
  assert.ok(report.includes('| 行覆盖率 | 95.67% |'));
  assert.ok(report.includes('| 语句覆盖率 | 98.23% |'));
  assert.ok(report.includes('| 分支覆盖率 | 85.45% |'));
  assert.ok(report.includes('| 函数覆盖率 | 92.11% |'));
});

// 测试20：测试不支持的数据格式
test('测试20：测试不支持的数据格式', () => {
  const results = {
    success: true,
    framework: 'jest',
    results: {
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      duration: 100
    }
  };

  const report = generateTestReport(results, 'unsupported');

  // 不支持的格式应该返回JSON
  const parsed = JSON.parse(report);
  assert.strictEqual(parsed.framework, 'jest');
});

// 输出测试结果
console.log('\n=== 测试结果 ===');
console.log(`总计: ${passCount + failCount} 个测试`);
console.log(`通过: ${passCount} 个 ✅`);
console.log(`失败: ${failCount} 个 ❌`);
console.log(`通过率: ${((passCount / (passCount + failCount)) * 100).toFixed(2)}%`);

if (failCount === 0) {
  console.log('\n🎉 所有测试通过！');
  process.exit(0);
} else {
  console.log('\n❌ 有测试失败');
  process.exit(1);
}
