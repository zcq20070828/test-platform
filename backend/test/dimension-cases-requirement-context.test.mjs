/**
 * 九维必测点用例要落到需求上下文（2026-11-26）
 *
 * 真实故障：任务 7fd39497（托管系统需求）交付物 229 行，其中 **200 行**
 * 来自 9dem_executor 的 dimensionCases 模板，不是模型写的。审核判 36 分 + 一票否决，
 * 理由逐条对得上：
 *   · 「全表成功码写 code=0，与需求唯一成功码 103000 冲突」——101 行
 *   · 「步骤不可照做」——196 行都是「触发对应操作并观察接口响应与页面反馈」
 *   · 「0~255 长度与 C1~C16 因果规则均为需求外编造」
 * 审核原话点破了根因：「系统检查仅核结构」。
 *
 * 根因在探针断言里：42 个探针有 32 个写死了 HTTP 状态码/业务码，
 * 连「长度需在 6-32 位之间」这种具体区间都是编的。模板对任何需求都一样，
 * 所以必然与真实需求冲突。
 *
 * 修法：把需求原文提取成上下文（成功码/错误码/接口/状态/字段约束），
 * 用它替换断言与步骤里的硬编码；**查不到就降级成中性表述，绝不填默认值**。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(here, '..');
const SKILL = path.join(BACKEND, '..', 'qclaw-skills', '9dem-executor', 'backend');

const ctxMod = require(path.join(SKILL, 'requirement-context.js'));
const casesMod = require(path.join(SKILL, 'dimension-cases.js'));

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

console.log('=== 九维必测点接需求上下文 单元测试 ===');

// 托管系统需求的关键片段（摘自真实任务 7fd39497 的输入）
const REQ = `
## 一、项目信息
| 项目名称 | 托管系统技术方案 |

## 二、功能需求清单
| FR-001 | 预凭证接口（/custody/preAuth） | 必填 clawUid、skillId、devId、sign | ①无绑定记录：resultCode="103000"、data.authPageUrl 非空 |
| FR-002 | 凭证校验接口（/custody/validate） | 必填 creditToken、sign | ①有效 creditToken：resultcode="103000" |
| FR-006 | 短信下发接口（/custody/smsSend） | 必填 loginName、sign | ①成功：resultcode="103000"、resultDesc="成功" ②手机号不合法：原文码表 103308 |
| FR-005 | 凭证解绑接口（/custody/unbinding） | 按 clawUid 检索 uid_binding | ①入访 IP 不在白名单：原文 130059 ②成功：resultcode="103000" |

返回码表 14 行：103000＝成功；103308＝手机号不合法；130059＝IP白名单校验失败；105121＝时间格式错误
`;

t('成功码从需求提取到 103000（而不是默认 0）', () => {
  const c = ctxMod.extractSuccessCode(REQ);
  assert.ok(c, '未提取到成功码');
  assert.strictEqual(c.code, '103000', `提取到 ${c.code}`);
});

t('错误码从码表提取（排除 HTTP 状态码）', () => {
  const codes = ctxMod.extractErrorCodes(REQ);
  assert.ok(codes.includes('103308'), `缺 103308，实际 ${codes.join(',')}`);
  assert.ok(codes.includes('130059'), `缺 130059`);
  assert.ok(!codes.includes('200'), 'HTTP 200 被误当业务错误码');
});

t('接口定义提取（含方法缺失时）', () => {
  const eps = ctxMod.extractEndpoints(REQ);
  const paths = eps.map((e) => e.path);
  assert.ok(paths.includes('/custody/preAuth'), `缺 preAuth，实际 ${paths.join(',')}`);
  assert.ok(paths.includes('/custody/smsSend'), `缺 smsSend`);
});

t('需求没写成功码时不编造（返回 null）', () => {
  const c = ctxMod.extractSuccessCode('用户登录后可以提交工单，填写标题和描述。');
  assert.strictEqual(c, null, '没有依据却返回了成功码');
});

t('code=0 被换成需求真值（真实故障形态）', () => {
  const ctx = ctxMod.deriveRequirementContext(REQ);
  const out = casesMod.adaptAssertion('接口返回 HTTP 200，响应体 code=0，数据库新增 1 条记录', ctx);
  assert.ok(!/code\s*=\s*0/.test(out), `仍含 code=0：${out}`);
  assert.ok(out.includes('103000'), `未换成真值：${out}`);
});

t('需求无成功码时 code=0 降级为中性表述（不填默认值）', () => {
  const ctx = ctxMod.deriveRequirementContext('一个没有定义任何返回码的需求文档，只描述业务流程。');
  const out = casesMod.adaptAssertion('核心操作返回业务成功码 code=0', ctx);
  assert.ok(!/code\s*=\s*0/.test(out), `仍含 code=0：${out}`);
  assert.ok(!/\b0\b/.test(out.replace(/[^\d]/g, '|')), '降级后仍出现裸 0');
  assert.ok(/业务成功码/.test(out), `未保留语义：${out}`);
});

t('「长度需在 6-32 位之间」在需求无此区间时被降级（真实编造）', () => {
  const ctx = ctxMod.deriveRequirementContext(REQ);
  const out = casesMod.adaptAssertion(
    '最小长度与最大长度返回 200；最小长度-1 与最大长度+1 返回 400，提示「长度需在 6-32 位之间」',
    ctx,
  );
  assert.ok(!/6-32/.test(out), `6-32 残留：${out}`);
  assert.ok(/以需求为准/.test(out), `未降级：${out}`);
});

t('需求真写了区间则保留', () => {
  const ctx = ctxMod.deriveRequirementContext('密码字段 6-32 位，超出提示「长度需在 6-32 位之间」。');
  const out = casesMod.adaptAssertion('返回 400，提示「长度需在 6-32 位之间」', ctx);
  assert.ok(/6-32/.test(out), `有依据的区间被误删：${out}`);
});

t('「触发对应操作」落到真实接口（审核原话：步骤不可照做）', () => {
  const ctx = ctxMod.deriveRequirementContext(REQ);
  const probe = { title: '合法登录态下的主流程可用', action: '访问该功能主页并完成一次核心操作' };
  const steps = '1. 访问该功能主页\n2. 触发对应操作并观察接口响应与页面反馈\n3. 核对落库';
  const out = casesMod.adaptSteps(steps, probe, ctx, '托管系统');
  assert.ok(!/触发对应操作/.test(out), `仍是空话：${out}`);
  assert.ok(/\/custody\//.test(out), `未落到真实接口：${out}`);
});

t('需求无接口定义时步骤也不留空话', () => {
  const ctx = ctxMod.deriveRequirementContext('纯业务流程需求，没有任何接口路径描述。');
  const probe = { title: 'x', action: 'y' };
  const out = casesMod.adaptSteps('2. 触发对应操作并观察接口响应与页面反馈', probe, ctx, '工单系统');
  assert.ok(!/触发对应操作/.test(out), `仍残留：${out}`);
});

t('写死的终态「已完成」在需求无状态机时降级', () => {
  const ctx = ctxMod.deriveRequirementContext(REQ);
  const out = casesMod.adaptAssertion('流程结束时状态变为「已完成」，数据库状态字段值为 completed', ctx);
  assert.ok(!/已完成/.test(out), `终态仍写死：${out}`);
  assert.ok(!/completed/.test(out), `completed 仍写死：${out}`);
});

t('需求真有状态机时用需求的状态值', () => {
  const ctx = ctxMod.deriveRequirementContext('工单提交后为待处理，客服领取后变为处理中，处理完成变为已解决。');
  assert.ok(ctx.stateValues.length >= 2, `未提取到状态机，实际 ${JSON.stringify(ctx.stateValues)}`);
  const out = casesMod.adaptAssertion('流程结束时状态变为「已完成」', ctx);
  assert.ok(!/已完成/.test(out), `未替换：${out}`);
});

t('状态值提取不吃流程叙述噪声（两轮都踩过）', () => {
  // 第一轮：业务服务端→IDaaS 被当成状态
  // 第二轮：「约束…状态 重放判定」被当成状态
  const noisy = '业务服务端→IDaaS 调用；timestamp 防重放：重放请求拒绝 状态 重放判定（待 CL-018）';
  const vals = ctxMod.extractStateValues(noisy);
  assert.ok(!vals.includes('业务服务端'), `把角色当状态：${vals.join(',')}`);
  assert.ok(!vals.includes('重放判定'), `把约束名词当状态：${vals.join(',')}`);
});

t('generateDimensionCases 全量不再产出 code=0（真实故障形态）', () => {
  const gen = casesMod.generateDimensionCases({ task: REQ, module: '托管系统' });
  assert.ok(gen.cases.length > 0, '没生成用例');
  const bad = gen.cases.filter((c) => /code\s*=\s*0/.test(c.expected));
  assert.strictEqual(bad.length, 0, `${bad.length} 条仍含 code=0`);
  const withReal = gen.cases.filter((c) => c.expected.includes('103000'));
  assert.ok(withReal.length > 0, '没有任何断言用上需求的成功码');
});

t('generateDimensionCases 步骤不再出现「触发对应操作」', () => {
  const gen = casesMod.generateDimensionCases({ task: REQ, module: '托管系统' });
  const bad = gen.cases.filter((c) => /触发对应操作/.test(c.steps));
  assert.strictEqual(bad.length, 0, `${bad.length} 条仍是空话步骤`);
  const withEp = gen.cases.filter((c) => /\/custody\//.test(c.steps));
  assert.ok(withEp.length > 0, '步骤未落到真实接口');
});

t('不传需求上下文时也不崩（降级路径）', () => {
  const gen = casesMod.generateDimensionCases({ task: '', module: '某系统' });
  assert.ok(Array.isArray(gen.cases), '返回值不是数组');
  assert.ok(gen.cases.length > 0, '没有兜底生成');
});

t('被测对象名不吃文档包裹标记', () => {
  const gen = casesMod.generateDimensionCases({
    task: '【用户上传的文档内容】\n=== 附件: 托管系统需求分析报告.docx ===\n# 需求分析报告',
  });
  assert.ok(!/用户上传的文档内容/.test(gen.stats.target), `把标记当成了被测对象：${gen.stats.target}`);
});

t('服务端在调用 9dem-executor 前注入需求上下文', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  assert.ok(/skillId === '9dem-executor' && !a\.requirementContext/.test(server),
    '未注入 requirementContext');
  assert.ok(/deriveRequirementContext/.test(server), '未调用提取器');
  assert.ok(/ctxMod\.default \|\| ctxMod/.test(server), 'CJS 模块未从 default 取函数');
});

t('执行器把 requirementContext 透传给生成器', () => {
  const invoker = fs.readFileSync(path.join(SKILL, '9dem-invoker.js'), 'utf8');
  assert.ok(/requirementContext/.test(invoker), 'invoker 未接收 requirementContext');
  assert.ok(/generateDimensionCases\(\{[\s\S]{0,400}requirementContext/.test(invoker),
    '未把它传给 generateDimensionCases');
});

// ── 第二条根因：design.cases 落地路径 ──
//
// 只改 dimensionCases 是不够的。实测第二轮任务 3e22b7ce 才发现：
// 交付物里 79 处 code=0 和 196 处「触发对应操作」来自**另一条路** ——
// 服务端 buildDesignCasesMarkdown 把 design.cases 落成 DC-### 行时，
// steps 为空就补那句空话，strengthenAssertion 补的判定条件里写死 code=0。
t('strengthenAssertion 不再硬编码 code=0', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  // 只看代码行，注释里记录「这里曾经硬编码 code=0」是应该保留的
  const code = server
    .split('\n')
    .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.ok(!/业务成功码 code=0/.test(code), '仍硬编码「业务成功码 code=0」');
  assert.ok(!/业务失败码 code≠0/.test(code), '仍硬编码「业务失败码 code≠0」');
  assert.ok(/successHint/.test(code), '未按需求上下文生成成功码提示');
});

t('strengthenAssertion 用需求真值（行为验证）', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  const start = server.indexOf('function strengthenAssertion(');
  assert.ok(start > 0, '找不到 strengthenAssertion');
  const body = server.slice(start, start + 2600);
  assert.ok(/reqCtx\.successCode|reqCtx && reqCtx\.successCode/.test(body), '未读 successCode');
  assert.ok(/业务成功码/.test(body), '降级路径缺失');
});

t('buildDesignCasesMarkdown 接收并透传需求上下文', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  assert.ok(/function buildDesignCasesMarkdown\(text, designCases, stats, reqCtx = null\)/.test(server),
    '签名未接 reqCtx');
  assert.ok(/strengthenAssertion\(expected, c, rowCtx, reqCtx\)/.test(server), '未透传给 strengthenAssertion');
  assert.ok(/buildDesignCasesMarkdown\(text, toolDesignCases, toolDesignStats, toolRequirementContext\)/.test(server),
    '调用点未传上下文');
});

t('落地时的空步骤不再写「触发对应操作」', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  const start = server.indexOf('function buildDesignCasesMarkdown(');
  const body = server.slice(start, start + 3200);
  assert.ok(/callHint\(\)/.test(body), '未用真实接口生成步骤');
  assert.ok(!/\n3\. 触发对应操作并观察接口响应与页面反馈/.test(body),
    '空步骤兜底仍是「触发对应操作」');
});

t('需求上下文在工具调用时就缓存（落地早于门禁循环）', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  assert.ok(/let toolRequirementContext = null/.test(server), '没有缓存变量');
  assert.ok(/toolRequirementContext = ctx/.test(server), '工具调用时未保存上下文');
});

t('design-methods 的正交断言不再写死 code=0', () => {
  const src = fs.readFileSync(path.join(SKILL, 'design-methods.js'), 'utf8');
  assert.ok(!/响应体 code=0/.test(src), 'design-methods 仍写死 code=0');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
