/**
 * 需求分析审核标准（2026-11-25）
 *
 * 起因：用户问「对测试需求的审核标准完善了没」。
 * 查下来发现一个矛盾：3 个需求分析任务的审核分是 85/83/87（全过 80），
 * 而同期确定性门禁判定「未达标」——审核和门禁结论互相矛盾，审核等于没起作用。
 *
 * 根因：审核提示词里把评分口径写死成
 *   「major 占比 = major 条数 ÷ 交付物中的用例总条数」
 * 但需求分析报告**根本不产用例**。模型只能自己编一个分母，
 * 编出来的分母偏大 → 占比偏小 → 分数偏高。
 *
 * 另外补齐三类实测出现但标准里没写的审核点（来自真实审核意见）：
 *   - 接口需求未映射到功能需求（API-001~013 未建立到 FR 的映射）
 *   - 推断未标注（「FR-013 断言返回 mobile，原文无明确定义，属推断未标注」）
 *   - 自我背书（「报告末尾自述已完成 AI 质量三重审核自检」）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewerSystemPrompt } from '../lib/reviewer-prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ❌ ${name} :: ${e.message}`);
  }
}

console.log('=== 需求分析审核标准 单元测试 ===');

const PROMPT = buildReviewerSystemPrompt('ai-quality-reviewer-1');

/**
 * 取「需求分析审核重点」那一段
 *
 * 注意：文件里有两处 'test-requirement-analyzer': ` —— 前面是
 * AGENT_SYSTEM_PROMPTS（生成用的输出模板），后面才是 DELIVERABLE_FOCUS
 * （审核重点）。必须从 DELIVERABLE_FOCUS 之后找，否则会取到生成模板。
 */
function requirementFocusBlock() {
  const anchor = SERVER.indexOf('const DELIVERABLE_FOCUS');
  assert.ok(anchor > 0, '找不到 DELIVERABLE_FOCUS');
  const start = SERVER.indexOf("'test-requirement-analyzer': `", anchor);
  assert.ok(start > anchor, '找不到需求分析审核重点');
  const end = SERVER.indexOf("'test-scheme-generator': `", start);
  assert.ok(end > start, '找不到块结束位置');
  return SERVER.slice(start, end);
}

// ---------------- 评分分母分层（核心修复）----------------

t('评分口径不再把「用例总条数」当唯一分母', () => {
  // 旧口径那句话导致模型对需求分析报告编分母
  assert.ok(!/「major 占比」= major 级问题条数 ÷ 交付物中的用例总条数/.test(PROMPT),
    '旧的单一分母口径仍在，需求分析报告又会被编分母');
});

t('需求分析报告的分母是「需求条目总数」', () => {
  assert.ok(/需求分析报告\*\* → 分母 = 报告中的\*\*需求条目总数\*\*/.test(PROMPT),
    '未给需求分析指定分母');
  assert.ok(/不是用例数|绝不能用「用例数」做分母/.test(PROMPT),
    '未明确排除用例数作分母');
});

t('测试用例集仍用「用例总条数」作分母（不回归）', () => {
  assert.ok(/测试用例集\*\* → 分母 = 用例总条数/.test(PROMPT), '用例集口径被改坏了');
  // 校准过的判据示例必须保留
  assert.ok(/300 条用例里有 12 条 major → 占比 4%/.test(PROMPT), '用例集的校准示例丢失');
});

t('测试方案/报告/缺陷各有自己的分母', () => {
  assert.ok(/\*\*测试方案 \/ 报告 \/ 其他非用例类\*\*/.test(PROMPT), '缺少非用例类的统一说明');
  assert.ok(/方案：测试阶段数或测试项数/.test(PROMPT), '方案缺分母定义');
  assert.ok(/报告：结论\/指标条目数/.test(PROMPT), '报告缺分母定义');
  assert.ok(/缺陷报告：缺陷条目数/.test(PROMPT), '缺陷缺分母定义');
});

t('需求分析的判据示例按需求条目算，不是用例数', () => {
  assert.ok(/24 条需求里有 2 条 major → 占比 8%/.test(PROMPT), '缺需求规模下的判据示例');
  assert.ok(/12 条需求里有 3 条 major → 占比 25%/.test(PROMPT), '缺小规模反例');
});

t('小规模交付物要更严（避免「只有 3 条问题」给高分）', () => {
  assert.ok(/小规模交付物反过来要更严/.test(PROMPT), '缺少小规模从严的说明');
});

t('无法确定条目数时要求写明取法', () => {
  assert.ok(/检查项通过数 ÷ 检查项总数.*写明/s.test(PROMPT), '缺少兜底取法与可追溯要求');
});

// ---------------- 新增审核点 ----------------

t('需求分析重点包含验收标准可判定', () => {
  const block = requirementFocusBlock();
  assert.ok(/可判定的验收标准/.test(block), '未要求验收标准可判定');
  assert.ok(/24 条 FR 里若多数没有验收标准列/.test(block), '未说明缺验收标准属 major');
});

t('需求分析重点包含「接口→功能映射」', () => {
  const block = requirementFocusBlock();
  assert.ok(/接口需求与功能需求的映射/.test(block), '缺少接口映射审核点');
  assert.ok(/下游用例无法判断/.test(block), '未说明为什么映射重要');
});

t('需求分析重点包含「推断必须标注」', () => {
  const block = requirementFocusBlock();
  assert.ok(/推断必须标注/.test(block), '缺少推断标注审核点');
  assert.ok(/未标注的推断会被下游当成事实/.test(block), '未说明推断未标注的危害');
});

t('需求分析重点禁止自我背书', () => {
  const block = requirementFocusBlock();
  assert.ok(/禁止自我背书/.test(block), '缺少自我背书审核点');
  assert.ok(/已完成 AI 质量三重审核自检/.test(block), '未给出真实案例');
});

t('需求分析仍要求「不得要求包含用例」（原护栏不丢）', () => {
  const block = requirementFocusBlock();
  assert.ok(/不得要求它包含测试用例/.test(block), '原有的阶段职责护栏被删了');
});

// ---------------- 分母指引送达被审对象 ----------------

t('审核请求里显式下发分母取法', () => {
  assert.ok(/DENOMINATOR_HINT/.test(SERVER), '缺少分母指引表');
  const start = SERVER.indexOf('const DENOMINATOR_HINT');
  const block = SERVER.slice(start, start + 1400);
  assert.ok(/test-requirement-analyzer/.test(block), '需求分析未列入分母指引');
  assert.ok(/不是用例数/.test(block), '需求分析分母指引仍可能被理解成用例数');
});

t('分母指引随交付物类型变化（不是一句话套所有）', () => {
  const start = SERVER.indexOf('const DENOMINATOR_HINT');
  const block = SERVER.slice(start, start + 1400);
  const kinds = ['test-requirement-analyzer', 'test-case-generator', 'test-scheme-generator',
    'test-reporter', 'defect-analyzer'];
  for (const k of kinds) {
    assert.ok(block.includes(k), `${k} 缺分母定义`);
  }
});

t('reviewContext.agentId 确实被传入（否则分流拿不到类型）', () => {
  // 两条主链路都要传 agentId：工作流链路 + 分步链路
  assert.ok(/agentId: selectedAgentId/.test(SERVER), '工作流链路未传 agentId');
  assert.ok(/agentId: task\.agent/.test(SERVER), '分步链路未传 agentId');
});

t('分母指引真的拼进了审核输入', () => {
  assert.ok(/【评分分母取法（关系到你的分数是否可信，必须照此计算）】/.test(SERVER),
    '分母指引没拼进 reviewInput，模型看不到');
});

// ---------------- 原有关键护栏不回归 ----------------

t('三名审核员能力相同的设定不变', () => {
  for (const id of ['ai-quality-reviewer-1', 'ai-quality-reviewer-2', 'ai-quality-reviewer-3']) {
    const p = buildReviewerSystemPrompt(id);
    assert.ok(/任何维度发现问题都必须写进 issues 并影响评分/.test(p), `${id} 丢了全维度要求`);
  }
});

t('veto 条件与格式扣分上限等校准护栏保留', () => {
  assert.ok(/veto 只在下列情况为 true/.test(PROMPT), 'veto 条件被改');
  assert.ok(/不要因格式不完美而大幅扣分/.test(PROMPT), '格式扣分护栏被删');
  assert.ok(/不要因无法核实的数据默认幻觉/.test(PROMPT), '幻觉判定护栏被删');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
