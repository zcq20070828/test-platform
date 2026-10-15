/**
 * 多端 intent 模式:执行 ↔ 推理闭环
 * ============================================================
 * 与 ui-direct-invoker(Web)的同名能力对齐,差异只在"观测源":
 *   Web     → DOM 摘要
 *   移动端  → 控件树 XML(source)摘要:resource-id / text / content-desc
 *   PC客户端→ 控件树 XML 摘要:AutomationId / Name / ClassName
 *
 * 流程:parseIntent(①) → 循环 { observe(②) → 模型决策(③) → 执行 } → 断言校验(④)
 * 失败不立刻退出,把失败原因喂回模型让它换路径重试(自愈)。
 */

'use strict';

const { saveShot, clip } = require('./common');
const { runStep } = require('./step-runner');

let _engine = null;
function getIntentEngine() {
  if (_engine !== null) return _engine;
  try {
    const { createRequire } = require('module');
    const path = require('path');
    // __dirname = <root>/qclaw-skills/ui-e2e-executor/backend → <root>/backend
    const req = createRequire(path.join(path.resolve(__dirname, '..', '..', '..', 'backend'), 'package.json'));
    _engine = req('./llm/intent-engine.js');
  } catch (_) {
    _engine = false;
  }
  return _engine;
}

const ATTR_KEYS = ['text', 'content-desc', 'content-desc=', 'name', 'label', 'value', 'resource-id', 'accessibility-id', 'AutomationId', 'automationId', 'HelpText'];

/**
 * 从控件树 XML 解析出可读元素列表
 * @param {string} xml
 * @param {number} max
 */
function parseNodes(xml, max = 40) {
  const nodes = [];
  const tagRe = /<([A-Za-z0-9_.:-]+)\s([^>]*?)\/?>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null && nodes.length < 400) {
    const [, tag, attrsRaw] = m;
    const attrs = {};
    const aRe = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = aRe.exec(attrsRaw)) !== null) attrs[am[1]] = am[2];
    const id = attrs['resource-id'] || attrs.accessibility_id || attrs['accessibility-id'] || attrs.AutomationId || attrs.automationId || attrs.name || '';
    const text = attrs.text || attrs.label || attrs.value || attrs.Name || attrs['content-desc'] || attrs.HelpText || '';
    const cls = tag.split('.').pop();
    if (!id && !text) continue;
    // bounds="[0,0][0,0]" 为不可见/零尺寸控件,跳过
    if (attrs.bounds && /\[0,0\]\[0,0\]/.test(attrs.bounds)) continue;
    nodes.push({
      id: String(id).slice(0, 120),
      text: String(text).slice(0, 120),
      class: cls,
      clickable: attrs.clickable === 'true' || attrs.clickable === '1',
      enabled: attrs.enabled === undefined ? true : attrs.enabled !== 'false',
      index: `${attrs.index || ''}${attrs['instance'] || ''}`,
    });
  }
  const withText = nodes.filter((n) => n.text);
  const rest = nodes.filter((n) => !n.text);
  return [...withText, ...rest].slice(0, max);
}

/**
 * 观测当前控件树 + 文本快照
 */
async function observe(session, opts = {}) {
  let xml = '';
  try {
    xml = await session.source();
  } catch (e) {
    xml = '';
  }
  const elements = parseNodes(xml, opts.maxElements || 40);
  const textPool = elements.map((e) => e.text).filter(Boolean).join(' | ');
  return {
    url: opts.startUrl || opts.appId || '(原生应用无 URL 概念)',
    activity: opts.activity || null,
    platform: opts.platform || '',
    summary: `共解析到 ${elements.length} 个可操作控件`,
    elements,
    text: clip(textPool, 3000),
    sourceTruncated: xml.length > 120000,
  };
}

/** 本地客观判定断言(与 Web 通道同一套语义,避免把判定权交给模型) */
async function checkAssertion(session, a, observation) {
  const type = String((a && a.type) || 'text').toLowerCase();
  const expected = a && (a.expected !== undefined ? a.expected : a.expectation);
  const target = (a && a.target) || '';
  const base = {
    id: (a && a.id) || '', description: (a && a.description) || '',
    type, target, expected,
  };
  const compact = (s) => String(s || '').replace(/[\s]+/g, '');
  try {
    if (type === 'text') {
      const pool = `${observation.text} ${observation.elements.map((e) => `${e.text}|${e.id}`).join(' ')}`;
      const passed = String(expected || '') !== '' && (pool.includes(String(expected)) || compact(pool).includes(compact(expected)));
      return { ...base, passed, actual: clip(observation.text, 300), evidence: passed ? '控件树文本命中' : `控件树未见「${expected}」` };
    }
    if (type === 'visible' || type === 'dom' || type === 'visual') {
      const hit = await session
        .elements(target, { timeoutMs: 4000, platform: observation.platform })
        .then(() => true)
        .catch(() => false);
      return { ...base, passed: hit, actual: hit ? '目标存在' : '目标未找到', evidence: hit ? '' : `未能定位到「${target}」` };
    }
    if (type === 'url') {
      return { ...base, passed: null, actual: null, evidence: '原生应用无 URL 概念,该断言不适用;请改用 text 断言' };
    }
    return { ...base, passed: null, actual: null, evidence: '该断言类型不在本执行器客观校验范围内(text/visible/dom/visual)' };
  } catch (e) {
    return { ...base, passed: false, actual: null, evidence: String(e && e.message) };
  }
}

/**
 * intent 模式单场景执行
 */
async function runIntentCase(session, rawCase, ctx, index) {
  const engine = getIntentEngine();
  if (!engine || !engine.isAvailable()) {
    return {
      name: rawCase.name || `case-${index + 1}`,
      classname: ctx.tool || 'remote-e2e',
      status: 'failed',
      duration: 0,
      error: 'NO_LLM_KEY:未配置 DEEPSEEK_API_KEY,intent 模式不可用;请改用 mode="script"',
      stack: null, steps: [], screenshot: null,
    };
  }

  const started = Date.now();
  const name = rawCase.name || rawCase.title || `case-${index + 1}`;
  const maxSteps = Number(rawCase.maxSteps || ctx.maxSteps || 20);
  const maxLlmCalls = Number(rawCase.maxLlmCalls || ctx.maxLlmCalls || 10);

  let llmCalls = 0;
  const executed = [];
  const assertions = [];
  let ended = '';
  let screenshot = null;

  // ① 意图解析
  const intent = await engine.parseIntent({
    kind: 'ui',
    input: rawCase.goal || rawCase.intent || name,
    env: { platform: ctx.platform, family: ctx.family, appId: ctx.appId || '' },
  });
  llmCalls++;

  const vars = { ...(ctx.vars || {}), ...(rawCase.vars || {}) };
  let lastError = '';

  // ③ 执行 ↔ 推理闭环
  for (let i = 0; i < maxSteps && llmCalls < maxLlmCalls; i++) {
    // eslint-disable-next-line no-await-in-loop
    const observation = await observe(session, { maxElements: ctx.maxElements || 40, platform: ctx.platform, startUrl: ctx.appId || '' });
    // eslint-disable-next-line no-await-in-loop
    const decision = await engine.decideNext({
      kind: 'ui',
      intent,
      observation,
      history: executed,
      remaining: maxSteps - i,
      startUrl: ctx.appId || '',
      lastError,
    });
    llmCalls++;

    for (const id of decision.achievedAssertions || []) assertions.push(id);

    if (decision.done || !decision.action || String(decision.action.action).toLowerCase() === 'finish') {
      ended = decision.reasoning || '模型判定意图已达成';
      break;
    }

    const act = decision.action || {};
    const step = {
      action: act.action,
      target: act.target,
      selector: act.selector || act.target,
      value: act.value,
      key: act.key,
      url: act.url,
      text: act.text,
    };
    // eslint-disable-next-line no-await-in-loop
    const r = await runStep(session, step, { ...ctx, vars }, executed.length);
    executed.push({
      step: executed.length + 1,
      action: step.action,
      ok: r.ok,
      detail: r.detail,
      error: r.error,
      decision: act.reason || decision.reasoning || '',
      locate: r.locate,
    });
    lastError = r.ok ? '' : String(r.error || '');
  }

  // ④ 断言校验:以最终控件树状态为准
  // eslint-disable-next-line no-await-in-loop
  const finalObs = await observe(session, { maxElements: ctx.maxElements || 40, platform: ctx.platform, startUrl: ctx.appId || '' });
  const results = [];
  for (const a of intent.assertions || []) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await checkAssertion(session, a, finalObs));
  }
  const unpassed = results.filter((r) => r.passed === false);
  const duration = Date.now() - started;
  const status = unpassed.length > 0 ? 'failed' : 'passed';

  if (ctx.screenshotOnFail !== false && (status === 'failed' || ctx.screenshotOnSuccess)) {
    try {
      screenshot = saveShot(await session.screenshotBase64(), ctx.tag || 'remote', `case-${index + 1}-${status}`);
    } catch (_) { /* ignore */ }
  }

  return {
    name,
    classname: ctx.tool || 'remote-e2e',
    status,
    duration,
    error: unpassed.length ? unpassed.map((u) => `${u.id}:${u.description || u.expected}`).join('; ') : null,
    stack: ended ? `模型结束说明: ${ended}` : null,
    steps: executed,
    llmCalls,
    intent: { goal: intent.goal, successSignal: intent.successSignal },
    assertions: results,
    screenshot,
  };
}

module.exports = { observe, runIntentCase, checkAssertion, parseNodes, getIntentEngine };
