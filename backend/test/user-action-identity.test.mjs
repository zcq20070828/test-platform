#!/usr/bin/env node
/**
 * 行为明细里大量「访客」的系统性修复（2026-11-25）
 *
 * 用户反馈：「行为明细列表中很多『用名』显示为『访客』，系统修复一下，
 * 这个问题之前也修过，现在看是没修复」。
 *
 * 生产实测（修复前）：
 *   user_action_logs 里 user_id='anonymous' 有 4713 条，其中
 *   **4709 条是 page_leave（99.9%）**。今天 62 条记录里 48 条匿名。
 *
 * 根因：前端用 `navigator.sendBeacon` 上报 page_leave（unload 时唯一可靠的
 * 方式），但 **sendBeacon 无法设置 Authorization 头**——它只能发 Blob/FormData，
 * 请求头完全由浏览器决定。所以这些记录到了后端就是无 token，
 * 只能记成 anonymous。
 *
 * 为什么「之前修过但没修好」：
 *   之前的修法只动了**显示层**（把 'anonymous' 映射成中文「访客」），
 *   让界面看起来是中文，但身份依然没有——问题被换了个说法，没被解决。
 *   这次改的是**身份传递链路本身**。
 *
 * 修法：
 *   1) 前端把 token 放进 URL 查询参数（sendBeacon 可以任意拼 URL）
 *   2) 后端 log 端点支持 ?token=，且**同样做 JWT 验签**（签名 + iss + aud）
 *      —— `authenticate` 中间件本来就用 req.query.token，这里对齐同一口径
 *   3) 显示层把历史匿名记录如实标注为「匿名（未记录身份）」，
 *      不再叫「访客」——那会让人以为真有个访客用户在活动
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'user-action-log-dao.js'), 'utf8');
const DWELL = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'utils', 'page-dwell.ts'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 行为日志身份丢失修复 ===');

/** log 端点处理函数体 */
function logEndpoint() {
  const start = SERVER.indexOf("app.post('/api/user-actions/log'");
  assert.ok(start > 0, '找不到 /api/user-actions/log');
  const end = SERVER.indexOf("app.get('/api/user-actions'", start);
  assert.ok(end > start, '找不到端点结束位置');
  return SERVER.slice(start, end);
}

// ---------------- A) 前端：token 必须能到达后端 ----------------
console.log('\n-- A. 前端送身份 --');

t('★★ sendBeacon 的 URL 带上 token（请求头设不了，只能走 URL）', () => {
  // sendBeacon 的第二个参数是 body，无法带 header；唯一途径是 URL
  assert.ok(/user-actions\/log\?token=/.test(DWELL),
    'sendBeacon 的 URL 没带 token —— 身份还是会丢');
  assert.ok(/encodeURIComponent\(token\)/.test(DWELL), 'token 没做 URL 编码（JWT 含 . 和 -，虽安全但应编码）');
});

t('★★ token 取自与普通请求同一个来源（localStorage）', () => {
  assert.ok(/from '@\/api'/.test(DWELL), '没有从 api 模块取鉴权信息');
  assert.ok(/getAuthHeaders/.test(DWELL), '没有复用 getAuthHeaders（自己读 localStorage 易与主逻辑不一致）');
  assert.ok(/Bearer /.test(DWELL), '没有剥掉 Bearer 前缀');
});

t('★ 没有 token 时仍能上报（未登录/登录页也要记页面访问）', () => {
  assert.ok(/const url = token\s*\n?\s*\?/.test(DWELL) || /token\s*\?[\s\S]{0,80}:'\/api\/user-actions\/log'/.test(DWELL),
    '没有 token 时没有回退到无参数 URL');
});

t('★ 保留 sendBeacon 失败后的普通请求兜底', () => {
  assert.ok(/userActionApi\.log/.test(DWELL), 'sendBeacon 不可用时没有兜底上报');
  assert.ok(/sendBeacon/.test(DWELL), '没有优先用 sendBeacon（unload 时会丢请求）');
});

// ---------------- B) 后端：接受 URL 里的 token 且仍验签 ----------------
console.log('\n-- B. 后端接受并验证 URL token --');

t('★★ log 端点从查询参数取 token', () => {
  const body = logEndpoint();
  assert.ok(/req\.query\?\.token|req\.query\.token/.test(body), '没有读取 ?token=');
});

t('★★ 仍然完整验签（签名 + issuer + audience），不是信任明文身份', () => {
  const body = logEndpoint();
  assert.ok(/jwt\.verify\(/.test(body), '没有调用 jwt.verify');
  assert.ok(/algorithms:\s*\['HS256'\]/.test(body), '没有限定算法（可被 alg=none 绕过）');
  assert.ok(/issuer:\s*'test-platform'/.test(body), '没有校验 issuer');
  assert.ok(/audience:\s*'test-platform-api'/.test(body), '没有校验 audience');
});

t('★★ 不信任 body 里的 userId（防审计投毒）', () => {
  const body = logEndpoint();
  // 身份只能来自验签后的 decoded.sub
  assert.ok(/decoded\.sub/.test(body), '没有从验签结果取用户');
  assert.ok(!/req\.body\.userId/.test(body), '仍在信任 body.userId —— 可伪造审计记录');
});

t('★ 头优先、URL 次之（浏览器普通请求不该被迫用 URL 传 token）', () => {
  const body = logEndpoint();
  assert.ok(/req\.headers\['authorization'\]/.test(body), '没有从 Authorization 头取 token');
  // 必须体现「头优先」：headerToken 在前、queryToken 兜底
  assert.ok(/headerToken\s*\|\|\s*queryToken/.test(body),
    'token 取值没有体现「头优先、URL 兜底」');
});

// ---------------- C) 显示层 ----------------
console.log('\n-- C. 显示层如实标注 --');

t('★★★ 所有返回用户名的查询都必须处理 anonymous（漏一处就会露出英文）', () => {
  // 上一轮修复的教训：只改了 listActions 与 getActionStats，
  // 漏了 getUserUsageSummary，「使用时长 TOP10」里就原样显示出英文 anonymous。
  // 这里用「凡是有 display_name 的 SELECT，都必须出现 anonymous 分支」做结构性守卫，
  // 以后新增任何返回用户名的查询，漏处理就会失败。
  const displayNameBlocks = DAO.split('AS display_name');
  assert.ok(displayNameBlocks.length >= 4, `只找到 ${displayNameBlocks.length - 1} 处 display_name，预期 ≥3`);

  // 取每个 display_name 之前的那段 SQL（即该 CASE 表达式）
  let checked = 0;
  for (let i = 0; i < displayNameBlocks.length - 1; i += 1) {
    const before = displayNameBlocks[i];
    const caseIdx = before.lastIndexOf('CASE');
    assert.ok(caseIdx > 0, `第 ${i + 1} 处 display_name 前找不到 CASE 表达式`);
    const caseExpr = before.slice(caseIdx);
    assert.ok(/'anonymous'\s*THEN\s*'[^']*未记录身份[^']*'/.test(caseExpr),
      `第 ${i + 1} 处 display_name 没处理 anonymous（会把英文 anonymous 显示给用户）`);
    checked += 1;
  }
  assert.ok(checked >= 3, `只校验了 ${checked} 处，预期 ≥3（明细/聚合/时长排行）`);
});

t('★★ 历史匿名记录不再叫「访客」，改为说明未记录身份', () => {
  const matches = DAO.match(/'anonymous' THEN '[^']+'/g) || [];
  assert.ok(matches.length >= 3, `只改了 ${matches.length} 处（明细/聚合/时长排行三处都要）`);
  for (const m of matches) {
    assert.ok(!/访客/.test(m), `仍在用「访客」字样：${m}`);
    assert.ok(/未记录身份/.test(m), `没有说明「未记录身份」：${m}`);
  }
});

t('★★★ 按用户聚合时不能把 username/name 放进 GROUP BY（同一人会被拆成多行）', () => {
  // 实测事故：为了兼容 ONLY_FULL_GROUP_BY 把 `u.name, ual.username` 加进 GROUP BY，
  // 结果同一 anonymous 因为历史记录里 username 有 NULL 与 '访客' 两种，
  // 被拆成两行（3246 + 1483），在 TOP10 里重复出现。
  // 正确做法：只按 user_id 聚合，代表值用 MAX() 取。
  const fn = DAO.slice(DAO.indexOf('export async function getUserUsageSummary'));
  const body = fn.slice(0, 2200);
  const groupBy = body.match(/GROUP BY\s+([^\n`]+)/);
  assert.ok(groupBy, 'getUserUsageSummary 找不到 GROUP BY');
  const cols = groupBy[1].trim();
  assert.ok(/^ual\.user_id(,\s*u\.name)?$/.test(cols),
    `GROUP BY 为「${cols}」，不应包含 ual.username（会把同一人拆行）`);
  // 取代表值必须用聚合函数，否则 ONLY_FULL_GROUP_BY 下不稳
  assert.ok(/NULLIF\(MAX\(ual\.username\)/.test(body),
    'username 没用 MAX() 聚合（ONLY_FULL_GROUP_BY 下会报错或结果不稳）');
});

t('★★ 前端不能把 user_id 当名字展示（会露出英文 anonymous）', () => {
  const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'UserActionsView.vue'), 'utf8');
  // 去掉注释再判断：说明文字里会引用旧写法（`row.display_name || row.user_id`），
  // 直接 grep 会命中注释造成误报。
  const code = VIEW
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');

  assert.ok(!/\|\|\s*row\.user_id/.test(code),
    '模板仍在回退到 row.user_id —— 后端一漏改就会把内部标识印到界面上');
  assert.ok(/function userLabel/.test(code), '没有统一的用户名渲染函数');
  assert.ok(!/label:\s*u\.display_name\s*\|\|\s*u\.user_id/.test(code),
    '下拉选项仍在回退到 user_id');
});

t('★ 明细与聚合的匿名文案必须一致（否则两处看到不同说法）', () => {
  const matches = DAO.match(/'anonymous' THEN '([^']+)'/g) || [];
  const labels = new Set(matches.map((m) => m.replace(/.*THEN '/, '').replace(/'$/, '')));
  assert.strictEqual(labels.size, 1, `出现 ${labels.size} 种文案：${[...labels].join(' / ')}`);
});

t('真实用户仍显示真实姓名/用户名（不能为修匿名把正常路径改坏）', () => {
  const idx = DAO.indexOf('AS display_name');
  assert.ok(idx > 0, '找不到 display_name 计算');
  const block = DAO.slice(Math.max(0, idx - 700), idx);
  assert.ok(/ual\.username/.test(block), '没有用日志里的 username');
  assert.ok(/u\.name/.test(block), '没有回退到 users.name');
  assert.ok(/ELSE ual\.user_id/.test(block), '没有最终回退到 user_id');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
