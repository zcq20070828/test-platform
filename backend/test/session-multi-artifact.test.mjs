/**
 * 会话级多产物（2026-11-25 · 对话改造第三步）
 *
 * 第三步要解决的问题：现在对话的边界是「任务」，一个任务 = 一次交付物生成。
 * 想让 AI 从「需求分析」做到「用例生成」，用户得退出、新建任务、
 * 把上一份产出再传一遍。会话让多个产物在同一个上下文里沉淀。
 *
 * ★ 最重要的设计不变量
 *
 *   会话**不参与执行**。任务仍是唯一执行单元（spawnAgentSession + 智能体 + skill）。
 *   会话只做分组。这样执行链路、门禁、审核、成本归属全都不用动，
 *   回滚只需让 session_id 全为 NULL。
 *
 * ★ 上线前踩到的坑（务必保留这条测试）
 *
 *   `sessions` 表**已存在**（QClaw 遗留：agent_id/status/ended_at），
 *   只在 migrate-from-json.js 里提及。第一版迁移用
 *   CREATE TABLE IF NOT EXISTS `sessions`，在已有旧表的库上静默跳过，
 *   然后往旧表插 title/project_key → Unknown column。
 *   若直接上生产会污染旧表。改名 chat_sessions 彻底避开。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database', '16-sessions.sql'), 'utf8');
const DAO = fs.readFileSync(path.join(here, '..', 'database', 'session-dao.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');

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

console.log('=== 会话级多产物 单元测试 ===');

// ---------------- 表名冲突（上线阻塞级）----------------

t('新表名是 chat_sessions，不碰已存在的 sessions 旧表', () => {
  assert.ok(/^CREATE TABLE IF NOT EXISTS `chat_sessions`/m.test(MIGRATION), '迁移脚本应建 chat_sessions');
  // 关键：不能有「实际执行」的建 sessions 语句。
  // 注释里提到 sessions 是允许的（我们在那里记录了改名原因）。
  const realCreateSessions = MIGRATION
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))            // 去掉注释行
    .some((l) => /CREATE TABLE.*`sessions`/.test(l));
  assert.ok(!realCreateSessions,
    '❌ 不能建 sessions：那张表已存在（QClaw 遗留），CREATE IF NOT EXISTS 会静默跳过然后插错列');
  assert.ok(!/INSERT INTO sessions \(|FROM sessions |UPDATE sessions /.test(DAO),
    'DAO 仍在操作旧 sessions 表');
  assert.ok(/INSERT INTO chat_sessions/.test(DAO), 'DAO 应写 chat_sessions');
});

t('迁移脚本记录了表名冲突的来龙去脉', () => {
  assert.ok(/sessions.*已经存在|已经存在.*sessions/.test(MIGRATION),
    '缺少为什么改名的说明，后来人会重犯');
});

// ---------------- 向后兼容 ----------------

t('session_id 可为 NULL（未归属会话＝改造前行为）', () => {
  assert.ok(/session_id` varchar\(36\) DEFAULT NULL/.test(MIGRATION), 'session_id 必须允许 NULL');
});

t('存量数据不需要回填', () => {
  // 迁移里不能有把历史任务强行塞进某个会话的语句
  assert.ok(!/UPDATE `?tasks`? SET `?session_id`? = '(?!NULL)/.test(MIGRATION),
    '不应回填存量任务归属');
});

t('session_seq 显式记录顺序（不靠 created_at 排序）', () => {
  assert.ok(/session_seq/.test(MIGRATION), '缺少 session_seq');
  // 同秒创建时 created_at 相同，靠它排序无法确定「上一份产物是谁」
  assert.ok(/ORDER BY session_seq ASC/.test(DAO), '应按 session_seq 排序');
});

// ---------------- 不改变执行者 ----------------

t('会话不参与执行：仍走 spawnAgentSession + 原智能体', () => {
  assert.ok(/const result = await spawnAgentSession\(task\.agent, chatInput/.test(SERVER),
    '任务执行路径被改动了');
});

t('挂载会话失败不影响任务创建', () => {
  const start = SERVER.indexOf('if (req.body.sessionId || req.body.newSession)');
  assert.ok(start > 0, '找不到会话挂载代码');
  const block = SERVER.slice(start, start + 1600);
  assert.ok(/try\s*\{/.test(block) && /catch/.test(block), '挂载会话必须包 try/catch');
  assert.ok(/不影响任务执行|不影响/.test(block), '缺少「失败不影响」的说明与处理');
  // 不能在 catch 里 return 错误——任务已经创建成功，不该因为分组失败而失败
  const catchBlock = block.slice(block.indexOf('} catch'));
  assert.ok(!/return res\.status/.test(catchBlock), '挂载失败不应让整个任务创建失败');
});

// ---------------- 鉴权 ----------------

t('挂载前校验会话归属，防止挂到别人的会话', () => {
  const start = SERVER.indexOf('if (req.body.sessionId || req.body.newSession)');
  const block = SERVER.slice(start, start + 1600);
  assert.ok(/getSessionOwner/.test(block), '未校验会话归属');
});

t('查询会话产物要鉴权', () => {
  const start = SERVER.indexOf("app.get('/api/sessions/:id/tasks'");
  assert.ok(start > 0, '找不到会话产物接口');
  const block = SERVER.slice(start, start + 900);
  assert.ok(/getSessionOwner/.test(block), '未校验归属');
  assert.ok(/403/.test(block), '无权时应返回 403');
});

// ---------------- 上游串联（会话优先）----------------

t('上游注入优先用会话关系，退回项目名匹配', () => {
  const start = SERVER.indexOf('async function enrichInputWithUpstreamRequirement');
  assert.ok(start > 0, '找不到上游注入函数');
  const block = SERVER.slice(start, start + 2400);
  assert.ok(/findUpstreamArtifact/.test(block), '未使用会话内的上游查找');
  assert.ok(/session: 'session'|source: 'session'/.test(block), '缺少「来自会话」的标记');
  // 会话没命中时要继续走老的项目名匹配，不能直接返回 null
  assert.ok(/taskDAO\.getTasks/.test(block), '会话未命中时未退回项目名匹配');
});

t('上游查找只找「当前任务之前」的产物', () => {
  assert.ok(/session_seq < \?/.test(DAO), '未限制 beforeSeq，可能取到当前任务自己的产物');
});

t('上游查找只认已完成的产物', () => {
  assert.ok(/status = 'completed'/.test(DAO), '未过滤未完成的任务，可能注入半成品');
});

// ---------------- 存储层健壮性 ----------------

t('会话标题不覆盖用户改过的', () => {
  assert.ok(/WHERE id = \? AND \(title IS NULL OR title = ''\)/.test(DAO),
    '回填标题会覆盖用户自定义标题');
});

t('会话 ID 用 UUID（与任务 ID 同格式）', () => {
  assert.ok(/crypto\.randomUUID\(\)/.test(DAO), '应使用 UUID');
});

t('会话列表带任务数与完成数', () => {
  assert.ok(/task_count/.test(DAO) && /completed_count/.test(DAO), '会话列表缺少统计字段');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
