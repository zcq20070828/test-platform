/**
 * 输入文档统一解析与切片（2026-11-05）
 *
 * 目标：让「用户上传的文档」在进入 LLM 前保持结构可信——
 *   1. Word 表格不再被压平（mammoth.convertToHtml → Markdown 表格）；
 *   2. 所有入口共用同一套解析逻辑，避免聊天面板/分步面板行为不一致；
 *   3. 按 token 预算做**结构感知**切片，而不是按字符粗暴截断。
 *
 * 切片策略（业界通行做法）：
 *   - 以 Markdown 结构为边界（标题 > 段落 > 列表项 > 句子），不做定长硬切；
 *   - 表格、列表、代码块视为**原子块**，绝不从中间切开；
 *   - 每个片段带上标题路径（breadcrumb），让模型缺失上下文时仍知道自己在哪一节；
 *   - 片段之间保留 overlap，跨片段引用不断裂；
 *   - 预算按 token 计（中文 1 字 ≈ 1.5 token），超预算时优先舍弃低价值段落并**如实告知**被省略的内容。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ============================================================
// 1. Token 估算（与 context-manager 同口径，便于交叉核对）
// ============================================================

/**
 * 估算 token 数：中文按 1.5、英文按 0.25（保守偏高，避免超上下文）
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const english = (text.match(/[a-zA-Z]/g) || []).length;
  const other = text.length - chinese - english;
  return Math.ceil(chinese * 1.5 + english * 0.25 + other * 0.5);
}

// ============================================================
// 2. HTML → Markdown（保留表格结构）
// ============================================================

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * 只剥标签、不解实体。
 *
 * 实体解码必须放在**最后一步统一做一次**：若在中间阶段解码，
 * `&lt;c&gt;` 会先变成字面量 `<c>`，随后又被标签正则删掉，导致内容丢失。
 */
function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, '').trim();
}

/** 把表格 cell 内的多行文本压成一行，避免破坏 Markdown 表格 */
function cellText(html) {
  return stripTags(String(html || '').replace(/<\/p>\s*<p[^>]*>/gi, '<br>'))
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 将 mammoth.convertToHtml 的输出转成 Markdown
 * 只处理文档常见标签：h1-h6 / p / table / ul / ol / li / strong / em / br / img
 * @param {string} html
 * @returns {string} markdown
 */
export function htmlToMarkdown(html) {
  if (!html) return '';
  let md = String(html);

  // 表格：先处理，避免内部 <p> 被后面的规则误伤
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner) => {
    const rows = [];
    let caption = '';
    const capMatch = inner.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
    if (capMatch) caption = stripTags(capMatch[1]);

    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(inner))) {
      const cells = [];
      const cellRe = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) cells.push(cellText(cm[2]));
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return '';

    const width = Math.max(...rows.map((r) => r.length));
    const norm = rows.map((r) => {
      const copy = r.slice();
      while (copy.length < width) copy.push('');
      return copy;
    });
    const head = norm[0];
    const body = norm.slice(1);
    const lines = [];
    if (caption) lines.push(`**${caption}**`, '');
    lines.push(`| ${head.join(' | ')} |`);
    lines.push(`| ${head.map(() => '---').join(' | ')} |`);
    for (const r of body) lines.push(`| ${r.join(' | ')} |`);
    return `\n\n${lines.join('\n')}\n\n`;
  });

  // 标题
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, t) => {
    return `\n\n${'#'.repeat(Number(lvl))} ${stripTags(t)}\n\n`;
  });

  // 列表
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner) => {
    const items = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let lm;
    while ((lm = liRe.exec(inner))) items.push(`- ${stripTags(lm[1])}`);
    return `\n\n${items.join('\n')}\n\n`;
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => {
    const items = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let lm;
    let i = 0;
    while ((lm = liRe.exec(inner))) {
      i += 1;
      items.push(`${i}. ${stripTags(lm[1])}`);
    }
    return `\n\n${items.join('\n')}\n\n`;
  });

  // 强调
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // 段落与换行
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, t) => {
    const text = stripTags(t);
    return text ? `\n\n${text}\n\n` : '\n\n';
  });

  // 剩余标签清空后，统一解码一次 HTML 实体
  md = decodeEntities(stripTags(md));

  // 归一化空行（最多保留一个空行）
  return md.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================
// 3. 结构感知切片
// ============================================================

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TABLE_ROW_RE = /^\|.*\|$/;
const FENCE_RE = /^```/;

/**
 * 把 Markdown 切成「结构块」：标题块、表格块、代码块、列表块、段落块
 * 表格/代码块整体不可分（原子块）
 * @param {string} markdown
 * @returns {Array<{type: string, text: string, breadcrumb: string, headings: string[]}>}
 */
export function splitStructuredBlocks(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const blocks = [];
  const headingStack = []; // [{level, text}]
  let i = 0;

  const breadcrumb = () => headingStack.map((h) => h.text).join(' > ');

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (!line.trim()) { i += 1; continue; }

    // 标题
    const hm = line.match(HEADING_RE);
    if (hm) {
      const level = hm[1].length;
      const text = hm[2].trim();
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
      headingStack.push({ level, text });
      blocks.push({ type: 'heading', text: line.trim(), breadcrumb: breadcrumb(), headings: headingStack.map((h) => h.text) });
      i += 1;
      continue;
    }

    // 代码块（原子）
    if (FENCE_RE.test(line)) {
      const buf = [line];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) { buf.push(lines[i]); i += 1; }
      if (i < lines.length) { buf.push(lines[i]); i += 1; }
      blocks.push({ type: 'code', text: buf.join('\n'), breadcrumb: breadcrumb(), headings: headingStack.map((h) => h.text) });
      continue;
    }

    // 表格（原子）
    if (TABLE_ROW_RE.test(line.trim())) {
      const buf = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i].trim())) { buf.push(lines[i]); i += 1; }
      blocks.push({ type: 'table', text: buf.join('\n'), breadcrumb: breadcrumb(), headings: headingStack.map((h) => h.text) });
      continue;
    }

    // 列表（连续列表项作为一个块）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      blocks.push({ type: 'list', text: buf.join('\n'), breadcrumb: breadcrumb(), headings: headingStack.map((h) => h.text) });
      continue;
    }

    // 普通段落（连续非空行）
    const buf = [];
    while (
      i < lines.length
      && lines[i].trim()
      && !HEADING_RE.test(lines[i])
      && !TABLE_ROW_RE.test(lines[i].trim())
      && !FENCE_RE.test(lines[i])
      && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    if (buf.length) {
      blocks.push({ type: 'paragraph', text: buf.join('\n'), breadcrumb: breadcrumb(), headings: headingStack.map((h) => h.text) });
    }
  }

  return blocks.filter((b) => b.text.trim());
}

/**
 * 超长原子块（表格/代码）按行切分，并保留表头
 * @param {{type:string,text:string,breadcrumb:string,headings:string[]}} block
 * @param {number} maxTokens
 * @returns {Array}
 */
function splitOversizeBlock(block, maxTokens) {
  if (estimateTokens(block.text) <= maxTokens) return [block];
  const lines = block.text.split('\n');

  // 表格：保留表头 + 分隔行，数据行按预算分组
  if (block.type === 'table' && lines.length > 2) {
    const head = lines.slice(0, 2);
    const headTokens = estimateTokens(head.join('\n'));
    const body = lines.slice(2);
    const parts = [];
    let cur = [];
    let curTokens = headTokens;
    for (const row of body) {
      const t = estimateTokens(row);
      if (cur.length && curTokens + t > maxTokens) {
        parts.push([...head, ...cur].join('\n'));
        cur = [];
        curTokens = headTokens;
      }
      cur.push(row);
      curTokens += t;
    }
    if (cur.length) parts.push([...head, ...cur].join('\n'));
    return parts.map((text, idx) => ({ ...block, text, part: idx + 1, partTotal: parts.length }));
  }

  // 其它：按行累积
  const parts = [];
  let cur = [];
  let curTokens = 0;
  for (const line of lines) {
    const t = estimateTokens(line);
    if (cur.length && curTokens + t > maxTokens) {
      parts.push(cur.join('\n'));
      cur = [];
      curTokens = 0;
    }
    cur.push(line);
    curTokens += t;
  }
  if (cur.length) parts.push(cur.join('\n'));
  return parts.map((text, idx) => ({ ...block, text, part: idx + 1, partTotal: parts.length }));
}

/**
 * 结构感知切片
 * @param {string} markdown
 * @param {Object} [options]
 * @param {number} [options.maxTokens=1200] - 单片段 token 上限
 * @param {number} [options.overlapTokens=120] - 片段间重叠 token
 * @param {boolean} [options.withBreadcrumb=true] - 片段开头是否附带标题路径
 * @returns {{chunks: Array<{text:string,index:number,tokens:number,breadcrumb:string}>, totalTokens:number, blockCount:number}}
 */
export function chunkByStructure(markdown, options = {}) {
  const maxTokens = Math.max(200, Number(options.maxTokens) || 1200);
  const overlapTokens = Math.max(0, Number(options.overlapTokens ?? 120));
  const withBreadcrumb = options.withBreadcrumb !== false;

  const blocks = splitStructuredBlocks(markdown);
  const expanded = blocks.flatMap((b) => splitOversizeBlock(b, maxTokens));

  const chunks = [];
  let cur = [];
  let curTokens = 0;

  const flush = () => {
    if (!cur.length) return;
    const body = cur.map((b) => b.text).join('\n\n');
    // 片段归属用**首个**内容块的标题路径：它决定这段内容讲的是哪一节
    const crumb = cur.find((b) => b.type !== 'heading' && b.breadcrumb)?.breadcrumb
      || cur.find((b) => b.breadcrumb)?.breadcrumb
      || '';
    const prefix = withBreadcrumb && crumb ? `<!-- 位置：${crumb} -->\n` : '';
    chunks.push({
      index: chunks.length,
      text: prefix + body,
      tokens: estimateTokens(prefix + body),
      breadcrumb: crumb,
    });
    // 保留尾部若干个块作为下一片段的 overlap
    if (overlapTokens > 0) {
      const tail = [];
      let tailTokens = 0;
      for (let k = cur.length - 1; k >= 0; k -= 1) {
        const t = estimateTokens(cur[k].text);
        if (tailTokens + t > overlapTokens) break;
        tail.unshift(cur[k]);
        tailTokens += t;
      }
      cur = tail;
      curTokens = tailTokens;
    } else {
      cur = [];
      curTokens = 0;
    }
  };

  for (const block of expanded) {
    const t = estimateTokens(block.text);
    const onlyHeadings = cur.length > 0 && cur.every((b) => b.type === 'heading');
    // 当前片段只有标题时不要因下一个大块而单独成片：标题应与它的内容同片
    if (cur.length && curTokens + t > maxTokens && !onlyHeadings) flush();
    cur.push(block);
    curTokens += t;
  }
  flush();

  // 去掉因 overlap 产生的重复尾片段
  const seen = new Set();
  const deduped = [];
  for (const c of chunks) {
    const key = c.text.slice(0, 400);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...c, index: deduped.length });
  }

  return {
    chunks: deduped,
    totalTokens: estimateTokens(markdown),
    blockCount: blocks.length,
  };
}

// ============================================================
// 4. 预算内保结构裁剪
// ============================================================

/**
 * 在 token 预算内保留尽可能多的结构化内容
 *
 * 取舍优先级：表格 > 标题 > 列表 > 段落 > 代码
 * （表格承载字段/接口/用例等关键约束，优先级最高）
 *
 * @param {string} markdown
 * @param {Object} [options]
 * @param {number} [options.maxTokens=30000]
 * @returns {{text:string, kept:number, dropped:number, droppedTypes:Object, truncated:boolean, omittedNote:string}}
 */
export function fitToBudget(markdown, options = {}) {
  const maxTokens = Math.max(500, Number(options.maxTokens) || 30000);
  const blocks = splitStructuredBlocks(markdown);

  const total = blocks.reduce((acc, b) => acc + estimateTokens(b.text), 0);
  if (total <= maxTokens) {
    return { text: markdown, kept: blocks.length, dropped: 0, droppedTypes: {}, truncated: false, omittedNote: '' };
  }

  const priority = { table: 0, heading: 1, list: 2, paragraph: 3, code: 4 };
  const indexed = blocks.map((b, idx) => ({ ...b, idx, tokens: estimateTokens(b.text) }));

  // 先按优先级，再按原文顺序，贪心装满预算
  const ordered = [...indexed].sort((a, b) => {
    const pa = priority[a.type] ?? 5;
    const pb = priority[b.type] ?? 5;
    if (pa !== pb) return pa - pb;
    return a.idx - b.idx;
  });

  const keptIdx = new Set();
  let used = 0;
  for (const b of ordered) {
    if (used + b.tokens > maxTokens) continue;
    keptIdx.add(b.idx);
    used += b.tokens;
    // 命中标题时顺带保留紧随其后的一个块，避免出现孤立标题
    if (b.type === 'heading' && indexed[b.idx + 1] && !keptIdx.has(indexed[b.idx + 1].idx)) {
      const nb = indexed[b.idx + 1];
      if (used + nb.tokens <= maxTokens * 1.05) {
        keptIdx.add(nb.idx);
        used += nb.tokens;
      }
    }
  }

  const keptBlocks = indexed.filter((b) => keptIdx.has(b.idx));
  const droppedBlocks = indexed.filter((b) => !keptIdx.has(b.idx));

  const droppedTypes = {};
  for (const b of droppedBlocks) droppedTypes[b.type] = (droppedTypes[b.type] || 0) + 1;

  // 还原原文顺序，插入省略标记
  const parts = [];
  let lastIdx = -1;
  for (const b of keptBlocks) {
    if (lastIdx >= 0 && b.idx > lastIdx + 1) {
      const skipped = indexed.filter((x) => x.idx > lastIdx && x.idx < b.idx).length;
      parts.push(`\n<!-- 此处省略 ${skipped} 个段落/表格（超出 token 预算） -->\n`);
    }
    parts.push(b.text);
    lastIdx = b.idx;
  }
  // 尾部省略：最后保留块之后还有内容时也要标记，否则读者会以为文档到此结束
  const tailSkipped = indexed.filter((x) => x.idx > lastIdx).length;
  if (tailSkipped > 0) {
    parts.push(`\n<!-- 文末省略 ${tailSkipped} 个段落/表格（超出 token 预算） -->\n`);
  }

  const omittedNote = droppedBlocks.length
    ? `已省略 ${droppedBlocks.length} 个块（${Object.entries(droppedTypes).map(([k, v]) => `${k}×${v}`).join('、')}），原始约 ${total} token，保留约 ${used} token。`
    : '';

  return {
    text: parts.join('\n\n').trim(),
    kept: keptBlocks.length,
    dropped: droppedBlocks.length,
    droppedTypes,
    truncated: true,
    omittedNote,
  };
}

// ============================================================
// 5. 统一解析入口（buffer 版本，供后端直接调用）
// ============================================================

export const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.js', '.mjs', '.cjs', '.ts', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.sh', '.sql',
]);

export const OFFICE_EXTS = new Set(['.docx', '.doc', '.xlsx', '.xls', '.pdf', '.pptx', '.ppt']);

/**
 * 解码纯文本（自动识别 UTF-8 / GBK）
 * @param {Buffer} buffer
 * @returns {string}
 */
export function decodeText(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // BOM 检测
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  const utf8 = buf.toString('utf8');
  // U+FFFD 过多说明不是合法 UTF-8，尝试 GBK
  const badCount = (utf8.match(/\uFFFD/g) || []).length;
  if (badCount > 0 && badCount / Math.max(1, utf8.length) > 0.005) {
    try {
      const iconv = require('iconv-lite');
      return iconv.decode(buf, 'gbk');
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/**
 * 解析文档 buffer 为 Markdown（表格保结构）
 *
 * @param {Object} input
 * @param {Buffer} input.buffer - 文件内容
 * @param {string} input.filename - 文件名（用于取扩展名）
 * @param {Function} [input.parseOffice] - 办公文档解析器（由 server.js 注入，避免循环依赖）
 * @returns {Promise<{markdown:string, format:string, warnings:string[]}>}
 */
export async function parseDocumentBuffer({ buffer, filename, parseOffice }) {
  const ext = '.' + String(filename || '').split('.').pop().toLowerCase();
  const warnings = [];

  if (TEXT_EXTS.has(ext)) {
    const text = decodeText(buffer);
    return { markdown: text, format: 'text', warnings };
  }

  if (ext === '.docx' || ext === '.doc') {
    const mammoth = require('mammoth');
    const { value: html, messages } = await mammoth.convertToHtml({ buffer });
    const markdown = htmlToMarkdown(html || '');
    if (!markdown.trim()) throw new Error('Word 文档解析结果为空');
    for (const m of messages || []) {
      if (m.type !== 'warning' && m.type !== 'error') continue;
      // "Unrecognised paragraph style" 只是样式名未识别，不影响文本与表格，跳过以免刷屏
      if (/Unrecognised paragraph style/i.test(m.message || '')) continue;
      warnings.push(`mammoth: ${m.message}`);
    }
    // 结构自检：原文有表格但解析后没有
    if (!/\|\s*---/.test(markdown) && /<table/i.test(html || '')) {
      warnings.push('表格结构可能丢失');
    }
    return { markdown, format: 'docx', warnings };
  }

  if (OFFICE_EXTS.has(ext)) {
    if (typeof parseOffice !== 'function') {
      throw new Error(`缺少办公文档解析器，无法解析 ${ext}`);
    }
    const text = await parseOffice(buffer, ext);
    if (!text || !text.trim()) throw new Error('文档解析结果为空');
    return { markdown: text, format: ext.replace('.', ''), warnings };
  }

  if (/^\.(png|jpe?g|gif|bmp|webp|svg)$/.test(ext)) {
    warnings.push('图片未做 OCR，仅保留文件名');
    return { markdown: `[图片附件，内容未解析]`, format: 'image', warnings };
  }

  // 未知类型按文本尝试
  const text = decodeText(buffer);
  warnings.push(`未知扩展名 ${ext}，按纯文本解析`);
  return { markdown: text, format: 'unknown', warnings };
}

export default {
  estimateTokens,
  htmlToMarkdown,
  splitStructuredBlocks,
  chunkByStructure,
  fitToBudget,
  parseDocumentBuffer,
  decodeText,
  TEXT_EXTS,
  OFFICE_EXTS,
};
