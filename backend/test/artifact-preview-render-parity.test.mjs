/**
 * 预览判据与渲染方式必须一致（2026-11-26）
 *
 * 全链路梳理时发现的缺口：
 *   .py / .csv / .json / .js 这类**纯文本**文件，能复制（说明可读），
 *   却不能预览 —— 因为 canPreview 的白名单只有 md/txt/docx/xlsx/图片，
 *   而 onPreview 会把它们送去服务端 /preview（对该格式返回 415）。
 *
 * 判据自相矛盾：能复制却不能预览。
 *
 * 修法：把「纯文本扩展名」抽成常量 TEXT_EXTS，canPreview 与 onPreview
 * 共用同一份；并且非 Markdown 的纯文本用等宽预排版渲染
 * （用 Markdown 渲染 CSV 会挤成一段、Python 代码会被当普通段落）。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');

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

console.log('=== 预览判据与渲染一致 单元测试 ===');

t('存在 TEXT_EXTS 常量（纯文本扩展名唯一清单）', () => {
  const m = CARD.match(/const TEXT_EXTS = (\/[^\n]+\/)/);
  assert.ok(m, '找不到 TEXT_EXTS');
  // 用「实际执行正则」验证，不用字面量 includes
  // （TEXT_EXTS 里写的是 ya?ml，字面查 'yml' 会误判）
  const re = new RegExp(m[1].slice(1, -1));
  for (const ext of ['.md', '.txt', '.csv', '.json', '.py', '.js', '.sql', '.yml', '.yaml']) {
    assert.ok(re.test('x' + ext), `TEXT_EXTS 未覆盖 ${ext}`);
  }
  // 二进制不该被当成文本
  for (const ext of ['.docx', '.xlsx', '.pdf', '.zip']) {
    assert.ok(!re.test('x' + ext), `TEXT_EXTS 不该匹配 ${ext}`);
  }
});

t('canPreview 与 onPreview 共用 TEXT_EXTS（不各写一份）', () => {
  // canPreview 里引用
  const cp = CARD.indexOf('const canPreview = computed');
  assert.ok(cp > 0, '找不到 canPreview');
  const cpBlock = CARD.slice(cp, cp + 400);
  assert.ok(/TEXT_EXTS\.test/.test(cpBlock), 'canPreview 未用 TEXT_EXTS');

  // onPreview 里引用
  const op = CARD.indexOf('async function onPreview');
  assert.ok(op > 0, '找不到 onPreview');
  const opBlock = CARD.slice(op, op + 2600);
  assert.ok(/TEXT_EXTS\.test/.test(opBlock), 'onPreview 未用 TEXT_EXTS');
});

t('现在不会出现「能复制却不能预览」的扩展名', () => {
  // 模拟判据：BIN_EXTS 之外都算可读文本
  const binMatch = CARD.match(/const BIN_EXTS = \[([^\]]+)\]/);
  const textMatch = CARD.match(/const TEXT_EXTS = (\/[^\n]+\/)/);
  const srvMatch = CARD.match(/const SERVER_PREVIEW_EXTS = (\/[^\n]+\/)/);
  assert.ok(binMatch && textMatch && srvMatch, '缺常量');

  const binExts = binMatch[1].split(',').map((x) => x.trim().replace(/['"]/g, ''));
  const textRe = new RegExp(textMatch[1].slice(1, -1));
  const srvRe = new RegExp(srvMatch[1].slice(1, -1));

  const candidates = ['.md', '.csv', '.json', '.py', '.js', '.txt', '.sql'];
  for (const ext of candidates) {
    const isBin = binExts.includes(ext);
    const canCopy = !isBin;
    const canPreview = textRe.test('x' + ext) || srvRe.test('x' + ext);
    assert.ok(!(canCopy && !canPreview),
      `${ext} 仍能复制但不能预览`);
  }
});

t('非 Markdown 纯文本用等宽预排版（不用 Markdown 渲染）', () => {
  const op = CARD.indexOf('async function onPreview');
  const block = CARD.slice(op, op + 2600);
  assert.ok(/isMarkdown/.test(block), '没有区分 Markdown 与普通文本');
  assert.ok(/<pre/.test(block), '普通文本未用 pre 渲染');
  assert.ok(/escapeHtml\(content\)/.test(block), '普通文本未转义（会 XSS）');
});

t('Markdown 仍走完整渲染（表格/代码高亮）', () => {
  const op = CARD.indexOf('async function onPreview');
  const block = CARD.slice(op, op + 2600);
  assert.ok(/renderMarkdownSafe\(content, previewMarked\)/.test(block), 'Markdown 未走渲染器');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
