#!/usr/bin/env node
/**
 * 任务提交的意图识别与「识别不准就三选一」（2026-11-20）
 *
 * 用户两条要求：
 *   1.「前端提交任务时都加这个意图意识呢，而不是只有『继续对话』才加」
 *   2.「无法根据用户输入准确识别意图的时候就提供 3 个最有可能的选项给让用户选择」
 *
 * 改造前的真实行为（autoSelectAgent）：
 *   - 按规则表顺序「首个命中即返回」——规则顺序比相关性更重要。
 *     实测「看看这个接口有没有问题」命中「接口」就派给 api-executor，
 *     而整句更符合缺陷分析；「这个功能还有什么没考虑到的」零命中，
 *     静默落到 test-master，用户看不出任务被派给了通用智能体。
 *   - 没有置信度：命中「case」与命中「测试用例生成」同等对待。
 *   - 没有候选：猜错了用户只能等十几分钟看到产出才发现。
 *
 * 本文件验证四件事：
 *   A. 打分：长词权重高于短词，重叠命中不重复计分，英文词做边界判断
 *   B. 置信度：只有短词命中 / 首选与次选接近 时不自动定性
 *   C. 候选：任何情况都给满 3 个，含零命中
 *   D. 接线：提交接口返回 409 + 候选，前端弹窗后按选择重新提交
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TI = await import(path.join(ROOT, 'backend', 'lib', 'task-intent.js'));
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 任务提交的意图识别 ===');

// ---------------- A) 打分 ----------------
console.log('\n-- A. 打分 --');

t('★ 长词优先于短词（「测试用例生成」比「case」更能定性）', () => {
  const long = TI.scoreAgents('请帮我做测试用例生成');
  const short = TI.scoreAgents('case');
  assert.ok(long.length && short.length);
  const longTop = long.find((x) => x.agent === 'test-case-generator');
  const shortTop = short.find((x) => x.agent === 'test-case-generator');
  assert.ok(longTop.score > shortTop.score,
    `长词得分 ${longTop.score} 未高于短词 ${shortTop.score}`);
});

t('★ 重叠命中不重复计分（「测试用例」被「测试用例生成」覆盖）', () => {
  // 「测试用例生成」命中后，「测试用例」「用例生成」都是它的子串，只应计一次分
  const r = TI.scoreAgents('测试用例生成');
  const top = r[0];
  assert.ok(top.hits.length <= 2, `重叠命中计了 ${top.hits.length} 次：${top.hits.join('、')}`);
  assert.strictEqual(top.hits[0], '测试用例生成');
});

t('英文短词做词边界判断（"rag" 不该命中 "storage"）', () => {
  const r = TI.scoreAgents('请检查 storage 容量');
  const ai = r.find((x) => x.agent === 'ai-app-tester');
  assert.ok(!ai || !ai.hits.includes('rag'), `"rag" 误命中 "storage"：${ai?.hits.join(',')}`);
});

t('「sql 注入」带空格也能命中安全测试', () => {
  const r = TI.scoreAgents('扫一下有没有 sql 注入问题');
  const sec = r.find((x) => x.agent === 'security-sentinel');
  assert.ok(sec && sec.score > 0, '带空格的 SQL 注入没命中安全测试');
});

t('★ 多个智能体都能命中时按分数排序（不再首个命中即返回）', () => {
  // 「压测下单接口」：性能测试与接口测试都命中，性能应在前
  const r = TI.scoreAgents('压测一下下单接口，看 TPS');
  assert.strictEqual(r[0].agent, 'performance-tester', `首选是 ${r[0].agent}`);
  assert.ok(r.some((x) => x.agent === 'api-executor'), '接口测试应该也在候选里');
});

// ---------------- B) 置信度 ----------------
console.log('\n-- B. 置信度 --');

t('★ 明确表述 → 自动确认', () => {
  const cases = [
    ['帮我给这个登录功能设计测试用例', 'test-case-generator'],
    ['对这个系统做接口测试', 'api-executor'],
    ['给 AI 助手做测试，检查幻觉和提示注入', 'ai-app-tester'],
    ['压测一下下单接口，看 TPS', 'performance-tester'],
    ['扫一下有没有 SQL 注入漏洞', 'security-sentinel'],
    ['整理一份测试报告', 'test-reporter'],
  ];
  for (const [text, agent] of cases) {
    const r = TI.analyzeTaskIntent(text);
    assert.strictEqual(r.confident, true, `「${text}」应自动确认，实际：${r.reason}`);
    assert.strictEqual(r.agentId, agent, `「${text}」派给了 ${r.agentId}`);
  }
});

t('★★ 只命中短词 → 不自动定性（请用户确认）', () => {
  // 「接口」是 2 字短词，可能是在问「这个接口有没有问题」（缺陷分析）
  const r = TI.analyzeTaskIntent('看看这个接口有没有问题');
  assert.strictEqual(r.confident, false, `「接口」单词命中就自动定成了 ${r.agentId}`);
  assert.ok(r.candidates.length === 3, '应给 3 个候选');
});

t('★★ 零命中 → 不静默派给通用智能体，而是给候选', () => {
  for (const text of ['这个功能还有什么没考虑到的', '这个需求该怎么测才好呢', '帮我测试一下系统']) {
    const r = TI.analyzeTaskIntent(text);
    assert.strictEqual(r.confident, false, `「${text}」不该自动确认`);
    assert.strictEqual(r.candidates.length, 3, `「${text}」候选数为 ${r.candidates.length}`);
    assert.ok(r.reason.length > 0, '应说明为什么需要确认');
  }
});

t('用户明确指定智能体时不走识别', () => {
  const r = TI.analyzeTaskIntent('随便什么内容', { explicitAgent: 'test-reporter' });
  assert.strictEqual(r.confident, true);
  assert.strictEqual(r.agentId, 'test-reporter');
});

// ---------------- C) 候选 ----------------
console.log('\n-- C. 候选 --');

t('★ 候选恰好 3 个（多了等于把选择负担还给用户）', () => {
  const inputs = [
    '帮我测试一下',
    '压测一下下单接口，看 TPS',
    '给 AI 助手做测试，检查幻觉',
    '',
  ];
  for (const s of inputs) {
    const r = TI.analyzeTaskIntent(s);
    assert.strictEqual(r.candidates.length, 3, `「${s}」给了 ${r.candidates.length} 个候选`);
  }
});

t('候选带可读名称与说明（用户要能看懂选什么）', () => {
  const r = TI.analyzeTaskIntent('看看这个接口有没有问题');
  for (const c of r.candidates) {
    assert.ok(c.agentId, '候选缺 agentId');
    assert.ok(c.agentName, '候选缺中文名');
    assert.ok(typeof c.desc === 'string', '候选缺说明');
  }
});

t('候选含命中依据（用户能判断「它为什么这么猜」）', () => {
  const r = TI.analyzeTaskIntent('看看这个接口有没有问题');
  const first = r.candidates[0];
  assert.ok(Array.isArray(first.hits) && first.hits.length > 0,
    '首选候选没有命中依据，用户无法判断猜得对不对');
});

t('候选不含分数之外的内部信息（不把权重漏给用户）', () => {
  const r = TI.analyzeTaskIntent('压测一下下单接口，看 TPS');
  const c = r.candidates[0];
  // score 是排序列，可以有；但不该把 priority 之类内部字段透出去
  assert.strictEqual(c.priority, undefined, '候选泄露了内部 priority 字段');
});

// ---------------- D) 动作类型 ----------------
console.log('\n-- D. 动作类型 --');

t('★ 区分「产出」与「提问」（同一智能体两种用法）', () => {
  assert.strictEqual(TI.detectActionKind('帮我生成登录功能的测试用例'), 'generate');
  assert.strictEqual(TI.detectActionKind('这个功能为什么没覆盖到？'), 'question');
  assert.strictEqual(TI.detectActionKind('为什么没生成完整，重新生成一遍'), 'mixed');
});

// ---------------- E) 服务端接线 ----------------
console.log('\n-- E. 服务端接线 --');

t('★★ 识别不准时返回 409 + 候选，不创建任务', () => {
  assert.ok(/INTENT_CONFIRM_REQUIRED/.test(SERVER), '缺 INTENT_CONFIRM_REQUIRED 状态码');
  const idx = SERVER.indexOf('INTENT_CONFIRM_REQUIRED');
  const body = SERVER.slice(Math.max(0, idx - 600), idx + 600);
  assert.ok(/candidates:\s*intentInfo\.candidates/.test(body), '没把候选返回给前端');
  assert.ok(/res\.status\(409\)/.test(body), '不是 409');
  // 必须在创建任务之前返回
  const taskCreate = SERVER.indexOf('tasks.set(taskId, task)');
  assert.ok(idx < taskCreate, '先创建了任务才要求确认，等于白跑一次');
});

t('★ 用户选定的智能体提交后不再被二次质询', () => {
  assert.ok(/confirmedAgent = true/.test(SERVER), '没有记录「用户已明确指定」');
  const idx = SERVER.indexOf('confirmedAgent = true');
  const body = SERVER.slice(idx, idx + 200);
  assert.ok(body.includes('targetAgent'), '标记位置不对');
  // 分支处必须判断 confirmedAgent
  assert.ok(/intentInfo\.confident && intentInfo\.agentId/.test(SERVER));
  assert.ok(/else if \(!confirmedAgent\)/.test(SERVER), '未指定时没有走确认分支');
});

t('★ 旧的「首个命中即返回」规则表已删除（避免两份规则漂移）', () => {
  assert.ok(!/keywordRules/.test(SERVER), 'server.js 里还留着旧规则表，会与新规则漂移');
  assert.ok(/from '\.\/lib\/task-intent\.js'/.test(SERVER), '没引入 task-intent');
  // autoSelectAgent 应委托给统一实现
  const idx = SERVER.indexOf('function autoSelectAgent');
  const body = SERVER.slice(idx, idx + 700);
  assert.ok(/analyzeTaskIntent/.test(body), 'autoSelectAgent 没复用统一实现');
});

t('前端能拿到候选（错误响应不只留 error 字符串）', () => {
  const API = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'api', 'index.ts'), 'utf8');
  assert.ok(/code: data\.code/.test(API), 'api 层没透出 code');
  assert.ok(/details: data/.test(API), 'api 层没透出完整响应体（前端拿不到 candidates）');
});

t('★ 前端弹窗三选一并按选择重新提交', () => {
  const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'DashboardView.vue'), 'utf8');
  assert.ok(/IntentConfirmDialog/.test(VIEW), '没用意图确认弹窗');
  assert.ok(/INTENT_CONFIRM_REQUIRED/.test(VIEW), '没处理后端的确认响应');
  assert.ok(/onIntentConfirmed/.test(VIEW), '缺确认后的提交流程');
  // 重新提交要带上用户选定的 agent
  const idx = VIEW.indexOf('async function onIntentConfirmed');
  const body = VIEW.slice(idx, idx + 700);
  assert.ok(/store\.createTask\(agentId, pending\.input/.test(body), '没按选定类型重新提交');
});

t('弹窗只展示 3 个候选且不展示分数', () => {
  const DIALOG = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'IntentConfirmDialog.vue'), 'utf8');
  assert.ok(/slice\(0, 3\)/.test(DIALOG), '没限制 3 个候选');
  // 分数是排序用的，不该展示给用户
  assert.ok(!/\{\{\s*c\.score/.test(DIALOG), '把内部评分展示给用户了');
  assert.ok(/命中/.test(DIALOG), '没展示命中依据');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
