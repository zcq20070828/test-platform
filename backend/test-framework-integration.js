// Test Framework Integration Module
// 功能：测试框架检测、命令构建、子进程执行、结果解析
// 支持: jest / pytest / playwright / api (supertest)
import { spawn, execSync } from 'node:child_process';
import { existsSync, statSync, readFileSync, readdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 导入后端全局工具注册表（动态 import，避免 ESM/CJS 混用）
let globalToolRegistry = null
async function getToolRegistry() {
  if (!globalToolRegistry) {
    try {
      globalToolRegistry = await import('./tool-registry.js')
    } catch (e) {
      console.warn('[TestFramework] 无法加载 tool-registry:', e.message)
    }
  }
  return globalToolRegistry
}

// =============================================================================
// 框架二进制检测
// =============================================================================
const FRAMEWORK_BINARIES = {
  jest:        { bin: 'jest',        npmBin: 'npx jest',        checkArgs: ['--version'] },
  pytest:      { bin: 'pytest',      npmBin: null,              checkArgs: ['--version'] },
  playwright:  { bin: 'playwright',  npmBin: 'npx playwright',  checkArgs: ['--version'] },
  vitest:     { bin: 'vitest',     npmBin: 'npx vitest',     checkArgs: ['--version'] },
  api:         { bin: null,          npmBin: null,              checkArgs: [] }, // 自定义
};

/**
 * 检查某个框架二进制是否可用（优先使用后端全局安装）
 * @param {string} framework
 * @returns {boolean}
 */
export function isFrameworkInstalled(framework) {
  // 后端全局工具注册表是异步加载的，框架检测仅依赖 PATH
  const meta = FRAMEWORK_BINARIES[framework];
  if (!meta) return false;
  if (!meta.bin) return true; // api/custom 视为可用
  try {
    execSync(`${meta.bin} ${meta.checkArgs.join(' ')}`, { stdio: 'ignore', timeout: 10000 });
    return true;
  } catch {
    // 尝试 npmBin
    if (meta.npmBin) {
      try {
        execSync(meta.npmBin.split(' ')[0] + ' --version', { stdio: 'ignore', timeout: 10000 });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

// =============================================================================
// 框架自动安装（一键安装）
// =============================================================================
// 各框架安装命令；运行在后端主机（server 进程环境），非阻塞后台执行
const FRAMEWORK_INSTALL = {
  jest:      { cmds: [['npm', ['install', '-g', 'jest']]],                        label: 'Jest' },
  vitest:    { cmds: [['npm', ['install', '-g', 'vitest']]],                      label: 'Vitest' },
  pytest:    { cmds: [['pip3', ['install', 'pytest']]], label: 'Pytest', fallback: ['pip', ['install', 'pytest']] },
  playwright: { cmds: [['npx', ['-y', 'playwright', 'install']]],              label: 'Playwright' },
  api:       { cmds: [],                                                          label: 'API 测试（自定义，无需安装）' },
};

// 安装任务状态（按 framework 跟踪，供状态查询）
const _installJobs = new Map();

// 已完成任务保留层：job 完成后移入此处，5 分钟后自动清除（让前端来得及拉到日志）
const _completedJobs = new Map();
const COMPLETED_TTL_MS = 5 * 60 * 1000;

function _archiveJob(framework) {
  const job = _installJobs.get(framework);
  if (!job) return;
  _installJobs.delete(framework);
  _completedJobs.set(framework, job);
  setTimeout(() => _completedJobs.delete(framework), COMPLETED_TTL_MS);
}

function _runCmd(cmd, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { env: process.env });
    } catch (e) {
      return resolve({ ok: false, error: e.message, stdout, stderr });
    }
    if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => resolve({ ok: false, error: err.message, stdout, stderr }));
    child.on('close', code => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

/**
 * 后台启动框架安装（非阻塞），立即返回 { started, label }
 * 安装结果通过 isFrameworkInstalled 轮询判断（前端轮询 /api/test-framework/check）
 */
export function startFrameworkInstall(framework) {
  const cfg = FRAMEWORK_INSTALL[framework];
  if (!cfg) return { started: false, error: `不支持的框架: ${framework}` };
  if (!cfg.cmds.length) {
    return { started: false, skipped: true, label: cfg.label };
  }
  if (_installJobs.has(framework)) {
    return { started: true, label: cfg.label, running: true };
  }
  const totalSteps = cfg.cmds.length;
  const job = { framework, label: cfg.label, status: 'running', logs: [], startedAt: Date.now(), progress: 0, totalSteps, currentStep: 0 };
  _installJobs.set(framework, job);

  (async () => {
    for (let i = 0; i < cfg.cmds.length; i++) {
      const [cmd, args] = cfg.cmds[i];
      job.currentStep = i + 1;
      job.progress = Math.round((i / totalSteps) * 100);
      job.logs.push(`$ ${cmd} ${args.join(' ')}`);
      const r = await _runCmd(cmd, args);
      if (r.stdout) job.logs.push(r.stdout);
      if (r.stderr) job.logs.push(r.stderr);
      if (!r.ok) {
        if (cfg.fallback) {
          const [fcmd, fargs] = cfg.fallback;
          job.logs.push(`重试: $ ${fcmd} ${fargs.join(' ')}`);
          const r2 = await _runCmd(fcmd, fargs);
          if (r2.stdout) job.logs.push(r2.stdout);
          if (r2.stderr) job.logs.push(r2.stderr);
          if (!r2.ok) { job.status = 'failed'; job.error = r2.error || `exit ${r2.code}`; _archiveJob(framework); return; }
        } else {
          job.status = 'failed'; job.error = r.error || `exit ${r.code}`; _archiveJob(framework); return;
        }
      }
    }
    job.progress = 100;
    job.status = 'done';
    _archiveJob(framework);
  })();

  return { started: true, label: cfg.label };
}

export function getInstallJob(framework) {
  // 进行中任务优先，否则查已完成的保留层
  return _installJobs.get(framework) || _completedJobs.get(framework) || null;
}

// =============================================================================
// 框架自动检测（基于文件系统）
// =============================================================================
/**
 * 通过路径识别测试框架
 * 1. 先按 testPath 字符串特征快判
 * 2. 再扫描目录配置（package.json / pytest.ini / playwright.config.*）
 * @param {string} testPath - 文件/目录路径
 * @returns {string|null} framework id
 */
export function detectTestFramework(testPath) {
  if (!testPath) return null;

  // 1) 字符串特征
  const lower = testPath.toLowerCase();
  if (lower.includes('playwright') || lower.endsWith('.spec.js') || lower.endsWith('.spec.ts')) {
    return 'playwright';
  }
  if (lower.endsWith('.test.js') || lower.endsWith('.test.ts') || lower.includes('/jest')) {
    return 'jest';
  }
  if (lower.endsWith('.py') || lower.includes('test_') || lower.endsWith('_test.py')) {
    return 'pytest';
  }

  // 2) 目录配置扫描
  let dir = testPath;
  try {
    if (statSync(testPath).isFile()) dir = path.dirname(testPath);
  } catch { return null; }

  // 向上找配置文件（最多 4 层）
  let cur = dir;
  for (let i = 0; i < 4; i++) {
    if (existsSync(path.join(cur, 'playwright.config.js')))         return 'playwright';
    if (existsSync(path.join(cur, 'playwright.config.ts')))         return 'playwright';
    if (existsSync(path.join(cur, 'jest.config.js')))              return 'jest';
    if (existsSync(path.join(cur, 'jest.config.ts')))              return 'jest';
    if (existsSync(path.join(cur, 'pytest.ini')))                  return 'pytest';
    if (existsSync(path.join(cur, 'pyproject.toml'))) {
      // 进一步看 pyproject 里有没有 pytest 配置
      try {
        const c = readFileSync(path.join(cur, 'pyproject.toml'), 'utf8');
        if (/\[tool\.pytest/.test(c)) return 'pytest';
      } catch { /* ignore */ }
    }
    if (existsSync(path.join(cur, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(cur, 'package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies||{}), ...(pkg.devDependencies||{}) };
        if (deps['@playwright/test'])  return 'playwright';
        if (deps['jest'] || deps['vitest']) return 'jest';
        if (deps['mocha'])             return 'api';
      } catch { /* ignore */ }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

// =============================================================================
// 命令构建
// =============================================================================
/**
 * 根据 framework + options 构建 spawn 命令
 * @returns {{cmd: string, args: string[], env: object, cwd: string}|null}
 */
function buildCommand(framework, testPath, options) {
  const opts = options || {};
  const env = { ...process.env, ...(opts.env || {}) };
  let cwd = testPath;
  try {
    if (statSync(testPath).isFile()) cwd = path.dirname(testPath);
  } catch {
    if (existsSync(testPath)) cwd = testPath;
  }

  if (framework === 'jest') {
    const args = ['jest', '--json', '--testLocationInResults'];
    if (opts.coverage)  args.push('--coverage');
    if (opts.verbose)   args.push('--verbose');
    if (opts.workers && Number.isFinite(opts.workers)) args.push(`--maxWorkers=${opts.workers}`);
    if (opts.testFile)  args.push(opts.testFile);
    else if (opts.testTag) args.push(`-t`, String(opts.testTag));
    else args.push(testPath);
    return { cmd: 'npx', args, env, cwd };
  }

  if (framework === 'pytest') {
    const args = ['-m', 'pytest', '-v', '--tb=short', '--color=no'];
    if (opts.coverage)   args.push('--cov=.', '--cov-report=term');
    if (opts.workers && Number.isFinite(opts.workers)) args.push(`-n`, String(opts.workers));
    if (opts.retries)    args.push(`--reruns=${opts.retries}`);
    if (opts.testFile)   args.push(opts.testFile);
    else if (opts.testTag) args.push(`-k`, String(opts.testTag));
    else args.push(testPath);
    return { cmd: 'python3', args, env, cwd };
  }

  if (framework === 'playwright') {
    const args = ['playwright', 'test', '--reporter=json'];
    if (opts.workers && Number.isFinite(opts.workers)) args.push(`--workers=${opts.workers}`);
    if (opts.retries)    args.push(`--retries=${opts.retries}`);
    if (opts.testFile)   args.push(opts.testFile);
    else if (opts.testTag) args.push(`-g`, String(opts.testTag));
    else args.push(testPath);
    return { cmd: 'npx', args, env, cwd };
  }

  if (framework === 'api') {
    // API 测试：默认跑 package.json 里 scripts.test，否则 mocha
    const args = ['mocha', '--reporter', 'json'];
    if (opts.testFile) args.push(opts.testFile);
    else args.push(testPath);
    return { cmd: 'npx', args, env, cwd };
  }

  return null;
}

// =============================================================================
// 结果解析
// =============================================================================
/**
 * 解析 jest 的 --json 输出
 * jest 输出: 末尾会有一段 {"numTotalTests": N, "numPassedTests": N, ...}
 */
function parseJestJson(stdout) {
  // jest --json 输出整体就是一个 JSON
  // 也有可能混合了 PASS/FAIL 行 + 末尾 JSON
  const lines = stdout.split('\n');
  // 从尾部找 JSON 开始
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.includes('numTotalTests')) {
      try {
        const obj = JSON.parse(lines.slice(i).join('\n'));
        const failures = [];
        if (Array.isArray(obj.testResults)) {
          for (const f of obj.testResults) {
            for (const t of (f.assertionResults || [])) {
              if (t.status === 'failed') {
                failures.push({
                  name: t.fullName || t.title,
                  message: (t.failureMessages && t.failureMessages[0] || '').split('\n')[0],
                  stack: (t.failureMessages || []).join('\n'),
                });
              }
            }
          }
        }
        return {
          total:    obj.numTotalTests   || 0,
          passed:   obj.numPassedTests  || 0,
          failed:   obj.numFailedTests  || 0,
          skipped:  obj.numPendingTests || 0,
          duration: Math.round((obj.endTime && obj.startTime) ? (obj.endTime - obj.startTime) : 0),
          failures,
        };
      } catch { /* fall through */ }
    }
  }
  // 解析失败：尝试从 FAIL 标签统计
  const failMatches = stdout.match(/^FAIL /gm) || [];
  const passMatches = stdout.match(/^PASS /gm) || [];
  return {
    total: passMatches.length + failMatches.length,
    passed: passMatches.length,
    failed: failMatches.length,
    skipped: 0,
    duration: 0,
    failures: [],
    parseError: 'jest JSON parse failed',
  };
}

/**
 * 解析 pytest 的文本输出
 * 末行格式: "1 failed, 1 passed, 1 skipped in 0.02s"
 */
function parsePytestText(stdout, stderr, exitCode) {
  const failures = [];
  // FAILED xxx::yyy - 失败标题
  const failRegex = /^(FAIL|ERROR) (.+)$/gm;
  let m;
  while ((m = failRegex.exec(stdout)) !== null) {
    failures.push({ name: m[2], message: 'test ' + m[1].toLowerCase(), stack: '' });
  }
  // 末行统计
  const lastLines = stdout.trim().split('\n').slice(-3).join(' ');
  const stat = {
    total: 0, passed: 0, failed: 0, skipped: 0, duration: 0,
  };
  const re = /(\d+)\s+(passed|failed|errors?|skipped)/g;
  let mm;
  while ((mm = re.exec(lastLines)) !== null) {
    const n = parseInt(mm[1], 10);
    const k = mm[2];
    if (k === 'passed')  { stat.passed = n;  stat.total += n; }
    if (k === 'failed')  { stat.failed = n;  stat.total += n; failures.push({ name: 'pytest failed', message: lastLines, stack: stderr || '' }); }
    if (k === 'skipped') { stat.skipped = n; stat.total += n; }
    if (k === 'error' || k === 'errors') { stat.failed += n; stat.total += n; }
  }
  // 耗时: "in 0.02s"
  const timeMatch = lastLines.match(/in\s+([\d.]+)s/);
  if (timeMatch) stat.duration = Math.round(parseFloat(timeMatch[1]) * 1000);
  // 末行没统计到且有 stderr 报错
  if (stat.total === 0 && stderr) {
    return {
      ...stat,
      failures: [{ name: 'pytest error', message: stderr.trim().split('\n')[0], stack: stderr }],
      parseError: 'pytest stats not found',
    };
  }
  return { ...stat, failures };
}

/**
 * 解析 playwright --reporter=json 输出
 * playwright 输出是一个 JSON（含 errors / stats）
 */
function parsePlaywrightJson(stdout) {
  // playwright json 报告是单行或末尾 JSON
  const trimmed = stdout.trim();
  try {
    // 可能是整个 stdout 是一个 JSON
    const obj = JSON.parse(trimmed);
    const stats = obj.stats || {};
    const failures = [];
    const suites = obj.suites || [];
    // 框架级错误（如 module not found）
    const fwErrors = Array.isArray(obj.errors) ? obj.errors : [];
    const walk = (arr) => {
      for (const s of arr) {
        for (const spec of (s.specs || [])) {
          for (const t of (spec.tests || [])) {
            for (const r of (t.results || [])) {
              if (r.status === 'failed' || r.status === 'timedOut') {
                const errMsg = (r.error && r.error.message) || 'failed';
                failures.push({
                  name: spec.title || t.title,
                  message: errMsg.split('\n')[0],
                  stack: (r.error && r.error.stack) || '',
                });
              }
            }
          }
        }
        if (s.suites) walk(s.suites);
      }
    };
    walk(suites);
    const expected = stats.expected || 0;
    const skipped  = (stats.skipped || 0);
    const flaky    = stats.flaky || 0;
    const failed   = (stats.failed || 0) + (stats.timedOut || 0);
    const passed   = Math.max(0, expected - skipped - failed);
    // 把框架级错误也加入 failures
    for (const e of fwErrors) {
      failures.push({
        name:    e.location ? `${e.location.file}:${e.location.line}` : 'playwright error',
        message: (e.message || '').split('\n')[0],
        stack:  (e.message || '') + (e.stack ? '\n' + e.stack : ''),
      });
    }
    return {
      total: expected,
      passed, failed, skipped,
      duration: Math.round((stats.duration || 0)), // ms
      failures,
    };
  } catch (e) {
    return {
      total: 0, passed: 0, failed: 0, skipped: 0, duration: 0,
      failures: [],
      parseError: `playwright JSON parse failed: ${e.message}`,
    };
  }
}

// =============================================================================
// 主入口：executeTests
// =============================================================================
/**
 * 执行测试
 * @param {object} args
 * @param {string} args.testPath  - 文件或目录
 * @param {string} [args.framework] - jest/pytest/playwright/api，不传则自动检测
 * @param {object} [args.options]   - { workers, timeout, retries, coverage, verbose, debug, env, testFile, testTag }
 * @param {function} [args.onLog]   - (level, message) => void  实时日志回调
 * @param {object} [args.signal]    - AbortSignal 用于取消
 * @returns {Promise<{success,total,passed,failed,skipped,duration,failures,framework,logFile?,error?}>}
 */
export async function executeTests({ testPath, framework, options, onLog, signal } = {}) {
  const log = (level, msg) => {
    if (typeof onLog === 'function') {
      try { onLog(level, msg); } catch { /* swallow */ }
    }
  };

  if (!testPath) {
    return { success: false, total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, failures: [], error: '缺少 testPath' };
  }

  // 1) 自动检测框架
  if (!framework) framework = detectTestFramework(testPath);
  if (!framework) {
    return { success: false, total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, failures: [], error: `无法识别测试框架，请显式指定 (testPath=${testPath})` };
  }
  log('info', `检测到测试框架: ${framework}`);

  // 2) 检查安装（未安装则自动安装到后端全局）
  if (!isFrameworkInstalled(framework)) {
    log('warn', `框架 ${framework} 未安装，尝试自动安装...`);
    const registry = await getToolRegistry();
    if (registry) {
      const result = await registry.installToolBackend(framework, log);
      if (!result.success) {
        return { success: false, total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, failures: [], framework, error: `框架 ${framework} 安装失败: ${result.error}` };
      }
      log('success', `框架 ${framework} 安装成功: ${result.version}`);
    } else {
      return { success: false, total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, failures: [], framework, error: `框架 ${framework} 未安装，且 tool-registry 不可用` };
    }
  }

  // 3) 构造命令
  const built = buildCommand(framework, testPath, options || {});
  if (!built) {
    return { success: false, total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, failures: [], framework, error: `未知框架: ${framework}` };
  }
  log('info', `执行命令: ${built.cmd} ${built.args.join(' ')}`);
  log('info', `工作目录: ${built.cwd}`);

  // 4) 写日志文件
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logDir = path.join(os.homedir(), '.qclaw', 'test-runs');
  await fs.mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, `${runId}.log`);
  const logStream = (await import('node:fs')).createWriteStream(logFile, { flags: 'w' });
  const writeLog = (line) => { try { logStream.write(line + '\n'); } catch { /* ignore */ } };

  // 5) spawn 进程
  const startTime = Date.now();
  const timeoutMs = (options?.timeout && Number.isFinite(options.timeout))
    ? (options.timeout > 1000 ? options.timeout : options.timeout * 1000)  // 自动识别 s/ms
    : 300000; // 默认 5 分钟

  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try { logStream.end(); } catch { /* ignore */ }
      log('info', `日志已保存: ${logFile}`);
      resolve({ ...result, framework, runId, logFile });
    };

    let child;
    try {
      child = spawn(built.cmd, built.args, {
        cwd: built.cwd,
        env: built.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      log('error', `进程启动失败: ${e.message}`);
      return finish({ success: false, total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, failures: [], error: e.message });
    }

    log('info', `进程已启动: PID ${child.pid}`);

    // 注册到全局，方便取消
    registerRunningProcess(runId, child);

    // 取消支持
    const onAbort = () => {
      log('warn', `收到取消信号，终止进程 PID ${child.pid}`);
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    // 超时
    const timer = setTimeout(() => {
      log('warn', `执行超时 (${timeoutMs}ms)，终止进程`);
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
    }, timeoutMs);

    // 收集 stdout
    const MAX_BUF = 10 * 1024 * 1024; // 10MB cap
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (stdout.length > MAX_BUF) stdout = stdout.slice(-MAX_BUF);
      writeLog(text.replace(/\n$/, ''));
      // 实时推送给前端（逐行）
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) log('stdout', line);
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (stderr.length > MAX_BUF) stderr = stderr.slice(-MAX_BUF);
      writeLog('[STDERR] ' + text.replace(/\n$/, ''));
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) log('stderr', line);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      unregisterRunningProcess(runId);
      log('error', `进程错误: ${err.message}`);
      finish({ success: false, total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, failures: [], error: err.message });
    });

    child.on('close', (code, sig) => {
      clearTimeout(timer);
      unregisterRunningProcess(runId);
      const dur = Date.now() - startTime;
      log('info', `进程退出: code=${code}, signal=${sig}, 耗时 ${dur}ms`);

      let parsed;
      if (framework === 'jest')        parsed = parseJestJson(stdout);
      else if (framework === 'pytest') parsed = parsePytestText(stdout, stderr, code);
      else if (framework === 'playwright') parsed = parsePlaywrightJson(stdout);
      else if (framework === 'api')    parsed = parseJestJson(stdout); // mocha JSON 复用
      else parsed = { total: 0, passed: 0, failed: 0, skipped: 0, duration: dur, failures: [] };

      // 框架本身不返回 0 但解析成功：仍按解析结果判定
      const success = parsed.total > 0 || code === 0;
      finish({
        success,
        total:    parsed.total    || 0,
        passed:   parsed.passed   || 0,
        failed:   parsed.failed   || 0,
        skipped:  parsed.skipped  || 0,
        duration: parsed.duration || dur,
        failures: parsed.failures || [],
        parseError: parsed.parseError,
        exitCode: code,
        signal: sig,
      });
    });
  });
}

// =============================================================================
// 运行中的进程管理（用于取消）
// =============================================================================
const RUNNING = new Map(); // runId -> { child, abortCtrl, createdAt }
function registerRunningProcess(runId, child) {
  RUNNING.set(runId, { child, createdAt: Date.now() });
}
function unregisterRunningProcess(runId) {
  RUNNING.set(runId, undefined);
  // 5 分钟后清理
  setTimeout(() => RUNNING.delete(runId), 5 * 60 * 1000);
}
export function getRunningProcess(runId) {
  return RUNNING.get(runId);
}
export function cancelRunningProcess(runId) {
  const r = RUNNING.get(runId);
  if (!r || !r.child) return false;
  try { r.child.kill('SIGTERM'); } catch { /* ignore */ }
  return true;
}
export function listRunningProcesses() {
  const out = [];
  for (const [id, r] of RUNNING.entries()) {
    if (r && r.child) {
      out.push({ runId: id, pid: r.child.pid, startedAt: r.createdAt });
    }
  }
  return out;
}

// =============================================================================
// 报告生成
// =============================================================================
/**
 * 生成 Markdown 测试报告
 * @param {object} results
 * @returns {string} markdown
 */
export function generateTestReport(results) {
  const { total = 0, passed = 0, failed = 0, skipped = 0, duration = 0, failures = [], framework = 'unknown', testPath = '', runId = '' } = results || {};
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(2) : '0.00';
  const dur = (duration / 1000).toFixed(2);

  let md = `# 测试报告\n\n`;
  md += `- **Run ID**: \`${runId}\`\n`;
  md += `- **测试框架**: ${framework}\n`;
  md += `- **测试路径**: \`${testPath}\`\n`;
  md += `- **执行时间**: ${new Date().toISOString()}\n`;
  md += `- **耗时**: ${dur}s\n\n`;

  md += `## 📊 统计\n\n`;
  md += `| 指标 | 数量 | 占比 |\n|------|------|------|\n`;
  md += `| 总数 | ${total} | 100% |\n`;
  md += `| ✅ 通过 | ${passed} | ${total > 0 ? ((passed/total)*100).toFixed(1) : 0}% |\n`;
  md += `| ❌ 失败 | ${failed} | ${total > 0 ? ((failed/total)*100).toFixed(1) : 0}% |\n`;
  md += `| ⏭️ 跳过 | ${skipped} | ${total > 0 ? ((skipped/total)*100).toFixed(1) : 0}% |\n`;
  md += `| **通过率** | - | **${passRate}%** |\n\n`;

  if (failures && failures.length > 0) {
    md += `## ❌ 失败详情\n\n`;
    failures.forEach((f, i) => {
      md += `### ${i + 1}. ${f.name}\n\n`;
      if (f.message) md += `**错误**: ${f.message}\n\n`;
      if (f.stack)   md += ('```\n' + f.stack + '\n```\n\n');
    });
  }

  md += `\n---\n*Generated by Test Platform @ ${new Date().toISOString()}*\n`;
  return md;
}
