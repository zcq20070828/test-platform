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

// 同上需求的精简版：只保留「字段归属于哪个接口」必需的几行。
// 用于验证字段→接口反查，避免被长文本里的其他接口抢走匹配。
const REQ_BY_ENDPOINT = `
| FR-001 | 预凭证接口（/custody/preAuth） | 必填 clawUid、skillId、sign |
| FR-002 | 凭证校验接口（/custody/validate） | 必填 creditToken、type |
| FR-006 | 短信下发接口（/custody/smsSend） | 必填 loginName、sign |
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
  const body = server.slice(start, start + 4600);
  assert.ok(/callHint\(caseText, c\.endpoint\)/.test(body), `未按用例文本+接口归属生成步骤`);
  assert.ok(!/\n3\. 触发对应操作并观察接口响应与页面反馈/.test(body),
    '空步骤兜底仍是「触发对应操作」');
});

// 第三条根因：183 条用例的步骤一律写 preAuth，而用例名说的是别的接口。
// 九维探针标题是通用描述，只按探针语义匹配会全部落到 endpoints[0]。
t('步骤接口要按用例点名的字段反查（不是一律 preAuth）', () => {
  const casesMod = require(path.join(SKILL, 'dimension-cases.js'));
  const ctx = ctxMod.deriveRequirementContext(REQ);
  assert.ok(Object.keys(ctx.fieldEndpointMap || {}).length > 0, '未提取字段→接口映射');
  const pick = (name) => casesMod.pickEndpointForCase(name, ctx.endpoints, null, ctx.fieldEndpointMap);
  const validate = pick('等价类-creditToken-长度合法');
  const sms = pick('等价类-loginName-长度合法');
  assert.ok(validate && /validate/.test(validate.path), `creditToken 未归到 validate：${validate && validate.path}`);
  assert.ok(sms && /smsSend/.test(sms.path), `loginName 未归到 smsSend：${sms && sms.path}`);
  assert.notStrictEqual(validate.path, sms.path, '两个字段被归到同一接口');
});

t('service 端的落地也做字段反查', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  const start = server.indexOf('const pickEpFor =');
  assert.ok(start > 0, '找不到 pickEpFor');
  const body = server.slice(start, start + 1200);
  assert.ok(/fieldEndpointMap/.test(body), '未用字段→接口映射反查');
});

// ── 第四条根因：把接口路径/请求头集合当成可测字段 ──
//
// 实测任务 26a56e33：模型传的 inputSpec 里混进了 `/custody/validate` 与
// `commonHeaders`，生成出「等价类-/custody/validate-长度合法」这种用例，
// 输入是 `/custody/validate=""`。执行者不知道该怎么改一个 URL 路径的"长度"。
// 183 条用例全不可执行，审核判 6 个 blocker 一票否决。
t('接口路径 / 请求头集合 / 说明文字不被当成字段', () => {
  const invoker = require(path.join(SKILL, '9dem-invoker.js'));
  const r = invoker.filterRealFields({
    '/custody/validate': { type: 'string' },
    commonHeaders: { type: 'string' },
    '接口要素完整度（按要素计数）': { type: 'string' },
    '可用性分区': { type: 'string' },
    clientId: { type: 'string' },
  });
  assert.deepStrictEqual(Object.keys(r.spec), ['clientId'], `保留错了：${Object.keys(r.spec).join(',')}`);
  assert.ok(r.removed.length >= 4, `剔除太少：${r.removed.length}`);
});

t('design-methods 的 normalizeSpec 也过滤（两个入口都要挡）', () => {
  const dm = require(path.join(SKILL, 'design-methods.js'));
  const out = dm.executeDesignMethods({
    input: {
      inputSpec: {
        '/custody/validate': { type: 'string' },
        commonHeaders: { type: 'string' },
        clientId: { type: 'string' },
      },
    },
  });
  const names = out.cases.map((c) => String(c.name));
  assert.ok(!names.some((n) => n.includes('/custody')), '路径仍被当字段生成了用例');
  assert.ok(!names.some((n) => n.includes('commonHeaders')), '请求头集合仍被当字段');
  assert.ok(names.some((n) => n.includes('clientId')), '真字段被误删');
});

// 第五条：`0<=len(/custody/validate)<=undefined` 漏进交付物。
// undefined 来自 maxLength 取不到值，而它的兜底 255 又是编造的行业默认值。
t('maxLength 未定义时不编造 255，也不留 undefined', () => {
  const dm = require(path.join(SKILL, 'design-methods.js'));
  const out = dm.executeDesignMethods({ input: { inputSpec: { clientId: { type: 'string' } } } });
  const blob = JSON.stringify(out.cases);
  assert.ok(!/undefined/.test(blob), '交付物里仍有 undefined');
  assert.ok(!/\b255\b/.test(blob), '仍编造了 255 长度上限');
  // 没有长度定义就不该生成长度边界用例，只留一条「有效取值」
  const lenCases = out.cases.filter((c) => /长度|边界值-.*Length|minLength|maxLength/.test(String(c.name)));
  assert.strictEqual(lenCases.length, 0, `无长度定义却生成了 ${lenCases.length} 条长度类用例`);
  assert.ok(out.cases.length > 0, '一条都没生成，过度删减');
});

t('需求真写了长度时仍生成边界用例', () => {
  const dm = require(path.join(SKILL, 'design-methods.js'));
  const out = dm.executeDesignMethods({ input: { inputSpec: { sign: { type: 'string', minLength: 1, maxLength: 32 } } } });
  const lenCases = out.cases.filter((c) => /长度|Length/.test(String(c.name)));
  assert.ok(lenCases.length >= 2, `有长度定义却只生成 ${lenCases.length} 条长度用例`);
  assert.ok(!/undefined/.test(JSON.stringify(out.cases)), '有长度定义仍出 undefined');
});

// ── 第六/第七条：改名与改值互相打脸 ──
//
// 实测任务 6963d2b1（修完前五条之后）：审核判 27 条 major，其中两大簇
// 都是我引入或未覆盖的：
//   ① 「错误推测-clawUid-空值」输入却是 clawUid="a" ——
//      repairPlaceholderInput 把 `""` 当占位符换成了语义值；
//   ② 约 30 条「传空串」断言「≠103000」，对合法值必然失败。
t('空值用例的输入必须保持为空', () => {
  const { repairPlaceholderInput } = require(path.join(BACKEND, 'lib', 'case-quality-gate.js'));
  assert.strictEqual(repairPlaceholderInput('clawUid=""', '错误推测-clawUid-空值').input, 'clawUid=""',
    '空串被"修复"成了非空值');
  assert.strictEqual(repairPlaceholderInput('clientId=""', '').input, 'clientId=""',
    '空串被当占位符替换');
});

t('长度边界用例仍按位数修正（别为了保空值把这条也废了）', () => {
  const { repairPlaceholderInput } = require(path.join(BACKEND, 'lib', 'case-quality-gate.js'));
  const r = repairPlaceholderInput(`password="${'A'.repeat(31)}"`, '边界值-密码31位');
  assert.ok(r.repaired, '长度边界未修正');
  assert.strictEqual(r.input.match(/"([^"]*)"/)[1].length, 31, '修正后长度不对');
});

t('无长度定义时不生成「超长输入」用例（没有基准就无所谓超长）', () => {
  const dm = require(path.join(SKILL, 'design-methods.js'));
  const out = dm.executeDesignMethods({ input: { inputSpec: { clawUid: { type: 'string' } } } });
  const over = out.cases.filter((c) => /超长/.test(String(c.name)));
  assert.strictEqual(over.length, 0, `无上限定义却生成 ${over.length} 条超长用例`);
  // 空值用例必须还在（那是有意义的）
  assert.ok(out.cases.some((c) => /空值/.test(String(c.name))), '空值用例被误删');
});

t('有长度定义时超长用例仍生成且长度合理', () => {
  const dm = require(path.join(SKILL, 'design-methods.js'));
  const out = dm.executeDesignMethods({ input: { inputSpec: { sign: { type: 'string', maxLength: 32 } } } });
  const over = out.cases.filter((c) => /超长/.test(String(c.name)));
  assert.ok(over.length >= 1, '有上限却没生成超长用例');
  const len = over[0].input.match(/"([^"]*)"/)[1].length;
  assert.ok(len > 32, `超长值只有 ${len} 字符，不超过上限 32`);
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

// ── 第八条：用例的接口归属要记在用例上，不能留给下游猜 ──
//
// 实测任务 539f4597：审核判「模块标 accessCodeValidate，步骤调 smsValidate」
// 「用例名与步骤接口错配」。根因是 inputSpec 是扁平的，8 个接口共用一份字段，
// 下游只能按名字猜。改成生成时就按字段归属打标。
t('用例自带接口归属（按字段归属打标）', () => {
  const dm = require(path.join(SKILL, 'design-methods.js'));
  const ctx = ctxMod.deriveRequirementContext(REQ_BY_ENDPOINT);
  const out = dm.executeDesignMethods({
    input: {
      inputSpec: {
        clawUid: { type: 'string' },
        creditToken: { type: 'string' },
        loginName: { type: 'string' },
      },
      fieldEndpointMap: ctx.fieldEndpointMap,
    },
  });
  const epOf = (field) => {
    const c = out.cases.find((x) => String(x.input || '').startsWith(field));
    return c && c.endpoint ? c.endpoint.path : '';
  };
  assert.ok(/preAuth/.test(epOf('clawUid')), `clawUid 未归到 preAuth：${epOf('clawUid')}`);
  assert.ok(/validate/.test(epOf('creditToken')), `creditToken 未归到 validate：${epOf('creditToken')}`);
  assert.ok(/smsSend/.test(epOf('loginName')), `loginName 未归到 smsSend：${epOf('loginName')}`);
});

t('执行器把 fieldEndpointMap 传进设计方法', () => {
  const invoker = fs.readFileSync(path.join(SKILL, '9dem-invoker.js'), 'utf8');
  assert.ok(/merged\.fieldEndpointMap = requirementContext\.fieldEndpointMap/.test(invoker),
    '未把字段→接口映射传下去');
});

t('服务端落地时优先用用例自带的接口归属', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  const start = server.indexOf('const pickEpFor =');
  const body = server.slice(start, start + 700);
  assert.ok(/caseEndpoint/.test(body), '未优先使用用例自带的 endpoint');
});

// ── 第九条：维度列只写维度、没写方法 ──
//
// 实测任务 539f4597：7 条用例维度列只写「② 数据」，门禁判 missingMethod
// 计入不可用（可用率 97.7%），审核判 major。方法和层级一样是机械信息，
// 按行文字能确定性推出来，不该让模型返工这一列。
t('维度列缺方法时按行文字自动补', () => {
  const gate = require(path.join(BACKEND, 'lib', 'case-quality-gate.js'));
  const text = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| TC-001 | 等价类-clawUid-合法 | ② 数据 | 正常 | clawUid="a" | 1.调用 | 返回 200 |',
    '| TC-002 | 边界值-clawUid-max | ② 数据 | 边界 | clawUid="A" | 1.调用 | 返回 400 |',
    '| TC-003 | 随便一条 | ② 数据 | 异常 | x | 1.调用 | 拒绝 |',
    '| TC-004 | 已有方法 | ② 数据 / 场景法 | 正常 | x | 1.调用 | ok |',
  ].join('\n');
  const r = gate.applyDimensionMethodRepair(text);
  assert.strictEqual(r.rowsRepaired, 3, `补了 ${r.rowsRepaired} 行（应为 3）`);
  assert.ok(/② 数据 \/ 等价类划分法/.test(r.text), '等价类用例未补出等价类划分法');
  assert.ok(/② 数据 \/ 边界值分析法/.test(r.text), '边界用例未补出边界值分析法');
  assert.ok(/② 数据 \/ 错误推测法/.test(r.text), '异常层未兜底为错误推测法');
  assert.ok((r.text.match(/② 数据 \/ 场景法/g) || []).length === 1, '已有方法被改动了');
});

t('补方法后 missingMethod 清零（真实交付物形态）', () => {
  const gate = require(path.join(BACKEND, 'lib', 'case-quality-gate.js'));
  const text = [
    '| 用例编号 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 |',
    '|---|---|---|---|---|---|---|',
    '| TC-001 | 等价类-a-合法 | ② 数据 | 正常 | a="x" | 1.调用 /api/x | 返回 200 |',
  ].join('\n');
  const before = gate.checkDeliverable(text, { originalInput: '' });
  const fixed = gate.applyDimensionMethodRepair(text);
  const after = gate.checkDeliverable(fixed.text, { originalInput: '' });
  const mm = (rep) => (rep.cases || []).filter((c) => c.reasons.includes('missingMethod')).length;
  assert.ok(mm(before) > 0 || before.applicable === false, '样例没触发 missingMethod，测试无意义');
  assert.strictEqual(mm(after), 0, '补完仍有 missingMethod');
});

t('服务端在门禁前调用方法补齐', () => {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  assert.ok(/applyCaseDimensionMethodRepair\(text\)/.test(server), '未在门禁前补方法');
});

// ★★ 端到端执行工具本身（2026-11-26 血泪教训）
//
// 上面所有测试都是「读源码 + 匹配字符串」，所以漏掉了一个必崩的 bug：
// 9dem-invoker 里 requirementContext 声明在设计方法之后，被之前的代码引用，
// 每次调用都抛 `Cannot access 'requirementContext' before initialization`。
// 工具返回 error → 模型反复重试 → 600s 超时，连续 4 个任务全失败，
// 而「全量回归通过」给了完全错误的信心。
//
// 判据：任何对 invoker 的改动，都必须真的跑一次 invoke()，断言 success !== false。
t('★★ invoke() 真的能跑通（TDZ / 依赖缺失都会在这里炸）', async () => {
  const invoker = require(path.join(SKILL, '9dem-invoker.js'));
  const ctx = ctxMod.deriveRequirementContext(REQ);
  const out = await invoker.invoke({
    task: REQ,
    module: '托管系统',
    includeDimensionCases: true,
    includeDesignCases: true,
    requirementContext: ctx,
  });
  assert.notStrictEqual(out.success, false, `invoke 返回失败：${out.error || out.hint || '(无错误信息)'}`);
  assert.ok(out.error === undefined, `invoke 抛了错误：${out.error}`);
  assert.ok(Array.isArray(out.dimensionCases) && out.dimensionCases.length > 0,
    `dimensionCases 为空（${out.dimensionCases?.length}）`);
});

t('★★ 带 requirementContext 与不带都能跑通', async () => {
  const invoker = require(path.join(SKILL, '9dem-invoker.js'));
  for (const label of ['不带上下文', '带上下文']) {
    const params = { task: REQ_BY_ENDPOINT, module: '托管系统', includeDimensionCases: true, includeDesignCases: true };
    if (label === '带上下文') params.requirementContext = ctxMod.deriveRequirementContext(REQ_BY_ENDPOINT);
    const out = await invoker.invoke(params);
    assert.strictEqual(out.success !== false, true, `${label} 时 invoke 失败：${out.error}`);
  }
});

t('★★ 工具输出里没有 code=0 / 255 / undefined', async () => {
  const invoker = require(path.join(SKILL, '9dem-invoker.js'));
  const ctx = ctxMod.deriveRequirementContext(REQ);
  const out = await invoker.invoke({
    task: REQ, module: '托管系统', includeDimensionCases: true, includeDesignCases: true, requirementContext: ctx,
  });
  const all = [...(out.design?.cases || []), ...(out.dimensionCases || [])];
  assert.ok(all.length > 0, '没有生成任何用例');
  const blob = JSON.stringify(all);
  const code0 = all.filter((c) => /code\s*=\s*0/.test(String(c.expected))).length;
  assert.strictEqual(code0, 0, `${code0} 条断言仍含 code=0`);
  assert.ok(!/\bundefined\b/.test(blob), '输出里仍有 undefined');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
