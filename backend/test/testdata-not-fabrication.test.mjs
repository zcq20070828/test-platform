/**
 * 测试数据不是编造（2026-11-25）
 *
 * 用户报「241/242 条可用（99.6%）未达标」——看起来自相矛盾。
 * 查下来有两层问题：
 *
 * 1. **反编造检查误判了测试数据**（真 bug）
 *    任务 b9bd13ec 被判「疑似编造 11 个（39%）」，那 11 个是
 *    NOT_EXIST_20260101 / C_UNREG_001 / INVALID_PARAM / DUPLICATE_SUBMIT /
 *    cid_test_001 / claw_10086 / dev_001 / invalid_token_123...
 *    全是用例故意构造的异常输入，本来就不该出现在需求文档里。
 *    把「异常测试数据」和「编造接口/字段」混为一谈，等于罚对了行为。
 *    可用率 99.6% 说明这些用例完全可执行，是检查本身错了。
 *
 * 2. **界面没说清是哪一项没过**（可观测性问题）
 *    只显示「99.6% 未达标」，用户无法判断问题出在哪。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInventedIdentifiers } from '../lib/case-quality-gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');

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

console.log('=== 测试数据 vs 编造 单元测试 ===');

// 真实任务 b9bd13ec 的输入（令牌/绑定体系）
const SRC = '需求：令牌校验接口 /api/v1/auth/token 返回 token_status 字段。'
  + '用户表 users 存储账号信息，access_token 用于鉴权，claw_uid 是授权会话标识，'
  + 'bind_status 表示绑定状态，client_id 标识业务方，skill_id 标识技能。'
  + '登录接口 /api/v1/auth/login，另外 /api/v1/user/info 查询用户信息。';

t('真实误判的异常测试值不再算编造', () => {
  // 这 10 个是任务 b9bd13ec 被判「编造」的原文，全部是构造的异常输入
  const badValues = [
    'NOT_EXIST_20260101', 'C_UNREG_001', 'AC_NOT_EXIST_001', 'INVALID_PARAM',
    'DUPLICATE_SUBMIT', 'cid_test_001', 'claw_10086', 'dev_001',
    'invalid_token_123', 'ac_not_exist_001',
  ];
  const delivered = badValues.map((v) => `TC 使用 ${v} 作为输入`).join('；');
  const r = checkInventedIdentifiers(delivered, SRC);
  for (const v of badValues) {
    assert.ok(!r.invented.includes(v), `「${v}」是测试数据却被判编造`);
  }
});

t('整个任务的编造比例回到阈值内（39% → ~4%）', () => {
  // 复现 b9bd13ec 的形状：28 个标识符里 11 个是异常测试值
  const delivered = '接口 /api/v1/auth/token token_status access_token claw_uid bind_status client_id skill_id users '
    + 'NOT_EXIST_20260101 C_UNREG_001 AC_NOT_EXIST_001 INVALID_PARAM DUPLICATE_SUBMIT '
    + 'cid_test_001 claw_10086 dev_001 invalid_token_123 create_time '
    + '/api/v1/auth/login /api/v1/user/info';
  const r = checkInventedIdentifiers(delivered, SRC);
  assert.strictEqual(r.overLimit, false, `仍判编造，ratio=${r.ratio}，invented=${r.invented.join(',')}`);
  assert.ok(r.ratio < 0.15, `比例仍偏高：${r.ratio}`);
});

t('真编造的接口/表/状态机仍被拦住（不放松）', () => {
  const bad = '用例TC-001：调用 /api/v1/auth/reactivate 激活。检查 token_info 表。'
    + '状态机 PENDING_AUTH / SMSSENT。调用 /api/v1/auth/refund。写 refund_log 表。'
    + '状态 REFUND_PENDING / RISK_CHECKING。';
  const r = checkInventedIdentifiers(bad, SRC);
  assert.strictEqual(r.overLimit, true, '真编造被放过了，这个检查就失去意义');
  assert.ok(r.invented.includes('/api/v1/auth/reactivate'), '未抓到编造接口');
  assert.ok(r.invented.includes('PENDING_AUTH'), '未抓到编造状态枚举');
  assert.ok(r.invented.includes('token_info'), '未抓到编造表名');
});

t('真实字段名（不在原文）仍算编造，不因带下划线就放过', () => {
  // 这是关键边界：不能笼统地「带下划线都放过」，
  // token_info / refund_log 是真字段形状，原文没有就该判编造
  const bad = '检查 token_info 表与 refund_log 表，字段 refund_amount、audit_status';
  const r = checkInventedIdentifiers(bad, SRC);
  assert.ok(r.invented.includes('token_info'), 'token_info 被放过');
  assert.ok(r.invented.includes('refund_log'), 'refund_log 被放过');
});

t('原文里有的字段名不会被判编造', () => {
  const good = '校验 access_token / claw_uid / bind_status / token_status';
  const r = checkInventedIdentifiers(good, SRC);
  assert.strictEqual(r.invented.length, 0, `误判：${r.invented.join(',')}`);
});

// ---------------- 界面表达 ----------------

const MAIN_TS = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');

t('未达标时说明是哪一项没过', () => {
  assert.ok(/未过项：/.test(MAIN_TS), '界面没有说明未过项，用户看到「99.6% 未达标」无法理解');
});

t('事实性两项也参与未过项计算', () => {
  const idx = MAIN_TS.indexOf('未过项：');
  const block = MAIN_TS.slice(Math.max(0, idx - 800), idx + 200);
  assert.ok(/quantityPass === false/.test(block), '未包含「数量自相矛盾」');
  assert.ok(/inventionPass === false/.test(block), '未包含「疑似编造标识符」');
});

t('后端广播带出 quantityPass / inventionPass', () => {
  const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  // 至少要有一处 case_quality_gate 广播带这两个字段，否则前端拿不到
  assert.ok(/quantityPass: gateReport\.quantityPass/.test(SERVER), 'gateReport 广播缺 quantityPass');
  assert.ok(/inventionPass: gateReport\.inventionPass/.test(SERVER), 'gateReport 广播缺 inventionPass');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
