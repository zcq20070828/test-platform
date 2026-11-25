/**
 * 意图识别补强（2026-11-25 · 对话改造第二步）
 *
 * 第二步不是「把正则全换成模型」——那样每次对话都要多一次 LLM 调用，
 * 而绝大多数指令正则判得又准又免费。真正要做的是**补掉正则的确定性缺陷**。
 *
 * 实测挖出三类真实缺陷：
 *
 * 1. **编号区间被截断（最严重）**
 *    「把 TC-001 到 TC-014 的预期结果改得更具体」
 *    → 只抓到首尾 2 个编号，中间 12 条被静默丢弃。
 *    用户说改 14 条实际只改 2 条，界面还不报错——静默失败最坏。
 *
 * 2. **短问句被当成修改指令**
 *    「卡住了吗」→ refine → 触发变更计划生成，用户只是问状态却收到一张「打算改这些」的卡片。
 *
 * 3. **动作词表漏了最基础的「改」**
 *    「改一下」「改得更具体」不在表里；「修改」「改成」在。
 *    结果「把 TC-001 的预期改一下吗」差点被判成提问。
 *
 * 修这三类时还踩出一个反向误伤：
 *    单纯把「吗/呢」加进疑问词，会把「把 TC-001 的预期改一下吗」
 *    这类**带明确动作的改稿指令**判成提问。所以语气词必须分级判断。
 */
import assert from 'node:assert';
import { classifyChatIntent, expandIdRange } from '../lib/chat-intent.js';
import { shouldPlanBeforeExecute } from '../lib/change-plan.js';

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

console.log('=== 意图识别补强 单元测试 ===');

// ---------------- 缺陷 1：编号区间 ----------------

t('「TC-001 到 TC-014」展开成 14 条（原来只有 2 条）', () => {
  const ids = expandIdRange('把 TC-001 到 TC-014 的预期结果改得更具体');
  assert.strictEqual(ids.length, 14, `实际 ${ids.length} 条`);
  assert.strictEqual(ids[0], 'TC-001');
  assert.strictEqual(ids[13], 'TC-014');
});

t('区间支持 ~ / 至 / 到 三种写法', () => {
  assert.strictEqual(expandIdRange('TC-001~TC-003').length, 3);
  assert.strictEqual(expandIdRange('TC-001至TC-003').length, 3);
  assert.strictEqual(expandIdRange('TC-001 到 TC-003').length, 3);
});

t('倒序区间也能正确展开', () => {
  const ids = expandIdRange('TC-014 到 TC-001');
  assert.strictEqual(ids.length, 14);
  assert.ok(ids.includes('TC-007'));
});

t('补零宽度保持原样（TC-01 不会变成 TC-001）', () => {
  const ids = expandIdRange('TC-01 到 TC-04');
  assert.deepStrictEqual(ids, ['TC-01', 'TC-02', 'TC-03', 'TC-04']);
});

t('超大区间不展开（避免 TC-001 到 TC-999 把执行拖死）', () => {
  assert.strictEqual(expandIdRange('TC-001 到 TC-999').length, 0);
});

t('分类结果里带出完整区间编号', () => {
  const r = classifyChatIntent('把 TC-001 到 TC-014 的预期结果改得更具体', { hasDeliverable: true });
  assert.strictEqual(r.mode, 'surgical');
  assert.strictEqual(r.caseIds.length, 14, `实际 ${r.caseIds.length} 条`);
});

t('区间 + 单点混用时去重', () => {
  const r = classifyChatIntent('TC-001 到 TC-003 和 TC-005 都改具体', { hasDeliverable: true });
  assert.deepStrictEqual(r.caseIds.sort(), ['TC-001', 'TC-002', 'TC-003', 'TC-005']);
});

// ---------------- 缺陷 2：短问句 ----------------

t('短问句「卡住了吗」判为提问（不再触发变更计划）', () => {
  const r = classifyChatIntent('卡住了吗', { hasDeliverable: true });
  assert.strictEqual(r.mode, 'question');
  const g = shouldPlanBeforeExecute(r, { deliverableChars: 140000 });
  assert.strictEqual(g.needed, false, '问句不该生成变更计划');
});

t('「还能继续吗」「跑完了吗」判为提问', () => {
  assert.strictEqual(classifyChatIntent('还能继续吗', { hasDeliverable: true }).mode, 'question');
  assert.strictEqual(classifyChatIntent('跑完了吗', { hasDeliverable: true }).mode, 'question');
});

t('「这样行不行呢」判为提问', () => {
  assert.strictEqual(classifyChatIntent('这样行不行呢', { hasDeliverable: true }).mode, 'question');
});

// ---------------- 缺陷 3 + 反向误伤：语气词分级 ----------------

t('带语气词但无动作 → 仍判提问', () => {
  assert.strictEqual(classifyChatIntent('卡住了吗', { hasDeliverable: true }).mode, 'question');
});

t('带语气词但有明确动作 → 判修改指令（不被误伤成提问）', () => {
  // 这是加「吗/呢」到疑问词后踩出来的反向误伤
  const r = classifyChatIntent('把预期结果改成具体的吧', { hasDeliverable: true });
  assert.notStrictEqual(r.mode, 'question', '带「改成」的指令不该被当成提问');
});

t('带语气词且有编号 → 判定点修改', () => {
  const r = classifyChatIntent('把 TC-001 的预期改一下吗', { hasDeliverable: true });
  assert.strictEqual(r.mode, 'surgical', `实际 ${r.mode}`);
});

t('动作词表覆盖最基础的「改」', () => {
  // 原表只有「改成/改为/修改」，漏了光秃秃的「改」
  for (const s of ['改一下', '改得更具体', '改具体', '整改']) {
    const r = classifyChatIntent(`帮我把预期结果${s}`, { hasDeliverable: true });
    assert.notStrictEqual(r.mode, 'question', `「${s}」未被识别为修改动作`);
  }
});

// ---------------- 原有行为不能回归 ----------------

t('原有五种模式的判定不变', () => {
  const cases = [
    ['整体感觉不够严格', 'refine'],
    ['重新生成', 'regenerate'],
    ['再加 5 条边界用例', 'append'],
    ['为什么没覆盖异常', 'question'],
    ['把质量最差的 3 条用例的预期结果改得更具体，要带明确状态码和字段名', 'surgical'],
  ];
  for (const [msg, expect] of cases) {
    const r = classifyChatIntent(msg, { hasDeliverable: true });
    assert.strictEqual(r.mode, expect, `「${msg}」→ ${r.mode}，期望 ${expect}`);
  }
});

t('5 条真实生产历史指令全部判定正确', () => {
  // 从生产 chat_history 里取到的真实指令
  const real = [
    ['综合评分不高，请优化', 'refine'],
    ['既然定向修复了，怎么没输出交付物', 'question'],
    ['重新生成', 'regenerate'],
    ['把质量最差的 3 条用例的预期结果改得更具体，要带明确状态码和字段名', 'surgical'],
  ];
  for (const [msg, expect] of real) {
    const r = classifyChatIntent(msg, { hasDeliverable: true });
    assert.strictEqual(r.mode, expect, `「${msg}」→ ${r.mode}，期望 ${expect}`);
  }
});

t('无编号的模糊修改 → refine，再由第一步给变更计划确认', () => {
  // 「这条能不能改得更具体吗」没有编号也没有数量，
  // 归 refine 是对的：第一步会先给变更计划让用户确认具体改哪几条，
  // 而不是盲改。两步配合才能覆盖这种情况。
  const r = classifyChatIntent('这条能不能改得更具体吗', { hasDeliverable: true });
  assert.strictEqual(r.mode, 'refine');
  const g = shouldPlanBeforeExecute(r, { deliverableChars: 140000 });
  assert.strictEqual(g.needed, true, '模糊指令应走变更计划确认');
});

t('没有交付物时仍然直接重新生成', () => {
  const r = classifyChatIntent('随便改改', { hasDeliverable: false });
  assert.strictEqual(r.mode, 'regenerate');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
