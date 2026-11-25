/**
 * 指令语义判定：不看长度，只看内容（2026-11-25）
 *
 * 用户两次指出同一件事：
 *   1. 「不能根据输入的长度来判断，要根据输入的内容来判断，对输入内容进行语义理解来判断」
 *   2. 指着截图里那三条判据（极短 <8 字 / ≤60 字 / 其余哪怕 18 字）说「这部分内容说的逻辑」
 *
 * 那三条判据（isSkeletonInput）两个问题：
 *   a) 底层仍是长度阈值，只是换了个组合方式
 *   b) 把「经过3轮都还没达到审核通过标准」判成空壳（因为它 24 字 < 60），
 *      而这句话有明确的评价对象和修改意图，是真实任务
 *
 * 现在的判据全部基于内容特征，代码里不出现任何长度阈值。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessSelfContained,
  isPureContinuation,
  detectContinuationKind,
} from '../lib/instruction-semantics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SEM_SRC = fs.readFileSync(path.join(ROOT, 'backend', 'lib', 'instruction-semantics.js'), 'utf8');
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

console.log('=== 指令语义判定 单元测试 ===');

/** 只看生效代码，忽略注释（注释里会写历史教训的示例） */
function realCode(src) {
  return src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

// ---------------- 核心：代码里不许有长度阈值 ----------------

t('语义模块生效代码里没有任何长度阈值', () => {
  const code = realCode(SEM_SRC);
  assert.ok(!/\.length\s*[<>]=?\s*\d+/.test(code),
    '仍有长度阈值——用户明确要求按内容语义判断');
});

t('continueHint 分支生效代码里没有长度切分', () => {
  const start = SERVER.indexOf('let continueHint = null');
  const block = SERVER.slice(start, start + 2400);
  const code = realCode(block);
  assert.ok(!/t\.length <= \d+/.test(code), '仍在用长度切分');
  assert.ok(/assessSelfContained\(t\)/.test(code), '未用语义判定');
});

t('enrichInputWithRecentContext 里没有长度上限', () => {
  const start = SERVER.indexOf('async function enrichInputWithRecentContext');
  const end = SERVER.indexOf('async function enrichInputWithTaskReferences', start);
  const code = realCode(SERVER.slice(start, end));
  assert.ok(!/input\.length > \d+\) return null/.test(code), '仍有长度上限');
  assert.ok(!/input\.length <= \d+/.test(code), '仍有长度下限判断');
});

t('旧的 isSkeletonInput 已彻底移除', () => {
  assert.ok(!/isSkeletonInput/.test(SERVER), '旧的按长度判定的实现还在');
  assert.ok(!/s\.length < 8/.test(realCode(SERVER)), '仍在用「极短 <8 字」判据');
  assert.ok(!/s\.length <= 60/.test(realCode(SERVER)), '仍在用「≤60 字」判据');
});

// ---------------- 空壳 vs 真实任务 ----------------

t('纯指代/纯动作整句 = 空壳', () => {
  for (const v of ['继续', '继续优化', '接着做', '重新生成', '优化一下', '再来一次', '重做', '继续吧']) {
    assert.strictEqual(isPureContinuation(v), true, `「${v}」应判空壳`);
  }
});

t('「经过3轮都还没达到审核通过标准」是真实任务，不是空壳', () => {
  // 这条是关键：它 24 字，旧判据（<60 字）把它当空壳，
  // 但句中有「都还没达到」这个对已有产物的评价 + 「修改」这个动作，
  // 指向的就是上文那份交付物，必须被识别为续做改稿而不是空壳。
  const a = assessSelfContained('经过3轮都还没达到审核通过标准，那就针对性修改吧');
  assert.strictEqual(a.selfContained, false, '应判为「指向上文」而不是独立');
  assert.ok(/评价已有产物|结果/.test(a.reason), `理由应说明是结果评价，实际：${a.reason}`);
});

t('「预期结果太笼统，改一下」这类也指向已有产物', () => {
  for (const v of ['预期结果写得太笼统，改一下', '覆盖度不够，补充几条', '步骤不够具体，完善一下']) {
    assert.strictEqual(isPureContinuation(v), true, `「${v}」应指向上文`);
  }
});

t('带业务对象的「继续 xxx」是独立新指令', () => {
  for (const v of [
    '继续优化登录模块的用例',
    '继续把登录模块的边界值用例补到 20 条',
    '帮我分析一下支付订单模块的需求',
  ]) {
    assert.strictEqual(isPureContinuation(v), false, `「${v}」有业务对象，不该当空壳`);
  }
});

t('带编号/数量的是独立新指令', () => {
  for (const v of ['把 TC-001 的预期结果改成 HTTP 400', '再补充 5 条边界用例']) {
    assert.strictEqual(isPureContinuation(v), false, `「${v}」有具体对象/数量`);
  }
});

t('「基于上一步的X结果生成Y」指向产物但对象明确，算独立', () => {
  // 开头「基于上」会被指代词命中，但「需求分析结果」是明确的产物对象
  assert.strictEqual(isPureContinuation('基于上一步的需求分析结果生成测试用例'), false);
});

// ---------------- 长需求文档不被误判 ----------------

t('含大量业务对象的需求文档不会被当成续做指令', () => {
  const doc = '登录模块需求：支持手机号+验证码登录。验证码6位、有效期5分钟。'
    + '密码错误5次锁定30分钟。运营可在后台配置锁定阈值。'
    + '后续如需继续优化登录流程，需先提交变更申请。';
  // 文中含「继续优化」四个字，也含大量业务对象 → 应判独立
  assert.strictEqual(isPureContinuation(doc), false, '需求文档被误判成续做指令');
});

// ---------------- 优化 vs 重新生成 ----------------

t('「继续优化」判 refine，「重新生成」判 regenerate', () => {
  assert.strictEqual(detectContinuationKind('继续优化'), 'refine');
  assert.strictEqual(detectContinuationKind('继续改进'), 'refine');
  assert.strictEqual(detectContinuationKind('重新生成'), 'regenerate');
  assert.strictEqual(detectContinuationKind('重做一遍'), 'regenerate');
  assert.strictEqual(detectContinuationKind('再来一次'), 'regenerate');
});

t('判定结果带可读理由（便于日志排查）', () => {
  const a = assessSelfContained('继续');
  assert.ok(a.reason && a.reason.length > 4, '缺少理由说明');
  const b = assessSelfContained('继续优化登录模块');
  assert.ok(b.reason && b.reason.length > 4, '缺少理由说明');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
