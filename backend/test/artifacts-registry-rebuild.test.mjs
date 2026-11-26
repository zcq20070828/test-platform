/**
 * artifacts 落库为空时从注册表补回（2026-11-25）
 *
 * 用户第三次报「又少按钮了」。前两次是按钮显示条件错，这次是数据问题：
 *
 * 任务 a9c49330（status=failed）的 tasks.artifacts 落库为 []，
 * 但 task_output_files 注册表里有 6 条记录（3 个文件各存了两遍）。
 * 前端拿到空数组后走「从正文提取」的兜底，生成的卡片只有 name、
 * 没有 downloadUrl —— 于是界面只剩「下载」一个按钮，点了还提示
 * "该输出物没有可下载的内容"。
 *
 * 后端早就有 artifactsFromRegistry 重建能力，但只在**下载接口**里用，
 * 列表和详情接口没用上。这是关键缺口：聊天面板读的是列表数据。
 *
 * 修法：
 *   1) artifactsFromRegistry 按文件名去重（6 条 → 3 条）
 *   2) 列表接口：artifacts 为空的任务批量从注册表补
 *   3) 详情接口：同样补
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

console.log('=== artifacts 注册表补回 单元测试 ===');

function registryFn() {
  const start = SERVER.indexOf('async function artifactsFromRegistry');
  assert.ok(start > 0, '找不到 artifactsFromRegistry');
  const end = SERVER.indexOf('async function', start + 10);
  return SERVER.slice(start, end > start ? end : start + 3000);
}

// ---------------- 去重 ----------------

t('注册表重建按文件名去重（去重逻辑在构造器里）', () => {
  // 2026-11-26 重构：去重收敛进 buildArtifacts，这里只验接线
  const fn = registryFn();
  assert.ok(/buildArtifacts\(taskId, rows/.test(fn), '注册表重建未使用统一构造器');
  assert.ok(/dedupeByName: true/.test(fn), '未显式要求去重');
  // 构造器里要有去重实现
  const bStart = SERVER.indexOf('function buildArtifacts(');
  const bEnd = SERVER.indexOf('function normalizeArtifactsField');
  const body = SERVER.slice(bStart, bEnd);
  assert.ok(/const seen = new Set\(\)/.test(body), '构造器缺少去重逻辑');
});

t('去重键是文件名而不是完整路径（在构造器里）', () => {
  // 2026-11-26 重构：注册表重建改为调 buildArtifacts，去重实现在构造器内
  const bStart = SERVER.indexOf('function buildArtifacts(');
  const bEnd = SERVER.indexOf('function normalizeArtifactsField');
  const body = SERVER.slice(bStart, bEnd);
  assert.ok(/path\.basename\(String\(f\.filePath\)\)/.test(body),
    '构造器未按文件名去重——同一文件写到不同目录时会被当成两个交付物');
});

t('去重后仍带 downloadUrl 与 size（构造器保证）', () => {
  const bStart = SERVER.indexOf('function buildArtifact(');
  const bEnd = SERVER.indexOf('function buildArtifacts(');
  const body = SERVER.slice(bStart, bEnd);
  assert.ok(/downloadUrl: downloadUrl \|\| `\/api\/tasks\//.test(body), '构造器缺 downloadUrl');
  assert.ok(/out\.size = size/.test(body), '构造器缺 size');
});

// ---------------- 列表接口补回 ----------------

t('列表接口会收集 artifacts 为空的任务', () => {
  assert.ok(/artifactsNeedingRebuild\.push\(t\.id\)/.test(SERVER),
    '列表接口没有收集「artifacts 为空」的任务');
});

t('列表接口批量从注册表补回', () => {
  const start = SERVER.indexOf("app.get('/api/tasks', authenticate");
  assert.ok(start > 0);
  const end = SERVER.indexOf('// 合并内存 Map 中的任务', start);
  const block = SERVER.slice(start, end);
  assert.ok(/artifactsFromRegistry/.test(block), '列表接口未调用注册表重建');
  assert.ok(/row\.artifacts = arts/.test(block), '未把重建结果写回任务行');
});

t('补回逻辑有数量与异常保护', () => {
  const start = SERVER.indexOf('if (artifactsNeedingRebuild.length)');
  assert.ok(start > 0, '找不到补回逻辑');
  const block = SERVER.slice(start, start + 1500);
  assert.ok(/\.slice\(0, 50\)/.test(block), '未限制单次重建数量，任务多时会拖慢列表');
  assert.ok(/catch/.test(block), '重建失败会让整个列表接口失败');
  assert.ok(/不影响列表/.test(block), '缺少「失败不影响」的说明');
});

// ---------------- 详情接口补回 ----------------

t('详情接口也补（否则进详情看还是少按钮）', () => {
  const start = SERVER.indexOf("app.get('/api/tasks/:id', authenticate");
  assert.ok(start > 0, '找不到详情接口');
  const end = SERVER.indexOf('if (!canAccessTask(task, req))', start);
  const block = SERVER.slice(start, end);
  assert.ok(/artifactsFromRegistry/.test(block), '详情接口未补回');
  assert.ok(/task\.artifacts\.length === 0/.test(block), '未判断空数组');
});

t('只在 artifacts 确实为空时才重建（不覆盖已有数据）', () => {
  const start = SERVER.indexOf("app.get('/api/tasks/:id', authenticate");
  const end = SERVER.indexOf('if (!canAccessTask(task, req))', start);
  const block = SERVER.slice(start, end);
  // 有 dbArts 时直接采用，不该再查注册表
  const dbArtsIdx = block.indexOf('if (dbArts.length)');
  const rebuildIdx = block.indexOf('artifactsFromRegistry');
  assert.ok(dbArtsIdx > 0 && rebuildIdx > dbArtsIdx, '重建位置不对');
  // 条件变量名在 2026-11-25 改为 emptyAfterDb（因为同一分支里还加了去重逻辑）
  assert.ok(/const emptyAfterDb = !Array\.isArray\(task\.artifacts\) \|\| task\.artifacts\.length === 0/.test(block),
    '重建条件不对，可能覆盖已有 artifacts');
  assert.ok(/if \(emptyAfterDb\)/.test(block), '未按条件分支');
});

// ---------------- 前端兜底不该是唯一来源 ----------------

t('前端兜底提取的 artifact 没有 downloadUrl（所以不能依赖它）', () => {
  const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');
  const start = STORE.indexOf('function extractArtifacts');
  const block = STORE.slice(start, start + 2000);
  // 兜底产物带 content 不带 downloadUrl —— 这让「下载」按钮点了会失败
  assert.ok(/content,/.test(block), '兜底应带 content');
  assert.ok(!/downloadUrl/.test(block), '兜底不该有 downloadUrl（它没有服务端地址）');
});

// ---------------- 详情接口也要去重（内存 Map 可能存着旧的重复数据）----------------

t('详情接口对非空 artifacts 也去重', () => {
  const start = SERVER.indexOf("app.get('/api/tasks/:id', authenticate");
  const end = SERVER.indexOf('if (!canAccessTask(task, req))', start);
  const block = SERVER.slice(start, end);
  // 内存 Map 里的 artifacts 可能是旧代码写的（同一文件多条），
  // 也可能是列表补回时未去重的结果 —— 详情要自己再去一次
  assert.ok(/const seen = new Map\(\)/.test(block), '详情接口缺去重逻辑');
  assert.ok(/deduped\.length !== task\.artifacts\.length/.test(block), '未做去重前后对比');
  assert.ok(/task\.artifacts = deduped/.test(block), '去重结果没写回');
});

t('详情去重按文件名，与注册表重建同一判据', () => {
  const start = SERVER.indexOf("app.get('/api/tasks/:id', authenticate");
  const end = SERVER.indexOf('if (!canAccessTask(task, req))', start);
  const block = SERVER.slice(start, end);
  assert.ok(/a\?\.name \|\| a\?\.path/.test(block) || /split\('\/'\)\.pop\(\)/.test(block),
    '去重键不是文件名');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
