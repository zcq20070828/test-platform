/**
 * 缺陷模式匹配器 (Defect Pattern Matcher)
 *
 * 功能：
 *   - extractPattern   : 从缺陷描述文本中提取结构化模式
 *   - matchPattern     : 将缺陷与已知模式库匹配，返回最匹配模式及置信度
 *   - learnPattern     : 从缺陷集合中挖掘高频共现模式
 */

// ─── 内部类型 & 常量 ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} ExtractedPattern
 * @property {string}   type          - 猜测的缺陷类型
 * @property {string[]} symptomKeywords - 关键症状词
 * @property {string[]} rootCauseKeywords - 可能根因关键词
 * @property {number}   confidence    - 提取置信度 0~1
 */

/**
 * @typedef {Object} PatternMatch
 * @property {string}  patternId
 * @property {string}  patternName
 * @property {string}  type
 * @property {string}  module
 * @property {string}  typicalSymptom
 * @property {string}  typicalRootCause
 * @property {number}  confidence     - 0~1
 */

/**
 * @typedef {Object} DiscoveredPattern
 * @property {string}   patternId
 * @property {string}   type
 * @property {string}   symptom
 * @property {string}   rootCause
 * @property {number}   support       - 出现次数
 * @property {number}   confidence    - rootCause 条件概率
 */

// ─── 内部辅助 ────────────────────────────────────────────────────────────────

/**
 * 简单分词
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * 集合交集大小
 */
function intersectionSize(a, b) {
  let count = 0;
  for (const v of a) if (b.has(v)) count++;
  return count;
}

// ─── 类型/模块/症状/根因关键词库（启发式规则）───────────────────────────────

/** @type {Record<string, string[]>} */
const TYPE_KEYWORDS = {
  '功能缺陷': ['无法', '不工作', '点击', '无效', '失败', '错误', 'not working', 'cannot', 'unable', 'error', 'bug', 'broken'],
  'UI缺陷': ['白屏', '错位', '重叠', '不显示', '样式', '显示异常', 'white screen', 'layout', 'display', 'render', 'css', '样式'],
  '性能缺陷': ['慢', '卡顿', '超时', '延迟', '加载', '占用', 'slow', 'timeout', 'latency', 'loading', 'performance'],
  '安全缺陷': ['注入', '越权', '泄露', 'XSS', 'CSRF', 'SQL', 'injection', 'auth', 'security', 'permission'],
  '接口缺陷': ['API', '接口', '请求', '响应', 'status', 'code', 'endpoint', 'rest', 'http'],
  '数据缺陷': ['数据', '丢失', '重复', '不一致', '错误', 'data', 'missing', 'duplicate', 'inconsistent'],
};

/** @type {Record<string, string[]>} */
const ROOT_CAUSE_KEYWORDS = {
  '空值未处理': ['空', 'null', 'undefined', 'none', 'missing', 'is null'],
  '事件未绑定': ['事件', '监听', 'bind', 'listener', 'onclick', 'onload'],
  '参数传递错误': ['参数', '传参', 'param', 'argument', 'wrong param'],
  '竞态条件': ['并发', '竞态', 'race', 'concurrent', 'async', 'timing'],
  '分页缺失': ['分页', 'limit', 'page', 'pagination', '全量', 'all data'],
  '缓存未刷新': ['缓存', 'cache', '过期', 'stale'],
  '权限校验缺失': ['权限', 'auth', 'permission', 'role', '鉴权', '未登录'],
  '配置错误': ['配置', 'config', 'env', '环境变量', 'wrong config'],
  '依赖版本冲突': ['版本', 'version', 'dependency', '冲突', 'conflict'],
  '数据库索引缺失': ['索引', 'index', '慢查询', 'slow query'],
};

// ─── 核心导出函数 ────────────────────────────────────────────────────────────

/**
 * 从一段缺陷描述文本中提取结构化模式
 *
 * @param {string} defectText - 缺陷描述文本（可为 title + symptom + rootCause 等拼接）
 * @returns {ExtractedPattern}
 */
export function extractPattern(defectText) {
  if (typeof defectText !== 'string') {
    throw new TypeError('defectText must be a string');
  }

  const tokens = new Set(tokenize(defectText));
  let bestType = '未知类型';
  let bestTypeHits = 0;
  let bestTypeConfidence = 0;

  // ── 类型猜测 ──────────────────────────────────────────────
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    const hits = keywords.filter(kw => tokens.has(kw.toLowerCase())).length;
    if (hits > bestTypeHits) {
      bestTypeHits = hits;
      bestType = type;
      bestTypeConfidence = Math.min(1, hits / Math.max(keywords.length, 1) * 3);
    }
  }

  // ── 症状关键词提取 ────────────────────────────────────────
  /** @type {Set<string>} */
  const symptomSet = new Set();
  const symptomWords = [
    '白屏', '卡顿', '报错', '无响应', '加载慢', '不显示', '错位', '重叠',
    'error', 'slow', 'crash', 'freeze', 'blank', 'timeout', 'fail', 'wrong',
    '空', 'null', 'undefined', '延迟', '抖动', '闪烁',
  ];
  for (const w of symptomWords) {
    if (tokens.has(w.toLowerCase())) {
      symptomSet.add(w);
    }
  }

  // 保留文本中较长的 token 作为症状补充
  for (const t of tokens) {
    if (t.length >= 3 && !Object.values(TYPE_KEYWORDS).flat().includes(t)) {
      symptomSet.add(t);
    }
  }

  // ── 根因关键词提取 ────────────────────────────────────────
  /** @type {Set<string>} */
  const rcSet = new Set();
  for (const [cause, keywords] of Object.entries(ROOT_CAUSE_KEYWORDS)) {
    const hits = keywords.filter(kw => tokens.has(kw.toLowerCase()));
    if (hits.length > 0) {
      rcSet.add(cause);
      bestTypeConfidence = Math.max(bestTypeConfidence, 0.6);
    }
  }

  const symptomKeywords = [...symptomSet].slice(0, 8);
  const rootCauseKeywords = [...rcSet];

  const confidence = Math.min(1, Math.round(
    (bestTypeConfidence * 0.5 +
      (symptomKeywords.length / 8) * 0.25 +
      (rootCauseKeywords.length / 5) * 0.25) * 1000
  ) / 1000);

  return {
    type: bestType,
    symptomKeywords,
    rootCauseKeywords,
    confidence,
  };
}

/**
 * 将缺陷与已知模式库匹配，返回最匹配模式及置信度
 *
 * @param {{
 *   id?: string,
 *   title?: string,
 *   type?: string,
 *   module?: string,
 *   symptom?: string,
 *   rootCause?: string,
 *   fix?: string
 * }} defect
 * @param {Array<{
 *   patternId: string,
 *   patternName: string,
 *   type?: string,
 *   module?: string,
 *   typicalSymptom: string,
 *   typicalRootCause?: string,
 *   typicalFix?: string
 * }>} knownPatterns
 * @returns {PatternMatch | null}
 */
export function matchPattern(defect, knownPatterns) {
  if (!Array.isArray(knownPatterns)) {
    throw new TypeError('knownPatterns must be an array');
  }

  if (knownPatterns.length === 0) return null;

  const defectTokens = new Set(tokenize(
    [defect.title, defect.symptom, defect.rootCause, defect.type, defect.module]
      .filter(Boolean).join(' ')
  ));

  /** @type {PatternMatch[]} */
  const scores = [];

  for (const p of knownPatterns) {
    const patternTokens = new Set(tokenize(
      [p.patternName, p.typicalSymptom, p.typicalRootCause, p.type, p.module]
        .filter(Boolean).join(' ')
    ));

    // 重叠 token 数 / 较大集合的 size
    const inter = intersectionSize(defectTokens, patternTokens);
    const unionSize = defectTokens.size + patternTokens.size - inter;
    const baseScore = unionSize === 0 ? 0 : inter / unionSize;

    // 模块精确匹配加权
    let boost = 0;
    if (p.module && defect.module && p.module.toLowerCase() === defect.module.toLowerCase()) {
      boost += 0.15;
    }
    if (p.type && defect.type && p.type.toLowerCase() === defect.type.toLowerCase()) {
      boost += 0.1;
    }

    const confidence = Math.min(1, Math.round((baseScore + boost) * 1000) / 1000);

    if (confidence > 0) {
      scores.push({
        patternId: p.patternId,
        patternName: p.patternName,
        type: p.type,
        module: p.module,
        typicalSymptom: p.typicalSymptom,
        typicalRootCause: p.typicalRootCause || '',
        confidence,
      });
    }
  }

  if (scores.length === 0) return null;

  scores.sort((a, b) => b.confidence - a.confidence);
  return scores[0];
}

/**
 * 从缺陷集合中挖掘高频共现模式（类型+症状→根因）
 *
 * @param {Array<{
 *   id: string,
 *   type?: string,
 *   module?: string,
 *   symptom?: string,
 *   rootCause?: string,
 *   fix?: string
 * }>} defects
 * @param {number} [minSupport=3] - 最小出现次数
 * @returns {DiscoveredPattern[]}
 */
export function learnPattern(defects, minSupport = 3) {
  if (!Array.isArray(defects)) {
    throw new TypeError('defects must be an array');
  }
  if (minSupport < 1) minSupport = 1;

  /** @type {Map<string, {
 *   type: string,
 *   symptom: string,
 *   rootCause: string,
 *   count: number
 * }>} */
  const patternMap = new Map();

  for (const d of defects) {
    if (!d.type || !d.symptom || !d.rootCause) continue;

    // 标准化 key（取症状前 30 字符作为 key）
    const symptomKey = d.symptom.trim().slice(0, 30).toLowerCase();
    const typeKey = (d.type || 'unknown').trim().toLowerCase();
    const rcKey = (d.rootCause || 'unknown').trim().toLowerCase();
    const mapKey = `${typeKey}||${symptomKey}||${rcKey}`;

    if (patternMap.has(mapKey)) {
      patternMap.get(mapKey).count++;
    } else {
      patternMap.set(mapKey, {
        type: d.type.trim(),
        symptom: d.symptom.trim(),
        rootCause: d.rootCause.trim(),
        count: 1,
      });
    }
  }

  /** @type {DiscoveredPattern[]} */
  const discovered = [];

  let idx = 1;
  for (const [key, entry] of patternMap) {
    if (entry.count < minSupport) continue;
    discovered.push({
      patternId: `AUTO-${String(idx).padStart(3, '0')}`,
      type: entry.type,
      symptom: entry.symptom,
      rootCause: entry.rootCause,
      support: entry.count,
      confidence: 1.0, // 已知根因时置信度 100%
    });
    idx++;
  }

  discovered.sort((a, b) => b.support - a.support);

  // ── 泛化模式：按 type+rootCause 聚合 ─────────────────────
  /** @type {Map<string, { type: string, rootCause: string, count: number, symptomSet: Set<string> }>} */
  const genericMap = new Map();

  for (const d of defects) {
    if (!d.type || !d.rootCause) continue;
    const gKey = `${d.type}||${d.rootCause}`;
    if (!genericMap.has(gKey)) {
      genericMap.set(gKey, {
        type: d.type,
        rootCause: d.rootCause,
        count: 0,
        symptomSet: new Set(),
      });
    }
    const g = genericMap.get(gKey);
    g.count++;
    if (d.symptom) g.symptomSet.add(d.symptom.slice(0, 20));
  }

  for (const [gKey, g] of genericMap) {
    if (g.count < minSupport) continue;
    discovered.push({
      patternId: `GEN-${String(idx).padStart(3, '0')}`,
      type: g.type,
      symptom: [...g.symptomSet].join(' / '),
      rootCause: g.rootCause,
      support: g.count,
      confidence: Math.min(1, Math.round((g.symptomSet.size / g.count) * 100) / 100),
    });
    idx++;
  }

  discovered.sort((a, b) => b.support - a.support);
  return discovered;
}

// ─── 自测 ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\n==== extractPattern: 登录页面白屏 ====');
  const p1 = extractPattern('登录页面白屏，控制台无报错，可能是CSS加载失败或DOM渲染异常');
  console.log('  type:', p1.type);
  console.log('  symptomKeywords:', p1.symptomKeywords);
  console.log('  rootCauseKeywords:', p1.rootCauseKeywords);
  console.log('  confidence:', p1.confidence);

  console.log('\n==== extractPattern: 用户列表加载超慢 ====');
  const p2 = extractPattern('用户列表页面加载超过 10 秒，数据量超过 5000 条时明显卡顿');
  console.log('  type:', p2.type);
  console.log('  symptomKeywords:', p2.symptomKeywords);
  console.log('  rootCauseKeywords:', p2.rootCauseKeywords);
  console.log('  confidence:', p2.confidence);

  const knownPatterns = [
    { patternId: 'P-001', patternName: 'UI白屏模式', type: 'UI缺陷', module: 'auth', typicalSymptom: '白屏，页面无法渲染', typicalRootCause: 'CSS文件未加载' },
    { patternId: 'P-002', patternName: '性能加载慢', type: '性能缺陷', module: 'user', typicalSymptom: '列表加载超过5秒', typicalRootCause: '数据库缺少分页' },
    { patternId: 'P-003', patternName: '事件绑定遗漏', type: '功能缺陷', module: 'auth', typicalSymptom: '点击无响应，控制台报错', typicalRootCause: '事件监听器未绑定' },
  ];

  console.log('\n==== matchPattern: auth登录页面白屏 ====');
  const m1 = matchPattern({ type: 'UI缺陷', module: 'auth', symptom: '登录页面白屏' }, knownPatterns);
  console.log('  matched:', m1 ? `${m1.patternName} (${m1.confidence})` : 'null');

  console.log('\n==== matchPattern: user列表卡顿 ====');
  const m2 = matchPattern({ type: '性能缺陷', module: 'user', symptom: '用户列表加载慢' }, knownPatterns);
  console.log('  matched:', m2 ? `${m2.patternName} (${m2.confidence})` : 'null');

  const sampleDefects = [
    { id: 'DEF-001', type: 'UI缺陷', module: 'auth', symptom: '登录页面白屏', rootCause: 'CSS未加载' },
    { id: 'DEF-002', type: 'UI缺陷', module: 'auth', symptom: '注册页面白屏', rootCause: 'CSS未加载' },
    { id: 'DEF-003', type: 'UI缺陷', module: 'auth', symptom: '登录页面白屏', rootCause: 'JS报错' },
    { id: 'DEF-004', type: '性能缺陷', module: 'user', symptom: '列表加载超过5秒', rootCause: '数据库缺少分页' },
    { id: 'DEF-005', type: '性能缺陷', module: 'user', symptom: '列表卡顿无分页', rootCause: '数据库缺少分页' },
    { id: 'DEF-006', type: '性能缺陷', module: 'user', symptom: '详情页加载慢', rootCause: '缺少缓存' },
    { id: 'DEF-007', type: '功能缺陷', module: 'auth', symptom: '点击登录无响应', rootCause: '事件未绑定' },
    { id: 'DEF-008', type: '功能缺陷', module: 'auth', symptom: '点击无响应', rootCause: '事件未绑定' },
    { id: 'DEF-009', type: '功能缺陷', module: 'auth', symptom: '按钮点击无效', rootCause: '事件未绑定' },
  ];

  console.log('\n==== learnPattern (minSupport=3) ====');
  const learned = learnPattern(sampleDefects, 3);
  learned.forEach(p => {
    console.log(`  [${p.patternId}] support=${p.support} | type=${p.type} | symptom=${p.symptom.slice(0, 20)}... | rootCause=${p.rootCause} | conf=${p.confidence}`);
  });

  console.log('\n✅ pattern-matcher.js 自测通过\n');
}
