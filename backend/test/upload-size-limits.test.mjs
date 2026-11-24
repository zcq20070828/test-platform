#!/usr/bin/env node
/**
 * 上传体积上限三处口径必须一致（2026-11-24）
 *
 * 用户报「生产线有报 413」。生产日志确认：
 *   POST /api/tasks  413  585 字节（Nginx 默认 HTML 错误页）
 * 触发条件：上传 4.34MB 的 docx。
 *
 * 根因不止「Nginx 没配」这一层——实际是三个数字互相不匹配：
 *
 *   Nginx   client_max_body_size  → **完全未设置**，默认 1MB  ← 413 的直接原因
 *   后端    express.json limit    → /api/tasks 已是 50MB（没被改过）
 *   前端    MAX_ATTACHMENT_SIZE   → 50MB
 *
 * 而前端是把附件转 **base64** 随 JSON 一起提交的，体积约 ×1.36：
 *   4.34MB docx → 请求体约 5.9MB → 超过 Nginx 默认 1MB → 413
 *
 * 还有两处次级缺陷（本文件一并锁死）：
 *   - 前端 50MB 上限本身是错的：base64 后 68MB，会超后端 50MB，
 *     大文件被拒时用户只看到「请求失败」，不知道是体积问题；
 *   - DashboardChatPanel 自己写死 50MB，与 attachment.ts 不一致，
 *     面板放行的文件在提交时被静默跳过，用户以为传上去了。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATTACH = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'utils', 'attachment.ts'), 'utf8');
const PANEL = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'DashboardChatPanel.vue'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const NGINX_TMPL = path.join(ROOT, 'deploy', 'nginx-test-platform.conf');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 上传体积上限口径一致性 ===');

/** 从源码里读数值上限（MB） */
function readMb(src, re, label) {
  const m = src.match(re);
  assert.ok(m, `找不到 ${label}`);
  return Number(m[1]);
}

const ATTACH_MB = readMb(ATTACH, /MAX_ATTACHMENT_SIZE = (\d+) \* 1024 \* 1024/, '前端 MAX_ATTACHMENT_SIZE');
// /api/tasks 用的是 jsonLarge（在中间件注册处定义），不是就地写 limit
const BACKEND_TASKS_MB = readMb(SERVER, /const jsonLarge = express\.json\(\{ limit: '(\d+)mb' \}\)/, '后端 jsonLarge limit');

// ---------------- A) 后端 ----------------
console.log('\n-- A. 后端 --');

t('/api/tasks 的 body 上限是 50MB（不是全局的 2MB）', () => {
  assert.ok(/const jsonLarge = express\.json\(\{ limit: '50mb' \}\)/.test(SERVER),
    '缺 jsonLarge 50MB 定义');
  assert.ok(/app\.use\('\/api\/tasks', jsonLarge\)/.test(SERVER),
    '/api/tasks 没挂 jsonLarge，会落到全局 2MB');
  assert.strictEqual(BACKEND_TASKS_MB, 50, `实际 ${BACKEND_TASKS_MB}MB`);
});

t('全局 express.json 仍保持 2MB（不能为了上传放宽所有接口）', () => {
  assert.ok(/app\.use\(express\.json\(\{ limit: '2mb' \}\)\)/.test(SERVER),
    '全局 body 上限被改掉了，所有接口都能收大包');
});

// ---------------- B) 前端单文件上限 ----------------
console.log('\n-- B. 前端单文件上限 --');

t('★★ 前端上限按 base64 膨胀反算（不能直接抄后端的 50MB）', () => {
  // base64 ≈ ×4/3，加 JSON 转义 ≈ ×1.36。50MB 原始文件 → 68MB 请求体 > 后端 50MB
  assert.ok(ATTACH_MB < BACKEND_TASKS_MB, `前端 ${ATTACH_MB}MB 未小于后端 ${BACKEND_TASKS_MB}MB`);
  const inflated = ATTACH_MB * 1.36;
  assert.ok(inflated <= BACKEND_TASKS_MB,
    `前端 ${ATTACH_MB}MB × 1.36 = ${inflated.toFixed(1)}MB，超过后端 ${BACKEND_TASKS_MB}MB，大文件会被拒`);
  assert.ok(ATTACH_MB >= 30, `上限 ${ATTACH_MB}MB 过小，连普通需求文档都传不了`);
});

t('base64 膨胀系数有明确常量（供提示文案与容量估算复用）', () => {
  assert.ok(/export const BASE64_INFLATE_RATIO = 1\.36/.test(ATTACH), '缺 BASE64_INFLATE_RATIO');
});

// ---------------- C) 前端两处口径统一 ----------------
console.log('\n-- C. 前端两处口径统一 --');

t('★★ DashboardChatPanel 用 attachment.ts 的常量（不能再写死 50MB）', () => {
  assert.ok(/const MAX_FILE_SIZE = MAX_ATTACHMENT_SIZE/.test(PANEL),
    '面板没复用统一常量');
  assert.ok(!/const MAX_FILE_SIZE = 50 \* 1024 \* 1024/.test(PANEL),
    '面板仍写死 50MB，与 attachment.ts 不一致');
  assert.ok(/import \{[^}]*MAX_ATTACHMENT_SIZE/.test(PANEL), '没 import 统一常量');
});

t('★★ 超限提示说明 base64 膨胀（否则用户不理解 35MB 也不行）', () => {
  assert.ok(/base64/i.test(PANEL), '面板的超限提示没说明 base64 膨胀');
  assert.ok(/BASE64_INFLATE_RATIO/.test(PANEL), '提示没引用膨胀系数');
});

t('★ 超限时给用户可见提示（不能静默跳过）', () => {
  assert.ok(/ElMessage\.error/.test(PANEL), '面板超限没有用户可见提示');
  // attachment.ts 里是 console.warn（工具层），调用方必须补用户提示
  assert.ok(/checkTotalAttachmentSize/.test(PANEL), '没有总量校验');
});

t('★ 总量校验：多文件叠加也要拦（单个合规、合计超限同样会 413）', () => {
  assert.ok(/export function checkTotalAttachmentSize/.test(ATTACH), '缺总量校验函数');
  const fn = ATTACH.slice(ATTACH.indexOf('export function checkTotalAttachmentSize'));
  assert.ok(/BASE64_INFLATE_RATIO/.test(fn.slice(0, 1200)), '总量校验没考虑膨胀');
  assert.ok(/BUDGET/.test(fn.slice(0, 1200)), '总量校验没有预算常量');
});

// ---------------- D) Nginx 模板 ----------------
console.log('\n-- D. Nginx 配置（必须可复用，不能只改现场） --');

t('★★ 仓库里有 nginx 配置模板，含 client_max_body_size', () => {
  assert.ok(fs.existsSync(NGINX_TMPL),
    '缺 deploy/nginx-test-platform.conf 模板 —— 下次装机还会踩 413');
  const raw = fs.readFileSync(NGINX_TMPL, 'utf8');
  // 只看代码行：模板头部注释里也提到了这个指令名，
  // 直接 indexOf 会命中注释，导致「明明写在 https 块里却判成不在」。
  const lines = raw.split('\n');
  const codeLines = [];
  lines.forEach((l, i) => { if (!/^\s*#/.test(l)) codeLines.push({ text: l, no: i }); });
  const code = codeLines.map((x) => x.text).join('\n');

  assert.ok(/client_max_body_size\s+50m/.test(code), '模板里没有生效的 client_max_body_size 50m（可能只写在注释里）');

  const httpsIdx = code.indexOf('listen 8443 ssl;');
  const bodyIdx = code.indexOf('client_max_body_size');
  const eightyIdx = code.indexOf('listen 80;');
  const redirectIdx = code.indexOf('return 301');
  assert.ok(httpsIdx > 0, '模板里没有 listen 8443 ssl;');
  assert.ok(bodyIdx > httpsIdx, 'client_max_body_size 不在 https server 块内');
  assert.ok(bodyIdx > redirectIdx,
    'client_max_body_size 落在了 80 端口块里（那里只做重定向，无需该指令）');
});

t('★ Nginx 上限 ≥ 后端上限（否则前端放行的请求会被网关先拦）', () => {
  const conf = fs.readFileSync(NGINX_TMPL, 'utf8');
  const ngxMb = Number((conf.match(/client_max_body_size\s+(\d+)m/) || [])[1]);
  assert.ok(ngxMb >= BACKEND_TASKS_MB,
    `Nginx ${ngxMb}MB < 后端 ${BACKEND_TASKS_MB}MB，网关会先拒`);
});

t('模板保留原有反代配置（UIS/WS/timeout 不能被删）', () => {
  const conf = fs.readFileSync(NGINX_TMPL, 'utf8');
  for (const [re, label] of [
    [/proxy_pass http:\/\/127\.0\.0\.1:3002/, 'proxy_pass'],
    [/proxy_read_timeout 3600s/, '长连接超时'],
    [/Upgrade \$http_upgrade/, 'WebSocket upgrade'],
    [/listen 8443 ssl/, '8443 端口'],
    [/letsencrypt\/live/, 'Let\'s Encrypt 证书路径'],
  ]) {
    assert.ok(re.test(conf), `模板缺 ${label}`);
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log(`\n当前各层上限：前端 ${ATTACH_MB}MB（base64 后 ≈${(ATTACH_MB * 1.36).toFixed(1)}MB） / 后端 ${BACKEND_TASKS_MB}MB / Nginx 50MB`);
if (fail > 0) process.exit(1);
