/**
 * 经验检索（BM25 + 中文分词）2026-11-20
 *
 * 为什么需要：经验库靠「按命中次数取前 8 条」注入是不可扩展的。
 * 攒到上百条后，长尾但真正相关的问题永远排不进前 8，模型看到的都是高频噪声。
 * 正确做法是按「当前这个任务」的内容召回相关经验。
 *
 * 为什么不用神经网络 embedding：
 *   1) 项目现有的 vector_service 也是 BM25 + TF-IDF（见 backend/vector/），
 *      没有引入 sentence-transformers 之类的模型依赖；
 *   2) 经验条目是**标准化缺陷描述**（「预期结果不可判定」「输入是占位值」），
 *      不是长自然语言，关键词匹配的精度已经足够，且零额外延迟；
 *   3) 不需要额外服务/模型下载，纯函数、可单测。
 *
 * 若将来经验量大到关键词不够用，替换本模块的 search() 即可，调用方不用改。
 */

/**
 * 中英文混合分词
 *
 * 中文按「单字 + 双字」切分（与项目 vector_service.py 一致）：
 *   「预期结果不可判定」→ 预/期/结/果/不/可/判/定 + 预期/期结/结果/果不/...
 * 单字保证召回，双字保证精度。英文/数字按 >=2 长度切词。
 */
export function tokenize(text) {
  const s = String(text || '').toLowerCase().trim();
  if (!s) return [];
  const tokens = [];
  tokens.push(...s.match(/[a-z][a-z0-9_]*/g) || []);
  tokens.push(...s.match(/\d+/g) || []);
  const cnSeqs = s.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seq of cnSeqs) {
    for (let i = 0; i < seq.length; i += 1) tokens.push(seq[i]);
    for (let i = 0; i < seq.length - 1; i += 1) tokens.push(seq.slice(i, i + 2));
  }
  return tokens;
}

/**
 * 构建 BM25 索引
 *
 * @param {Array<{id:string, text:string}>} docs
 * @returns {{docs:Array, df:Map, avgdl:number, N:number, tf:Array<Map>}}
 */
export function buildIndex(docs) {
  const list = Array.isArray(docs) ? docs : [];
  const df = new Map();          // token -> 出现在多少个文档里
  const tf = [];                 // 每篇文档的 token 频次
  let totalLen = 0;

  for (const d of list) {
    const toks = tokenize(d.text);
    const freq = new Map();
    for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
    tf.push(freq);
    totalLen += toks.length;
    for (const t of freq.keys()) df.set(t, (df.get(t) || 0) + 1);
  }

  return {
    docs: list,
    df,
    tf,
    N: list.length,
    avgdl: list.length ? totalLen / list.length : 0,
  };
}

const K1 = 1.5;
const B = 0.75;

/**
 * BM25 打分
 *
 * @param {Object} index buildIndex 的结果
 * @param {string} query 查询文本（当前任务的需求/场景）
 * @param {Object} [opts]
 * @param {number} [opts.limit=8]
 * @param {number} [opts.minScore=0.5] 低于此分视为不相关，不返回
 * @param {(doc:any)=>number} [opts.prior] 先验加权（如命中次数），加在 BM25 分之上
 * @returns {Array<{doc:any, score:number, matched:string[]}>}
 */
export function search(index, query, opts = {}) {
  if (!index || !index.N) return [];
  const limit = Math.max(1, Number(opts.limit) || 8);
  const minScore = opts.minScore != null ? Number(opts.minScore) : 0.5;
  // 相对阈值：只保留「最高分 × ratio」以上的结果。
  //
  // 为什么需要：中文单字分词会让无关文档也有微弱重叠（「不」「的」「是」这些字到处都有），
  // 绝对阈值挡不住——实测「今天天气不错，帮我写首诗」也召回了 2 条经验。
  // 相对阈值把「沾一点边」和「真相关」分开。
  const relRatio = opts.relRatio != null ? Number(opts.relRatio) : 0.25;
  // 覆盖率门槛：查询里至少要有这么多个**有判别力**的词命中，才认为相关。
  //
  // 只数长度 >= 2 的命中（双字词、英文词、数字）。
  // 为什么：中文单字（不/写/是/的）几乎在任何文本里都能命中，
  // 实测「今天天气不错，帮我写首诗」靠「不」「写」两个单字就召回了不相干的经验。
  // 双字词的判别力高得多（「预期」「覆盖」「占位」），用它当门槛才挡得住噪声。
  const minMatched = opts.minMatched != null ? Number(opts.minMatched) : 2;
  const prior = typeof opts.prior === 'function' ? opts.prior : null;

  const qToks = [...new Set(tokenize(query))];
  if (!qToks.length) return [];

  const results = [];
  for (let i = 0; i < index.N; i += 1) {
    const freq = index.tf[i];
    const dl = [...freq.values()].reduce((s, v) => s + v, 0) || 1;
    let score = 0;
    const matched = [];
    for (const t of qToks) {
      const f = freq.get(t) || 0;
      if (!f) continue;
      const n = index.df.get(t) || 0;
      // IDF：出现越少的词越有区分度；+1 避免除零
      const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      const denom = f + K1 * (1 - B + B * (dl / (index.avgdl || 1)));
      score += idf * ((f * (K1 + 1)) / denom);
      matched.push(t);
    }
    if (score <= 0) continue;
    // 只看有判别力的命中（长度 >= 2）
    const strong = matched.filter((t) => t.length >= 2);
    if (strong.length < minMatched) continue;
    const boosted = prior ? score * prior(index.docs[i]) : score;
    if (boosted < minScore) continue;
    results.push({
      doc: index.docs[i],
      score: Number(boosted.toFixed(4)),
      bm25: Number(score.toFixed(4)),
      matched,
      strongMatched: strong,
    });
  }

  results.sort((a, b) => b.score - a.score);
  if (!results.length) return [];

  // 相对阈值过滤
  const top = results[0].score;
  const rel = top * relRatio;
  return results.filter((r) => r.score >= rel).slice(0, limit);
}

/**
 * 从「任务输入」里抽出用于检索的查询文本
 *
 * 不能直接把整份需求扔进去：需求文档动辄上万字，BM25 会被大量无关词稀释，
 * 而且分词开销大。这里取「最能代表任务类型」的片段：
 *   - 任务开头的场景描述（前 N 字）
 *   - 输入里显式提到的字段名 / 方法名 / 维度名
 *
 * @param {string} taskInput
 * @param {Object} [ctx] 额外上下文（agentId 等）
 * @returns {string}
 */
export function buildQuery(taskInput, ctx = {}) {
  const raw = String(taskInput || '');
  const parts = [];

  // agentId 本身是强信号（不同智能体的问题类型差别很大）
  if (ctx.agentId) parts.push(String(ctx.agentId).replace(/[-_]/g, ' '));

  // 开头 800 字：通常是需求/场景主体
  parts.push(raw.slice(0, 800));

  // 显式出现的结构化线索（这些词对判断「会犯什么错」很有用）
  const hints = [
    /FR-\d{1,4}/gi, /NFR-\d{1,4}/gi, /API-\d{1,4}/gi,
    /[A-Za-z_][A-Za-z0-9_]{2,}/g,          // 字段名/接口名
    /[①②③④⑤⑥⑦⑧⑨]/g,                      // 维度标记
    /等价类|边界值|因果图|判定表|正交|错误推测|场景法|状态迁移|功能图/g, // 设计方法
  ];
  for (const re of hints) {
    const found = raw.match(re);
    if (found) parts.push(found.slice(0, 40).join(' '));
  }

  return parts.join(' ');
}
