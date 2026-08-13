/**
 * causal-chain.js
 * 因果链构建模块：构建 AND/OR 门连接的节点图，对根因打分排序
 */

/**
 * 从失败现象 + 证据构建因果链（AND/OR 门连接的节点图）
 * @param {string} failure - 失败现象描述
 * @param {string[]} evidence - 证据列表（日志片段、堆栈行等）
 * @returns {{ nodes: object[], edges: object[], topology: string }}
 */
export function buildCausalChain(failure, evidence = []) {
  if (typeof failure !== 'string' || !failure.trim()) {
    throw new Error('failure must be a non-empty string');
  }

  // 构建节点：顶层效果节点
  const nodes = [
    {
      id: 'effect-0',
      type: 'effect',
      label: failure,
      depth: 0,
    },
  ];

  // 推导中间层节点（基于证据推断）
  const intermediateNodes = inferIntermediateNodes(failure, evidence);
  nodes.push(...intermediateNodes.map((n, i) => ({ ...n, id: `inter-${i}`, depth: 1 })));

  // 叶子节点（根候选）
  const leafNodes = inferLeafNodes(failure, evidence);
  nodes.push(...leafNodes.map((n, i) => ({ ...n, id: `leaf-${i}`, depth: 2 })));

  // 构建边（AND/OR 门）
  const edges = [];
  if (intermediateNodes.length > 0) {
    // effect → intermediate (OR)
    edges.push({ from: 'effect-0', to: 'inter-0', gate: 'OR' });
    for (let i = 0; i < intermediateNodes.length - 1; i++) {
      edges.push({ from: 'effect-0', to: `inter-${i + 1}`, gate: 'OR' });
    }
  }
  if (intermediateNodes.length > 0 && leafNodes.length > 0) {
    // intermediate → leaf (AND)
    intermediateNodes.forEach((_, i) => {
      leafNodes.forEach((_, j) => {
        edges.push({ from: `inter-${i}`, to: `leaf-${j}`, gate: 'AND' });
      });
    });
  } else if (intermediateNodes.length === 0 && leafNodes.length > 0) {
    // 直接 effect → leaf
    leafNodes.forEach((_, j) => {
      edges.push({ from: 'effect-0', to: `leaf-${j}`, gate: 'AND' });
    });
  }

  return {
    nodes,
    edges,
    topology: 'tree',
  };
}

/**
 * 推断中间层节点
 * @param {string} failure
 * @param {string[]} evidence
 * @returns {object[]}
 */
function inferIntermediateNodes(failure, evidence) {
  const evidenceText = evidence.join(' ').toLowerCase();
  const failureLower = failure.toLowerCase();
  const intermediates = [];

  const indicatorMap = [
    {
      keywords: ['timeout', 'timed out', '超时', 'deadline'],
      label: '请求处理超时',
      cause: '系统在规定时间内未完成响应',
    },
    {
      keywords: ['connection refused', 'connect fail', '连接失败', 'ECONNREFUSED'],
      label: '网络连接失败',
      cause: '客户端无法与目标服务建立 TCP 连接',
    },
    {
      keywords: ['null', 'undefined', 'is not a function', 'cannot read', 'undefined', '空指针'],
      label: '空值/类型错误',
      cause: '代码中存在未做空值校验的引用',
    },
    {
      keywords: ['assertion', 'assert fail', 'expect', '断言失败', '不符'],
      label: '断言不满足',
      cause: '实际输出与预期不符',
    },
    {
      keywords: ['memory', 'heap', 'oom', 'out of memory', '内存'],
      label: '内存资源耗尽',
      cause: '进程可用内存不足以完成操作',
    },
    {
      keywords: ['permission', 'denied', 'access', '权限', '拒绝'],
      label: '权限不足',
      cause: '操作主体缺少必要的访问权限',
    },
    {
      keywords: ['config', 'env', 'variable', 'undefined', '配置', '环境变量'],
      label: '配置缺失/错误',
      cause: '运行时配置未正确设置或加载',
    },
  ];

  for (const indicator of indicatorMap) {
    if (
      indicator.keywords.some(
        (kw) => failureLower.includes(kw) || evidenceText.includes(kw)
      )
    ) {
      intermediates.push({
        type: 'intermediate',
        label: indicator.label,
        cause: indicator.cause,
      });
    }
  }

  // 如果没有匹配到任何中间层，添加一个通用节点
  if (intermediates.length === 0) {
    intermediates.push({
      type: 'intermediate',
      label: '未知中间因素',
      cause: '需要进一步调查以确定具体中间原因',
    });
  }

  return intermediates;
}

/**
 * 推断叶子节点（根候选）
 * @param {string} failure
 * @param {string[]} evidence
 * @returns {object[]}
 */
function inferLeafNodes(failure, evidence) {
  const evidenceText = evidence.join(' ').toLowerCase();
  const failureLower = failure.toLowerCase();
  const leaves = [];

  const rootIndicators = [
    {
      keywords: ['network', 'dns', 'firewall', '网络', '防火墙', 'dns'],
      label: '网络基础设施问题',
    },
    {
      keywords: ['dependency', 'package', 'version', 'module', '依赖', '版本'],
      label: '依赖包版本不兼容',
    },
    {
      keywords: ['race condition', '并发', 'race', '同时', '顺序'],
      label: '并发/竞态条件',
    },
    {
      keywords: ['data', 'input', 'payload', '数据', '参数', '格式'],
      label: '输入数据异常',
    },
    {
      keywords: ['code', 'bug', 'logic', 'error', '代码', '逻辑'],
      label: '代码逻辑缺陷',
    },
    {
      keywords: ['test', 'case', '用例', '测试数据'],
      label: '测试用例设计缺陷',
    },
    {
      keywords: ['environment', 'env', 'prod', 'dev', '环境'],
      label: '环境差异导致',
    },
    {
      keywords: ['database', 'db', 'sql', 'query', '数据库', '查询'],
      label: '数据库状态异常',
    },
  ];

  for (const indicator of rootIndicators) {
    if (
      indicator.keywords.some(
        (kw) => failureLower.includes(kw) || evidenceText.includes(kw)
      )
    ) {
      leaves.push({ type: 'root-candidate', label: indicator.label });
    }
  }

  // 默认添加最常见根因
  if (leaves.length === 0) {
    leaves.push(
      { type: 'root-candidate', label: '代码逻辑缺陷' },
      { type: 'root-candidate', label: '测试环境/数据问题' }
    );
  }

  return leaves;
}

/**
 * 根据证据支撑度对根因打分（0~1）
 * @param {string} rootCause - 根因描述
 * @param {string[]} evidence - 证据列表
 * @returns {{ score: number, justification: string }}
 */
export function scoreRootCause(rootCause, evidence = []) {
  if (typeof rootCause !== 'string' || !rootCause.trim()) {
    throw new Error('rootCause must be a non-empty string');
  }

  if (!Array.isArray(evidence)) {
    throw new Error('evidence must be an array');
  }

  const rootLower = rootCause.toLowerCase();
  let score = 0.3; // 基础分
  let matchedKeywords = 0;

  const keywordGroups = [
    // 高权重关键词组（每匹配一个 +0.2）
    ['network', 'connection', 'timeout', 'refused', '网络', '超时'],
    ['null', 'undefined', 'empty', '空值', 'undefined', 'null'],
    ['assertion', 'assert', 'expect', '不符', '断言'],
    ['memory', 'heap', 'oom', '内存', '堆'],
    ['permission', 'denied', 'access', '权限', '拒绝'],
    ['config', 'env', 'variable', 'missing', '配置', '环境变量'],
    ['dependency', 'version', 'incompatible', '依赖', '版本'],
    ['database', 'sql', 'query', 'db', '数据库', '查询'],
    ['data', 'payload', 'input', '格式', '数据', '输入'],
    ['race', 'concurrent', '并发', '顺序'],
    ['firewall', 'dns', '网络', '基础设施'],
    ['code', 'bug', 'logic', '代码', '逻辑', '缺陷'],
  ];

  for (const group of keywordGroups) {
    if (group.some((kw) => rootLower.includes(kw))) {
      matchedKeywords++;
    }
  }

  score = Math.min(0.95, 0.2 + matchedKeywords * 0.15);

  // 证据数量加分
  if (evidence.length >= 5) score = Math.min(0.95, score + 0.1);
  else if (evidence.length >= 3) score = Math.min(0.95, score + 0.05);

  // 证据文本相关性加分
  const evidenceText = evidence.join(' ').toLowerCase();
  for (const group of keywordGroups) {
    if (group.some((kw) => rootLower.includes(kw) && evidenceText.includes(kw))) {
      score = Math.min(0.95, score + 0.05);
    }
  }

  const matchedGroups = matchedKeywords;
  const justification =
    matchedGroups > 0
      ? `匹配到 ${matchedGroups} 个根因关键词组，${evidence.length} 条证据支撑，得分 ${score.toFixed(2)}`
      : `证据支撑较弱，基础分 0.3，建议补充更多证据`;

  return {
    score: Math.round(score * 100) / 100,
    matchedGroups,
    evidenceCount: evidence.length,
    justification,
  };
}

/**
 * 对改进建议按「收益/投入」排序，输出优先级列表
 * @param {string[]} recommendations - 改进建议列表
 * @param {number[]} effort - 每个建议的投入成本（1~10，10最高）
 * @param {number[]} impact - 每个建议的影响力（1~10，10最高）
 * @returns {{ prioritized: object[], bestFirst: string }}
 */
export function prioritizeFixes(recommendations = [], effort = [], impact = []) {
  if (!Array.isArray(recommendations)) {
    throw new Error('recommendations must be an array');
  }

  if (!Array.isArray(effort) || !Array.isArray(impact)) {
    throw new Error('effort and impact must be arrays');
  }

  if (recommendations.length === 0) {
    return { prioritized: [], bestFirst: null };
  }

  // 补齐默认值
  const defaultEffort = 5;
  const defaultImpact = 5;

  const scored = recommendations.map((rec, i) => {
    const e = effort[i] ?? defaultEffort;
    const imp = impact[i] ?? defaultImpact;
    const ratio = e > 0 ? imp / e : 0;
    return {
      recommendation: rec,
      effort: e,
      impact: imp,
      ratio: Math.round(ratio * 100) / 100,
      rank: 0,
    };
  });

  // 按 ratio 降序排列
  scored.sort((a, b) => b.ratio - a.ratio);

  // 分配优先级标签
  const priorityLabels = ['P0 - 立即处理', 'P1 - 高优先级', 'P2 - 计划中', 'P3 - 低优先级'];
  scored.forEach((item, idx) => {
    item.rank = idx + 1;
    item.priority =
      idx === 0
        ? priorityLabels[0]
        : idx <= 2
          ? priorityLabels[1]
          : idx <= 5
            ? priorityLabels[2]
            : priorityLabels[3];
  });

  return {
    prioritized: scored,
    bestFirst: scored[0]?.recommendation ?? null,
  };
}

// ============================================================
// 自测
// ============================================================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== causal-chain.js 自测 ===\n');

  // 测试 buildCausalChain
  const failure1 = 'API 请求超时，返回 504 Gateway Timeout';
  const evidence1 = [
    '2024-01-01 10:00:01 ERROR - connection refused to upstream:8080',
    'at TimeoutHandler.onTimeout (handler.js:45)',
    'net::ERR_CONNECTION_TIMED_OUT',
  ];
  const chain1 = buildCausalChain(failure1, evidence1);
  console.log('buildCausalChain (API超时):', JSON.stringify(chain1, null, 2));

  // 测试 scoreRootCause
  console.log('\n--- scoreRootCause ---');
  console.log(
    '网络问题:',
    JSON.stringify(scoreRootCause('网络连接超时', evidence1), null, 2)
  );
  console.log(
    '代码缺陷:',
    JSON.stringify(scoreRootCause('代码逻辑错误', evidence1), null, 2)
  );

  // 测试 prioritizeFixes
  console.log('\n--- prioritizeFixes ---');
  const recs = [
    '增加重试机制',
    '优化数据库索引',
    '升级服务器配置',
    '修复并发竞态',
    '补充集成测试',
    '更新文档说明',
  ];
  const efforts = [3, 7, 9, 5, 2, 1];
  const impacts = [9, 8, 6, 7, 5, 2];
  const prioritized = prioritizeFixes(recs, efforts, impacts);
  console.log(JSON.stringify(prioritized, null, 2));

  console.log('\n✅ 自测通过，无报错');
}
