/**
 * elimination.js
 * 上下文智能淘汰与去重
 * - 基于层优先级+最近访问+冗余度判断是否淘汰
 * - 淘汰指定保留层之外的低优先级内容
 * - 文本块去重（基于重叠率/SimHash指纹）
 */

import { LAYER_PRIORITY } from './layered-architecture.js';

// ---------- 指纹工具 ----------

/**
 * 简单 SimHash 指纹：将字符串转为 64 位数值指纹
 * 基于字符 n-gram 哈希，用于近似重复检测
 * @param {string} text
 * @param {number} n - n-gram 大小，默认 3
 * @returns {bigint}
 */
function simpleSimHash(text, n = 3) {
  if (!text || typeof text !== 'string') return BigInt(0);
  const grams = [];
  for (let i = 0; i <= text.length - n; i++) {
    grams.push(text.slice(i, i + n));
  }
  if (grams.length === 0) {
    // 短文本直接用整个字符串
    grams.push(text);
  }

  const v = new Float64Array(64).fill(0);

  for (const gram of grams) {
    // 用一个简单哈希（可替换为实际 MurmurHash，这里用 FNV-1a 简化版）
    let h = 2166136261;
    for (let i = 0; i < gram.length; i++) {
      h ^= gram.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    // 将 32 位哈希映射到 64 位向量
    for (let bit = 0; bit < 64; bit++) {
      if (h & (1 << (bit % 32))) {
        v[bit] += 1;
      } else {
        v[bit] -= 1;
      }
    }
  }

  let fingerprint = BigInt(0);
  for (let i = 0; i < 64; i++) {
    if (v[i] > 0) {
      fingerprint |= BigInt(1) << BigInt(i);
    }
  }
  return fingerprint;
}

/**
 * 计算两个指纹的海明距离（0-64）
 * @param {bigint} a
 * @param {bigint} b
 * @returns {number}
 */
function hammingDistance(a, b) {
  let diff = a ^ b;
  let dist = 0;
  while (diff !== BigInt(0)) {
    dist += Number(diff & BigInt(1));
    diff >>= BigInt(1);
  }
  return dist;
}

/**
 * 计算两个文本的重叠率（Jaccard 相似度，基于分词）
 * @param {string} a
 * @param {string} b
 * @returns {number} [0, 1]
 */
function textOverlap(a, b) {
  if (!a || !b) return 0;
  const tokensA = new Set(a.split(/\s+/).filter(t => t.length > 1));
  const tokensB = new Set(b.split(/\s+/).filter(t => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

// ---------- 最近访问时间窗口 ----------

/**
 * 基于层优先级 + 最近访问 + 冗余度判断是否淘汰
 *
 * 淘汰评分规则（分数越高越应淘汰）：
 *   - 层优先级：LAYER_PRIORITY[chunk._layer] × 10
 *   - 最近访问衰减：超过 window 条未访问 +5/条
 *   - 冗余度：与其他块重叠率 > 0.7 → +20，每增 0.1 加 5
 *   - 长度惩罚：超过 5000 字 +3
 *
 * @param {object} chunk - 上下文块 { text, _layer?, _lastAccess?, _accessCount? }
 * @param {object} layers - buildLayers 返回的分层结构（用于计算全局冗余度）
 * @param {number} [window=20] - 未访问窗口，超过则触发衰减
 * @returns {{ evict: boolean, score: number, reason: string }}
 */
export function shouldEvict(chunk, layers, window = 20) {
  if (!chunk || typeof chunk.text !== 'string') {
    return { evict: false, score: 0, reason: '无效chunk' };
  }

  let score = 0;
  const reasons = [];

  // 1. 层优先级分数
  const layer = chunk._layer || 'L2';
  const layerScore = (LAYER_PRIORITY[layer] ?? 2) * 10;
  score += layerScore;
  reasons.push(`层优先级(${layer}) +${layerScore}`);

  // 2. 未访问衰减（_lastAccess 期望是数字时间戳或访问序号）
  const lastAccess = chunk._lastAccess ?? 0;
  const accessCount = chunk._accessCount ?? 0;
  if (lastAccess > 0) {
    const staleCount = Math.max(0, accessCount - lastAccess);
    if (staleCount > window) {
      const penalty = Math.min((staleCount - window) * 2, 30);
      score += penalty;
      reasons.push(`未访问超窗口(+${Math.round(penalty)})`);
    }
  }

  // 3. 冗余度：计算与同层/其他层块的重叠
  const allTexts = Object.values(layers)
    .flat()
    .filter(c => c !== chunk && c.text)
    .map(c => c.text);

  let maxOverlap = 0;
  for (const other of allTexts) {
    const ov = textOverlap(chunk.text, other);
    if (ov > maxOverlap) maxOverlap = ov;
  }
  if (maxOverlap > 0.5) {
    const redundancyPenalty = Math.round((maxOverlap - 0.5) * 60);
    score += redundancyPenalty;
    reasons.push(`冗余度${(maxOverlap * 100).toFixed(0)}% +${redundancyPenalty}`);
  }

  // 4. 长度惩罚（超长文本倾向淘汰）
  if (chunk.text.length > 5000) {
    score += 3;
    reasons.push('超长文本 +3');
  }

  // 5. L4 层强制可淘汰
  if (layer === 'L4') {
    score += 10;
    reasons.push('L4层额外 +10');
  }

  const evict = score >= 20; // 阈值可调
  return {
    evict,
    score,
    reason: reasons.join('；'),
  };
}

/**
 * 淘汰指定保留层之外的低优先级内容
 * @param {object} layers - buildLayers 返回的分层结构
 * @param {string[]} [keepLayers=['L0','L1']] - 强制保留的层级列表
 * @returns {{ layers: object, evictedCount: number, evictedChars: number, stats: object }}
 */
export function evictLowPriority(layers, keepLayers = ['L0', 'L1']) {
  if (!layers || typeof layers !== 'object') {
    throw new Error('evictLowPriority: layers 必须是对象');
  }

  const keepSet = new Set(keepLayers);
  let evictedCount = 0;
  let evictedChars = 0;
  const stats = {};

  /** @type {{ [key: string]: Array }} */
  const newLayers = {};
  for (const [layer, items] of Object.entries(layers)) {
    if (keepSet.has(layer)) {
      newLayers[layer] = [...(items || [])];
      stats[layer] = { kept: items?.length || 0, evicted: 0 };
    } else {
      // 对非保留层逐块评估
      const toKeep = [];
      for (const chunk of (items || [])) {
        const { evict } = shouldEvict(chunk, layers);
        if (evict) {
          evictedCount++;
          evictedChars += chunk.text?.length || 0;
        } else {
          toKeep.push(chunk);
        }
      }
      newLayers[layer] = toKeep;
      stats[layer] = { kept: toKeep.length, evicted: (items?.length || 0) - toKeep.length };
    }
  }

  return {
    layers: newLayers,
    evictedCount,
    evictedChars,
    stats,
  };
}

/**
 * 对文本块去重（基于 SimHash 海明距离 + 重叠率双重判断）
 * 两个块 SimHash 海明距离 < 10 或 重叠率 > 0.7 → 判定为重复
 * @param {Array<{id?: string, text: string, meta?: object}>} chunks
 * @returns {{ unique: Array, duplicates: Array, removedCount: number }}
 */
export function deduplicate(chunks) {
  if (!Array.isArray(chunks)) {
    throw new Error('deduplicate: chunks 必须是数组');
  }

  /** @type {Array<{id?: string, text: string, meta?: object}>} */
  const unique = [];
  /** @type {Array<{id?: string, text: string, meta?: object}>} */
  const duplicates = [];

  for (const chunk of chunks) {
    if (!chunk || typeof chunk.text !== 'string' || chunk.text.length < 5) continue;

    const hash = simpleSimHash(chunk.text);
    let isDuplicate = false;

    for (const existing of unique) {
      if (!existing.text) continue;

      const existingHash = simpleSimHash(existing.text);
      const hamDist = hammingDistance(hash, existingHash);
      const overlap = textOverlap(chunk.text, existing.text);

      // 海明距离 < 10 或 重叠率 > 0.7 → 重复
      if (hamDist < 10 || overlap > 0.7) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      duplicates.push(chunk);
    } else {
      unique.push(chunk);
    }
  }

  return {
    unique,
    duplicates,
    removedCount: duplicates.length,
  };
}

// ---------- 自测 ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\n--- elimination.js 自测 ---\n');

  const { buildLayers } = await import('./layered-architecture.js');
  const { summarizeLayers } = await import('./layered-architecture.js');

  const testChunks = [
    { id: 'c1', text: '系统角色：你是一个测试需求分析师。', _layer: 'L0', _lastAccess: 1, _accessCount: 10 },
    { id: 'c2', text: '当前任务：为电商系统编写自动化测试用例，覆盖登录和下单流程。', _layer: 'L1', _lastAccess: 10, _accessCount: 10 },
    { id: 'c3', text: '用户输入：请测试购物车功能。', _layer: 'L2', _lastAccess: 5, _accessCount: 5 },
    { id: 'c4', text: '之前已处理过的登录测试需求，生成了50条用例。', _layer: 'L3', _lastAccess: 1, _accessCount: 30 }, // 旧数据
    { id: 'c5', text: '参考资料：TestNG官方文档 https://testng.org', _layer: 'L4', _lastAccess: 1, _accessCount: 1 },
    { id: 'c6', text: '参考资料：JUnit5用户手册 https://junit.org/junit5', _layer: 'L4', _lastAccess: 1, _accessCount: 1 },
    { id: 'c7', text: '这是一段非常长的文本内容，用于测试长度惩罚机制。此段落包含大量重复的描述文字，目的是让总长度超过5000字符的阈值，从而触发长度惩罚机制。'.repeat(20), _layer: 'L3', _lastAccess: 1, _accessCount: 50 },
  ];

  console.log('--- shouldEvict 测试 ---');
  const layers = buildLayers(testChunks);
  for (const chunk of testChunks) {
    const { evict, score, reason } = shouldEvict(chunk, layers);
    console.log(`  [${chunk._layer}] ${chunk.id} evict=${evict} score=${score} | ${reason}`);
  }

  console.log('\n--- evictLowPriority 测试 ---');
  const { layers: afterEvict, evictedCount, evictedChars, stats } = evictLowPriority(layers, ['L0', 'L1']);
  console.log(summarizeLayers(afterEvict));
  console.log(`淘汰块数: ${evictedCount}，淘汰字数: ${evictedChars}`);
  console.log('各层统计:', stats);

  console.log('\n--- deduplicate 测试 ---');
  const dupChunks = [
    { id: 'd1', text: '登录功能测试需要验证用户名密码正确性、错误密码重试次数限制。' },
    { id: 'd2', text: '登录功能测试需要验证用户名密码正确性、错误密码重试次数限制。' }, // 完全相同
    { id: 'd3', text: '下单流程测试：用户选择商品、确认订单、提交支付。' },
    { id: 'd4', text: '下单流程测试：用户选择商品、确认订单、提交支付。' }, // 完全相同
    { id: 'd5', text: '支付测试用例需要覆盖微信支付、支付宝、银联卡三种方式。' },
  ];
  const { unique, duplicates, removedCount } = deduplicate(dupChunks);
  console.log(`原始块数: ${dupChunks.length}，去重后: ${unique.length}，移除: ${removedCount}`);
  console.log('唯一块:', unique.map(c => c.id));
  console.log('重复块:', duplicates.map(c => c.id));

  // 测试 SimHash
  const hash1 = simpleSimHash('这是一个测试句子');
  const hash2 = simpleSimHash('这是一个测试句子');
  const hash3 = simpleSimHash('这是另一个完全不同的句子');
  console.log(`\nSimHash测试：相同文本距离=${hammingDistance(hash1, hash2)}，不同文本距离=${hammingDistance(hash1, hash3)}`);

  console.log('\n✅ elimination.js 验证通过\n');
}
