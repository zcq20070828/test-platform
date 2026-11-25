/**
 * 「继续对话」意图识别与执行模式（2026-11-20）
 *
 * 问题：原实现里 `buildChatContinuationInput` 写死了一句
 *   「请基于全部上下文直接输出更新后的**完整**交付件」
 * 于是无论用户说什么，都走全量重写。
 *
 * 实测三个真实对话轮次，全部被无视指令类型：
 *   任务 3164b853  用户「既然定向修复了，怎么没输出交付物」  → 重生成了 143K 字符完整交付物
 *   任务 b772a7f3  用户「重新生成」                          → 61K 字符（这个是对的）
 *   任务 054eb009  用户「把质量最差的 3 条用例的预期结果改得更具体」 → 重生成 63K 字符（只需改 3 行）
 *
 * 全量重写的代价不只是慢和贵：
 *   - 用户想改 3 条，结果整份文档被重写，原本满意的部分可能被改坏；
 *   - 用户只是提问（「怎么没输出交付物」），却被当成修改指令，白白产出新版本；
 *   - 每轮都产生一个新版本，用户分不清哪一版是自己想要的。
 *
 * 这里做的是**在执行前判断该怎么执行**，分成五种模式：
 *   question   问答      —— 只回答问题，不产出新交付物
 *   regenerate 全量重写  —— 用户明确要求重来
 *   append     追加      —— 只新增行，不动已有内容
 *   surgical   定点修改  —— 只改指定行，其余行原样保留
 *   refine     全局修订  —— 默认模式，整份修订但保留结构
 *
 * 分类用确定性规则（不调 LLM）：可复现、零成本、可审计。
 * 规则判不准时落到 refine —— 保持与旧行为一致，不会比现在更差。
 */

/**
 * 用户明确要求全量重来
 *
 * 必须最先判定：「为什么没生成交付物，重新生成一遍」同时含问句与重来，
 * 用户真实意图是重来。
 */
const REGENERATE_PATTERNS = [
  /重新生成|重新做|重做|再生成一?遍|再生成一?次|全部重写|全量重写|整份重写|从头生成|重新来过|重新出一?份|再出一?份|重出一?份/,
];

/** 纯提问（不含修改动作） */
const QUESTION_PATTERNS = [
  /[?？]\s*$/,
  /为什么|为啥|怎么没|怎么不|怎么回事|什么原因|哪里出|哪儿出|是不是|是否|有没有|能否解释|解释一下|如何理解|怎么理解/,
  // 语气词结尾的短问句（2026-11-25 补）
  //
  // 实测漏判：「卡住了吗」被判成 refine，进而触发一次「变更计划」生成，
  // 用户只是在问系统状态，却收到一张「打算改这些」的卡片。
  // 这类短问句没有「为什么/是不是」等关键词，只能靠语气词识别。
  /(?:吗|吧|呢)[\s。.!！~～]*$/,
  // 「还在跑吗」「能继续吗」这类状态询问
  /还在|在跑|跑完|完成了吗|结束了吗|进度/,
];

/** 明确的修改动作动词 */
const ACTION_VERB_RE = /改成|改为|改得|改一下|改下|整改|改|修改|生成|补充|增加|追加|删除|删掉|去掉|重写|替换|加上|加入|调整|优化|细化|具体化|完善|补齐|修缮|润色/;

/** 追加新内容（不要求改已有的） */
const APPEND_PATTERNS = [
  /再补充|补充几?条|追加|增加几?条|再加几?条|加上几?条|多出几?条|补几?条|再增加|再加/,
];

/** 指到了具体的行/编号 */
const SURGICAL_PATTERNS = [
  /\b(?:TC|AI|DC|NW|BE|PE|UC|CASE|AC|ST)[-_]?\d{1,4}\b/i,
  /第\s*\d{1,3}\s*条/,
  /这\s*\d{1,3}\s*条|那\s*\d{1,3}\s*条|其中\s*\d{1,3}\s*条/,
  /最差的?\s*\d{1,3}\s*条|质量最差/,
  /\d{1,3}\s*条(?:用例|测试用例)/,
  /把.{0,40}(?:改成|改为|修改为|调整成)/,
  /(?:下面|以下|上述)的?\s*\d{1,3}\s*条/,
];

/** 提取用户点名的用例编号（后端用它做二次定位） */
const CASE_ID_RE = /\b((?:TC|AI|DC|NW|BE|PE|UC|CASE|AC|ST)[-_]?\d{1,4})\b/gi;

/** 提取「N 条」里的数量 */
const COUNT_RE = /(\d{1,3})\s*条/;

/**
 * 编号区间展开（2026-11-25 · 对话改造第二步）
 *
 * 真实缺陷：用户说「把 TC-001 到 TC-014 的预期结果改得更具体」，
 * 正则只抓到首尾两个编号 → surgical 只改 2 条，中间 12 条被静默丢弃。
 * 用户明确说了改 14 条却只改 2 条，界面还不报错——这是最坏的一类静默失败。
 *
 * 支持写法：TC-001 到 TC-014 / TC-001~TC-014 / TC-001至TC-014
 *
 * 区间设上限（默认 60 条）：用户说「TC-001 到 TC-999」多半是口误，
 * 直接展开成 999 条会把执行拖死。超限时不展开，交给变更计划确认环节暴露。
 */
const RANGE_RE = /\b((?:TC|AI|DC|NW|BE|PE|UC|CASE|AC|ST))[-_]?(\d{1,4})\s*(?:到|至|~|～|－|—)\s*(?:[A-Za-z]{1,6}[-_]?)?(\d{1,4})\b/gi;

const MAX_RANGE_EXPAND = 60;

/**
 * 把「TC-001 到 TC-014」这类区间展开成完整编号列表
 *
 * @param {string} text
 * @param {number} [maxExpand=60]
 * @returns {string[]} 展开后的编号（未命中区间时返回空数组）
 */
export function expandIdRange(text, maxExpand = MAX_RANGE_EXPAND) {
  const out = [];
  const src = String(text || '');
  // 保持原编号的补零宽度：TC-001 → 三位，TC-01 → 两位
  const widthOf = (prefix) => {
    const m = src.match(new RegExp(`\\b${prefix}[-_]?(\\d{1,4})\\b`, 'i'));
    return m ? m[1].length : 3;
  };
  for (const m of src.matchAll(RANGE_RE)) {
    const prefix = m[1].toUpperCase();
    const a = Number(m[2]);
    const b = Number(m[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a <= 0 || b <= 0) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const size = hi - lo + 1;
    if (size < 2) continue;
    if (size > maxExpand) continue;
    const width = widthOf(prefix);
    for (let i = lo; i <= hi; i += 1) {
      out.push(`${prefix}-${String(i).padStart(width, '0')}`);
    }
  }
  return out;
}

/**
 * 识别对话指令的执行模式
 *
 * @param {string} message 用户本轮指令
 * @param {object} [ctx]
 * @param {boolean} [ctx.hasDeliverable=true] 是否已存在可修改的交付物
 * @returns {{mode:'question'|'regenerate'|'append'|'surgical'|'refine', reason:string, caseIds:string[], count:number|null, label:string}}
 */
export function classifyChatIntent(message, ctx = {}) {
  const text = String(message || '').trim();
  const hasDeliverable = ctx.hasDeliverable !== false;

  const base = { caseIds: [], count: null };

  if (!text) {
    return { ...base, mode: 'refine', reason: '无指令文本（仅上传材料）', label: '全局修订' };
  }

  // 编号提取 + 区间展开（2026-11-25 · 对话改造第二步）
  //
  // 「TC-001 到 TC-014」原来只抓到首尾两个编号，中间 12 条被静默丢弃——
  // 用户说改 14 条实际只改 2 条，还不报错。这里把区间补全。
  const explicitIds = (text.match(CASE_ID_RE) || []).map((x) => x.toUpperCase());
  const expandedIds = expandIdRange(text);
  const caseIds = [...new Set([...explicitIds, ...expandedIds])];
  if (expandedIds.length > explicitIds.length) {
    console.log(`[ChatIntent] 编号区间展开：${explicitIds.join(',')} → ${caseIds.length} 条`);
  }
  const countMatch = text.match(COUNT_RE);
  const count = countMatch ? Number(countMatch[1]) : null;

  // 1) 明确要求全量重来（优先级最高：可能同时带问句）
  if (REGENERATE_PATTERNS.some((re) => re.test(text))) {
    return { ...base, caseIds, count, mode: 'regenerate', reason: '用户明确要求重新生成', label: '全量重写' };
  }

  // 2) 纯提问：有疑问句式，且没有任何修改动作
  //
  // ★ 语气词要分级判断（2026-11-25 修正）
  //
  //   短问句「卡住了吗」需要靠语气词识别成提问（否则会误生成变更计划）；
  //   但「把 TC-001 的预期改一下吗」「能不能改得更具体吗」同样以语气词结尾，
  //   却带着明确的修改动作或编号——这类必须按修改指令执行。
  //
  //   所以：**有修改动作或有编号时，语气词不算疑问**。
  //   单纯把语气词塞进 QUESTION_PATTERNS 会误伤一批真实改稿指令。
  const isQuestion = QUESTION_PATTERNS.some((re) => re.test(text));
  const hasAction = ACTION_VERB_RE.test(text);
  const hasParticle = /(?:吗|吧|呢)[\s。.!！~～]*$/.test(text);
  // 语气词只有在「既没动作也没编号」时才算疑问信号
  const particleIsQuestion = hasParticle && !hasAction && caseIds.length === 0;
  if (!hasAction && (isQuestion || particleIsQuestion)) {
    return { ...base, caseIds, count, mode: 'question', reason: '是提问，不含修改动作', label: '问答（不改交付物）' };
  }

  // 3) 没有可改的交付物 → 只能重新生成
  if (!hasDeliverable) {
    return { ...base, caseIds, count, mode: 'regenerate', reason: '当前没有可修改的交付物', label: '全量重写' };
  }

  // 4) 追加
  if (APPEND_PATTERNS.some((re) => re.test(text))) {
    return { ...base, caseIds, count, mode: 'append', reason: '要求追加内容', label: '追加内容' };
  }

  // 5) 定点修改：指到了编号或具体条数
  if (caseIds.length || SURGICAL_PATTERNS.some((re) => re.test(text))) {
    const scope = caseIds.length ? `指定 ${caseIds.length} 条编号` : (count ? `${count} 条` : '指定条目');
    return { ...base, caseIds, count, mode: 'surgical', reason: `指名修改（${scope}）`, label: '定点修改' };
  }

  // 6) 默认：整份修订（与旧行为一致）
  return { ...base, caseIds, count, mode: 'refine', reason: '未指名具体条目，按整份修订处理', label: '全局修订' };
}

// ============================================================
// 交付物行级补丁
// ============================================================

/** 表头别名（与 case-quality-gate 的解析保持兼容，但这里要覆盖全列） */
function normalizeHeader(h) {
  return String(h || '').replace(/\s+/g, '').toLowerCase();
}

/** 是否为 Markdown 表格行 */
function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

/** 是否为分隔行 |---|---| */
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()) || c.trim() === '');
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/**
 * 从 Markdown 里解析出「编号 → 整行单元格」的表
 *
 * @param {string} markdown
 * @returns {{headers:string[], rows:Map<string,{cells:string[], line:string}>, order:string[]}}
 */
export function parseDeliverableRows(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const result = { headers: [], rows: new Map(), order: [] };
  let headers = null;
  let idIdx = -1;

  for (const line of lines) {
    if (!isTableRow(line)) { headers = null; idIdx = -1; continue; }
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;

    if (!headers) {
      // 找编号列
      const idx = cells.findIndex((c) => /^(用例编号|编号|用例ID|caseid|id)$/i.test(c.replace(/\s+/g, '')));
      if (idx >= 0) {
        headers = cells;
        idIdx = idx;
        if (!result.headers.length) result.headers = cells;
      }
      continue;
    }

    const id = String(cells[idIdx] || '').trim();
    if (!id) continue;
    if (!result.rows.has(id)) result.order.push(id);
    result.rows.set(id, { cells, line });
  }
  return result;
}

/**
 * 用模型返回的修订版表格，替换原交付物里对应的**整行**
 *
 * 为什么替换整行而不是逐列覆盖：
 *   用户可能要求改任意列（名称/输入/优先级），逐列白名单永远不全。
 *   整行替换只要编号对得上就成立，且不会碰其它行。
 *
 * 列对齐规则：按**原表头**取新行的同名列；新行缺这一列就保留原值。
 * 这样即使模型调整了列顺序也不会写错位置。
 *
 * @param {string} originalText 原交付物
 * @param {string} revisedMarkdown 模型返回的修订表格（只含待改的行）
 * @returns {{text:string, replaced:number, replacedIds:string[], missed:string[]}}
 */
export function applyRowPatch(originalText, revisedMarkdown) {
  const original = String(originalText || '');
  const patchTable = parseDeliverableRows(revisedMarkdown);
  if (!patchTable.rows.size) {
    return { text: original, replaced: 0, replacedIds: [], missed: [] };
  }

  const lines = original.split('\n');
  let headers = null;
  let idIdx = -1;
  let replaced = 0;
  const replacedIds = [];
  const hit = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isTableRow(line)) { headers = null; idIdx = -1; continue; }
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;

    if (!headers) {
      const idx = cells.findIndex((c) => /^(用例编号|编号|用例ID|caseid|id)$/i.test(c.replace(/\s+/g, '')));
      if (idx >= 0) { headers = cells; idIdx = idx; }
      continue;
    }

    const id = String(cells[idIdx] || '').trim();
    const fix = patchTable.rows.get(id);
    if (!fix) continue;

    // 按原表头逐列取值：新行里找同名列
    const newCells = headers.map((h, ci) => {
      const key = normalizeHeader(h);
      const pj = patchTable.headers.findIndex((ph) => normalizeHeader(ph) === key);
      if (pj >= 0 && fix.cells[pj] !== undefined) return fix.cells[pj];
      return cells[ci];
    });
    // 列数要与原表一致，否则会破坏表格结构
    if (newCells.length !== cells.length) continue;
    lines[i] = `| ${newCells.join(' | ')} |`;
    replaced += 1;
    replacedIds.push(id);
    hit.add(id);
  }

  const missed = [...patchTable.rows.keys()].filter((id) => !hit.has(id));
  return { text: lines.join('\n'), replaced, replacedIds, missed };
}

/**
 * 把模型返回的新行追加到原交付物的用例表末尾
 *
 * 只往「编号列已存在」的表格里插，避免把内容插到统计表/矩阵表里。
 *
 * @param {string} originalText
 * @param {string} addedMarkdown
 * @returns {{text:string, added:number, addedIds:string[]}}
 */
export function appendRows(originalText, addedMarkdown) {
  const original = String(originalText || '');
  const addTable = parseDeliverableRows(addedMarkdown);
  if (!addTable.rows.size) return { text: original, added: 0, addedIds: [] };

  const existing = parseDeliverableRows(original);
  // 已存在的编号跳过（模型可能把原有行也吐出来）
  const newIds = addTable.order.filter((id) => !existing.rows.has(id));
  if (!newIds.length) return { text: original, added: 0, addedIds: [] };

  const lines = original.split('\n');
  let headers = null;
  let idIdx = -1;
  let lastDataRow = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isTableRow(line)) {
      // 表格结束：如果这一张是用例表且有数据行，就在这里插入
      if (headers && lastDataRow >= 0) break;
      headers = null; idIdx = -1; lastDataRow = -1;
      continue;
    }
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    if (!headers) {
      const idx = cells.findIndex((c) => /^(用例编号|编号|用例ID|caseid|id)$/i.test(c.replace(/\s+/g, '')));
      if (idx >= 0) { headers = cells; idIdx = idx; }
      continue;
    }
    if (String(cells[idIdx] || '').trim()) lastDataRow = i;
  }

  if (lastDataRow < 0) return { text: original, added: 0, addedIds: [] };

  // 按原表头重建新行（列数必须与原表一致）
  const rows = newIds.map((id) => {
    const fix = addTable.rows.get(id);
    const cells = headers.map((h, ci) => {
      const key = normalizeHeader(h);
      const pj = addTable.headers.findIndex((ph) => normalizeHeader(ph) === key);
      return pj >= 0 && fix.cells[pj] !== undefined ? fix.cells[pj] : '';
    });
    return `| ${cells.join(' | ')} |`;
  });

  lines.splice(lastDataRow + 1, 0, ...rows);
  return { text: lines.join('\n'), added: rows.length, addedIds: newIds };
}

/** 交付物结构摘要（问答模式用，避免把整份 14 万字塞进上下文） */
export function summarizeDeliverableForQuestion(text, maxChars = 20000) {
  const full = String(text || '');
  if (!full) return { text: '', truncated: false, totalChars: 0 };
  if (full.length <= maxChars) return { text: full, truncated: false, totalChars: full.length };

  // 优先保留标题结构 + 前段正文：模型据标题就能定位用户在问什么
  const lines = full.split('\n');
  const heads = lines.filter((l) => /^#{1,6}\s/.test(l.trim())).slice(0, 60);
  const headBlock = heads.join('\n');
  const remain = Math.max(1000, maxChars - headBlock.length - 200);
  const body = full.slice(0, remain);
  return {
    text: `${headBlock}\n\n[以下为正文前 ${remain} 字符，原文共 ${full.length} 字符]\n\n${body}`,
    truncated: true,
    totalChars: full.length,
  };
}

export default {
  classifyChatIntent,
  parseDeliverableRows,
  applyRowPatch,
  appendRows,
  summarizeDeliverableForQuestion,
};
