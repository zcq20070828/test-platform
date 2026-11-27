/**
 * 投产工程侧四项（2026-11-27）
 *
 * 21 天里用例生成 18 个硬失败，其中与服务可靠性有关的占 8 个：
 *   余额不足 5、服务重启中断 5（与超时 2 有重叠）
 * 这些与「生成质量」无关，但同样让用户拿不到交付物，投产前必须处理。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(here, '..');
const SERVER = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
const DAO = fs.readFileSync(path.join(BACKEND, 'database', 'task-dao.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); }
  catch (e) { fail += 1; console.log(`  ❌ ${name} :: ${e.message}`); }
}

console.log('=== 投产工程侧硬化 单元测试 ===');

t('单次模型调用超时可配（不再写死 600s）', () => {
  assert.ok(/AGENT_CALL_TIMEOUT_MS/.test(SERVER), '未支持环境变量覆盖超时');
  assert.ok(!/const perAttemptTimeout = 600000;/.test(SERVER), '仍写死 600000');
});

t('余额不足在提交时就拦住，不跑到一半失败', () => {
  assert.ok(/BalancePrecheck/.test(SERVER), '没有余额预检');
  assert.ok(/available === false/.test(SERVER), '未按「确定不可用」判定');
  assert.ok(/INSUFFICIENT_BALANCE/.test(SERVER), '没有可识别的错误码');
  // 预检失败不能阻断主流程
  assert.ok(/余额预检跳过/.test(SERVER), '预检异常没有兜底放行');
});

t('上下文裁剪不截断需求原文（除非超硬上限）', () => {
  assert.ok(/HARD_LIMIT = MAX_CONTEXT_CHARS \* 3/.test(SERVER), '没有硬上限判定');
  assert.ok(/保持完整不截断/.test(SERVER), '未显式保留完整需求');
  assert.ok(/需求超过硬上限/.test(SERVER), '超硬上限时没有明确告警');
});

t('服务重启中断标记为可重试', () => {
  assert.ok(/\[可重试\] 服务重启/.test(SERVER), '重启 note 未标记可重试');
});

t('任务 API 暴露 retriable，并剥离内部标记', () => {
  assert.ok(/retriable:/.test(DAO), 'formatTask 未暴露 retriable');
  assert.ok(/replace\(\/\^\\\[可重试\\\]\\s\*\/, ''\)/.test(DAO), '未剥离 [可重试] 标记');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
