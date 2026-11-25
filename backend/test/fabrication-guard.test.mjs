/**
 * 反编造确定性判定（2026-11-25 · 第 4 项「真正拦住」）
 *
 * 背景：生产近 30 天 487 条审核意见里「事实性（疑似幻觉）」109 条居首，
 * 但全是审核 LLM 主观打标签，只能当建议放行——17 个完成任务里 11 个
 * 是 passed_with_notes，等于一条都没拦住。这里把其中可确定性判定的部分
 * 直接纳入 pass 判定。
 *
 * 本测试同时是**误杀防线**：真实生产交付物（3 份，共 23 万字）必须全部通过。
 * 历史上踩过的误杀：
 *   - 路径正则放宽到「任何 /xxx」→ XSS 数据 `<script>alert(1)</script>`、
 *     自然语言分隔「清空登录态/cookie」「单点/4G取号/cookie」全被当接口路径，
 *     3 份真实交付物里 2 份被误判 85%~95% 编造。
 *   - 数量判据要求「差≥2」→ 真实样本「13 个」vs「共 14 个」差 1 被漏掉。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkQuantityConsistency,
  checkInventedIdentifiers,
  extractHardIdentifiers,
} from '../lib/case-quality-gate.js';

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

console.log('=== 反编造确定性判定 单元测试 ===');

// ---------------- 数量矛盾 ----------------
t('「13 个」但同句「共 14 个」→ 拦住（真实样本）', () => {
  const r = checkQuantityConsistency('FR-017 写明"13 个返回码"，实际列举 103000 至 110044 共 14 个');
  assert.strictEqual(r.length, 1, `应拦 1 处，实际 ${r.length}`);
  assert.match(r[0].detail, /13.*14|14/);
});

t('数量一致时不判', () => {
  assert.strictEqual(checkQuantityConsistency('共 3 个返回码：103000、103001、103002').length, 0);
  assert.strictEqual(checkQuantityConsistency('本模块提供 5 个功能，共 5 个接口').length, 0);
});

t('只有总数、没有对比时不判', () => {
  assert.strictEqual(checkQuantityConsistency('共 45 个返回码').length, 0);
});

t('「范围 A 至 B」不是逐项列举，不判', () => {
  // 描述跨度不等于说这中间每一项都存在，按区间长度判会大面积误杀
  assert.strictEqual(checkQuantityConsistency('本接口有 3 个状态码，范围 200 至 599').length, 0);
});

t('列举语境下区间跨度与声明数量矛盾 → 拦住', () => {
  const r = checkQuantityConsistency('共 3 个状态码，包括 200 至 599');
  assert.strictEqual(r.length, 1, `应拦 1 处，实际 ${r.length}`);
});

t('日期区间不当作编码列举', () => {
  assert.strictEqual(checkQuantityConsistency('测试周期 2026 至 2027 年，共 2 个阶段').length, 0);
});

t('正常自然语言不误报', () => {
  assert.strictEqual(checkQuantityConsistency('系统提供 5 个功能模块，覆盖登录、注册、查询、修改、删除').length, 0);
});

// ---------------- 标识符编造 ----------------
const SRC = '需求：实现令牌校验接口 /api/v1/auth/token，返回 token_status 字段，值为 0 或 1。'
  + '用户表 users 存储账号信息。登录接口 /api/v1/auth/login 返回 uuid 字段。'
  + '另外 /api/v1/user/info 查询用户信息。';

t('接口路径必须以真实 API 前缀开头（XSS 数据不算路径）', () => {
  const ids = extractHardIdentifiers('测试 "<script>alert(1)</script>" 与 "清空登录态/cookie"');
  assert.strictEqual(ids.size, 0, `不应抽出任何标识符，实际：${[...ids].join(',')}`);
});

t('接口路径能正常抽出', () => {
  const ids = extractHardIdentifiers('调用 /api/v1/auth/token 与 /api/v2/user/profile');
  assert.ok(ids.has('/api/v1/auth/token'));
  assert.ok(ids.has('/api/v2/user/profile'));
});

t('编造接口/状态机/表名 → 拦住', () => {
  const bad = '用例TC-001：调用 /api/v1/auth/token 校验令牌。预期 token_status=BOUND。'
    + '数据库检查 token_info 表记录。调用 /api/v1/auth/reactivate 重新激活账号。'
    + '状态机 INIT/PENDING_AUTH/SMSSENT。';
  const r = checkInventedIdentifiers(bad, SRC);
  assert.ok(r.overLimit, `应判编造，实际 ratio=${r.ratio}`);
  assert.ok(r.invented.includes('/api/v1/auth/reactivate'), '未抓到编造接口');
  assert.ok(r.invented.includes('PENDING_AUTH'), '未抓到编造状态枚举');
  assert.ok(r.invented.includes('token_info'), '未抓到编造表名');
});

t('有原文依据的标识符不判编造', () => {
  const good = '用例TC-001：调用 /api/v1/auth/token。预期 token_status=0。检查 users 表。';
  const r = checkInventedIdentifiers(good, SRC);
  assert.strictEqual(r.invented.length, 0, `误判：${r.invented.join(',')}`);
  assert.strictEqual(r.overLimit, false);
});

t('原文没有硬标识符时跳过（纯自然语言需求无判断基准）', () => {
  const natural = '系统需要支持用户用手机号和验证码登录，登录成功后返回令牌，令牌有效期两小时。'.repeat(5);
  const r = checkInventedIdentifiers('用例：调用任意接口', natural);
  assert.strictEqual(r.overLimit, false);
  assert.strictEqual(r.skipped, 'source-has-no-identifiers');
});

t('没有原文时跳过，不误判', () => {
  const r = checkInventedIdentifiers('任意内容 /api/v1/whatever', '');
  assert.strictEqual(r.overLimit, false);
  assert.strictEqual(r.skipped, 'no-source');
});

t('少量命名扩展不判（比例未超限）', () => {
  // 模型把「令牌校验」写成 token_validate 是合理扩展，不算编造
  const many = '/api/v1/auth/token token_status users /api/v1/auth/validate token_validate';
  const r = checkInventedIdentifiers(many, SRC);
  assert.strictEqual(r.overLimit, false, `不应判编造，ratio=${r.ratio}`);
});

// ---------------- 合成样本回归（误杀防线 + 拦截能力）----------------
//
// 为什么不用真实交付物做 fixture：真实样本含商业需求文档内容
// （活动方案、组织名、内部上传路径），而本仓库是公开的，不能入库。
// 改为按真实交付物里**最容易误判的写法**构造合成样本，特征比例来自
// 对 3 份生产交付物（23 万字）的统计：
//   - 自然语言斜杠分隔（清空登录态/cookie）出现 739 次
//   - XSS 测试数据（<script>alert(1)</script>）出现 20 次
//   - toast / 弹窗文案 27 次
// 这些正是早期版本把 3 份真实交付物误判 85%~95% 编造的根源。
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(here, 'fixtures', 'synthetic-deliverables');

function readFixture(name) {
  const p = path.join(FIXTURE_DIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

const uiInput = readFixture('synthetic-case-01-in.md');
const uiOutput = readFixture('synthetic-case-01-out.md');
const apiInput = readFixture('synthetic-api-01-in.md');
const apiGood = readFixture('synthetic-api-01-good.md');
const apiBad = readFixture('synthetic-api-01-bad.md');

t('合成样本齐备', () => {
  assert.ok(uiInput && uiOutput, '界面类样本缺失');
  assert.ok(apiInput && apiGood && apiBad, '接口类样本缺失');
});

t('界面类样本（含 739 处斜杠分隔、XSS 数据）不被误判', () => {
  const q = checkQuantityConsistency(uiOutput);
  assert.strictEqual(q.length, 0, `数量误杀：${q.map((x) => x.detail).join('; ')}`);
  const inv = checkInventedIdentifiers(uiOutput, uiInput);
  assert.strictEqual(inv.overLimit, false, `编造误杀 ${inv.ratio}：${inv.invented.join(',')}`);
});

t('接口类正常样本不被误判', () => {
  const inv = checkInventedIdentifiers(apiGood, apiInput);
  assert.strictEqual(inv.overLimit, false, `误杀：${inv.invented.join(',')}`);
  assert.strictEqual(inv.invented.length, 0, `不应有任何编造判定，实际：${inv.invented.join(',')}`);
});

t('接口类编造样本被拦住（假接口/假状态机/假表名）', () => {
  const inv = checkInventedIdentifiers(apiBad, apiInput);
  assert.ok(inv.overLimit, `应判编造，实际 ratio=${inv.ratio}`);
  assert.ok(inv.invented.includes('/api/v1/order/refund'), '未抓到编造接口');
  assert.ok(inv.invented.includes('refund_record'), '未抓到编造表名');
  assert.ok(inv.invented.includes('RISK_CHECKING'), '未抓到编造状态机');
});

// ---------------- 接入链路：门禁结论要真的能阻断 + 能修 ----------------

const SERVER = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');

t('门禁 pass 判定已包含事实性两项', () => {
  const gate = fs.readFileSync(path.join(here, '..', 'lib', 'case-quality-gate.js'), 'utf8');
  assert.ok(/pass = usabilityPass && dimensionPass && quantityPass && inventionPass/.test(gate),
    'pass 未纳入 quantityPass/inventionPass，编造仍会被放行');
});

t('事实性问题走全文重写修复（不是外科式）', () => {
  // 外科式只回「待修用例的预期/步骤」，处理不了文件级的数量矛盾与散落的编造标识符
  assert.ok(/hasFabricationIssue/.test(SERVER), '缺少事实性专用修复分支');
  assert.ok(/全文重写/.test(SERVER), '缺少全文重写修复');
});

t('全文重写只在结果更好时才采纳（不修坏）', () => {
  const start = SERVER.indexOf('const hasFabricationIssue');
  assert.ok(start > 0, '找不到分支');
  const block = SERVER.slice(start, start + 3600);
  assert.ok(/usabilityRate >= gateReport\.usabilityRate - 0\.02/.test(block),
    '未校验重写后可用率，可能把好文档改坏');
  assert.ok(/better/.test(block) && /保留原输出/.test(block), '缺少回退保护');
});

t('修复指令里写清了数量矛盾与编造标识符怎么改', () => {
  const gate = fs.readFileSync(path.join(here, '..', 'lib', 'case-quality-gate.js'), 'utf8');
  assert.ok(/数量自相矛盾/.test(gate), '修复指令未提数量矛盾');
  assert.ok(/引用了原始需求中不存在的标识符/.test(gate), '修复指令未提编造标识符');
  assert.ok(/建议新增，原文未定义/.test(gate), '未给「确实需要但原文没定义」的处理方式');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
