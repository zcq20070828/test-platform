'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ============================================================
// 工具检测
// ============================================================

/**
 * 检测已安装的 UI 测试工具
 * @returns {Promise<{playwright: boolean, selenium: boolean, cypress: boolean}>}
 */
async function detectTools() {
  const check = (bin) => {
    try {
      const resolved = require.resolve(bin);
      return fs.existsSync(resolved);
    } catch {
      return false;
    }
  };

  // 优先检查本地 node_modules，再检查全局
  const localPlaywright = check(path.join(process.cwd(), 'node_modules', '.bin', 'playwright'));
  const localSelenium   = check(path.join(process.cwd(), 'node_modules', '.bin', 'selenium-side-runner'));
  const localCypress    = check(path.join(process.cwd(), 'node_modules', '.bin', 'cypress'));

  // 备选：检查全局 bin
  const globalPlaywright = ['/usr/local/bin/playwright', '/usr/bin/playwright'].some(p => fs.existsSync(p));
  const globalSelenium   = ['/usr/local/bin/selenium-side-runner', '/usr/bin/selenium-side-runner'].some(p => fs.existsSync(p));
  const globalCypress    = ['/usr/local/bin/cypress', '/usr/bin/cypress'].some(p => fs.existsSync(p));

  // 检查 npm 全局 bin 目录
  const npmGlobalBin = process.env.npm_config_prefix
    ? path.join(process.env.npm_config_prefix, 'bin')
    : path.join(os.homedir(), '.npm-global', 'bin');
  const npmGlobalPlaywright = fs.existsSync(path.join(npmGlobalBin, 'playwright'));
  const npmGlobalSelenium   = fs.existsSync(path.join(npmGlobalBin, 'selenium-side-runner'));
  const npmGlobalCypress    = fs.existsSync(path.join(npmGlobalBin, 'cypress'));

  return {
    playwright: localPlaywright || globalPlaywright || npmGlobalPlaywright,
    selenium:   localSelenium   || globalSelenium   || npmGlobalSelenium,
    cypress:    localCypress    || globalCypress    || npmGlobalCypress,
  };
}

/**
 * 根据环境自动选择最佳工具
 * @param {object} available - detectTools() 的返回值
 * @returns {'playwright'|'selenium'|'cypress'|null}
 */
function selectBestTool(available) {
  if (available.playwright) return 'playwright';
  if (available.selenium)   return 'selenium';
  if (available.cypress)     return 'cypress';
  return null;
}

// ============================================================
// JUnit XML 解析
// ============================================================

/**
 * 解析 JUnit XML 为统一格式
 * 使用位置扫描替代正则回溯，避免贪婪匹配跨标签问题。
 * @param {string} xmlContent
 * @returns {{ testcases: Array, summary: object }}
 */
function parseJUnitXML(xmlContent) {
  const testcases = [];
  const content    = xmlContent;
  let pos = 0;

  while (true) {
    // 找下一个 <testcase 开始位置
    const openIdx = content.indexOf('<testcase', pos);
    if (openIdx === -1) break;

    // 提取属性部分：找到对应的 >
    const gtIdx = content.indexOf('>', openIdx);
    if (gtIdx === -1) break;

    const attrsRaw = content.slice(openIdx + 9, gtIdx); // 9 = len('<testcase')
    const isSelfClosing = content[gtIdx - 1] === '/';
    const attrs = isSelfClosing ? attrsRaw.slice(0, -1).trim() : attrsRaw.trim();

    let body = '';
    if (!isSelfClosing) {
      // 找对应的 </testcase> 结束位置
      const closeIdx = content.indexOf('</testcase>', gtIdx);
      if (closeIdx !== -1) {
        body = content.slice(gtIdx + 1, closeIdx);
        pos = closeIdx + 12; // len('</testcase>')
      } else {
        pos = gtIdx + 1;
      }
    } else {
      pos = gtIdx + 1;
    }

    const nameAttr = /name="([^"]*)"/.exec(attrs);
    const classAttr = /classname="([^"]*)"/.exec(attrs);
    const timeAttr  = /time="([^"]*)"/.exec(attrs);

    const name    = nameAttr ? nameAttr[1] : 'unknown';
    const classname = classAttr ? classAttr[1] : '';
    const duration = timeAttr ? Math.round(parseFloat(timeAttr[1]) * 1000) : 0;

    let status = 'passed';
    let error   = null;
    let stack   = null;


    const hasFailure = body.length > 0 && /<failure[^>]*>/i.test(body);
    const hasSkipped = body.length > 0 && (/<\/skipped>/i.test(body) || /<skipped[^>]*\/?>/i.test(body));

    if (hasFailure) {
      const failureMatch = /<failure[^>]*>([\s\S]*?)<\/failure>/i.exec(body);
      const failureBody  = (failureMatch && failureMatch[1].trim()) ? failureMatch[1] : body.replace(/<failure[^>]*\/>/i, '').replace(/<[^>]+>/g, '').trim();
      status = 'failed';

      const msgMatch = /message="([^"]*)"/.exec(body);
      const typeMatch = /type="([^"]*)"/.exec(body);
      error = msgMatch ? msgMatch[1] : failureBody.replace(/<[^>]+>/g, '').trim();
      stack = typeMatch ? `[${typeMatch[1]}] ${failureBody.replace(/<[^>]+>/g, '').trim()}` : failureBody.replace(/<[^>]+>/g, '').trim();
    } else if (hasSkipped) {
      status = 'skipped';
    }

    testcases.push({
      name: name,
      classname: classname,
      status,
      duration,
      error,
      stack,
    });
  }

  const passed   = testcases.filter(t => t.status === 'passed').length;
  const failed   = testcases.filter(t => t.status === 'failed').length;
  const skipped  = testcases.filter(t => t.status === 'skipped').length;
  const total    = testcases.length;
  const duration = testcases.reduce((sum, t) => sum + (t.duration || 0), 0);

  return {
    testcases,
    summary: { total, passed, failed, skipped, duration },
  };
}

// ============================================================
// UTRM 格式转换
// ============================================================

/**
 * 将原生结果转换为 UTRM 统一格式
 * @param {object} results - 解析后的测试结果
 * @param {string} tool - 工具名
 * @param {number} exitCode
 * @param {string} [rawOutput]
 * @returns {object} UTRM 格式
 */
function toUTRM(results, tool, exitCode, rawOutput) {
  const { testcases = [], summary = {} } = results;

  return {
    tool,
    timestamp: new Date().toISOString(),
    summary: {
      total:    summary.total    || testcases.length,
      passed:   summary.passed   || testcases.filter(t => t.status === 'passed').length,
      failed:   summary.failed   || testcases.filter(t => t.status === 'failed').length,
      skipped:  summary.skipped  || testcases.filter(t => t.status === 'skipped').length,
      duration: summary.duration || testcases.reduce((s, t) => s + (t.duration || 0), 0),
    },
    testcases,
    exitCode: exitCode || 0,
    raw: rawOutput || null,
  };
}

// ============================================================
// 子进程执行辅助
// ============================================================

/**
 * 执行命令并返回 stdout + stderr
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [options]
 * @param {object} [env] - 环境变量
 * @param {number} [timeoutMs]
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, timedOut: boolean}>}
 */
function runCommand(cmd, args, options = {}, env = {}, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const envMerged = { ...process.env, ...env };
    const stdouts = [];
    const stderrs = [];
    let timedOut = false;

    const proc = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      env: envMerged,
      shell: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout.on('data', (d) => stdouts.push(d.toString()));
    proc.stderr.on('data', (d) => stderrs.push(d.toString()));

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout:   stdouts.join(''),
        stderr:   stderrs.join(''),
        exitCode: code || 0,
        timedOut,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout:   stdouts.join(''),
        stderr:   stderrs.join('') + err.message,
        exitCode: 1,
        timedOut: false,
      });
    });
  });
}

// ============================================================
// Playwright 调用
// ============================================================

/**
 * 使用 Playwright 执行测试
 * @param {string} script - 测试脚本路径或内联脚本内容
 * @param {object} [options]
 * @param {boolean} [options.headed]
 * @param {string}  [options.reporter='list']
 * @param {string}  [options.browser='chromium']
 * @param {string}  [options.project]
 * @param {string}  [options.baseUrl]
 * @param {number}  [options.timeout=30000]
 * @param {number}  [options.workers=0] - 并发数，0=框架默认
 * @param {number}  [options.retries=0] - 失败重试次数
 * @param {boolean} [options.coverage=false] - 生成覆盖率报告
 * @param {boolean} [options.verbose=false] - 详细输出
 * @param {boolean} [options.debug=false] - 调试模式
 * @param {object}  [env]
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invokePlaywright(script, options = {}, env = {}) {
  const {
    headed    = false,
    reporter  = 'list',
    browser   = 'chromium',
    project,
    baseUrl,
    timeout   = 30000,
    workers   = 0,
    retries   = 0,
    coverage  = false,
    verbose   = false,
    debug     = false,
  } = options;

  // 检测 playwright test 命令（注意：需要 playwright test 子命令）
  const localBin  = path.join(process.cwd(), 'node_modules', '.bin', 'playwright');
  // 检查是否有 @playwright/test 的本地安装（包含 test 子命令）
  const hasLocalTest = fs.existsSync(path.join(process.cwd(), 'node_modules', '.bin', 'playwright-test')) ||
                       fs.existsSync(path.join(process.cwd(), 'node_modules', '@playwright', 'test'));
  // 使用 npx playwright test 确保使用正确的测试运行器
  const pwCmd     = hasLocalTest ? 'npx playwright test' : 'npx playwright test';

  // 构建参数
  const args = [];

  // 报告器：verbose 模式强制使用 list，否则使用传入的 reporter 或默认 dot
  const actualReporter = verbose ? 'list' : reporter;
  if (actualReporter === 'junit') {
    args.push('--reporter=junit');
    // JUnit 输出到 stdout
  } else {
    args.push(`--reporter=${actualReporter}`);
  }

  // 浏览器
  if (browser && browser !== 'chromium') {
    args.push(`--browser=${browser}`);
  }

  // headed 模式：debug 模式强制 headed
  // playwright CLI 默认 headless，只在需要时添加 --headed
  const actualHeaded = headed || debug;
  if (actualHeaded) {
    args.push('--headed');
  }
  // 注意：不添加 --headed=false，playwright 默认 headless

  // 项目
  if (project) {
    args.push(`--project=${project}`);
  }

  // baseUrl
  if (baseUrl) {
    args.push(`--base-url=${baseUrl}`);
  }

  // 超时（playwright 使用 --timeout 参数，单位 ms）
  if (timeout) {
    args.push(`--timeout=${timeout}`);
  }

  // 并发数（workers）
  if (workers > 0) {
    args.push(`--workers=${workers}`);
  }

  // 失败重试
  if (retries > 0) {
    args.push(`--retries=${retries}`);
  }

  // 测试脚本：使用 env 目录解析相对路径
  const baseDir = (env && typeof env === 'string' && fs.existsSync(env) && fs.statSync(env).isDirectory()) ? env : process.cwd();
  const scriptPath = path.isAbsolute(script) ? script : path.join(baseDir, script);
  if (!fs.existsSync(scriptPath)) {
    // 如果是内联脚本，写入临时文件
    const tmpDir  = os.tmpdir();
    const tmpFile = path.join(tmpDir, `pw_inline_${Date.now()}.spec.js`);
    fs.writeFileSync(tmpFile, script, 'utf-8');
    args.push(tmpFile);
  } else {
    args.push(scriptPath);
  }

  // 调试模式：设置 DEBUG 环境变量
  const mergedEnv = { ...env };
  if (debug) {
    mergedEnv.DEBUG = 'pw:api';
  }

  // 覆盖率：Playwright 通过配置或 reporter 支持，这里添加覆盖率相关参数
  // 注：Playwright 原生覆盖率需要额外配置，这里只标记支持状态
  let systemCoverageAvailable = false;
  let coverageNote = '';
  if (coverage) {
    // Playwright 的覆盖率需要项目配置 playwright.config 中设置
    // CLI 不直接支持覆盖率参数，需要通过 reporter 或项目配置
    coverageNote = 'Playwright coverage requires project configuration (playwright.config.ts). See: https://playwright.dev/docs/api-testing#coverage';
    systemCoverageAvailable = true; // Playwright 可以通过配置支持覆盖率
  }

  // 使用测试项目目录作为 cwd（如果 env 是有效目录）
  const runOpts = { cwd: (env && typeof env === 'string' && fs.existsSync(env) && fs.statSync(env).isDirectory()) ? env : process.cwd() };
  const result = await runCommand(pwCmd, args, runOpts, mergedEnv, timeout + 10000);

  let utrm;
  if (reporter === 'junit') {
    // Playwright JUnit reporter 输出到文件，找 xml 文件
    const reportDir = path.join(process.cwd(), 'test-results');
    const xmlFiles   = [];
    try {
      const entries = fs.readdirSync(reportDir);
      xmlFiles.push(...entries.filter(f => f.endsWith('.xml')).map(f => path.join(reportDir, f)));
    } catch {}

    if (xmlFiles.length > 0) {
      const xmlContent = fs.readFileSync(xmlFiles[0], 'utf-8');
      const parsed     = parseJUnitXML(xmlContent);
      utrm = toUTRM(parsed, 'playwright', result.exitCode, result.stdout + result.stderr);
    } else {
      // 尝试从 stdout 解析 JUnit
      const parsed = parseJUnitXML(result.stdout);
      if (parsed.testcases.length > 0) {
        utrm = toUTRM(parsed, 'playwright', result.exitCode, result.stdout + result.stderr);
      } else {
        utrm = parsePlaywrightListOutput(result.stdout + result.stderr, result.exitCode);
      }
    }
  } else {
    utrm = parsePlaywrightListOutput(result.stdout + result.stderr, result.exitCode);
  }

  // 补充错误信息
  if (result.timedOut) {
    utrm.error = 'TIMEOUT';
    utrm.testcases.push({
      name:    '__timeout__',
      status:  'failed',
      duration: timeout,
      error:   `Test execution timed out after ${timeout}ms`,
      stack:   null,
    });
    utrm.summary.failed += 1;
    utrm.summary.total   += 1;
  }

  // 计算脚本覆盖率（基于执行的测试用例推导测试文件）
  const executedFiles = new Set();
  for (const tc of utrm.testcases) {
    // 从 classname 或 name 中提取文件路径信息
    if (tc.classname && (tc.classname.includes('/') || tc.classname.includes('\\'))) {
      executedFiles.add(tc.classname);
    } else if (tc.name && tc.file) {
      // 如果有 file 字段（可能在原始 testcase 中）
      executedFiles.add(tc.file);
    }
  }
  const executedArray = Array.from(executedFiles);

  // 添加执行选项相关的 extra 信息
  utrm.extra = utrm.extra || {};
  utrm.extra.scriptCoverage = {
    executed: executedArray,
    covered: executedArray.length,
    total: executedArray.length,
  };
  utrm.extra.systemCoverageAvailable = systemCoverageAvailable;

  // 添加 notes 说明
  const notes = [];
  if (coverageNote) notes.push(coverageNote);
  if (workers > 0) notes.push(`Workers: ${workers}`);
  if (retries > 0) notes.push(`Retries: ${retries}`);
  if (debug) notes.push('Debug mode enabled (DEBUG=pw:api, --headed)');
  if (verbose) notes.push('Verbose mode enabled (reporter=list)');
  if (notes.length > 0) {
    utrm.extra.note = notes.join('; ');
  }

  return utrm;
}

/**
 * 从 Playwright list reporter 输出解析测试结果
 * @param {string} output
 * @param {number} exitCode
 * @returns {object} UTRM 格式
 */
function parsePlaywrightListOutput(output, exitCode) {
  const lines     = output.split('\n');
  const testcases = [];
  let currentName   = null;
  let currentStatus = null;
  let currentError  = null;
  let currentStack  = null;
  let duration      = 0;

  const durationRegex = /(\d+)ms|(\d+)s|(\d+)m/;
  const statusRegex   = /✓|✗|×|passed|failed|skipped/i;

  for (const line of lines) {
    const passedMatch   = line.match(/^.*✓.*--.*$/i) || line.match(/^.*\[32m✓|^.*PASSED.*$/i);
    const failedMatch   = line.match(/^.*✗.*--.*$/i) || line.match(/^.*\[31m✗|^.*FAILED.*$/i);
    const skippedMatch  = line.match(/^.*skipped.*$/i) || line.match(/^\s*-\s+/i);
    const durationMatch = line.match(/(\d+)ms|(\d+\.\d+)s/);

    if (passedMatch) {
      if (currentName) {
        testcases.push({ name: currentName, status: currentStatus || 'passed', duration, error: currentError, stack: currentStack });
      }
      const namePart = line.replace(/[✓✗×]/g, '').replace(/\[\d+m/g, '').trim();
      currentName   = namePart || 'test';
      currentStatus = 'passed';
      currentError  = null;
      currentStack  = null;
      duration      = durationMatch ? (durationMatch[2] ? parseFloat(durationMatch[2]) * 1000 : parseInt(durationMatch[1])) : 0;
    } else if (failedMatch) {
      if (currentName) {
        testcases.push({ name: currentName, status: currentStatus || 'failed', duration, error: currentError, stack: currentStack });
      }
      const namePart = line.replace(/[✓✗×]/g, '').replace(/\[\d+m/g, '').trim();
      currentName   = namePart || 'test';
      currentStatus = 'failed';
      duration      = durationMatch ? (durationMatch[2] ? parseFloat(durationMatch[2]) * 1000 : parseInt(durationMatch[1])) : 0;
    } else if (skippedMatch) {
      currentStatus = 'skipped';
    } else if (line.trim().startsWith('Error:') || line.trim().startsWith('AssertionError')) {
      currentError = (currentError ? currentError + '\n' : '') + line.trim();
      currentStack = (currentStack ? currentStack + '\n' : '') + line.trim();
    }
  }

  if (currentName) {
    testcases.push({ name: currentName, status: currentStatus || 'passed', duration, error: currentError, stack: currentStack });
  }

  const passed  = testcases.filter(t => t.status === 'passed').length;
  const failed  = testcases.filter(t => t.status === 'failed').length;
  const skipped = testcases.filter(t => t.status === 'skipped').length;
  const totalDur = testcases.reduce((s, t) => s + (t.duration || 0), 0);

  return {
    tool:      'playwright',
    timestamp: new Date().toISOString(),
    summary: {
      total:    testcases.length,
      passed,
      failed,
      skipped,
      duration: totalDur,
    },
    testcases,
    exitCode,
    raw: output,
  };
}

// ============================================================
// Selenium 调用
// ============================================================

/**
 * 使用 Selenium 执行测试
 * @param {string} script - .side 文件路径或 Node.js 脚本路径
 * @param {object} [options]
 * @param {string}  [options.browser='chrome']
 * @param {boolean} [options.headless=true]
 * @param {number}  [options.timeout=30000]
 * @param {number}  [options.workers=0] - 并发数，Selenium 不直接支持
 * @param {number}  [options.retries=0] - 失败重试，Selenium 不直接支持
 * @param {boolean} [options.coverage=false] - 覆盖率，Selenium 不直接支持
 * @param {boolean} [options.verbose=false] - 详细输出
 * @param {boolean} [options.debug=false] - 调试模式
 * @param {object}  [env]
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invokeSelenium(script, options = {}, env = {}) {
  const {
    browser   = 'chrome',
    headless  = true,
    timeout   = 30000,
    workers   = 0,
    retries   = 0,
    coverage  = false,
    verbose   = false,
    debug     = false,
  } = options;

  // debug 模式强制禁用 headless
  const actualHeadless = debug ? false : headless;

  // 测试脚本：使用 env 目录解析相对路径
  const baseDir = (env && typeof env === 'string' && fs.existsSync(env) && fs.statSync(env).isDirectory()) ? env : process.cwd();
  const scriptPath = path.isAbsolute(script) ? script : path.join(baseDir, script);
  if (!fs.existsSync(scriptPath)) {
    return {
      tool:      'selenium',
      timestamp: new Date().toISOString(),
      summary:   { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
      testcases: [],
      exitCode:  1,
      error:     'SCRIPT_NOT_FOUND',
      raw:       `Script not found: ${script}`,
    };
  }

  const isSideFile = scriptPath.endsWith('.side');

  let result;
  if (isSideFile) {
    // selenium-side-runner
    const runnerCmd = 'selenium-side-runner';
    const args = [
      scriptPath,
      `--browser=${browser}`,
      actualHeadless ? '--headless' : '',
    ].filter(Boolean);

    result = await runCommand(runnerCmd, args, {}, env, timeout + 10000);
    const utrm = parseSeleniumRunnerOutput(result.stdout + result.stderr, result.exitCode, result.timedOut, timeout);
    
    // 添加执行选项相关的 extra 信息
    utrm.extra = utrm.extra || {};
    const notes = [];
    if (workers > 0) notes.push(`Workers option not supported by Selenium side-runner`);
    if (retries > 0) notes.push(`Retries option not supported by Selenium side-runner`);
    if (coverage) notes.push(`Coverage option not supported by Selenium side-runner`);
    if (debug) notes.push('Debug mode enabled (headless=false)');
    if (verbose) notes.push('Verbose mode requested (no direct CLI support)');
    if (notes.length > 0) {
      utrm.extra.note = notes.join('; ');
    }
    utrm.extra.systemCoverageAvailable = false;
    
    // 计算脚本覆盖率
    const executedFiles = [scriptPath];
    utrm.extra.scriptCoverage = {
      executed: executedFiles,
      covered: executedFiles.length,
      total: executedFiles.length,
    };
    
    return utrm;
  } else {
    // Node.js 脚本
    result = await runCommand('node', [scriptPath], {}, env, timeout + 10000);
    const utrm = parseSeleniumNodeOutput(result.stdout + result.stderr, result.exitCode, result.timedOut, timeout);
    
    // 添加执行选项相关的 extra 信息
    utrm.extra = utrm.extra || {};
    const notes = [];
    if (workers > 0) notes.push(`Workers option not applicable for Node.js Selenium scripts`);
    if (retries > 0) notes.push(`Retries option not applicable for Node.js Selenium scripts`);
    if (coverage) notes.push(`Coverage option requires manual implementation in Node.js script`);
    if (debug) notes.push('Debug mode enabled');
    if (verbose) notes.push('Verbose mode requested');
    if (notes.length > 0) {
      utrm.extra.note = notes.join('; ');
    }
    utrm.extra.systemCoverageAvailable = false;
    
    // 计算脚本覆盖率
    const executedFiles = [scriptPath];
    utrm.extra.scriptCoverage = {
      executed: executedFiles,
      covered: executedFiles.length,
      total: executedFiles.length,
    };
    
    return utrm;
  }
}

/**
 * 解析 selenium-side-runner 输出
 */
function parseSeleniumRunnerOutput(output, exitCode, timedOut, timeout) {
  const lines     = output.split('\n');
  const testcases = [];

  for (const line of lines) {
    // 匹配 "✓ 项目名 - 测试用例名" 或 "✗ 项目名 - 测试用例名"
    const passedMatch  = line.match(/^[ ✔✓]+(.+?)\s+[-–]\s+(.+?)\s*(?:\d+ms)?$/i);
    const failedMatch  = line.match(/^[ ✗✘×]+(.+?)\s+[-–]\s+(.+?)\s*(?:\d+ms)?$/i);

    if (passedMatch || failedMatch) {
      const [_, project, name] = passedMatch || failedMatch;
      const isPassed = !!passedMatch;
      const timeMatch = line.match(/(\d+)ms/);
      testcases.push({
        name:     `${project.trim()} - ${name.trim()}`,
        status:   isPassed ? 'passed' : 'failed',
        duration: timeMatch ? parseInt(timeMatch[1]) : 0,
        error:    isPassed ? null : `Failed: ${name.trim()}`,
        stack:    null,
      });
    }
  }

  const passed  = testcases.filter(t => t.status === 'passed').length;
  const failed  = testcases.filter(t => t.status === 'failed').length;
  const skipped = testcases.filter(t => t.status === 'skipped').length;
  const totalDur = testcases.reduce((s, t) => s + (t.duration || 0), 0);

  const utrm = {
    tool:      'selenium',
    timestamp: new Date().toISOString(),
    summary: {
      total:    testcases.length,
      passed,
      failed,
      skipped,
      duration: totalDur,
    },
    testcases,
    exitCode,
    raw: output,
  };

  if (timedOut) {
    utrm.testcases.push({
      name:     '__timeout__',
      status:   'failed',
      duration: timeout,
      error:    `Test execution timed out after ${timeout}ms`,
      stack:    null,
    });
    utrm.summary.failed += 1;
    utrm.summary.total   += 1;
    utrm.error = 'TIMEOUT';
  }

  return utrm;
}

/**
 * 解析 Selenium Node.js 脚本输出（期望 JSON 格式）
 */
function parseSeleniumNodeOutput(output, exitCode, timedOut, timeout) {
  try {
    const jsonStart = output.indexOf('{');
    if (jsonStart !== -1) {
      const jsonStr = output.slice(jsonStart);
      const parsed  = JSON.parse(jsonStr);
      return toUTRM(parsed, 'selenium', exitCode, output);
    }
  } catch {}

  // fallback: 尝试从文本解析
  const utrm = {
    tool:      'selenium',
    timestamp: new Date().toISOString(),
    summary:   { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
    testcases: [],
    exitCode,
    raw:       output,
  };

  if (timedOut) {
    utrm.error = 'TIMEOUT';
  }

  return utrm;
}

// ============================================================
// Cypress 调用
// ============================================================

/**
 * 使用 Cypress 执行测试
 * @param {string} script - spec 文件路径或目录路径
 * @param {object} [options]
 * @param {boolean} [options.headed]
 * @param {string}  [options.browser]
 * @param {boolean} [options.record]
 * @param {string}  [options.key]
 * @param {string}  [options.spec]
 * @param {object}  [options.config]
 * @param {number}  [options.timeout=30000]
 * @param {number}  [options.workers=0] - 并发数，Cypress 通过 parallel 参数支持
 * @param {number}  [options.retries=0] - 失败重试，Cypress 通过 config 支持
 * @param {boolean} [options.coverage=false] - 覆盖率，需要 @cypress/code-coverage 插件
 * @param {boolean} [options.verbose=false] - 详细输出
 * @param {boolean} [options.debug=false] - 调试模式
 * @param {object}  [env]
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invokeCypress(script, options = {}, env = {}) {
  const {
    headed   = false,
    browser,
    record   = false,
    key,
    spec,
    config,
    timeout  = 30000,
    workers  = 0,
    retries  = 0,
    coverage = false,
    verbose  = false,
    debug    = false,
  } = options;

  // debug 模式强制 headed
  const actualHeaded = headed || debug;

  const localBin  = path.join(process.cwd(), 'node_modules', '.bin', 'cypress');
  const hasLocal  = fs.existsSync(localBin);
  const cyCmd     = hasLocal ? localBin : 'npx cypress';

  const args = ['run'];

  if (actualHeaded) {
    args.push('--headed');
  }

  if (browser) {
    args.push(`--browser=${browser}`);
  }

  if (record) {
    args.push('--record');
    if (key) {
      args.push(`--key=${key}`);
    }
  }

  if (spec) {
    args.push(`--spec="${spec}"`);
  }

  // 合并 config 和额外配置（retries）
  const mergedConfig = { ...config };
  if (retries > 0) {
    mergedConfig.retries = retries;
  }
  
  if (Object.keys(mergedConfig).length > 0) {
    const configJson = JSON.stringify(mergedConfig).replace(/"/g, '\\"');
    args.push(`--config="${configJson}"`);
  }

  // spec 文件或目录
  const scriptPath = path.resolve(script);
  if (fs.existsSync(scriptPath)) {
    args.push(`--spec="${scriptPath}"`);
  }

  // workers (parallel): Cypress 需要 --parallel 标志和 Cypress Cloud
  // 注：--parallel 需要 record=true 和有效的 Cypress Cloud 账号
  if (workers > 0) {
    args.push('--parallel');
    // workers 数量由 Cypress Cloud 自动管理，CLI 不直接指定
  }

  // coverage: 需要 @cypress/code-coverage 插件
  // CLI 不直接支持覆盖率参数，需要通过插件配置
  let systemCoverageAvailable = false;
  if (coverage) {
    // 设置环境变量提示需要覆盖率插件
    // 但实际覆盖率需要项目配置 @cypress/code-coverage 插件
    systemCoverageAvailable = true; // Cypress 可以通过插件支持覆盖率
  }

  // verbose: Cypress 没有直接的 verbose 标志，但可以通过 config 设置 video/screenshot
  if (verbose) {
    // verbose 模式下，确保输出更多详情
    // Cypress 默认输出较为详细，这里不做额外 CLI 参数修改
  }

  const result = await runCommand(cyCmd, args, {}, env, timeout + 15000);
  const utrm = parseCypressOutput(result.stdout + result.stderr, result.exitCode, result.timedOut, timeout);
  
  // 添加执行选项相关的 extra 信息
  utrm.extra = utrm.extra || {};
  const notes = [];
  
  if (workers > 0) {
    notes.push(`Workers: --parallel enabled (requires Cypress Cloud for parallel execution)`);
  }
  if (retries > 0) {
    notes.push(`Retries: ${retries} (via config.retries)`);
  }
  if (coverage) {
    notes.push(`Coverage requires @cypress/code-coverage plugin. See: https://docs.cypress.io/guides/tooling/code-coverage`);
  }
  if (debug) {
    notes.push('Debug mode enabled (headed)');
  }
  if (verbose) {
    notes.push('Verbose mode requested');
  }
  if (notes.length > 0) {
    utrm.extra.note = notes.join('; ');
  }
  
  utrm.extra.systemCoverageAvailable = systemCoverageAvailable;
  
  // 计算脚本覆盖率
  const executedFiles = [scriptPath];
  utrm.extra.scriptCoverage = {
    executed: executedFiles,
    covered: executedFiles.length,
    total: executedFiles.length,
  };
  
  return utrm;
}

/**
 * 解析 Cypress run 输出
 * @param {string} output
 * @param {number} exitCode
 * @param {boolean} timedOut
 * @param {number} timeout
 * @returns {object} UTRM 格式
 */
function parseCypressOutput(output, exitCode, timedOut, timeout) {
  const lines     = output.split('\n');
  const testcases = [];

  // 匹配 Cypress 的测试结果行
  // 格式: "  (skipped)  一些描述" 或 "  100ms  一些描述  Route: ..."
  const testLineRegex = /^\s*(?:\(\w+\)\s+)?(\d+ms\s+)?(.+?)(?:\s+Route:.*)?\s*$/;

  for (const line of lines) {
    const skippedMatch = line.match(/^\s*\((\w+)\)\s+(.+)$/);
    const passingMatch = line.match(/^\s*(\d+)ms\s+(.+)$/);

    if (skippedMatch) {
      const status = skippedMatch[1].toLowerCase();
      if (['skipped', 'pending'].includes(status)) {
        testcases.push({
          name:     skippedMatch[2].trim(),
          status:   'skipped',
          duration: 0,
          error:    null,
          stack:    null,
        });
      }
    } else if (passingMatch) {
      const duration = parseInt(passingMatch[1]);
      const name     = passingMatch[2].trim();
      testcases.push({
        name,
        status:   'passed',
        duration,
        error:    null,
        stack:    null,
      });
    }
  }

  // 从 summary 提取数字
  let passedNum  = 0;
  let failedNum  = 0;
  let skippedNum = 0;
  let totalDur   = 0;

  const passingMatch  = output.match(/(\d+)\s+passing/i);
  const failingMatch  = output.match(/(\d+)\s+failing/i);
  const pendingMatch  = output.match(/(\d+)\s+pending/i);
  const durationMatch = output.match(/(\d+)\s+ms?/);

  if (passingMatch)  passedNum  = parseInt(passingMatch[1]);
  if (failingMatch) failedNum  = parseInt(failingMatch[1]);
  if (pendingMatch) skippedNum = parseInt(pendingMatch[1]);

  // 从输出末尾的 Running 统计提取时间
  const timeMatch = output.match(/All specs passed!.*?(\d+)ms/);
  if (timeMatch) totalDur = parseInt(timeMatch[1]);

  // 如果从行解析到的 testcases 数量为 0，则使用 summary 数字补充
  if (testcases.length === 0 && (passedNum > 0 || failedNum > 0)) {
    const summaryMatch = output.match(/(?:Running:|Tests:).*?(\d+).*?(\d+).*?(\d+)/i);
    if (summaryMatch) {
      passedNum  = passedNum  || parseInt(summaryMatch[1]) || 0;
      failedNum  = failedNum  || parseInt(summaryMatch[2]) || 0;
      skippedNum = skippedNum  || parseInt(summaryMatch[3]) || 0;
    }
  }

  const utrm = {
    tool:      'cypress',
    timestamp: new Date().toISOString(),
    summary: {
      total:    testcases.length || (passedNum + failedNum + skippedNum),
      passed:   passedNum,
      failed:   failedNum,
      skipped:  skippedNum,
      duration: totalDur || (testcases.reduce((s, t) => s + t.duration, 0)),
    },
    testcases,
    exitCode,
    raw: output,
  };

  if (timedOut) {
    utrm.error = 'TIMEOUT';
    utrm.testcases.push({
      name:     '__timeout__',
      status:   'failed',
      duration: timeout,
      error:    `Test execution timed out after ${timeout}ms`,
      stack:    null,
    });
    utrm.summary.failed += 1;
    utrm.summary.total   += 1;
  }

  return utrm;
}

// ============================================================
// 主入口
// ============================================================

/**
 * 主调用函数
 * @param {object} params
 * @param {string} params.testScript - 测试脚本路径或内联内容
 * @param {string} [params.testFramework] - 显式指定工具
 * @param {string} [params.testType='e2e']
 * @param {object} [params.env] - 环境变量
 * @param {object} [params.options] - 工具特定选项
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invoke(params) {
  const {
    testScript,
    testFramework,
    testType      = 'e2e',
    env           = {},
    options       = {},
  } = params;

  if (!testScript) {
    return {
      tool:      testFramework || 'unknown',
      timestamp: new Date().toISOString(),
      summary:   { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
      testcases: [],
      exitCode:  1,
      error:     'MISSING_SCRIPT',
      raw:       null,
    };
  }

  // 1. 确定工具
  const framework = testFramework || null;
  let tool;

  if (framework) {
    tool = framework.toLowerCase();
  } else {
    const detected  = await detectTools();
    const bestTool  = selectBestTool(detected);
    if (!bestTool) {
      return {
        tool:      'unknown',
        timestamp: new Date().toISOString(),
        summary:   { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
        testcases: [],
        exitCode:  1,
        error:     'TOOL_NOT_FOUND',
        raw:       null,
        installCommands: {
          playwright: 'npm install -D @playwright/test && npx playwright install --with-deps chromium',
          selenium:   'npm install -g selenium-side-runner selenium-webdriver',
          cypress:    'npm install cypress',
        },
      };
    }
    tool = bestTool;
  }

  // 2. 执行对应工具
  switch (tool) {
    case 'playwright':
      return invokePlaywright(testScript, options, env);
    case 'selenium':
      return invokeSelenium(testScript, options, env);
    case 'cypress':
      return invokeCypress(testScript, options, env);
    default:
      return {
        tool:      tool,
        timestamp: new Date().toISOString(),
        summary:   { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
        testcases: [],
        exitCode:  1,
        error:     `UNKNOWN_TOOL: ${tool}`,
        raw:       null,
      };
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  invoke,
  invokePlaywright,
  invokeSelenium,
  invokeCypress,
  detectTools,
  selectBestTool,
  parseJUnitXML,
  toUTRM,
};
