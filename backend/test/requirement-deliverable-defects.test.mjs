/**
 * 需求分析交付物的三个真实缺陷（2026-11-25）
 *
 * 用户在 dev 实测一个任务（输入「你好」，任务 20a2b068）后发现三处问题。
 * 每个都对应真实故障，不是假设：
 *
 * 1. **编造项目名**：输入只是功能描述，模型归纳出「用户登录功能」当项目名，
 *    看起来像真的。用户明确要求：「从输入内容、输入文档名称、输入文档的内容
 *    都得不到项目名称的时候用『不知名项目』都好过编项目名称」。
 *
 * 2. **占位说明进了文件名**：模型在正文写
 *    「项目名称 | 待补充（原始输入无项目名称信息）」，文件名于是变成
 *    「待补充（原始输入无项目名称信息）需求分析报告.md」
 *    ——把「没有项目名」这件事当成了名字。
 *
 * 3. **工具内部信息泄露**：正文第一段是
 *    「requirement_parser 对输入文本(sourceLength = 45 字符)的解析结果为
 *     modules / functionalPoints / acceptanceCriteria / priority / edgeCases 全部为空」
 *    普通用户看不懂，也不该看到系统内部实现。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRulesFor } from '../lib/quality-rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

/**
 * 把三个文件名相关函数抽出来在沙箱里跑
 *
 * 为什么要抽而不是直接调：它们在 server.js 里，而 server.js 一加载就会起服务。
 * 抽取时用「下一个顶层 function」做边界，避免把相邻逻辑一起带进来。
 */
function loadNamingFunctions() {
  const grab = (name) => {
    const start = SERVER.indexOf(`function ${name}(`);
    assert.ok(start > 0, `找不到 ${name}`);
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
    + 'return { extractReportProjectName, buildDeliverableBaseName };',
  )();
}

const naming = loadNamingFunctions();

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

console.log('=== 需求分析交付物缺陷 单元测试 ===');

// ---------------- 缺陷 2：占位说明不能进文件名 ----------------

t('「待补充（原始输入无项目名称信息）」不被当成项目名（真实缺陷样本）', () => {
  const content = '| 项目名称 | 待补充（原始输入无项目名称信息） |\n';
  assert.strictEqual(naming.extractReportProjectName(content), '',
    '占位说明仍被抽成项目名，文件名会变成「待补充（…）需求分析报告」');
});

t('占位说明的任务文件名用「不知名项目」', () => {
  const content = '| 项目名称 | 待补充（原始输入无项目名称信息） |\n';
  const base = naming.buildDeliverableBaseName(content, '需求分析报告');
  assert.strictEqual(base, '不知名项目需求分析报告');
});

t('各种占位措辞都不算项目名', () => {
  for (const v of ['待定', '未知', '未提供', '暂无', '待确认', '不详']) {
    const content = `| 项目名称 | ${v} |\n`;
    assert.strictEqual(naming.extractReportProjectName(content), '', `「${v}」被当成项目名`);
    assert.strictEqual(
      naming.buildDeliverableBaseName(content, '报告'),
      '不知名项目报告',
      `「${v}」没有退化成不知名项目`,
    );
  }
});

t('四条显式标签路径都过校验（原实现直接 return 绕过了校验）', () => {
  // 这是缺陷根因：表格 / plain / bullet / linePair 四条路径原先各自
  // `return clean(...)`，完全没调 looksLikeProjectName
  const paths = [
    '| 项目名称 | 待补充 |',
    '项目名称：待补充',
    '- **项目名称**：待补充',
    '项目名称\n\n待补充\n',
  ];
  for (const p of paths) {
    assert.strictEqual(naming.extractReportProjectName(p), '',
      `路径未被校验：${JSON.stringify(p.slice(0, 20))}`);
  }
});

t('真实项目名仍然正常保留（不误杀）', () => {
  const cases = [
    ['| 项目名称 | 中国移动云盘算力大作战活动 |', '中国移动云盘算力大作战活动'],
    ['项目名称：托管系统', '托管系统'],
    ['- **项目名称**：灵犀相册整理', '灵犀相册整理'],
  ];
  for (const [content, expect] of cases) {
    assert.strictEqual(naming.extractReportProjectName(content), expect, `误杀：${content}`);
  }
});

// ---------------- 无项目名时的兜底 ----------------

t('完全取不到项目名 → 用「不知名项目」而不是丢掉项目名栏位', () => {
  const content = '# 需求分析报告\n\n### 功能需求清单\n| 需求编号 |\n|---|\n| FR-001 |';
  const base = naming.buildDeliverableBaseName(content, '需求分析报告');
  assert.ok(base.startsWith('不知名项目'), `实际：${base}`);
  assert.ok(/需求分析报告$/.test(base), `交付件类型丢了：${base}`);
});

t('有版本号时保留版本号', () => {
  const content = '| 项目名称 | 待补充 |\n| 版本号 | V2.1 |\n';
  const base = naming.buildDeliverableBaseName(content, '需求分析报告');
  assert.strictEqual(base, '不知名项目V2.1需求分析报告');
});

// ---------------- 缺陷 3：工具内部信息泄露 ----------------

t('正文泄露 requirement_parser → 规则拦截', () => {
  const rule = getRulesFor('test-requirement-analyzer').find((r) => r.id === 'noToolLeak');
  assert.ok(rule, '缺少 noToolLeak 规则');
  const leak = '> 解析说明:requirement_parser 对输入文本(sourceLength = 45 字符)的解析结果为 modules 全部为空';
  assert.strictEqual(rule.check(leak), false, '未拦住工具名泄露');
});

t('泄露源长度 / success= / tool= 也拦', () => {
  const rule = getRulesFor('test-requirement-analyzer').find((r) => r.id === 'noToolLeak');
  for (const leak of ['sourceLength = 45', 'success=true，tool=requirement-parser', 'tool=xxx']) {
    assert.strictEqual(rule.check(leak), false, `未拦住：${leak}`);
  }
});

t('返回字段成对出现才算泄露（单个 priority 是正常业务词）', () => {
  const rule = getRulesFor('test-requirement-analyzer').find((r) => r.id === 'noToolLeak');
  // 单个 business 词不该误杀
  assert.strictEqual(rule.check('| 需求编号 | 需求名称 | 优先级 |'), true, '误杀：普通优先级表头');
  // 两个以上返回字段同时出现 → 是泄漏
  assert.strictEqual(rule.check('返回 functionalPoints 与 acceptanceCriteria 均为空'), false,
    '两个返回字段同时出现却没判');
});

t('干净交付物不被误杀', () => {
  const rule = getRulesFor('test-requirement-analyzer').find((r) => r.id === 'noToolLeak');
  const clean = '# 需求分析报告\n\n### 项目信息\n- 项目名称:不知名项目\n- 版本号:未提供\n\n'
    + '### 功能需求清单\n| 需求编号 | 需求名称 | 优先级 |\n|---|---|---|\n| FR-001 | 登录 | 高 |\n';
  assert.strictEqual(rule.check(clean), true, '干净交付物被误杀');
});

t('提示词里写明禁止泄露工具内部信息', () => {
  assert.ok(/严禁泄露工具内部信息/.test(SERVER), '提示词缺少禁止泄露条款');
  assert.ok(/不得出现.*requirement_parser/s.test(SERVER), '未点名禁止出现的工具名');
  assert.ok(/用业务语言写/.test(SERVER), '没给出替代写法，模型不知道该怎么说');
});

t('noLeakRule 真的拼进了提示词', () => {
  assert.ok(/if \(skillsConfig\.noLeakRule\)/.test(SERVER),
    'noLeakRule 定义了但没拼进 prompt，模型看不到');
});

// ---------------- 缺陷 1：项目名铁律 ----------------

t('提示词禁止归纳项目名，取不到用「不知名项目」', () => {
  const start = SERVER.indexOf("'test-requirement-analyzer': `你是测试中台");
  assert.ok(start > 0, '找不到需求分析提示词');
  const block = SERVER.slice(start, start + 3000);
  assert.ok(/项目名称铁律/.test(block), '缺少项目名铁律条款');
  assert.ok(/不知名项目/.test(block), '未指定兜底名称');
  assert.ok(/严禁自行归纳或编造/.test(block), '未禁止编造');
  assert.ok(/字面出现/.test(block), '未说明「必须字面出现」这个判据');
});

t('铁律给出了反例（避免模型以为归纳可以）', () => {
  const start = SERVER.indexOf("'test-requirement-analyzer': `你是测试中台");
  const block = SERVER.slice(start, start + 3000);
  assert.ok(/反例/.test(block), '缺少反例，模型可能仍会归纳');
  assert.ok(/用户登录功能/.test(block), '反例应点名真实被编造的那个名字');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
