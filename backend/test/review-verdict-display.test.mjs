#!/usr/bin/env node
/**
 * 审核结论三态化 + 任务详情展示 单元测试（2026-11-17）
 *
 * 背景：审核判定改成「并集 + 密度」后多了一个结论 `passed_with_notes`
 * （门禁客观达标、无 blocker，但审核有若干改进建议）。它和 `passed`
 * 在交付物可用性上没有区别，差别只在「还有没有改进空间需要告知用户」。
 *
 * 如果前端只按 review_passed 布尔值渲染，这个结论会被显示成普通的「审核通过」，
 * 审核收集到的建议就白费了 —— 用户以为一切正常，实际有 14 条可优化项被隐藏。
 *
 * 这组测试守住三件事：
 *   1) 后端把 verdict / summary / notes / attempts / stats 落库并在两个接口返回
 *   2) verdict 与 review_passed 不会互相矛盾
 *   3) 前端三态各自有独立的展示文案（不是二选一）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'task-dao.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
const TASKS_VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'TasksView.vue'), 'utf8');
const QUALITY_CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'QualityCard.vue'), 'utf8');
const TYPES = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'types', 'index.ts'), 'utf8');
const MIGRATION = (() => {
  const p = path.join(ROOT, 'database', '10-task-review-verdict.sql');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
})();

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 审核结论三态化 单元测试 ===');

// ---------------- 迁移 ----------------
t('迁移脚本幂等且五列齐全', () => {
  assert.ok(MIGRATION.includes('CREATE TABLE') || MIGRATION.includes('ALTER TABLE'), '缺少迁移语句');
  assert.ok(MIGRATION.includes('ADD COLUMN IF NOT EXISTS `review_verdict`'), '缺少 review_verdict');
  assert.ok(MIGRATION.includes('ADD COLUMN IF NOT EXISTS `review_summary`'), '缺少 review_summary');
  assert.ok(MIGRATION.includes('ADD COLUMN IF NOT EXISTS `review_notes`'), '缺少 review_notes');
  assert.ok(MIGRATION.includes('ADD COLUMN IF NOT EXISTS `review_attempts`'), '缺少 review_attempts');
  assert.ok(MIGRATION.includes('ADD COLUMN IF NOT EXISTS `review_stats`'), '缺少 review_stats');
});

// ---------------- DAO ----------------
t('DAO updateTask 支持五个 verdict 字段', () => {
  for (const f of ['reviewVerdict', 'reviewSummary', 'reviewNotes', 'reviewAttempts', 'reviewStats']) {
    assert.ok(DAO.includes(`updates.${f} !== undefined`), `updateTask 缺少 ${f}`);
  }
});

t('DAO 读任务时把 verdict 字段映射出来', () => {
  assert.ok(/reviewVerdict: row\.review_verdict/.test(DAO), '缺少 reviewVerdict 映射');
  assert.ok(/reviewNotes: safeParseReviewNotes/.test(DAO), '缺少 reviewNotes 解析');
});

t('verdict 为通过态时 review_passed 强制为真（防口径矛盾）', () => {
  assert.ok(/row\.review_verdict === 'passed' \|\| row\.review_verdict === 'passed_with_notes'/.test(DAO),
    'DAO 未做一致性兜底');
});

// ---------------- 写入 ----------------
t('单任务链路把 verdict 写到 task 上', () => {
  const calls = (SERVER.match(/applyReviewVerdictToTask\(task, lastVerdict/g) || []).length;
  assert.ok(calls >= 2, `通过/失败分支都应写入，实际 ${calls} 处`);
});

t('applyReviewVerdictToTask 写入五个字段且限制建议条数', () => {
  const fn = SERVER.slice(SERVER.indexOf('function applyReviewVerdictToTask'), SERVER.indexOf('async function persistTask'));
  for (const f of ['task.reviewVerdict', 'task.reviewSummary', 'task.reviewAttempts', 'task.reviewStats', 'task.reviewNotes']) {
    assert.ok(fn.includes(f), `缺少 ${f}`);
  }
  assert.ok(/slice\(0, 30\)/.test(fn), '改进建议应限制条数（避免整块 issues 灌进任务对象）');
});

t('verdict 在循环外保留最后一轮（否则 pass/fail 分支取不到）', () => {
  assert.ok(/let lastVerdict = null;/.test(SERVER), '缺少 lastVerdict 声明');
  assert.ok(/lastVerdict = taskVerdict;/.test(SERVER), '未保存最后一轮判定');
});

// ---------------- 接口 ----------------
t('persistTask 落库五个 verdict 字段', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function persistTask'), SERVER.indexOf('/**\n * 把技能执行证据'));
  for (const f of ['reviewVerdict', 'reviewSummary', 'reviewNotes', 'reviewAttempts', 'reviewStats']) {
    assert.ok(fn.includes(f), `persistTask 缺少 ${f}`);
  }
});

t('任务详情接口返回 verdict 与完整改进建议', () => {
  const route = SERVER.slice(SERVER.indexOf("app.get('/api/tasks/:id',"));
  const body = route.slice(0, 6000);
  assert.ok(/SELECT review_verdict, review_summary, review_notes, review_attempts, review_stats/.test(body),
    '详情接口未查询 verdict 列');
  assert.ok(/task\.reviewVerdict = r\.review_verdict/.test(body), '详情接口未回填 reviewVerdict');
  assert.ok(/JSON\.parse\(r\.review_notes\)/.test(body), '详情接口未解析 reviewNotes');
});

t('任务列表接口剔除完整 notes，只给条数（避免拖慢列表）', () => {
  assert.ok(/delete slim\.reviewNotes/.test(SERVER), '列表未剔除 reviewNotes');
  assert.ok(/reviewNoteCount: noteCount/.test(SERVER), '列表未返回 reviewNoteCount');
});

t('输出物下载接口也带 verdict 与建议', () => {
  const route = SERVER.slice(SERVER.indexOf("app.get('/api/tasks/:id/output'"));
  const body = route.slice(0, 3000);
  assert.ok(/reviewVerdict: task\.reviewVerdict/.test(body), '下载接口缺少 reviewVerdict');
  assert.ok(/reviewNotes: task\.reviewNotes/.test(body), '下载接口缺少 reviewNotes');
});

t('审核通过/失败广播都带 verdict', () => {
  assert.ok(/reviewVerdict: isWithNotes \? 'passed_with_notes' : 'passed'/.test(SERVER), '通过广播缺少 verdict');
  assert.ok(/reviewVerdict: lastVerdict \? lastVerdict\.verdict : 'failed'/.test(SERVER), '失败广播缺少 verdict');
});

// ---------------- 前端 ----------------
t('Task 类型声明四种结论 + ReviewNote 结构', () => {
  assert.ok(/reviewVerdict\?: 'passed' \| 'passed_with_notes' \| 'failed' \| 'inconclusive' \| 'veto'/.test(TYPES),
    'Task 类型缺少 reviewVerdict 联合类型');
  assert.ok(/export interface ReviewNote/.test(TYPES), '缺少 ReviewNote 接口');
  assert.ok(/reviewNoteCount\?: number/.test(TYPES), '缺少 reviewNoteCount');
});

t('任务详情对「已交付·附建议」用 warning 而非 danger', () => {
  // passed_with_notes 的交付物可用性等同于 passed，用红色会让用户误以为任务失败
  const computed = TASKS_VIEW.slice(TASKS_VIEW.indexOf('const reviewVerdictMeta'), TASKS_VIEW.indexOf('function rowVerdictMeta'));
  assert.ok(/type: 'warning' as const, label: `已交付 · 附/.test(computed), '未用 warning 表达「已交付」');
  assert.ok(/type: 'danger' as const, label: '审核未通过'/.test(computed), 'failed 未用 danger');
});

t('任务详情渲染改进建议列表（含严重度/位置/建议）', () => {
  assert.ok(/selectedTask\.reviewNotes && selectedTask\.reviewNotes\.length/.test(TASKS_VIEW), '未渲染改进建议区块');
  for (const f of ['note.description', 'note.suggestion', 'note.caseId', 'note.severity']) {
    assert.ok(TASKS_VIEW.includes(f), `改进建议未展示 ${f}`);
  }
});

t('任务列表有独立「审核」列显示短标签', () => {
  assert.ok(/label="审核"/.test(TASKS_VIEW), '列表缺少审核列');
  assert.ok(/已交付·附建议/.test(TASKS_VIEW), '列表缺少「已交付·附建议」短标签');
});

t('打开详情时补拉完整 notes（列表不含）', () => {
  const fn = TASKS_VIEW.slice(TASKS_VIEW.indexOf('async function viewDetail'), TASKS_VIEW.indexOf('async function viewDetail') + 700);
  assert.ok(/taskApi\.getById\(task\.id\)/.test(fn), '未补拉详情');
});

t('实时事件区分 passed 与 passed_with_notes', () => {
  assert.ok(/data\.reviewVerdict === 'passed_with_notes'/.test(STORE), 'store 未区分两种通过态');
  assert.ok(/AI 审核已交付（附/.test(STORE), '缺少「已交付·附建议」文案');
});

t('QualityCard 同时展示门禁结论与审核结论', () => {
  assert.ok(/verdictBadge/.test(QUALITY_CARD), 'QualityCard 未展示审核结论');
  assert.ok(/门禁达标/.test(QUALITY_CARD), 'QualityCard 仍应展示门禁结论');
});

t('下载的完整报告包含改进建议', () => {
  assert.ok(/### 改进建议（\$\{data\.reviewNotes\.length\} 条）/.test(TASKS_VIEW), '下载报告缺少改进建议章节');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
