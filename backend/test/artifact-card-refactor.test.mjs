/**
 * 输出物卡片重构（2026-11-25）
 *
 * 重构动因：同一张卡片在三个地方各写一份，判据不一致，导致同一个 bug
 * （按钮被 v-if="artifact.content" 隐藏）修了两处漏一处，用户报了两次
 * 「交付物少了按钮」。
 *
 * 抽成 ArtifactCard 后必须守住的三件事：
 *   1. 判据只有一份 —— 三个调用方都不许再自己写 v-if 判断可用性
 *   2. 后端只给 downloadUrl 时，预览/复制/用作输入都必须能用
 *   3. 各调用方仍能按需裁剪按钮（列表页不需要「编辑」）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const FE = path.join(ROOT, 'frontend', 'src');

const CARD = fs.readFileSync(path.join(FE, 'components', 'ArtifactCard.vue'), 'utf8');
const UNIFIED = fs.readFileSync(path.join(FE, 'components', 'UnifiedChatPanel.vue'), 'utf8');
const DASHBOARD = fs.readFileSync(path.join(FE, 'components', 'DashboardChatPanel.vue'), 'utf8');
const TASKS = fs.readFileSync(path.join(FE, 'views', 'TasksView.vue'), 'utf8');

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

console.log('=== 输出物卡片重构 单元测试 ===');

/** 只看生效代码，忽略注释（注释里会提到历史 bug 的写法） */
function realCode(src) {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|<!--|\*|\/\*|\{?\/\*)/.test(l))
    .join('\n');
}

// ---------------- 判据唯一 ----------------

t('判据只在 ArtifactCard 里定义', () => {
  assert.ok(/const hasContent = computed/.test(CARD), '组件缺 hasContent');
  assert.ok(/const canPreview = computed/.test(CARD), '组件缺 canPreview');
  // 三个调用方都不许再自己定义这些判据
  for (const [name, src] of [['UnifiedChatPanel', UNIFIED], ['DashboardChatPanel', DASHBOARD], ['TasksView', TASKS]]) {
    assert.ok(!/function hasArtifactContent/.test(src), `${name} 仍有自己的 hasArtifactContent`);
    assert.ok(!/function canPreviewArtifact/.test(src), `${name} 仍有自己的 canPreviewArtifact`);
  }
});

t('三个调用方都改用 ArtifactCard', () => {
  for (const [name, src] of [['UnifiedChatPanel', UNIFIED], ['DashboardChatPanel', DASHBOARD], ['TasksView', TASKS]]) {
    assert.ok(/<ArtifactCard/.test(src), `${name} 未使用 ArtifactCard`);
    assert.ok(/import ArtifactCard from '@\/components\/ArtifactCard\.vue'/.test(src), `${name} 未引入组件`);
  }
});

t('调用方不再自己写按钮的 v-if 可用性判断', () => {
  for (const [name, src] of [['UnifiedChatPanel', UNIFIED], ['DashboardChatPanel', DASHBOARD], ['TasksView', TASKS]]) {
    const code = realCode(src);
    const offenders = code.split('\n').filter((l) => /v-if="artifact\.(content|downloadUrl)/.test(l));
    assert.strictEqual(offenders.length, 0, `${name} 仍在用 v-if 判断可用性：\n${offenders.join('\n')}`);
  }
});

// ---------------- 后端只给 downloadUrl 时功能可用 ----------------

t('组件认 downloadUrl（不只是 content）', () => {
  const idx = CARD.indexOf('const hasContent = computed');
  const block = CARD.slice(idx, idx + 300);
  assert.ok(/a\.content \|\| a\.downloadUrl/.test(block), 'downloadUrl 未被算作有内容');
});

t('取内容带认证头（否则 401）', () => {
  const idx = CARD.indexOf('async function resolveContent');
  assert.ok(idx > 0, '缺 resolveContent');
  const block = CARD.slice(idx, idx + 700);
  assert.ok(/Authorization/.test(block), '未带认证头');
  assert.ok(/localStorage\.getItem\('token'\)/.test(block), '未读取 token');
});

t('预览/复制/用作输入都走 resolveContent', () => {
  for (const fn of ['onPreview', 'onCopy', 'onUseAsInput']) {
    const idx = CARD.indexOf(`function ${fn}`);
    assert.ok(idx > 0, `缺 ${fn}`);
    const block = CARD.slice(idx, idx + 600);
    assert.ok(/resolveContent\(\)/.test(block), `${fn} 未走统一取内容`);
  }
});

t('二进制格式不给预览和复制（按文本读是乱码）', () => {
  assert.ok(/BIN_EXTS/.test(CARD), '缺二进制扩展名列表');
  const idx = CARD.indexOf('const canPreview = computed');
  const block = CARD.slice(idx, idx + 200);
  assert.ok(/!isBinary\.value/.test(block), '预览未排除二进制');
  const copyIdx = CARD.indexOf('async function onCopy');
  assert.ok(/isBinary\.value/.test(CARD.slice(copyIdx, copyIdx + 400)), '复制未排除二进制');
});

// ---------------- 按需裁剪 ----------------

t('支持 show 数组裁剪按钮', () => {
  assert.ok(/show\?: ArtifactAction\[\]/.test(CARD), '缺 show prop');
  assert.ok(/function visible\(action: ArtifactAction\)/.test(CARD), '缺 visible 判定');
});

t('各调用方按场景传不同的 show', () => {
  // TasksView 与 DashboardChatPanel 都没有编辑器，不该给「编辑」按钮；
  // 只有 UnifiedChatPanel 有编辑弹窗，才需要。
  // （这正说明 show 裁剪是有意义的：按钮不该出现点了没反应的情况）
  const tasksShow = TASKS.match(/:show="\[([^\]]+)\]"/);
  assert.ok(tasksShow, 'TasksView 未传 show');
  assert.ok(!/edit/.test(tasksShow[1]), 'TasksView 不该有编辑按钮');

  const dashShow = DASHBOARD.match(/:show="\[([^\]]+)\]"/);
  assert.ok(dashShow, 'DashboardChatPanel 未传 show');
  assert.ok(!/edit/.test(dashShow[1]), 'DashboardChatPanel 没有编辑器，不该有编辑按钮');

  const unifiedShow = UNIFIED.match(/:show="\[([^\]]+)\]"/);
  assert.ok(unifiedShow && /edit/.test(unifiedShow[1]), 'UnifiedChatPanel 有编辑弹窗，应有编辑按钮');
});

// ---------------- 死代码清理 ----------------

t('UnifiedChatPanel 的预览弹窗已删除（只剩注释说明）', () => {
  // 注释里会写「输出物预览弹窗已移除」，所以要用「生效代码」判断：
  // 真弹窗的标志是 el-dialog + v-model="previewVisible"
  const code = realCode(UNIFIED);
  assert.ok(!/v-model="previewVisible"/.test(code), 'UnifiedChatPanel 仍有自己的预览弹窗');
  // ArtifactCard 自己有一个
  assert.ok(/el-dialog/.test(CARD), 'ArtifactCard 缺预览弹窗');
  assert.ok(/v-model="previewVisible"/.test(CARD), 'ArtifactCard 的弹窗没绑定状态');
});

t('UnifiedChatPanel 不再维护预览状态', () => {
  const code = realCode(UNIFIED);
  assert.ok(!/const previewVisible = ref/.test(code), '仍保留 previewVisible');
  assert.ok(!/const previewArtifact = ref/.test(code), '仍保留 previewArtifact');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
