/**
 * 审核不通过重试：在上一版基础上改，而不是从零重写（2026-11-25）
 *
 * 用户问「审核不通过的时候重试是在上一轮基础上改还是重新生成」。查代码发现
 * 分两条路：
 *
 *   A. 门禁已达标（可用率过阈值）→ callDeepSeekRewrite 局部改写
 *      prompt 里带【现有交付物】，这是真正的"在上一轮基础上改"
 *
 *   B. 门禁未达标 → executeTaskAsync 重新跑智能体
 *      **原来只拼「原始需求 + 问题清单」，完全不带上一版** ——
 *      模型看不到自己上次写了什么，只能从零重写。
 *
 * B 的后果有两类浪费：
 *   1. 上一版做对的部分被重写，可能改出新问题（实测有过越改越差的案例）
 *   2. 问题清单是针对上一版说的（「TC-122 断言矛盾」），
 *      模型没有那一版就只能猜 TC-122 长什么样
 *
 * 本测试守住 B 分支现在会带上一版，且有防推倒重来的约束。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
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

console.log('=== 重试带上一版交付物 单元测试 ===');

/** 取「门禁未达标」重试分支的代码块 */
function retryRebuildBlock() {
  const anchor = SERVER.indexOf('门禁未达标：需要重做主体内容');
  assert.ok(anchor > 0, '找不到门禁未达标分支');
  const end = SERVER.indexOf('// 串行调用3个审核智能体', anchor);
  assert.ok(end > anchor, '找不到分支结束位置');
  return SERVER.slice(anchor, end);
}

t('门禁未达标分支现在会带上一版交付物', () => {
  const block = retryRebuildBlock();
  assert.ok(/prevResult/.test(block), '未捕获上一版内容');
  assert.ok(/上一版交付物/.test(block), '未把上一版拼进输入');
});

t('明确要求「在上一版基础上修正，不要推倒重写」', () => {
  const block = retryRebuildBlock();
  assert.ok(/在上一版基础上修正/.test(block), '缺少核心指令');
  assert.ok(/不要推倒重写/.test(block), '未禁止推倒重写——模型看到旧版全文容易照抄或全改');
});

t('要求按编号定位到上一版对应行（问题清单点名了编号时）', () => {
  const block = retryRebuildBlock();
  assert.ok(/按编号定位/.test(block), '未要求按编号定位');
  assert.ok(/不要重新编号/.test(block), '未禁止重新编号');
});

t('要求输出完整交付物（不是差异片段）', () => {
  const block = retryRebuildBlock();
  assert.ok(/必须输出完整的交付物|必须输出完整/.test(block), '未要求输出完整交付物');
});

t('仍保留「只改问题清单指出的地方」', () => {
  const block = retryRebuildBlock();
  assert.ok(/只改问题清单指出的地方/.test(block), '问题范围约束丢失');
});

t('体积超限时降级为「待修条目原文」而不是整份塞入', () => {
  const block = retryRebuildBlock();
  assert.ok(/PREV_FULL_LIMIT/.test(block), '缺少体积上限');
  assert.ok(/RETRY_PREV_DELIVERABLE_LIMIT/.test(block), '上限不可配置');
  assert.ok(/待修正条目.*原文|待修条目原文/.test(block), '超限时未降级为条目原文');
});

t('上一版的门禁结论一起给出（让模型知道上一版好到什么程度）', () => {
  const block = retryRebuildBlock();
  assert.ok(/prevStat/.test(block), '未给上一版统计');
  assert.ok(/条可用/.test(block), '统计内容缺失');
});

t('prevResult 在 executeTaskAsync 之前捕获（否则会被新结果覆盖）', () => {
  const block = retryRebuildBlock();
  const captureAt = block.indexOf('const prevResult');
  const execAt = block.indexOf('await executeTaskAsync(task)');
  assert.ok(captureAt > 0, '找不到 prevResult 捕获');
  assert.ok(execAt > captureAt, 'prevResult 在 executeTaskAsync 之后才捕获，会被覆盖成新结果');
});

t('originalInput 不被累积污染（每次重试都是「原始需求 + 本轮 guide」）', () => {
  // originalInput 只在任务创建时赋值一次
  const assigns = SERVER.match(/task\.originalInput\s*=\s*(?!task\.originalInput)/g) || [];
  assert.strictEqual(assigns.length, 0, 'originalInput 被重新赋值，多轮重试会累积污染');
  // 拼接时必须用 originalInput 而不是 task.input
  const block = retryRebuildBlock();
  assert.ok(/task\.input = task\.originalInput \+ improvementGuide/.test(block),
    '未以 originalInput 为基准拼接，导报会累积');
});

/** 取「门禁已达标 → 局部改写」那段代码
 *
 * 注意：「门禁已客观达标」在文件里出现两次——16044 行是常量注释，
 * 16330 行才是真正的分支。必须用分支里的日志文案定位，不能用裸短语。
 */
function localRewriteBlock() {
  const anchor = SERVER.indexOf('门禁已客观达标（${(existingGate.usabilityRate');
  assert.ok(anchor > 0, '找不到达标分支');
  const end = SERVER.indexOf('} else {', anchor);
  assert.ok(end > anchor, '找不到分支边界');
  return SERVER.slice(anchor, end);
}

t('门禁达标分支的局部改写路径不变（那是本来正确的）', () => {
  assert.ok(/现有交付物/.test(SERVER), '局部改写分支的「现有交付物」注入丢了');
  const block = localRewriteBlock();
  assert.ok(/callDeepSeekRewrite/.test(block), '达标分支不再走局部改写');
});

t('局部改写条数缩水超 10% 仍退回全量重生成（保护不丢）', () => {
  const block = localRewriteBlock();
  assert.ok(/beforeCount \* 0\.9/.test(block), '条数缩水保护被删');
  assert.ok(/退回全量重生成/.test(block), '缺少回退路径');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
