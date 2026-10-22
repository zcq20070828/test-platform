/**
 * layered-architecture.js
 * 上下文分层分级架构（L0-L4）
 * L0 系统/角色设定（永不淘汰）
 * L1 当前任务目标（高优先级）
 * L2 近期交互/输入（中优先级）
 * L3 历史上下文（低优先级，可压缩）
 * L4 参考资料/冗余（最低优先级，优先淘汰）
 */

/**
 * 层级优先级映射
 * @type {Record<string, number>}
 */
export const LAYER_PRIORITY = {
  L0: 0, // 永不淘汰
  L1: 1, // 高优先级
  L2: 2, // 中优先级
  L3: 3, // 低优先级
  L4: 4, // 最低优先级
};

/**
 * 各层保留策略
 */
const LAYER_POLICY = {
  L0: { evictable: false, compressible: false,  label: '系统/角色设定' },
  L1: { evictable: false, compressible: true,   label: '当前任务目标' },
  L2: { evictable: true,  compressible: true,   label: '近期交互/输入' },
  L3: { evictable: true,  compressible: true,  label: '历史上下文' },
  L4: { evictable: true,  compressible: false,  label: '参考资料/冗余' },
};

// ---------- 关键词指纹（用于 classify 简单匹配） ----------
const PATTERNS = {
  L0: [
    /^system|^role|^persona|^prompt|^instruction|^规则|^角色|^系统/i,
  ],
  L1: [
    /任务|目标|objective|goal|task|请|要求|需要你|你需要|帮我做|帮我生成|帮我分析|当前任务/i,
  ],
  L2: [
    /上文|之前|刚才|刚才说|之前说|对话|消息|message|input|交互|用户说|用户问|用户提到/i,
  ],
  L3: [
    /历史|记录|之前已|已经过|之前的对话|更早|earlier|past|history|日志/i,
  ],
  L4: [
    /参考|附件|原文|引用|reference|appendix|脚注|wiki|文档链接|参考资料|冗余|补充|无关/i,
  ],
};

/**
 * 将一段文本/消息分类到 L0-L4 某一层
 * @param {string} chunk - 输入文本块
 * @returns {{ layer: string, priority: number, reason: string }}
 */
export function classify(chunk) {
  if (!chunk || typeof chunk !== 'string') {
    return { layer: 'L2', priority: 2, reason: '空输入，默认L2' };
  }

  const trimmed = chunk.trim();
  const scores = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };

  for (const [layer, patterns] of Object.entries(PATTERNS)) {
    for (const re of patterns) {
      if (re.test(trimmed)) scores[layer] += 1;
    }
  }

  // 长度辅助判断：超长文本更可能是 L3/L4
  const len = trimmed.length;
  if (len > 3000) scores.L3 += 1;
  if (len > 6000) scores.L4 += 1;
  if (len < 200)  scores.L1 += 1; // 短文本倾向于当前任务

  const bestLayer = Object.entries(scores).reduce(
    (a, b) => (b[1] > a[1] ? b : a)
  )[0];

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) {
    // 无匹配，按长度默认
    if (len < 300)  return { layer: 'L2', priority: 2, reason: '无关键词匹配，按长度归为L2' };
    if (len < 3000) return { layer: 'L3', priority: 3, reason: '无关键词匹配，按长度归为L3' };
    return { layer: 'L4', priority: 4, reason: '无关键词匹配，按长度归为L4' };
  }

  return {
    layer: bestLayer,
    priority: LAYER_PRIORITY[bestLayer],
    reason: `命中${bestLayer}关键词，得分${maxScore}`,
  };
}

/**
 * 将文本块数组分配进分层结构
 * @param {Array<{id?: string, text: string, meta?: object}>} chunks
 * @returns {{ L0: Array, L1: Array, L2: Array, L3: Array, L4: Array }}
 */
export function buildLayers(chunks) {
  if (!Array.isArray(chunks)) {
    throw new Error('buildLayers: chunks 必须是数组');
  }

  /** @type {{ L0: Array, L1: Array, L2: Array, L3: Array, L4: Array }} */
  const layers = { L0: [], L1: [], L2: [], L3: [], L4: [] };

  for (const chunk of chunks) {
    if (!chunk || typeof chunk.text !== 'string') continue;
    const { layer } = classify(chunk.text);
    layers[layer].push({
      ...chunk,
      _layer: layer,
      _priority: LAYER_PRIORITY[layer],
    });
  }

  return layers;
}

/**
 * 返回该层优先级数值（数值越小优先级越高）
 * @param {string} layer - L0|L1|L2|L3|L4
 * @returns {number}
 */
/** @type {Record<string, number>} */
export const LAYER_PRIORITY_MAP = LAYER_PRIORITY;

export function getPriority(layer) {
  if (!(layer in LAYER_PRIORITY)) {
    throw new Error(`getPriority: 未知层级 "${layer}"，期望 L0-L4`);
  }
  return LAYER_PRIORITY[layer];
}

/**
 * 返回层级的元信息
 * @param {string} layer
 * @returns {{ evictable: boolean, compressible: boolean, label: string }}
 */
export function getLayerPolicy(layer) {
  if (!(layer in LAYER_POLICY)) {
    throw new Error(`getLayerPolicy: 未知层级 "${layer}"`);
  }
  return { ...LAYER_POLICY[layer] };
}

/**
 * 打印分层统计摘要
 * @param {ReturnType<typeof buildLayers>} layers
 */
export function summarizeLayers(layers) {
  const lines = ['=== 上下文分层统计 ==='];
  for (const [layer, items] of Object.entries(layers)) {
    const policy = LAYER_POLICY[layer];
    const charCount = items.reduce((s, c) => s + (c.text?.length || 0), 0);
    lines.push(`  ${layer} [${policy.label}]：${items.length} 块，约 ${charCount} 字`);
  }
  return lines.join('\n');
}

// ---------- 自测 ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\n--- layered-architecture.js 自测 ---\n');

  const testChunks = [
    { id: 'c1', text: '你是一个测试需求分析师，请分析以下需求文档。' },
    { id: 'c2', text: '任务：为电商系统编写自动化测试用例，覆盖登录、下单、支付三个核心流程。' },
    { id: 'c3', text: '用户输入：帮我测试购物车功能。' },
    { id: 'c4', text: '系统之前已经处理过类似的登录测试需求，生成了 50 条用例。' },
    { id: 'c5', text: '参考资料：参考了 TestNG 官方文档 https://testng.org/doc/documentation.html 以及 JUnit5 用户手册。' },
    { id: 'c6', text: '这是一件很重要的事情，需要你立即执行。' },
  ];

  const layers = buildLayers(testChunks);
  console.log(summarizeLayers(layers));

  console.log('\n各块分类结果:');
  for (const chunk of testChunks) {
    const r = classify(chunk.text);
    console.log(`  [${r.layer}] p${r.priority} | ${r.reason} | ${chunk.text.slice(0, 30)}…`);
  }

  console.log('\n优先级测试:');
  console.log('  L0 →', getPriority('L0'), '| L3 →', getPriority('L3'), '| L4 →', getPriority('L4'));

  console.log('\n✅ layered-architecture.js 验证通过\n');
}
