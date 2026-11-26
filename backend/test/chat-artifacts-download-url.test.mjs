/**
 * 对话轮的交付物卡片必须带 downloadUrl（2026-11-26）
 *
 * 用户第四次报「又少按钮了」。这次是对话模式（chat 链路），
 * 截图里 4 个输出物全都只有「下载」一个按钮。
 *
 * 根因：executeChatRound 构造 chatArtifacts 时只给了
 *   { id, name, type, path, version, source }
 * **没有 downloadUrl**。
 *
 * 而 ArtifactCard 的 hasContent 判据是 `content || downloadUrl`：
 * 两者都没有 → 预览/复制/用作输入全部隐藏，只剩「下载」；
 * 而且点「下载」还会提示「该输出物没有可下载的内容」。
 *
 * 同时修了两个相关问题：
 *   1. 原来 slice(0, 4) 会把同一交付物的重复条目算进来
 *      （实测 4 条里 2 条是重复的 docx/xlsx）
 *   2. 索引对齐：下载接口 findArtifactCompat 是按 task.artifacts 下标解析
 *      artifact-N 的，chatArtifacts 用去重后的下标却不同步 task.artifacts
 *      会点到错文件
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

console.log('=== 对话轮交付物卡片 单元测试 ===');

/** 取 chatArtifacts 构造段 */
function chatArtifactBlock() {
  const start = SERVER.indexOf('let chatArtifacts = [];');
  assert.ok(start > 0, '找不到 chatArtifacts 构造');
  const end = SERVER.indexOf('broadcast({', start);
  assert.ok(end > start, '找不到广播位置');
  return SERVER.slice(start, end);
}

t('chatArtifacts 带 downloadUrl（这是按钮显示的依据）', () => {
  const block = chatArtifactBlock();
  assert.ok(/downloadUrl:/.test(block), '缺少 downloadUrl —— 前端 hasContent 会判 false，按钮全隐藏');
});

t('downloadUrl 指向本任务的 artifacts 下载路由', () => {
  const block = chatArtifactBlock();
  assert.ok(/downloadUrl: `\/api\/tasks\/\$\{task\.id\}\/artifacts\/artifact-\$\{i\}\/download`/.test(block),
    'downloadUrl 格式不对');
});

t('按文件名去重（不再 slice(0,4) 带重复）', () => {
  const block = chatArtifactBlock();
  assert.ok(/seenNames/.test(block), '缺少去重');
  // 注释里会写「原来直接 slice(0, 4)」，允许；只看生效代码
  const code = block.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/slice\(0, 4\)/.test(code), '仍是裸 slice(0,4)');
});

t('排除审计证据文件', () => {
  const block = chatArtifactBlock();
  assert.ok(/执行证据|evidence/.test(block), '未排除证据文件');
});

t('索引与 task.artifacts 同步（否则点下载会拿错文件）', () => {
  const block = chatArtifactBlock();
  assert.ok(/task\.artifacts = chatArtifacts\.map/.test(block),
    '没有把 task.artifacts 同步成去重后的内容，artifact-N 下标会错位');
});

t('同步后落库（否则下次读库又是不一致的）', () => {
  const block = chatArtifactBlock();
  assert.ok(/persistTask\(task\.id\)/.test(block), '同步后未落库');
});

// ---------------- 文件名括号 ----------------

function loadNamer() {
  const grab = (n) => {
    const start = SERVER.indexOf(`function ${n}(`);
    assert.ok(start > 0, `找不到 ${n}`);
    const rest = SERVER.slice(start + 10);
    const next = rest.search(/\n(?:async )?function /);
    return SERVER.slice(start, start + 10 + (next > 0 ? next : 4000));
  };
  const code = [
    grab('stripProjectNameExplanation'),
    grab('extractReportProjectName'),
    grab('extractProjectInfo'),
    grab('buildDeliverableBaseName'),
  ].join('\n');
  return new Function(
    `const UNKNOWN_PROJECT_NAME = ${JSON.stringify('不知名项目')};\n${code}\n`
    + 'return { buildDeliverableBaseName };',
  )();
}

const naming = loadNamer();

t('未配对的括号会被清掉（实测文件名成了「…技术方案（需求分析报告.md」）', () => {
  const content = '| 项目名称 | 托管系统技术方案（**来源**：输入中「项目名称」行原样出现；说明：见 CL-005） |';
  const base = naming.buildDeliverableBaseName(content, '需求分析报告');
  assert.ok(!/[（(]/.test(base), `文件名仍带孤立括号：${base}`);
  assert.ok(base.startsWith('托管系统技术方案'), `项目名被误删：${base}`);
});

t('正常成对括号不受影响', () => {
  const content = '- 项目名称：托管系统（IDaaS 认证服务端）';
  const base = naming.buildDeliverableBaseName(content, '需求分析报告');
  // 成对括号在「剥括号补充」那一步就去掉了，这里只要求结果干净、项目名在
  assert.ok(base.startsWith('托管系统'), `项目名丢了：${base}`);
  assert.ok(!/[（()）]/.test(base), `残留括号：${base}`);
});

t('无括号的项目名不受影响', () => {
  const base = naming.buildDeliverableBaseName('- 项目名称：托管系统技术方案', '需求分析报告');
  assert.strictEqual(base, '托管系统技术方案需求分析报告');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
