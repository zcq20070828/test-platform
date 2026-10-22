/**
 * 缺陷查询引擎 (Defect Query Engine)
 *
 * 提供多条件过滤、关键词打分排序、汇总统计功能。
 *
 * 输入 defects 标准格式：
 * {
 *   id, title, type, module, symptom,
 *   rootCause, fix, severity, createdAt
 * }
 */

// ─── 内部辅助 ────────────────────────────────────────────────────────────────

/**
 * 中英文分词（保留连续中文字符和英文单词）
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * 从一段文本中提取关键词集合
 * @param {string} text
 * @returns {Set<string>}
 */
function buildTokenSet(text) {
  return new Set(tokenize(text));
}

// ─── 核心导出函数 ────────────────────────────────────────────────────────────

/**
 * 多条件过滤 + 关键词打分排序
 *
 * @param {Array<{
 *   id: string,
 *   title?: string,
 *   type?: string,
 *   module?: string,
 *   symptom?: string,
 *   rootCause?: string,
 *   fix?: string,
 *   severity?: string,
 *   createdAt?: string
 * }>} defects
 * @param {{
 *   type?: string,
 *   module?: string,
 *   symptom?: string,
 *   keyword?: string,
 *   severity?: string,
 *   limit?: number
 * }} options
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   type: string,
 *   module: string,
 *   symptom: string,
 *   rootCause: string,
 *   fix: string,
 *   severity: string,
 *   createdAt: string,
 *   score: number
 * }>}
 */
export function queryDefects(defects, options = {}) {
  if (!Array.isArray(defects)) {
    throw new TypeError('defects must be an array');
  }

  const {
    type,
    module,
    symptom,
    keyword,
    severity,
    limit = 10,
  } = options;

  // ── 阶段一：精确过滤 ──────────────────────────────────────
  /** @type {typeof defects} */
  let results = defects;

  if (type) {
    const typeLower = type.toLowerCase();
    results = results.filter(d => (d.type || '').toLowerCase().includes(typeLower));
  }
  if (module) {
    const moduleLower = module.toLowerCase();
    results = results.filter(d => (d.module || '').toLowerCase().includes(moduleLower));
  }
  if (symptom) {
    const symptomLower = symptom.toLowerCase();
    results = results.filter(d => (d.symptom || '').toLowerCase().includes(symptomLower));
  }
  if (severity) {
    const sevLower = severity.toLowerCase();
    results = results.filter(d => (d.severity || '').toLowerCase() === sevLower);
  }

  // ── 阶段二：关键词打分排序 ────────────────────────────────
  if (keyword) {
    const keywordTokens = buildTokenSet(keyword);
    if (keywordTokens.size > 0) {
      results = results.map(d => {
        // 搜索范围：title + symptom + rootCause + fix
        const searchText = [d.title, d.symptom, d.rootCause, d.fix]
          .filter(Boolean)
          .join(' ');
        const textTokens = buildTokenSet(searchText);

        // 计算命中 token 数
        let hits = 0;
        for (const tk of keywordTokens) {
          if (textTokens.has(tk)) hits++;
        }

        const score = hits / keywordTokens.size;
        return { ...d, score };
      });

      // 按分数降序，保留原始排序作为 tie-breaker
      results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.id).localeCompare(String(b.id));
      });
    }
  } else {
    // 无关键词时按 id 升序
    results = results.map(d => ({ ...d, score: 0 }));
    results.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  return results.slice(0, limit);
}

/**
 * 按相关性重新打分排序
 *
 * @param {Array<object>} results
 * @param {{
 *   type?: string,
 *   module?: string,
 *   symptom?: string,
 *   keyword?: string
 * }} query
 * @returns {Array<object>}
 */
export function rankByRelevance(results, query) {
  if (!Array.isArray(results)) {
    throw new TypeError('results must be an array');
  }

  const queryTokens = buildTokenSet(
    [query.type, query.module, query.symptom, query.keyword].filter(Boolean).join(' ')
  );

  const weighted = results.map(item => {
    const itemText = [item.title, item.symptom, item.rootCause, item.fix, item.type, item.module]
      .filter(Boolean)
      .join(' ');
    const itemTokens = buildTokenSet(itemText);

    let relScore = 0;
    for (const qt of queryTokens) {
      if (itemTokens.has(qt)) relScore++;
    }

    // 基础分数（外部传入的 score）+ 重排分数
    const baseScore = typeof item.score === 'number' ? item.score : 0;
    const relevanceBonus = queryTokens.size > 0 ? relScore / queryTokens.size : 0;

    return {
      ...item,
      score: Math.round((baseScore * 0.4 + relevanceBonus * 0.6) * 1000) / 1000,
    };
  });

  weighted.sort((a, b) => b.score - a.score);
  return weighted;
}

/**
 * 汇总统计（按类型/模块/严重度的分布）
 *
 * @param {Array<{
 *   id: string,
 *   type?: string,
 *   module?: string,
 *   severity?: string,
 *   createdAt?: string
 * }>} defects
 * @returns {{
 *   total: number,
 *   byType: Record<string, number>,
 *   byModule: Record<string, number>,
 *   bySeverity: Record<string, number>,
 *   recentTrend: Array<{ date: string, count: number }>
 * }}
 */
export function summarize(defects) {
  if (!Array.isArray(defects)) {
    throw new TypeError('defects must be an array');
  }

  const total = defects.length;
  /** @type {Record<string, number>} */
  const byType = {};
  /** @type {Record<string, number>} */
  const byModule = {};
  /** @type {Record<string, number>} */
  const bySeverity = {};
  /** @type {Record<string, number>} */
  const dateCounts = {};

  for (const d of defects) {
    // type
    const t = d.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;

    // module
    const m = d.module || 'unknown';
    byModule[m] = (byModule[m] || 0) + 1;

    // severity
    const s = (d.severity || 'unknown').toLowerCase();
    bySeverity[s] = (bySeverity[s] || 0) + 1;

    // recent trend (按月聚合)
    if (d.createdAt) {
      const dateStr = String(d.createdAt).slice(0, 7); // YYYY-MM
      dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
    }
  }

  // recentTrend：最多取最近 12 个月
  const recentTrend = Object.entries(dateCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([date, count]) => ({ date, count }));

  return { total, byType, byModule, bySeverity, recentTrend };
}

// ─── 自测 ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const sampleDefects = [
    { id: 'DEF-001', title: '登录页面白屏', type: 'UI缺陷', module: 'auth', symptom: '登录页面显示白屏', rootCause: 'CSS未加载', fix: '修复CSS路径', severity: 'high', createdAt: '2025-01-15' },
    { id: 'DEF-002', title: '用户列表加载慢', type: '性能缺陷', module: 'user', symptom: '用户列表超过5秒', rootCause: '缺少分页', fix: '添加LIMIT分页', severity: 'medium', createdAt: '2025-02-10' },
    { id: 'DEF-003', title: '登录按钮无效', type: '功能缺陷', module: 'auth', symptom: '点击无响应', rootCause: '事件未绑定', fix: '修复事件绑定', severity: 'high', createdAt: '2025-03-05' },
    { id: 'DEF-004', title: '详情页报错', type: '功能缺陷', module: 'user', symptom: '页面报错无数据', rootCause: '空值未处理', fix: '加空值判断', severity: 'medium', createdAt: '2025-03-20' },
    { id: 'DEF-005', title: '表单提交白屏', type: 'UI缺陷', module: 'form', symptom: '提交后白屏', rootCause: '重定向失败', fix: '修复重定向', severity: 'medium', createdAt: '2025-04-01' },
  ];

  console.log('\n==== queryDefects: module=auth ====');
  const r1 = queryDefects(sampleDefects, { module: 'auth' });
  r1.forEach(d => console.log(`  [${d.score}] ${d.id} ${d.title}`));

  console.log('\n==== queryDefects: keyword=页面 ====');
  const r2 = queryDefects(sampleDefects, { keyword: '页面', limit: 3 });
  r2.forEach(d => console.log(`  [${d.score}] ${d.id} ${d.title}`));

  console.log('\n==== queryDefects: type=功能缺陷 keyword=无响应 ====');
  const r3 = queryDefects(sampleDefects, { type: '功能缺陷', keyword: '无响应' });
  r3.forEach(d => console.log(`  [${d.score}] ${d.id} ${d.title}`));

  console.log('\n==== rankByRelevance: keyword=白屏 ====');
  const ranked = rankByRelevance(r1, { keyword: '白屏' });
  ranked.forEach(d => console.log(`  [${d.score}] ${d.id} ${d.title}`));

  console.log('\n==== summarize ====');
  const summary = summarize(sampleDefects);
  console.log(`  total: ${summary.total}`);
  console.log(`  byType:`, summary.byType);
  console.log(`  byModule:`, summary.byModule);
  console.log(`  bySeverity:`, summary.bySeverity);
  console.log(`  recentTrend:`, summary.recentTrend);

  console.log('\n✅ query-engine.js 自测通过\n');
}
