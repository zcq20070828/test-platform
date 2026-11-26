/**
 * artifacts 构造必须走唯一入口（2026-11-26）
 *
 * 这是「少按钮」被报四次的**结构性根因**：
 *
 * 同一个 artifacts 对象在 7 个地方各自构造，字段各不相同：
 *   - 启动重建      有 downloadUrl、version，没有 size
 *   - 执行证据      有 downloadUrl、ext，type 按图片/文件
 *   - 注册表重建    有 downloadUrl、size，type 硬编码 'file'
 *   - executeChatRound  **没有 downloadUrl**（按钮全隐藏，用户报第三次）
 *   - savedFiles    type 硬编码 'file'，没 size
 *   - failFiles     同上
 *   - workflow      type 硬编码 'file'，md 也标成 file
 *
 * 每次我只修一处，其他几处就漏。所以收敛成 buildArtifact / buildArtifacts，
 * 所有出口都调它。本测试守两件事：
 *   1. 构造器产出的对象字段齐全（前端 ArtifactCard 需要的都在）
 *   2. 后端代码里不允许再有「手工拼 artifacts 对象」的地方
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path;
const defaultFs = { existsSync: fs.existsSync, statSync: fs.statSync };
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

console.log('=== artifacts 构造统一 单元测试 ===');

// ---------------- 构造器本身 ----------------

function loadBuilders() {
  const grab = (n) => {
    const start = SERVER.indexOf(`function ${n}(`);
    assert.ok(start > 0, `找不到 ${n}`);
    const rest = SERVER.slice(start + 10);
    const next = rest.search(/\n(?:async )?function /);
    return SERVER.slice(start, start + 10 + (next > 0 ? next : 5000));
  };
  // 常量块
  const constStart = SERVER.indexOf('const ARTIFACT_TEXT_EXT');
  const constEnd = SERVER.indexOf('function artifactTypeOf');
  const consts = SERVER.slice(constStart, constEnd);
  const code = consts + '\n'
    + grab('artifactTypeOf') + '\n'
    + grab('buildArtifact') + '\n'
    + grab('buildArtifacts');
  // new Function 里没有 ESM 的 require，把模块作为参数注入
  const pathMod = defaultPath;
  const fsMod = defaultFs;
  return new Function('path', 'fsSync',
    code + '\nreturn { artifactTypeOf, buildArtifact, buildArtifacts };')(pathMod, fsMod);
}

const B = loadBuilders();

t('构造器存在且导出三个函数', () => {
  assert.strictEqual(typeof B.artifactTypeOf, 'function');
  assert.strictEqual(typeof B.buildArtifact, 'function');
  assert.strictEqual(typeof B.buildArtifacts, 'function');
});

t('buildArtifact 必带前端需要的全部字段', () => {
  const a = B.buildArtifact({ taskId: 'T1', filePath: '/tmp/x/report.md', index: 0 });
  for (const k of ['id', 'name', 'type', 'path', 'downloadUrl', 'createdAt']) {
    assert.ok(k in a, `缺字段 ${k}`);
  }
});

t('downloadUrl 永远存在（这是按钮显示的依据）', () => {
  // 各种入参组合都不该漏
  const cases = [
    { taskId: 'T', filePath: '/a/b.md', index: 0 },
    { taskId: 'T', filePath: '/a/b.md', id: 'custom-0' },
    { taskId: 'T', filePath: '/a/b.docx', index: 5 },
  ];
  for (const c of cases) {
    const a = B.buildArtifact(c);
    assert.ok(a.downloadUrl && a.downloadUrl.startsWith('/api/tasks/'), `缺 downloadUrl: ${JSON.stringify(c)}`);
  }
});

t('类型按扩展名推断（不是硬编码 file）', () => {
  assert.strictEqual(B.artifactTypeOf('a.md'), 'report');
  assert.strictEqual(B.artifactTypeOf('a.txt'), 'report');
  assert.strictEqual(B.artifactTypeOf('a.docx'), 'file');
  assert.strictEqual(B.artifactTypeOf('a.png'), 'image');
  assert.strictEqual(B.artifactTypeOf('a.xlsx'), 'file');
});

t('buildArtifacts 去重 + 过滤审计文件 + 排序', () => {
  const files = [
    { filePath: '/o/t/a.docx', createdAt: '2026-01-01T00:00:00Z' },
    { filePath: '/o/t/b.md', createdAt: '2026-01-02T00:00:00Z' },
    { filePath: '/o/t/a.docx', createdAt: '2026-01-03T00:00:00Z' }, // 重复
    { filePath: '/o/t/执行证据.json', createdAt: '2026-01-04T00:00:00Z' },
  ];
  const arts = B.buildArtifacts('T', files, {});
  assert.strictEqual(arts.length, 2, `应去重为 2 条，实际 ${arts.length}`);
  assert.ok(!arts.some((a) => /执行证据/.test(a.name)), '审计文件未过滤');
  // 去重规则：保留「在本次排序中靠前」的那条。
  // newestFirst=true 时靠前=最新，所以重复的 a.docx 留下的是 01-03 那版；
  // b.md（01-02）排在它之后。两条都在，只是顺序如此。
  assert.strictEqual(arts[0].name, 'a.docx', '新的重复条目应被保留（对话轮要最新内容）');
  assert.strictEqual(arts[1].name, 'b.md');
});

t('limit 生效（对话轮只取 3 个）', () => {
  const files = ['a.md', 'b.docx', 'c.xlsx', 'd.json'].map((n, i) => ({
    filePath: `/o/t/${n}`, createdAt: `2026-01-0${i + 1}T00:00:00Z`,
  }));
  const arts = B.buildArtifacts('T', files, { limit: 3 });
  assert.strictEqual(arts.length, 3);
});

t('newestFirst=false 时按时间正序（注册表重建要最早的那条）', () => {
  const files = [
    { filePath: '/o/t/a.md', createdAt: '2026-01-02T00:00:00Z' },
    { filePath: '/o/t/b.md', createdAt: '2026-01-01T00:00:00Z' },
  ];
  const arts = B.buildArtifacts('T', files, { newestFirst: false, dedupeByName: false });
  assert.strictEqual(arts[0].name, 'b.md', '最早的文件应排第一');
});

// ---------------- 代码层：禁止手工构造 ----------------

t('后端不再有手工拼 artifacts 对象的地方', () => {
  // 判据：出现 `path: <expr>` 且同段落里有 `downloadUrl:` 的地方，
  // 只允许在 buildArtifact 内部。
  const buildStart = SERVER.indexOf('function buildArtifact(');
  const buildEnd = SERVER.indexOf('function buildArtifacts(');
  const buildBody = SERVER.slice(buildStart, buildEnd);
  assert.ok(/downloadUrl:/.test(buildBody), '构造器里应该有 downloadUrl');

  // 全文件搜「downloadUrl: `...artifact-\${i}...`」这种手工拼法
  const manual = [...SERVER.matchAll(/downloadUrl: `\/api\/tasks\/\$\{[^}]+\}\/artifacts\/artifact-\$\{i\}/g)];
  assert.strictEqual(manual.length, 0,
    `仍有 ${manual.length} 处手工拼 artifact-N 下载地址，应改用 buildArtifact`);
});

t('四个主要出口都调用了构造器', () => {
  const sites = [
    ['启动重建', 'task.artifacts = buildArtifacts(taskId, sorted'],
    ['注册表重建', 'buildArtifacts(taskId, rows'],
    ['对话轮', 'buildArtifacts(task.id, outs'],
    ['savedFiles', 'buildArtifact({\n          taskId: task.id, filePath, index: i,'],
  ];
  for (const [label, needle] of sites) {
    assert.ok(SERVER.includes(needle), `${label} 未使用构造器`);
  }
});

t('证据与 workflow 用 buildArtifact（保留自定义 id/downloadUrl）', () => {
  assert.ok(/id: `evidence-\$\{i\}`/.test(SERVER), '证据构造丢了');
  assert.ok(/buildArtifact\(\{\s*taskId: task\.id,\s*filePath,\s*id: `evidence-/.test(SERVER.replace(/\n/g, ' ')),
    '证据未走构造器');
  assert.ok(/const art = buildArtifact\(\{\s*taskId: workflowId/.test(SERVER.replace(/\n/g, ' ')),
    'workflow 未走构造器');
});

// ---------------- 前后端判据一致 ----------------

t('前后端的文本/二进制分类一致', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  // 2026-11-26：后端 ARTIFACT_TEXT_EXT 扩展为与前端 TEXT_EXTS 同一份清单
  // （原来只 md/markdown/txt，导致 .json/.csv 被标 file）
  assert.ok(/ARTIFACT_TEXT_EXT = \/\\\.\(md\|markdown\|txt\|csv\|json/.test(SERVER),
    '后端文本扩展名定义变了');
  assert.ok(/\\.\(md\|docx\?\|pdf\)/.test(CARD), '前端 kind 判定包含 md');
  // 二进制两边都要排除
  assert.ok(/ARTIFACT_BIN_EXT/.test(SERVER), '后端缺二进制定义');
  assert.ok(/\.docx/.test(CARD) && /\.xlsx/.test(CARD), '前端缺二进制排除');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
