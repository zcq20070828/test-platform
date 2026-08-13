/**
 * script-quality-checker.js
 * 测试脚本质量自检引擎
 * 
 * 提供五维度质量检查：覆盖率、可维护性、断言、边界、安全
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 主检查函数
 * @param {Object} params
 * @param {string} params.code - 测试脚本代码
 * @param {string} [params.framework='playwright'] - 框架类型
 * @param {Object} [params.options={}] - 检查选项
 */
export async function checkScriptQuality({ code, framework = 'playwright', options = {} }) {
  const {
    minQualityScore = 60,
    checkSecurity = true,
    checkBoundary = true
  } = options

  if (!code || typeof code !== 'string') {
    return { error: 'code参数缺失或类型错误', qualityScore: 0, qualityGrade: 'E' }
  }

  const lines = code.split('\n')
  const language = detectLanguage(code)

  // 五维度检查
  const coverage = checkCoverage(code, framework)
  const maintainability = checkMaintainability(code, framework)
  const assertion = checkAssertion(code, framework)
  const boundary = checkBoundary ? checkBoundaryConditions(code, framework) : { score: 100, issues: [] }
  const security = checkSecurity ? checkSecurityIssues(code) : { score: 100, issues: [] }

  // 加权总分
  const qualityScore = Math.round(
    coverage.score * 0.30 +
    maintainability.score * 0.25 +
    assertion.score * 0.20 +
    boundary.score * 0.15 +
    security.score * 0.10
  )

  const qualityGrade = getGrade(qualityScore)
  const allIssues = [
    ...coverage.issues,
    ...maintainability.issues,
    ...assertion.issues,
    ...boundary.issues,
    ...security.issues
  ]

  const actionItems = buildActionItems(allIssues)
  const suggestions = buildSuggestions(allIssues)

  return {
    qualityScore,
    qualityGrade,
    dimensions: { coverage, maintainability, assertion, boundary, security },
    summary: buildSummary(qualityGrade, allIssues),
    suggestions,
    actionItems,
    passed: qualityScore >= minQualityScore,
    metrics: {
      totalLines: lines.length,
      codeLines: lines.filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#')).length,
      testCases: countTestCases(code, framework),
      assertions: countAssertions(code, framework)
    }
  }
}

/** 检测代码语言 */
function detectLanguage(code) {
  if (code.includes('playwright') || code.includes('PageObject') || code.includes('page.locator')) return 'javascript/playwright'
  if (code.includes('import pytest') || code.includes('def test_')) return 'python/pytest'
  if (code.includes('describe(') || code.includes('it(') || code.includes('expect(')) return 'javascript/jest'
  if (code.includes('pm.test') || code.includes('pm.request')) return 'javascript/postman'
  return 'unknown'
}

/** 覆盖率检查 */
function checkCoverage(code, framework) {
  const issues = []
  const checks = {
    positiveCase: false,    // 正向用例
    negativeCase: false,    // 反向用例
    boundaryCase: false,    // 边界用例
    asyncCase: false,       // 异步/等待用例
    errorCase: false        // 异常处理用例
  }

  if (/test\(|it\(|def test_|pm\.test/.test(code)) checks.positiveCase = true
  if (/throw|reject|Error|except|catch|404|400|500/.test(code)) checks.negativeCase = true
  if (/boundary|边界|edge|min|max|null|undefined|empty/.test(code.toLowerCase())) checks.boundaryCase = true
  if (/await|wait|delay|sleep|setTimeout/.test(code)) checks.asyncCase = true
  if (/try\s*\{|catch\s*\(/.test(code)) checks.errorCase = true

  const coveredCount = Object.values(checks).filter(Boolean).length
  const score = Math.round((coveredCount / 5) * 100)

  if (!checks.positiveCase) issues.push({ type: 'coverage', severity: 'critical', msg: '缺少正向测试用例' })
  if (!checks.negativeCase) issues.push({ type: 'coverage', severity: 'medium', msg: '缺少异常/负向用例' })
  if (!checks.errorCase) issues.push({ type: 'coverage', severity: 'medium', msg: '缺少异常捕获处理' })

  return { score, issues, details: checks }
}

/** 可维护性检查 */
function checkMaintainability(code, framework) {
  const issues = []
  let score = 100

  // 硬编码超时检测
  const sleepMatches = code.match(/sleep\((\d+)\)|wait\((\d+)\)|setTimeout.*?(\d+)/g) || []
  for (const m of sleepMatches) {
    const ms = parseInt(m.match(/\d+/)?.[0] || '0')
    if (ms > 3000) {
      issues.push({ type: 'maintainability', severity: 'medium', msg: `硬编码等待时间过长: ${m}（建议使用显式等待）` })
      score -= 8
    }
  }

  // 硬编码URL检测
  const urlMatches = code.match(/https?:\/\/[^\s'"`]+/g) || []
  const hardcodedUrls = urlMatches.filter(u => !u.includes('${') && !u.includes('{{'))
  if (hardcodedUrls.length > 0) {
    issues.push({ type: 'maintainability', severity: 'low', msg: `存在 ${hardcodedUrls.length} 个硬编码URL，建议提取为配置` })
    score -= 5
  }

  // 选择器稳定性评估
  const selectorScore = assessSelectorStability(code)
  score = Math.round(score * (selectorScore / 100))

  if (selectorScore < 60) {
    issues.push({ type: 'maintainability', severity: 'high', msg: '选择器稳定性差，优先使用 data-testid/aria-label/role 替代 class/id' })
  }

  // 重复代码检测（简单行重复）
  const lines = code.split('\n').filter(l => l.trim().length > 20)
  const lineSet = new Set(lines)
  if (lineSet.size < lines.length * 0.7) {
    issues.push({ type: 'maintainability', severity: 'medium', msg: '检测到重复代码，建议抽取公共方法' })
    score -= 10
  }

  return { score: Math.max(0, Math.min(100, score)), issues, selectorStability: selectorScore }
}

/** 评估选择器稳定性 */
function assessSelectorStability(code) {
  let score = 100
  // 不稳定选择器扣分
  const unstablePatterns = [
    { re: /\[[\w-]+=['"][^\s'"`]+['"]\](?!\])/g, name: '属性选择器' }, // 任意属性
    { re: /\.btn[0-9]|\.row[0-9]/g, name: '序号选择器' },
    { re: /nth-child|nth-of-type/g, name: 'nth-child伪类' },
    { re: /getByText\(['"][^'"]+['"]\)(?!\[)/g, name: '纯文本定位' },
    { re: /data-testid|data-test/g, name: 'data-testid', add: 15 }, // 稳定，加分
  ]

  for (const p of unstablePatterns) {
    const matches = code.match(p.re) || []
    if (p.add) {
      score += p.add
    } else {
      if (matches.length > 0) score -= matches.length * 5
    }
  }

  return Math.max(0, Math.min(100, score))
}

/** 断言质量检查 */
function checkAssertion(code, framework) {
  const issues = []
  let score = 100

  const assertionCount = countAssertions(code, framework)
  const testCaseCount = countTestCases(code, framework)

  if (testCaseCount > 0 && assertionCount === 0) {
    issues.push({ type: 'assertion', severity: 'critical', msg: '存在测试用例但无任何断言' })
    score = 0
  } else if (testCaseCount > 0) {
    const avgAssertions = assertionCount / testCaseCount
    if (avgAssertions < 1) {
      issues.push({ type: 'assertion', severity: 'medium', msg: `平均每个用例断言数不足（${avgAssertions.toFixed(1)}），建议每个用例至少1个断言` })
      score -= 15
    }
    if (avgAssertions > 20) {
      issues.push({ type: 'assertion', severity: 'low', msg: `单个用例断言过多（${avgAssertions.toFixed(0)}），建议拆分` })
      score -= 5
    }
  }

  // 软断言使用场景
  if (/expect.*\.soft|softAssert|verify\(/.test(code)) {
    issues.push({ type: 'assertion', severity: 'info', msg: '使用软断言，请确认场景是否适合（汇总报告而非遇错即停）' })
  }

  // 缺少有意义断言消息
  const expectWithoutMsg = code.match(/expect\([^)]+\)(?!\s*\.)/g) || []
  if (expectWithoutMsg.length > 3) {
    issues.push({ type: 'assertion', severity: 'low', msg: `${expectWithoutMsg.length} 个断言缺少可读消息，建议添加 .toBe(msg)` })
    score -= 3
  }

  return { score: Math.max(0, score), issues, assertionCount, testCaseCount }
}

/** 边界条件检查 */
function checkBoundaryConditions(code, framework) {
  const issues = []
  let score = 100

  const boundaryChecks = [
    { pattern: /null|NULL|nil|None|undefined|null\?|!.*=== null/g, name: '空值null' },
    { pattern: /undefined|void 0/g, name: 'undefined' },
    { pattern: /["']+\s*["']|["']+$|length\s*===\s*0|len\(\s*0\s*\)/g, name: '空字符串' },
    { pattern: /\{[\s\S]{0,5}\}|Array\(0\)|\[\]|length\s*=\s*0/g, name: '空对象/数组' },
    { pattern: /\d{10,}/g, name: '超长数值' },
    { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, name: '疑似IP地址' },
  ]

  const hasBoundary = boundaryChecks.some(b => b.pattern.test(code))
  if (!hasBoundary) {
    issues.push({ type: 'boundary', severity: 'medium', msg: '缺少边界值测试用例（null/空字符串/空对象/超长输入）' })
    score -= 20
  }

  // SQL注入/XSS 测试
  if (!/['";]|--|<\s*script|SCRIPT|alert\(/.test(code)) {
    issues.push({ type: 'boundary', severity: 'low', msg: '缺少特殊字符/注入测试用例' })
    score -= 5
  }

  return { score: Math.max(0, score), issues }
}

/** 安全检查 */
function checkSecurityIssues(code) {
  const issues = []
  let score = 100

  // 凭证硬编码
  const secretPatterns = [
    { re: /password\s*[=:]\s*['"][^'"]+['"]|passwd\s*[=:]/gi, name: '密码硬编码' },
    { re: /api[_-]?key\s*[=:]\s*['"][A-Za-z0-9]{16,}['"]/gi, name: 'API Key硬编码' },
    { re: /token\s*[=:]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi, name: 'Token硬编码' },
    { re: /bearer\s+[A-Za-z0-9_\-\.]+/gi, name: '认证头硬编码' },
    { re: /\b\d{15,18}\b/g, name: '疑似身份证号', severity: 'high' },
    { re: /\b1[3-9]\d{9}\b/g, name: '疑似手机号', severity: 'low' },
  ]

  for (const p of secretPatterns) {
    const matches = code.match(p.re) || []
    if (matches.length > 0) {
      const sev = p.severity || 'high'
      issues.push({ type: 'security', severity: sev, msg: `${p.name}风险（${matches.length}处）：建议使用环境变量或密钥管理器` })
      score -= sev === 'high' ? 15 : 5
    }
  }

  return { score: Math.max(0, Math.min(100, score)), issues }
}

function countTestCases(code, framework) {
  if (framework === 'playwright' || framework === 'jest') {
    return (code.match(/test\s*\(|it\s*\(|describe\s*\(/g) || []).length
  }
  if (framework === 'pytest') {
    return (code.match(/def test_|class Test/g) || []).length
  }
  if (framework === 'postman') {
    return (code.match(/pm\.test\s*\(/g) || []).length
  }
  return 0
}

function countAssertions(code, framework) {
  if (framework === 'playwright' || framework === 'jest') {
    return (code.match(/expect\s*\(/g) || []).length
  }
  if (framework === 'pytest') {
    return (code.match(/assert\s+/g) || []).length
  }
  if (framework === 'postman') {
    return (code.match(/pm\.expect\s*\(|pm\.response\./g) || []).length
  }
  return 0
}

function getGrade(score) {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'E'
}

function buildActionItems(issues) {
  const priorityMap = { critical: 'high', high: 'high', medium: 'medium', low: 'low' }
  return issues.map(issue => ({
    priority: priorityMap[issue.severity] || 'medium',
    type: issue.type,
    issue: issue.msg,
    fix: getFixSuggestion(issue)
  }))
}

function getFixSuggestion(issue) {
  const msg = issue.msg
  if (msg.includes('sleep')) return '使用 page.waitForSelector() 或 page.waitForResponse() 替代固定等待'
  if (msg.includes('选择器')) return '改用 data-testid > aria-label > role > text 的稳定选择器策略'
  if (msg.includes('断言') && msg.includes('无')) return '添加 expect() 断言，确保验证预期结果'
  if (msg.includes('边界')) return '增加 null/undefined/空字符串/超长输入等边界测试用例'
  if (msg.includes('凭证') || msg.includes('API Key')) return '使用 process.env.API_KEY 或密钥管理器，避免硬编码'
  if (msg.includes('空值')) return '添加针对 null/undefined/空值的测试用例'
  return `审查并修复: ${msg}`
}

function buildSuggestions(issues) {
  const highPriority = issues.filter(i => i.severity === 'critical' || i.severity === 'high')
  return highPriority.map(i => `[${i.severity.toUpperCase()}] ${i.msg} → ${getFixSuggestion(i)}`)
}

function buildSummary(grade, issues) {
  const highCount = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length
  const mediumCount = issues.filter(i => i.severity === 'medium').length
  const lowCount = issues.filter(i => i.severity === 'low').length

  const gradeMap = {
    A: '脚本质量优秀，可直接用于生产。',
    B: '脚本质量良好，存在少量可优化项。',
    C: '脚本质量一般，建议修复中等问题后使用。',
    D: '脚本质量较差，必须修复关键问题。',
    E: '脚本质量不合格，建议重写。'
  }

  let summary = gradeMap[grade] || ''
  if (highCount > 0) summary += ` 发现 ${highCount} 个高优先级问题需立即处理。`
  if (mediumCount > 0) summary += ` ${mediumCount} 个中优先级问题建议处理。`
  if (lowCount > 0) summary += ` ${lowCount} 个低优先级问题可选处理。`
  return summary
}

// ===== 自测块 =====
if (process.argv[1] === fileURLToPath(import.meta.url).replace(/\.js$/, '')) {
  const sampleCode = `
const { test, expect } = require('@playwright/test');
test('login success', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.fill('[data-testid="username"]', 'admin');
  await page.fill('[data-testid="password"]', 'pass123');
  await page.click('button[type="submit"]');
  await expect(page.locator('.dashboard')).toBeVisible();
});
test('login with empty password', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.fill('[data-testid="username"]', 'admin');
  await page.click('button[type="submit"]');
  await expect(page.locator('.error-msg')).toBeVisible();
});
`
  checkScriptQuality({ code: sampleCode, framework: 'playwright' }).then(r => {
    console.log('=== 脚本质量自检结果 ===')
    console.log(`评分: ${r.qualityScore}/100 (${r.qualityGrade})`)
    console.log(`通过: ${r.passed}`)
    console.log(`维度: 覆盖率=${r.dimensions.coverage.score} | 可维护性=${r.dimensions.maintainability.score} | 断言=${r.dimensions.assertion.score} | 边界=${r.dimensions.boundary.score} | 安全=${r.dimensions.security.score}`)
    console.log(`建议:\n  ${r.suggestions.join('\n  ')}`)
    console.log(`问题总数: ${r.actionItems.length}`)
    console.log(JSON.stringify({ qualityScore: r.qualityScore, qualityGrade: r.qualityGrade }, null, 2))
  }).catch(err => console.error('自测失败:', err))
}
