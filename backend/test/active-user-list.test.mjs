#!/usr/bin/env node
/**
 * 「活跃用户」可查看清单（2026-11-25）
 *
 * 用户反馈：数据统计页的「活跃用户」只有一个数字，看不出是谁。
 * 要求：能查看活跃用户清单，用户名、姓名、活跃次数都要能看到。
 *
 * 三个必须守住的点：
 *
 * A. **口径必须与卡片数字一致**
 *    卡片的值来自 getTodayStats 的 `COUNT(DISTINCT user_id)`，
 *    明细来自 getActiveUserList。两者口径不一致会出现
 *    「卡片显示 1 人、点开 3 个人」这种自相矛盾。
 *    所以明细必须同样以「今天创建的任务数」聚合，一个用户一行。
 *
 * B. **普通用户不能看到全平台的人**
 *    卡片对普通用户本来只显示自己的数据（getTodayStats 传 userId）。
 *    明细接口若不区分角色，普通用户就能看到所有人——是权限泄露。
 *
 * C. **姓名可能为空**
 *    老数据 / SSO 用户 name 为空。要用 username 兜底，
 *    否则前端出现空白格，用户不知道那行是谁。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'stats-dao.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'StatsView.vue'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 活跃用户清单 ===');

function fnBody(src, name) {
  let start = src.indexOf(`async function ${name}(`);
  if (start < 0) start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `找不到 ${name}`);
  const parenStart = src.indexOf('(', start);
  let d = 0; let parenEnd = -1;
  for (let k = parenStart; k < src.length; k += 1) {
    if (src[k] === '(') d += 1;
    else if (src[k] === ')') { d -= 1; if (d === 0) { parenEnd = k; break; } }
  }
  let depth = 0; let end = -1;
  for (let i = src.indexOf('{', parenEnd); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

// ---------------- A) 口径一致 ----------------
console.log('\n-- A. 口径与卡片数字一致 --');

t('★★ 明细与卡片用同一口径：今天创建的任务数去重用户', () => {
  const card = fnBody(DAO, 'getTodayStats');
  const list = fnBody(DAO, 'getActiveUserList');

  // 卡片的 active_users 是 COUNT(DISTINCT user_id) + WHERE DATE(created_at)=?
  assert.ok(/COUNT\(DISTINCT user_id\) as active_users/.test(card), '卡片的计数口径变了');

  // 明细必须也是「DATE(created_at) = 今天」+ 按 user 聚合
  assert.ok(/DATE\(t\.created_at\) = \?/.test(list), '明细没有按「今天创建」过滤');
  assert.ok(/GROUP BY\s+t\.user_id/.test(list), '明细没有按用户聚合（会出现同一人多行）');
});

t('★ 明细按任务数排序（活跃最多的在前）', () => {
  const list = fnBody(DAO, 'getActiveUserList');
  assert.ok(/ORDER BY activeCount DESC/.test(list), '没有按活跃次数降序');
  assert.ok(/lastActiveAt DESC/.test(list), '同活跃次数时没有按最近活跃排序');
});

t('★ 一次任务算一次活跃（COUNT(*) 而不是 COUNT(DISTINCT 某字段)）', () => {
  const list = fnBody(DAO, 'getActiveUserList');
  assert.ok(/COUNT\(\*\)\s+AS activeCount/.test(list),
    '活跃次数应为该用户今天的任务条数');
});

// ---------------- B) 权限 ----------------
console.log('\n-- B. 普通用户看不到别人的数据 --');

t('★★ 接口按角色决定看全平台还是只看自己', () => {
  const idx = SERVER.indexOf("app.get('/api/stats/active-users'");
  assert.ok(idx > 0, '找不到 /api/stats/active-users');
  const block = SERVER.slice(idx, idx + 900);
  assert.ok(/role.*=== 'admin'/.test(block), '没有判断是否管理员');
  assert.ok(/isAdmin \? null : req\.user\?\.id/.test(block),
    '没有按角色限定范围（普通用户会看到全平台的人）');
  assert.ok(/scope: isAdmin \? 'platform' : 'self'/.test(block),
    '没有把范围告知前端（前端无法提示「只看自己」）');
});

t('DAO 支持按 userId 过滤（普通用户视角靠它）', () => {
  const list = fnBody(DAO, 'getActiveUserList');
  assert.ok(/if \(userId\)/.test(list), '没有 userId 过滤分支');
  assert.ok(/t\.user_id = \?/.test(list), '过滤条件没落在 t.user_id 上');
});

// ---------------- C) 字段完整性 ----------------
console.log('\n-- C. 字段完整、姓名有兜底 --');

t('★★ 返回用户名、姓名、活跃次数（用户明确要求的三项）', () => {
  const list = fnBody(DAO, 'getActiveUserList');
  assert.ok(/AS username/.test(list), '缺 username');
  assert.ok(/AS displayName|AS name/.test(list), '缺 姓名');
  assert.ok(/AS activeCount/.test(list), '缺 活跃次数');
});

t('★★ 姓名为空时用 username 兜底（避免空白格）', () => {
  const list = fnBody(DAO, 'getActiveUserList');
  // SQL 层兜底
  assert.ok(/COALESCE\(NULLIF\(u\.name, ''\), u\.username\)/.test(list),
    'SQL 层没有对空姓名兜底');
  // JS 层再兜一层
  assert.ok(/displayName: r\.displayName \|\| r\.username/.test(list),
    'JS 层没有对空姓名兜底');
});

t('★ 附带成功/失败数与最近活跃时间（便于判断活跃质量）', () => {
  const list = fnBody(DAO, 'getActiveUserList');
  assert.ok(/completedCount/.test(list) && /failedCount/.test(list), '缺成功/失败数');
  assert.ok(/lastActiveAt/.test(list), '缺最近活跃时间');
});

t('未知用户不会让整行崩掉', () => {
  const list = fnBody(DAO, 'getActiveUserList');
  assert.ok(/\u0027\(未知用户\)\u0027/.test(list) || /\(未知用户\)/.test(list),
    'username 为空时没有占位文案');
});

// ---------------- D) 前端 ----------------
console.log('\n-- D. 前端能打开清单 --');

t('★★ 卡片可点击并标注「点击查看清单」', () => {
  const idx = VIEW.indexOf('活跃用户</div>');
  assert.ok(idx > 0, '找不到活跃用户卡片');
  // 往前找该卡片容器的 class
  const block = VIEW.slice(Math.max(0, idx - 400), idx + 200);
  assert.ok(/openActiveUsers/.test(block), '卡片没有绑定点击事件');
  assert.ok(/stat-clickable/.test(block), '卡片没有可点击的样式类');
  assert.ok(/点击查看清单/.test(block), '没有提示可以点开');
});

t('★ 弹窗展示用户名/姓名/活跃次数三列', () => {
  const idx = VIEW.indexOf('activeUsersVisible');
  assert.ok(idx > 0, '没有弹窗状态');
  const block = VIEW.slice(idx, idx + 4000);
  assert.ok(/label="用户名"/.test(block), '缺「用户名」列');
  assert.ok(/label="姓名"/.test(block), '缺「姓名」列');
  assert.ok(/label="活跃次数"/.test(block), '缺「活跃次数」列');
});

t('★ 普通用户视角会提示「只看自己」', () => {
  assert.ok(/activeUsersScope === 'self'/.test(VIEW), '没有区分 self 视角');
  assert.ok(/仅显示你自己的活跃记录/.test(VIEW), 'self 视角没有提示文案');
});

t('弹窗里说明口径，避免与卡片数字对不上时的困惑', () => {
  assert.ok(/活跃次数.*=.*今日创建的任务数|今日创建的任务数/.test(VIEW),
    '没有说明「活跃次数」的口径');
});

t('加载失败要有用户可见提示（不能只在控制台）', () => {
  const idx = VIEW.indexOf('async function loadActiveUsers');
  assert.ok(idx > 0, '找不到 loadActiveUsers');
  const block = VIEW.slice(idx, idx + 900);
  assert.ok(/ElMessage\.error/.test(block), '加载失败没有用户可见提示');
  assert.ok(/activeUsersLoading/.test(block), '没有 loading 状态（打开弹窗会空白一下）');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
