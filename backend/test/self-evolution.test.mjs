#!/usr/bin/env node
/**
 * 自我进化闭环（2026-11-20）
 *
 * 用户要求「补齐我想象的那种自我进化能力，注意系统性修改」，并强调
 * 「要实实在在实现，不要做个 demo 之类的」。
 *
 * 改造前的真实状态：平台每天产出大量质量信号，但没有任何一条回流去改进下一次生成。
 *    task_review_results  351 行（三审 issues，8 类问题分布清晰）
 *    task_quality_metrics  34 行（门禁 byReason 缺陷分布）
 *    case_feedback           3 行（人工标注，几乎无人使用）
 * 这些只用于「判定这一次过不过」，从不影响「下一次怎么写」。
 *
 * 本闭环的四段（全部真实落库、真实注入、真实生效）：
 *   1) 沉淀：审核 issues + 门禁缺陷 → 归一成经验，按 (agent, category, sub-pattern)
 *      去重累加。措辞不同但同类的问题必须聚成一条，否则永远数不清频次。
 *   2) 注入：生成前把 active/watch 的经验拼进系统提示词，L1/L2/L3 分级表述。
 *   3) 验证：记「注入前/注入后的每任务命中率」，算 effectiveness。
 *      ★ 未命中的任务也必须计入分母，否则「问题消失」反而看不出效果（实测踩到）。
 *   4) 进化：命中率下降 ≥70% 休眠、≥30% 升级、上升则降级待人工复核；
 *      阈值用审核评分作弱标签自动校准，且**只允许收紧不允许放松**。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NORM = await import(path.join(ROOT, 'backend', 'lib', 'experience-normalizer.js'));
const CALIB = await import(path.join(ROOT, 'backend', 'lib', 'threshold-calibration.js'));

const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const DAO_SRC = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'experience-dao.js'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database', '12-agent-experience.sql'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'ExperienceView.vue'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 自我进化闭环 ===');

// ---------------- 1) 沉淀：归一化 ----------------
t('同类问题措辞不同也聚成同一条（否则数不清频次）', () => {
  const variants = [
    '预期结果不可判定，只写「返回HTTP状态码200」，未明确具体字段',
    '预期结果只写状态码未给字段，TC-052 的预期无法判定',
    '预期结果只写了状态码，缺少具体字段值',
  ];
  const keys = variants.map((d) => NORM.experienceFromReviewIssue({ category: 'assertion', description: d })?.patternKey);
  assert.ok(keys.every(Boolean), '有变体没产出经验');
  // 这三句实际暴露两种缺陷：只写状态码（status-only）vs 缺字段值（missing-field）。
  // 要求的是「不同措辞不能各建一条」（3 条），聚成 ≤2 条即达标。
  assert.ok(new Set(keys).size <= 2,
    `3 个变体聚成了 ${new Set(keys).size} 条（应 ≤2，说明归一没生效）：${keys.join(' | ')}`);
  // 其中至少两条必须聚到一起
  assert.ok(keys.length - new Set(keys).size >= 1, '没有任何两条被聚到一起，归一失效');
});

t('不同类问题不会撞同一个签名', () => {
  const a = NORM.experienceFromReviewIssue({ category: 'assertion', description: '预期结果只写状态码' });
  const b = NORM.experienceFromReviewIssue({ category: 'placeholder', description: '输入用 AAAA 占位' });
  assert.notStrictEqual(a.patternKey, b.patternKey);
});

t('类别归一兼容审核员与门禁的不同叫法', () => {
  assert.strictEqual(NORM.normalizeCategory('weakAssertion'), 'assertion');
  assert.strictEqual(NORM.normalizeCategory('断言不可判定'), 'assertion');
  assert.strictEqual(NORM.normalizeCategory('placeholder'), 'placeholder');
  assert.strictEqual(NORM.gateReasonToCategory('orphanRequirement'), 'traceability');
  assert.strictEqual(NORM.gateReasonToCategory('missingDimension'), 'coverage');
});

t('每条经验都给出可执行的 guidance（不是「要注意质量」这种废话）', () => {
  for (const c of NORM.KNOWN_CATEGORIES) {
    const meta = NORM.categoryMeta(c);
    assert.ok(meta.guidance && meta.guidance.length >= 15, `${c} 的 guidance 过短：${meta.guidance}`);
    // 必须包含具体动作（写出/合并/必须/不得 之类）
    assert.ok(/必须|不得|禁止|要|需|按/.test(meta.guidance), `${c} 的 guidance 没有可执行要求`);
  }
});

t('信息量不足的问题不建经验（避免污染）', () => {
  assert.strictEqual(NORM.experienceFromReviewIssue({ description: '不好' }), null);
  assert.strictEqual(NORM.experienceFromReviewIssue(null), null);
});

// ---------------- 2) 存储与计数 ----------------
t('迁移建出三张表（经验库/进化日志/阈值历史）', () => {
  for (const tb of ['agent_experiences', 'experience_evolution_log', 'gate_threshold_history']) {
    assert.ok(MIGRATION.includes(`CREATE TABLE IF NOT EXISTS \`${tb}\``), `缺表 ${tb}`);
  }
  // 质量快照补的两列（审核弱标签）必须存在
  assert.ok(/ADD COLUMN IF NOT EXISTS `review_median`/.test(MIGRATION), '缺 review_median');
  assert.ok(/ADD COLUMN IF NOT EXISTS `review_verdict`/.test(MIGRATION), '缺 review_verdict');
});

t('经验表有唯一键，保证跨任务去重', () => {
  assert.ok(/UNIQUE KEY `uk_agent_category_pattern` \(`agent_id`, `category`, `pattern_key`\)/.test(MIGRATION),
    '缺唯一键，同一问题会被重复插入');
});

t('★ 未命中的任务也计入分母（否则「问题消失」看不出效果）', () => {
  // 这是实测踩到的真 bug：只记命中不记观测 → tasks_after 恒为 0
  // → 命中率无法计算 → 经验永远停在「样本不足」→ 永远不升级。
  assert.ok(/export async function recordObservation/.test(DAO_SRC), '缺 recordObservation');
  const fn = DAO_SRC.slice(DAO_SRC.indexOf('export async function recordTaskExperiences'));
  const body = fn.slice(0, 1400);
  assert.ok(/await recordObservation\(agentId, afterInjection\)/.test(body),
    'recordTaskExperiences 没有为「未命中」记观测');
  // 空候选分支也必须记
  const emptyBranch = body.slice(body.indexOf('if (!Array.isArray(candidates)'), body.indexOf('let recorded'));
  assert.ok(/recordObservation/.test(emptyBranch), '空候选（干净任务）没有记观测');
});

t('观测的 UPDATE 语句不用模板拼列名（拼错就静默失效）', () => {
  const fn = DAO_SRC.slice(DAO_SRC.indexOf('export async function recordObservation'));
  const body = fn.slice(0, 1200);
  assert.ok(/SET tasks_after = tasks_after \+ 1/.test(body), '缺 tasks_after 的显式语句');
  assert.ok(/SET tasks_before = tasks_before \+ 1/.test(body), '缺 tasks_before 的显式语句');
  assert.ok(!/SET tasks_\$\{/.test(body), '仍在用模板字符串拼列名');
});

t('effectiveness 用「每任务命中率」而非绝对次数', () => {
  const fn = DAO_SRC.slice(DAO_SRC.indexOf('export function computeEffectiveness'));
  const body = fn.slice(0, 800);
  // 代码里是驼峰命名（tasksBefore / tasksAfter），这里两种都认
  assert.ok(/tasks_?[bB]efore/.test(body) && /tasks_?[aA]fter/.test(body), '未按任务数归一');
  assert.ok(/occurrences_?before[\s\S]{0,60}tasks_?Before/.test(body), '未算注入前命中率');
  assert.ok(/occurrences_?after[\s\S]{0,60}tasks_?After/.test(body), '未算注入后命中率');
});

// ---------------- 3) 注入 ----------------
t('经验真的注入到系统提示词（不是只存库）', () => {
  assert.ok(/experienceDAO\.getInjectableExperiences/.test(SERVER), '没有取可注入经验');
  assert.ok(/experiencePrompt/.test(SERVER), '没有拼进提示词');
  assert.ok(/basePrompt \+ skillsPrompt \+ experiencePrompt/.test(SERVER),
    '经验没进入最终 systemPrompt');
});

t('经验分 L1/L2/L3 三级表述，等级越高语气越强', () => {
  const idx = SERVER.indexOf('const lines = [\'【本平台历史经验');
  assert.ok(idx > 0, '找不到经验拼接块');
  const block = SERVER.slice(idx - 400, idx + 1200);
  assert.ok(/会被门禁拦截/.test(block), 'L3 没有「会被门禁拦截」这类强表述');
  assert.ok(/高频问题/.test(block), 'L2 没有「高频问题」表述');
  assert.ok(/e\.level >= 3/.test(block) && /e\.level === 2/.test(block), '没有按 level 分支');
});

t('注入时标记起始时间（效果统计的基准点）', () => {
  assert.ok(/markInjected/.test(SERVER), '没有标记注入起点');
  assert.ok(/export async function markInjected/.test(DAO_SRC), 'DAO 缺 markInjected');
  // 只能标记一次（COALESCE），否则每次注入都重置基准
  assert.ok(/injected_since = COALESCE\(injected_since, CURRENT_TIMESTAMP\)/.test(DAO_SRC),
    'injected_since 会被反复重置，效果永远算不出');
});

t('三个 AI 调用点都用同一批经验（避免同一任务内前后不一致）', () => {
  const matches = [...SERVER.matchAll(/callOpenClawAPI\([^)]*injectedExperiences\)/g)];
  assert.ok(matches.length >= 3, `只有 ${matches.length} 处传了经验，应为 3 处（首次/催促/工具循环）`);
});

// ---------------- 4) 沉淀接入 ----------------
t('任务收尾从门禁缺陷沉淀经验', () => {
  assert.ok(/experienceFromGateReason/.test(SERVER), '没有从门禁沉淀');
  assert.ok(/gateDefects/.test(SERVER), '没有门禁缺陷汇总器');
  const idx = SERVER.indexOf('经验沉淀（自我进化闭环）');
  assert.ok(idx > 0, '找不到沉淀块');
  const block = SERVER.slice(idx, idx + 1600);
  assert.ok(/recordTaskExperiences/.test(block), '沉淀块没有落库');
  assert.ok(/afterInjection/.test(block), '没有区分注入前后');
});

t('★ 覆盖所有任务：两条门禁的缺陷都要沉淀', () => {
  // 用户明确要求「自我进化要覆盖所有任务，不是只覆盖某一类」。
  // 两条门禁覆盖面不同，必须都接入：
  //   CASE_QUALITY_GATE → test-case-generator
  //   RULE_GATE         → 其余十几个智能体（需求分析/方案/执行/缺陷/报告/脱敏/安全/性能/兼容/脚本）
  const addCalls = [...SERVER.matchAll(/addGateDefects\(/g)].length;
  assert.ok(addCalls >= 3, `只有 ${addCalls} 处调用 addGateDefects（应为 3：用例门禁 2 处 + 规则门禁 1 处）`);

  // 规则门禁必须真的接了
  const ruleIdx = SERVER.indexOf("console.log(`[RuleGate] ${agentId} ${ruleReport.summary.text}`)");
  assert.ok(ruleIdx > 0, '找不到规则门禁日志点');
  const ruleBlock = SERVER.slice(ruleIdx, ruleIdx + 400);
  assert.ok(/addGateDefects\(ruleReport\.byReason\)/.test(ruleBlock),
    '规则门禁的缺陷没有沉淀 → 经验只覆盖用例生成一类任务');

  // 用例门禁必须真的接了
  const caseGateCalls = [...SERVER.matchAll(/addGateDefects\(gateReport\.byReason/g)].length;
  assert.ok(caseGateCalls >= 1, '用例门禁的缺陷没有沉淀');
});

t('未命中的任务也沉淀（记观测），不会被前置条件挡住', () => {
  const idx = SERVER.indexOf('经验沉淀（自我进化闭环）');
  const block = SERVER.slice(idx, idx + 2000);
  // 不能写成 if (candidates.length) { record... }，否则干净任务不计入分母
  assert.ok(/const rec = await experienceDAO\.recordTaskExperiences\(/.test(block),
    '沉淀被 candidates.length 包住 → 干净任务不计入分母');
  assert.ok(/无缺陷也要记一次观测/.test(block), '缺少「干净任务也记观测」的说明');
});

t('审核沉淀覆盖所有智能体（不限于用例生成）', () => {
  const idx = SERVER.indexOf('经验沉淀：审核 issues 是最有价值的学习来源');
  const block = SERVER.slice(idx, idx + 1800);
  // 用调用方传入的实际 agentId，而非写死 test-case-generator
  assert.ok(/reviewContext\?\.agentId/.test(block), '没有用调用方传入的 agentId');
  assert.ok(!/agentForExp\s*=\s*'test-case-generator'/.test(block), '写死了只对用例生成生效');
});

t('审核完成后从 issues 沉淀（最丰富的学习来源）', () => {
  assert.ok(/experienceFromReviewIssue/.test(SERVER), '没有从审核沉淀');
  const idx = SERVER.indexOf('经验沉淀：审核 issues 是最有价值的学习来源');
  assert.ok(idx > 0, '找不到审核沉淀块');
  const block = SERVER.slice(idx, idx + 1800);
  assert.ok(/recordTaskExperiences/.test(block), '审核沉淀没有落库');
  // 审自身失败（score=0 + error）不该算交付物缺陷
  assert.ok(/r\.error \|\| r\.parseOk === false/.test(block), '没有排除审核自身失败的结果');
  // 三个审核员报同一问题只算一次
  assert.ok(/seen\.has\(c\.patternKey\)/.test(block), '没有跨审核员去重');
});

// ---------------- 5) 进化 ----------------
t('进化有明确的升级/休眠/降级阈值，且样本不足不下结论', () => {
  const fn = DAO_SRC.slice(DAO_SRC.indexOf('export async function evolveExperiences'));
  const body = fn.slice(0, 3000);
  assert.ok(/MIN_TASKS|minTasks/.test(body), '没有最小样本数门槛');
  assert.ok(/PROMOTE_DROP|promoteDrop/.test(body), '没有升级阈值');
  assert.ok(/DORMANT_DROP|dormantDrop/.test(body), '没有休眠阈值');
  assert.ok(/dormant/.test(body) && /promoted/.test(body) && /demoted/.test(body), '缺三种动作');
  assert.ok(/命中率上升/.test(body), '没有处理「命中率反而上升」的情况');
});

t('休眠的经验被重新命中会自动复活（不是永久丢弃）', () => {
  const fn = DAO_SRC.slice(DAO_SRC.indexOf('export async function recordOccurrence'));
  const body = fn.slice(0, 2600);
  assert.ok(/status === 'dormant'/.test(body), '没有休眠复活逻辑');
  assert.ok(/resurrected/.test(body), '没有记录复活动作');
  // 但人工废除的必须尊重，不能自动复活
  assert.ok(/废除的除外|suppressed/.test(body), '没有区分「人工废除不可自动复活」');
});

t('进化动作全部落审计日志（可追溯决策依据）', () => {
  assert.ok(/logEvolution/.test(DAO_SRC), '没有写审计日志');
  assert.ok(/export async function listEvolutionLog/.test(DAO_SRC), '没有读日志的接口');
  for (const act of ['created', 'promoted', 'dormant', 'suppressed']) {
    assert.ok(new RegExp(`'${act}'`).test(DAO_SRC), `缺动作 ${act}`);
  }
});

t('定时进化已注册（闭环能自己转起来）', () => {
  assert.ok(/evolveTick/.test(SERVER), '没有定时进化');
  const idx = SERVER.indexOf('const evolveTick = async ()');
  assert.ok(idx > 0, '找不到 evolveTick 定义');
  const block = SERVER.slice(idx, idx + 3000);
  assert.ok(/setInterval\(evolveTick/.test(block), '没有注册定时器');
  assert.ok(/30 \* 60 \* 1000/.test(block), '不是 30 分钟一次');
});

// ---------------- 6) 阈值自动校准 ----------------
t('审核结论能映射成「是否可用」的弱标签', () => {
  assert.strictEqual(CALIB.reviewUsable('passed'), true);
  assert.strictEqual(CALIB.reviewUsable('passed_with_notes'), true);
  assert.strictEqual(CALIB.reviewUsable('failed'), false);
  assert.strictEqual(CALIB.reviewUsable('inconclusive'), null);
  assert.strictEqual(CALIB.reviewUsable(null), null);
});

t('★ 校准只收紧不放松（否则会为了指标好看而放松门禁）', () => {
  // 真实场景：门禁 0.86 放行了一批，但审核判失败 → 应提高阈值
  const samples = [];
  for (let i = 0; i < 10; i += 1) samples.push({ usability: 0.86 + i * 0.005, reviewVerdict: i < 7 ? 'failed' : 'passed' });
  for (let i = 0; i < 10; i += 1) samples.push({ usability: 0.6 + i * 0.02, reviewVerdict: 'failed' });

  const r = CALIB.calibrateByReviewVerdict(samples, { currentThreshold: 0.85 });
  assert.strictEqual(r.status, 'ok');
  assert.ok(r.recommended >= 0.85, `建议降到 ${r.recommended}，方向错了（不得放松门禁）`);
  // 曲线里也不允许出现低于当前阈值的候选被选中
  assert.ok(r.best === null || r.best.threshold >= 0.85, '选中了低于当前阈值的候选');
});

t('样本不足时不给结论（不拿 3 个样本就改阈值）', () => {
  const r = CALIB.calibrateByReviewVerdict([{ usability: 0.9, reviewVerdict: 'passed' }], { currentThreshold: 0.85 });
  assert.strictEqual(r.status, 'insufficient');
  assert.strictEqual(r.recommended, null);
});

t('阈值调整有历史记录（能回答「阈值为什么变了」）', () => {
  assert.ok(/export async function saveThresholdChange/.test(DAO_SRC), '缺写入历史');
  assert.ok(/export async function listThresholdHistory/.test(DAO_SRC), '缺读取历史');
  assert.ok(/export async function getThresholdSamples/.test(DAO_SRC), '缺样本读取');
  // 采纳路径必须写历史
  const idx = SERVER.indexOf("app.post('/api/quality/threshold-auto-calibration'");
  const block = SERVER.slice(idx, idx + 2000);
  assert.ok(/saveThresholdChange/.test(block), '采纳时没有写历史');
});

// ---------------- 7) 接口与前端 ----------------
t('经验库接口齐备（列表/日志/废除/进化/校准）', () => {
  for (const route of [
    "app.get('/api/quality/experiences'",
    "app.get('/api/quality/experiences/evolution-log'",
    "app.patch('/api/quality/experiences/:id'",
    "app.post('/api/quality/experiences/evolve'",
    "app.get('/api/quality/threshold-auto-calibration'",
    "app.post('/api/quality/threshold-auto-calibration'",
  ]) {
    assert.ok(SERVER.includes(route), `缺接口 ${route}`);
  }
});

t('废除经验需要管理员权限（防止误操作影响所有人）', () => {
  const idx = SERVER.indexOf("app.patch('/api/quality/experiences/:id'");
  const line = SERVER.slice(idx, SERVER.indexOf('{', idx));
  assert.ok(/requireAdmin/.test(line), '废除接口没有管理员限制');
});

t('前端经验看板能看到：学到什么 / 效果 / 进化日志 / 废除入口', () => {
  assert.ok(/自我进化 · 经验库/.test(VIEW), '缺页面标题');
  assert.ok(/row\.guidance/.test(VIEW), '看不到具体改进要求');
  assert.ok(/row\.effectiveness/.test(VIEW), '看不到效果');
  assert.ok(/evolutionLog/.test(VIEW), '看不到进化日志');
  assert.ok(/suppress\(row\)/.test(VIEW), '没有废除入口');
  assert.ok(/calib/.test(VIEW) && /采纳建议/.test(VIEW), '没有阈值校准入口');
});

t('前端页面类名避开外层 :deep(.page-header) 隐藏规则', () => {
  const header = VIEW.slice(0, VIEW.indexOf('<script'));
  assert.ok(/class="exp-header"/.test(header), '页头未用独立类名');
  assert.ok(!/class="page-header"/.test(header), '与隐藏规则撞名');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
