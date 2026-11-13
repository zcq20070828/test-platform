#!/usr/bin/env node
/**
 * review-verdict 单元测试（2026-11-09）
 *
 * 覆盖：
 *   - JSON 裸控制字符容错（真实失败样例）
 *   - 嵌套 issues 的花括号配平解析
 *   - 备用文本抽取（"score": 76 / 「score」：76 / 76 分）
 *   - 解析失败不伪装成 0 分：scoreSource='none' + scoreOk=false
 *   - 统一投票：否决 / 中位数 / 有效数不足(inconclusive)
 *   - 审核自身失败（error / scoreOk=false）不参与投票
 *   - 历史数据回归：82/80/78 这类分歧应通过
 */
import assert from 'node:assert';
import {
  sanitizeJsonControlChars,
  extractBalancedJson,
  parseReviewResult,
  decideReviewVerdict,
  decideReviewVerdictWithGate,
  isReviewerFailure,
} from '../lib/review-verdict.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== review-verdict 单元测试 ===');

// ---------------- 控制字符容错 ----------------
const badJson = `{
  "score": 76,
  "veto": false,
  "reason": "逻辑一致性扣分",
  "issues": [
    { "severity": "major", "caseId": "TC-049",
      "description": "字段不一致
且加密方式不符", "suggestion": "改为 loginName" }
  ]
}`;

t('裸换行的 JSON 原始解析必然失败（回归基线）', () => {
  assert.throws(() => JSON.parse(badJson));
});

t('清洗后可以解析且分数正确', () => {
  const cleaned = sanitizeJsonControlChars(badJson);
  const p = JSON.parse(cleaned);
  assert.strictEqual(p.score, 76);
  assert.strictEqual(p.issues.length, 1);
  assert.ok(p.issues[0].description.includes('字段不一致'));
});

t('清洗不影响正常 JSON', () => {
  const ok = '{"score":80,"veto":false}';
  assert.deepStrictEqual(JSON.parse(sanitizeJsonControlChars(ok)), JSON.parse(ok));
});

t('只转义字符串内部，不动结构缩进', () => {
  const s = '{\n  "a": "x\\ty"\n}';
  const out = sanitizeJsonControlChars(s);
  assert.ok(out.includes('\n  "a"'), '结构换行应保留: ' + JSON.stringify(out));
});

// ---------------- 配平扫描 ----------------
t('配平扫描能处理嵌套 issues 数组', () => {
  const text = '前言\n{"score":88,"veto":false,"issues":[{"a":{"b":1}}],"reason":"ok"}\n后记';
  const p = extractBalancedJson(text);
  assert.strictEqual(p.score, 88);
  assert.strictEqual(p.issues.length, 1);
});

t('配平扫描跳过字符串内的花括号', () => {
  const text = '{"score":70,"reason":"contains } brace and { brace"}';
  const p = extractBalancedJson(text);
  assert.strictEqual(p.score, 70);
});

// ---------------- parseReviewResult ----------------
t('fenced JSON 正常解析并带 issues', () => {
  const text = '```json\n{"score":82,"veto":false,"reason":"ok","issues":[{"severity":"minor","description":"x"}]}\n```';
  const r = parseReviewResult(text);
  assert.strictEqual(r.score, 82);
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.issues.length, 1);
  assert.strictEqual(r.parseOk, true);
});

t('fenced 内含裸换行也能解析（实测失败样例）', () => {
  const text = '```json\n' + badJson + '\n```';
  const r = parseReviewResult(text);
  assert.strictEqual(r.score, 76, '应为 76 而不是 0');
  assert.strictEqual(r.parseOk, true);
});

t('无代码块但含 JSON 也能解析', () => {
  const r = parseReviewResult('审核结论如下：\n{"score":90,"veto":false}\n以上。');
  assert.strictEqual(r.score, 90);
});

t('备用抽取支持 "score": 76 形态（旧正则匹配不到）', () => {
  const r = parseReviewResult('我给出 "score": 76 但格式略乱');
  assert.strictEqual(r.score, 76);
  assert.strictEqual(r.parseOk, false, '走备用抽取应标记 parseOk=false（仅表结构未解析）');
  assert.strictEqual(r.scoreSource, 'text', '分数来自文本抽取，但分数本身可用');
  assert.strictEqual(r.scoreOk, true, '抽取到的分数必须能参与投票');
});

t('带引号键名 + 全角冒号也能抽到分数（实测 fece20f3 的 76 分）', () => {
  const r = parseReviewResult('审核结论：「score」：76，理由：逻辑一致性扣分');
  assert.strictEqual(r.score, 76, '不能记成 0');
  assert.strictEqual(r.scoreOk, true);
});

t('彻底解析不出分数时 scoreOk=false（不能当作 0 分投票）', () => {
  const r = parseReviewResult('这份产出物看起来还行。');
  assert.strictEqual(r.scoreOk, false);
  assert.strictEqual(r.scoreSource, 'none');
});

t('备用抽取支持「76 分」自然语言', () => {
  const r = parseReviewResult('综合评价：给 76 分，veto: false');
  assert.strictEqual(r.score, 76);
  assert.strictEqual(r.parseOk, false);
});

t('完全无法解析时 score=0 且 parseOk=false，reason 说明原因', () => {
  const r = parseReviewResult('这份产出物看起来还行。');
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.parseOk, false);
  assert.ok(r.reason.includes('无法解析'), r.reason);
});

t('veto=true 时 passed 必为 false', () => {
  const r = parseReviewResult('{"score":95,"veto":true}');
  assert.strictEqual(r.passed, false);
});

t('阈值可配置', () => {
  assert.strictEqual(parseReviewResult('{"score":75}', { passThreshold: 70 }).passed, true);
  assert.strictEqual(parseReviewResult('{"score":75}', { passThreshold: 80 }).passed, false);
});

// ---------------- 统一投票 ----------------
t('否决优先于分数', () => {
  const v = decideReviewVerdict([
    { score: 92, veto: false, parseOk: true },
    { score: 95, veto: true, parseOk: true },
    { score: 90, veto: false, parseOk: true },
  ]);
  assert.strictEqual(v.passed, false);
  assert.strictEqual(v.verdict, 'failed');
  assert.strictEqual(v.vetoTriggered, true);
});

t('82/80/78 这类分歧应通过（旧全票制会否掉）', () => {
  const v = decideReviewVerdict([
    { score: 82, veto: false, parseOk: true },
    { score: 80, veto: false, parseOk: true },
    { score: 78, veto: false, parseOk: true },
  ]);
  assert.strictEqual(v.passed, true, v.reason);
  assert.strictEqual(v.median, 80);
});

t('中位数低于阈值不通过', () => {
  const v = decideReviewVerdict([
    { score: 60, veto: false, parseOk: true },
    { score: 65, veto: false, parseOk: true },
    { score: 70, veto: false, parseOk: true },
  ]);
  assert.strictEqual(v.passed, false);
  assert.strictEqual(v.verdict, 'failed');
});

t('解析失败不计入有效评分（0/88/0 → inconclusive 放行）', () => {
  const v = decideReviewVerdict([
    { score: 0, veto: false, parseOk: false },
    { score: 88, veto: false, parseOk: true },
    { score: 0, veto: false, parseOk: false },
  ]);
  assert.strictEqual(v.verdict, 'inconclusive');
  assert.strictEqual(v.passed, true, '审核不可用不应判产出物不合格');
  assert.ok(v.reason.includes('有效审核结果不足'));
});

t('有效评分为 0 条时 inconclusive', () => {
  const v = decideReviewVerdict([
    { score: 0, veto: false, parseOk: false },
    { score: 0, veto: false, parseOk: false },
  ]);
  assert.strictEqual(v.verdict, 'inconclusive');
  assert.strictEqual(v.passed, true);
});

t('两条有效评分即可判定（minValid=2）', () => {
  const v = decideReviewVerdict([
    { score: 85, veto: false, parseOk: true },
    { score: 86, veto: false, parseOk: true },
    { score: 0, veto: false, parseOk: false },
  ]);
  assert.strictEqual(v.verdict, 'passed');
});

t('minValid 可配置', () => {
  const results = [
    { score: 85, veto: false, parseOk: true },
    { score: 0, veto: false, parseOk: false },
    { score: 0, veto: false, parseOk: false },
  ];
  assert.strictEqual(decideReviewVerdict(results, { minValid: 2 }).verdict, 'inconclusive');
  assert.strictEqual(decideReviewVerdict(results, { minValid: 1 }).verdict, 'passed');
});

// ---------------- 历史数据回归 ----------------
t('历史数据回归：真实问题仍拦住，正常分歧不再误杀', () => {
  const cases = [
    { scores: [45, 63, 58], vetoes: 1 },
    { scores: [0, 80, 64], vetoes: 0 },
    { scores: [92, 92, 92], vetoes: 0 },
    { scores: [90, 92, 93], vetoes: 0 },
    { scores: [88, 92, 93], vetoes: 0 },
    { scores: [82, 95, 92], vetoes: 0 },
    { scores: [93, 92, 83], vetoes: 0 },
    { scores: [82, 95, 88], vetoes: 0 },
    { scores: [80, 96, 84], vetoes: 0 },
    { scores: [80, 92, 83], vetoes: 0 },
    { scores: [82, 92, 80], vetoes: 0 },
    { scores: [80, 85, 85], vetoes: 0 },
    { scores: [85, 80, 85], vetoes: 0 },
    { scores: [82, 80, 82], vetoes: 0 },
  ];
  const results = cases.map((c) => ({
    scores: c.scores,
    v: decideReviewVerdict(c.scores.map((s, i) => ({ score: s, veto: i === 0 && c.vetoes === 1, parseOk: s > 0 }))),
  }));
  const passed = results.filter((r) => r.v.passed).length;
  // 14 组里有 2 组是真实质量问题（一组触发否决、一组有效分 80/64 中位数 72），必须继续拦住；
  // 其余 12 组是正常通过区间。旧「全票≥80」口径只会放过 8 组。
  assert.strictEqual(passed, 12, `应通过 12 组，实际 ${passed}/${results.length}`);

  const failedSets = results.filter((r) => !r.v.passed).map((r) => r.scores.join(','));
  assert.deepStrictEqual(failedSets.sort(), ['0,80,64', '45,63,58'].sort());
});

t('确实低分的仍不通过（如 55/60/58）', () => {
  const v = decideReviewVerdict([
    { score: 55, veto: false, parseOk: true },
    { score: 60, veto: false, parseOk: true },
    { score: 58, veto: false, parseOk: true },
  ]);
  assert.strictEqual(v.passed, false);
});


t('「扣5分」不会被抓成 5 分（旧逻辑的真实 bug）', () => {
  const text = '{"score":85,"veto":false,"reason":"逻辑一致性扣5分，其余良好"}';
  const r = parseReviewResult(text);
  assert.strictEqual(r.score, 85, '应取 score 字段而不是「扣5分」里的 5');
});

t('JSON 因裸换行损坏时，「扣X分」也不影响取分', () => {
  const text = '```json\n{\n  "score": 85,\n  "reason": "扣5分\n其余良好"\n}\n```';
  const r = parseReviewResult(text);
  assert.strictEqual(r.score, 85, '清洗后应解析出 85');
  assert.strictEqual(r.parseOk, true);
});

t('仅有「扣5分」而无 score 字段时标记 parseOk=false', () => {
  const r = parseReviewResult('这份交付物逻辑一致性扣5分');
  assert.strictEqual(r.parseOk, false, '不应伪装成有效分数');
});

// ---------------- 审核自身失败不参与投票 ----------------
t('isReviewerFailure：error 非空即失败', () => {
  assert.strictEqual(isReviewerFailure({ score: 0, error: 'Gateway timeout' }), true);
  assert.strictEqual(isReviewerFailure({ score: 0, scoreOk: false }), true);
  assert.strictEqual(isReviewerFailure({ score: 0, scoreSource: 'none' }), true);
  // 旧记录兼容：无 scoreSource 字段，靠 parseOk + 0 分判定
  assert.strictEqual(isReviewerFailure({ score: 0, parseOk: false }), true);
});

t('isReviewerFailure：文本抽取到的分数不算失败', () => {
  assert.strictEqual(isReviewerFailure({ score: 76, parseOk: false, scoreSource: 'text', scoreOk: true }), false);
  assert.strictEqual(isReviewerFailure({ score: 85, parseOk: true }), false);
});

t('审核员全挂时不因此判产出物不合格（inconclusive 放行）', () => {
  const v = decideReviewVerdict([
    { score: 0, veto: false, error: 'Gateway timeout', scoreOk: false },
    { score: 0, veto: false, error: 'Gateway timeout', scoreOk: false },
    { score: 0, veto: false, error: 'Gateway timeout', scoreOk: false },
  ]);
  assert.strictEqual(v.verdict, 'inconclusive');
  assert.strictEqual(v.passed, true, '审核不可用不能等同于产出物质量差');
  assert.strictEqual(v.reviewerFailures, 3);
});

t('失败审核员触发的 veto 不计入否决（模型没跑起来，谈不上否决）', () => {
  const v = decideReviewVerdict([
    { score: 0, veto: true, error: 'gateway 500', scoreOk: false },
    { score: 90, veto: false, parseOk: true, scoreOk: true },
    { score: 92, veto: false, parseOk: true, scoreOk: true },
  ]);
  assert.strictEqual(v.vetoTriggered, false);
  assert.strictEqual(v.verdict, 'passed', v.reason);
  assert.strictEqual(v.reviewerFailures, 1);
});

t('一条失败两条有效：按两条有效判定，并记录失败数', () => {
  const v = decideReviewVerdict([
    { score: 0, veto: false, error: 'timeout', scoreOk: false },
    { score: 88, veto: false, parseOk: true, scoreOk: true },
    { score: 76, veto: false, parseOk: true, scoreOk: true },
  ]);
  assert.strictEqual(v.verdict, 'passed', v.reason);
  assert.strictEqual(v.median, 82);
  assert.strictEqual(v.reviewerFailures, 1);
});

t('回归：真实任务 fece20f3（76 被误记 0）修正后应通过', () => {
  // reviewer-1 原文 score=76（JSON 损坏 + 降级正则不匹配 → 旧代码记 0），
  // reviewer-2 给 80，reviewer-3 给 64。76/80/64 中位数 76 < 80 仍不通过，
  // 但至少不会因 0 分被误判成「审核链路故障」。
  const v = decideReviewVerdict([
    { score: 76, veto: false, parseOk: false, scoreSource: 'text', scoreOk: true },
    { score: 80, veto: false, parseOk: true, scoreOk: true },
    { score: 64, veto: false, parseOk: true, scoreOk: true },
  ]);
  assert.strictEqual(v.median, 76);
  assert.strictEqual(v.verdict, 'failed', '76/80/64 是真不达标，应继续拦住');
  assert.strictEqual(v.reviewerFailures, 0, '76 分是有效评分，不能算审核失败');
});


// ---------------- 复合判定：门禁 + 审核（2026-11-12）----------------
const mkRes = (scores, veto = false) => scores.map((s, i) => ({
  reviewerId: `r${i}`, reviewerName: `R${i}`, score: s, veto, passed: s >= 80, scoreOk: true,
}));

t('门禁达标 + 中位数 76（374bc1eb 实况）→ 放行但保留意见', () => {
  const v = decideReviewVerdictWithGate(mkRes([76, 73, 76]), { threshold: 80, softThreshold: 70, gatePassed: true });
  assert.strictEqual(v.passed, true, v.reason);
  assert.strictEqual(v.verdict, 'passed_with_notes');
  assert.ok(v.reason.includes('允许交付'), v.reason);
});

t('门禁达标 + 中位数 62 → 仍判不通过（内容确实差）', () => {
  const v = decideReviewVerdictWithGate(mkRes([62, 65, 60]), { threshold: 80, softThreshold: 70, gatePassed: true });
  assert.strictEqual(v.passed, false, v.reason);
});

t('门禁达标也不能洗白一票否决', () => {
  const v = decideReviewVerdictWithGate(mkRes([62, 65, 60], true), { threshold: 80, softThreshold: 70, gatePassed: true });
  assert.strictEqual(v.passed, false);
  assert.ok(v.reason.includes('门禁已达标，但'), v.reason);
});

t('门禁未达标时行为与旧口径一致（不看软阈值）', () => {
  const v = decideReviewVerdictWithGate(mkRes([76, 73, 76]), { threshold: 80, softThreshold: 70, gatePassed: false });
  assert.strictEqual(v.passed, false, '门禁没过就不该因软阈值放行');
});

t('门禁未达标但审核分很高 → 仍按旧口径通过', () => {
  const v = decideReviewVerdictWithGate(mkRes([85, 86, 84]), { threshold: 80, gatePassed: false });
  assert.strictEqual(v.passed, true);
});

t('门禁达标 + 中位数刚好等于软阈值 → 放行（边界）', () => {
  const v = decideReviewVerdictWithGate(mkRes([70, 70, 71]), { threshold: 80, softThreshold: 70, gatePassed: true });
  assert.strictEqual(v.passed, true, v.reason);
});

t('门禁达标 + 有效评审不足 → 沿用 inconclusive 放行', () => {
  const v = decideReviewVerdictWithGate([
    { reviewerId: 'r0', reviewerName: 'R0', score: 0, veto: false, passed: false, parseOk: false, error: '超时' },
    { reviewerId: 'r1', reviewerName: 'R1', score: 0, veto: false, passed: false, parseOk: false, error: '超时' },
    { reviewerId: 'r2', reviewerName: 'R2', score: 72, veto: false, passed: false, scoreOk: true },
  ], { threshold: 80, softThreshold: 70, gatePassed: true });
  assert.strictEqual(v.passed, true);
  assert.strictEqual(v.verdict, 'inconclusive');
});

t('返回值始终带 gatePassed 标记', () => {
  assert.strictEqual(decideReviewVerdictWithGate(mkRes([76, 73, 76]), { gatePassed: true }).gatePassed, true);
  assert.strictEqual(decideReviewVerdictWithGate(mkRes([76, 73, 76]), { gatePassed: false }).gatePassed, false);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
