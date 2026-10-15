/**
 * 移动端 / PC 客户端执行器共用内核
 * ============================================================
 * 两个 invoker 的差异只有:
 *   ① 承接的平台族(mobile / desktop)
 *   ② desired capabilities 组装方式
 *   ③ 环境不可用时给用户的整改指引(Appium / WinAppDriver 各不相同)
 * 其余(平台判定、环境探活、会话管理、用例循环、UTRM 输出)完全同构,
 * 抽到一处避免两份实现漂移。
 */

'use strict';

const { toUTRM, renderTemplate } = require('./common');
const { detectPlatform, normalizePlatform, PLATFORM_FAMILIES, PLATFORM_LABELS } = require('./platform-detect');
const { createSession, probe, RemoteSession } = require('./remote-driver');
const { runCase } = require('./step-runner');
const { runIntentCase } = require('./intent-runner');

/**
 * 组装最终 caps:用户显式传的 capability 原样保留,并补上平台默认值
 */
function mergeCaps(defaults, p) {
  const out = { ...defaults };
  const userCaps = p.capabilities || p.caps;
  if (userCaps && typeof userCaps === 'object') Object.assign(out, userCaps);
  // 去掉空值,避免把 undefined 传给驱动导致会话创建失败
  for (const k of Object.keys(out)) {
    if (out[k] === undefined || out[k] === null || out[k] === '') delete out[k];
  }
  return out;
}

/** 路由纠偏结果:告诉模型"这个平台不归我管,该调谁" */
function routeResult({ tool, detect, serverUrl }) {
  const msg = [
    `【平台路由】自动判定本次输入目标平台为 ${detect.label}（confidence=${detect.confidence}, score=${detect.score}），`,
    `不属于本执行器(${tool})的承接范围( family=${detect.family} )。`,
    `请改用工具: ${detect.invoker}${detect.invoker === 'ui-direct-invoker' ? '(Web 浏览器自动化)' : detect.invoker === 'desktop-e2e-invoker' ? '(PC 客户端 Windows/macOS)' : '(移动端 Android/iOS/鸿蒙)'}`,
  ].join('');
  const reasonList = detect.reasons.length ? `\n判定依据: ${detect.reasons.slice(0, 6).join('; ')}` : '';
  const res = toUTRM({ testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } }, tool, 2, `${msg}${reasonList}`);
  res.error = 'ROUTE_MISMATCH';
  res.route = {
    redirect: true,
    platform: detect.platform,
    label: detect.label,
    family: detect.family,
    recommendedTool: detect.invoker,
    recommendedFamily: detect.family,
    confidence: detect.confidence,
    reasons: detect.reasons,
    scores: detect.scores,
    alternatives: detect.alternatives,
    app: detect.app,
    framework: detect.framework,
    serverUrl,
  };
  return res;
}

/** 环境不可用结果:给明确原因 + 可执行的整改清单(而不是含糊的"工具执行错误") */
function envResult({ tool, platform, serverUrl, errors, guide, probe: probeResult }) {
  const head = `目标平台 ${PLATFORM_LABELS[platform] || platform} 的执行环境不可用(驱动服务: ${serverUrl})`;
  const detail = [
    head,
    probeResult && !probeResult.ok ? `探活结果: ${probeResult.error}` : '探活通过,但会话创建失败',
    errors && errors.length ? `会话创建返回:\n  - ${errors.join('\n  - ')}` : '',
    '',
    '【整改清单】',
    ...guide.map((g, i) => `  ${i + 1}. ${g}`),
  ].filter(Boolean).join('\n');
  const res = toUTRM({ testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } }, tool, 2, detail);
  res.error = 'ENV_NOT_READY';
  res.platform = platform;
  res.driver = serverUrl;
  res.envGuide = guide;
  res.probeErrors = errors || (probeResult && probeResult.error) || null;
  return res;
}

/**
 * 主执行入口
 * @param {object} o
 * @param {object} o.params  工具入参
 * @param {'mobile'|'desktop'} o.family
 * @param {string} o.tool    UTRM.tool 字段,如 'mobile-e2e'
 * @param {string[]} o.urlKeys 取驱动服务地址的入参键序列
 * @param {string} o.defaultServerUrl
 * @param {(platform:string, p:object, app:object)=>object} o.buildCaps
 * @param {(platform:string)=>string[]} o.envGuide
 * @returns {Promise<object>} UTRM
 */
async function executeE2E(o) {
  const p = o.params || {};
  const family = o.family;
  const tool = o.tool;

  // ── ① 平台自动判定 / 纠偏 ──
  // 用户没声明平台时,完全由输入内容(用例文件/脚本/描述)决定;
  // 判断结果与自己不匹配的,立即把"该调谁"回传给模型,不让它在错误通道上干等。
  const detect = detectPlatform(p);
  const explicit = normalizePlatform(p.platform || p.platformName);
  if (PLATFORM_FAMILIES[detect.platform] !== family) {
    return routeResult({ tool, detect, serverUrl: pick(p, o.urlKeys) || o.defaultServerUrl });
  }
  const platform = detect.platform;

  // ── ② 用例归一化 ──
  const intentMode = String(p.mode || '').toLowerCase() === 'intent';
  let cases = Array.isArray(p.cases)
    ? p.cases
    : Array.isArray(p.steps)
      ? [{ name: '场景1', steps: p.steps }]
      : Array.isArray(p.testCases)
        ? p.testCases
        : [];

  if (intentMode && Array.isArray(p.goal) === false && p.goal) {
    if (cases.length === 0) cases = [{ name: '意图场景', goal: p.goal }];
  }
  if (cases.length === 0) {
    const res = toUTRM({ testcases: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 } }, tool, 1, '未提供任何用例:需要 cases / steps(intent 模式可用 goal)');
    res.error = 'MISSING_CASES';
    return res;
  }

  const serverUrl = pick(p, o.urlKeys) || o.defaultServerUrl;

  // ── ③ 环境探活 ──
  const probeResult = await probe(serverUrl, Number(p.probeTimeoutMs || 5000));
  if (!probeResult.ok) {
    return envResult({ tool, platform, serverUrl, errors: null, probe: probeResult, guide: o.envGuide(platform) });
  }

  // ── ④ 组装能力并建会话 ──
  const caps = mergeCaps(o.buildCaps(platform, p, detect.app), p);
  const created = await createSession({ baseUrl: serverUrl, caps, timeoutMs: Number(p.newCommandTimeout || p.sessionTimeoutMs || 60000) * 2 });
  if (!created.ok) {
    return envResult({ tool, platform, serverUrl, errors: created.errors, probe: probeResult, guide: o.envGuide(platform) });
  }

  const session = new RemoteSession({ baseUrl: created.baseUrl, sessionId: created.sessionId, platform });
  const ctx = {
    vars: { ...(p.vars || {}) },
    timeout: Number(p.timeout || 15000),
    platform,
    family,
    tool,
    tag: family === 'mobile' ? 'mobile' : 'desktop',
    intentMode,
    maxSteps: Number(p.maxSteps || 20),
    maxLlmCalls: Number(p.maxLlmCalls || 10),
    maxElements: Number(p.maxElements || 40),
    screenshotOnFail: p.screenshotOnFail !== false,
    screenshotOnSuccess: !!p.screenshotOnSuccess,
    appId: caps['appium:bundleId'] || caps['appium:appPackage'] || detect.app.bundleId || detect.app.appPackage || '',
  };

  const testcases = [];
  const logs = [];
  let skipped = 0;
  const restartBetween = !!p.restartAppBetweenCases;

  try {
    for (let i = 0; i < cases.length; i++) {
      const c = renderTemplate(cases[i] || {}, ctx.vars);
      const valid = intentMode ? !!(c.goal || c.intent) : !!(c && Array.isArray(c.steps) && c.steps.length > 0);
      if (!valid || c.skip) {
        skipped++;
        testcases.push({
          name: (c && (c.name || c.title)) || `case-${i + 1}`,
          classname: tool,
          status: 'skipped',
          duration: 0,
          error: c && c.skip ? null : (intentMode ? 'MISSING_GOAL' : 'MISSING_STEPS'),
          stack: c && c.skip ? null : intentMode ? 'intent 模式场景缺少 goal' : '场景缺少 steps 数组',
          steps: [],
        });
        continue;
      }

      if (restartBetween && i > 0) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await session.closeApp();
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 500));
          // eslint-disable-next-line no-await-in-loop
          await session.launchApp(ctx.appId || null);
        } catch (_) { /* 重启失败不阻断 */ }
      }

      // eslint-disable-next-line no-await-in-loop
      const r = intentMode
        ? await runIntentCase(session, c, ctx, i)
        : await runCase(session, c, ctx, i);
      testcases.push(r);
      logs.push(`${r.status === 'passed' ? 'PASS' : 'FAIL'} ${r.name} (${r.duration}ms)${r.error ? ' :: ' + r.error : ''}`);

      if (r.status === 'failed' && p.stopOnFail) {
        for (let j = i + 1; j < cases.length; j++) {
          skipped++;
          testcases.push({
            name: (cases[j] && (cases[j].name || cases[j].title)) || `case-${j + 1}`,
            classname: tool,
            status: 'skipped',
            duration: 0,
            error: null,
            stack: '因前序场景失败且 stopOnFail=true,未执行',
            steps: [],
          });
        }
        break;
      }
    }
  } finally {
    await session.deleteSession().catch(() => null);
  }

  const summary = {
    total: testcases.length,
    passed: testcases.filter((t) => t.status === 'passed').length,
    failed: testcases.filter((t) => t.status === 'failed').length,
    skipped: testcases.filter((t) => t.status === 'skipped').length,
    duration: testcases.reduce((s, t) => s + (t.duration || 0), 0),
  };

  const out = toUTRM({ testcases, summary }, tool, summary.failed > 0 ? 1 : 0, logs.join('\n'));
  // 判定与执行环境信息回传,便于模型向用户解释"为什么走这条路"
  out.platform = platform;
  out.driver = serverUrl;
  out.route = {
    redirect: false,
    platform,
    label: PLATFORM_LABELS[platform] || platform,
    family,
    confidence: detect.confidence,
    source: explicit ? 'explicit' : detect.source,
    reasons: detect.reasons,
    app: detect.app,
    framework: detect.framework,
    capabilities: caps,
    sessionId: created.sessionId,
  };
  return out;
}

function pick(p, keys) {
  for (const k of keys || []) {
    const v = p[k];
    if (v && typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

module.exports = { executeE2E, mergeCaps, envResult, routeResult };
