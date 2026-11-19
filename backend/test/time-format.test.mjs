#!/usr/bin/env node
/**
 * 时间格式化 单元测试（2026-11-19）
 *
 * 用户反馈「实时信息里显示的时间不对，不是北京时间」。
 *
 * 两个成因：
 *   1. 后端有两处用 `new Date().toISOString().slice(0,19)` 写 MySQL 的 created_at：
 *      toISOString 永远是 UTC，写进 TIMESTAMP 会整体差 8 小时。
 *      实测影响：评估任务创建时间早 8 小时；「按 created_at ±2 分钟查关联任务」
 *      窗口整体挪到 UTC，永远查不到记录。
 *   2. 前端直接用 `new Date(x).toLocaleTimeString('zh-CN')`：
 *      依赖浏览器本地时区。后端存在两种时间格式——
 *        - UTC ISO 带 Z（SSE 事件 timestamp）
 *        - 无时区的北京墙钟 `YYYY-MM-DD HH:mm:ss`（localNowStr 写入 DB）
 *      后者在非 UTC+8 的机器上会被当成 UTC 解析，再渲染成北京时间就 +8 小时。
 *
 * 现在统一走 frontend/src/utils/time.ts：
 *   - 无时区字符串显式补 `+08:00`（声明它是北京墙钟）
 *   - 输出固定按 Asia/Shanghai 渲染，不随浏览器时区漂移
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const TIME_UTIL = path.join(ROOT, 'frontend', 'src', 'utils', 'time.ts');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

/** 在指定 TZ 下跑一段 TS 逻辑，返回输出行 */
function runInTZ(tz, code) {
  const file = path.join(ROOT, 'backend', 'test', '.tz-probe.mjs');
  fs.writeFileSync(file, code, 'utf8');
  try {
    return execFileSync(process.execPath, ['--experimental-strip-types', file], {
      encoding: 'utf8',
      env: { ...process.env, TZ: tz },
    }).trim();
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
}


/** 去掉行注释和块注释，避免把注释里的反例当违规代码 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

console.log('=== 时间格式化 单元测试 ===');

// ---------------- 后端：不得用 toISOString 直切写 DB ----------------
t('后端不再用 toISOString().slice 写 MySQL 时间列', () => {
  const code = stripComments(SERVER);
  assert.ok(!/toISOString\(\)\.slice\(0, ?19\)/.test(code), '仍有 toISOString().slice(0,19)');
  assert.ok(!/toISOString\(\)\.replace\('T', ?' '\)\.substring/.test(code), '仍有 toISOString().replace().substring()');
});

t('存在统一的北京墙钟格式化 helper（toLocalDateStr / localNowStr）', () => {
  assert.ok(/function toLocalDateStr\(/.test(SERVER), '缺少 toLocalDateStr');
  assert.ok(/function localNowStr\(/.test(SERVER), '缺少 localNowStr');
  assert.ok(/timeZone: 'Asia\/Shanghai'/.test(SERVER), 'helper 未固定 Asia/Shanghai');
});

t('评估任务创建时间用 localNowStr', () => {
  assert.ok(/const startTime = localNowStr\(\)/.test(SERVER), '评估任务 startTime 未用 localNowStr');
});

t('关联任务时间窗用 toLocalDateStr 而不是 toISOString', () => {
  const m = SERVER.match(/const windowStart = [^\n]+/);
  assert.ok(m, '缺少 windowStart');
  assert.ok(/toLocalDateStr/.test(m[0]), `windowStart 用错：${m[0]}`);
});

// ---------------- 北京墙钟 helper 行为 ----------------
t('toLocalDateStr：UTC 06:41 → 北京 14:41', () => {
  const src = SERVER.slice(SERVER.indexOf('function toLocalDateStr'), SERVER.indexOf('function toLocalDateStr') + 500);
  const body = src.slice(0, src.indexOf('\n}') + 2);
  const fn = new Function(`${body}; return toLocalDateStr;`)();
  assert.strictEqual(fn(new Date('2026-11-19T06:41:23.000Z')), '2026-11-19 14:41:23');
  assert.strictEqual(fn('2026-11-19 14:41:23'), '2026-11-19 14:41:23');
  assert.strictEqual(fn('not-a-date'), null);
});

// ---------------- 前端 util 存在且固定北京时区 ----------------
t('前端 utils/time.ts 固定 Asia/Shanghai', () => {
  assert.ok(fs.existsSync(TIME_UTIL), '缺少 utils/time.ts');
  const src = fs.readFileSync(TIME_UTIL, 'utf8');
  assert.ok(/Asia\/Shanghai/.test(src), '未固定 Asia/Shanghai');
  assert.ok(/export function formatClock/.test(src), '缺少 formatClock');
  assert.ok(/export function formatDateTime/.test(src), '缺少 formatDateTime');
});

t('无时区字符串显式补 +08:00（声明是北京墙钟）', () => {
  const src = fs.readFileSync(TIME_UTIL, 'utf8');
  assert.ok(/\+08:00/.test(src), '未显式标注北京时区');
});

// ---------------- 行为：输出不随浏览器时区漂移 ----------------
const probe = `
import { formatDateTime } from ${JSON.stringify(TIME_UTIL)};
console.log([
  formatDateTime('2026-11-19T06:41:23.000Z'),
  formatDateTime('2026-11-19 14:41:23'),
  formatDateTime('2026-11-19T14:41:23+08:00'),
  formatDateTime(1795070483000),
].join('|'));
`;

t('TZ=Asia/Shanghai 下四种输入都是 14:41:23', () => {
  const out = runInTZ('Asia/Shanghai', probe);
  const parts = out.split('|');
  assert.strictEqual(parts.length, 4, out);
  for (const p of parts) assert.ok(p.includes('14:41:23'), `输出 ${p} 不含 14:41:23`);
});

t('TZ=UTC 下输出不变（海外用户看到的也是北京时间）', () => {
  const out = runInTZ('UTC', probe);
  const parts = out.split('|');
  for (const p of parts) assert.ok(p.includes('14:41:23'), `UTC 环境下输出 ${p} 漂移了`);
});

t('TZ=America/New_York 下输出仍不变', () => {
  const out = runInTZ('America/New_York', probe);
  for (const p of out.split('|')) assert.ok(p.includes('14:41:23'), `纽约时区输出 ${p} 漂移了`);
});

t('非法输入返回占位符而不是 Invalid Date', () => {
  const out = runInTZ('Asia/Shanghai', `
import { formatDateTime, formatClock } from ${JSON.stringify(TIME_UTIL)};
console.log(formatDateTime('not-a-date') + '|' + formatClock('') + '|' + formatDateTime(null));
`);
  assert.strictEqual(out, '-|-|-', out);
});

// ---------------- 前端不再自行 toLocale ----------------
t('聊天面板的时间格式化走统一 util', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'DashboardChatPanel.vue'), 'utf8');
  const panel = stripComments(raw);
  assert.ok(/from '@\/utils\/time'/.test(panel), '未引入 utils/time');
  assert.ok(!/new Date\(iso\)\.toLocaleTimeString\('zh-CN'/.test(panel), '仍在使用依赖本地时区的 toLocaleTimeString');
  assert.ok(/return formatClock\(iso\)/.test(panel), 'formatTime 未改用 formatClock');
});

t('任务页的时间格式化走统一 util', () => {
  const view = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'TasksView.vue'), 'utf8');
  assert.ok(/from '@\/utils\/time'/.test(view), '未引入 utils/time');
  assert.ok(/return formatDateTime\(ts\)/.test(view), 'formatTime 未改用 formatDateTime');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
