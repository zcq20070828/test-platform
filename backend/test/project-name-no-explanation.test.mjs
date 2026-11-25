/**
 * 项目名称不许附带说明（2026-11-25）
 *
 * 用户看到真实交付物文件名：
 *   「托管系统——_来源：输入文档标题「托管系统技术方案」及附件名，未作归纳测试用例.md」
 *
 * 报告里模型的原文是：
 *   项目名称：托管系统（IDaaS 认证服务端）—— 来源：输入文档标题「托管系统技术方案」
 *             及附件名，未作归纳
 *
 * 后半句是模型在解释「这个名字从哪推出来的」，属于说明文字。
 * 但项目名会被用作交付物文件名，于是整串说明进了文件名。
 *
 * 三层修复，本测试覆盖全部三层：
 *   1) 提示词：明确「项目名称一栏只写名称本身，不要附加说明」
 *   2) 提取：stripProjectNameExplanation 剥掉说明尾巴
 *   3) 门禁：projectNameNoExplanation 规则纳入可用率，让这类问题能被拦住
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRulesFor } from '../lib/quality-rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

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

console.log('=== 项目名称不带说明 单元测试 ===');

// ---------------- 提取层 ----------------

function loadNamer() {
  const grab = (n) => {
    const start = SERVER.indexOf(`function ${n}(`);
    assert.ok(start > 0, `找不到 ${n}`);
    const rest = SERVER.slice(start + 10);
    const next = rest.search(/\n(?:async )?function /);
    return SERVER.slice(start, start + 10 + (next > 0 ? next : 4000));
  };
  const code = [
    grab('stripProjectNameExplanation'),
    grab('extractReportProjectName'),
    grab('extractProjectInfo'),
    grab('buildDeliverableBaseName'),
  ].join('\n');
  return new Function(
    `const UNKNOWN_PROJECT_NAME = ${JSON.stringify('不知名项目')};\n${code}\n`
    + 'return { stripProjectNameExplanation, extractReportProjectName, buildDeliverableBaseName };',
  )();
}

const naming = loadNamer();

t('剥掉「—— 来源：…」说明尾巴（真实缺陷样本）', () => {
  const raw = '托管系统（IDaaS 认证服务端）—— 来源：输入文档标题「托管系统技术方案」及附件名，未作归纳';
  const stripped = naming.stripProjectNameExplanation(raw);
  assert.ok(!/来源/.test(stripped), `说明没剥干净：${stripped}`);
  assert.ok(/托管系统/.test(stripped), '项目主干被误删');
});

t('真实缺陷样本生成的文件名不再带说明', () => {
  const content = '## 项目信息\n\n- 项目名称：托管系统（IDaaS 认证服务端）—— 来源：输入文档标题「托管系统技术方案」及附件名，未作归纳\n- 版本号：未提供';
  const base = naming.buildDeliverableBaseName(content, '测试用例');
  assert.ok(!/来源|未作归纳/.test(base), `文件名仍带说明：${base}`);
  assert.ok(base.startsWith('托管系统'), `项目名丢了：${base}`);
  assert.ok(base.endsWith('测试用例'), `交付件类型丢了：${base}`);
});

t('逗号 + 「未作/已按/取自」也截断', () => {
  const r = naming.stripProjectNameExplanation('托管系统，未作归纳');
  assert.strictEqual(r, '托管系统');
  const r2 = naming.stripProjectNameExplanation('灵犀相册；取自需求文档');
  assert.strictEqual(r2, '灵犀相册');
});

t('括号里含「来源」时整个括号去掉', () => {
  const r = naming.stripProjectNameExplanation('灵犀相册（来源：需求文档）');
  assert.ok(!/来源/.test(r), `括号说明没去掉：${r}`);
});

t('干净项目名不受影响', () => {
  for (const v of ['托管系统', '托管系统（IDaaS 认证服务端）', '中国移动云盘算力大作战活动']) {
    const r = naming.stripProjectNameExplanation(v);
    assert.ok(r.includes('托管系统') || r.includes('中国移动'), `误删：${v} → ${r}`);
    assert.ok(!r.includes('来源'), `凭空出现来源：${r}`);
  }
});

t('正常报告的「需求来源：产品需求」不被误伤', () => {
  // 这是关键边界：需求来源是报告的正常字段，不属于项目名说明。
  // stripProjectNameExplanation 只处理**项目名这一行**的内容，
  // 不会去动「需求来源」那一行。
  const content = '## 项目信息\n\n- 项目名称：托管系统\n- 需求来源：产品需求文档\n- 分析范围：功能/接口';
  const base = naming.buildDeliverableBaseName(content, '需求分析报告');
  assert.ok(base.startsWith('托管系统'), `项目名出错：${base}`);
  assert.ok(!/需求来源|产品需求/.test(base), `把需求来源混进文件名：${base}`);
});

// ---------------- 提示词层 ----------------

t('用例生成提示词要求「只写名称本身」', () => {
  const start = SERVER.indexOf("'test-case-generator': `你是测试中台");
  assert.ok(start > 0, '找不到用例生成提示词');
  const block = SERVER.slice(start, start + 20000);
  assert.ok(/项目名称一栏只写名称本身/.test(block), '提示词未禁止附加说明');
  assert.ok(/会被用作交付物文件名/.test(block), '未说明为什么不能带说明');
});

t('用例生成提示词禁止归纳项目名', () => {
  const start = SERVER.indexOf("'test-case-generator': `你是测试中台");
  const block = SERVER.slice(start, start + 20000);
  assert.ok(/严禁自行归纳或编造/.test(block), '未禁止归纳');
});

// ---------------- 门禁层 ----------------

t('门禁规则能拦住带说明的项目名', () => {
  const rules = getRulesFor('test-case-generator');
  assert.ok(rules, 'test-case-generator 没有规则集');
  const rule = rules.find((r) => r.id === 'projectNameNoExplanation');
  assert.ok(rule, '缺少 projectNameNoExplanation 规则');
  assert.strictEqual(rule.check('- 项目名称：托管系统 —— 来源：文档标题'), false, '未拦住');
  assert.strictEqual(rule.check('- 项目名称：托管系统'), true, '误杀干净项目名');
});

t('规则对需求分析等其它交付物同样生效', () => {
  const rule = getRulesFor('test-requirement-analyzer').find((r) => r.id === 'projectNameNoExplanation');
  assert.ok(rule, '需求分析没带上通用规则');
  assert.strictEqual(rule.check('| 项目名称 | 托管系统 —— 来源：x |'), false, '未拦住');
});

t('陌生 agentId 仍返回 null（不破坏「未配置规则」语义）', () => {
  assert.strictEqual(getRulesFor('nonexistent-agent'), null);
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
