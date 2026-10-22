/**
 * 测试框架集成模块
 * 统一集成Jest、Pytest、Playwright测试框架
 *
 * 功能：
 * 1. 检测测试框架
 * 2. 执行测试脚本
 * 3. 收集测试结果
 * 4. 生成测试报告
 * 5. 提供统一的运行接口
 *
 * @version 2.0.0
 * @date 2026-07-05
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 检测测试框架
 * @param {string} testPath - 测试路径
 * @returns {string|null} 检测到的测试框架
 */
function detectTestFramework(testPath) {
  if (!fs.existsSync(testPath)) {
    return null;
  }

  // 检测Jest
  if (fs.existsSync(path.join(testPath, 'jest.config.js')) ||
      fs.existsSync(path.join(testPath, 'jest.config.ts')) ||
      fs.existsSync(path.join(testPath, 'package.json'))) {
    // 检查package.json中是否有jest配置
    const packageJsonPath = path.join(testPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.jest || (packageJson.devDependencies && packageJson.devDependencies.jest)) {
        return 'jest';
      }
    }
    if (fs.existsSync(path.join(testPath, 'jest.config.js')) ||
        fs.existsSync(path.join(testPath, 'jest.config.ts'))) {
      return 'jest';
    }
  }

  // 检测Pytest
  if (fs.existsSync(path.join(testPath, 'pytest.ini')) ||
      fs.existsSync(path.join(testPath, 'pyproject.toml')) ||
      fs.existsSync(path.join(testPath, 'setup.cfg'))) {
    return 'pytest';
  }

  // 检测Playwright
  if (fs.existsSync(path.join(testPath, 'playwright.config.ts')) ||
      fs.existsSync(path.join(testPath, 'playwright.config.js'))) {
    return 'playwright';
  }

  return null;
}

/**
 * 检测测试框架是否已安装
 * @param {string} framework - 测试框架名称
 * @returns {boolean} 是否已安装
 */
function isFrameworkInstalled(framework) {
  try {
    switch (framework) {
      case 'jest':
        execSync('npx jest --version', { stdio: 'pipe' });
        return true;
      case 'pytest':
        execSync('pytest --version', { stdio: 'pipe' });
        return true;
      case 'playwright':
        execSync('npx playwright --version', { stdio: 'pipe' });
        return true;
      default:
        return false;
    }
  } catch (error) {
    return false;
  }
}

/**
 * 执行Jest测试
 * @param {string} testPath - 测试路径
 * @param {Object} options - 测试选项
 * @returns {Object} 测试结果
 */
async function executeJestTests(testPath, options = {}) {
  const {
    coverage = true,
    verbose = true,
    parallel = false,
    timeout = 30000,
    testPattern = null
  } = options;

  if (!isFrameworkInstalled('jest')) {
    return {
      success: false,
      error: 'Jest未安装，请先安装Jest：npm install --save-dev jest'
    };
  }

  try {
    // 构建Jest命令
    let command = 'npx jest --json';
    if (coverage) command += ' --coverage';
    if (verbose) command += ' --verbose';
    if (testPattern) command += ` --testPathPattern="${testPattern}"`;

    // 执行测试
    const startTime = Date.now();
    const result = execSync(command, {
      cwd: testPath,
      encoding: 'utf8',
      timeout: timeout,
      maxBuffer: 50 * 1024 * 1024 // 50MB
    });
    const endTime = Date.now();

    // 解析结果
    const jestResult = JSON.parse(result);

    return {
      success: jestResult.success,
      framework: 'jest',
      results: {
        total: jestResult.numTotalTests,
        passed: jestResult.numPassedTests,
        failed: jestResult.numFailedTests,
        skipped: jestResult.numPendingTests,
        duration: endTime - startTime
      },
      coverage: jestResult.coverageMap ? parseJestCoverage(jestResult.coverageMap) : null,
      testResults: jestResult.testResults,
      report: {
        html: coverage ? path.join(testPath, 'coverage', 'lcov-report', 'index.html') : null,
        json: coverage ? path.join(testPath, 'coverage', 'coverage-final.json') : null
      }
    };
  } catch (error) {
    // Jest失败时也会抛出错误，需要解析错误输出
    try {
      const errorOutput = error.stdout || error.stderr;
      if (errorOutput) {
        const jestResult = JSON.parse(errorOutput);
        return {
          success: false,
          framework: 'jest',
          results: {
            total: jestResult.numTotalTests,
            passed: jestResult.numPassedTests,
            failed: jestResult.numFailedTests,
            skipped: jestResult.numPendingTests,
            duration: 0
          },
          error: error.message,
          testResults: jestResult.testResults
        };
      }
    } catch (parseError) {
      // 无法解析JSON，返回原始错误
    }

    return {
      success: false,
      framework: 'jest',
      error: error.message
    };
  }
}

/**
 * 执行Pytest测试
 * @param {string} testPath - 测试路径
 * @param {Object} options - 测试选项
 * @returns {Object} 测试结果
 */
async function executePytestTests(testPath, options = {}) {
  const {
    coverage = true,
    verbose = true,
    parallel = false,
    timeout = 30000,
    testPattern = null
  } = options;

  if (!isFrameworkInstalled('pytest')) {
    return {
      success: false,
      error: 'Pytest未安装，请先安装Pytest：pip install pytest pytest-cov'
    };
  }

  try {
    // 构建Pytest命令
    let command = 'pytest --json-report';
    if (coverage) command += ' --cov --cov-report=json';
    if (verbose) command += ' -v';
    if (testPattern) command += ` -k "${testPattern}"`;

    // 执行测试
    const startTime = Date.now();
    const result = execSync(command, {
      cwd: testPath,
      encoding: 'utf8',
      timeout: timeout,
      maxBuffer: 50 * 1024 * 1024
    });
    const endTime = Date.now();

    // 解析结果
    const reportPath = path.join(testPath, '.report.json');
    const coveragePath = path.join(testPath, 'coverage.json');

    let testResults = null;
    if (fs.existsSync(reportPath)) {
      testResults = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    }

    let coverageData = null;
    if (coverage && fs.existsSync(coveragePath)) {
      coverageData = parsePytestCoverage(JSON.parse(fs.readFileSync(coveragePath, 'utf8')));
    }

    return {
      success: testResults ? testResults.summary.failed === 0 : true,
      framework: 'pytest',
      results: testResults ? {
        total: testResults.summary.total,
        passed: testResults.summary.passed,
        failed: testResults.summary.failed,
        skipped: testResults.summary.skipped,
        duration: endTime - startTime
      } : null,
      coverage: coverageData,
      testResults: testResults,
      report: {
        html: coverage ? path.join(testPath, 'htmlcov', 'index.html') : null,
        json: coverage ? coveragePath : null
      }
    };
  } catch (error) {
    return {
      success: false,
      framework: 'pytest',
      error: error.message
    };
  }
}

/**
 * 执行Playwright测试
 * @param {string} testPath - 测试路径
 * @param {Object} options - 测试选项
 * @returns {Object} 测试结果
 */
async function executePlaywrightTests(testPath, options = {}) {
  const {
    coverage = false, // Playwright不支持代码覆盖率
    verbose = true,
    parallel = false,
    timeout = 30000,
    testPattern = null,
    browsers = ['chromium']
  } = options;

  if (!isFrameworkInstalled('playwright')) {
    return {
      success: false,
      error: 'Playwright未安装，请先安装Playwright：npm install --save-dev @playwright/test'
    };
  }

  try {
    // 构建Playwright命令
    let command = 'npx playwright test --reporter=json';
    if (verbose) command += ' --list';
    if (testPattern) command += ` --grep "${testPattern}"`;
    if (!parallel) command += ' --workers=1';

    // 执行测试
    const startTime = Date.now();
    const result = execSync(command, {
      cwd: testPath,
      encoding: 'utf8',
      timeout: timeout,
      maxBuffer: 50 * 1024 * 1024
    });
    const endTime = Date.now();

    // 解析结果
    const reportPath = path.join(testPath, 'test-results', 'report.json');
    let testResults = null;
    if (fs.existsSync(reportPath)) {
      testResults = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    }

    return {
      success: testResults ? testResults.stats.failures === 0 : true,
      framework: 'playwright',
      results: testResults ? {
        total: testResults.stats.tests,
        passed: testResults.stats.passed,
        failed: testResults.stats.failures,
        skipped: testResults.stats.skipped,
        duration: endTime - startTime
      } : null,
      testResults: testResults,
      report: {
        html: path.join(testPath, 'playwright-report', 'index.html'),
        json: reportPath
      }
    };
  } catch (error) {
    return {
      success: false,
      framework: 'playwright',
      error: error.message
    };
  }
}

/**
 * 统一的测试执行接口
 * @param {Object} config - 测试配置
 * @returns {Object} 测试结果
 */
async function executeTests(config) {
  const { testPath, framework, options = {} } = config;

  // 自动检测框架
  const detectedFramework = framework || detectTestFramework(testPath);
  if (!detectedFramework) {
    return {
      success: false,
      error: '无法检测到测试框架，请明确指定框架类型'
    };
  }

  // 根据框架执行测试
  switch (detectedFramework) {
    case 'jest':
      return await executeJestTests(testPath, options);
    case 'pytest':
      return await executePytestTests(testPath, options);
    case 'playwright':
      return await executePlaywrightTests(testPath, options);
    default:
      return {
        success: false,
        error: `不支持的测试框架: ${detectedFramework}`
      };
  }
}

/**
 * 解析Jest覆盖率数据
 * @param {Object} coverageMap - Jest覆盖率Map
 * @returns {Object} 标准化的覆盖率数据
 */
function parseJestCoverage(coverageMap) {
  let totalLines = 0;
  let coveredLines = 0;
  let totalStatements = 0;
  let coveredStatements = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;

  for (const file of Object.values(coverageMap)) {
    totalLines += file.l.total;
    coveredLines += file.l.covered;
    totalStatements += file.s.total;
    coveredStatements += file.s.covered;
    totalBranches += file.b.total;
    coveredBranches += file.b.covered;
    totalFunctions += file.f.total;
    coveredFunctions += file.f.covered;
  }

  return {
    lines: totalLines > 0 ? (coveredLines / totalLines * 100).toFixed(2) : 0,
    statements: totalStatements > 0 ? (coveredStatements / totalStatements * 100).toFixed(2) : 0,
    branches: totalBranches > 0 ? (coveredBranches / totalBranches * 100).toFixed(2) : 0,
    functions: totalFunctions > 0 ? (coveredFunctions / totalFunctions * 100).toFixed(2) : 0
  };
}

/**
 * 解析Pytest覆盖率数据
 * @param {Object} coverageData - Pytest覆盖率数据
 * @returns {Object} 标准化的覆盖率数据
 */
function parsePytestCoverage(coverageData) {
  let totalLines = 0;
  let coveredLines = 0;

  for (const file of Object.values(coverageData.files)) {
    totalLines += file.summary.num_statements;
    coveredLines += file.summary.covered_lines;
  }

  return {
    lines: totalLines > 0 ? (coveredLines / totalLines * 100).toFixed(2) : 0
  };
}

/**
 * 生成测试报告
 * @param {Object} results - 测试结果
 * @param {string} format - 报告格式（html/json/markdown）
 * @returns {string} 报告内容
 */
function generateTestReport(results, format = 'markdown') {
  switch (format) {
    case 'json':
      return JSON.stringify(results, null, 2);
    case 'markdown':
      return generateMarkdownReport(results);
    case 'html':
      return generateHtmlReport(results);
    default:
      return JSON.stringify(results, null, 2);
  }
}

/**
 * 生成Markdown格式报告
 * @param {Object} results - 测试结果
 * @returns {string} Markdown报告
 */
function generateMarkdownReport(results) {
  const lines = [
    `# 测试报告`,
    ``,
    `**测试框架**: ${results.framework}`,
    `**执行时间**: ${new Date().toISOString()}`,
    ``,
    `## 测试结果`,
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 总用例数 | ${results.results.total} |`,
    `| 通过数 | ${results.results.passed} |`,
    `| 失败数 | ${results.results.failed} |`,
    `| 跳过数 | ${results.results.skipped} |`,
    `| 执行时长 | ${results.results.duration}ms |`,
    `| 通过率 | ${(results.results.passed / results.results.total * 100).toFixed(2)}% |`
  ];

  if (results.coverage) {
    lines.push(``, `## 覆盖率`, ``);
    lines.push(`| 类型 | 覆盖率 |`);
    lines.push(`|------|--------|`);

    if (results.coverage.lines) {
      lines.push(`| 行覆盖率 | ${results.coverage.lines}% |`);
    }
    if (results.coverage.statements) {
      lines.push(`| 语句覆盖率 | ${results.coverage.statements}% |`);
    }
    if (results.coverage.branches) {
      lines.push(`| 分支覆盖率 | ${results.coverage.branches}% |`);
    }
    if (results.coverage.functions) {
      lines.push(`| 函数覆盖率 | ${results.coverage.functions}% |`);
    }
  }

  return lines.join('\n');
}

/**
 * 生成HTML格式报告
 * @param {Object} results - 测试结果
 * @returns {string} HTML报告
 */
function generateHtmlReport(results) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>测试报告</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    .success { color: green; }
    .failure { color: red; }
  </style>
</head>
<body>
  <h1>测试报告</h1>
  <p><strong>测试框架</strong>: ${results.framework}</p>
  <p><strong>执行时间</strong>: ${new Date().toISOString()}</p>

  <h2>测试结果</h2>
  <table>
    <tr><th>指标</th><th>数值</th></tr>
    <tr><td>总用例数</td><td>${results.results.total}</td></tr>
    <tr><td>通过数</td><td class="success">${results.results.passed}</td></tr>
    <tr><td>失败数</td><td class="failure">${results.results.failed}</td></tr>
    <tr><td>跳过数</td><td>${results.results.skipped}</td></tr>
    <tr><td>执行时长</td><td>${results.results.duration}ms</td></tr>
    <tr><td>通过率</td><td>${(results.results.passed / results.results.total * 100).toFixed(2)}%</td></tr>
  </table>

  ${results.coverage ? `
  <h2>覆盖率</h2>
  <table>
    <tr><th>类型</th><th>覆盖率</th></tr>
    ${results.coverage.lines ? `<tr><td>行覆盖率</td><td>${results.coverage.lines}%</td></tr>` : ''}
    ${results.coverage.statements ? `<tr><td>语句覆盖率</td><td>${results.coverage.statements}%</td></tr>` : ''}
    ${results.coverage.branches ? `<tr><td>分支覆盖率</td><td>${results.coverage.branches}%</td></tr>` : ''}
    ${results.coverage.functions ? `<tr><td>函数覆盖率</td><td>${results.coverage.functions}%</td></tr>` : ''}
  </table>
  ` : ''}
</body>
</html>`;
}

// 导出模块
module.exports = {
  detectTestFramework,
  isFrameworkInstalled,
  executeJestTests,
  executePytestTests,
  executePlaywrightTests,
  executeTests,
  parseJestCoverage,
  parsePytestCoverage,
  generateTestReport,
  generateMarkdownReport,
  generateHtmlReport
};
