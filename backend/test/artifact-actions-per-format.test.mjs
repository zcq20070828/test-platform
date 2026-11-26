/**
 * 各格式的按钮可用性（2026-11-26）
 *
 * 用户第五次报「少按钮」。这次截图里：
 *   md    → 预览、复制、用作输入、下载（四个都全）
 *   docx  → 用作输入、下载
 *   xlsx  → 用作输入、下载
 *
 * 查下来是两个问题叠加：
 *
 * 1. **docx/xlsx 本来可以预览**，被我判断错了。
 *    后端 /artifacts/:id/preview 支持 docx→HTML（convertDocxToHtml）、
 *    xlsx→HTML（convertXlsxToHtml）、图片直出。实测返回 200 + 45KB HTML。
 *    但前端 canPreview 用了「排除二进制」的判据，把 docx/xlsx 一起排除了。
 *
 * 2. **docx/xlsx 不该有「用作输入」**，反而被我放行了。
 *    用作输入要把内容填进提交框，必须前端读到文本；
 *    docx/xlsx 按 utf-8 读是乱码，填进去等于污染输入。
 *    之前用 hasContent 判断，二进制也显示按钮，点了塞乱码。
 *
 * 核心教训：**预览、复制、用作输入是三种不同能力，判据不该共用**：
 *   预览 → 走服务端转换，docx/xlsx 支持
 *   复制 / 用作输入 → 必须前端读文本，二进制不支持
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
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

console.log('=== 各格式按钮可用性 单元测试 ===');

/** 取判据定义段 */
function predicateBlock() {
  const start = CARD.indexOf('const canPreview = computed');
  assert.ok(start > 0, '找不到 canPreview');
  const end = CARD.indexOf('// ---------------- 取内容');
  return CARD.slice(start, end > start ? end : start + 2000);
}

t('后端确实支持 docx/xlsx 预览（服务端转 HTML）', () => {
  assert.ok(/convertDocxToHtml/.test(SERVER), '后端没有 docx 转换');
  assert.ok(/convertXlsxToHtml/.test(SERVER), '后端没有 xlsx 转换');
});

t('canPreview 包含 docx/xlsx（不再一律排除二进制）', () => {
  // 2026-11-26：判据改为引用常量 SERVER_PREVIEW_EXTS，定义在文件顶部
  assert.ok(/SERVER_PREVIEW_EXTS/.test(CARD), '缺少服务端可预览格式清单');
  const m = CARD.match(/const SERVER_PREVIEW_EXTS = (\/[^\n]+\/)/);
  assert.ok(m, '找不到 SERVER_PREVIEW_EXTS 定义');
  assert.ok(m[1].includes('docx') && m[1].includes('xlsx'),
    'SERVER_PREVIEW_EXTS 应包含 docx/xlsx，实际: ' + m[1]);
  assert.ok(/SERVER_PREVIEW_EXTS\.test\(n\)/.test(predicateBlock()),
    'canPreview 未使用该清单');
});

t('canPreview 包含图片格式', () => {
  const m2 = CARD.match(/const SERVER_PREVIEW_EXTS = (\/[^\n]+\/)/);
  assert.ok(m2 && /png|jpe/.test(m2[1]), 'SERVER_PREVIEW_EXTS 应包含图片格式');
});

t('canCopy 排除二进制（复制必须前端读文本）', () => {
  const block = predicateBlock();
  const idx = block.indexOf('const canCopy');
  assert.ok(idx > 0, '找不到 canCopy');
  assert.ok(/!isBinary\.value/.test(block.slice(idx, idx + 200)), 'canCopy 没排除二进制');
});

t('canUseAsInput 排除二进制（否则往输入框塞乱码）', () => {
  const block = predicateBlock();
  const idx = block.indexOf('const canUseAsInput');
  assert.ok(idx > 0, '找不到 canUseAsInput');
  assert.ok(/!isBinary\.value/.test(block.slice(idx, idx + 200)), 'canUseAsInput 没排除二进制');
});

t('三个判据在 visible 里分别使用（不再共用同一个）', () => {
  const start = CARD.indexOf('function visible(');
  assert.ok(start > 0, '找不到 visible');
  const block = CARD.slice(start, start + 600);
  assert.ok(/action === 'preview'\) return canPreview\.value/.test(block), 'preview 未用 canPreview');
  assert.ok(/action === 'copy'\) return canCopy\.value/.test(block), 'copy 未用 canCopy');
  assert.ok(/action === 'useAsInput'\) return canUseAsInput\.value/.test(block), 'useAsInput 未用 canUseAsInput');
});

t('预览对二进制走服务端端点（不是前端读文本）', () => {
  const start = CARD.indexOf('async function onPreview');
  assert.ok(start > 0, '找不到 onPreview');
  const block = CARD.slice(start, start + 1800);
  assert.ok(/isTextDoc/.test(block), '没有区分文本类与服务端转换类');
  assert.ok(/previewUrl\.value/.test(block), '二进制未走 preview 端点');
  assert.ok(/fetch\(url/.test(block), '没有实际请求预览地址');
});

t('previewUrl 由 downloadUrl 换出（只差最后一段）', () => {
  const start = CARD.indexOf('const previewUrl = computed');
  assert.ok(start > 0, '找不到 previewUrl');
  const block = CARD.slice(start, start + 300);
  assert.ok(block.includes("'/preview'"), '没有把 /download 换成 /preview');
  assert.ok(block.includes('/download'), '未匹配 /download 后缀');
});

t('图片预览转 data URL 展示', () => {
  const start = CARD.indexOf('async function onPreview');
  const block = CARD.slice(start, start + 2600);
  assert.ok(block.includes("startsWith('image/')"), '没有处理 image 响应');
  assert.ok(/createObjectURL/.test(block), '图片未转成可展示地址');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
