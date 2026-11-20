/**
 * 经验归一化（2026-11-20）
 *
 * 平台每天产出大量质量信号（审核员 issues、门禁缺陷分布、人工标注），
 * 但这些信号只用于「判定这一次过不过」，从不影响「下一次怎么写」。
 * 本模块负责把信号归一成可复用的「经验条目」。
 *
 * 设计要点：
 *   1. **归一化签名**：同一条问题在不同任务里措辞千差万别
 *      （「预期结果不可判定，只写返回200」「预期结果只写状态码未给字段」），
 *      必须归成同一个 pattern_key，否则永远去重不起来、也数不清频次。
 *   2. **只产出可执行的 guidance**：不写「要注意质量」这种废话，
 *      每一条都要能直接告诉模型「改成什么样」。
 *   3. **不编造**：从真实 issue 抽，抽不出就跳过，宁可少一条经验。
 */

/** 问题类别 → 一句话说明模板 */
const CATEGORY_META = {
  assertion: {
    label: '预期结果不可判定',
    guidance: '预期结果必须写出可观测证据：HTTP 状态码 / 具体字段名与值（如 code=0、data.phone="13800138000"）/ 引号包裹的原文案 / 跳转目标 / 数值或计数变化。禁止只写「正常」「成功」「符合预期」「展示正确」。',
  },
  placeholder: {
    label: '输入数据是占位值',
    guidance: '输入数据必须是符合业务规则的真实值：手机号用 13800138000 这类 11 位号码、验证码用 6 位数字；长度边界用例要给精确长度的值（如「256 字符」就写 256 个字符），不能用 AAAA、xxx、10位数字 这类占位。',
  },
  duplicate: {
    label: '用例重复',
    guidance: '同一业务规则只出一条用例；若一条用例同时覆盖多种设计方法，在「维度」列合并标注（如「② 数据 / 等价类划分法+边界值分析法」），不要拆成多条相似用例。',
  },
  coverage: {
    label: '覆盖不足',
    guidance: '必须覆盖九维必测点与全部需求编号：每条需求都要有对应用例；某维度确实不适用时，必须在「豁免声明」表里写明原因，否则按漏测处理。',
  },
  format: {
    label: '格式/结构不合规',
    guidance: '按输出模板填写：「维度」列写「维度 / 设计方法」、「层级」列只能是 正常/边界/异常，表格列不得错位、不得留空必填项。',
  },
  logic: {
    label: '预期与需求矛盾',
    guidance: '预期结果必须与原始需求一致；需求里的数值/规则（如「5 次锁定」「30 分钟」）不得改动。若发现需求本身有缺口，在「豁免声明」或问题清单里标注「上游缺失」，不要自行编造。',
  },
  traceability: {
    label: '跨环节承接断裂',
    guidance: '上游环节已明确的需求编号、接口名、规则数值必须完整承接；新增内容若不在原始需求中，必须标注来源或删除。',
  },
  other: {
    label: '其他问题',
    guidance: '按审核意见逐条修正，不要把问题留到下一轮。',
  },
};

export function normalizeCategory(raw) {
  const c = String(raw || '').toLowerCase();
  if (CATEGORY_META[c]) return c;
  // 兼容审核员/门禁的不同叫法
  if (/assert|断言|可判定|weak/.test(c)) return 'assertion';
  if (/placeholder|占位/.test(c)) return 'placeholder';
  if (/duplicat|重复/.test(c)) return 'duplicate';
  if (/cover|覆盖|missing|维度/.test(c)) return 'coverage';
  if (/format|格式|结构/.test(c)) return 'format';
  if (/logic|矛盾|冲突/.test(c)) return 'logic';
  if (/trace|承接|上游/.test(c)) return 'traceability';
  return 'other';
}

/** 门禁的 byReason 键 → 类别 */
const GATE_REASON_MAP = {
  weakAssertion: 'assertion',
  placeholderInput: 'placeholder',
  duplicateCase: 'duplicate',
  orphanRequirement: 'traceability',
  badSteps: 'format',
  missingField: 'format',
  missingDimension: 'coverage',
  missingMethod: 'coverage',
  missingLayer: 'coverage',
  unverifiable: 'assertion',
};

export function gateReasonToCategory(reasonKey) {
  return GATE_REASON_MAP[reasonKey] || normalizeCategory(reasonKey);
}

/**
 * 从一条文本描述里抽出「归一化签名」
 *
 * 目标：同一类问题在不同任务里措辞不同，但签名要一致。
 * 做法：去掉用例编号、具体字段值、数字、标点，只留结构性表述。
 *
 * @returns {string} 长度受控的签名（用于 pattern_key）
 */
export function patternSignature(text) {
  let s = String(text || '')
    .toLowerCase()
    // 用例/需求编号：TC-001 / FR-012 / IT-API-001-01
    .replace(/\b(?:tc|fr|nfr|api|it)[-_ ]?[a-z0-9-]*\d+[a-z0-9-]*/g, ' ')
    // 引号内的具体内容
    .replace(/[「『“"'][^「』”"']{0,60}[」』”"']/g, ' ')
    // 字段名=值
    .replace(/[a-z_][a-z0-9_]{1,30}\s*=\s*\S+/g, ' ')
    // 纯数字
    .replace(/\d+/g, ' ')
    // 标点与多余空白
    .replace(/[，。；、：:,.;()（）\[\]【】|/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, 120);
}

/**
 * 把审核员的一条 issue 归一成经验候选
 *
 * @param {Object} issue 审核员输出里的 issue：{severity,category,dimension,caseId,description,suggestion}
 * @returns {{category,patternKey,title,guidance,sample}|null}
 */
export function experienceFromReviewIssue(issue) {
  if (!issue || typeof issue !== 'object') return null;
  const desc = String(issue.description || '').trim();
  if (desc.length < 4) return null;

  const category = normalizeCategory(issue.category);
  const sig = patternSignature(desc);
  // 签名太短说明信息量不足（只有「不符合要求」这类），不建经验
  if (sig.length < 6) return null;

  const meta = CATEGORY_META[category];
  // 审核员给了 suggestion 就用它的信息补充 guidance（更贴合这条真实问题）
  const extra = String(issue.suggestion || '').trim();
  let guidance = meta.guidance;
  if (extra && extra.length >= 6 && extra.length <= 200) {
    guidance = `${meta.guidance}（本轮具体建议：${extra}）`;
  }

  return {
    category,
    // 签名带上类别，避免不同类别撞同一个 key。
    //
    // 用「类别 + 细分特征」而不是整句签名：同一类问题在不同任务里措辞差别很大
    // （「预期结果不可判定，只写返回200」vs「预期结果只写状态码未给字段」），
    // 整句签名会导致每条都新建一条经验，永远统计不到频次，也就无法判断有没有效果。
    // 细分特征取该类别下的关键判别词，无特征时归到 `general`。
    patternKey: `${category}:${subPattern(category, sig)}`.slice(0, 160),
    title: `${meta.label}：${desc.slice(0, 60)}`,
    guidance,
    sample: desc.slice(0, 200),
  };
}

/**
 * 类别内的细分特征
 *
 * 为什么需要：经验要能「累计频次」才有意义。如果每条 issue 都新建一条经验，
 * 永远只有 1 次，既判断不出是否高频，也判断不出注入后有没有减少。
 *
 * @returns {string} 细分键（同一类别下的稳定分组）
 */
export function subPattern(category, sig) {
  const s = String(sig || '');
  const has = (...words) => words.some((w) => s.includes(w));

  switch (category) {
    case 'assertion':
      if (has('状态码', '状态', 'status')) return 'status-only';
      if (has('字段', 'field')) return 'missing-field';
      if (has('文案', 'text', '提示')) return 'missing-text';
      return 'general';
    case 'placeholder':
      if (has('长度', '位')) return 'length-placeholder';
      if (has('手机', 'phone', '验证码', 'code')) return 'value-placeholder';
      return 'general';
    case 'duplicate':
      return 'general';
    case 'coverage':
      if (has('维度', 'dimension')) return 'dimension';
      if (has('需求', 'requirement', 'fr')) return 'requirement';
      if (has('层级', 'layer')) return 'layer';
      return 'general';
    case 'format':
      if (has('步骤', 'step')) return 'bad-steps';
      if (has('列', '表头', '表格')) return 'table';
      if (has('空', '缺', 'missing', '留空')) return 'missing-field';
      return 'general';
    case 'logic':
      if (has('数值', '次数', '时间', '上限')) return 'value-conflict';
      return 'general';
    case 'traceability':
      if (has('上游', 'upstream')) return 'upstream-gap';
      if (has('需求', 'requirement')) return 'requirement-drift';
      return 'general';
    default:
      return 'general';
  }
}

/**
 * 把门禁的缺陷原因归一成经验候选
 *
 * @param {string} reasonKey 门禁 byReason 的键
 * @param {number} count 该原因的用例数
 * @param {string} [sampleCaseId]
 */
export function experienceFromGateReason(reasonKey, count = 0, sampleCaseId = '') {
  const category = gateReasonToCategory(reasonKey);
  if (category === 'other' && !CATEGORY_META[reasonKey]) {
    // 不认识的门禁原因不建经验，避免污染
    if (!reasonKey) return null;
  }
  const meta = CATEGORY_META[category];
  if (!meta) return null;
  return {
    category,
    // 门禁原因本身已经是细分的（weakAssertion / missingDimension …），直接用
    patternKey: `${category}:gate:${String(reasonKey).slice(0, 100)}`,
    title: `${meta.label}（门禁统计：${reasonKey}${count ? `，本轮 ${count} 条` : ''}）`,
    guidance: meta.guidance,
    sample: sampleCaseId ? `例：${sampleCaseId}` : '',
  };
}

/** 对外暴露类别元信息（前端看板用） */
export function categoryMeta(category) {
  return CATEGORY_META[normalizeCategory(category)] || CATEGORY_META.other;
}

export const KNOWN_CATEGORIES = Object.keys(CATEGORY_META);
