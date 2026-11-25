/**
 * 「继续」的上下文全部来自数据库（2026-11-25）
 *
 * 用户指出：「上下文不进库的吗，后端从数据库查上下文或查任务不就可以知道
 * 最近一个任务是哪个智能体执行吗」——完全正确，而且这是更可靠的做法。
 *
 * 上一轮我把它说复杂了（建议前端传 chatMode.taskId / sessionId）。
 * 实际上 tasks 表里就有 user_id / agent_id / created_at / status / session_id，
 * 后端查一次就能确定「这个用户最近一个任务是哪个智能体跑的」，
 * 不依赖前端传参，也不会因为前端状态漂移而指错。
 *
 * 但这轮实测挖出两个真实缺陷（都已修）：
 *
 *   1. 只查 status='completed' —— 用户最近第 3 个任务是 failed 的用例生成，
 *      说「继续」时很可能就是想重跑它，筛掉后跳到更早的任务，指错对象。
 *
 *   2. 判据「input ≥ 100 字」误伤 —— 分步测试里
 *      「基于上一步的需求分析结果生成测试用例」只有 18 字、
 *      「经过3轮都还没达到审核通过标准，那就针对性修改吧」只有 24 字，
 *      都是真实且有交付物的任务，却因输入短被排除，
 *      导致「继续」找不到上一份、退化成全新重跑。
 *      正确的判据是「是不是空壳指令」而不是「够不够长」。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'task-dao.js'), 'utf8');

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

console.log('=== 「继续」上下文来自数据库 单元测试 ===');

/** 取 continueHint 判定块 */
function continueBlock() {
  const start = SERVER.indexOf('let continueHint = null');
  assert.ok(start > 0, '找不到 continueHint');
  const end = SERVER.indexOf('if (!targetAgent && enrichedInput)', start);
  assert.ok(end > start, '找不到块结束');
  return SERVER.slice(start, end);
}

// ---------------- 上下文来源 ----------------

t('「继续」的上下文来自数据库查询，不依赖前端传参', () => {
  const block = continueBlock();
  assert.ok(/taskDAO\.getTasks/.test(block), '未查数据库');
  assert.ok(/userId/.test(block), '未按用户过滤（会拿到别人的任务）');
  // 不该要求前端提供 continueFromTaskId 之类
  assert.ok(!/req\.body\.continueFrom/.test(block), '依赖了前端传参，前端状态漂移时会指错');
});

t('不筛 status —— 最近的失败任务也算「上一个」', () => {
  const block = continueBlock();
  assert.ok(!/status: 'completed'/.test(block),
    '仍只查 completed：用户最近一个若是 failed，「继续」会跳到更早的任务上');
  assert.ok(/prev\.status/.test(block), '未记录上一个任务的状态（应让用户知道接的是个失败任务）');
});

t('不筛 agentId —— 跨智能体取最近任务', () => {
  const block = continueBlock();
  assert.ok(!/agentId: agentId,/.test(block), '仍按当前智能体限定查找');
});

t('排序带 id 次级键（同秒创建时顺序稳定）', () => {
  assert.ok(/ORDER BY created_at DESC, id DESC LIMIT/.test(DAO),
    '只按 created_at 排序，同一秒创建的两个任务顺序不确定，「最近一个」就没有确定答案');
});

t('任务上记录 continuedFrom 并可带出状态', () => {
  assert.ok(/continuedFrom: continueHint \? continueHint\.taskId/.test(SERVER),
    '任务未记录续做来源');
  const block = continueBlock();
  assert.ok(/status: prev\.status/.test(block), 'continueHint 未带出上一个任务的状态');
});

// ---------------- 空壳判定（替代长度门槛）----------------

/** 取 isSkeletonInput 并实测 */
function loadSkeleton() {
  const start = SERVER.indexOf('const isSkeletonInput');
  assert.ok(start > 0, '找不到 isSkeletonInput');
  const end = SERVER.indexOf('};', start) + 2;
  const fnSrc = SERVER.slice(start, end);
  // REVISE_REF_RE 定义在 isSkeletonInput 之前，要从函数所在函数的开头找
  const fnStart = SERVER.lastIndexOf('async function enrichInputWithRecentContext', start);
  const refMatch = SERVER.slice(fnStart, start).match(/const REVISE_REF_RE = (\/.+\/);/);
  assert.ok(refMatch, '找不到 REVISE_REF_RE');
  return new Function(`${refMatch[0]}\n${fnSrc}\nreturn isSkeletonInput;`)();
}

t('真实的短输入任务不被判为空壳（这是实测误伤的修复）', () => {
  const sk = loadSkeleton();
  // 这两条都是库里真实存在的任务，都有完整交付物
  assert.strictEqual(sk('经过3轮都还没达到审核通过标准，那就针对性修改吧'), false,
    '24 字真实改稿指令被判空壳');
  assert.strictEqual(sk('基于上一步的需求分析结果生成测试用例'), false,
    '18 字真实任务被判空壳');
});

t('空壳指令被正确排除', () => {
  const sk = loadSkeleton();
  for (const v of ['继续', '继续优化', '重新生成刚才那份', '你好']) {
    assert.strictEqual(sk(v), true, `「${v}」应判为空壳`);
  }
});

t('长上传内容不被判空壳', () => {
  const sk = loadSkeleton();
  assert.strictEqual(sk('【用户上传的文档内容】\n\n=== 附件: 需求文档.docx ===\n\n大量正文...'), false);
});

t('旧的「input ≥ 100 字」门槛已移除', () => {
  const start = SERVER.indexOf('async function enrichInputWithRecentContext');
  const end = SERVER.indexOf('async function enrichInputWithTaskReferences', start);
  const fn = SERVER.slice(start, end);
  assert.ok(!/String\(t\.input\)\.length >= 100/.test(fn),
    '旧门槛仍在，会把分步测试的短输入任务全部排除');
});

t('仍然排除「没交付物」的任务（result 过短）', () => {
  const start = SERVER.indexOf('async function enrichInputWithRecentContext');
  const fn = SERVER.slice(start, start + 6000);
  assert.ok(/String\(t\.result\)\.length > 200/.test(fn), '未排除无交付物的任务');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
