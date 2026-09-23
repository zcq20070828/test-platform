/**
 * 测试脚本生成器模块
 * 从测试用例自动生成多种框架的测试脚本
 *
 * 支持的测试框架：
 * 1. Jest（JavaScript/TypeScript单元测试）
 * 2. Pytest（Python单元测试）
 * 3. Playwright（E2E测试）
 * 4. API测试（Axios/Supertest）
 *
 * @version 2.0.0
 * @date 2026-07-05
 */

/**
 * 测试用例解析器
 * @param {Object} testData - 测试数据
 * @returns {Object} 解析后的测试数据
 */
function parseTestData(testData) {
  if (!testData || !testData.testSuite || !testData.testCases) {
    throw new Error('测试数据格式无效：缺少testSuite或testCases字段');
  }

  return {
    suite: testData.testSuite,
    cases: testData.testCases
  };
}

/**
 * Jest测试脚本生成器
 * @param {Object} testData - 测试数据
 * @param {Object} options - 生成选项
 * @returns {string} Jest测试脚本
 */
function generateJestScript(testData, options = {}) {
  const {
    useTypeScript = false,
    includeImports = true,
    timeout = 30000
  } = options;

  const parsed = parseTestData(testData);
  const lines = [];

  // 导入语句
  if (includeImports) {
    if (useTypeScript) {
      lines.push(`import { test, expect, Page } from '@playwright/test';`);
    } else {
      lines.push(`const { test, expect } = require('@playwright/test');`);
    }
    lines.push('');
  }

  // 测试套件描述
  lines.push(`describe('${parsed.suite.name}', () => {`);
  lines.push(`  /**`);
  lines.push(`   * ${parsed.suite.description}`);
  lines.push(`   */`);
  lines.push('');

  // 生成测试用例
  parsed.cases.forEach((testCase, index) => {
    lines.push(`  test('${testCase.id}: ${testCase.name}', async ({ page }) => {`);

    // 生成测试步骤
    if (testCase.steps && testCase.steps.length > 0) {
      testCase.steps.forEach(step => {
        const stepCode = generateStepCode(step, 'jest');
        if (stepCode) {
          lines.push(`    ${stepCode}`);
        }
      });
    }

    lines.push(`  });`);
    lines.push('');
  });

  lines.push('});');

  return lines.join('\n');
}

/**
 * Pytest测试脚本生成器
 * @param {Object} testData - 测试数据
 * @param {Object} options - 生成选项
 * @returns {string} Pytest测试脚本
 */
function generatePytestScript(testData, options = {}) {
  const {
    includeImports = true,
    className = null
  } = options;

  const parsed = parseTestData(testData);
  const lines = [];

  // 导入语句
  if (includeImports) {
    lines.push(`import pytest`);
    lines.push(`from playwright.sync_api import Page, expect`);
    lines.push('');
  }

  // 测试类
  const testClassName = className || parsed.suite.name.replace(/\s+/g, '_');
  lines.push(`class Test${testClassName}:`);
  lines.push(`    """${parsed.suite.description}"""`);
  lines.push('');

  // 生成测试方法
  parsed.cases.forEach((testCase, index) => {
    const methodName = `test_${testCase.id.toLowerCase().replace(/-/g, '_')}`;
    lines.push(`    def ${methodName}(self, page: Page):`);
    lines.push(`        """${testCase.name}"""`);

    // 生成测试步骤
    if (testCase.steps && testCase.steps.length > 0) {
      testCase.steps.forEach(step => {
        const stepCode = generateStepCode(step, 'pytest');
        if (stepCode) {
          lines.push(`        ${stepCode}`);
        }
      });
    }

    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Playwright E2E测试脚本生成器
 * @param {Object} testData - 测试数据
 * @param {Object} options - 生成选项
 * @returns {string} Playwright测试脚本
 */
function generatePlaywrightScript(testData, options = {}) {
  const {
    useTypeScript = false,
    includeImports = true,
    baseURL = 'http://localhost:3000'
  } = options;

  const parsed = parseTestData(testData);
  const lines = [];

  // 导入语句
  if (includeImports) {
    if (useTypeScript) {
      lines.push(`import { test, expect } from '@playwright/test';`);
    } else {
      lines.push(`const { test, expect } = require('@playwright/test');`);
    }
    lines.push('');
  }

  // 配置
  lines.push(`test.describe('${parsed.suite.name}', () => {`);
  lines.push(`  /**`);
  lines.push(`   * ${parsed.suite.description}`);
  lines.push(`   */`);
  lines.push('');

  // 生成测试用例
  parsed.cases.forEach((testCase, index) => {
    lines.push(`  test('${testCase.id}: ${testCase.name}', async ({ page }) => {`);

    // 生成测试步骤
    if (testCase.steps && testCase.steps.length > 0) {
      testCase.steps.forEach(step => {
        const stepCode = generateStepCode(step, 'playwright');
        if (stepCode) {
          lines.push(`    ${stepCode}`);
        }
      });
    }

    lines.push(`  });`);
    lines.push('');
  });

  lines.push('});');

  return lines.join('\n');
}

/**
 * API测试脚本生成器
 * @param {Object} testData - 测试数据
 * @param {Object} options - 生成选项
 * @returns {string} API测试脚本
 */
function generateApiTestScript(testData, options = {}) {
  const {
    framework = 'axios', // 'axios' | 'supertest'
    useTypeScript = false,
    includeImports = true,
    baseURL = 'http://localhost:3000'
  } = options;

  const parsed = parseTestData(testData);
  const lines = [];

  // 导入语句
  if (includeImports) {
    if (framework === 'axios') {
      if (useTypeScript) {
        lines.push(`import axios from 'axios';`);
      } else {
        lines.push(`const axios = require('axios');`);
      }
    } else {
      if (useTypeScript) {
        lines.push(`import request from 'supertest';`);
      } else {
        lines.push(`const request = require('supertest');`);
      }
    }
    lines.push('');
  }

  // 测试套件
  lines.push(`describe('${parsed.suite.name}', () => {`);
  lines.push(`  /**`);
  lines.push(`   * ${parsed.suite.description}`);
  lines.push(`   */`);
  lines.push('');

  // 生成测试用例
  parsed.cases.forEach((testCase, index) => {
    lines.push(`  test('${testCase.id}: ${testCase.name}', async () => {`);

    // 生成API请求
    if (testCase.steps && testCase.steps.length > 0) {
      testCase.steps.forEach(step => {
        const stepCode = generateApiStepCode(step, framework, baseURL);
        if (stepCode) {
          lines.push(`    ${stepCode}`);
        }
      });
    }

    lines.push(`  });`);
    lines.push('');
  });

  lines.push('});');

  return lines.join('\n');
}

/**
 * 生成测试步骤代码
 * @param {Object} step - 测试步骤
 * @param {string} framework - 测试框架
 * @returns {string} 步骤代码
 */
function generateStepCode(step, framework) {
  const { action, target, value, expected } = step;

  const actionMapping = {
    jest: {
      'navigate': (t, v, e) => `await page.goto('${t}');`,
      'fill': (t, v, e) => `await page.fill('${t}', '${v}');`,
      'click': (t, v, e) => `await page.click('${t}');`,
      'wait': (t, v, e) => `await page.waitForSelector('${t}');`,
      'assert': (t, v, e) => `await expect(page.locator('${t}')).toHaveText('${e || ''}');`,
      'assertVisible': (t, v, e) => `await expect(page.locator('${t}')).toBeVisible();`,
      'screenshot': (t, v, e) => `await page.screenshot({ path: '${t}' });`
    },
    pytest: {
      'navigate': (t, v, e) => `page.goto('${t}')`,
      'fill': (t, v, e) => `page.fill('${t}', '${v}')`,
      'click': (t, v, e) => `page.click('${t}')`,
      'wait': (t, v, e) => `page.wait_for_selector('${t}')`,
      'assert': (t, v, e) => `expect(page.locator('${t}')).to_have_text('${e || ''}')`,
      'assertVisible': (t, v, e) => `expect(page.locator('${t}')).to_be_visible()`,
      'screenshot': (t, v, e) => `page.screenshot(path='${t}')`
    },
    playwright: {
      'navigate': (t, v, e) => `await page.goto('${t}');`,
      'fill': (t, v, e) => `await page.fill('${t}', '${v}');`,
      'click': (t, v, e) => `await page.click('${t}');`,
      'wait': (t, v, e) => `await page.waitForSelector('${t}');`,
      'assert': (t, v, e) => `await expect(page.locator('${t}')).toHaveText('${e || ''}');`,
      'assertVisible': (t, v, e) => `await expect(page.locator('${t}')).toBeVisible();`,
      'screenshot': (t, v, e) => `await page.screenshot({ path: '${t}' });`
    }
  };

  const mapping = actionMapping[framework];
  if (!mapping || !mapping[action]) {
    return null;
  }

  return mapping[action](target, value, expected);
}

/**
 * 生成API测试步骤代码
 * @param {Object} step - 测试步骤
 * @param {string} framework - 测试框架（axios/supertest）
 * @param {string} baseURL - 基础URL
 * @returns {string} 步骤代码
 */
function generateApiStepCode(step, framework, baseURL) {
  const { action, method, endpoint, data, expected } = step;

  if (framework === 'axios') {
    const methodCode = method || 'get';
    const dataCode = data ? `, ${JSON.stringify(data)}` : '';

    let code = `const response = await axios.${methodCode}(\`${baseURL}${endpoint}\`${dataCode});`;

    if (expected) {
      if (expected.status) {
        code += `\n    expect(response.status).toBe(${expected.status});`;
      }
      if (expected.data) {
        code += `\n    expect(response.data).toMatchObject(${JSON.stringify(expected.data)});`;
      }
    }

    return code;
  } else {
    // Supertest
    let code = `const response = await request('${baseURL}').${method || 'get'}('${endpoint}')`;

    if (data) {
      code += `.send(${JSON.stringify(data)})`;
    }

    if (expected && expected.status) {
      code += `.expect(${expected.status})`;
    }

    code += ';';

    return code;
  }
}

/**
 * 统一的测试脚本生成器
 * @param {Object} testData - 测试数据
 * @param {Object} options - 生成选项
 * @returns {Object} 生成结果
 */
function generateTestScript(testData, options = {}) {
  const { framework = 'jest' } = options;

  const generators = {
    'jest': generateJestScript,
    'pytest': generatePytestScript,
    'playwright': generatePlaywrightScript,
    'api': generateApiTestScript
  };

  const generator = generators[framework];
  if (!generator) {
    return {
      success: false,
      error: `不支持的测试框架: ${framework}`,
      supportedFrameworks: Object.keys(generators)
    };
  }

  try {
    const script = generator(testData, options);

    return {
      success: true,
      framework: framework,
      script: script,
      lineCount: script.split('\n').length,
      testCaseCount: testData.testCases ? testData.testCases.length : 0
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// 导出模块
module.exports = {
  parseTestData,
  generateJestScript,
  generatePytestScript,
  generatePlaywrightScript,
  generateApiTestScript,
  generateStepCode,
  generateApiStepCode,
  generateTestScript
};
