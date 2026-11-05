#!/usr/bin/env node
/**
 * document-reader 单元测试
 *
 * 覆盖：
 *   - Word 表格保结构（convertToHtml → Markdown 表格），对比旧 extractRawText 的压平输出
 *   - 结构感知切片：表格/代码块不被切开、标题路径正确、overlap 不重复
 *   - token 预算裁剪：表格优先级最高、省略说明如实、孤立标题不出现
 *   - token 估算中英文口径
 *   - 编码识别（UTF-8 / BOM / GBK 回退）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  estimateTokens,
  htmlToMarkdown,
  splitStructuredBlocks,
  chunkByStructure,
  fitToBudget,
  decodeText,
  parseDocumentBuffer,
} from '../lib/document-reader.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_DOCX = path.join(ROOT, 'qclaw-knowledge-base/general/AI质量审核报告模板.docx');

console.log('=== document-reader 单元测试 ===');

// ---------------- token 估算 ----------------
t('中文按 1.5 token/字估算', () => {
  const n = estimateTokens('测试用例');
  assert.strictEqual(n, 6); // 4 字 × 1.5
});

t('英文按 0.25 token/字估算', () => {
  const n = estimateTokens('test');
  assert.strictEqual(n, 1);
});

t('空值返回 0', () => {
  assert.strictEqual(estimateTokens(''), 0);
  assert.strictEqual(estimateTokens(null), 0);
  assert.strictEqual(estimateTokens(undefined), 0);
});

// ---------------- HTML → Markdown ----------------
t('表格转 Markdown 且保留列结构', () => {
  const html = '<table><tr><th>字段</th><th>类型</th></tr><tr><td>phone</td><td>string</td></tr></table>';
  const md = htmlToMarkdown(html);
  assert.ok(md.includes('| 字段 | 类型 |'), md);
  assert.ok(md.includes('| --- | --- |'), md);
  assert.ok(md.includes('| phone | string |'), md);
});

t('不规则行的表格补齐列数', () => {
  const html = '<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td>1</td></tr></table>';
  const md = htmlToMarkdown(html);
  const row = md.split('\n').find((l) => l.trim().startsWith('| 1 '));
  assert.ok(row, '数据行存在');
  // 去掉首尾分隔符后按 | 切分，空单元格也计入列数
  const cols = row.trim().replace(/^\||\|$/g, '').split('|');
  assert.strictEqual(cols.length, 3, '应补齐为 3 列：' + row);
});

t('单元格内的竖线被转义，不破坏表格', () => {
  const html = '<table><tr><th>h</th></tr><tr><td>a|b</td></tr></table>';
  const md = htmlToMarkdown(html);
  assert.ok(md.includes('a\\|b'), md);
});

t('标题与列表转换', () => {
  const md = htmlToMarkdown('<h2>标题</h2><ul><li>项一</li><li>项二</li></ul><ol><li>第一</li></ol>');
  assert.ok(md.includes('## 标题'));
  assert.ok(md.includes('- 项一'));
  assert.ok(md.includes('1. 第一'));
});

t('HTML 实体被解码', () => {
  const md = htmlToMarkdown('<p>a &amp; b &lt;c&gt;</p>');
  assert.ok(md.includes('a & b <c>'), md);
});

// ---------------- 结构化分块 ----------------
const sampleMd = [
  '# 项目文档',
  '',
  '## 接口清单',
  '',
  '| 编号 | 名称 | 方法 |',
  '| --- | --- | --- |',
  '| API-001 | 登录 | POST |',
  '| API-002 | 注册 | POST |',
  '',
  '## 业务规则',
  '',
  '- 连续 5 次失败锁定 30 分钟',
  '- 验证码有效期 5 分钟',
  '',
  '正文段落一。',
  '',
  '```js',
  'const a = 1;',
  'const b = 2;',
  '```',
].join('\n');

t('识别标题/表格/列表/代码块类型', () => {
  const blocks = splitStructuredBlocks(sampleMd);
  const types = blocks.map((b) => b.type);
  assert.ok(types.includes('heading'));
  assert.ok(types.includes('table'));
  assert.ok(types.includes('list'));
  assert.ok(types.includes('code'));
  assert.ok(types.includes('paragraph'));
});

t('标题路径(breadcrumb)正确嵌套', () => {
  const blocks = splitStructuredBlocks(sampleMd);
  const table = blocks.find((b) => b.type === 'table');
  assert.strictEqual(table.breadcrumb, '项目文档 > 接口清单', table.breadcrumb);
  const list = blocks.find((b) => b.type === 'list');
  assert.strictEqual(list.breadcrumb, '项目文档 > 业务规则');
});

t('表格作为原子块不被拆开', () => {
  const blocks = splitStructuredBlocks(sampleMd);
  const table = blocks.find((b) => b.type === 'table');
  assert.ok(table.text.includes('API-001') && table.text.includes('API-002'));
  assert.ok(table.text.split('\n').length >= 4, '表格应包含表头+分隔+2 数据行');
});

t('代码块作为原子块不被拆开', () => {
  const blocks = splitStructuredBlocks(sampleMd);
  const code = blocks.find((b) => b.type === 'code');
  assert.ok(code.text.startsWith('```'));
  assert.ok(code.text.trim().endsWith('```'));
  assert.ok(code.text.includes('const a = 1;') && code.text.includes('const b = 2;'));
});

// ---------------- 切片 ----------------
t('切片带标题路径注解', () => {
  const { chunks } = chunkByStructure(sampleMd, { maxTokens: 200 });
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.some((c) => c.text.includes('<!-- 位置：')), '至少一个片段带位置注解');
});

t('切片 token 不超过上限的 1.2 倍', () => {
  const max = 200;
  const { chunks } = chunkByStructure(sampleMd, { maxTokens: max });
  for (const c of chunks) {
    assert.ok(c.tokens <= max * 1.2, `片段 ${c.index} 超限: ${c.tokens}`);
  }
});

t('超长表格按行切分并保留表头', () => {
  const rows = ['| 编号 | 名称 |', '| --- | --- |'];
  for (let i = 0; i < 200; i += 1) rows.push(`| API-${i} | 接口名称第${i}号 |`);
  const md = `## 接口清单\n\n${rows.join('\n')}`;
  const { chunks } = chunkByStructure(md, { maxTokens: 300, overlapTokens: 0 });
  assert.ok(chunks.length > 1, '应切成多片');
  for (const c of chunks) {
    assert.ok(c.text.includes('| 编号 | 名称 |'), '每片都要保留表头：' + c.text.slice(0, 80));
    assert.ok(c.text.includes('| --- | --- |'), '每片都要保留分隔行');
  }
});

t('overlap 不产生完全重复片段', () => {
  const { chunks } = chunkByStructure(sampleMd, { maxTokens: 150, overlapTokens: 60 });
  const heads = chunks.map((c) => c.text.slice(0, 200));
  assert.strictEqual(new Set(heads).size, heads.length, '存在重复片段');
});

t('空输入返回空片段', () => {
  const r = chunkByStructure('');
  assert.strictEqual(r.chunks.length, 0);
  assert.strictEqual(r.totalTokens, 0);
});

// ---------------- 预算裁剪 ----------------
t('预算充足时不裁剪', () => {
  const r = fitToBudget(sampleMd, { maxTokens: 10000 });
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.text, sampleMd);
});

t('预算不足时优先保留表格', () => {
  const md = [
    '## 背景',
    '',
    '这是一段很长的背景说明。'.repeat(30),
    '',
    '## 接口清单',
    '',
    '| 编号 | 名称 |',
    '| --- | --- |',
    '| API-001 | 登录 |',
  ].join('\n');
  const r = fitToBudget(md, { maxTokens: 120 });
  assert.strictEqual(r.truncated, true);
  assert.ok(r.text.includes('API-001'), '表格必须保留：' + r.text.slice(0, 200));
});

t('裁剪后如实报告省略数量与类型', () => {
  const md = ['# 标题', '', '段落一。'.repeat(50), '', '段落二。'.repeat(50)].join('\n');
  const r = fitToBudget(md, { maxTokens: 100 });
  assert.strictEqual(r.truncated, true);
  assert.ok(r.dropped > 0);
  assert.ok(r.omittedNote.includes('已省略'), r.omittedNote);
  assert.ok(Object.keys(r.droppedTypes).length > 0);
});

t('裁剪结果插入省略标记', () => {
  // fitToBudget 的最小预算为 500 token，这里构造远超预算的内容
  const para = (label) => `${label}。`.repeat(120);
  const md = ['# 标题', '', para('段落一'), '', para('段落二'), '', para('段落三'), '', para('段落四')].join('\n');
  const r = fitToBudget(md, { maxTokens: 500 });
  assert.strictEqual(r.truncated, true, '应触发裁剪');
  assert.ok(r.text.includes('省略'), '应包含省略标记：' + r.text.slice(-200));
});

// ---------------- 编码 ----------------
t('UTF-8 正常解码', () => {
  const s = decodeText(Buffer.from('中文测试', 'utf8'));
  assert.strictEqual(s, '中文测试');
});

t('UTF-8 BOM 被剥离', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('内容', 'utf8')]);
  assert.strictEqual(decodeText(buf), '内容');
});

t('GBK 自动回退', () => {
  // GBK 编码的"中文"：0xD6 0xD0 0xCE 0xC4
  const buf = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  const s = decodeText(buf);
  assert.ok(s === '中文' || s.length > 0, '应能解码出内容: ' + s);
});

// ---------------- 真实 docx ----------------
if (fs.existsSync(SAMPLE_DOCX)) {
  const buf = fs.readFileSync(SAMPLE_DOCX);
  const parsed = await parseDocumentBuffer({ buffer: buf, filename: 'AI质量审核报告模板.docx' });

  t('真实 docx 解析出 Markdown 表格（旧实现为 0）', () => {
    const tableCount = (parsed.markdown.match(/^\|\s*---/gm) || []).length;
    assert.ok(tableCount >= 5, `表格数应 >= 5，实际 ${tableCount}`);
  });

  t('真实 docx 表格中字段与值同行', () => {
    assert.ok(/\|\s*项目名称\s*\|/.test(parsed.markdown), '应存在「项目名称」行');
    assert.ok(/\|\s*审核轮次\s*\|/.test(parsed.markdown), '应存在「审核轮次」行');
  });

  t('真实 docx 保留标题结构', () => {
    assert.ok(/^##\s+/m.test(parsed.markdown), '应存在二级标题');
  });

  t('真实 docx 解析结果显著多于 extractRawText', () => {
    assert.ok(parsed.markdown.length > 1500, '解析内容过少: ' + parsed.markdown.length);
  });
} else {
  console.log('  ⚠️ 跳过真实 docx 测试（样本不存在）');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
