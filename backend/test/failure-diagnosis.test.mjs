#!/usr/bin/env node
/**
 * 任务失败诊断 + 前端可读提示（2026-11-20）
 *
 * 用户反馈：「前端应该给明确的提示，直接执行失败用户都不知道具体什么原因导致，
 * 会莫名其妙的，很影响用户体验」。
 *
 * 起因：任务 9184ca57 前端显示「DeepSeek 账户余额不足（402）」，
 * 真实原因是智谱 429 限流 —— 用户按提示去充值也解决不了。
 *
 * 这套测试锁住两件事：
 *   1) 后端能把错误分对类（每类都有正确的 title/actions/retryable）
 *   2) 前端能把诊断渲染成「问题 + 可以怎么做」，且不泄漏成裸技术错误
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIAG = path.join(ROOT, 'backend', 'lib', 'failure-diagnosis.js');
const FMT = path.join(ROOT, 'frontend', 'src', 'utils', 'failure-message.ts');
const { diagnoseFailure, providerDisplayName } = await import(DIAG);

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}
function tAsync(name, fn) {
  return (async () => {
    try { await fn(); pass += 1; console.log('  ✅ ' + name); }
    catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
  })();
}

/** 在 node 里跑 TS 版 formatFailure */
function runFmt(code) {
  const file = path.join(ROOT, 'backend', 'test', '.failure-probe.mjs');
  fs.writeFileSync(file, `import * as M from ${JSON.stringify(FMT)};\n${code}`, 'utf8');
  try {
    return execFileSync(process.execPath, ['--experimental-strip-types', file], { encoding: 'utf8' }).trim();
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
}

console.log('=== 任务失败诊断 单元测试 ===');

// ---------------- 后端分类 ----------------
t('余额不足：category=balance, 不可重试, 建议去充值/换 Key', () => {
  const d = diagnoseFailure(new Error('智谱 AI 账户余额不足（402），请充值后再试'), { provider: 'zhipu' });
  assert.strictEqual(d.category, 'balance');
  assert.ok(/余额不足/.test(d.title), d.title);
  assert.ok(/智谱/.test(d.title), '标题未带服务商');
  assert.strictEqual(d.retryable, false, '余额不足不该标为可重试');
  assert.ok(d.actions.some((a) => /充值/.test(a)), '缺少充值建议');
  assert.ok(d.actions.some((a) => /换一条/.test(a)), '缺少换 Key 建议');
});

t('429 限流：即使响应体含「余额不足」也不判成余额', () => {
  // 这是任务 9184ca57 的真实场景
  const d = diagnoseFailure(new Error('zhipu 返回 429（请求过于频繁/并发超限，或额度已用尽）：{"error":{"message":"余额不足"}}'), { provider: 'zhipu' });
  assert.strictEqual(d.category, 'rate_limit', `判成了 ${d.category}，用户会去充错账户`);
  assert.strictEqual(d.retryable, true, '限流应该可重试');
  assert.ok(/429|限流/.test(d.title + d.detail), '未说明是限流');
});

t('Key 无效：指向「验证」与「服务商是否选对」', () => {
  const d = diagnoseFailure(new Error('moonshot 返回 401：{"error":{"message":"Invalid Authentication"}}'), { provider: 'moonshot' });
  assert.strictEqual(d.category, 'auth');
  assert.ok(d.actions.some((a) => /验证/.test(a)), '缺少「点验证」建议');
  assert.ok(d.actions.some((a) => /服务商选对/.test(a)), '缺少「检查服务商」建议');
  assert.strictEqual(d.retryable, false);
});

t('模型名不支持：建议清空模型用推荐值', () => {
  const d = diagnoseFailure(
    new Error('deepseek 返回 400：The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash'),
    { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
  );
  assert.strictEqual(d.category, 'model_not_found');
  assert.ok(/deepseek-v4\.1-flash/.test(d.detail), '详情未回显填错的模型名');
  assert.ok(d.actions.some((a) => /留空/.test(a)), '缺少「留空用推荐模型」建议');
});

t('上下文超限 / 网络 / 忙碌 / 工具未执行 / 质量门禁 都能识别', () => {
  assert.strictEqual(diagnoseFailure(new Error('maximum context length exceeded')).category, 'context_overflow');
  assert.strictEqual(diagnoseFailure(new Error('fetch failed')).category, 'network');
  assert.strictEqual(diagnoseFailure(new Error('同一用户同一时间只能执行一个任务')).category, 'busy');
  assert.strictEqual(diagnoseFailure(new Error('未执行真实工具（需要 9dem-executor）')).category, 'tool_not_called');
  assert.strictEqual(diagnoseFailure(new Error('可用率仅 40%，低于要求 60%')).category, 'quality_gate');
});

t('认不出的错误归 unknown，保留原始文本且不甩锅', () => {
  const d = diagnoseFailure(new Error('某个没人见过的奇怪错误 xyz'));
  assert.strictEqual(d.category, 'unknown');
  assert.ok(d.raw.includes('xyz'), '未保留原始错误');
  assert.ok(d.actions.some((a) => /发给管理员/.test(a)), 'unknown 应引导找管理员而不是瞎猜');
});

t('每条诊断都必带 title/detail/actions（前端不可能是空面板）', () => {
  const samples = ['余额不足', '429', '401', 'model not found', 'context length', 'fetch failed', '乱七八糟'];
  for (const s of samples) {
    const d = diagnoseFailure(new Error(s));
    assert.ok(d.title && d.title.length > 2, `${s} 缺 title`);
    assert.ok(Array.isArray(d.actions) && d.actions.length > 0, `${s} 缺 actions`);
    assert.ok(['balance', 'rate_limit', 'auth', 'model_not_found', 'context_overflow', 'network', 'busy', 'tool_not_called', 'quality_gate', 'unknown'].includes(d.category),
      `${s} 的 category 不在约定集合内：${d.category}`);
  }
});

t('providerDisplayName 给中文名，未知名原样返回', () => {
  assert.strictEqual(providerDisplayName('zhipu'), '智谱 AI');
  assert.strictEqual(providerDisplayName('deepseek'), 'DeepSeek');
  assert.strictEqual(providerDisplayName('unknown-provider'), 'unknown-provider');
});

// ---------------- 前端渲染 ----------------
t('渲染含标题、原因、编号建议，且不给裸错误', () => {
  const out = runFmt(`
const d = {
  category: 'balance', title: '智谱 AI 账户余额不足',
  detail: '智谱 AI 返回余额不足（本次模型 glm-4-plus）。',
  actions: ['到 智谱 AI 控制台给账户充值', '或在「API Key 配置」里换一条有余额的 Key 并设为默认'],
  retryable: false, raw: '智谱 AI 账户余额不足（402）'
};
console.log(M.formatFailure(d))`);
  assert.ok(/\*\*智谱 AI 账户余额不足\*\*/.test(out), '标题未加粗呈现');
  assert.ok(/本次模型 glm-4-plus/.test(out), '原因缺失');
  assert.ok(/1\. 到 智谱 AI 控制台给账户充值/.test(out), '建议未编号');
  assert.ok(/2\. 或在这条/.test(out) || /2\. 或在/.test(out), '第二条建议缺失');
  assert.ok(/重跑也不会变/.test(out), '不可重试时未提醒别白试');
  assert.ok(/原始错误（排查用）/.test(out), '缺原始错误（排查需要）');
});

t('可重试的失败不出现「重跑也不会变」', () => {
  const out = runFmt(`
const d = { category: 'rate_limit', title: '智谱 AI 暂时拒绝了请求（限流）',
  detail: '返回 429', actions: ['等 1~2 分钟后重新执行'], retryable: true, raw: '429' };
console.log(M.formatFailure(d))`);
  assert.ok(!/重跑也不会变/.test(out), '可重试却提示「别白试」，自相矛盾');
});

t('没有诊断信息时给兜底提示，而不是只显示一行技术错误', () => {
  const out = runFmt(`console.log(M.formatFailure(null, 'ECONNREFUSED 127.0.0.1:3002'))`);
  assert.ok(/任务执行失败/.test(out), '缺标题');
  assert.ok(/ECONNREFUSED/.test(out), '缺原始原因');
  assert.ok(/可以这样做/.test(out), '缺下一步建议');
  assert.ok(/发给管理员/.test(out), '缺升级路径');
});

t('类别标签与图标齐备（列表小标签要用）', () => {
  const cats = ['balance', 'rate_limit', 'auth', 'model_not_found', 'context_overflow', 'network', 'busy', 'tool_not_called', 'quality_gate', 'unknown'];
  for (const c of cats) {
    const label = runFmt(`console.log(M.failureLabel('${c}'))`);
    const icon = runFmt(`console.log(M.failureIcon('${c}'))`);
    assert.ok(label && label !== '执行失败' || c === 'unknown', `${c} 缺中文标签`);
    assert.ok(icon && icon.length > 2, `${c} 缺图标`);
  }
});

// ---------------- 接入检查 ----------------
t('后端三处失败路径都带 failure', () => {
  const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  assert.ok(/diagnoseFailure/.test(SERVER), 'server.js 未引入诊断');
  // executeTaskAsync catch
  const catchIdx = SERVER.indexOf('} catch (error) {\n    console.error(`[Task] Execution error:');
  assert.ok(catchIdx > 0, '找不到 executeTaskAsync 的 catch');
  // 窗口要足够大：catch 里除了诊断还有「按 Key 来源分流」的分支（2026-11-24），
  // 原来的 1800 字符会把 failure.title 挤出去。
  const block = SERVER.slice(catchIdx, catchIdx + 6000);
  assert.ok(/failure/.test(block), 'task_error 广播未带 failure');
  assert.ok(/failure\.title/.test(block), '失败占位文本未用诊断标题');
  assert.ok(/task\.failure = failure/.test(block), 'failure 没有落库到 task');
  // 余额检查
  assert.ok(/balFailure/.test(SERVER), '余额检查未带诊断');
});

t('★★ 鉴权失败按 Key 来源区分指引（用户没配 Key ≠ 自己的 Key 失效）', () => {
  const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  const idx = SERVER.indexOf("failure.category === 'auth'");
  assert.ok(idx > 0, '没有按 Key 来源分流鉴权失败');
  const block = SERVER.slice(idx, idx + 3000);

  assert.ok(/rk\.source === 'platform' \|\| rk\.source === 'none'/.test(block),
    '没处理「用的是平台 Key」这种情况');
  assert.ok(/你还没有配置自己的 API Key/.test(block),
    '没有明确告诉用户「你没配 Key」');
  assert.ok(/scope = 'user-key-missing'/.test(block), '缺缺失场景标记');

  assert.ok(/rk\.source === 'user'/.test(block), '没处理「用户自己的 Key 失效」');
  assert.ok(/scope = 'user-key-invalid'/.test(block), '缺失效场景标记');

  assert.ok(/系统设置与管理 → API KEY 配置/.test(block), '指引没有指向具体页面');
});

t('★★ 失败文案里不能出现明文或末位 Key（会随 task.result 落库并下发前端）', () => {
  const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  const idx = SERVER.indexOf("failure.category === 'auth'");
  const block = SERVER.slice(idx, idx + 3000);
  assert.ok(!/PLATFORM_API_KEY\.slice/.test(block), '把平台 Key 片段拼进了失败文案');
  assert.ok(!/rk\.apiKey\.slice|rk\.apiKey\.substr/.test(block), '把用户 Key 片段拼进了失败文案');
});

t('前端两条链路都走 formatFailure（实时 + 时间线重放）', () => {
  const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
  const hits = (STORE.match(/formatFailure\(/g) || []).length;
  assert.ok(hits >= 2, `只有 ${hits} 处使用 formatFailure（应为实时 + 重放两条链路）`);
  assert.ok(!/content: `任务错误：\$\{p\.error/.test(STORE), '时间线重放仍在直接贴原始错误');
});

t('任务详情页有失败原因卡片（不是只在列表里标红）', () => {
  const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'TasksView.vue'), 'utf8');
  assert.ok(/失败原因/.test(VIEW), '详情页缺少「失败原因」区块');
  assert.ok(/renderFailure/.test(VIEW), '缺少渲染函数');
  assert.ok(/renderMarkdownSafe/.test(VIEW), '渲染未走安全清洗');
  assert.ok(/failureLabel\(row\.failure\?\.category\)/.test(VIEW), '列表未显示失败类别标签');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
