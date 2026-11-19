#!/usr/bin/env node
/**
 * 审核员评分标签与任务结论口径分离 单元测试（2026-11-19）
 *
 * 用户要求「检查三个审核智能体的通过阈值是不是不一致」。
 *
 * 核查结论：阈值完全一致（都是 80）——
 *   - REVIEW_PASS_THRESHOLD = 80，三人共用同一常量
 *   - 提示词「通过标准：综合分 ≥ 80」三份逐字相同
 *   - parseReviewResult 默认阈值 80
 *   - AGENTS[*].passThreshold 三人都是 80
 *   - 三份提示词只有 2 行不同（智能体名 + 主视角/审读顺序）
 *   - 数据库里 passed = (score >= 80)，0 条例外
 *
 * 但发现真正的问题：**两套判定口径同时存在**
 *   - 每个审核员的「通过/未通过」标签：硬阈值 score >= 80
 *   - 任务级「已交付/未通过」结论：门禁 + 三人问题并集 + major 密度
 * 于是界面出现「三个审核员全红、任务却已交付」的自相矛盾展示。
 * 实测 6 个已通过任务里 5 个有审核员显示「未通过」，其中 2 个三人全红。
 *
 * 修复（用户选的方案一）：单个审核员的标签只报「评分达标 / 评分偏低」，
 * 不冒充交付物结论；任务结论由下方「综合结果」单独表达。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewerSystemPrompt } from '../lib/reviewer-prompt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const TASKS_VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'TasksView.vue'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
const REVIEWER_IDS = ['ai-quality-reviewer-1', 'ai-quality-reviewer-2', 'ai-quality-reviewer-3'];

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 审核员阈值一致性 & 标签口径 单元测试 ===');

// ---------------- 阈值必须一致 ----------------
t('REVIEW_PASS_THRESHOLD 是唯一来源（无重复定义）', () => {
  const defs = (SERVER.match(/^const REVIEW_PASS_THRESHOLD\s*=/gm) || []).length;
  assert.strictEqual(defs, 1, `定义了 ${defs} 次`);
});

t('三份提示词的「通过标准」逐字相同', () => {
  const lines = REVIEWER_IDS.map((id) => buildReviewerSystemPrompt(id)
    .split('\n').find((l) => l.startsWith('通过标准')));
  assert.ok(lines.every(Boolean), '缺少通过标准行');
  assert.strictEqual(new Set(lines).size, 1, `三份不同：${JSON.stringify(lines)}`);
  assert.ok(lines[0].includes('≥ 80'), lines[0]);
});

t('三份提示词的评分分档表逐字相同', () => {
  const extract = (id) => {
    const text = buildReviewerSystemPrompt(id);
    const start = text.indexOf('【评分口径');
    const end = text.indexOf('通过标准');
    return text.slice(start, end);
  };
  const blocks = REVIEWER_IDS.map(extract);
  assert.strictEqual(new Set(blocks).size, 1, '评分口径分档表不一致');
});

t('三份提示词只有 2 行不同（智能体名 + 主视角）', () => {
  const prompts = REVIEWER_IDS.map((id) => buildReviewerSystemPrompt(id).split('\n'));
  const max = Math.max(...prompts.map((p) => p.length));
  const diffLines = [];
  for (let i = 0; i < max; i += 1) {
    const lines = prompts.map((p) => p[i] ?? '');
    if (!lines.every((l) => l === lines[0])) diffLines.push(i + 1);
  }
  assert.strictEqual(diffLines.length, 2, `差异行：${diffLines.join(',')}`);
});

t('AGENTS 元数据里三个审核员 passThreshold 都是 80', () => {
  for (const id of REVIEWER_IDS) {
    const block = SERVER.slice(SERVER.indexOf(`'${id}': {`), SERVER.indexOf(`'${id}': {`) + 900);
    assert.ok(/passThreshold: 80/.test(block), `${id} 的 passThreshold 不是 80`);
  }
});

// ---------------- 标签不得冒充交付物结论 ----------------
t('任务详情：单个审核员不再显示「通过 / 未通过」', () => {
  // 只检查审核员卡片区块（综合结果区块另外有 reviewVerdictMeta）
  const start = TASKS_VIEW.indexOf('AI质量审核结果');
  const end = TASKS_VIEW.indexOf('审核结论（2026-11-17 三元化）', start);
  const block = TASKS_VIEW.slice(start, end);
  assert.ok(!/review\.passed \? '通过' : '未通过'/.test(block), '仍在用 review.passed 显示通过/未通过');
  assert.ok(/评分达标/.test(block), '缺少「评分达标」标签');
  assert.ok(/评分偏低/.test(block), '缺少「评分偏低」标签');
});

t('任务详情：评分标签用 score >= 80 判定', () => {
  const start = TASKS_VIEW.indexOf('AI质量审核结果');
  const end = TASKS_VIEW.indexOf('审核结论（2026-11-17 三元化）', start);
  const block = TASKS_VIEW.slice(start, end);
  assert.ok(/review\.score >= 80/.test(block), '未按 80 分切换标签');
});

t('任务详情：卡片边框按评分着色（绿=达标 / 灰=偏低 / 红=否决）', () => {
  assert.ok(/review-scored-high/.test(TASKS_VIEW), '缺少「评分达标」样式类');
  assert.ok(/review-scored-low/.test(TASKS_VIEW), '缺少「评分偏低」样式类');
  assert.ok(/review-veto/.test(TASKS_VIEW), '缺少「一票否决」样式类');
  assert.ok(!/\.review-card\.review-failed/.test(TASKS_VIEW), '旧的 review-failed 样式应已移除');
});

t('任务详情：给出「两者口径不同」的说明文案', () => {
  assert.ok(/只反映他自己的打分/.test(TASKS_VIEW), '缺少口径说明');
  assert.ok(/三人问题并集/.test(TASKS_VIEW), '说明里未提到任务级判定依据');
});

t('下载报告里也不再把 per-reviewer 写成「通过/未通过」', () => {
  const start = TASKS_VIEW.indexOf('### 审核员');
  const block = TASKS_VIEW.slice(start, start + 700);
  assert.ok(/该审核员评分/.test(block), '缺少「该审核员评分」表述');
  assert.ok(!/review\.passed \? '通过' : '未通过'/.test(block), '下载报告仍在用 passed 作结论');
});

t('聊天面板实时链路同步改口径', () => {
  assert.ok(/Number\(data\.score\) >= 80 \? '评分达标' : '评分偏低'/.test(STORE), '实时链路未改');
});

t('聊天面板时间线重放同步改口径', () => {
  assert.ok(/Number\(p\.score\) >= 80 \? '评分达标' : '评分偏低'/.test(STORE), '重放链路未改');
});

// ---------------- 任务级结论仍由密度制决定 ----------------
t('任务级判定仍用密度制（未被 per-reviewer passed 影响）', () => {
  assert.ok(/decideReviewVerdictByDensity\(reviewResults/.test(SERVER), '任务级判定未用密度制');
  const verdictLib = fs.readFileSync(path.join(ROOT, 'backend', 'lib', 'review-verdict.js'), 'utf8');
  const fn = verdictLib.slice(
    verdictLib.indexOf('export function decideReviewVerdictByDensity'),
    verdictLib.indexOf('export default'),
  );
  assert.ok(!/r\.passed/.test(fn), '密度制判定不应依赖 per-reviewer passed 字段');
});

t('前端仍能展示任务级三态结论', () => {
  assert.ok(/reviewVerdictMeta/.test(TASKS_VIEW), '缺少任务级结论展示');
  assert.ok(/passed_with_notes/.test(TASKS_VIEW), '缺少「已交付·附建议」态');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
