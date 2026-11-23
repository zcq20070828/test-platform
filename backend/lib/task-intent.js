/**
 * 任务意图识别（2026-11-20）
 *
 * 用户两条要求：
 *   1. 「前端提交任务时都加这个意图意识呢，而不是只有『继续对话』才加」
 *   2. 「无法根据用户输入准确识别意图的时候就提供 3 个最有可能的选项给让用户选择」
 *
 * 改造前的真实行为（autoSelectAgent）：
 *   - 按规则表顺序「首个命中即返回」，后面的规则不再参与比较；
 *   - 没有置信度：命中一个短词（如「接口」）与命中整句（「对这个系统做接口测试」）同等对待；
 *   - 无法识别时静默落到 test-master，用户不知道自己的任务被派给了通用智能体。
 *
 * 实测会误派的情形：
 *   「帮我测试一下这个系统的接口」      → 命中「接口」→ api-executor（贴切）
 *   「看看这个接口有没有问题」          → 命中「接口」→ api-executor（但用户想要缺陷分析）
 *   「这个功能还有什么没考虑到的」      → 零命中 → test-master（用户以为在做需求分析）
 *   而「用例」这种高频词会让一半输入都派给 test-case-generator。
 *
 * 现在改成**全部打分**：每个候选智能体累计匹配到的关键词权重（越长越具体），
 * 算出一个主导度；主导度不够就返回 3 个候选让人来选，而不是替用户猜。
 *
 * 关键词强度按长度加权是有依据的：「测试用例生成」6 字几乎不会误配，
 * 而「case」「接口」这类 2-4 字短词在自然语言里到处都是。
 */

/**
 * 智能体关键词规则（单一事实来源）
 *
 * `priority` 只在「分数完全相同」时用于打破平局，不再决定命中即返回。
 * 历史上的顺序语义（AI 应用测试要压过普通用例生成）用权重表达更准确：
 * ai-app-tester 的关键词更具体，自然会得高分。
 */
export const AGENT_RULES = [
  {
    agent: 'test-requirement-analyzer',
    name: '需求分析',
    desc: '分析需求、梳理业务、拆解验收标准',
    keywords: ['测试需求分析', '需求分析', '分析需求', '拆解需求', '测试需求', '需求梳理', '需求评审', '验收标准'],
    priority: 10,
  },
  {
    agent: 'test-scheme-generator',
    name: '测试方案生成',
    desc: '设计测试方案、制定测试策略与计划',
    keywords: ['测试方案生成', '测试方案', '方案设计', '制定方案', '测试策略', '测试计划', '测试规划'],
    priority: 9,
  },
  {
    agent: 'ai-app-tester',
    name: 'AI应用测试',
    desc: '测试 AI 应用：幻觉、提示注入、输出一致性、RAG 召回、工具调用合规',
    // 这些词本身就足够具体，无需 priority 加持
    keywords: ['ai应用测试', 'ai测试', 'ai助手', '大模型', 'llm', 'rag', '知识库问答', '智能体测试', '幻觉', '提示注入', '越狱', 'gpt', 'deepseek应用'],
    priority: 9,
  },
  {
    agent: 'test-case-generator',
    name: '测试用例生成',
    desc: '生成测试用例、设计测试场景',
    keywords: ['测试用例生成', '用例生成', '测试用例', '设计用例', '生成用例', '用例设计', '用例集', '测试场景', 'case'],
    priority: 8,
  },
  {
    agent: 'test-data-generator',
    name: '测试数据生成',
    desc: '准备测试数据、构造测试数据集',
    keywords: ['测试数据生成', '数据生成', '测试数据', '生成数据', '测试输入', '测试参数', '造数', '造数据'],
    priority: 8,
  },
  {
    agent: 'data-masking',
    name: '数据脱敏',
    desc: '处理数据脱敏、保护敏感信息',
    keywords: ['信息脱敏', '脱敏', '数据脱敏', '敏感信息', '隐私数据', '匿名化', '个人信息保护'],
    priority: 7,
  },
  {
    agent: 'api-executor',
    name: '接口测试',
    desc: '执行接口测试、接口自动化',
    keywords: ['接口测试', 'api测试', '接口用例', '接口自动化', '接口文档', '调接口', 'restful', '接口'],
    priority: 7,
  },
  {
    agent: 'ui-e2e-executor',
    name: 'UI/E2E测试',
    desc: '执行 UI/E2E 测试、页面自动化',
    keywords: ['ui/e2e测试', 'ui测试', '界面测试', '端到端', 'ui自动化', 'e2e测试', 'app自动化', '移动端测试', '安卓测试', 'ios测试', '鸿蒙测试', '手机e2e', '手机端回归', 'appium', 'xcuitest', '移动端e2e', '移动端回归测试'],
    priority: 7,
  },
  {
    agent: 'defect-analyzer',
    name: '缺陷分析',
    desc: '分析缺陷、定位 bug、生成缺陷报告',
    keywords: ['缺陷分析', '缺陷', 'bug', '分析失败', '根因', '复现步骤', '问题定位'],
    priority: 7,
  },
  {
    agent: 'test-reporter',
    name: '测试报告',
    desc: '生成测试报告、汇总测试结果',
    keywords: ['测试报告生成', '报告生成', '测试报告', '生成报告', '汇总测试', '结果汇总'],
    priority: 7,
  },
  {
    agent: 'test-script-generator',
    name: '自动化脚本生成',
    desc: '生成可执行的自动化测试脚本',
    keywords: ['自动化脚本', '生成脚本', '脚本生成', '写测试脚本', '生成测试脚本', 'jest脚本', 'playwright脚本', 'pytest脚本', 'newman脚本', 'cypress脚本', '生成自动化', '自动化代码'],
    priority: 8,
  },
  {
    agent: 'ai-quality-reviewer-1',
    name: 'AI质量审核',
    desc: '对交付物做质量/事实/安全/格式审核',
    keywords: ['ai质量审核', '质量审核', 'ai审核', '事实审核', '幻觉检测', '安全审核', '合规审核', '敏感词检测', '偏见检测', '格式审核', '结构审核', 'schema校验', '全面审核', '完整审核', '综合审核'],
    priority: 6,
  },
  {
    agent: 'ai-evaluation-agent',
    name: 'AI能力评估',
    desc: '评估智能体能力、输出质量与业务价值',
    keywords: ['智能体评估', '能力评估', 'ai评估', '质量评估', '性能评估', '智能体质量', '能力分析', '三层五级', '评估报告'],
    priority: 6,
  },
  {
    agent: 'security-sentinel',
    name: '安全测试',
    desc: '漏洞扫描、渗透测试、OWASP Top 10 检测',
    keywords: ['安全测试', '安全扫描', '漏洞扫描', '渗透测试', 'owasp', '安全检测', 'xss', 'sql注入', 'csrf', '安全审计', 'vulnerability scan', 'penetration test', 'security scan', 'sql 注入', '注入漏洞', '越权', '漏扫'],
    priority: 8,
  },
  {
    agent: 'performance-tester',
    name: '性能测试',
    desc: '执行性能压测、负载测试、瓶颈分析',
    keywords: ['性能测试', '负载测试', '压力测试', '并发测试', '稳定性测试', '压测', 'tps', 'benchmark', 'load test', 'stress test', 'performance test', 'jmeter', 'k6', 'locust'],
    priority: 8,
  },
  {
    agent: 'compatibility-coordinator',
    name: '兼容性测试',
    desc: '多端/多浏览器兼容性验证',
    keywords: ['浏览器兼容性', 'web兼容', '多浏览器测试', '浏览器矩阵', '分辨率适配', '响应式测试', '视觉回归', 'browser matrix', 'cross-browser', 'web compatibility', '兼容测试', '兼容性测试', '多端兼容', '跨平台测试'],
    priority: 8,
  },
];

/** 关键词权重：越长越具体，短词打折 */
function keywordWeight(kw) {
  const len = String(kw).length;
  if (len >= 6) return 3.0;
  if (len >= 5) return 2.6;
  if (len >= 4) return 2.2;
  if (len >= 3) return 1.6;
  // 2 字及以下（含英文短词）在自然语言里极常见，单独命中不足以定性。
  // 例外见 STRONG_SHORT_WORDS：有些 2 字词本身就是强信号
  // （「压测」「脱敏」「越狱」不会在别的语境里出现）。
  if (STRONG_SHORT_WORDS.has(String(kw).toLowerCase())) return 2.2;
  return 0.8;
}

/** 本身就是强信号的短词（出现在别的语境里几乎不可能） */
const STRONG_SHORT_WORDS = new Set([
  '压测', '脱敏', '越狱', '幻觉', '根因', '渗透', '漏扫',
  'rag', 'llm', 'owasp', 'xss', 'csrf', 'jmeter', 'locust',
]);

/**
 * 判断输入是不是「某个智能体已经产出的文档」
 *
 * 实测事故（任务 f9d85b49）：用户上传了上一轮生成的《测试需求分析报告》，
 * 想让系统据此生成测试用例。意图识别看到文档标题里的「测试需求分析」六个字
 * （权重 3.0），把任务派给了 **test-requirement-analyzer** —— 让它去分析
 * 「一份已经分析好的需求分析报告」，等于原地打转。
 *
 * 关键区分：
 *   用户说「帮我做需求分析」= 要从原始需求开始分析 → 需求分析智能体
 *   用户上传《需求分析报告》   = 上下游产物已在手上 → 应该往下一环节走
 *
 * 这段判定只做「排除」：识别到某个产出物特征时，把**产出该产物的智能体**
 * 从候选里降权，不强行指定下一个是谁（下游可能是用例、方案、执行…）。
 *
 * @param {string} input
 * @returns {Set<string>} 应该被降权的 agentId
 */
export function detectUpstreamArtifacts(input) {
  const text = String(input || '');
  const excluded = new Set();
  if (!text) return excluded;

  // 只在前 3000 字里找：用户上传的文档开头会带「=== 附件: xxx ===」声明，
  // 后面的大段正文里必然反复出现各类标题词，全篇扫描会误判。
  const head = text.slice(0, 3000);

  // 需求分析报告 → 不应再派给「需求分析」
  const isRequirementReport = /#\s*需求分析报告/.test(head)
    || /【需求分析报告】/.test(head)
    || (/功能需求清单/.test(head) && /FR-\d{3}/.test(head) && /非功能需求/.test(head));
  if (isRequirementReport) excluded.add('test-requirement-analyzer');

  // 测试方案 → 不应再派给「方案生成」
  const isScheme = /#\s*测试方案/.test(head)
    || (/测试策略/.test(head) && /准入|准出|测试范围/.test(head) && /测试资源/.test(head));
  if (isScheme) excluded.add('test-scheme-generator');

  // 测试用例集（表格带用例编号列）→ 不应再派给「用例生成」
  const isCaseSet = /#\s*测试用例[集清单]/.test(head)
    || (/用例编号/.test(head) && /执行步骤/.test(head) && /预期结果/.test(head));
  if (isCaseSet) excluded.add('test-case-generator');

  return excluded;
}

/** 英文词做词边界判断，避免 "case" 命中 "casey"、'rag' 命中 'storage' */
function isAsciiWord(kw) {
  return /^[a-z0-9/._-]+$/i.test(kw);
}

function hitKeyword(text, kw) {
  const k = String(kw).toLowerCase();
  if (!isAsciiWord(k)) {
    if (text.includes(k)) return true;
    // 中文与英文混排时用户可能加空格（「sql 注入」vs「sql注入」）：
    // 去掉两侧空格再试一次，避免因为一个空格漏掉强信号
    const compact = k.replace(/\s+/g, '');
    return compact !== k && text.replace(/\s+/g, '').includes(compact);
  }
  // 英文/混合短词要求两侧不是字母数字
  const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
  return re.test(text);
}

/**
 * 统计某关键词在文本中的出现次数
 *
 * 用于「主题词」判定：长文档里反复出现的词才是主题，
 * 只提一次的往往是顺带列举（实测：13509 字的报告里「测试用例」出现 5 次
 * 却没被判成主题，「兼容性测试」只提 1 次反而成了首选）。
 */
function countOccurrences(text, kw) {
  const k = String(kw).toLowerCase();
  if (!k) return 0;
  if (isAsciiWord(k)) {
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'gi');
    return (text.match(re) || []).length;
  }
  const compact = k.replace(/\s+/g, '');
  const hay = compact !== k ? text.replace(/\s+/g, '') : text;
  let n = 0;
  let i = hay.indexOf(compact);
  while (i >= 0 && n < 50) { n += 1; i = hay.indexOf(compact, i + compact.length); }
  return n;
}

/**
 * 给所有智能体打分
 *
 * 评分 = Σ(关键词权重 × 频次系数)
 *
 * 频次系数用对数饱和：出现 1 次记 1.0，2 次 1.35，5 次 1.7，封顶 2.0。
 *   - 不线性累加：「接口」在需求文档里天然出现几十次，线性累加会让
 *     api-executor 无脑胜出，与用户真实意图无关；
 *   - 也不能完全无视频次：长文档里「反复出现」才是主题信号
 *     （实测 13509 字的报告：测试用例×5 / 兼容性测试×1，前者才该是主题）。
 *
 * 同一智能体下若多个关键词重叠命中（「测试用例」与「测试用例生成」），
 * 只计最长的那个：否则长词天然覆盖短词，会把分数虚推很高。
 *
 * 文档长度修正：文档越长，「出现 1 次」的偶然性越大，所以短词（≤3 字）
 * 在长文档里进一步降权——它们更容易是列表里的顺手一提。
 *
 * @param {string} input
 * @returns {Array<{agent:string,name:string,desc:string,score:number,hits:string[]}>} 按分数降序
 */
export function scoreAgents(input) {
  const text = String(input || '').toLowerCase();
  if (!text) return [];
  // 长文本文档：超过 2000 字视为「用户上传的文档」而非一句话指令
  const isLongDoc = text.length > 2000;

  const scored = AGENT_RULES.map((rule) => {
    const hits = [];
    let score = 0;
    // 从长到短匹配，已命中的长词覆盖掉的短词不再计分
    const sorted = [...rule.keywords].sort((a, b) => b.length - a.length);
    const coveredBy = [];
    for (const kw of sorted) {
      const count = countOccurrences(text, kw);
      if (!count) continue;
      const k = kw.toLowerCase();
      // 已被更长的命中词包含 → 跳过
      if (coveredBy.some((longer) => longer.includes(k))) continue;
      coveredBy.push(k);
      hits.push(count > 1 ? `${kw}×${count}` : kw);

      let w = keywordWeight(kw);
      // 长文档里短词降权（减少「顺手一提」的干扰）
      if (isLongDoc && String(kw).length <= 3) w *= 0.6;
      // 频次系数：对数饱和，封顶 2.0
      const freqFactor = Math.min(2.0, 1 + Math.log2(count) * 0.5);
      score += w * freqFactor;
    }
    return { agent: rule.agent, name: rule.name, desc: rule.desc, score, hits, priority: rule.priority };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.priority - a.priority));
}

/**
 * 识别任务意图并给出置信度
 *
 * 置信度不是「分数高低」而是「领先程度」，因为任务描述可长可短：
 * 一句话描述可能只得 3 分却是压倒性的（其余为 0），
 * 而长文档每个智能体都能命中一堆词，5 分反而可能是噪声。
 *
 * 判定为「可自动确认」需同时满足：
 *   - 首选有 ≥1 个「长词命中」（权重 ≥2.2，即 ≥4 字），避免只靠「接口」「case」定性；
 *   - 首选分数 ≥ 次选 1.5 倍，或次选为 0（无竞争）。
 *
 * 不满足时返回 3 个候选交给用户选——用户的领域知识比关键词更可靠。
 *
 * @param {string} input 任务输入
 * @param {object} [opts]
 * @param {string} [opts.taskType] 显式任务类型（前端下拉选的，优先级最高）
 * @returns {{confident:boolean, agentId:string|null, agentName:string, confidence:number, candidates:Array, reason:string, actionKind:string}}
 */
export function analyzeTaskIntent(input, opts = {}) {
  const text = String(input || '');
  const taskType = opts.taskType || '';

  const empty = {
    confident: false,
    agentId: null,
    agentName: '',
    confidence: 0,
    candidates: [],
    reason: '',
    actionKind: detectActionKind(text),
  };

  // 显式任务类型：用户已经明确说了要做什么，不需要猜
  if (opts.explicitAgent) {
    const rule = AGENT_RULES.find((r) => r.agent === opts.explicitAgent);
    return {
      ...empty,
      confident: true,
      agentId: opts.explicitAgent,
      agentName: rule ? rule.name : opts.explicitAgent,
      confidence: 1,
      reason: '用户指定了智能体',
    };
  }

  let ranked = scoreAgents(text);

  // 上传的是某个智能体已经产出的文档 → 把「产出该文档的智能体」排除掉。
  // 实测任务 f9d85b49：上传《测试需求分析报告》被派给 test-requirement-analyzer，
  // 等于让它再分析一遍已经分析好的报告。用户要的是往下一环节走。
  const upstream = detectUpstreamArtifacts(text);
  let excludedUpstream = [];
  if (upstream.size && ranked.length) {
    const kept = ranked.filter((r) => !upstream.has(r.agent));
    // 只剩「产出方」一个候选时不排除：否则会变成零命中语义，
    // 用户可能真的是想重新分析一遍。
    if (kept.length) {
      excludedUpstream = ranked.filter((r) => upstream.has(r.agent)).map((r) => r.agent);
      ranked = kept;
    }
  }

  if (!ranked.length) {
    // 零命中时也必须给出候选：用户说的是「识别不准就给 3 个选项」，
    // 一个选项都没有等于直接甩给通用智能体，比现在更糟。
    // 按常见任务频次给默认三选一（通常用户是来生成用例/方案/分析需求的）。
    const defaults = ['test-case-generator', 'test-requirement-analyzer', 'test-scheme-generator'];
    const candidates = defaults.map((id) => {
      const r = AGENT_RULES.find((x) => x.agent === id);
      return { agentId: id, agentName: r ? r.name : id, desc: r ? r.desc : '', score: 0, hits: [] };
    });
    return {
      ...empty,
      candidates,
      reason: '没有识别到任何测试意图关键词，请确认要做什么',
    };
  }

  const top = ranked[0];
  const second = ranked[1] || { score: 0 };
  const lead = second.score ? top.score / second.score : Infinity;
  const upstreamNote = excludedUpstream.length
    ? `（输入看起来是已完成的产出物：${excludedUpstream.map((id) => (AGENT_RULES.find((r) => r.agent === id) || {}).name || id).join('、')}，已排除对应智能体）`
    : '';

  // 是否有「长词」支撑：只有短词命中时不敢自动定性
  const hasStrongHit = top.hits.some((kw) => keywordWeight(kw) >= 2.2);

  let confident = hasStrongHit && lead >= 1.5;

  // 显式 taskType 兜底：前端选了任务类型但输入没关键词时，按类型走
  let agentId = top.agent;
  let agentName = top.name;
  let reason = '';
  if (confident) {
    reason = `命中「${top.hits.slice(0, 3).join('、')}」，领先次选 ${second.score ? `${lead.toFixed(1)} 倍` : '（无竞争）'}${upstreamNote}`;
  } else if (!hasStrongHit) {
    reason = `只命中短词「${top.hits.join('、')}」，不足以确定任务类型${upstreamNote}`;
    // 只命中短词且 taskType 已知 → 用 taskType 兜底
    if (taskType && TASK_TYPE_AGENT[taskType]) {
      agentId = TASK_TYPE_AGENT[taskType];
      const r = AGENT_RULES.find((x) => x.agent === agentId);
      agentName = r ? r.name : agentId;
      confident = true;
      reason = `按任务类型「${taskType}」确定为${agentName}${upstreamNote}`;
    }
  } else {
    reason = `「${top.name}」与「${second.name}」得分接近（${top.score.toFixed(1)} vs ${second.score.toFixed(1)}）${upstreamNote}`;
  }

  // 3 个候选：至少填满到 3 个（从全部规则里补，让用户能改选）
  const candidates = [...ranked].slice(0, 3).map((s) => ({
    agentId: s.agent,
    agentName: s.name,
    desc: s.desc,
    score: Number(s.score.toFixed(2)),
    hits: s.hits.slice(0, 4),
  }));
  if (candidates.length < 3) {
    const have = new Set(candidates.map((c) => c.agentId));
    for (const rule of AGENT_RULES) {
      if (candidates.length >= 3) break;
      if (have.has(rule.agent)) continue;
      candidates.push({ agentId: rule.agent, agentName: rule.name, desc: rule.desc, score: 0, hits: [] });
      have.add(rule.agent);
    }
  }

  return {
    confident,
    agentId,
    agentName,
    confidence: Number((second.score ? Math.min(1, (top.score - second.score) / top.score) : 1).toFixed(2)),
    candidates,
    reason,
    actionKind: detectActionKind(text),
  };
}

/** 显式任务类型 → 智能体（与 server.js 的 TASK_AGENT_MAP 保持一致的表） */
const TASK_TYPE_AGENT = {
  'requirement-analysis': 'test-requirement-analyzer',
  'test-case-design': 'test-case-generator',
  'ai-app-test': 'ai-app-tester',
  'test-data-preparation': 'test-data-generator',
  'defect-analysis': 'defect-analyzer',
  'api-test': 'api-executor',
  'ui-e2e-test': 'ui-e2e-executor',
  'report-generation': 'test-reporter',
  'data-masking': 'data-masking',
  'test-scheme-design': 'test-scheme-generator',
  'script-generation': 'test-script-generator',
  'evaluation': 'ai-evaluation-agent',
  'security-test': 'security-sentinel',
  'performance-test': 'performance-tester',
  'web-compatibility-test': 'compatibility-coordinator',
};

/**
 * 动作类型：用户是想「产出东西」还是「问问题」
 *
 * 与智能体选择是两件事：同一个智能体既能被要求生成，也能被提问。
 * 现在的任务提交只支持「产出」，用户问一句「这个需求该怎么测」也会跑一次完整生成。
 */
export function detectActionKind(text) {
  const t = String(text || '').trim();
  if (!t) return 'generate';

  const isQuestion = /[?？]\s*$/.test(t)
    || /为什么|为啥|怎么没|怎么回事|什么原因|是不是|是否|能否|可否|如何|怎么(样|做|办)|哪里|哪儿|有没有|解释/.test(t);
  const hasAction = /生成|产出|输出|写一?份|做一?份|设计|创建|新建|补充|整理|汇总|分析|执行|跑一?遍|测一?下/.test(t);

  if (isQuestion && !hasAction) return 'question';
  if (isQuestion && hasAction) return 'mixed';
  return 'generate';
}

export default {
  AGENT_RULES,
  scoreAgents,
  analyzeTaskIntent,
  detectActionKind,
};
