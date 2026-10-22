/**
 * api-test-invoker.js
 * API 测试工具统一调用封装 — 输出 UTRM 格式
 *
 * 支持：Postman/Newman、RestAssured（Java/Maven）、pytest（Python）
 *
 * 依赖安装：
 *   Newman:   npm install -g newman newman-reporter-junit newman-reporter-html
 *   pytest:   pip install pytest pytest-html pytest-xdist requests
 *   RestAssured: Maven/Gradle 项目（通过 pom.xml / build.gradle 判定）
 */

'use strict';

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── 工具检测 ────────────────────────────────────────────────────────────────

/**
 * 检测系统已安装的 API 测试工具
 * @returns {string[]} 可用工具列表
 */
function detectAvailableTools() {
  const available = [];
  const checks = [
    { name: 'newman', cmd: 'newman --version' },
    { name: 'pytest', cmd: 'pytest --version' },
    { name: 'mvn', cmd: 'mvn --version' },
    { name: 'gradle', cmd: 'gradle --version' },
    { name: 'java', cmd: 'java -version' },
  ];

  for (const check of checks) {
    try {
      execSync(check.cmd, { stdio: 'ignore', timeout: 5000 });
      available.push(check.name);
    } catch (_) {
      // ignore
    }
  }
  return available;
}

/**
 * 根据文件扩展名或路径推断工具
 * @param {string} testScript
 * @returns {string|null}
 */
function inferToolFromPath(testScript) {
  if (!testScript) return null;
  const lc = testScript.toLowerCase();

  if (lc.endsWith('.postman_collection.json') || lc.includes('postman')) {
    return 'newman';
  }
  if (lc.endsWith('.json') && fs.existsSync(testScript)) {
    // 尝试解析 JSON 判断是否为 Postman Collection
    try {
      const content = fs.readFileSync(testScript, 'utf-8');
      const obj = JSON.parse(content);
      if (obj.info && obj.item) return 'newman'; // Postman Collection 结构
    } catch (_) {}
  }
  if (lc.endsWith('_test.py') || lc.endsWith('test_.py') || lc.endsWith('.py')) {
    return 'pytest';
  }
  // Java 项目
  if (fs.existsSync(path.join(testScript, 'pom.xml')) ||
      fs.existsSync(path.join(testScript, 'build.gradle'))) {
    return 'restassured';
  }
  return null;
}

/**
 * 按推荐优先级从可用工具列表中选择最佳工具
 * @param {string[]} available - 检测到的可用工具
 * @param {string|null} testScript - 测试脚本路径
 * @param {string|null} forcedTool - 强制指定的工具
 * @returns {string}
 */
function selectBestTool(available, testScript = null, forcedTool = null) {
  if (forcedTool && available.includes(forcedTool)) return forcedTool;

  // 优先检测 testScript 类型
  const inferred = inferToolFromPath(testScript);
  if (inferred && available.includes(inferred)) return inferred;

  // 推荐优先级：newman > pytest > restassured
  const priority = ['newman', 'pytest', 'restassured'];
  for (const tool of priority) {
    if (available.includes(tool)) return tool;
  }

  throw new Error(
    'No API test tool found. Please install Newman (npm), pytest (pip), or ensure Maven/Gradle is available.'
  );
}

/**
 * 当 testScript 不是真实文件路径,而是直接传入的内联脚本内容时,
 * 根据内容推断框架并落临时文件,返回该文件路径(供后续按扩展名识别框架)。
 * 无法识别则返回 null(交由上层按路径逻辑报错)。
 * @param {string} content
 * @returns {string|null}
 */
function detectInlineScript(content) {
  if (!content || typeof content !== 'string') return null;
  const c = content.trim();
  if (!c) return null;
  let ext = null;
  let ok = false;
  // 1) Postman / Newman 集合(JSON)
  if (c.startsWith('{') || c.startsWith('[')) {
    try {
      const j = JSON.parse(c);
      if (j && (j.item || j.info || j._postman_id || j.collections)) {
        ext = 'json';
        ok = true;
      }
    } catch (_) {}
  }
  // 2) pytest 脚本
  if (!ok && /(^|\n)\s*(import\s+pytest|def\s+test_|@pytest|from\s+requests)/.test(c)) {
    ext = 'py';
    ok = true;
  }
  // 3) RestAssured / Java
  if (!ok && /RestAssured|import\s+io\.restassured|@Test\s|public\s+class/.test(c)) {
    ext = 'java';
    ok = true;
  }
  if (!ok) return null;
  try {
    const dir = path.join(os.tmpdir(), 'api-invoker-inline');
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, `inline-script-${Date.now()}.${ext}`);
    fs.writeFileSync(outPath, content, 'utf-8');
    return outPath;
  } catch (e) {
    console.error(`[api-test-invoker] 内联脚本落盘失败: ${e.message}`);
    return null;
  }
}

// ─── 命令执行 ────────────────────────────────────────────────────────────────

/**
 * 安全执行命令（spawn 异步，支持超时）
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} opts
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const {
      cwd = process.cwd(),
      timeout = 120000,
      env = {},
      verbose = false,
    } = opts;

    const startTime = Date.now();
    const mergedEnv = { ...process.env, ...env };

    const proc = spawn(cmd, args, {
      cwd,
      env: mergedEnv,
      shell: os.platform() === 'win32',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      const s = d.toString();
      if (verbose) process.stderr.write('[stdout] ' + s);
      stdout += s;
    });

    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (verbose) process.stderr.write('[stderr] ' + s);
      stderr += s;
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeout}ms: ${cmd} ${args.join(' ')}`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
        duration: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * 同步执行命令（用于简单场景）
 */
function runCommandSync(cmd, args, opts = {}) {
  const {
    cwd = process.cwd(),
    timeout = 120000,
    env = {},
    verbose = false,
    encoding = 'utf-8',
  } = opts;

  const mergedEnv = { ...process.env, ...env };
  const startTime = Date.now();

  try {
    const stdout = execSync([cmd, ...args].join(' '), {
      cwd,
      env: mergedEnv,
      timeout,
      encoding,
      stdio: verbose ? 'pipe' : ['ignore', 'pipe', 'pipe'],
    });
    return {
      stdout: stdout || '',
      stderr: '',
      exitCode: 0,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
      exitCode: err.status ?? -1,
      duration: Date.now() - startTime,
      error: err.message,
    };
  }
}

// ─── Newman / Postman ────────────────────────────────────────────────────────

/**
 * 使用 newman CLI 执行 Postman Collection
 *
 * @param {string} collectionPath - Collection JSON 文件路径
 * @param {string|null} envPath - Postman 环境变量文件路径（可选）
 * @param {object} opts
 * @param {number} opts.timeout - 超时时间（毫秒），默认 120000
 * @param {string} opts.reportFormat - 报告格式：junit(html,json)，默认 junit
 * @param {string} opts.workingDir - 工作目录，默认 collection 所在目录
 * @param {object} opts.envVars - 额外环境变量
 * @param {boolean} opts.verbose - 详细日志
 * @param {string} opts.iterationCount - 迭代次数
 * @param {string} opts.dataFile - 数据文件路径（CSV/JSON）
 * @param {number} opts.workers - 并发数（Newman 无原生并发，在 note 中说明）
 * @param {number} opts.retries - 重试次数（Newman 无原生重试，在 note 中说明）
 * @param {boolean} opts.coverage - 覆盖率（API 测试无被测系统覆盖率）
 * @param {boolean} opts.debug - 调试模式
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invokeNewman(collectionPath, envPath = null, opts = {}) {
  const {
    timeout = 120000,
    reportFormat = 'junit',
    workingDir = path.dirname(path.resolve(collectionPath)),
    envVars = {},
    verbose = false,
    iterationCount = null,
    dataFile = null,
    workers = 0,
    retries = 0,
    coverage = false,
    debug = false,
  } = opts;

  const absCollection = path.resolve(collectionPath);
  if (!fs.existsSync(absCollection)) {
    throw new Error(`Collection file not found: ${absCollection}`);
  }

  const args = ['run', absCollection];

  if (envPath) {
    const absEnv = path.resolve(envPath);
    if (fs.existsSync(absEnv)) args.push('-e', absEnv);
  }

  // Reporters
  const reporters = ['cli'];
  if (reportFormat.includes('junit')) reporters.push('junit');
  if (reportFormat.includes('html')) reporters.push('html');
  if (reportFormat.includes('json')) reporters.push('json');
  args.push('--reporters', reporters.join(','));

  // Reporter output files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newman-'));
  if (reportFormat.includes('junit')) {
    args.push('--reporter-junit-export', path.join(tmpDir, 'results.xml'));
  }
  if (reportFormat.includes('html')) {
    args.push('--reporter-html-export', path.join(tmpDir, 'report.html'));
  }
  if (reportFormat.includes('json')) {
    args.push('--reporter-json-export', path.join(tmpDir, 'results.json'));
  }

  if (iterationCount) args.push('--iteration-count', String(iterationCount));
  if (dataFile) args.push('--iteration-data', path.resolve(dataFile));

  args.push('--timeout-request', '30000');
  args.push('--timeout', String(Math.ceil(timeout / 1000)));

  if (verbose) {
    args.push('--verbose');
  }

  const result = await runCommand('newman', args, {
    cwd: workingDir,
    timeout,
    env: envVars,
    verbose,
  });

  // 解析结果
  let utrm = {
    tool: 'newman',
    timestamp: new Date().toISOString(),
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: result.duration || 0 },
    testcases: [],
    exitCode: result.exitCode,
    rawOutput: result.stdout + (result.stderr || ''),
    errors: [],
    extra: {},
  };

  // 解析 JSON 输出
  const jsonPath = path.join(tmpDir, 'results.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = parseNewmanJSON(jsonContent);
      utrm = { ...utrm, ...parsed };
    } catch (_) {}
  }

  // 备选：解析 JUnit XML
  const xmlPath = path.join(tmpDir, 'results.xml');
  if (fs.existsSync(xmlPath)) {
    try {
      const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
      const parsed = parseJUnitXML(xmlContent);
      utrm.testcases = parsed.testcases;
      utrm.summary = parsed.summary;
    } catch (_) {}
  }

  // 从 newman cli 输出中提取摘要（兜底）
  if (utrm.summary.total === 0) {
    const summaryMatch = result.stdout.match(/(\d+)\s+passed\s+\((\d+)\s+total\)/);
    if (summaryMatch) {
      utrm.summary.passed = parseInt(summaryMatch[1]);
      utrm.summary.total = parseInt(summaryMatch[2]);
      utrm.summary.failed = Math.max(0, utrm.summary.total - utrm.summary.passed);
    }
    // 尝试从 "✖ 2 failures" 提取
    const failMatch = result.stdout.match(/✖\s*(\d+)\s*failure/i) ||
                      result.stdout.match(/(\d+)\s+failure/i);
    if (failMatch) utrm.summary.failed = parseInt(failMatch[1]);
  }

  if (result.exitCode !== 0 && utrm.summary.failed === 0) {
    utrm.summary.failed = utrm.summary.total > 0
      ? Math.max(1, utrm.summary.total - utrm.summary.passed)
      : 1;
  }

  // 处理执行选项相关说明
  const notes = [];
  if (workers > 1) {
    notes.push('Newman does not support native parallel execution. Consider running multiple collections in parallel externally.');
  }
  if (retries > 0) {
    notes.push('Newman does not support native retry. Consider using Postman\'s built-in retry mechanism or external retry logic.');
  }
  
  // API 测试无被测系统覆盖率
  utrm.extra = {
    ...utrm.extra,
    systemCoverageAvailable: false,
    note: notes.length > 0 ? notes.join(' ') : undefined,
  };

  // 清理临时文件
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}

  return utrm;
}

// ─── RestAssured / Java ──────────────────────────────────────────────────────

/**
 * 执行 Java RestAssured 项目（Maven/Gradle）
 *
 * @param {string} javaProjectPath - Java 项目根目录
 * @param {object} opts
 * @param {string} opts.testClass - 指定测试类，如 "ApiTest"（默认运行全部）
 * @param {string} opts.mavenGoal - Maven 目标，如 "test"（默认 "test"）
 * @param {number} opts.timeout - 超时时间（毫秒）
 * @param {string} opts.reportFormat - 报告格式，目前仅支持 junit
 * @param {object} opts.envVars - 额外环境变量
 * @param {boolean} opts.verbose - 详细日志
 * @param {number} opts.workers - 并发进程数（Maven: -DforkCount=<N>）
 * @param {number} opts.retries - 重试次数（Maven: -Dsurefire.rerunFailingTestsCount=<N>）
 * @param {boolean} opts.coverage - 启用 Jacoco 覆盖率（尽力）
 * @param {boolean} opts.debug - 调试模式（Maven: -X）
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invokeRestAssured(javaProjectPath, opts = {}) {
  const {
    testClass = null,
    mavenGoal = 'test',
    timeout = 180000,
    reportFormat = 'junit',
    envVars = {},
    verbose = false,
    workers = 0,
    retries = 0,
    coverage = false,
    debug = false,
  } = opts;

  const absPath = path.resolve(javaProjectPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Java project path not found: ${absPath}`);
  }

  const isMaven = fs.existsSync(path.join(absPath, 'pom.xml'));
  const isGradle = fs.existsSync(path.join(absPath, 'build.gradle')) ||
                   fs.existsSync(path.join(absPath, 'build.gradle.kts'));
  const isGradlew = fs.existsSync(path.join(absPath, 'gradlew'));

  let cmd, args;

  if (isMaven) {
    cmd = 'mvn';
    args = [mavenGoal];
    if (testClass) args.push('-Dtest=' + testClass);
    args.push('-Dsurefire.reportFormat=junit');
    args.push('-Dsurefire.useFile=false');
    
    // 执行选项：workers（并发）
    if (workers > 0) {
      args.push(`-DforkCount=${workers}`);
    }
    
    // 执行选项：retries（重试失败测试）
    if (retries > 0) {
      args.push(`-Dsurefire.rerunFailingTestsCount=${retries}`);
    }
    
    // 执行选项：coverage（Jacoco）
    if (coverage) {
      args.push('-Djacoco.skip=false');
    }
    
    // 执行选项：debug
    if (debug) {
      args.push('-X');
    }
  } else if (isGradle || isGradlew) {
    cmd = isGradlew ? './gradlew' : 'gradle';
    args = ['test'];
    if (testClass) args.push('--tests', '*' + testClass + '*');
    args.push('--info'); // 获取更详细信息
    
    // Gradle 执行选项（尽力支持）
    if (workers > 0) {
      args.push('--parallel');
      args.push(`--max-workers=${workers}`);
    }
    
    if (debug) {
      args.push('--debug');
    }
  } else {
    throw new Error('No Maven (pom.xml) or Gradle (build.gradle) found in project directory.');
  }

  const result = await runCommand(cmd, args, {
    cwd: absPath,
    timeout,
    env: envVars,
    verbose,
  });

  let utrm = {
    tool: 'restassured',
    timestamp: new Date().toISOString(),
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: result.duration || 0 },
    testcases: [],
    exitCode: result.exitCode,
    rawOutput: result.stdout + (result.stderr || ''),
    errors: [],
    extra: {},
  };

  // 解析 surefire-reports
  const surefireDir = path.join(absPath, 'target', 'surefire-reports');
  const gradleReportsDir = path.join(absPath, 'build', 'test-results', 'test');

  const reportDirs = [surefireDir, gradleReportsDir].filter(d => fs.existsSync(d));

  if (reportDirs.length > 0) {
    for (const dir of reportDirs) {
      try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
        for (const file of files) {
          const xmlContent = fs.readFileSync(path.join(dir, file), 'utf-8');
          const parsed = parseJUnitXML(xmlContent);
          utrm.testcases.push(...parsed.testcases);
          utrm.summary.total += parsed.summary.total;
          utrm.summary.passed += parsed.summary.passed;
          utrm.summary.failed += parsed.summary.failed;
          utrm.summary.skipped += parsed.summary.skipped;
          utrm.summary.duration += parsed.summary.duration;
        }
      } catch (_) {}
    }
  }

  // 兜底：从输出中解析
  if (utrm.testcases.length === 0) {
    const mvnSummary = result.stdout.match(
      /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i
    );
    if (mvnSummary) {
      utrm.summary.total = parseInt(mvnSummary[1]);
      utrm.summary.failed = parseInt(mvnSummary[2]);
      utrm.summary.skipped = parseInt(mvnSummary[4]);
      utrm.summary.passed = utrm.summary.total - utrm.summary.failed - utrm.summary.skipped;
    }
  }

  // 脚本覆盖率（从 surefire reports 计算）
  if (utrm.testcases.length > 0) {
    const executedClasses = new Set(utrm.testcases.map(tc => tc.classname));
    utrm.extra.scriptCoverage = {
      executed: Array.from(executedClasses),
      covered: utrm.testcases.length,
      total: utrm.summary.total,
    };
  }

  return utrm;
}

// ─── pytest ─────────────────────────────────────────────────────────────────

/**
 * 执行 Python pytest
 *
 * @param {string} pytestPath - pytest 测试文件或目录路径
 * @param {object} opts
 * @param {string} opts.testPattern - 测试匹配模式，如 "test_user*"
 * @param {number} opts.timeout - 超时时间（毫秒），默认 120000
 * @param {string} opts.reportFormat - 报告格式：junit(html,json)，默认 junit
 * @param {string} opts.workingDir - 工作目录
 * @param {object} opts.envVars - 额外环境变量
 * @param {boolean} opts.verbose - 详细日志
 * @param {string} opts.markers - pytest markers，如 "-m smoke"
 * @param {number} opts.workers - 并发进程数（pytest: -n <N>，需 pytest-xdist）
 * @param {number} opts.retries - 重试次数（pytest: --reruns=<N>，需 pytest-rerunfailures）
 * @param {boolean} opts.coverage - 启用覆盖率（pytest: --cov）
 * @param {boolean} opts.debug - 调试模式（pytest: -s --tb=long）
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invokePytest(pytestPath, opts = {}) {
  const {
    testPattern = null,
    timeout = 120000,
    reportFormat = 'junit',
    workingDir = null,
    envVars = {},
    verbose = false,
    markers = null,
    workers = 0,
    retries = 0,
    coverage = false,
    debug = false,
  } = opts;

  const absPath = path.resolve(pytestPath);
  const cwd = workingDir || path.dirname(absPath) || process.cwd();

  // 检测是文件还是目录
  let targetPath = absPath;
  if (!fs.existsSync(absPath)) {
    throw new Error(`pytest path not found: ${absPath}`);
  }

  const isDir = fs.statSync(absPath).isDirectory();
  if (isDir) {
    targetPath = absPath;
  }

  const args = [];

  // 执行选项：verbose
  if (verbose) {
    args.push('-v');
  }
  
  // 执行选项：debug（优先于 verbose）
  if (debug) {
    args.push('-s', '--tb=long');
  }
  
  // 执行选项：workers（并发，需 pytest-xdist）
  if (workers > 0) {
    args.push(`-n${workers}`);
  }
  
  // 执行选项：retries（需 pytest-rerunfailures）
  if (retries > 0) {
    args.push(`--reruns=${retries}`);
  }
  
  // 执行选项：coverage
  if (coverage) {
    args.push('--cov');
  }
  
  // 测试模式匹配
  if (testPattern) args.push('-k', testPattern);
  if (markers) args.push(markers);

  // 报告生成
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pytest-'));
  if (reportFormat.includes('junit')) {
    args.push('--junitxml=' + path.join(tmpDir, 'results.xml'));
  }
  if (reportFormat.includes('html')) {
    args.push('--html=' + path.join(tmpDir, 'report.html'), '--self-contained-html');
  }

  args.push(targetPath);

  const result = await runCommand('pytest', args, {
    cwd,
    timeout,
    env: envVars,
    verbose,
  });

  let utrm = {
    tool: 'pytest',
    timestamp: new Date().toISOString(),
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: result.duration || 0 },
    testcases: [],
    exitCode: result.exitCode,
    rawOutput: result.stdout + (result.stderr || ''),
    errors: [],
    extra: {},
  };

  // 解析 JUnit XML
  const xmlPath = path.join(tmpDir, 'results.xml');
  if (fs.existsSync(xmlPath)) {
    try {
      const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
      const parsed = parseJUnitXML(xmlContent);
      utrm.testcases = parsed.testcases;
      utrm.summary = { ...utrm.summary, ...parsed.summary };
    } catch (_) {}
  }

  // 兜底：从 pytest 输出解析
  if (utrm.summary.total === 0) {
    const summaryMatch = result.stdout.match(
      /(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+skipped/i
    ) || result.stdout.match(/(\d+)\s+passed/i);
    if (summaryMatch) {
      utrm.summary.passed = parseInt(summaryMatch[1]);
      utrm.summary.failed = summaryMatch[2] ? parseInt(summaryMatch[2]) : 0;
      utrm.summary.skipped = summaryMatch[3] ? parseInt(summaryMatch[3]) : 0;
      utrm.summary.total = utrm.summary.passed + utrm.summary.failed + utrm.summary.skipped;
    }
  }

  // 脚本覆盖率（从 testcases 计算）
  if (utrm.testcases.length > 0) {
    const executedFiles = new Set(
      utrm.testcases
        .map(tc => tc.classname)
        .filter(c => c)
    );
    utrm.extra.scriptCoverage = {
      executed: Array.from(executedFiles),
      covered: utrm.testcases.length,
      total: utrm.summary.total,
    };
  }

  // 清理
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}

  return utrm;
}

// ─── 解析器 ──────────────────────────────────────────────────────────────────

/**
 * 解析 JUnit XML 格式的测试结果
 * 同时兼容 Maven surefire、pytest-junitxml、Newman JUnit reporter
 *
 * @param {string} xmlContent - JUnit XML 内容
 * @returns {{summary: object, testcases: object[]}}
 */
function parseJUnitXML(xmlContent) {
  const testcases = [];
  let total = 0, passed = 0, failed = 0, skipped = 0, duration = 0;

  // 匹配 testsuites（顶层）
  const testsuitesMatch = xmlContent.match(/<testsuites[^>]*>([\s\S]*?)<\/testsuites>/i);
  const suitesContent = testsuitesMatch ? testsuitesMatch[1] : xmlContent;

  // 匹配单个 testsuite
  const suiteRegex = /<testsuite[^>]+((?:name|tests|failures|skipped|time|tests|errors)[^=]*="[^"]*"\s*)+[^>]*>/gi;
  let suiteMatch;

  while ((suiteMatch = suiteRegex.exec(suitesContent)) !== null) {
    const suiteTag = suiteMatch[0];
    const suiteName = (suiteTag.match(/name="([^"]*)"/) || [])[1] || 'Unknown Suite';
    const suiteTime = parseFloat((suiteTag.match(/time="([^"]*)"/) || [])[1] || '0');

    // 提取 testcase
    const caseRegex = /<testcase[^>]+((?:name|classname|time|status)[^=]*="[^"]*"\s*)+[^>]*\/?>([\s\S]*?)<\/testcase>/gi;
    let caseMatch;

    while ((caseMatch = caseRegex.exec(suitesContent)) !== null) {
      const caseTag = caseMatch[0];
      const caseBody = caseMatch[2] || '';
      const name = (caseTag.match(/name="([^"]*)"/) || [])[1] || 'Unknown Test';
      const classname = (caseTag.match(/classname="([^"]*)"/) || [])[1] || suiteName;
      const time = parseFloat((caseTag.match(/time="([^"]*)"/) || [])[1] || '0');

      total++;
      duration += time * 1000;

      let status = 'passed';
      let error = null;

      if (/<failure[^>]*>([\s\S]*?)<\/failure>/i.test(caseBody)) {
        status = 'failed';
        failed++;
        const failureMatch = caseBody.match(/<failure[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/failure>/i) ||
                             caseBody.match(/<failure[^>]*>([\s\S]*?)<\/failure>/i);
        error = failureMatch ? (failureMatch[1] || failureMatch[2] || 'Test failed').trim() : 'Test failed';
      } else if (/<skipped[^>]*>/i.test(caseBody) || /<skipped>[\s\S]*<\/skipped>/i.test(caseBody)) {
        status = 'skipped';
        skipped++;
      } else {
        passed++;
      }

      testcases.push({
        name,
        classname,
        status,
        duration: Math.round(time * 1000),
        error,
        request: null,
        response: null,
      });
    }
  }

  // 如果没有解析到任何用例，尝试简化匹配
  if (testcases.length === 0) {
    const simpleRegex = /<testsuite[^>]*tests="(\d+)"[^>]*(?:failures="(\d+)")?[^>]*(?:skipped="(\d+)")?[^>]*>/gi;
    const simpleMatch = simpleRegex.exec(xmlContent);
    if (simpleMatch) {
      total = parseInt(simpleMatch[1]) || 0;
      failed = parseInt(simpleMatch[2]) || 0;
      skipped = parseInt(simpleMatch[3]) || 0;
      passed = total - failed - skipped;
    }
  }

  return {
    summary: { total, passed, failed, skipped, duration: Math.round(duration) },
    testcases,
  };
}

/**
 * 解析 Newman JSON reporter 输出
 *
 * @param {string} jsonContent - Newman JSON 输出内容
 * @returns {object} 部分 UTRM 数据
 */
function parseNewmanJSON(jsonContent) {
  try {
    const data = JSON.parse(jsonContent);

    // Newman JSON 结构
    const run = data.run || data;

    const testcases = [];
    let total = 0, passed = 0, failed = 0, skipped = 0, duration = 0;

    const items = run.items || run.executions || [];

    for (const item of items) {
      // Newman v5+ 结构
      const name = item.name || item.item?.name || 'Unknown';
      const classname = item.parent?.name || item.folder?.name || 'Root';
      const assertions = item.assertions || item.response?.Assertions || [];

      let status = 'passed';
      let error = null;
      let execDuration = item.response?.time || item.time || 0;

      for (const assertion of assertions) {
        if (assertion.error) {
          status = 'failed';
          failed++;
          error = assertion.error.message || JSON.stringify(assertion.error);
          break;
        }
      }

      if (status === 'passed') passed++;
      total++;
      duration += execDuration;

      testcases.push({
        name,
        classname,
        status,
        duration: Math.round(execDuration),
        error,
        request: item.request ? {
          method: item.request.method,
          url: item.request.url,
          headers: {},
          body: item.request.body,
        } : null,
        response: item.response ? {
          status: item.response.status,
          headers: {},
          body: typeof item.response.body === 'string'
            ? item.response.body.substring(0, 500)
            : JSON.stringify(item.response.body).substring(0, 500),
        } : null,
      });
    }

    // 如果有统计字段
    if (run.stats) {
      const stats = run.stats;
      total = stats.total || total;
      passed = (stats.assertions?.passed || 0);
      failed = (stats.assertions?.failed || 0);
      // Newman 没有 skipped
      skipped = 0;
    }

    // 从 summary 中取时间
    if (run.summary) {
      duration = run.summary.transfers?.totalDuration ||
                 run.summary.timings?.totalDuration ||
                 run.summary.totalDuration ||
                 duration;
    }

    return {
      summary: { total, passed, failed, skipped, duration: Math.round(duration) },
      testcases,
    };
  } catch (err) {
    return {
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
      testcases: [],
    };
  }
}

/**
 * 解析 pytest 生成的报告文件
 * 支持：pytest-junitxml（results.xml）、pytest-json-report
 *
 * @param {string} reportPath - 报告文件路径
 * @returns {{summary: object, testcases: object[]}}
 */
function parsePytestReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report file not found: ${reportPath}`);
  }

  const content = fs.readFileSync(reportPath, 'utf-8');
  const ext = path.extname(reportPath).toLowerCase();

  if (ext === '.json') {
    return parsePytestJSON(content);
  } else if (ext === '.xml') {
    return parseJUnitXML(content);
  }

  throw new Error(`Unsupported report format: ${ext}`);
}

/**
 * 解析 pytest JSON report
 */
function parsePytestJSON(jsonContent) {
  const data = JSON.parse(jsonContent);
  const testcases = [];

  let total = 0, passed = 0, failed = 0, skipped = 0, duration = 0;

  const records = data.report?.sections || data;

  function processNode(node, classname = 'Root') {
    if (node.nodeid && (node.type === 'test' || node.keywords?.['test_session_start'])) {
      const name = node.name || node.nodeid;
      total++;
      const status = node.outcome === 'passed' ? 'passed'
                   : node.outcome === 'failed' ? 'failed'
                   : node.outcome === 'skipped' ? 'skipped'
                   : 'passed';

      if (status === 'passed') passed++;
      else if (status === 'failed') failed++;
      else skipped++;

      const d = node.duration || 0;
      duration += d;

      testcases.push({
        name,
        classname,
        status,
        duration: Math.round(d * 1000),
        error: node.longrepr || null,
        request: null,
        response: null,
      });
    }

    if (node.children) {
      for (const child of node.children) {
        processNode(child, node.name || classname);
      }
    }
  }

  if (Array.isArray(data)) {
    for (const item of data) processNode(item);
  } else if (data.children) {
    for (const child of data.children) processNode(child);
  }

  return { summary: { total, passed, failed, skipped, duration: Math.round(duration) }, testcases };
}

// ─── UTRM 转换 ───────────────────────────────────────────────────────────────

/**
 * 将各工具的解析结果统一转换为 UTRM 格式
 *
 * @param {object} results - parseXXX 返回的结构
 * @param {string} tool - 工具名：newman/restassured/pytest
 * @param {object} extra - 额外字段
 * @returns {object} UTRM 格式结果
 */
function toUTRM(results, tool, extra = {}) {
  const {
    summary = { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
    testcases = [],
  } = results;

  return {
    tool: tool || 'unknown',
    timestamp: new Date().toISOString(),
    summary: {
      total: summary.total || 0,
      passed: summary.passed || 0,
      failed: summary.failed || 0,
      skipped: summary.skipped || 0,
      duration: summary.duration || 0,
    },
    testcases: testcases.map(tc => ({
      name: tc.name || 'Unknown',
      classname: tc.classname || '',
      status: tc.status || 'passed',
      duration: tc.duration || 0,
      error: tc.error || null,
      request: tc.request || null,
      response: tc.response || null,
    })),
    exitCode: extra.exitCode ?? 0,
    rawOutput: extra.rawOutput || '',
    errors: extra.errors || [],
  };
}

// ─── 统一入口 ────────────────────────────────────────────────────────────────

/**
 * 统一调用入口 — 自动选择工具并执行
 *
 * @param {object} params
 * @param {string} params.testScript - 测试脚本路径（必填）
 * @param {string} params.envPath - 环境变量文件（Postman 专用）
 * @param {string} [params.testFramework] - 强制工具：postman/restassured/pytest
 * @param {string} [params.testPattern] - pytest 测试匹配模式
 * @param {string} [params.testClass] - Java RestAssured 测试类名
 * @param {string} [params.mavenGoal] - Maven 目标，默认 test
 * @param {number} [params.timeout] - 超时（毫秒）
 * @param {string} [params.reportFormat] - 报告格式
 * @param {string} [params.workingDir] - 工作目录
 * @param {object} [params.envVars] - 额外环境变量
 * @param {boolean} [params.verbose] - 详细日志
 * @param {object} [params.options] - 执行选项（支持 workers/retries/coverage/debug）
 * @param {object} [params.env] - 额外环境变量（envVars 别名）
 * @returns {Promise<object>} UTRM 格式结果
 */
async function invoke(params) {
  const {
    testScript,
    envPath = null,
    testFramework = null,
    testPattern = null,
    testClass = null,
    mavenGoal = 'test',
    // 向后兼容：从顶层或 options 中提取
    // timeout = 120000,
    // reportFormat = 'junit',
    // workingDir = null,
    // envVars = {},
    // verbose = false,
  } = params;

  // 统一执行选项（向后兼容旧参数）
  const opts = {
    timeout: params.options?.timeout ?? params.timeout ?? 120000,
    verbose: params.options?.verbose ?? params.verbose ?? false,
    workers: params.options?.workers ?? 0,
    retries: params.options?.retries ?? 0,
    coverage: params.options?.coverage ?? false,
    debug: params.options?.debug ?? false,
    envVars: params.envVars ?? params.env ?? {},
    reportFormat: params.reportFormat ?? 'junit',
    workingDir: params.workingDir ?? null,
  };

  if (!testScript) {
    throw new Error('testScript is required');
  }

  // 支持直接传入内联脚本内容(非文件路径):推断框架并落临时文件,使"脚本文档模式"可直接执行
  if (typeof testScript === 'string' && !fs.existsSync(testScript)) {
    const inlinePath = detectInlineScript(testScript);
    if (inlinePath) {
      testScript = inlinePath;
    }
  }

  // 检测可用工具
  const available = detectAvailableTools();

  // 选择工具
  const tool = testFramework
    ? testFramework.toLowerCase()
    : selectBestTool(available, testScript);

  if (opts.verbose) {
    console.error(`[api-test-invoker] Selected tool: ${tool}`);
    console.error(`[api-test-invoker] Available: [${available.join(', ')}]`);
    console.error(`[api-test-invoker] testScript: ${testScript}`);
    console.error(`[api-test-invoker] opts: ${JSON.stringify(opts)}`);
  }

  switch (tool) {
    case 'newman':
      return invokeNewman(testScript, envPath, opts);

    case 'restassured':
      return invokeRestAssured(testScript, {
        ...opts,
        testClass,
        mavenGoal,
      });

    case 'pytest':
      return invokePytest(testScript, {
        ...opts,
        testPattern,
      });

    default:
      throw new Error(`Unsupported testFramework: "${tool}". Valid values: newman, restassured, pytest`);
  }
}

// ─── 模块导出 ────────────────────────────────────────────────────────────────

module.exports = {
  // 三个核心调用接口
  invokeNewman,
  invokeRestAssured,
  invokePytest,

  // 解析器
  parseJUnitXML,
  parseNewmanJSON,
  parsePytestReport,

  // 工具函数
  toUTRM,
  selectBestTool,
  detectAvailableTools,
  inferToolFromPath,

  // 统一入口
  invoke,
};
