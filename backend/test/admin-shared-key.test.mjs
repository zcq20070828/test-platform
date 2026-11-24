#!/usr/bin/env node
/**
 * 用户没配 Key 时用 admin 共享 Key 兜底（2026-11-24）
 *
 * 背景：生产平台 `.env` 的 DEEPSEEK_API_KEY 失效后，没配自己 Key 的普通用户
 * （76 个用户里的绝大多数）全部 401 失败，而配了 Key 的 admin 一切正常。
 *
 * 用户要求：「用户没配置 api key 的时候用 admin 账号配置的 key」。
 *
 * 回退顺序（三级）：
 *   1) 用户自己的默认 Key
 *   2) admin 共享 Key（管理员账号里 is_default=1 的那条）
 *   3) 平台 .env Key
 *
 * 三个必须守住的点：
 *   A. **不能把 admin 的 Key 泄露给用户**——接口只回「有没有共享 Key」这个布尔值，
 *      不返回 Key 内容、hint、甚至哪条 Key。失败文案里也不拼任何 Key 片段。
 *   B. **admin 换 Key 后，其他用户不能还在用旧的**——缓存必须一起清。
 *      user_api_keys 缓存 60 秒，且每次命中会滑动续期，光靠过期等不到。
 *   C. **解密失败不能静默当成「没有」**——LOCAL_JWT_SECRET 换过时密文解不开，
 *      若静默回退平台 Key，用户会以为在用 admin 的，实际在烧平台额度。
 *      必须打日志，让运维能看出来。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'api', 'index.ts'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'ApiKeySettingsView.vue'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== admin 共享 Key 兜底 ===');

/** 取函数体（从参数列表右括号后配对，避开默认参数里的 {}）
 *
 * 兼容 async / 同步函数：`async function foo(` 与 `function foo(` 都要能找到。
 */
function fnBody(name) {
  let start = SERVER.indexOf(`async function ${name}(`);
  if (start < 0) start = SERVER.indexOf(`function ${name}(`);
  assert.ok(start > 0, `找不到 ${name}`);
  const parenStart = SERVER.indexOf('(', start);
  let d = 0; let parenEnd = -1;
  for (let k = parenStart; k < SERVER.length; k += 1) {
    if (SERVER[k] === '(') d += 1;
    else if (SERVER[k] === ')') { d -= 1; if (d === 0) { parenEnd = k; break; } }
  }
  let depth = 0; let end = -1;
  for (let i = SERVER.indexOf('{', parenEnd); i < SERVER.length; i += 1) {
    if (SERVER[i] === '{') depth += 1;
    else if (SERVER[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > start, `${name} 解析失败`);
  return SERVER.slice(start, end + 1);
}

// ---------------- A) 回退顺序 ----------------
console.log('\n-- A. 三级回退 --');

t('★★ 新增 resolveAdminSharedKey：只取有默认 Key 的 admin', () => {
  const fn = fnBody('resolveAdminSharedKey');
  assert.ok(/FROM users u/.test(fn) && /JOIN user_api_keys k/.test(fn), '没有联表查 admin 的 Key');
  assert.ok(/k\.is_default = 1/.test(fn), '没要求是默认 Key');
  assert.ok(/u\.role = 'admin'/.test(fn), '没限定管理员账号');
  assert.ok(/ORDER BY u\.created_at ASC/.test(fn),
    '没固定顺序 —— 多个 admin 时兜底来源会随查询顺序漂移');
  assert.ok(/LIMIT 1/.test(fn), '没有限量，可能取到多条');
});

t('★★ resolveApiKey 回退顺序：用户 Key → admin 共享 → 平台 Key', () => {
  const fn = fnBody('resolveApiKey');
  // 先取用户自己的
  const userIdx = fn.indexOf('getDefaultApiKeyRecord(uid)');
  const adminIdx = fn.indexOf('resolveAdminSharedKey()');
  assert.ok(userIdx > 0 && adminIdx > 0, '缺少某一级回退');

  // admin 兜底必须只在该用户没拿到自己的 Key 时执行
  assert.ok(/if \(resolved\.source !== 'user'\)/.test(fn),
    'admin 兜底没有判断「用户自己没拿到 Key」，可能覆盖用户自己的 Key');
  assert.ok(adminIdx > userIdx, 'admin 兜底应在用户 Key 之后');

  // 平台 Key 是初始值（最低优先级），不能被提前赋成最终结果
  assert.ok(/let resolved = platform/.test(fn), '平台 Key 应是初始兜底值');
});

t('★ admin 来源有独立标记 source=admin（供诊断与成本区分）', () => {
  const fn = fnBody('resolveAdminSharedKey');
  assert.ok(/source: 'admin'/.test(fn), 'admin 共享 Key 没有专属 source 标记');
  const main = fnBody('resolveApiKey');
  assert.ok(/source: 'user'/.test(main) && /source: PLATFORM_API_KEY \? 'platform' : 'none'/.test(main),
    'user / platform 的标记被改坏了');
});

t('★★ admin 共享 Key 解密失败要告警（不能静默当没有）', () => {
  const fn = fnBody('resolveAdminSharedKey');
  assert.ok(/if \(!plain\)/.test(fn), '没有处理解密失败');
  const idx = fn.indexOf('if (!plain)');
  const block = fn.slice(idx, idx + 500);
  assert.ok(/console\.warn/.test(block), '解密失败没有告警');
  assert.ok(/return null/.test(block), '解密失败应返回 null 而不是拿空 Key 去调');
});

// ---------------- B) 缓存 ----------------
console.log('\n-- B. 缓存一致性 --');

t('★★ admin 改 Key 时清空全体缓存（否则其他用户还在用旧的）', () => {
  const fn = fnBody('invalidateUserApiKeyCache');
  assert.ok(/USER_KEY_CACHE\.delete\(uid\)/.test(fn), '没清当前用户');
  assert.ok(/USER_KEY_CACHE\.clear\(\)/.test(fn), 'admin 变更时没有清空全体缓存');
  // 必须判断是不是 admin
  assert.ok(/role.*admin/i.test(fn), '没有判断「变更者是不是 admin」');
});

t('★ 缓存清理失败不能阻断主流程', () => {
  const fn = fnBody('invalidateUserApiKeyCache');
  assert.ok(/try \{/.test(fn) && /catch/.test(fn), '缓存清理没有 try/catch 兜底');
});

// ---------------- C) 不泄露 admin 的 Key ----------------
console.log('\n-- C. 不泄露共享 Key --');

t('★★ 列表接口只回布尔值，不回 Key 内容', () => {
  const idx = SERVER.indexOf('adminSharedKeyAvailable:');
  assert.ok(idx > 0, '接口没有下发 adminSharedKeyAvailable');
  const line = SERVER.slice(idx, idx + 160);
  assert.ok(/!!\(await resolveAdminSharedKey\(\)\)/.test(line),
    '应只回布尔值（!!），不能把整个对象下发给前端');
  assert.ok(!/apiKey:/.test(line), '接口把 Key 明文下发给了前端');
});

t('★★ 失败诊断识别 source=admin（明确告知「用的是管理员的 Key」）', () => {
  const idx = SERVER.indexOf("rk.source === 'admin'");
  assert.ok(idx > 0, '失败诊断没处理 admin 来源');
  const block = SERVER.slice(idx, idx + 1200);
  assert.ok(/管理员共享/.test(block), '没说明用的是管理员的 Key');
  assert.ok(/管理员/.test(block), '没指引用户该找管理员');
  assert.ok(/scope = 'admin-shared-key-invalid'/.test(block), '缺 admin 共享失效的场景标记');
});

t('★★ 所有失败文案都不拼 Key 片段（会落库并下发前端）', () => {
  const idx = SERVER.indexOf("failure.category === 'auth'");
  const block = SERVER.slice(idx, idx + 4000);
  for (const [re, label] of [
    [/rk\.apiKey\.slice|rk\.apiKey\.substr/, '用户 Key 片段'],
    [/PLATFORM_API_KEY\.slice/, '平台 Key 片段'],
    [/adminShared[^;]*\.apiKey/, 'admin Key 片段'],
  ]) {
    assert.ok(!re.test(block), `失败文案里拼了 ${label}`);
  }
});

// ---------------- D) 前端提示 ----------------
console.log('\n-- D. 前端提示 --');

t('★★ 前端能拿到并展示「在用管理员共享 Key」', () => {
  assert.ok(/adminSharedKeyAvailable: boolean/.test(API), 'api 类型没加该字段');
  assert.ok(/adminSharedKeyAvailable: !!payload\.adminSharedKeyAvailable/.test(API), 'api 解析没带上该字段');
  assert.ok(/管理员共享的 Key/.test(VIEW), '页面没提示「在用管理员共享 Key」');
});

t('★ 提示要说明「配自己的 Key 会优先于共享 Key」', () => {
  assert.ok(/优先于上述共享 Key|优先/.test(VIEW), '没说明配自己的 Key 后优先级更高');
});

t('没有 Key 的提示在三种兜底情形下文案都准确', () => {
  // 有 admin 共享 → 说管理员共享；否则有平台 Key → 说平台；都没有 → 说必须先添加
  const idx = VIEW.indexOf('v-if="adminSharedKeyAvailable"');
  assert.ok(idx > 0, '提示没有优先判断 admin 共享 Key');
  const block = VIEW.slice(idx, idx + 900);
  assert.ok(/v-else-if="platformKeyAvailable"/.test(block), '没有「否则用平台 Key」的分支');
  assert.ok(/必须先添加一个 API Key/.test(block), '都没有时没说明必须先添加');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
