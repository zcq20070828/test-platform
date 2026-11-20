#!/usr/bin/env node
/**
 * 黑盒9法设计输入推导（2026-11-20）
 *
 * 用户要求：「继续检查，看可用率、九维覆盖、测试用例设计9大法覆盖还能不能提升」。
 *
 * 改造前实测三项：
 *   黑盒9法 只启用 6~7/9 —— 因果图法、判定表法、功能图法、状态迁移法长期 skipped
 * 原因：它们要求 designInput.rules / functions / states 由**模型**在调用工具时
 * 显式构造，而模型不会凭空编造业务规则（这是对的，编造才是问题）。
 *
 * 但需求文档里本来就有这些结构，是确定性可解析的：
 *   「若…则…」「…时…」「未…」        → 因果规则
 *   「登录→校验→领取→抽奖」            → 功能节点与依赖
 *   「【已预定】>【已完成】」「变为」    → 状态与迁移
 * 抽不出来时保持 skipped（如实标注比假覆盖好）。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'backend', 'server.js'));
const D = require(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', 'design-input-derive.js'));
const invoker = require(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', '9dem-invoker.js'));

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

const DOC = [
  '登录功能：用户输入手机号与验证码，若手机号格式不正确则提示格式错误；若验证码错误则提示验证码不正确；若连续5次输错密码则锁定账号30分钟。',
  '业务流程：登录→白名单校验→任务列表→领取任务→抽奖→排行榜→发放奖品。',
  '账号状态：正常/锁定/注销。当锁定到期则从锁定变为正常；当用户注销则从正常变为注销。',
].join('\n');

console.log('=== 黑盒9法设计输入推导 ===');

t('从「若…则…」抽出因果规则', () => {
  const r = D.deriveRules(DOC);
  assert.ok(r.rules.length >= 3, `只抽出 ${r.rules.length} 条规则`);
  assert.ok(r.causes.length >= 3 && r.effects.length >= 3, 'causes/effects 不完整');
  const first = r.rules[0];
  assert.ok(first.conditions && first.actions, '规则缺少 conditions/actions');
  assert.ok(first.expect, '规则缺少 expect（结果描述）');
});

t('从箭头链抽出功能节点与依赖', () => {
  const f = D.deriveFunctions(DOC);
  assert.ok(f.length >= 5, `只抽出 ${f.length} 个功能节点`);
  assert.ok(f.some((x) => x.dependsOn.length > 0), '没有依赖关系（功能图法需要）');
  assert.ok(f.some((x) => x.preconditions.length > 0), '没有前置条件');
});

t('箭头链不被误当成状态迁移（那是业务流程）', () => {
  const s = D.deriveStates(DOC);
  // 「登录→白名单校验」是流程，不是状态迁移
  const bogus = s.transitions.filter((x) => /登录|白名单|任务列表/.test(x.from) || /登录|白名单|任务列表/.test(x.to));
  assert.strictEqual(bogus.length, 0, `箭头链被误判为状态迁移：${JSON.stringify(bogus)}`);
  // 「锁定变为正常」是真的状态迁移
  assert.ok(s.transitions.some((x) => x.from === '锁定' && x.to === '正常'),
    `没抽到「锁定→正常」，实际：${JSON.stringify(s.transitions)}`);
});

t('从箭头链抽出场景（基本流 + 备选流 + 异常流）', () => {
  const sc = D.deriveScenarios(DOC);
  assert.ok(sc.length >= 2, `只抽出 ${sc.length} 个场景`);
  assert.ok(sc.some((x) => x.type === 'basic'), '缺少基本流');
  assert.ok(sc.some((x) => x.type === 'exception' || x.type === 'alternative'), '缺少备选/异常流');
});

t('正交因子从枚举字段推导，不足 2 个时用环境因子补齐', () => {
  const f1 = D.deriveFactors({ a: { type: 'enum', values: ['x', 'y'] }, b: { type: 'boolean' } });
  assert.ok(Object.keys(f1).length >= 2, '枚举字段未推导为因子');
  const f2 = D.deriveFactors({});
  assert.ok(Object.keys(f2).length >= 2, '空 spec 未补齐环境因子');
});

// ---------------- Markdown 表格预处理 ----------------
t('Markdown 表格先拍平，不把 | 和 □已覆盖 当业务内容', () => {
  const md = [
    '| 需求编号 | 需求描述 | 可测试性 |',
    '|---|---|---|',
    '| FR-008 | 非白名单登录提示活动暂未开启 | ☑是 □否 |',
  ].join('\n');
  const s = D.deriveStates(md);
  for (const st of s.states) {
    assert.ok(!/[|□☑☐]/.test(st), `状态里混入表格符号：${st}`);
  }
  // 文档标题类词不能被当状态
  const s2 = D.deriveStates('| 状态优先级及流转 | 说明 |\n|---|---|');
  assert.ok(!s2.states.some((x) => /文档|报告|章节|说明/.test(x)), `标题被当状态：${s2.states}`);
});

// ---------------- 端到端：9 法全启用 ----------------
t('真实需求（无 designInput）也能启用 9/9 方法', () => {
  // 同步跑 invoker 不方便（异步），改为验证 deriveDesignInput 覆盖了所有缺失项
  const d = D.deriveDesignInput(DOC, { inputSpec: {
    phone: { type: 'string', minLength: 11, maxLength: 11 },
    code: { type: 'string', minLength: 6, maxLength: 6 },
    status: { type: 'enum', values: ['正常', '锁定'] },
    channel: { type: 'enum', values: ['APP', 'WEB'] },
  } });
  assert.ok(Array.isArray(d.input.rules) && d.input.rules.length, '未补齐 rules');
  assert.ok(Array.isArray(d.input.functions) && d.input.functions.length, '未补齐 functions');
  assert.ok(Array.isArray(d.input.scenarios) && d.input.scenarios.length, '未补齐 scenarios');
  assert.ok(d.input.factors && Object.keys(d.input.factors).length >= 2, '未补齐 factors');
  assert.ok(Array.isArray(d.input.states) && d.input.states.length >= 2, '未补齐 states');
  assert.ok(d.derived.length >= 4, `推导项过少：${d.derived}`);
});

t('已有的设计输入一律不被覆盖（模型给的优先）', () => {
  const own = {
    rules: [{ id: 'RX', conditions: { CX: true }, actions: { EX: true } }],
    functions: [{ id: 'FX', name: '模型给的', preconditions: [], postconditions: [], dependsOn: [] }],
    states: ['模型态A', '模型态B'],
  };
  const d = D.deriveDesignInput(DOC, own);
  assert.strictEqual(d.input.rules.length, 1, '覆盖了模型给的 rules');
  assert.strictEqual(d.input.rules[0].id, 'RX', 'rules 内容被替换');
  assert.strictEqual(d.input.functions[0].name, '模型给的', 'functions 被替换');
  assert.deepStrictEqual(d.input.states, ['模型态A', '模型态B'], 'states 被替换');
});

t('invoker 已接入推导，并在 summary 里暴露推导项', () => {
  const src = fs.readFileSync(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', '9dem-invoker.js'), 'utf8');
  assert.ok(/deriveDesignInput/.test(src), 'invoker 未引入推导');
  assert.ok(/derivedDesignInput: derivedInfo/.test(src), 'summary 未暴露推导项');
  // derivedInfo 必须声明在 includeDesignCases 之外，否则 return 时 ReferenceError
  const declIdx = src.indexOf('let derivedInfo = []');
  const ifIdx = src.indexOf('if (includeDesignCases)');
  assert.ok(declIdx > 0 && ifIdx > 0 && declIdx < ifIdx,
    'derivedInfo 必须声明在 if(includeDesignCases) 之前（否则 return 时 ReferenceError）');
});

// ---------------- 特殊字符输入不能破坏 Markdown 表格 ----------------
t('错误推测法的特殊字符输入不含 |（会切断表格单元格）', () => {
  const dm = require(path.join(ROOT, 'qclaw-skills', '9dem-executor', 'backend', 'design-methods.js'));
  const r = dm.executeDesignMethods({ input: { inputSpec: { phone: { type: 'string' } } }, methods: ['errorGuessing'] });
  const special = (r.cases || []).filter((c) => /特殊字符/.test(c.name));
  assert.ok(special.length > 0, '没有生成特殊字符用例');
  for (const c of special) {
    assert.ok(!/\|/.test(String(c.input || '')), `输入含竖线会切断表格：${c.input}`);
    assert.ok(!/[\r\n]/.test(String(c.input || '')), '输入含换行会切断表格行');
  }
});

// ---------------- 空输入数据按用例名补全 ----------------
t('输入列为空时按用例名里的长度补出输入（且长度精确）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  assert.ok(/function fillEmptyInputFromName/.test(src), '缺少 fillEmptyInputFromName');
  assert.ok(/InputFill/.test(src), '没有接入门禁循环');

  function extractFn(name) {
    const start = src.indexOf(`function ${name}(`);
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    return src.slice(start, end + 1);
  }
  const gate = require(path.join(ROOT, 'backend', 'lib', 'case-quality-gate.js'));
  const fill = new Function('repairPlaceholderInput',
    `${extractFn('fillEmptyInputFromName')}; return fillEmptyInputFromName;`)(gate.repairPlaceholderInput);

  const md = [
    '| 用例编号 | 所属模块 | 用例名称 | 维度 | 层级 | 前置条件 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|---|---|',
    '| TC-050 | 登录 | 边界值-loginType-maxLength+1(256字符) | ② 数据 | 异常 | x |  | 1. 输入 2. 提交 | 返回400 |',
    '| TC-051 | 登录 | 边界值-phone-minLength(11字符) | ② 数据 | 边界 | x |  | 1. 输入 2. 提交 | 返回200 |',
  ].join('\n');
  const out = fill(md);
  assert.strictEqual(out.rowsFilled, 2, `只补了 ${out.rowsFilled} 行`);
  // 长度必须精确（断言「256 字符会怎样」，值短了等于没测到边界）
  const m256 = out.text.match(/loginType="([^"]*)"/);
  assert.ok(m256 && m256[1].length === 256, `loginType 长度 ${m256 ? m256[1].length : 'n/a'}，应为 256`);
  // 已知语义字段用真实值
  assert.ok(/phone="13800138000"/.test(out.text), '手机号未用真实值');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
