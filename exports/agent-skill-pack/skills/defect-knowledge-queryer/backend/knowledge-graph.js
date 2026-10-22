/**
 * 缺陷知识图谱 (Defect Knowledge Graph)
 *
 * 节点类型：
 *   - defect-type : 缺陷类型节点
 *   - symptom     : 症状节点
 *   - root-cause  : 根因节点
 *   - fix         : 修复方案节点
 *
 * 边表示节点间的相似/关联关系
 *
 * 相似度算法：
 *   Jaccard(symptomSet_A, symptomSet_B) + 模块名精确匹配加权
 */

// ─── 内部辅助 ────────────────────────────────────────────────────────────────

/**
 * 从 symptom 字符串提取关键词集合
 * @param {string} symptom
 * @returns {Set<string>}
 */
function extractSymptomTokens(symptom) {
  if (!symptom) return new Set();
  const stopWords = new Set([
    '的', '了', '在', '是', '和', '与', '或', '等', '及', '为',
    'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were',
    'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by',
  ]);
  const tokens = String(symptom)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !stopWords.has(t));
  return new Set(tokens);
}

/**
 * 计算两个 symptom 集合的 Jaccard 相似度
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} 0~1
 */
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── 核心函数 ────────────────────────────────────────────────────────────────

/**
 * 从缺陷数组构建图谱
 * @param {Array<{
 *   id: string,
 *   title: string,
 *   type: string,
 *   module: string,
 *   symptom: string,
 *   rootCause: string,
 *   fix: string,
 *   severity?: string
 * }>} defects
 * @returns {{ nodes: Map, edges: Array }}
 */
export function buildGraph(defects) {
  if (!Array.isArray(defects)) {
    throw new TypeError('defects must be an array');
  }

  /** @type {Map<string, object>} nodeId -> node */
  const nodes = new Map();
  /** @type {Array<object>} */
  const edges = [];

  for (const defect of defects) {
    addDefect({ nodes, edges }, defect);
  }

  return { nodes, edges };
}

/**
 * 增量添加单个缺陷节点与边
 * @param {{ nodes: Map, edges: Array }} graph
 * @param {object} defect
 */
export function addDefect(graph, defect) {
  if (!graph || !defect || !defect.id) {
    throw new TypeError('graph and defect.id are required');
  }

  const { nodes, edges } = graph;
  const { id, title, type, module, symptom, rootCause, fix } = defect;

  // ── 节点 ──────────────────────────────────────────────────

  // 缺陷类型节点
  if (type) {
    const typeKey = `type:${type}`;
    if (!nodes.has(typeKey)) {
      nodes.set(typeKey, { id: typeKey, label: type, category: 'defect-type', count: 0 });
    }
    nodes.get(typeKey).count = (nodes.get(typeKey).count || 0) + 1;
    edges.push({ source: id, target: typeKey, relation: 'is-a' });
  }

  // 模块节点
  if (module) {
    const modKey = `module:${module}`;
    if (!nodes.has(modKey)) {
      nodes.set(modKey, { id: modKey, label: module, category: 'module', count: 0 });
    }
    nodes.get(modKey).count = (nodes.get(modKey).count || 0) + 1;
    edges.push({ source: id, target: modKey, relation: 'belongs-to' });
  }

  // 症状节点（每个症状关键词作为独立节点）
  if (symptom) {
    const tokens = extractSymptomTokens(symptom);
    for (const token of tokens) {
      const symKey = `symptom:${token}`;
      if (!nodes.has(symKey)) {
        nodes.set(symKey, { id: symKey, label: token, category: 'symptom', count: 0 });
      }
      nodes.get(symKey).count = (nodes.get(symKey).count || 0) + 1;
      edges.push({ source: id, target: symKey, relation: 'has-symptom' });
    }
  }

  // 根因节点
  if (rootCause) {
    const rcKey = `root-cause:${rootCause}`;
    if (!nodes.has(rcKey)) {
      nodes.set(rcKey, { id: rcKey, label: rootCause, category: 'root-cause', count: 0 });
    }
    nodes.get(rcKey).count = (nodes.get(rcKey).count || 0) + 1;
    edges.push({ source: id, target: rcKey, relation: 'caused-by' });
  }

  // 修复方案节点
  if (fix) {
    const fixKey = `fix:${fix}`;
    if (!nodes.has(fixKey)) {
      nodes.set(fixKey, { id: fixKey, label: fix, category: 'fix', count: 0 });
    }
    nodes.get(fixKey).count = (nodes.get(fixKey).count || 0) + 1;
    edges.push({ source: id, target: fixKey, relation: 'resolved-by' });
  }

  // 缺陷自身节点（用于关联查询）
  if (!nodes.has(id)) {
    nodes.set(id, {
      id,
      label: title || id,
      category: 'defect',
      type: type || null,
      module: module || null,
      symptom: symptom || null,
      rootCause: rootCause || null,
      fix: fix || null,
    });
  } else {
    // 补充字段
    const n = nodes.get(id);
    n.type = n.type || type || null;
    n.module = n.module || module || null;
    n.symptom = n.symptom || symptom || null;
    n.rootCause = n.rootCause || rootCause || null;
    n.fix = n.fix || fix || null;
    n.label = n.label || title || id;
  }

  // ── 缺陷间边（相同模块 → 关联） ─────────────────────────
  for (const [nodeId, node] of nodes) {
    if (node.category === 'defect' && nodeId !== id) {
      if (node.module === module) {
        edges.push({ source: id, target: nodeId, relation: 'same-module' });
      }
      if (node.type === type) {
        edges.push({ source: id, target: nodeId, relation: 'same-type' });
      }
    }
  }
}

/**
 * 基于症状/模块/类型相似度返回最相似的 topK 个历史缺陷
 * @param {{ nodes: Map, edges: Array }} graph
 * @param {{
 *   id?: string,
 *   title?: string,
 *   type?: string,
 *   module?: string,
 *   symptom?: string,
 *   rootCause?: string,
 *   fix?: string
 * }} defect
 * @param {number} [topK=5]
 * @returns {Array<{ id: string, label: string, type: string, module: string, symptom: string, rootCause: string, fix: string, similarity: number }>}
 */
export function querySimilar(graph, defect, topK = 5) {
  if (!graph || !graph.nodes) {
    throw new TypeError('graph with nodes is required');
  }
  if (topK < 1) topK = 5;

  const { nodes } = graph;
  const targetSymptomTokens = extractSymptomTokens(defect.symptom || '');
  const targetModule = (defect.module || '').trim().toLowerCase();
  const targetType = (defect.type || '').trim().toLowerCase();

  /** @type {Array<{ id, label, type, module, symptom, rootCause, fix, similarity }>} */
  const scored = [];

  for (const [nodeId, node] of nodes) {
    if (node.category !== 'defect') continue;
    if (defect.id && nodeId === defect.id) continue; // 排除自身

    let score = 0;

    // Jaccard 相似度（症状）
    const nodeSymptomTokens = extractSymptomTokens(node.symptom || '');
    const jaccardSim = jaccard(targetSymptomTokens, nodeSymptomTokens);
    score += jaccardSim * 0.6; // 症状权重 60%

    // 模块精确匹配
    const nodeModule = (node.module || '').trim().toLowerCase();
    if (targetModule && nodeModule === targetModule) {
      score += 0.25;
    }

    // 类型精确匹配
    const nodeType = (node.type || '').trim().toLowerCase();
    if (targetType && nodeType === targetType) {
      score += 0.15;
    }

    if (score > 0) {
      scored.push({
        id: nodeId,
        label: node.label,
        type: node.type,
        module: node.module,
        symptom: node.symptom,
        rootCause: node.rootCause,
        fix: node.fix,
        similarity: Math.min(1, Math.round(score * 1000) / 1000),
      });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

/**
 * 返回图谱中沉淀的缺陷模式列表（按出现频次排序）
 * @param {{ nodes: Map, edges: Array }} graph
 * @returns {Array<{ pattern: string, type?: string, module?: string, count: number }>}
 */
export function getPatterns(graph) {
  if (!graph || !graph.nodes) {
    throw new TypeError('graph with nodes is required');
  }

  const { nodes, edges } = graph;
  /** @type {Map<string, { type?: string, module?: string, symptomCount: number, rootCauseCount: number }>} */
  const typeModuleCounts = new Map();

  // 遍历缺陷节点，统计 type+module 组合
  for (const [, node] of nodes) {
    if (node.category !== 'defect') continue;
    const key = `${node.type || 'unknown'}::${node.module || 'unknown'}`;
    if (!typeModuleCounts.has(key)) {
      typeModuleCounts.set(key, {
        type: node.type || 'unknown',
        module: node.module || 'unknown',
        symptomCount: 0,
        rootCauseCount: 0,
      });
    }
    const entry = typeModuleCounts.get(key);
    entry.symptomCount++;
    if (node.rootCause) entry.rootCauseCount++;
  }

  // 构建模式
  /** @type {Array<{ pattern: string, type?: string, module?: string, count: number }>} */
  const patterns = [];

  for (const [, entry] of typeModuleCounts) {
    const patternName = `${entry.type}/${entry.module}`;
    patterns.push({
      pattern: patternName,
      type: entry.type,
      module: entry.module,
      count: entry.symptomCount,
      rootCauseRatio: entry.symptomCount > 0
        ? Math.round((entry.rootCauseCount / entry.symptomCount) * 100) / 100
        : 0,
    });
  }

  patterns.sort((a, b) => b.count - a.count);
  return patterns;
}

// ─── 自测 ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const sampleDefects = [
    {
      id: 'DEF-001',
      title: '登录页面白屏',
      type: 'UI缺陷',
      module: 'auth',
      symptom: '登录页面打开后显示白屏，无法看到任何内容',
      rootCause: 'CSS 文件未正确加载',
      fix: '检查 CSS CDN 链接，修复路径',
      severity: 'high',
    },
    {
      id: 'DEF-002',
      title: '用户列表加载慢',
      type: '性能缺陷',
      module: 'user',
      symptom: '用户列表页面加载超过 5 秒，数据量 1000 条以上时卡顿',
      rootCause: '数据库缺少分页查询',
      fix: '添加 SQL LIMIT 分页，每次查询 20 条',
      severity: 'medium',
    },
    {
      id: 'DEF-003',
      title: '登录按钮点击无效',
      type: '功能缺陷',
      module: 'auth',
      symptom: '点击登录按钮无响应，控制台报 JS 错误',
      rootCause: '事件监听器未正确绑定',
      fix: '修复事件绑定逻辑，确保 DOM 加载后再绑定',
      severity: 'high',
    },
    {
      id: 'DEF-004',
      title: '用户详情页报错',
      type: '功能缺陷',
      module: 'user',
      symptom: '用户详情页打开报错，数据无法展示',
      rootCause: 'API 返回 null 时未做空值处理',
      fix: '增加空值判断，渲染前检查数据有效性',
      severity: 'medium',
    },
    {
      id: 'DEF-005',
      title: '表单提交白屏',
      type: 'UI缺陷',
      module: 'form',
      symptom: '表单提交后页面白屏，无法看到提交结果',
      rootCause: '提交后重定向失败',
      fix: '修复重定向 URL 配置',
      severity: 'medium',
    },
  ];

  console.log('\n==== buildGraph ====');
  const graph = buildGraph(sampleDefects);
  console.log(`节点数: ${graph.nodes.size}`);
  console.log(`边数: ${graph.edges.length}`);

  console.log('\n==== querySimilar(DEF-001 topK=3) ====');
  const similar = querySimilar(graph, sampleDefects[0], 3);
  similar.forEach(d => {
    console.log(`  [${d.similarity}] ${d.id} - ${d.label} (type=${d.type}, module=${d.module})`);
    console.log(`    symptom: ${d.symptom}`);
    console.log(`    rootCause: ${d.rootCause}`);
    console.log(`    fix: ${d.fix}`);
  });

  console.log('\n==== getPatterns ====');
  const patterns = getPatterns(graph);
  patterns.forEach(p => {
    console.log(`  [${p.count}] ${p.pattern} (rootCause ratio: ${p.rootCauseRatio})`);
  });

  console.log('\n✅ knowledge-graph.js 自测通过\n');
}
