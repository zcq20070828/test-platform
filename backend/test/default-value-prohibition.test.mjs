/**
 * 禁止把行业默认值当成需求事实（2026-11-26）
 *
 * 真实故障：任务 e8cee999 的 222 条用例里，195 条长度类用例全部建立在
 * 「0 <= len(field) <= 255」上，而**原始需求里没有 255**。
 * 模型套用了「字段长度默认 255」这个行业习惯值，把它当成了需求事实。
 *
 * 连带错误（审核抓到的）：
 *   - 边界用例标「0 字符」实际传 "a"（1 字符）
 *   - 标 254/255/256 字符，却共用同一个 64 字符串
 *   - interfaceVersion 传 32 位字母（原文是 x.y 格式）
 * 审核判了 blocker + 26 条 major，一票否决。
 *
 * 判据设计（这版经过三轮校准）：
 *
 *   1. 只认「数字在原文出现」会误伤边界值法：`1/64/65`、`254/255/256`
 *      里的 65 和 256 本就该是「边界外一个单位」，不该出现在需求里。
 *      → 放宽为 N±1、N±2 也算有依据。
 *
 *   2. 只按比例会误伤合理推断：需求没写字段长度时，模型补一个常见值
 *      构造边界用例是工程常态。实测一份**通过审核**的用例集也有 56% 无依据约束。
 *      → 引入「类别级说明」豁免。
 *
 *   3. 但说明必须是**类别级**的（「以下长度约束均为假设值」），
 *      不能是单条字段的零散说明。实测 e8cee999 写了
 *      「accessCode 其长度与字符集原文未定义」，那是单个字段，
 *      不能覆盖它整体铺的 48 行 255。
 */
import assert from 'node:assert';
import { checkUnsupportedConstraints } from '../lib/case-quality-gate.js';

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

console.log('=== 未定义约束检查 单元测试 ===');

// 原文必须 >100 字才会执行检查
const SRC = '需求文档：接口 /api/v1/auth/token 用于令牌校验，成功码 103000，失败按码表返回。'
  + 'timestamp 格式为 yyyyMMddHHmmssSSS 共 17 位。clientId 必填，用于标识业务方。'
  + 'sign 为 MD5 签名。clawUid 为本次授权会话的唯一标识，由客户端生成。'
  + '该接口需校验 traceId、interfaceVersion 等公共请求头，缺任一项返回对应错误码。';

const PAD = '\n| TC-000 | 占位用例 | 用于补足行数 | 正常 | x | 1. 步骤 | 期望成功 |';

t('原文没提长度、用例用 255 → 拦住（真实故障形态）', () => {
  const bad = '| 用例编号 | 输入数据 |\n|---|---|\n| TC-001 | clientId 长度 255 |\n| TC-002 | clientId 0<=len<=255 |' + PAD.repeat(3);
  const r = checkUnsupportedConstraints(bad, SRC);
  assert.strictEqual(r.overLimit, true, `应拦住，实际 ratio=${r.ratio}`);
  assert.ok(r.samples.length, '应给出样例');
});

t('原文写了 17 位、用例用 17 → 放行', () => {
  const ok = '| 用例编号 | 输入数据 |\n|---|---|\n| TC-001 | timestamp 17 位 |' + PAD.repeat(3);
  const r = checkUnsupportedConstraints(ok, SRC);
  assert.strictEqual(r.overLimit, false, `误杀：ratio=${r.ratio}`);
});

t('边界外推（16/18 位）算有依据，不误伤边界值法', () => {
  // 实测一份通过审核的用例集里有 1/64/65、254/255/256 这类组合，
  // 65 和 256 本来就该是「边界外一个单位」，不该出现在需求里
  const edge = '| 用例编号 | 输入数据 |\n|---|---|\n| TC-001 | timestamp 16 位 |\n| TC-002 | timestamp 18 位 |' + PAD.repeat(3);
  const r = checkUnsupportedConstraints(edge, SRC);
  assert.strictEqual(r.overLimit, false, `误杀边界外推：ratio=${r.ratio}`);
});

t('大批 255 但写了类别级说明 → 放行（合理推断允许）', () => {
  const disclosed = '本项目字段长度原文未定义，以下长度约束均为假设值，待需求方确认。\n\n'
    + '| 用例编号 | 输入数据 |\n|---|---|\n| TC-001 | clientId 255 字符 |\n| TC-002 | clientId 0<=len<=255 |\n| TC-003 | clawUid 255 字符 |' + PAD.repeat(3);
  const r = checkUnsupportedConstraints(disclosed, SRC);
  assert.strictEqual(r.disclosed, true, '未识别类别级说明');
  assert.strictEqual(r.overLimit, false, '有说明仍被拦');
});

t('只有单条字段的零散说明 → 仍拦住（真实故障形态）', () => {
  // e8cee999 写了「accessCode 其长度与字符集原文未定义」，
  // 那是单个字段，不能覆盖它整体铺的 48 行 255
  const single = '| 用例编号 | 输入数据 |\n|---|---|\n'
    + '| TC-001 | accessCode 其长度与字符集原文未定义，待确认 |\n'
    + '| TC-002 | clientId 255 字符 |\n'
    + '| TC-003 | clientId 0<=len<=255 |\n'
    + '| TC-004 | clawUid 255 字符 |' + PAD.repeat(2);
  const r = checkUnsupportedConstraints(single, SRC);
  assert.strictEqual(r.disclosed, false, '单条说明被误当成类别级说明');
  assert.strictEqual(r.overLimit, true, '应拦住');
});

t('没有原文时跳过，不误判', () => {
  const r = checkUnsupportedConstraints('| TC-001 | 255 字符 |', '');
  assert.strictEqual(r.overLimit, false);
  assert.strictEqual(r.skipped, 'no-source');
});

t('原文太短时跳过（无判断基准）', () => {
  const r = checkUnsupportedConstraints('| TC-001 | 255 字符 |', '短需求');
  assert.strictEqual(r.overLimit, false);
});

t('没有数值约束的交付物不判', () => {
  const r = checkUnsupportedConstraints('| TC-001 | 点击登录按钮 | 正常 |', SRC);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.overLimit, false);
});

t('多种约束写法都能识别', () => {
  const forms = [
    '| TC-001 | clientId 255 字符 |',
    '| TC-002 | 最多 255 |',
    '| TC-003 | 长度 255 |',
    '| TC-004 | maxLength=255 |',
    '| TC-005 | len(clientId)<=255 |',
  ].join('\n');
  const r = checkUnsupportedConstraints(forms + PAD.repeat(3), SRC);
  assert.ok(r.total >= 4, `应识别到多条约束，实际 ${r.total}`);
  assert.ok(r.unsupported >= 4, `应判为无依据，实际 ${r.unsupported}`);
});

t('门禁 pass 已包含约束检查', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'lib', 'case-quality-gate.js'), 'utf8');
  assert.ok(/checkUnsupportedConstraints\(text, original\)/.test(src), '门禁未调用约束检查');
  assert.ok(/const pass = usabilityPass && dimensionPass && quantityPass && inventionPass && constraintPass/.test(src),
    'pass 判定未纳入 constraintPass');
});

t('修复指令里说明了两种改法', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'lib', 'case-quality-gate.js'), 'utf8');
  assert.ok(/约束在需求中无依据/.test(src), '修复指令未提这类问题');
  assert.ok(/类别级说明/.test(src), '未说明要用类别级说明');
});

t('提示词禁止套用行业默认值', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  assert.ok(/禁止把行业默认值当成需求事实/.test(src), '提示词缺少该约束');
  assert.ok(/长度 255/.test(src), '提示词未举出 255 这个真实案例');
});

// 只拦不修等于把交付物判死。这类问题不在单条用例行里，
// 外科式修复动不到根（模型会给每行补一句「原文未定义」，门禁认的是类别级说明），
// 必须和数量矛盾/编造标识符一样走全文重写。
t('约束不通过走全文重写，不是外科式修复', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  const start = src.indexOf('const hasFabricationIssue');
  assert.ok(start > 0, '找不到全文重写分支');
  const block = src.slice(start, start + 900);
  assert.ok(/constraintPass === false/.test(block), '全文重写分支未纳入约束项');
  assert.ok(/约束值无依据/.test(block), '修复进度消息未说明是约束问题');
});

t('全文重写采纳条件包含约束项（否则修了等于没修）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  const start = src.indexOf('const better = recheck.applicable');
  assert.ok(start > 0, '找不到采纳条件');
  const block = src.slice(start, start + 800);
  assert.ok(/fabAfter\.constraintPass !== false/.test(block),
    '重写后约束仍无依据也会被采纳，下一轮还得再判一遍');
});

t('门禁广播带出 constraintPass（否则界面说不清未过项）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  const hits = src.match(/constraintPass: (gateReport|afterGate)\.constraintPass/g) || [];
  assert.ok(hits.length >= 2, `两处 case_quality_gate 广播都要带，实际 ${hits.length} 处`);
});

t('前端能显示「约束值无需求依据」这个未过项', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', '..', 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
  assert.ok(/data\.constraintPass === false/.test(src), '前端未处理 constraintPass');
  assert.ok(/约束值无需求依据/.test(src), '未给出可读的未过项名称');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
