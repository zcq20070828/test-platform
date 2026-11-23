#!/usr/bin/env node
/**
 * 「默认 API Key」是用户级的，不是平台级的（2026-11-20）
 *
 * 用户明确指出：「API KEY 配置里面的『设为默认』是设为用户的默认 key，
 * 不是设为平台的默认 key。别搞错了」。
 *
 * 核查结论：后端逻辑本来就是用户级（所有 SQL 都带 WHERE user_id = ?），
 * 但存在两处真实隐患，本文件把它们固化成不变量：
 *
 *   A. 语义与隔离：设默认只改自己的那一把，任何人都不该能改到别人的，
 *      也不该能改到平台兜底 Key（那是 .env 的 PLATFORM_API_KEY）。
 *   B. 数据库兜底：原实现只靠 DAO 的事务维护「每用户至多一个默认」，
 *      DB 层没有约束。一旦并发或漏了事务，就会出现同一用户两条默认，
 *      而查询用 LIMIT 1 静默取一条 —— 症状是「明明设了默认，用的却是另一把」。
 *      现在用生成列 + 唯一索引强制。
 *
 * 为什么这两点必须一起做：只改注释不改约束，等于「文档说不会错，代码允许错」。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'user-api-key-dao.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database', '11-user-api-keys.sql'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database', '15-user-default-key-unique.sql'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'ApiKeySettingsView.vue'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 默认 API Key 是用户级 ===');

// ---------------- A) 语义与隔离 ----------------
console.log('\n-- A. 语义与隔离 --');

t('★★ 设默认只影响自己的 Key（每条 SQL 都必须带 user_id）', () => {
  const start = DAO.indexOf('export async function setDefaultApiKey');
  const fn = DAO.slice(start, DAO.indexOf('export async function markApiKeyVerified'));
  // 任何 UPDATE 都不允许只按 id 定位
  const updates = fn.match(/UPDATE user_api_keys[^`'"]*/g) || [];
  assert.ok(updates.length >= 2, `设默认只有 ${updates.length} 条 UPDATE`);
  for (const u of updates) {
    assert.ok(/WHERE user_id = \?/.test(u), `有一条 UPDATE 没带 user_id 限定：${u}`);
  }
  // 存在性校验也必须限定用户，否则能用别人的 keyId 探测/越权
  assert.ok(/SELECT id FROM user_api_keys WHERE user_id = \? AND id = \?/.test(fn),
    '存在性校验没限定用户，可能越过用户边界');
});

t('★★ 设默认不需要管理员权限（它是个人设置）', () => {
  const start = SERVER.indexOf("app.post('/api/user/api-keys/:id/default'");
  const block = SERVER.slice(start, start + 900);
  // 只要求登录，不要求 admin/role 判断
  assert.ok(/authenticate/.test(block), '缺登录校验');
  assert.ok(!/isAdmin|role\s*===\s*'admin'|requireAdmin/.test(block),
    '设默认加了管理员校验——它是用户对自己 Key 的设置，不该要求管理员');
});

t('★ 平台 Key 与用户 Key 是两条完全独立的路径', () => {
  // 平台 Key 来自环境变量，用户无法通过任何接口修改
  assert.ok(/const PLATFORM_API_KEY = process\.env\.DEEPSEEK_API_KEY/.test(SERVER),
    '平台 Key 不再来自环境变量');
  const start = SERVER.indexOf('async function resolveApiKey');
  const fn = SERVER.slice(start, start + 2600);
  // 解析顺序：用户默认 → 平台兜底
  assert.ok(/getDefaultApiKeyRecord/.test(fn), '解析时没读用户默认 Key');
  assert.ok(/source: 'user'/.test(fn) && /source: PLATFORM_API_KEY \? 'platform' : 'none'/.test(fn),
    '没有区分 user / platform 两个来源');
  // 用户没有 Key 时才用平台 Key
  const userIdx = fn.indexOf('let resolved = platform');
  const recIdx = fn.indexOf('getDefaultApiKeyRecord');
  assert.ok(userIdx > 0 && recIdx > userIdx, '用户 Key 应在平台兜底之后覆盖（没有用户 Key 才用平台）');
});

t('★ 缓存按用户分键（不能把 A 的 Key 缓存给 B）', () => {
  assert.ok(/const USER_KEY_CACHE = new Map\(\)/.test(SERVER), '缺用户 Key 缓存');
  assert.ok(/USER_KEY_CACHE\.get\(uid\)/.test(SERVER), '缓存没按 userId 取');
  assert.ok(/USER_KEY_CACHE\.set\(uid,/.test(SERVER), '缓存没按 userId 存');
  assert.ok(/invalidateUserApiKeyCache\(userId\)/.test(SERVER), '改 Key 后没失效缓存');
});

t('★ 界面明确说明「默认」是个人默认，不是平台配置', () => {
  assert.ok(/你的个人默认|个人默认/.test(VIEW), '页面没说明默认是个人设置');
  assert.ok(/只影响你自己|不会改变其他用户|不是平台级配置/.test(VIEW), '没说明作用范围');
});

t('★ 标签用「我的默认」而不是「默认」（避免读成平台级）', () => {
  assert.ok(/我的默认/.test(VIEW), '标签仍是「默认」，容易被读成平台级配置');
});

t('设默认的成功提示说清作用域', () => {
  const start = VIEW.indexOf('async function handleSetDefault');
  const fn = VIEW.slice(start, start + 500);
  assert.ok(/你的默认 Key|只影响你自己/.test(fn), '提示没说明是用户级设置');
});

// ---------------- B) 数据库兜底 ----------------
console.log('\n-- B. 数据库约束兜底 --');

t('★★ 迁移用生成列 + 唯一索引强制「每用户至多一个默认」', () => {
  assert.ok(/default_owner/.test(MIGRATION), '缺 default_owner 生成列');
  assert.ok(/GENERATED ALWAYS AS \(CASE WHEN `is_default` = 1 THEN `user_id` ELSE NULL END\)/.test(MIGRATION),
    '生成列逻辑不对：应只在 is_default=1 时等于 user_id');
  assert.ok(/ADD UNIQUE KEY `uk_user_default_owner` \(`default_owner`\)/.test(MIGRATION),
    '缺唯一索引');
});

t('★ 生成列只在默认时非空（非默认 Key 可以多条共存）', () => {
  // 唯一索引不约束 NULL，所以非默认 Key 不受限——这是设计要点，不能被「优化」掉
  assert.ok(/ELSE NULL/.test(MIGRATION), '生成列应为 NULL 而非空串，否则非默认 Key 也会冲突');
});

t('★ 建索引前先自愈历史脏数据（否则 ALTER 会失败）', () => {
  const selfHealIdx = MIGRATION.indexOf('SET k.`is_default` = 0');
  const alterIdx = MIGRATION.indexOf('ADD UNIQUE KEY');
  assert.ok(selfHealIdx > 0, '缺历史脏数据自愈');
  assert.ok(alterIdx > selfHealIdx, '必须先自愈再建唯一索引，否则已有多默认时建不上');
  // 自愈要保留最早那条，不能把默认全清掉
  assert.ok(/MIN\(`created_at`\)/.test(MIGRATION), '自愈没保留最早的一条');
});

t('★ 生成列语义与建表注释一致（都是用户级）', () => {
  assert.ok(/是否该用户的默认 Key/.test(SCHEMA), '建表注释没说清是用户级');
  assert.ok(/每用户至多一个默认|该用户的默认/.test(MIGRATION), '迁移注释没说清是用户级');
});

t('DAO 的默认 Key 查询限定用户', () => {
  const fn = DAO.slice(DAO.indexOf('export async function getDefaultApiKeyRecord'), DAO.indexOf('export async function countApiKeys'));
  assert.ok(/WHERE user_id = \? AND is_default = 1/.test(fn), '查默认 Key 没限定用户');
});

t('第一条 Key 自动设为该用户的默认（不会变成平台默认）', () => {
  const fn = DAO.slice(DAO.indexOf('export async function createApiKey'), DAO.indexOf('export async function updateApiKey'));
  assert.ok(/const isDefault = existing === 0 \? 1 : 0/.test(fn), '缺「第一条自动默认」');
  // 计数与插入都必须限定 user_id
  assert.ok(/countApiKeys\(userId\)/.test(fn), '计数没按用户统计');
  assert.ok(/INSERT INTO user_api_keys \(id, user_id,/.test(fn), '插入没带 user_id');
});

t('删除默认 Key 只在本人范围内顶替', () => {
  const fn = DAO.slice(DAO.indexOf('export async function deleteApiKey'), DAO.indexOf('export async function setDefaultApiKey'));
  assert.ok(/WHERE user_id = \? ORDER BY created_at ASC LIMIT 1/.test(fn),
    '顶替默认时没限定用户，可能把别人的 Key 设成默认');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
