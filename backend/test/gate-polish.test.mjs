#!/usr/bin/env node
/**
 * 门禁「达标后收尾打磨」（2026-11-20）
 *
 * 改造前的真实状态：门禁达标即停。
 *   实测任务 5d1f488c：186 条用例里 24 条不可用
 *   （18 条预期结果不可判定 + 6 条步骤不合规），可用率 87.1% 刚过 85% 门槛，
 *   repair_rounds=0 —— 一轮都没修就交付给用户，用户仍需人工筛。
 *   而同样输入稍有波动掉到 85% 以下时，反而会修。
 *
 * 这个「刚好过线就交付」的行为是门禁自己造成的，不是模型变差了。
 *
 * 本次改造的约束（每条都对应一个可能踩的坑）：
 *   1) 达标但低于打磨目标 → 再跑一轮定向修复；
 *   2) 打磨与不达标修复分开计数，不互相占预算；
 *   3) 打磨后可用率下降 → 整轮回退到打磨前，不能把东西改坏；
 *   4) 打磨带来的净收益要落库（否则没法回答「这个功能到底有没有用」）；
 *   5) 可通过环境变量关掉（默认开启）。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'case-feedback-dao.js'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database', '14-gate-polish.sql'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 门禁达标后收尾打磨 ===');

/** 取出 while 门禁循环体 + 其后的落库块（打磨统计写在循环外，必须一起断言） */
function gateLoopBody() {
  const start = SERVER.indexOf('while (true) {');
  assert.ok(start > 0, '找不到门禁循环（while (true)）');
  // 落库块在循环之后（gateReport && applicable 分支内），到「不达标处理」为止
  const end = SERVER.indexOf('if (!gateReport.pass) {', start);
  assert.ok(end > start, '找不到门禁循环结束位置');
  return SERVER.slice(start, end);
}

t('★ 达标不再立即 break，而是先判断能否打磨', () => {
  const body = gateLoopBody();
  // 关键：原来这里是 `if (gateReport.pass) break;`，一行就把刚好过线的交付物放走了
  assert.ok(!/if \(gateReport\.pass\) break;/.test(body), '仍然是「达标即停」，打磨逻辑没接上');
  assert.ok(/if \(gateReport\.pass\) \{/.test(body), '没有对达标分支做判定');
  assert.ok(/if \(!canPolish\) break;/.test(body), '达标分支缺少「不满足打磨条件才 break」');
});

t('★ 打磨触发条件：达标、未到目标、还有轮次预算、有待修用例', () => {
  const body = gateLoopBody();
  const idx = body.indexOf('const canPolish');
  assert.ok(idx > 0, '没有 canPolish 判定');
  const cond = body.slice(idx, idx + 500);
  for (const [re, desc] of [
    [/gateReport\.pass/, '缺「已达标」'],
    [/CASE_QUALITY_AUTO_REPAIR/, '缺「自动修复开关」'],
    [/CASE_QUALITY_MAX_POLISH_ROUNDS/, '缺「打磨轮数预算」'],
    [/CASE_QUALITY_POLISH_TARGET/, '缺「打磨目标」'],
    [/usabilityRate < CASE_QUALITY_POLISH_TARGET/, '缺「未达目标才打磨」'],
    [/gateReport\.cases \|\| \[\]\)\.length > 0/, '缺「没有待修用例就不打磨」'],
  ]) {
    assert.ok(re.test(cond), desc);
  }
});

t('★ 打磨与不达标修复分开计数（不互相占轮次预算）', () => {
  const body = gateLoopBody();
  assert.ok(/let polishRound = 0;/.test(body), '没有独立的打磨计数器');
  // 打磨分支只加 polishRound，修复分支只加 repairRound
  const polishInc = body.indexOf('polishRound += 1');
  const repairInc = body.indexOf('repairRound += 1');
  assert.ok(polishInc > 0 && repairInc > 0, '有一个计数器没在递增');
  assert.ok(polishInc !== repairInc, '两个计数器混在一起了');
  // 修复轮次上限只约束修复分支
  const elseIdx = body.indexOf('} else {', body.indexOf('if (gateReport.pass) {'));
  const elseBlock = body.slice(elseIdx, elseIdx + 400);
  assert.ok(/repairRound >= CASE_QUALITY_MAX_REPAIR_ROUNDS/.test(elseBlock),
    '修复轮次上限不在修复分支里（会错误地拦住打磨）');
});

t('★★ 打磨改坏了要整轮回退（可用率下降就作废）', () => {
  const body = gateLoopBody();
  const idx = body.indexOf('if (polishBaseline && isPolishRound)');
  assert.ok(idx > 0, '没有打磨回退保护');
  const block = body.slice(idx, idx + 1400);
  assert.ok(/after\.usabilityRate < polishBaseline\.usabilityRate/.test(block),
    '没有比较打磨前后的可用率');
  assert.ok(/text = polishBaseline\.text/.test(block), '没有回退到打磨前内容');
  assert.ok(/break;/.test(block), '回退后没有结束循环（会继续消耗轮次）');
  // 回退后必须重新跑门禁，让 gateReport 与 text 一致
  assert.ok(/gateReport = checkCaseQuality\(/.test(block), '回退后没有重算门禁结果');
});

t('★ 打磨净收益落库（能回答「这功能有没有用」）', () => {
  const body = gateLoopBody();
  assert.ok(/polishBeforeRate/.test(body), '没有记录打磨前基线');
  const idx = body.indexOf('polishGain:');
  assert.ok(idx > 0, '没有写 polishGain');
  const block = body.slice(idx, idx + 300);
  // 回退的情况下净收益必须是 0 而不是负数（否则看起来像「打磨让质量下降」）
  assert.ok(/Math\.max\(0,/.test(block), ' polishGain 没有下限，回退时会记成负收益');
});

t('打磨轮次与修复轮次分别落库（趋势页能区分两类轮次）', () => {
  const body = gateLoopBody();
  assert.ok(/repairRounds: repairRound,/.test(body), 'repairRounds 没写');
  assert.ok(/polishRounds: polishRound,/.test(body), 'polishRounds 没写');
  assert.ok(/polishGain:/.test(body), 'polishGain 没写');
});

t('DAO 真的把两列写进库并读回来（不是只加了字段名）', () => {
  assert.ok(/polish_rounds/.test(DAO), 'DAO 没写 polish_rounds 列');
  assert.ok(/polish_gain/.test(DAO), 'DAO 没写 polish_gain 列');
  // INSERT 的列清单和占位符数量必须一致，否则整条落库会失败
  const insert = DAO.slice(DAO.indexOf('INSERT INTO task_quality_metrics'), DAO.indexOf('ON DUPLICATE KEY UPDATE'));
  const cols = insert.slice(insert.indexOf('(') + 1, insert.indexOf(')')).split(',').filter((s) => s.trim());
  const placeholders = insert.slice(insert.indexOf('VALUES')).match(/\?/g) || [];
  assert.strictEqual(placeholders.length, cols.length,
    `占位符 ${placeholders.length} 个 vs 列 ${cols.length} 个，数量不匹配`);
  assert.ok(/polishRounds: Number\(r\.polish_rounds\)/.test(DAO), '读取时没返回 polishRounds');
});

t('迁移文件补齐两列（幂等，可重复执行）', () => {
  assert.ok(/ADD COLUMN IF NOT EXISTS `polish_rounds`/.test(MIGRATION), '缺 polish_rounds 迁移');
  assert.ok(/ADD COLUMN IF NOT EXISTS `polish_gain`/.test(MIGRATION), '缺 polish_gain 迁移');
  assert.ok(/IF NOT EXISTS/.test(MIGRATION), '迁移不是幂等的');
});

t('打磨可通过环境变量关闭，且默认目标高于门槛', () => {
  assert.ok(/CASE_QUALITY_MAX_POLISH_ROUNDS = Number\(process\.env\.CASE_QUALITY_MAX_POLISH_ROUNDS\)/.test(SERVER),
    '打磨轮数不可通过环境变量配置');
  assert.ok(/CASE_QUALITY_POLISH_TARGET = Number\(process\.env\.CASE_QUALITY_POLISH_TARGET\)/.test(SERVER),
    '打磨目标不可通过环境变量配置');
  // 目标是「门槛 + 10 个百分点」，且不超过 1
  assert.ok(/CASE_QUALITY_DEFAULT_MIN_RATE \+ 0\.1/.test(SERVER), '打磨目标默认值不对');
  assert.ok(/Math\.min\(1,/.test(SERVER), '打磨目标没有封顶 1.0');
});

t('打磨轮的日志与前端提示可区分（不是伪装成普通修复）', () => {
  const body = gateLoopBody();
  assert.ok(/isPolishRound/.test(body), '没有区分本轮是打磨还是修复');
  assert.ok(/polish: isPolishRound/.test(body), 'SSE 事件没带 polish 标记');
  assert.ok(/收尾打磨/.test(body), '日志/提示里看不出这是打磨');
});

t('前端按 polish 标记显示不同文案（用户不会以为「一直没修好」）', () => {
  const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
  // 两处展示（时间线 + 实时消息）都要看 polish 标记
  const hits = STORE.match(/data\.polish|p\.polish/g) || [];
  assert.ok(hits.length >= 2, `只有 ${hits.length} 处判断 polish 标记，应至少 2 处`);
  assert.ok(/已达标，收尾打磨剩余/.test(STORE), '前端没有打磨专用文案');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
