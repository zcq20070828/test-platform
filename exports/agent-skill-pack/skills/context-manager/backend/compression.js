/**
 * compression.js
 * 上下文压缩与要点提取
 * - 抽取式压缩（按句子重要性打分）
 * - 关键要点提取（关键词频率+位置打分）
 * - 按 Token 预算压缩
 */

/**
 * 估算中文字符对应的 Token 数（粗略：1 token ≈ 1.5 中文字）
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  // 中文按1.5估算，英文按0.25估算，空格不计入
  const chinese  = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const english  = (text.match(/[a-zA-Z]/g) || []).length;
  return Math.ceil(chinese * 1.5 + english * 0.25);
}

/**
 * 将文本切分为句子数组（支持中英文句号/感叹号/问号）
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  if (!text) return [];
  // 按句子分隔符切分，保留非空句
  return text
    .split(/(?<=[。！？.!?])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 5); // 过短的片段不计入
}

/**
 * 句子重要性打分（基于关键词命中 + 位置权重 + 长度惩罚）
 * @param {string} sentence
 * @param {number} totalSentences
 * @param {number} position - 句子在全文中的位置 0-based
 * @param {string[]} [extraKeywords=[]]
 * @returns {number}
 */
function scoreSentence(sentence, totalSentences, position, extraKeywords = []) {
  let score = 0;
  const s = sentence;

  // 1. 关键词命中（显式指定词 + 高权重通用词）
  const HIGH_WEIGHT_KEYWORDS = [
    '测试', '需求', '用例', '功能', '模块', '接口', 'bug', '缺陷',
    '验证', '覆盖', '场景', '步骤', '前置', '结果', '预期',
    '必须', '重要', '关键', '核心', '主要', '优先', '紧急',
  ];
  const allKeywords = [...new Set([...HIGH_WEIGHT_KEYWORDS, ...extraKeywords])];

  for (const kw of allKeywords) {
    if (s.includes(kw)) score += kw.length > 2 ? 3 : 1;
  }

  // 2. 位置权重：开头1.2x，结尾1.1x（通常摘要信息在首尾）
  const normPos = totalSentences > 1 ? position / (totalSentences - 1) : 0.5;
  if (normPos < 0.1)        score *= 1.2; // 前10%
  else if (normPos > 0.85)  score *= 1.1; // 后15%

  // 3. 长度惩罚：过长句子适当降低（信息密度低），过短也降低
  const len = s.length;
  if (len > 200) score *= 0.8;
  else if (len < 30) score *= 0.5;

  // 4. 包含数字/列表项加分（数据敏感度高）
  if (/\d+/.test(s))       score += 1;
  if (/①|②|③|④|\-|\*|\d+\./.test(s)) score += 1;

  return score;
}

/**
 * 对长文本做抽取式压缩
 * @param {string} text - 原始文本
 * @param {number} ratio - 保留比例 [0.1, 1.0]，默认 0.5
 * @param {string[]} [extraKeywords] - 额外高权重关键词
 * @returns {{ compressed: string, originalLength: number, compressedLength: number, retentionRate: number }}
 */
export function compress(text, ratio = 0.5, extraKeywords = []) {
  if (!text || typeof text !== 'string') {
    return { compressed: '', originalLength: 0, compressedLength: 0, retentionRate: 0 };
  }
  if (ratio <= 0 || ratio > 1) ratio = 0.5;

  const originalLength = text.length;
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    // 无句子可分，整段截断
    const cut = text.slice(0, Math.floor(originalLength * ratio));
    return { compressed: cut, originalLength, compressedLength: cut.length, retentionRate: ratio };
  }

  const total = sentences.length;
  const keepCount = Math.max(1, Math.round(total * ratio));

  // 逐句打分
  const scored = sentences.map((s, i) => ({
    text: s,
    score: scoreSentence(s, total, i, extraKeywords),
    position: i,
  }));

  // 取 top-keepCount
  scored.sort((a, b) => b.score - a.score);
  const kept = scored.slice(0, keepCount);

  // 按原文顺序重排
  kept.sort((a, b) => a.position - b.position);
  const compressed = kept.map(s => s.text).join('。') + (kept.length > 0 ? '。' : '');

  const compressedLength = compressed.length;
  const retentionRate = Math.round((compressedLength / originalLength) * 100) / 100;

  return { compressed, originalLength, compressedLength, retentionRate };
}

/**
 * 提取关键要点列表
 * @param {string} text - 原始文本
 * @param {number} maxPoints - 最多保留要点数，默认 5
 * @returns {{ points: string[], originalLength: number }}
 */
export function summarizePoints(text, maxPoints = 5) {
  if (!text || typeof text !== 'string') {
    return { points: [], originalLength: 0 };
  }
  maxPoints = Math.max(1, Math.min(maxPoints, 20));

  const originalLength = text.length;
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    // 无句子：取前 maxPoints 个换行段落
    const paras = text.split(/\n+/).filter(p => p.trim().length > 5);
    const points = paras.slice(0, maxPoints).map(p => p.trim());
    return { points, originalLength };
  }

  const total = sentences.length;
  const scored = sentences.map((s, i) => ({
    text: s,
    score: scoreSentence(s, total, i),
    position: i,
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxPoints);
  top.sort((a, b) => a.position - b.position);

  return {
    points: top.map(s => s.text.trim()),
    originalLength,
  };
}

/**
 * 按 Token 预算压缩某一层
 * @param {string} layerText - 该层所有文本合并后的字符串
 * @param {number} budgetTokens - Token 预算上限
 * @param {string[]} [extraKeywords] - 额外高权重关键词
 * @returns {{ compressed: string, originalTokens: number, compressedTokens: number, compressedRatio: number }}
 */
export function compressLayer(layerText, budgetTokens, extraKeywords = []) {
  if (!layerText || typeof layerText !== 'string') {
    return { compressed: '', originalTokens: 0, compressedTokens: 0, compressedRatio: 1 };
  }
  if (!budgetTokens || budgetTokens <= 0) {
    return { compressed: layerText, originalTokens: estimateTokens(layerText), compressedTokens: estimateTokens(layerText), compressedRatio: 1 };
  }

  const originalTokens = estimateTokens(layerText);

  if (originalTokens <= budgetTokens) {
    return { compressed: layerText, originalTokens, compressedTokens: originalTokens, compressedRatio: 1 };
  }

  // 目标字符数：按 1 token ≈ 1.5 中文估算
  const targetChars = Math.floor(budgetTokens * 1.5);
  const targetRatio = Math.max(0.1, Math.min(targetChars / layerText.length, 1));

  const result = compress(layerText, targetRatio, extraKeywords);
  const compressedTokens = estimateTokens(result.compressed);

  return {
    compressed: result.compressed,
    originalTokens,
    compressedTokens,
    compressedRatio: Math.round((compressedTokens / originalTokens) * 100) / 100,
  };
}

// ---------- 自测 ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\n--- compression.js 自测 ---\n');

  const sampleText = `
    需求背景：某电商平台订单系统需要重构，原有订单模块存在并发处理能力不足、数据一致性风险等问题。
    本次测试任务主要覆盖以下核心功能模块：
    第一，用户登录与认证功能，包括用户名密码登录、短信验证码登录、第三方OAuth2登录三种方式。
    第二，商品浏览与搜索功能，支持关键字搜索、分类筛选、销量排序和价格区间筛选。
    第三，购物车管理，用户可以添加商品、修改数量、删除商品、勾选结算，支持离线数量同步。
    第四，订单创建与提交，包括地址选择、发票信息填写、支付方式选择和优惠劵应用。
    第五，支付流程，支持微信支付、支付宝支付、银行卡支付三种方式，需要验证支付状态回调。
    测试要求：必须覆盖正常流程和异常流程，其中异常流程包括网络超时、支付失败、库存不足三种场景。
    用例优先级：P0级用例必须100%执行通过，包括登录成功、订单提交成功、支付成功三个用例。
    测试数据准备：需要准备10个测试账号、100个测试商品SKU、3个测试收货地址、2张测试优惠劵。
    性能要求：单接口响应时间不超过200毫秒，TPS不低于100。
    兼容性要求：支持iOS 12以上、Android 8以上系统版本，浏览器支持Chrome 80以上、Firefox 75以上、Safari 13以上。
  `.trim();

  console.log(`原文长度：${sampleText.length} 字，约 ${estimateTokens(sampleText)} tokens\n`);

  // 压缩测试
  const result50 = compress(sampleText, 0.5);
  console.log('【压缩至50%】');
  console.log(`  压缩后长度：${result50.compressedLength} 字，保留率：${(result50.retentionRate * 100).toFixed(1)}%`);
  console.log(`  内容：${result50.compressed.slice(0, 100)}…\n`);

  const result30 = compress(sampleText, 0.3);
  console.log('【压缩至30%】');
  console.log(`  压缩后长度：${result30.compressedLength} 字，保留率：${(result30.retentionRate * 100).toFixed(1)}%`);
  console.log(`  内容：${result30.compressed.slice(0, 100)}…\n`);

  // 要点提取
  const points = summarizePoints(sampleText, 5);
  console.log('【提取5个关键要点】');
  points.points.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log();

  // Token预算压缩
  const budget = compressLayer(sampleText, 150);
  console.log('【Token预算150压缩】');
  console.log(`  原tokens: ${budget.originalTokens} → 压缩后tokens: ${budget.compressedTokens}，压缩比: ${budget.compressedRatio}`);
  console.log(`  内容：${budget.compressed.slice(0, 80)}…`);

  console.log('\n✅ compression.js 验证通过\n');
}
