#!/usr/bin/env node
/**
 * 意图识别要认得「输入是上游产出物」（2026-11-23）
 *
 * 用户反馈：任务 f9d85b49 被意图识别成「测试需求分析」，但用户是上传了一份
 * 《测试需求分析报告》，想让系统**据此生成用例**。
 *
 * 三个独立缺陷：
 *
 * 1. 【产出物被当成了待处理的需求】
 *    输入是「=== 附件: …测试需求分析报告.docx ===」+ 一份完整的《需求分析报告》
 *    （含功能需求清单 FR-001…、非功能需求、验收标准）。
 *    意图识别看到标题里的「测试需求分析」六个字（权重 3.0），
 *    把任务派给了 test-requirement-analyzer——让它再分析一遍已经分析好的报告，
 *    原地打转，用户白等一轮。
 *
 * 2. 【打分不看频次】
 *    原打分是「命中即 +1，不看出现几次」。13509 字的文档里：
 *      「测试用例」出现 5 次（真正的主题）→ 只算一次命中
 *      「兼容性测试」出现 1 次（顺带一提）→ 也算一次命中
 *    排除需求分析后，首选变成了「兼容性测试」，仍然错。
 *
 * 3. 【长短文档用同一套权重】
 *    一句话指令里出现「接口」几乎必然是主题；14000 字的需求报告里
 *    「接口」出现 23 次是文档结构使然，不代表用户要去做接口测试。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TI = await import(path.join(ROOT, 'backend', 'lib', 'task-intent.js'));

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 识别「输入是上游产出物」 ===');

// 真实输入的缩影（结构与关键词密度与任务 f9d85b49 一致）
const REQUIREMENT_REPORT = [
  '【用户上传的文档内容】',
  '=== 附件: 中国移动云盘“算力大作战”活动V1.0.0测试需求分析报告.docx (docx, 约 6152 token) ===',
  '已完成需求解析。基于解析结果与需求文档全文,生成以下【需求分析报告】。',
  '',
  '# 需求分析报告',
  '',
  '### 项目信息',
  '| 项目项 | 内容 |',
  '| 分析范围 | 功能 / 性能 / 安全 / 接口 |',
  '',
  '### 功能需求清单',
  '| 需求编号 | 需求名称 | 需求描述 | 优先级 | 所属模块 | 可测试性 |',
  '| FR-001 | 活动标题与分享配置 | 活动页顶栏文案 | 高 | 活动页 | 是 |',
  '| FR-002 | 算力值获取 | 用户完成任务获取算力 | 高 | 任务中心 | 是 |',
  '| FR-003 | 奖品兑换 | 使用算力兑换奖品 | 高 | 兑换中心 | 是 |',
  '',
  '### 非功能需求清单',
  '| NFR-001 | 性能 | 页面加载时间 | 3秒内 | 高 |',
  '| NFR-002 | 安全 | 接口鉴权 | 全部接口需鉴权 | 高 |',
  '',
  '### 验收标准',
  '各功能点均需通过测试用例验证，测试用例需覆盖正常与异常场景。',
  '测试用例应包含前置条件、执行步骤与预期结果。',
  '本次测试用例设计需覆盖兼容性测试与安全测试场景。',
].join('\n');

// ---------------- 1. 产出物识别 ----------------
console.log('\n-- 1. 产出物识别 --');

t('★★ 认出输入是《需求分析报告》并排除「需求分析」智能体', () => {
  const excluded = TI.detectUpstreamArtifacts(REQUIREMENT_REPORT);
  assert.ok(excluded.has('test-requirement-analyzer'),
    `没排除 test-requirement-analyzer，实际排除：${[...excluded].join(',') || '(无)'}`);
});

t('★★ 真实任务：不再派给需求分析，改为生成测试用例', () => {
  const r = TI.analyzeTaskIntent(REQUIREMENT_REPORT, {});
  assert.notStrictEqual(r.agentId, 'test-requirement-analyzer',
    `仍派给了需求分析（${r.reason}）`);
  assert.strictEqual(r.agentId, 'test-case-generator',
    `应派给用例生成，实际 ${r.agentId}（${r.agentName}）`);
  assert.strictEqual(r.confident, true, `应能明确识别，实际：${r.reason}`);
});

t('★ 排除原因要写进 reason（用户能看到为什么换了智能体）', () => {
  const r = TI.analyzeTaskIntent(REQUIREMENT_REPORT, {});
  assert.ok(/已完成?的产出物|已排除/.test(r.reason), `reason 没说明排除原因：${r.reason}`);
});

t('「帮我做需求分析」仍是需求分析（不能矫枉过正）', () => {
  const r = TI.analyzeTaskIntent('帮我做个需求分析，这是原始需求：用户要能登录、能下单、能退款', {});
  assert.strictEqual(r.agentId, 'test-requirement-analyzer', `派给了 ${r.agentId}`);
});

t('只有产出方一个候选时不排除（用户可能真想重新分析）', () => {
  // 极简输入：只提到需求分析相关词，且没别的候选
  const r = TI.analyzeTaskIntent('需求分析报告', {});
  // 不强制断言具体智能体，只要求不崩溃、给出候选
  assert.ok(r.candidates.length === 3, '候选不足 3 个');
});

t('测试方案/测试用例集也能被识别为上游产物', () => {
  const scheme = '# 测试方案\n\n## 测试策略\n准入准出标准…\n## 测试资源\n人力与环境\n## 测试范围\n功能与接口';
  assert.ok(TI.detectUpstreamArtifacts(scheme).has('test-scheme-generator'), '没认出测试方案');

  const caseSet = '# 测试用例集\n\n| 用例编号 | 用例名称 | 执行步骤 | 预期结果 |\n| TC-001 | 登录 | 1.输入 | 返回200 |';
  assert.ok(TI.detectUpstreamArtifacts(caseSet).has('test-case-generator'), '没认出测试用例集');
});

// ---------------- 2. 频次加权 ----------------
console.log('\n-- 2. 频次加权 --');

t('★★ 反复出现的词权重高于只提一次的', () => {
  // 造一份文档：「测试用例」出现 6 次，「兼容性测试」1 次
  const doc = '请基于以下内容工作。' + '测试用例'.repeat(6) + '本次涉及兼容性测试。';
  const ranked = TI.scoreAgents(doc);
  const caseGen = ranked.find((r) => r.agent === 'test-case-generator');
  const compat = ranked.find((r) => r.agent === 'compatibility-coordinator');
  assert.ok(caseGen && compat, '两个候选都应命中');
  assert.ok(caseGen.score > compat.score,
    `用例生成 ${caseGen.score.toFixed(2)} 未高于兼容性 ${compat.score.toFixed(2)}`);
});

t('★ 频次用对数饱和，不做线性累加（否则「接口」出现 23 次会独占）', () => {
  const many = '接口'.repeat(30);
  const ranked = TI.scoreAgents(`测试接口相关工作 ${many}`);
  const api = ranked.find((r) => r.agent === 'api-executor');
  assert.ok(api, '接口测试应命中');
  // 线性累加会到 0.8*30=24 以上；饱和后应明显低于此
  assert.ok(api.score < 6, `频次权重未饱和，得分 ${api.score.toFixed(2)}，线性累加失控`);
});

t('★ hits 里带上频次（便于排查「为什么选它」）', () => {
  const ranked = TI.scoreAgents('测试用例测试用例测试用例');
  const caseGen = ranked.find((r) => r.agent === 'test-case-generator');
  assert.ok(caseGen, '用例生成应命中');
  assert.ok(caseGen.hits.some((h) => /×\d+/.test(h)), `hits 没带频次：${caseGen.hits.join(',')}`);
});

// ---------------- 3. 长短文档区分 ----------------
console.log('\n-- 3. 长短文档区分 --');

t('★ 长文档里短词降权（减少「顺手一提」干扰）', () => {
  // 短指令里「接口」是主题；长文档里它常是结构词
  const short = TI.scoreAgents('帮我做接口测试');
  const shortApi = short.find((r) => r.agent === 'api-executor');

  const longDoc = '需求文档。'.repeat(500) + '本次需要做接口测试。';
  const longRanked = TI.scoreAgents(longDoc);
  const longApi = longRanked.find((r) => r.agent === 'api-executor');

  assert.ok(shortApi && longApi, '两处都应命中接口测试');
  // 长文档里同样的词，单位权重应更低（用「单次命中得分」比较）
  assert.ok(longApi.score < shortApi.score * 2,
    `长文档未降权：短 ${shortApi.score.toFixed(2)} vs 长 ${longApi.score.toFixed(2)}`);
});

// ---------------- 4. 短指令行为不变 ----------------
console.log('\n-- 4. 短指令行为没有回归 --');

t('★★ 一句话指令的识别结果与修复前一致', () => {
  const cases = [
    ['帮我给这个登录功能设计测试用例', 'test-case-generator'],
    ['对这个系统做接口测试', 'api-executor'],
    ['给 AI 助手做测试，检查幻觉和提示注入', 'ai-app-tester'],
    ['压测一下下单接口，看 TPS', 'performance-tester'],
    ['扫一下有没有 SQL 注入漏洞', 'security-sentinel'],
    ['整理一份测试报告', 'test-reporter'],
  ];
  for (const [input, expected] of cases) {
    const r = TI.analyzeTaskIntent(input, {});
    assert.strictEqual(r.confident, true, `「${input}」应明确识别：${r.reason}`);
    assert.strictEqual(r.agentId, expected, `「${input}」派给了 ${r.agentId}`);
  }
});

t('★ 含糊指令仍不自动定性（该问还得问）', () => {
  for (const s of ['这个功能还有什么没考虑到的', '帮我测试一下系统', '看看这个接口有没有问题']) {
    assert.strictEqual(TI.analyzeTaskIntent(s, {}).confident, false, `「${s}」不该自动定性`);
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
