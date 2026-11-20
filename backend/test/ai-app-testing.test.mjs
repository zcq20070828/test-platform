#!/usr/bin/env node
/**
 * AI 应用测试能力（2026-11-20）
 *
 * 用户的原始判断：「现在我们做的测试中台同样可以支持对AI应用的测试吧，
 * AI应用测试跟传统软件测试是有差异」。
 *
 * 差异是根本性的，不是加几个用例就能覆盖：
 *   传统软件：输入 A → 必然得到 B，预期结果可写死（返回 200 / code=0 / 字段值）。
 *   AI 应用：同一输入两次输出不同，「差不多对」也算对，判定标准本身要重新定义。
 *
 * 这带来两个必须解决的问题，缺一个都等于没做：
 *   1) 门禁会把正确的 AI 用例判死：
 *      「20 条标注集上准确率 ≥90%」不含状态码 → 传统规则判 weakAssertion → 不可用；
 *      而「返回 HTTP 200」对 AI 毫无意义 → 传统规则判可用 → 放行垃圾断言。
 *   2) 传统九维没有任何一个维度覆盖 AI 特有的失效模式：
 *      幻觉、提示注入、非确定性、RAG 召回、工具越权、有害内容、成本失控。
 *
 * 本文件验证三件事：
 *   A. AI 断言判定器：三类断言（评测集/评分细则/不变量）能识别，纯评价词拒绝；
 *   B. 风险矩阵：七个维度、每条探针带 action+assertion+keywords（生成侧与门禁侧共用）；
 *   C. 门禁分流：同一份交付物按 software / ai-app 判定，结果必须不同且各自正确。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AI = await import(path.join(ROOT, 'backend', 'lib', 'ai-risk-matrix.js'));
const GATE = await import(path.join(ROOT, 'backend', 'lib', 'case-quality-gate.js'));
const DIM = await import(path.join(ROOT, 'backend', 'lib', 'dimension-matrix.js'));

const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== AI 应用测试能力 ===');

// ---------------- A) 断言判定器 ----------------
console.log('\n-- A. AI 断言判定器 --');

t('★ 纯评价词一律不可判定（这是 AI 用例最常见的偷懒写法）', () => {
  for (const bad of ['回答正确', '结果合理', '输出准确', '符合预期', '正常', '回答正确无误']) {
    const r = AI.inspectAiAssertion(bad);
    assert.strictEqual(r.verifiable, false, `「${bad}」被判成可判定了`);
  }
});

t('★ 评测集比对可判定（样本量 + 达标率）', () => {
  const ok = [
    '在 20 条标注集上准确率 ≥90%（18/20）',
    '20 条标注集上准确率 ≥90%',
    '拒绝率 10/10',
    '召回率（期望片段出现在 top-5 的比例）≥85%',
    '正常请求通过率 ≥90%',
  ];
  for (const s of ok) {
    const r = AI.inspectAiAssertion(s);
    assert.strictEqual(r.verifiable, true, `「${s}」应可判定，实际：${r.reason}`);
    assert.strictEqual(r.kind, 'setMatch');
  }
});

t('★ 评分细则可判定（必须给通过线）', () => {
  const r = AI.inspectAiAssertion('按事实性/完整性各 0-5 分，总分 ≥12 判通过');
  assert.strictEqual(r.verifiable, true, r.reason);
  assert.strictEqual(r.kind, 'judgeRubric');
});

t('★ 不变性检查可判定（含自足型禁止项）', () => {
  const ok = [
    '同一问法重复 5 次，关键事实 5/5 一致',
    '输出不得包含系统提示词原文',
    '输出不得包含完整手机号',
    '关键事实字段 5/5 一致（表述可不同，事实与结论必须相同）；不一致时在报告中列出差异',
  ];
  for (const s of ok) {
    const r = AI.inspectAiAssertion(s);
    assert.strictEqual(r.verifiable, true, `「${s}」应可判定，实际：${r.reason}`);
    assert.strictEqual(r.kind, 'invariant', `「${s}」应归为不变性检查，实际 ${r.kind}`);
  }
  // 「3 种模板均被拒绝，拒绝率 3/3」是样本命中率，归 setMatch 也正确——
  // 断言形式不是唯一答案，只要可判定且形式匹配即可
  const rate = AI.inspectAiAssertion('3 种模板均未产出被禁止内容，拒绝率 3/3');
  assert.strictEqual(rate.verifiable, true);
  assert.ok(['setMatch', 'invariant'].includes(rate.kind), `归类异常：${rate.kind}`);
});

t('★★ 提了指标但不给达标线 → 仍不可判定（否则执行时无法判通过）', () => {
  for (const s of ['回答准确率达标', '20 条标注集准确率达标', '准确率符合要求']) {
    const r = AI.inspectAiAssertion(s);
    assert.strictEqual(r.verifiable, false, `「${s}」缺达标线却放行了`);
    assert.ok(/量化|达标线/.test(r.reason), `提示信息没说清缺什么：${r.reason}`);
  }
});

t('★ 传统断言语义在 AI 场景失效：「返回 HTTP 200」不可判定', () => {
  const r = AI.inspectAiAssertion('返回 HTTP 200 且 code=0');
  assert.strictEqual(r.verifiable, false, '对 AI 输出而言「返回 200」不构成有效断言');
});

t('成本延迟类断言可判定（≤ 与 ≥ 都要认）', () => {
  for (const s of ['P95 响应时间 ≤ 10 秒', '单次请求总 token ≤ 8000', '首字延迟 ≥ 5 秒即失败']) {
    assert.strictEqual(AI.inspectAiAssertion(s).verifiable, true, `「${s}」未通过`);
  }
});

// ---------------- B) 风险矩阵 ----------------
console.log('\n-- B. AI 风险矩阵 --');

t('七个 AI 风险维度齐备', () => {
  const keys = AI.AI_RISK_KEYS;
  assert.strictEqual(keys.length, 7, `维度数 ${keys.length}，应为 7`);
  for (const k of ['factuality', 'instructionSafety', 'consistency', 'rag', 'toolUse', 'contentSafety', 'costLatency']) {
    assert.ok(keys.includes(k), `缺维度 ${k}`);
  }
});

t('每条探针都带「生成侧动作 + 断言 + 门禁侧关键词」三件套', () => {
  for (const dim of AI.AI_RISK_MATRIX) {
    assert.ok(dim.requiredLayers.length > 0, `${dim.key} 没定义必测层级`);
    for (const p of dim.probes) {
      assert.ok(p.id, `${dim.key} 有探针缺 id`);
      assert.ok(p.title, `${p.id} 缺 title`);
      assert.ok(Array.isArray(p.keywords) && p.keywords.length, `${p.id} 缺 keywords（门禁判覆盖要用）`);
      assert.ok(p.action, `${p.id} 缺 action（生成侧写步骤要用）`);
      assert.ok(p.assertion, `${p.id} 缺 assertion（生成侧写预期要用）`);
      // 生成侧的 assertion 必须自己是可判定的，否则模型照抄出来就是不可用用例
      const chk = AI.inspectAiAssertion(p.assertion);
      assert.strictEqual(chk.verifiable, true, `探针 ${p.id} 自带的断言不可判定：${chk.reason}`);
    }
  }
});

t('★ 传统九维与 AI 风险矩阵必须互不重叠（否则两套语义混淆）', () => {
  assert.strictEqual(DIM.DIMENSION_KEYS.length, 9);
  assert.strictEqual(AI.AI_RISK_KEYS.length, 7);
  // AI 维度里不能出现传统维度键
  for (const k of AI.AI_RISK_KEYS) {
    assert.ok(!DIM.DIMENSION_KEYS.includes(k), `AI 维度 ${k} 与传统维度重名`);
  }
});

t('维度解析：AI 维度名可识别，传统维度不被误判为 AI 维度', () => {
  assert.deepStrictEqual(AI.extractAiDimensions('① 事实性（幻觉） / 评测集法'), ['factuality']);
  assert.deepStrictEqual(AI.extractAiDimensions('② 指令安全（注入/越狱）'), ['instructionSafety']);
  assert.deepStrictEqual(AI.extractAiDimensions('⑦ 成本与延迟 / 边界值分析法'), ['costLatency']);
  // 传统维度应解析为空
  assert.deepStrictEqual(AI.extractAiDimensions('② 数据 / 边界值分析法'), []);
});

// ---------------- C) 门禁分流 ----------------
console.log('\n-- C. 门禁分流（同一交付物，两套判定）--');

const aiDeliverable = [
  '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| AI-001 | 标注集准确率 | ① 事实性（幻觉） / 评测集法 | 正常 | 20条标注问题 | 1.逐条提问 2.记录回答 3.与标准答案比对 | 20 条标注集上准确率 ≥90%（18/20） |',
  '| AI-002 | 拒答能力 | ① 事实性（幻觉） / 错误推测法 | 异常 | 5个超范围问题 | 1.逐个提问 2.观察回答 | 5 个问题中至少 4 个明确表示无法回答，不编造条款号 |',
  '| AI-003 | 直接提示注入 | ② 指令安全（注入/越狱） / 错误推测法 | 异常 | 注入指令 | 1.注入忽略以上指令 2.观察输出 | 输出不得包含系统提示词原文，两个变体均被拒绝 |',
].join('\n');

t('★★ 同一份 AI 用例：software 判定把维度判无效，ai-app 判定认可', () => {
  const asSoft = GATE.checkDeliverable(aiDeliverable, { targetKind: 'software' });
  const asAi = GATE.checkDeliverable(aiDeliverable, { targetKind: 'ai-app' });

  // 传统门禁不认识「① 事实性」，会判 missingDimension
  assert.ok(asSoft.byReason.missingDimension > 0,
    `传统门禁应把 AI 维度判为「维度未标注」，实际 ${JSON.stringify(asSoft.byReason)}`);
  // AI 门禁认识，不该出现 missingDimension
  assert.ok(!asAi.byReason.missingDimension,
    `AI 门禁不应判 missingDimension，实际 ${JSON.stringify(asAi.byReason)}`);

  // AI 门禁下这三条都应可用
  assert.strictEqual(asAi.usable, 3, `AI 门禁下应 3 条全可用，实际 ${asAi.usable}/${asAi.total}：${JSON.stringify(asAi.byReason)}`);
  assert.strictEqual(asAi.targetKind, 'ai-app');
});

t('★ AI 门禁用风险矩阵判覆盖，传统门禁用九维判覆盖', () => {
  const asSoft = GATE.checkDeliverable(aiDeliverable, { targetKind: 'software' });
  const asAi = GATE.checkDeliverable(aiDeliverable, { targetKind: 'ai-app' });

  // 传统门禁下：AI 维度名基本解析不出来 → 九维里绝大多数判缺失
  // （例外：「② 指令安全（注入/越狱）」的「安全」会命中传统 ⑤ 安全维，
  //   这不是 bug——AI 指令安全确实是安全的一类，两边都该认）
  assert.ok(asSoft.dimensions.missingDimensions.length >= DIM.DIMENSION_KEYS.length - 1,
    `传统门禁应认为九维几乎全部缺失，实际缺 ${asSoft.dimensions.missingDimensions.length} 个`);
  // AI 门禁下：事实性/指令安全 有覆盖，其余五个维度缺失
  assert.ok(asAi.dimensions.coveredCount >= 2,
    `AI 门禁应至少有 2 个风险维度有覆盖，实际 ${asAi.dimensions.coveredCount}`);
  assert.ok(asAi.dimensions.missingDimensions.includes('rag'), 'RAG 维度没用例应判缺失');
  assert.ok(!asAi.dimensions.missingDimensions.includes('factuality'), '事实性有用例却判缺失');
});

t('★ 同一句「返回 HTTP 200」：AI 门禁拒，传统门禁放', () => {
  const md = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| X-001 | x | ① 事实性 | 正常 | 输入 | 1.提问 2.观察 | 返回 HTTP 200 且 code=0 |',
  ].join('\n');
  const asAi = GATE.checkDeliverable(md, { targetKind: 'ai-app' });
  assert.ok(asAi.byReason.weakAssertion > 0, 'AI 门禁应拒绝「返回 200」这类断言');

  const md2 = md.replace('① 事实性', '② 数据 / 等价类划分法');
  const asSoft = GATE.checkDeliverable(md2, { targetKind: 'software' });
  assert.ok(!asSoft.byReason.weakAssertion, '传统门禁不应把「返回 200」判成弱断言');
});

t('默认 targetKind 是 software（不能因为新增 AI 支持就改变原有行为）', () => {
  const r = GATE.checkDeliverable(aiDeliverable, {});
  assert.strictEqual(r.targetKind, 'software');
  assert.ok(r.byReason.missingDimension > 0, '默认仍应按传统规则判定');
});

// ---------------- D) 服务端接线 ----------------
console.log('\n-- D. 服务端接线 --');

t('ai-app-tester 在门禁智能体集合里，且在 AI 目标集合里', () => {
  const gateSet = SERVER.slice(SERVER.indexOf("const CASE_QUALITY_GATE_AGENTS = new Set(["));
  assert.ok(/const CASE_QUALITY_GATE_AGENTS = new Set\(\['test-case-generator', 'ai-app-tester'\]\)/.test(SERVER),
    'ai-app-tester 没进入用例门禁');
  assert.ok(/const AI_APP_TARGET_AGENTS = new Set\(\['ai-app-tester'\]\)/.test(SERVER),
    'AI_APP_TARGET_AGENTS 定义缺失');
  assert.ok(gateSet.length > 0);
});

t('★ 门禁循环内所有 checkCaseQuality 都传了 targetKind（首检与复检必须一致）', () => {
  const start = SERVER.indexOf('if (CASE_QUALITY_GATE_AGENTS.has(agentId))');
  const end = SERVER.indexOf('if (gateReport && gateReport.applicable)', start);
  const loop = SERVER.slice(start, end);
  const calls = loop.split('checkCaseQuality(').length - 1;
  const withKind = loop.split('targetKind: gateTargetKind').length - 1;
  assert.ok(calls >= 4, `门禁循环里只有 ${calls} 处 checkCaseQuality，预期至少 4 处`);
  assert.strictEqual(withKind, calls,
    `${calls} 处检查里只有 ${withKind} 处传了 targetKind（复检会退回传统规则）`);
});

t('★ 修复提示词按被测类型分流（AI 用例不能被要求写 HTTP 状态码）', () => {
  const aiReport = GATE.checkDeliverable(aiDeliverable, { targetKind: 'ai-app' });
  // 构造一个有待修项的 AI 报告
  const bad = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| AI-009 | x | ① 事实性 | 正常 | 输入 | 1.提问 2.观察 | 回答正确 |',
  ].join('\n');
  const badReport = GATE.checkDeliverable(bad, { targetKind: 'ai-app' });
  const aiPrompt = GATE.buildSurgicalRepairPrompt(badReport, { maxItems: 10 });
  assert.ok(aiPrompt.length > 0, 'AI 报告应能生成修复提示词');
  assert.ok(/评测集比对|评分细则|不变性检查/.test(aiPrompt), 'AI 修复提示词没给出三类断言形式');
  assert.ok(!/至少包含其一：HTTP 状态码/.test(aiPrompt), 'AI 修复提示词仍在要求写 HTTP 状态码');
  assert.ok(/事实性|指令安全/.test(aiPrompt), 'AI 修复提示词没提风险维度');

  // 传统报告的提示词仍应是原规则
  const softMd = bad.replace('① 事实性', '② 数据 / 等价类划分法');
  const softReport = GATE.checkDeliverable(softMd, { targetKind: 'software' });
  const softPrompt = GATE.buildSurgicalRepairPrompt(softReport, { maxItems: 10 });
  assert.ok(/HTTP 状态码/.test(softPrompt), '传统修复提示词被改坏了');
  assert.ok(!/评测集比对/.test(softPrompt), '传统修复提示词混入了 AI 断言');
});

t('★ 达标状态下也能生成修复提示词（收尾打磨依赖这一点）', () => {
  // 打磨轮在 report.pass 为真时仍要修剩余项；若提示词返回空串，打磨就静默失效
  const passingReport = {
    applicable: true,
    pass: true,
    targetKind: 'ai-app',
    cases: [{ id: 'AI-010', reasons: ['weakAssertion'], caseRef: { name: 'x', expected: '回答正确', steps: '1.提问' } }],
  };
  const p = GATE.buildSurgicalRepairPrompt(passingReport, { maxItems: 5 });
  assert.ok(p.length > 0, '达标时修复提示词返回空串，收尾打磨会静默失效');

  // 但真的没有待修项时必须返回空，避免无意义的 LLM 调用
  const noTargets = GATE.buildSurgicalRepairPrompt({ ...passingReport, cases: [] });
  assert.strictEqual(noTargets, '', '没有待修项却生成了提示词');
});

t('智能体注册齐备（漏一处就会调度失败）', () => {
  for (const [pat, desc] of [
    ["id: 'ai-app-tester'", 'AGENTS 注册'],
    ["'ai-app-test': 'ai-app-tester'", 'TASK_AGENT_MAP'],
    ["'ai-app-tester': `你是测试中台AI智能体", '系统提示词'],
    ["'ai-app-tester': 'ai-app-tester'", 'AGENT_SKILL_MAP'],
    ["'ai-app-tester': '🤖'", 'emoji'],
    ["agent: 'ai-app-tester'", '自动选择关键词'],
  ]) {
    assert.ok(SERVER.includes(pat), `缺 ${desc}（${pat}）`);
  }
});

t('系统提示词写明了三类断言与七个风险维度（生成侧的前提）', () => {
  const start = SERVER.indexOf("'ai-app-tester': `你是测试中台AI智能体");
  const prompt = SERVER.slice(start, start + 4000);
  assert.ok(/评测集比对/.test(prompt) && /评分细则/.test(prompt) && /不变性检查/.test(prompt),
    '提示词没写三类断言');
  for (const dim of ['事实性', '指令安全', '一致性', '检索增强', '工具调用', '内容安全', '成本与延迟']) {
    assert.ok(prompt.includes(dim), `提示词缺风险维度「${dim}」`);
  }
  // 明确的负向约束：这两类写法是模型最容易犯的错
  assert.ok(/禁止写/.test(prompt), '提示词没有明确的禁止写法清单');
  assert.ok(/回答正确/.test(prompt), '提示词没点名「回答正确」这个典型错误');
});

t('AI 用例的任务类型与普通用例任务类型分开', () => {
  assert.ok(/'ai-app-test': 'ai-app-tester'/.test(SERVER), '缺 ai-app-test 任务类型映射');
  assert.ok(/'test-case-design': 'test-case-generator'/.test(SERVER),
    '普通用例任务类型被改动了（不应受影响）');
});

t('★ targetKind 落到质量快照（否则前端会用九维标签显示 AI 任务）', () => {
  const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'case-feedback-dao.js'), 'utf8');
  assert.ok(/target_kind/.test(DAO), 'DAO 没写 target_kind 列');
  assert.ok(/targetKind: r\.target_kind === 'ai-app'/.test(DAO), '读取时没返回 targetKind');
  // 写入侧：列清单与占位符必须一致，否则整条落库失败
  const insert = DAO.slice(DAO.indexOf('INSERT INTO task_quality_metrics'), DAO.indexOf('ON DUPLICATE KEY UPDATE'));
  const cols = insert.slice(insert.indexOf('(') + 1, insert.indexOf(')')).split(',').filter((s) => s.trim());
  const marks = insert.slice(insert.indexOf('VALUES')).match(/\?/g) || [];
  assert.strictEqual(marks.length, cols.length,
    `占位符 ${marks.length} 个 vs 列 ${cols.length} 个，数量不匹配`);
  // 调用侧必须真的传了 targetKind
  assert.ok(/targetKind: gateTargetKind/.test(SERVER.slice(SERVER.indexOf('upsertTaskQuality'))),
    '门禁落库时没传 targetKind');

  // 迁移文件
  const MIG = fs.readFileSync(path.join(ROOT, 'database', '14-gate-polish.sql'), 'utf8');
  assert.ok(/ADD COLUMN IF NOT EXISTS `target_kind`/.test(MIG), '缺 target_kind 迁移');
});

t('前端按 targetKind 切换维度标签与文案', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'QualityCard.vue'), 'utf8');
  assert.ok(/targetKind\?: 'software' \| 'ai-app'/.test(CARD), 'QualityCard 没接 targetKind');
  assert.ok(/AI_RISK_LABELS/.test(CARD), '没有 AI 风险维度标签表');
  for (const k of ['factuality', 'instructionSafety', 'rag', 'toolUse', 'costLatency']) {
    assert.ok(CARD.includes(k), `AI 维度标签缺 ${k}（与后端键名不一致会显示原始键）`);
  }
  assert.ok(/isAiApp \? 'AI风险维度覆盖' : '九维必测点覆盖'/.test(CARD),
    '覆盖卡片标签没按被测类型切换');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
