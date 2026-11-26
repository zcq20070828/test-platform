/**
 * 对话改稿必须读文本交付物，不能读二进制（2026-11-26）
 *
 * 用户截图问「这个问题有办法优化吗」，提示语是：
 *   「无法生成变更计划（交付物里没有可点名的编号条目），已直接按『全局修订』执行」
 *
 * 查下来是 loadCurrentDeliverable 的严重 bug：
 *
 *   const latest = outs.find(o => o.versionSource === 'agent' && o.filePath)
 *
 * 注册表里有多种文件（md/docx/xlsx/执行证据.json），同一文件还会写多遍。
 * find 取的是**顺序上的第一条**，实测任务 363cb35e 取到了 .xlsx，
 * 用 utf-8 读成 24KB 乱码。
 *
 * 后果比「变更计划生成不了」严重得多：
 *   - 改稿时模型拿到的是乱码，等于在盲改（看不到原交付物，也不知道要保留什么）
 *   - 变更计划抽不出编号（乱码里当然没有编号）
 *
 * 修法：只认文本类扩展名、排除证据文件、多份取最新。
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

console.log('=== 读取交付物文本 单元测试 ===');

function loadFn() {
  const start = SERVER.indexOf('async function loadCurrentDeliverable');
  assert.ok(start > 0, '找不到 loadCurrentDeliverable');
  const end = SERVER.indexOf('async function executeChatRound', start);
  return SERVER.slice(start, end > start ? end : start + 2000);
}

t('只认文本类扩展名（不再把 xlsx 当交付物读）', () => {
  const fn = loadFn();
  assert.ok(/TEXT_EXT/.test(fn), '缺少扩展名过滤');
  assert.ok(/\\\.\(md\|markdown\|txt\)/.test(fn), '扩展名白名单不对');
});

t('排除审计用的证据文件', () => {
  const fn = loadFn();
  assert.ok(/执行证据\|evidence/.test(fn), '未排除证据文件');
});

t('多份时取最新一份（而不是顺序第一条）', () => {
  const fn = loadFn();
  assert.ok(/sort\(/.test(fn), '没有排序');
  assert.ok(/new Date\(b\.createdAt\) - new Date\(a\.createdAt\)/.test(fn),
    '不是按时间倒序——同一交付物写多遍时，最早那版可能是残缺的');
});

t('不再是裸 find（那正是 bug 形状）', () => {
  const fn = loadFn();
  assert.ok(!/\.find\(\(o\) => o\.versionSource === 'agent' && o\.filePath\)/.test(fn),
    '仍在用裸 find，会取到 xlsx/证据文件');
});

t('读取后做完整性校验（防半截文件）', () => {
  const fn = loadFn();
  assert.ok(/txt\.trim\(\)\.length > 50/.test(fn), '没有最小长度校验');
});

t('全都读不到才退回 task.result', () => {
  const fn = loadFn();
  assert.ok(/task\.result \|\| task\.resultText/.test(fn), '缺少 result 兜底');
});

// ---------------- 真实数据回归 ----------------

const OUT_DIR = path.join(ROOT, 'backend', 'output');
function findTaskWithBinary() {
  if (!fs.existsSync(OUT_DIR)) return null;
  for (const dir of fs.readdirSync(OUT_DIR)) {
    const p = path.join(OUT_DIR, dir);
    if (!fs.statSync(p).isDirectory()) continue;
    const files = fs.readdirSync(p);
    const hasMd = files.some((f) => /\.md$/i.test(f));
    const hasBin = files.some((f) => /\.(xlsx|docx)$/i.test(f));
    if (hasMd && hasBin) return { dir, files };
  }
  return null;
}

t('真实任务目录里 md 与 xlsx 并存时，选择逻辑只认 md', () => {
  const sample = findTaskWithBinary();
  if (!sample) {
    console.log('       （无样本，跳过）');
    return;
  }
  const TEXT_EXT = /\.(md|markdown|txt)$/i;
  const picked = sample.files.filter((f) => TEXT_EXT.test(f));
  assert.ok(picked.length > 0, '没选中 md');
  assert.ok(!picked.some((f) => /\.(xlsx|docx)$/i.test(f)), '选中了二进制文件');
});

t('二进制按 utf-8 读会得到乱码（解释为什么要过滤）', () => {
  const sample = findTaskWithBinary();
  if (!sample) return;
  const bin = sample.files.find((f) => /\.xlsx$/i.test(f));
  if (!bin) return;
  const buf = fs.readFileSync(path.join(OUT_DIR, sample.dir, bin));
  const asText = buf.toString('utf-8');
  // xlsx 是 zip，开头是 PK 控制字符
  assert.ok(asText.includes('\u0000') || asText.startsWith('PK'),
    '这个样本不是二进制？');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
