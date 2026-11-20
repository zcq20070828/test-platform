#!/usr/bin/env node
/**
 * 变量「先用后声明」扫描（TDZ 回归，2026-11-20）
 *
 * 为什么需要这个：这类 bug 语法检查（node --check）查不出来，只有真实跑到那一行
 * 才会抛 `Cannot access 'x' before initialization`，任务直接 failed。
 * 已经因此踩了两次：
 *   1) 新增 API Key 接口里 providerUnavailableReason(b.provider) 写在 const b = req.body 之前
 *      → 保存 API Key 一律 500，界面只显示「保存 API Key 失败」
 *   2) callOpenClawAPI 的调试日志引用了 resolvedKey，而它在几十行后才声明
 *      → 任务 f10d5520 整条失败：「Agent 调用失败：Cannot access 'resolvedKey' before initialization」
 *
 * 做法：剥掉注释与字符串后，对每个 for/while 循环体收集 const/let 的声明行，
 * 再检查声明之前是否引用了该名字。排除：属性访问 obj.name、对象字面量键 name:、
 * 回调/函数参数 (name) => 。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGETS = [
  'backend/server.js',
  'backend/database/user-api-key-dao.js',
  'backend/llm/intent-engine.js',
  'qclaw-skills/evaluation-system/backend/llm-evaluator.js',
];

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

/** 把注释和字符串替换成空白，保持行号不变 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const nxt = src[i + 1];
    if (c === '/' && nxt === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (c === '/' && nxt === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += ' ';
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { out += ' '; i += 1; break; }
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** 找出所有 while/for 循环体（含 do-while 的块）的行区间 */
function loopRanges(cleanLines) {
  const ranges = [];
  for (let i = 0; i < cleanLines.length; i += 1) {
    if (!/\b(for|while)\s*\(/.test(cleanLines[i])) continue;
    let braceLine = -1;
    for (let j = i; j < Math.min(cleanLines.length, i + 12); j += 1) {
      if (cleanLines[j].includes('{')) { braceLine = j; break; }
    }
    if (braceLine < 0) continue;
    let depth = 0;
    let started = false;
    let endLine = -1;
    for (let j = braceLine; j < cleanLines.length; j += 1) {
      for (const ch of cleanLines[j]) {
        if (ch === '{') { depth += 1; started = true; }
        else if (ch === '}') { depth -= 1; }
      }
      if (started && depth <= 0) { endLine = j; break; }
    }
    if (endLine > 0) ranges.push([i, endLine]);
  }
  return ranges;
}

function findUseBeforeDecl(file) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) return [];
  const raw = fs.readFileSync(abs, 'utf8');
  const clean = stripCommentsAndStrings(raw);
  const cleanLines = clean.split('\n');
  const rawLines = raw.split('\n');
  const problems = [];
  const seen = new Set();

  for (const [ls, le] of loopRanges(cleanLines)) {
    const decls = new Map();
    for (let i = ls; i <= le; i += 1) {
      const m = cleanLines[i].match(/^(\s*)(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/);
      if (m && !decls.has(m[2])) decls.set(m[2], i);
    }
    for (const [name, declLine] of decls) {
      for (let i = ls; i < declLine; i += 1) {
        const line = cleanLines[i];
        if (!new RegExp(`\\b${name}\\b`).test(line)) continue;
        if (new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`).test(line)) continue;
        // 属性访问 obj.name
        const hits = [...line.matchAll(new RegExp(`(.)?\\b${name}\\b`, 'g'))];
        if (!hits.some((m) => m[1] !== '.')) continue;
        // 对象字面量键 name:
        if (new RegExp(`(?:[{,])\\s*${name}\\s*:(?!\\s*=)`).test(line)) continue;
        if (new RegExp(`^\\s*${name}\\s*:(?!\\s*=)`).test(line)) continue;
        // 回调/函数参数
        if (new RegExp(`[\\w.]\\(\\s*${name}\\s*(?:=>|\\))`).test(line)) continue;
        if (new RegExp(`\\(\\s*${name}\\s*(?:,|\\))\\s*=>`).test(line)) continue;

        const key = `${file}:${i}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push({
          file,
          line: i + 1,
          name,
          declLine: declLine + 1,
          snippet: (rawLines[i] || '').trim().slice(0, 110),
        });
        break;
      }
    }
  }
  return problems;
}

console.log('=== 变量先用后声明（TDZ）扫描 ===');

const all = [];
for (const file of TARGETS) all.push(...findUseBeforeDecl(file));

t('循环体内没有「先用后声明」的 const/let', () => {
  assert.strictEqual(
    all.length,
    0,
    '发现 TDZ 风险：\n  ' + all.map((p) => `${p.file}:${p.line} 用了 ${p.name}（声明在 ${p.declLine} 行）\n    > ${p.snippet}`).join('\n  '),
  );
});

// 曾经踩过的两个具体案例，钉死它们不会再回来
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

t('callOpenClawAPI 的调试日志不引用 resolvedKey（必须在声明之后）', () => {
  const loopStart = SERVER.indexOf('for (let attempt = 0; attempt <= maxRetries; attempt++)');
  assert.ok(loopStart > 0, '找不到重试循环');
  const block = SERVER.slice(loopStart, loopStart + 8000);
  const declIdx = block.indexOf('const resolvedKey = await resolveApiKey');
  assert.ok(declIdx > 0, '找不到 resolvedKey 声明');
  const before = block.slice(0, declIdx);
  // 去掉注释后再查，注释里提到 resolvedKey 没问题
  const beforeNoComment = before.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/\bresolvedKey\b/.test(beforeNoComment),
    'resolvedKey 在声明之前被引用，会抛 Cannot access before initialization');
});

t('新增 API Key 接口里 const b 在任何 b.* 之前', () => {
  const start = SERVER.indexOf("app.post('/api/user/api-keys'");
  const block = SERVER.slice(start, SERVER.indexOf("app.put('/api/user/api-keys/:id'"));
  const declIdx = block.indexOf('const b = req.body');
  assert.ok(declIdx > 0, '找不到 const b = req.body');
  const before = block.slice(0, declIdx).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const uses = [...before.matchAll(/\bb\./g)];
  assert.strictEqual(uses.length, 0, `const b 之前就用了 b.*（会抛 TDZ），共 ${uses.length} 处`);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
