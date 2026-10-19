/**
 * 性能压测脚本执行器（jmeter / k6 / locust）
 * ============================================================
 * 定位：performance-tester 智能体的必调工具 `execute_perf_script`。
 *       SKILL_EXECUTORS 里注册的 main 名为 executeJmeter，故本模块导出同名函数。
 *
 * 设计原则（与项目既有执行器一致）：
 *   1. 优先调用**本机真实压测工具**，不做模拟、不伪造指标；
 *   2. 工具未安装时返回 ENV_NOT_READY + 整改清单（不抛异常、不静默降级为假数据）；
 *   3. 零 npm 依赖：只用 Node 内置 fs / os / path / child_process。
 *
 * 三种工具：
 *   - k6     : 写临时 .js 脚本 → `k6 run --summary-export=<json>` → 解析 JSON 指标
 *   - jmeter : 写临时 .jmx     → `jmeter -n -t <jmx> -l <jtl>` → 解析 JTL(CSV) 指标
 *   - locust : 本机未安装时返回 ENV_NOT_READY（安装后按同协议解析其 CSV 输出）
 *
 * 入参（与 server.js SKILL_EXECUTORS['execute_perf_script'].parameters 对齐）：
 *   script   压测脚本内容（JMX XML 或 k6 JS）——必填
 *   tool     jmeter / k6 / locust，默认 k6
 *   duration 持续秒数，默认 60
 *   threads  并发虚拟用户数，默认 100
 *   rampUp   爬坡秒数，默认 30（仅 JMeter）
 *   target   被测主机、port 端口、protocol http/https、path 路径
 *   reportDir JMeter HTML 报告输出目录（可选）
 *   thresholds k6 阈值 JSON 字符串（可选）
 *
 * 返回统一结构：
 *   { success, tool, exitCode, durationSec, scriptPath,
 *     summary: { requests, failures, errorRate, tps, avgRt, minRt, medRt, p90, p95, maxRt },
 *     checks, thresholds, reportDir?, raw?, error?, envGuide? }
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ============================================================
// 工具探测
// ============================================================

// 常见安装位置（brew / 系统 / 手动安装），用于兜底查找
const CANDIDATE_PATHS = {
  k6: ['/opt/homebrew/bin/k6', '/usr/local/bin/k6', '/usr/bin/k6'],
  jmeter: ['/opt/homebrew/bin/jmeter', '/usr/local/bin/jmeter', '/usr/bin/jmeter'],
  locust: ['/opt/homebrew/bin/locust', '/usr/local/bin/locust', '/usr/bin/locust'],
};

function resolveBin(tool) {
  const r = spawnSync('which', [tool], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim().split('\n')[0].trim();
  for (const p of CANDIDATE_PATHS[tool] || []) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function envGuideFor(tool) {
  const guides = {
    k6: ['安装 k6：brew install k6', '或在专用目录安装（不要 npm -g，遵守运行时隔离约定）'],
    jmeter: ['安装 JMeter：brew install jmeter', 'JMeter 依赖 Java，需确认 java 可用：java -version'],
    locust: ['安装 locust：brew install locust 或 pip3 install locust', '注意：locust 为 Python 工具，需 Python 环境'],
  };
  return guides[tool] || ['请安装对应的压测工具'];
}

// ============================================================
// 指标解析
// ============================================================

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// k6 的 metrics 键可能带 tag 后缀，如 http_req_duration{expected_response:true}
function pickMetric(metrics, name) {
  if (!metrics) return null;
  if (metrics[name]) return metrics[name];
  const prefix = name + '{';
  const key = Object.keys(metrics).find((k) => k === name || k.startsWith(prefix));
  return key ? metrics[key] : null;
}

function parseK6Summary(jsonPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return { error: 'k6 summary 解析失败: ' + e.message };
  }
  const m = raw.metrics || raw;
  const reqs = pickMetric(m, 'http_reqs') || {};
  const dur = pickMetric(m, 'http_req_duration') || {};
  const failed = pickMetric(m, 'http_req_failed') || {};
  const iters = pickMetric(m, 'iterations') || {};

  const requests = num(reqs.count);
  const tps = num(reqs.rate);
  // http_req_failed 为 rate 类型：value = 失败数 / 总数（0~1）
  const errorRate = num(failed.value);
  const failures = Math.round(errorRate * requests);

  // 采样数：优先用 iteration_duration / http_reqs.count 推算
  const summary = {
    requests,
    failures,
    errorRate: requests > 0 ? Number(errorRate.toFixed(6)) : 0,
    tps: Number(tps.toFixed(3)),
    avgRt: ms(dur.avg),
    minRt: ms(dur.min),
    medRt: ms(dur.med),
    p90: ms(dur['p(90)']),
    p95: ms(dur['p(95)']),
    maxRt: ms(dur.max),
  };

  // 检查点（可选）
  const checks = {};
  const rg = raw.root_group || {};
  const collectChecks = (group) => {
    const cs = group.checks || {};
    for (const [name, c] of Object.entries(cs)) {
      checks[name] = { passes: num(c.passes), fails: num(c.fails) };
    }
    for (const g of Object.values(group.groups || {})) collectChecks(g);
  };
  collectChecks(rg);

  return { summary, checks, iterations: num(iters.count), metrics: m };
}

// JMeter / k6 的响应时间单位统一为毫秒输出
function ms(v) {
  if (v === undefined || v === null) return 0;
  return Number((Number(v) * 1000).toFixed(3)); // k6 为秒
}

function parseJtl(jtlPath) {
  let text;
  try {
    text = fs.readFileSync(jtlPath, 'utf8');
  } catch (e) {
    return { error: 'JTL 读取失败: ' + e.message };
  }
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return { error: 'JTL 为空，JMeter 未产出任何采样' };
  const header = lines[0].split(',').map((s) => s.trim());
  const iTime = header.indexOf('timeStamp');
  const iElapsed = header.indexOf('elapsed');
  const iSuccess = header.indexOf('success');
  const iLabel = header.indexOf('label');

  let requests = 0;
  let failures = 0;
  let total = 0;
  let min = Infinity;
  let max = 0;
  const rts = [];
  let tStart = Infinity;
  let tEnd = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) continue;
    requests++;
    const ok = String(cols[iSuccess]).trim().toLowerCase() === 'true';
    if (!ok) failures++;
    const el = Number(cols[iElapsed]);
    if (Number.isFinite(el)) {
      total += el;
      rts.push(el);
      if (el < min) min = el;
      if (el > max) max = el;
    }
    const ts = Number(cols[iTime]);
    if (Number.isFinite(ts)) {
      if (ts < tStart) tStart = ts;
      if (ts > tEnd) tEnd = ts;
    }
  }

  rts.sort((a, b) => a - b);
  const pct = (p) => {
    if (rts.length === 0) return 0;
    const idx = Math.min(rts.length - 1, Math.floor((p / 100) * rts.length));
    return Number(rts[idx].toFixed(3));
  };
  const durationSec = tEnd > tStart ? (tEnd - tStart) / 1000 : 0;

  return {
    summary: {
      requests,
      failures,
      errorRate: requests > 0 ? Number((failures / requests).toFixed(6)) : 0,
      tps: durationSec > 0 ? Number((requests / durationSec).toFixed(3)) : 0,
      avgRt: requests > 0 ? Number((total / requests).toFixed(3)) : 0,
      minRt: min === Infinity ? 0 : Number(min.toFixed(3)),
      medRt: pct(50),
      p90: pct(90),
      p95: pct(95),
      maxRt: Number(max.toFixed(3)),
    },
    durationSec: Number(durationSec.toFixed(2)),
  };
}

// ============================================================
// 默认脚本生成（未传 script 但给了 target 时）
// ============================================================

function defaultK6Script(p) {
  const url = `${p.protocol}://${p.target}${p.port ? ':' + p.port : ''}${p.path || '/'}`;
  return `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: ${p.threads},
  duration: '${p.duration}s',
};

export default function () {
  const res = http.get('${url}');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.1);
}
`;
}

function defaultJmx(p) {
  const proto = p.protocol || 'http';
  const port = p.port ? '${__P(port,' + p.port + ')}' : '';
  const pathStr = p.path || '/';
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="AutoGenerated" enabled="true">
      <stringProp name="TestPlan.comments">由测试中台自动生成</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">true</boolProp>
          <stringProp name="LoopController.loops">-1</stringProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">\${__P(threads,${p.threads})}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">\${__P(rampUp,${p.rampUp})}</stringProp>
        <boolProp name="ThreadGroup.scheduler">true</boolProp>
        <stringProp name="ThreadGroup.duration">\${__P(duration,${p.duration})}</stringProp>
        <stringProp name="ThreadGroup.delay"></stringProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="HTTP Request" enabled="true">
          <stringProp name="HTTPSampler.protocol">${proto}</stringProp>
          <stringProp name="HTTPSampler.domain">${p.target}</stringProp>
          ${port ? '<stringProp name="HTTPSampler.port">' + port + '</stringProp>' : ''}
          <stringProp name="HTTPSampler.path">${pathStr}</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
        </HTTPSamplerProxy>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;
}

// ============================================================
// 主入口
// ============================================================

async function executeJmeter(params) {
  const p = params || {};
  const tool = (p.tool || 'k6').toLowerCase();
  const threads = Number(p.threads) || 100;
  const duration = Number(p.duration) || 60;
  const rampUp = Number(p.rampUp) || 30;
  const protocol = p.protocol || 'http';
  const target = p.target || '';
  const port = p.port ? Number(p.port) : null;
  const urlPath = p.path || '/';

  if (!['jmeter', 'k6', 'locust'].includes(tool)) {
    return { success: false, tool, error: 'BAD_TOOL', message: `不支持的压测工具: ${tool}（可选 jmeter / k6 / locust）` };
  }

  const bin = resolveBin(tool);
  if (!bin) {
    return {
      success: false,
      tool,
      error: 'ENV_NOT_READY',
      message: `本机未检测到 ${tool}，无法执行真实压测（不做模拟数据）`,
      envGuide: envGuideFor(tool),
    };
  }

  // 未给脚本时必须提供 target，否则无从压测
  const hasScript = typeof p.script === 'string' && p.script.trim().length > 0;
  if (!hasScript && !target) {
    return {
      success: false,
      tool,
      error: 'BAD_INPUT',
      message: '缺少 script（压测脚本内容）且未提供 target（被测主机），无法确定压测目标',
    };
  }

  // 临时工作目录：每次执行独立，避免并发互相覆盖
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
  const startedAt = Date.now();

  try {
    if (tool === 'k6') {
      const scriptPath = path.join(workDir, 'script.js');
      fs.writeFileSync(scriptPath, hasScript ? p.script : defaultK6Script({ threads, duration, protocol, target, port, path: urlPath }), 'utf8');

      const summaryPath = path.join(workDir, 'summary.json');
      const args = ['run', '--summary-export=' + summaryPath];
      // 命令行覆盖脚本内 options（k6 CLI 优先级高于脚本内 options）
      args.push('--vus', String(threads), '--duration', duration + 's');
      if (p.thresholds) args.push('--summary-trend-stats', 'avg,min,med,p(90),p(95),max');
      args.push(scriptPath);

      const r = spawnSync(bin, args, {
        encoding: 'utf8',
        timeout: (duration + 120) * 1000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, K6_NO_USAGE_REPORT: 'true' },
      });

      if (!fs.existsSync(summaryPath)) {
        return {
          success: false,
          tool,
          error: 'NO_RESULT',
          message: 'k6 未产出 summary 文件',
          exitCode: r.status,
          stderr: tail(r.stderr, 1500),
          stdout: tail(r.stdout, 1500),
        };
      }

      const parsed = parseK6Summary(summaryPath);
      if (parsed.error) {
        return { success: false, tool, error: 'PARSE_FAILED', message: parsed.error, exitCode: r.status };
      }

      return {
        success: r.status === 0 || parsed.summary.requests > 0,
        tool,
        bin,
        exitCode: r.status,
        durationSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        scriptPath,
        summary: parsed.summary,
        checks: parsed.checks,
        iterations: parsed.iterations,
        thresholds: p.thresholds || null,
        raw: parsed.metrics ? { metricsAvailable: Object.keys(parsed.metrics).length } : null,
        stderr: tail(r.stderr, 800),
      };
    }

    if (tool === 'jmeter') {
      const jmxPath = path.join(workDir, 'test.jmx');
      fs.writeFileSync(jmxPath, hasScript ? p.script : defaultJmx({ threads, duration, rampUp, protocol, target, port, path: urlPath }), 'utf8');
      const jtlPath = path.join(workDir, 'result.jtl');

      const args = ['-n', '-t', jmxPath, '-l', jtlPath];
      args.push('-Jthreads=' + threads, '-Jduration=' + duration, '-JrampUp=' + rampUp);
      if (port) args.push('-Jport=' + port);
      if (p.reportDir) {
        try { fs.mkdirSync(p.reportDir, { recursive: true }); } catch (_) { /* 目录不可写时 JMeter 自身会报错 */ }
        args.push('-e', '-o', p.reportDir);
      }

      const r = spawnSync(bin, args, {
        encoding: 'utf8',
        timeout: (duration + 240) * 1000,
        maxBuffer: 32 * 1024 * 1024,
      });

      if (!fs.existsSync(jtlPath)) {
        return {
          success: false,
          tool,
          error: 'NO_RESULT',
          message: 'JMeter 未产出 JTL 结果文件',
          exitCode: r.status,
          stderr: tail(r.stderr, 1500),
        };
      }

      const parsed = parseJtl(jtlPath);
      if (parsed.error) {
        return { success: false, tool, error: 'PARSE_FAILED', message: parsed.error, exitCode: r.status };
      }

      return {
        success: r.status === 0 || parsed.summary.requests > 0,
        tool,
        bin,
        exitCode: r.status,
        durationSec: parsed.durationSec || Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        scriptPath: jmxPath,
        jtlPath,
        summary: parsed.summary,
        reportDir: p.reportDir || null,
        stderr: tail(r.stderr, 800),
      };
    }

    // locust：本机未安装时已在 resolveBin 拦截；此处为已安装后的执行路径
    return {
      success: false,
      tool,
      error: 'NOT_IMPLEMENTED',
      message: `locust 已检测到（${bin}），但其执行与结果解析尚未接入；请先使用 k6 或 jmeter 通道`,
      envGuide: ['如需 locust 通道请提需求，当前推荐 k6（本机已安装）'],
    };
  } catch (e) {
    return { success: false, tool, error: 'EXEC_ERROR', message: e && e.message ? e.message : String(e) };
  }
}

function tail(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(-n) : s;
}

module.exports = { executeJmeter, executePerfScript: executeJmeter, parseJtl, parseK6Summary, resolveBin };
