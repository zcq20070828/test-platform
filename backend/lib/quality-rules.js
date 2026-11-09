/**
 * 按智能体区分的确定性质量规则（2026-11-06 · 阶段四 4.3）
 *
 * 之前只有 test-case-generator 有确定性检查（因为它有可解析的用例表）。
 * 其他交付物（需求分析、测试方案、执行报告、缺陷报告…）没有可解析的统一表格，
 * 就用「结构 + 要素 + 反编造」三类规则来查：
 *
 *   - section   ：必须出现的章节
 *   - table     ：必须存在的表格及其列
 *   - pattern   ：必须出现的可验证要素（编号、状态码、复现步骤…）
 *   - forbid    ：禁止出现的编造/占位痕迹
 *
 * 全部是规则可判定的，不调用 LLM；结果可复现、可审计。
 * 输出结构与 case-quality-gate 对齐，便于复用同一套落库/广播/门禁逻辑。
 */

// ============================================================
// 规则原语
// ============================================================

function hasSection(text, patterns) {
  return patterns.some((p) => p.test(text));
}

function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * 找出含指定列的表格，返回**最大**数据行数（表头行之后的非分隔行）
 *
 * 注意：不能在离开表格时把计数清零——文档末尾的空行会触发「离开表格」，
 * 那样最后一行的统计会被丢弃（早期实现踩过这个坑）。
 */
function tableRowsWithColumns(text, columns) {
  const lines = String(text || '').split(/\r?\n/);
  let inTable = false;
  let matched = false;
  let rows = 0;
  let best = 0;

  const closeTable = () => {
    if (matched && rows > best) best = rows;
    inTable = false;
    matched = false;
    rows = 0;
  };

  for (const line of lines) {
    if (!/^\s*\|.*\|\s*$/.test(line)) { closeTable(); continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (!inTable) {
      inTable = true;
      matched = columns.every((col) => cells.some((c) => c === col || c.includes(col)));
      rows = 0;
      continue;
    }
    if (/^[-:\s|]+$/.test(cells.join(''))) continue;
    if (matched) rows += 1;
  }
  closeTable();
  return best;
}

/** 是否包含指定表格（不要求行数） */
function hasTableWithColumns(text, columns) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!/^\s*\|.*\|\s*$/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (columns.every((col) => cells.some((c) => c === col || c.includes(col)))) return true;
  }
  return false;
}

/** 表格里某列的去重值（用于校验编号唯一性） */
function columnValues(text, columnName) {
  const lines = String(text || '').split(/\r?\n/);
  const values = [];
  let idx = -1;
  for (const line of lines) {
    if (!/^\s*\|.*\|\s*$/.test(line)) { idx = -1; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (idx === -1) {
      idx = cells.findIndex((c) => c === columnName || c.includes(columnName));
      continue;
    }
    if (/^[-:\s|]+$/.test(cells.join(''))) continue;
    if (idx >= 0 && cells[idx]) values.push(cells[idx]);
  }
  return values;
}

// ============================================================
// 各智能体的规则集
// ============================================================

const RULES = {
  'test-requirement-analyzer': [
    {
      id: 'hasFunctionalList',
      category: 'structure',
      severity: 'blocker',
      weight: 25,
      desc: '缺少「功能需求清单」或需求表格',
      check: (t) => hasTableWithColumns(t, ['需求编号']) && tableRowsWithColumns(t, ['需求编号']) >= 1,
    },
    {
      id: 'hasNonFunctional',
      category: 'coverage',
      severity: 'major',
      weight: 15,
      desc: '未识别非功能需求（性能/安全/兼容性等）',
      check: (t) => /非功能需求|性能需求|安全需求|兼容性需求/.test(t),
    },
    {
      id: 'hasAcceptance',
      category: 'coverage',
      severity: 'major',
      weight: 15,
      desc: '未给出验收标准或可测试性判断',
      check: (t) => /验收标准|可测试性|测试要点/.test(t),
    },
    {
      id: 'traceability',
      category: 'traceability',
      severity: 'major',
      weight: 15,
      desc: '缺少需求追溯矩阵或追溯说明',
      check: (t) => /追溯矩阵|需求追溯|追溯关系/.test(t),
    },
    {
      id: 'noPlaceholderIds',
      category: 'fabrication',
      severity: 'blocker',
      weight: 20,
      desc: '需求编号使用占位符（如 FR-xxx）而非真实编号',
      check: (t) => countMatches(t, /\b(?:FR|NFR|API)-x{2,}\b/gi) === 0,
    },
    {
      id: 'noInventedApi',
      category: 'fabrication',
      severity: 'major',
      weight: 10,
      desc: '接口清单为空却出现接口测试断言',
      check: (t) => {
        const hasApiTable = hasTableWithColumns(t, ['接口编号']);
        const mentionsApiTest = /接口测试|API\s*测试/i.test(t);
        return !(mentionsApiTest && !hasApiTable && !/API-\d+/.test(t));
      },
    },
  ],

  'test-scheme-generator': [
    {
      id: 'hasStrategy',
      category: 'structure',
      severity: 'blocker',
      weight: 30,
      desc: '缺少测试策略章节',
      check: (t) => /测试策略|测试方法|测试类型/.test(t),
    },
    {
      id: 'hasResource',
      category: 'structure',
      severity: 'major',
      weight: 20,
      desc: '缺少测试资源（人力/环境/工具）说明',
      check: (t) => /测试资源|人力资源|测试环境|测试工具/.test(t),
    },
    {
      id: 'hasCriteria',
      category: 'structure',
      severity: 'blocker',
      weight: 25,
      desc: '缺少准入/准出标准',
      check: (t) => /准入|准出|启动条件|结束条件/.test(t),
    },
    {
      id: 'noVagueRisk',
      category: 'fabrication',
      severity: 'major',
      weight: 15,
      desc: '风险项只写「存在风险」而无应对措施',
      check: (t) => {
        const hasRisk = /风险/.test(t);
        if (!hasRisk) return true;
        return /应对措施|缓解措施|规避|应急预案|风险应对/.test(t);
      },
    },
    {
      id: 'quantifiedEstimate',
      category: 'evidence',
      severity: 'major',
      weight: 10,
      desc: '工作量/工期无量化数字',
      check: (t) => /\d+\s*(?:人天|人日|小时|天|周|工作日)/.test(t),
    },
  ],

  'test-data-generator': [
    {
      id: 'hasDataTable',
      category: 'structure',
      severity: 'blocker',
      weight: 35,
      desc: '缺少测试数据清单表格',
      check: (t) => hasTableWithColumns(t, ['数据编号']) || hasTableWithColumns(t, ['数据名称']),
    },
    {
      id: 'hasEnoughRows',
      category: 'coverage',
      severity: 'major',
      weight: 20,
      desc: '数据条目少于 3 条，覆盖不足',
      check: (t) => tableRowsWithColumns(t, ['数据编号']) >= 3 || tableRowsWithColumns(t, ['数据名称']) >= 3,
    },
    {
      id: 'hasMasking',
      category: 'compliance',
      severity: 'blocker',
      weight: 30,
      desc: '未说明脱敏状态或脱敏规则',
      check: (t) => /脱敏/.test(t),
    },
    {
      id: 'noRawSensitive',
      category: 'compliance',
      severity: 'blocker',
      weight: 15,
      desc: '出现疑似未脱敏的真实手机号',
      check: (t) => countMatches(t, /(?<!\d)1[3-9]\d{9}(?!\d)/g) === 0,
    },
  ],

  'api-executor': [
    {
      id: 'hasCaseTable',
      category: 'structure',
      severity: 'blocker',
      weight: 30,
      desc: '缺少用例执行记录表格',
      check: (t) => (hasTableWithColumns(t, ['用例编号']) && tableRowsWithColumns(t, ['用例编号']) >= 1),
    },
    {
      id: 'hasRealStatus',
      category: 'evidence',
      severity: 'blocker',
      weight: 30,
      desc: '未出现真实 HTTP 状态码，疑似未真实执行',
      check: (t) => countMatches(t, /\b[1-5]\d{2}\b/g) >= 2,
    },
    {
      id: 'hasResultColumn',
      category: 'structure',
      severity: 'major',
      weight: 20,
      desc: '缺少执行结果/状态列',
      check: (t) => hasTableWithColumns(t, ['执行结果']) || hasTableWithColumns(t, ['状态']),
    },
    {
      id: 'noFabricatedPass',
      category: 'fabrication',
      severity: 'blocker',
      weight: 20,
      desc: '声称全部通过但没有任何请求证据（URL/方法）',
      check: (t) => {
        const claimsAllPass = /全部通过|100%\s*(?:通过|成功)/.test(t);
        if (!claimsAllPass) return true;
        return /(?:GET|POST|PUT|DELETE|PATCH)\s+\/|https?:\/\//.test(t);
      },
    },
  ],

  'ui-e2e-executor': [
    {
      id: 'hasCaseTable',
      category: 'structure',
      severity: 'blocker',
      weight: 25,
      desc: '缺少用例执行记录表格',
      check: (t) => hasTableWithColumns(t, ['用例编号']) && tableRowsWithColumns(t, ['用例编号']) >= 1,
    },
    {
      id: 'hasEvidence',
      category: 'evidence',
      severity: 'blocker',
      weight: 30,
      desc: '未出现截图/日志等执行证据',
      check: (t) => /截图|screenshot|日志|console|trace/.test(t),
    },
    {
      id: 'hasResultColumn',
      category: 'structure',
      severity: 'major',
      weight: 20,
      desc: '缺少执行结果/状态列',
      check: (t) => hasTableWithColumns(t, ['执行结果']) || hasTableWithColumns(t, ['状态']),
    },
    {
      id: 'noFabricatedPass',
      category: 'fabrication',
      severity: 'blocker',
      weight: 25,
      desc: '声称通过但没有可访问的目标地址',
      check: (t) => {
        const claims = /通过|成功/.test(t);
        if (!claims) return true;
        return /https?:\/\/|localhost/.test(t);
      },
    },
  ],

  'defect-analyzer': [
    {
      id: 'hasDefectId',
      category: 'structure',
      severity: 'blocker',
      weight: 25,
      desc: '缺少规范的缺陷编号（BUG-xxx）',
      check: (t) => /BUG-\d+/.test(t),
    },
    {
      id: 'hasReproSteps',
      category: 'structure',
      severity: 'blocker',
      weight: 25,
      desc: '缺少复现步骤',
      check: (t) => /复现步骤|重现步骤|Steps to reproduce/i.test(t),
    },
    {
      id: 'hasRootCause',
      category: 'evidence',
      severity: 'blocker',
      weight: 30,
      desc: '缺少根因分析',
      check: (t) => /根因|root\s*cause/i.test(t),
    },
    {
      id: 'hasSeverity',
      category: 'structure',
      severity: 'major',
      weight: 20,
      desc: '缺少严重程度/优先级判定',
      check: (t) => /严重程度|严重级别|优先级/.test(t),
    },
  ],

  'test-reporter': [
    {
      id: 'hasStatsTable',
      category: 'structure',
      severity: 'blocker',
      weight: 30,
      desc: '缺少测试数据统计表',
      check: (t) => /总用例数|用例总数|执行数/.test(t),
    },
    {
      id: 'hasNumbers',
      category: 'evidence',
      severity: 'blocker',
      weight: 30,
      desc: '统计无具体数字，疑似未基于真实结果',
      check: (t) => countMatches(t, /\d+/g) >= 5,
    },
    {
      id: 'hasConclusion',
      category: 'structure',
      severity: 'major',
      weight: 20,
      desc: '缺少测试结论',
      check: (t) => /测试结论|总体结论|结论/.test(t),
    },
    {
      id: 'noFakeScore',
      category: 'fabrication',
      severity: 'blocker',
      weight: 20,
      desc: '给出精确质量评分但无计算依据',
      check: (t) => {
        const hasScore = /(?:质量|综合)\s*评分[:：]\s*\d+/.test(t);
        if (!hasScore) return true;
        return /计算公式|权重|依据|指标/.test(t);
      },
    },
  ],

  'data-masking': [
    {
      id: 'hasRecords',
      category: 'structure',
      severity: 'blocker',
      weight: 30,
      desc: '缺少脱敏记录（字段 + 脱敏方式）',
      check: (t) => /字段/.test(t) && (hasTableWithColumns(t, ['字段']) || /脱敏方式|脱敏方法|掩码/.test(t)),
    },
    {
      id: 'hasRule',
      category: 'structure',
      severity: 'blocker',
      weight: 30,
      desc: '未说明具体脱敏规则',
      check: (t) => /掩码|替换|哈希|加密|屏蔽|\*{2,}/.test(t),
    },
    {
      id: 'noRawSensitive',
      category: 'compliance',
      severity: 'blocker',
      weight: 40,
      desc: '仍存在未脱敏的真实手机号/身份证',
      check: (t) => countMatches(t, /(?<!\d)1[3-9]\d{9}(?!\d)/g) === 0
        && countMatches(t, /(?<!\d)\d{17}[\dXx](?!\d)/g) === 0,
    },
  ],

  'security-sentinel': [
    {
      id: 'hasFindingsTable',
      category: 'structure',
      severity: 'blocker',
      weight: 30,
      desc: '缺少漏洞/发现清单表格',
      check: (t) => hasTableWithColumns(t, ['严重度']) || hasTableWithColumns(t, ['风险等级']) || hasTableWithColumns(t, ['漏洞']),
    },
    {
      id: 'hasSeverity',
      category: 'structure',
      severity: 'blocker',
      weight: 25,
      desc: '缺少风险等级判定',
      check: (t) => /严重|高危|中危|低危|critical|high|medium|low/i.test(t),
    },
    {
      id: 'hasEvidence',
      category: 'evidence',
      severity: 'blocker',
      weight: 30,
      desc: '缺少扫描工具或验证证据',
      check: (t) => /semgrep|trivy|nuclei|nmap|nikto|bandit|gitleaks|扫描|PoC|复现/i.test(t),
    },
    {
      id: 'noInventedCve',
      category: 'fabrication',
      severity: 'major',
      weight: 15,
      desc: '出现 CVE 编号但无对应验证说明',
      check: (t) => {
        const cves = countMatches(t, /CVE-\d{4}-\d{4,}/g);
        if (cves === 0) return true;
        return /验证|复现|影响版本|poc/i.test(t);
      },
    },
  ],

  'performance-tester': [
    {
      id: 'hasMetrics',
      category: 'evidence',
      severity: 'blocker',
      weight: 35,
      desc: '缺少性能指标（TPS/RT/错误率）',
      check: (t) => /tps|qps|响应时间|rt\b|错误率|吞吐/i.test(t),
    },
    {
      id: 'hasNumbers',
      category: 'evidence',
      severity: 'blocker',
      weight: 30,
      desc: '指标无具体数值',
      check: (t) => countMatches(t, /\d+(?:\.\d+)?\s*(?:ms|s|秒|tps|qps|%)/gi) >= 3,
    },
    {
      id: 'hasToolEvidence',
      category: 'evidence',
      severity: 'major',
      weight: 20,
      desc: '缺少压测工具或脚本执行证据',
      check: (t) => /jmeter|k6|locust|压测脚本|并发数/.test(t),
    },
    {
      id: 'hasConclusion',
      category: 'structure',
      severity: 'major',
      weight: 15,
      desc: '缺少性能结论或瓶颈分析',
      check: (t) => /瓶颈|结论|建议/.test(t),
    },
  ],

  'compatibility-coordinator': [
    {
      id: 'hasMatrix',
      category: 'structure',
      severity: 'blocker',
      weight: 35,
      desc: '缺少兼容性矩阵结果',
      check: (t) => /浏览器|platform|视口|分辨率|矩阵/.test(t),
    },
    {
      id: 'hasResults',
      category: 'structure',
      severity: 'blocker',
      weight: 35,
      desc: '缺少逐项通过/失败结果',
      check: (t) => /通过|失败/.test(t) && hasTableWithColumns(t, ['状态']) || hasTableWithColumns(t, ['结果']),
    },
    {
      id: 'hasEvidence',
      category: 'evidence',
      severity: 'major',
      weight: 30,
      desc: '缺少控制台错误/请求失败等证据',
      check: (t) => /控制台|console|请求失败|错误/.test(t),
    },
  ],

  'test-script-generator': [
    {
      id: 'hasCodeBlock',
      category: 'structure',
      severity: 'blocker',
      weight: 40,
      desc: '未产出可执行脚本代码块',
      check: (t) => /```(?:js|javascript|ts|typescript|python|py|java|sh|bash)/i.test(t),
    },
    {
      id: 'hasAssertion',
      category: 'evidence',
      severity: 'blocker',
      weight: 35,
      desc: '脚本中缺少断言语句',
      check: (t) => /expect\(|assert|should\.|Assert\.|assertEquals|toBe\(/.test(t),
    },
    {
      id: 'hasFrameworkHint',
      category: 'structure',
      severity: 'major',
      weight: 25,
      desc: '未说明所用测试框架',
      check: (t) => /jest|vitest|playwright|pytest|cypress|junit|testng|newman/i.test(t),
    },
  ],
};

/**
 * 取某智能体的规则集（无配置时返回 null，表示不做确定性检查）
 * @param {string} agentId
 * @returns {Array|null}
 */
export function getRulesFor(agentId) {
  return RULES[agentId] || null;
}

/** 支持确定性检查的智能体列表 */
export function listRuleAgents() {
  return Object.keys(RULES);
}

// ============================================================
// 执行检查
// ============================================================

/**
 * 按规则集检查交付物
 *
 * @param {string} agentId
 * @param {string} text - 交付物正文
 * @param {Object} [options]
 * @param {number} [options.minPassRate=0.8] - 通过阈值（按权重）
 * @returns {Object} 与 case-quality-gate 对齐的结构
 */
export function checkWithRules(agentId, text, options = {}) {
  const rules = getRulesFor(agentId);
  const minPassRate = Number(options.minPassRate ?? 0.8);

  if (!rules || !rules.length) {
    return {
      applicable: false,
      reason: `智能体 ${agentId} 未配置确定性规则`,
      agentId,
      total: 0,
      usable: 0,
      usabilityRate: 1,
      pass: true,
      minUsabilityRate: minPassRate,
      bySeverity: { blocker: 0, major: 0, minor: 0 },
      byReason: {},
      cases: [],
      repairs: [],
      needsAssertion: [],
      summary: { reason: '不适用' },
    };
  }

  const body = String(text || '');
  if (!body.trim()) {
    return {
      applicable: true,
      agentId,
      total: rules.length,
      usable: 0,
      usabilityRate: 0,
      pass: false,
      minUsabilityRate: minPassRate,
      bySeverity: { blocker: rules.length, major: 0, minor: 0 },
      byReason: { empty: rules.length },
      cases: rules.map((r) => ({ id: r.id, usable: false, reasons: ['empty'], detail: r.desc })),
      repairs: [],
      needsAssertion: [],
      summary: { text: '交付物为空', verdict: '交付物为空', issues: ['交付物为空'] },
    };
  }

  const totalWeight = rules.reduce((a, r) => a + r.weight, 0);
  let passedWeight = 0;
  const failed = [];
  const bySeverity = { blocker: 0, major: 0, minor: 0 };
  const byReason = {};

  for (const rule of rules) {
    let ok = false;
    try {
      ok = rule.check(body) === true;
    } catch (_) {
      ok = false;  // 规则自身异常按未通过处理，避免静默放行
    }
    if (ok) {
      passedWeight += rule.weight;
    } else {
      failed.push({
        id: rule.id,
        usable: false,
        reasons: [rule.category],
        detail: rule.desc,
        severity: rule.severity,
      });
      bySeverity[rule.severity] = (bySeverity[rule.severity] || 0) + 1;
      byReason[rule.category] = (byReason[rule.category] || 0) + 1;
    }
  }

  const usabilityRate = Math.round((passedWeight / totalWeight) * 1000) / 1000;
  // blocker 级规则一旦未通过即整体不通过：权重只用于算分数，
  // 不能让「占位编号」「未脱敏」这类硬伤靠其他规则拿分达标。
  const hasBlockerFailure = failed.some((f) => f.severity === 'blocker');
  const pass = usabilityRate >= minPassRate && !hasBlockerFailure;
  const issues = failed.map((f) => `${f.detail}（${f.id}）`);

  return {
    applicable: true,
    agentId,
    total: rules.length,
    usable: rules.length - failed.length,
    usabilityRate,
    pass,
    minUsabilityRate: minPassRate,
    bySeverity,
    byReason,
    cases: failed,
    repairs: [],
    needsAssertion: [],
    summary: {
      text: `${pass ? '通过' : '未通过'}（权重得分 ${(usabilityRate * 100).toFixed(1)}%，阈值 ${(minPassRate * 100).toFixed(0)}%${hasBlockerFailure ? '，存在阻断级问题' : ''}）${issues.length ? `；问题：${issues.join('；')}` : ''}`,
      verdict: pass ? '达标' : (hasBlockerFailure ? '存在阻断级问题' : '未达标'),
      blockerFailed: hasBlockerFailure,
      issues,
    },
  };
}

/**
 * 生成可读的问题清单，供日志/前端展示
 * @param {Object} report
 * @returns {string}
 */
export function formatRuleIssues(report) {
  if (!report || !report.applicable || report.pass) return '';
  const lines = [`【${report.agentId} 确定性检查未通过】`];
  for (const f of report.cases || []) {
    lines.push(`- [${f.severity}] ${f.detail}（${f.id}）`);
  }
  return lines.join('\n');
}

export default { getRulesFor, listRuleAgents, checkWithRules, formatRuleIssues };
