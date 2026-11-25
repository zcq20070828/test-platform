/**
 * 变更计划显式化（2026-11-25 · 对话改造第一步）
 *
 * 要解决的问题：现在用户发一句「整体感觉不够严格」，意图分类只能归到
 * 「全局修订」，于是把 14 万字整个重写一遍——慢、贵、还可能改坏别处。
 * 用户看到的是「发指令 → 等几分钟 → 出一个新版本」，中间完全黑盒，
 * 无法干预，也无法预判影响范围。
 *
 * 改造后：模糊指令先让模型只输出一份**变更计划**
 * （"将修改 TC-007/012/031 的预期结果，新增 2 条边界用例"），
 * 前端渲染成可勾选清单，用户确认后再执行。
 *
 * 关键设计约束：
 *   1) 计划必须是结构化 JSON，能逐项勾选；不能是自然语言段落。
 *   2) 计划生成是**轻量调用**：只给模型看交付物的结构摘要（表头 + 编号 + 用例名），
 *      不给全文。否则光是生成计划就要几十秒、几万 token，比直接改还贵。
 *   3) 明确的指令（"改 TC-001"）不走计划，直接执行——不能让用户为了改一条用例
 *      还要点一次确认。
 *   4) 计划解析失败要能优雅降级：退回原来的直接执行，不能让对话卡住。
 */

/**
 * 判断这次对话是否需要「先给计划、再执行」
 *
 * 核心取舍：多一次确认就多一次等待，只有**模糊且影响面可能大**的指令才值得。
 *
 *   明确的定点指令  「把 TC-007 的预期结果改成 HTTP 400」→ 直接执行
 *                    （用户已经说清改哪里，再问一遍是浪费）
 *   纯提问          「为什么这条没覆盖异常」→ 不涉及修改，不走计划
 *   模糊的整体指令  「整体感觉不够严格」「帮我优化一下」→ **走计划**
 *                    （这类正是会把 14 万字重写一遍的元凶）
 *   明确的整体指令  「全部重新生成」→ 直接执行
 *                    （用户明确要求重来，给计划反而碍事）
 *
 * @param {Object} intent classifyChatIntent 的返回值
 * @param {Object} [opts]
 * @param {boolean} [opts.hasDeliverable=true]
 * @param {number} [opts.minDeliverableChars=2000] 交付物太短时没必要确认
 * @param {number} [opts.deliverableChars=0]
 * @returns {{needed:boolean, reason:string}}
 */
export function shouldPlanBeforeExecute(intent, opts = {}) {
  const hasDeliverable = opts.hasDeliverable !== false;
  const chars = Number(opts.deliverableChars) || 0;
  const minChars = Number(opts.minDeliverableChars ?? 2000);

  if (!hasDeliverable) {
    return { needed: false, reason: '没有可修改的交付物，无需规划' };
  }
  // 短交付物改起来代价小，确认反而拖慢
  if (chars > 0 && chars < minChars) {
    return { needed: false, reason: `交付物仅 ${chars} 字符，改动代价小，直接执行` };
  }
  if (!intent || !intent.mode) {
    return { needed: false, reason: '未识别出意图模式' };
  }
  // 提问不产出交付物，不需要计划
  if (intent.mode === 'question') {
    return { needed: false, reason: '纯提问，不改交付物' };
  }
  // 用户明确要求全量重来，不必再问
  if (intent.mode === 'regenerate') {
    return { needed: false, reason: '用户明确要求重新生成' };
  }
  // 明确点名了编号 → 用户已经说清改哪里
  if (intent.caseIds && intent.caseIds.length > 0) {
    return { needed: false, reason: `用户已点名 ${intent.caseIds.length} 条编号，直接执行` };
  }
  // 只有「refine（整份修订）」这种模糊的整体指令才走计划。
  //
  // 为什么 append 也不走：「再加 5 条边界用例」影响面明确、
  // 不涉及改动已有内容，加一次确认纯属打扰。
  if (intent.mode === 'refine') {
    return { needed: true, reason: '整体修订指令未指明具体条目，先给变更计划让用户确认' };
  }
  return { needed: false, reason: `模式 ${intent.mode} 影响面明确，直接执行` };
}

/** 计划项类型 */
export const PLAN_ITEM_TYPES = ['modify', 'add', 'remove', 'global'];

/** 影响范围（用于前端提示「这一步的代价」） */
export const PLAN_SCALES = ['small', 'medium', 'large'];

/**
 * 从交付物里抽出「结构摘要」喂给规划器
 *
 * 为什么不给全文：一份 14 万字的用例文档光是 token 就是几万，
 * 生成计划要几十秒。规划只需要知道「有哪些用例、哪些字段」，
 * 不需要看每条的完整内容。
 *
 * @param {string} deliverable
 * @param {Object} [opts]
 * @param {number} [opts.maxRows=120] 最多列出多少条用例
 * @param {number} [opts.nameWidth=40] 用例名截断宽度
 * @returns {{ headers:string[], rows:Array<{id:string,name:string}>, total:number, truncated:boolean, tableCount:number }}
 */
export function buildDeliverableSummary(deliverable, opts = {}) {
  const maxRows = Number(opts.maxRows ?? 120);
  const nameWidth = Number(opts.nameWidth ?? 40);
  const lines = String(deliverable || '').split(/\r?\n/);

  const headers = [];
  const rows = [];
  let tableCount = 0;
  let header = null;
  let idIdx = -1;
  let nameIdx = -1;

  const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const isSep = (cells) => cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c) || c === '');

  for (const line of lines) {
    if (!/^\s*\|.*\|\s*$/.test(line)) {
      header = null;
      idIdx = -1;
      nameIdx = -1;
      continue;
    }
    const cells = splitRow(line);
    if (isSep(cells)) continue;

    if (!header) {
      // 只认带「编号」列的表：那是可被点名的表格（用例表、需求表、缺陷表）
      const id = cells.findIndex((c) => /^(用例编号|需求编号|缺陷编号|编号|用例ID|ID)$/i.test(c.replace(/\s+/g, '')));
      if (id >= 0) {
        header = cells;
        idIdx = id;
        nameIdx = cells.findIndex((c) => /(名称|标题|用例名|title|name)/i.test(c));
        tableCount += 1;
        // 第一张带编号表当主表
        if (!headers.length) headers.push(...cells);
      }
      continue;
    }

    const id = String(cells[idIdx] || '').trim();
    if (!id) continue;
    const name = nameIdx >= 0 ? String(cells[nameIdx] || '').trim() : '';
    if (rows.length < maxRows) {
      rows.push({ id, name: name.slice(0, nameWidth) });
    }
  }

  return {
    headers,
    rows,
    total: rows.length,
    truncated: rows.length >= maxRows,
    tableCount,
  };
}

/**
 * 构造「生成变更计划」的提示词
 *
 * 要求模型**只输出 JSON**，因为前端要渲染成可勾选清单。
 * 特意在提示词里给出反例（"不要输出自然语言段落"），实测不加的话
 * 模型很喜欢写一段"好的，我打算……"再给 JSON。
 *
 * @param {Object} args
 * @param {string} args.message 用户本轮指令
 * @param {Object} args.summary buildDeliverableSummary 的返回值
 * @param {string} [args.intentMode] 已识别出的意图模式（正则给出的初判）
 * @returns {string}
 */
export function buildPlanPrompt({ message, summary, intentMode }) {
  const rowList = summary.rows.length
    ? summary.rows.map((r) => `${r.id}｜${r.name}`).join('\n')
    : '(交付物里没有可点名的编号表格)';

  return [
    '# 任务：生成变更计划',
    '',
    '用户在要求修改一份已生成的交付物。你的任务**不是**修改它，',
    '而是先说明「打算改哪些地方」，让用户确认后再动手。',
    '',
    '## 用户指令',
    String(message || '').trim(),
    '',
    '## 交付物结构',
    `表格数量：${summary.tableCount}，可点名的条目共 ${summary.total} 条${summary.truncated ? '（仅列出前 120 条）' : ''}`,
    `字段：${summary.headers.join(' / ') || '(未识别)'}`,
    '',
    '可点名的条目（编号｜名称）：',
    rowList,
    '',
    '## 输出要求（严格遵守）',
    '只输出一个 JSON 对象，不要输出任何解释文字、不要用 Markdown 代码块包裹。格式：',
    '{',
    '  "summary": "一句话说明这次打算做什么（20 字以内）",',
    '  "mode": "surgical | append | refine",',
    '  "scale": "small | medium | large",',
    '  "items": [',
    '    { "type": "modify", "caseIds": ["TC-007"], "reason": "预期结果不可判定，需改为具体断言" },',
    '    { "type": "add", "count": 2, "reason": "补充边界值用例" },',
    '    { "type": "remove", "caseIds": ["TC-030"], "reason": "与 TC-005 重复" },',
    '    { "type": "global", "reason": "统一全文术语" }',
    '  ]',
    '}',
    '',
    '## 字段含义',
    '- mode=surgical：只改点名的少数条目（items 里必须有 caseIds）',
    '- mode=append：只新增条目，不动已有内容',
    '- mode=refine：需要整体重写（改动会波及多数条目时才能选这个）',
    '- scale=small：改 1~5 条；medium：6~20 条；large：超过 20 条或整体重写',
    '',
    '## 判断原则',
    '1. **能定点就不要整体重写**。用户说「这几条太虚」，就只列那几条，',
    '   不要因为"顺手"把别的也改了——用户会因为文档被动过而不敢用。',
    '2. 用户没指名编号、但语义明显只涉及某几类问题时，由你判断具体是哪几条，',
    '   并**如实列出编号**，让用户能核对。',
    '3. 如果用户的意思是"通篇都要改"，才用 refine + large。',
    '4. items 至少 1 项。caseIds 必须是上面列表里真实存在的编号，不要编造。',
    intentMode ? `5. 系统初判为 ${intentMode}，如与你的判断不符以你的为准，但要在 summary 里说明。` : '',
  ].filter((l) => l !== '').join('\n');
}

/**
 * 解析模型返回的变更计划
 *
 * 模型经常会包 ```json 代码块、或在 JSON 前后加解释文字，所以要做容错。
 * 解析不出来时返回 ok:false，调用方退回直接执行（**不能因为解析失败卡住对话**）。
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {number} [opts.maxItems=8]
 * @returns {{ok:boolean, plan?:Object, error?:string}}
 */
export function parseChangePlan(text, opts = {}) {
  const maxItems = Number(opts.maxItems ?? 8);
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: '空响应' };

  let body = raw;
  // 1) 去掉 ```json ... ```
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();
  else {
    // 2) 花括号配平扫描（应对前后有解释文字的情况）
    const start = raw.indexOf('{');
    if (start >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < raw.length; i += 1) {
        const ch = raw[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) { body = raw.slice(start, i + 1); break; }
        }
      }
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
    return { ok: false, error: 'JSON 解析失败' };
  }

  if (!parsed || typeof parsed !== 'object') return { ok: false, error: '不是对象' };

  const items = [];
  for (const it of (Array.isArray(parsed.items) ? parsed.items : [])) {
    if (!it || typeof it !== 'object') continue;
    const type = PLAN_ITEM_TYPES.includes(it.type) ? it.type : null;
    if (!type) continue;
    const caseIds = (Array.isArray(it.caseIds) ? it.caseIds : [])
      .map((x) => String(x || '').trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 50);
    const count = Number(it.count) > 0 ? Math.min(Number(it.count), 50) : null;
    const reason = String(it.reason || '').slice(0, 160);
    // modify/remove 必须有编号，否则这条计划无法执行
    if ((type === 'modify' || type === 'remove') && !caseIds.length) continue;
    // add 必须有数量，否则不知道要加几条
    if (type === 'add' && !count) continue;
    items.push({ type, caseIds, count, reason });
    if (items.length >= maxItems) break;
  }

  if (!items.length) return { ok: false, error: '计划里没有可执行的项' };

  const mode = ['surgical', 'append', 'refine'].includes(parsed.mode)
    ? parsed.mode
    : (items.some((i) => i.type === 'global') ? 'refine' : (items.every((i) => i.type === 'add') ? 'append' : 'surgical'));
  const scale = PLAN_SCALES.includes(parsed.scale) ? parsed.scale : 'small';

  return {
    ok: true,
    plan: {
      summary: String(parsed.summary || '').slice(0, 80) || describeItems(items),
      mode,
      scale,
      items,
    },
  };
}

/** 计划摘要兜底：模型没给 summary 时用条目拼一句 */
function describeItems(items) {
  const mod = items.filter((i) => i.type === 'modify');
  const add = items.filter((i) => i.type === 'add');
  const del = items.filter((i) => i.type === 'remove');
  const glob = items.filter((i) => i.type === 'global');
  const parts = [];
  if (mod.length) parts.push(`修改 ${mod.reduce((a, i) => a + i.caseIds.length, 0)} 条`);
  if (add.length) parts.push(`新增 ${add.reduce((a, i) => a + (i.count || 0), 0)} 条`);
  if (del.length) parts.push(`删除 ${del.reduce((a, i) => a + i.caseIds.length, 0)} 条`);
  if (glob.length) parts.push('全文调整');
  return parts.join('，') || '调整交付物';
}

/**
 * 用户勾选后的计划 → 执行意图
 *
 * 用户可能取消勾选某些项，这时执行范围必须随之收窄，
 * 而不是照原计划全改。这是「可控」的实际含义。
 *
 * ★ 混合计划的处理（2026-11-25 实测修正）
 *
 *   实测模型给出的计划常常是「定点 + 全局」混合，例如：
 *     modify TC-001..TC-014（收紧预期结果）
 *     global（统一书写规范）
 *
 *   早期实现只要见到 global 就整体降级成 refine（全文重写），
 *   等于把「已经点名 14 条」的精确信息全丢了——用户确认了具体编号，
 *   结果执行的还是整份重写，改造就白做了。
 *
 *   现在按主次判断：**有明确 caseIds 就以 surgical 为主**，
 *   把 global 项作为附加要求写进 itemBrief（模型会按这些要求改那几条）。
 *   只有「纯 global、没有任何 caseIds」才是真正的全文重写。
 *
 * @param {Object} plan 已确认的计划（可能已按用户勾选裁剪）
 * @param {Object} fallbackIntent 正则给出的原始意图
 * @returns {{mode:string, caseIds:string[], count:number|null, reason:string, label:string, fromPlan:boolean, itemBrief?:string[]}}
 */
export function planToIntent(plan, fallbackIntent = {}) {
  if (!plan || !Array.isArray(plan.items) || !plan.items.length) {
    return { ...fallbackIntent, fromPlan: false };
  }

  const caseIds = [...new Set(
    plan.items
      .filter((i) => i.type === 'modify' || i.type === 'remove')
      .flatMap((i) => i.caseIds || []),
  )];
  const addCount = plan.items
    .filter((i) => i.type === 'add')
    .reduce((a, i) => a + (i.count || 0), 0);
  const globals = plan.items.filter((i) => i.type === 'global');

  let mode;
  if (caseIds.length > 0) {
    // 有明确编号 → 定点修改，global 项作为附加约束（不降级）
    mode = 'surgical';
  } else if (globals.length > 0) {
    // 纯全局，没有点名任何编号 → 才走整体重写
    mode = 'refine';
  } else if (addCount > 0) {
    mode = 'append';
  } else if (plan.mode === 'refine') {
    mode = 'refine';
  } else {
    mode = 'surgical';
  }

  let label = '按计划修订';
  if (mode === 'refine') label = '全量重写';
  else if (mode === 'append') label = '追加内容';
  else if (mode === 'surgical') label = '定点修改';

  return {
    mode,
    caseIds,
    count: addCount || null,
    reason: plan.summary ? `按已确认的变更计划：${plan.summary}` : '按已确认的变更计划',
    label,
    fromPlan: true,
    // 传给执行阶段的额外约束：让模型只按勾选项动手
    itemBrief: plan.items.map((i) => {
      if (i.type === 'add') return `新增 ${i.count} 条：${i.reason || ''}`;
      if (i.type === 'global') return `全文要求（适用于本次改动的条目）：${i.reason || ''}`;
      return `${i.type === 'remove' ? '删除' : '修改'} ${(i.caseIds || []).join('、')}：${i.reason || ''}`;
    }).filter(Boolean),
  };
}

/**
 * 校验用户回传的「已确认计划」是否可信
 *
 * 前端会把勾选结果回传，不能直接信：可能被篡改、可能是过期计划。
 * 只做结构性校验（类型合法、编号格式合法、数量合理），
 * 编号是否真实存在由执行阶段的门禁兜住（不可用的会被判孤儿）。
 *
 * @param {any} raw
 * @returns {{ok:boolean, plan?:Object, error?:string}}
 */
export function normalizeConfirmedPlan(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '计划为空' };
  const items = [];
  for (const it of (Array.isArray(raw.items) ? raw.items : [])) {
    if (!it || typeof it !== 'object') continue;
    const type = PLAN_ITEM_TYPES.includes(it.type) ? it.type : null;
    if (!type) continue;
    const caseIds = (Array.isArray(it.caseIds) ? it.caseIds : [])
      .map((x) => String(x || '').trim().toUpperCase())
      .filter((x) => /^[A-Z0-9][A-Z0-9_\-]{0,31}$/.test(x))
      .slice(0, 50);
    const count = Number(it.count) > 0 ? Math.min(Number(it.count), 50) : null;
    if ((type === 'modify' || type === 'remove') && !caseIds.length) continue;
    if (type === 'add' && !count) continue;
    items.push({ type, caseIds, count, reason: String(it.reason || '').slice(0, 160) });
    if (items.length >= 8) break;
  }
  if (!items.length) return { ok: false, error: '确认的计划里没有可执行项' };
  return {
    ok: true,
    plan: {
      summary: String(raw.summary || '').slice(0, 80),
      mode: ['surgical', 'append', 'refine'].includes(raw.mode) ? raw.mode : 'surgical',
      scale: PLAN_SCALES.includes(raw.scale) ? raw.scale : 'small',
      items,
    },
  };
}
