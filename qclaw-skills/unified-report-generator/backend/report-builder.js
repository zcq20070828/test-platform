/**
 * unified-report-generator / backend / report-builder.js
 * 报告构建引擎：将 UTRM 聚合结果与质量指标构建为结构化报告各节
 *
 * 导出函数：
 *   buildReport(aggregatedResult, metrics, options?) → { summary, sections[], charts, recommendations }
 *   buildSummarySection(execResult)                  → { id, title, content }
 *   buildDefectSection(defects)                      → { id, title, content }
 *   buildMetricsSection(metrics)                     → { id, title, content }
 *   buildRiskSection(issues, metrics)               → { id, title, content }
 */

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 安全解析整数，默认 0
 * @param {unknown} val
 * @param {number} fallback
 * @returns {number}
 */
function toInt(val, fallback = 0) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 安全解析浮点数，默认 0
 * @param {unknown} val
 * @param {number} fallback
 * @returns {number}
 */
function toFloat(val, fallback = 0) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 计算通过率百分比字符串
 * @param {number} pass
 * @param {number} total
 * @returns {string}
 */
function passRate(pass, total) {
  if (!total) return '0.00%';
  return ((pass / total) * 100).toFixed(2) + '%';
}

/**
 * 计算耗时（毫秒 → 人类可读）
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const n = toFloat(ms, 0);
  if (n < 1000) return `${n.toFixed(0)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(2)} s`;
  const m = Math.floor(n / 60000);
  const s = ((n % 60000) / 1000).toFixed(1);
  return `${m} min ${s} s`;
}

// ─── 各节构建器 ──────────────────────────────────────────────────────────────

/**
 * 生成执行概况节
 * @param {object} execResult - UTRM 格式执行结果
 * @returns {{ id: string, title: string, content: object }}
 */
export function buildSummarySection(execResult) {
  if (!execResult || typeof execResult !== 'object') {
    throw new TypeError('execResult 必须是对象');
  }

  const total    = toInt(execResult.total,     0);
  const passed   = toInt(execResult.passed,      0);
  const failed   = toInt(execResult.failed,      0);
  const skipped  = toInt(execResult.skipped,      0);
  const blocked  = toInt(execResult.blocked,      0);
  const duration = toFloat(execResult.duration,  0);

  const notPassed = failed + skipped + blocked;
  const rate      = passRate(passed, total);

  // 状态分布
  const distribution = [
    { label: '通过', count: passed,  color: 'green' },
    { label: '失败', count: failed,  color: 'red'   },
    { label: '跳过', count: skipped, color: 'yellow'},
    { label: '阻塞', count: blocked,color: 'purple'},
  ].filter(d => d.count > 0);

  const content = {
    overview: {
      total,
      passed,
      failed,
      skipped,
      blocked,
      passRate: rate,
      durationMs: duration,
      durationReadable: formatDuration(duration),
    },
    distribution,
    // 趋势（若有 history 字段）
    trend: Array.isArray(execResult.history)
      ? execResult.history.map(h => ({
          date:    h.date    || '',
          passRate: passRate(toInt(h.passed, 0), toInt(h.total, 0)),
          total:   toInt(h.total,   0),
          passed:  toInt(h.passed,  0),
        }))
      : [],
  };

  return { id: 'summary', title: '执行概况', content };
}

/**
 * 生成缺陷分析节
 * @param {object[]} defects - 缺陷数组
 * @returns {{ id: string, title: string, content: object }}
 */
export function buildDefectSection(defects) {
  if (!Array.isArray(defects)) {
    throw new TypeError('defects 必须是数组');
  }

  // 基础统计
  const total = defects.length;
  const open  = defects.filter(d => !d.resolved && d.severity !== 'info').length;
  const critical = defects.filter(d => d.severity === 'critical').length;
  const major     = defects.filter(d => d.severity === 'major').length;
  const minor     = defects.filter(d => d.severity === 'minor').length;
  const info      = defects.filter(d => d.severity === 'info').length;

  // 按模块分布
  const byModule = {};
  for (const d of defects) {
    const mod = d.module || d.component || '未知模块';
    byModule[mod] = (byModule[mod] || 0) + 1;
  }

  // 按类型分布
  const byType = {};
  for (const d of defects) {
    const type = d.type || '其他';
    byType[type] = (byType[type] || 0) + 1;
  }

  // Top 问题（按出现次数或优先级）
  const sorted = [...defects]
    .sort((a, b) => {
      const priorityOrder = { critical: 0, major: 1, minor: 2, info: 3 };
      const pa = priorityOrder[a.severity] ?? 9;
      const pb = priorityOrder[b.severity] ?? 9;
      if (pa !== pb) return pa - pb;
      return (b.frequency || 0) - (a.frequency || 0);
    })
    .slice(0, 5);

  const topIssues = sorted.map(d => ({
    id:       d.id       || d.name   || 'N/A',
    summary:  d.summary  || d.name  || '无描述',
    severity: d.severity || 'minor',
    module:   d.module   || d.component || '未知',
    frequency: d.frequency || 1,
    resolved: !!d.resolved,
  }));

  const content = {
    stats: { total, open, critical, major, minor, info },
    byModule,
    byType,
    topIssues,
    // 按严重程度的饼图数据
    severityPie: [
      { label: '严重',   count: critical, color: '#dc2626' },
      { label: '重要',   count: major,     color: '#ea580c' },
      { label: '一般',   count: minor,     color: '#ca8a04' },
      { label: '提示',   count: info,      color: '#2563eb' },
    ].filter(s => s.count > 0),
  };

  return { id: 'defects', title: '缺陷分析', content };
}

/**
 * 生成质量指标节
 * @param {object} metrics - 质量指标（来自 quality-metrics-calculator）
 * @returns {{ id: string, title: string, content: object }}
 */
export function buildMetricsSection(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    throw new TypeError('metrics 必须是对象');
  }

  /**
   * 安全获取嵌套数值字段
   * @param {object} obj
   * @param {string} path - "a.b.c"
   * @param {number} fallback
   * @returns {number}
   */
  function getNum(obj, path, fallback = 0) {
    return toFloat(path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj), fallback);
  }

  /**
   * 指标项标准化
   * @param {number} value
   * @param {number} target
   * @param {string} label
   * @returns {object}
   */
  function makeMetric(value, target, label) {
    const achieved = target > 0 ? value >= target : false;
    return {
      label,
      value: toFloat(value, 0),
      target: toFloat(target, 0),
      unit: '%',
      achieved,
      level: achieved ? 'pass' : 'fail',
    };
  }

  // 提取各维度评分
  const coverageScore  = getNum(metrics, 'coverage.score',          metrics.coverage);
  const executionScore = getNum(metrics, 'execution.score',         metrics.execution);
  const defectScore    = getNum(metrics, 'defect.score',            metrics.defect);
  const caseScore      = getNum(metrics, 'case.score',               metrics.case);

  const coverageTarget  = getNum(metrics, 'coverage.target',         80);
  const executionTarget = getNum(metrics, 'execution.target',        95);
  const defectTarget    = getNum(metrics, 'defect.target',            90);
  const caseTarget      = getNum(metrics, 'case.target',              90);

  const dimensions = [
    makeMetric(coverageScore,  coverageTarget,  '用例覆盖率'),
    makeMetric(executionScore, executionTarget, '执行成功率'),
    makeMetric(defectScore,    defectTarget,     '缺陷修复率'),
    makeMetric(caseScore,      caseTarget,        '用例通过率'),
  ];

  // 综合得分（加权平均，权重可配置）
  const weights   = [0.25, 0.35, 0.2, 0.2];
  const overall    = dimensions.reduce((sum, d, i) => sum + d.value * weights[i], 0);
  const overallTarget = dimensions.reduce((sum, d, i) => sum + d.target * weights[i], 0);
  const overallAchieved = overallTarget > 0 ? overall >= overallTarget : false;

  const content = {
    overall: {
      value:      toFloat(overall, 0),
      target:     toFloat(overallTarget, 0),
      achieved:   overallAchieved,
      level:      overallAchieved ? 'pass' : 'fail',
      unit:       '%',
    },
    dimensions,
    // 雷达图数据
    radar: dimensions.map(d => ({ axis: d.label, value: d.value })),
  };

  return { id: 'metrics', title: '质量指标', content };
}

/**
 * 生成风险评估节
 * @param {object[]} issues - 问题/风险项数组
 * @param {object} metrics - 质量指标（用于参考）
 * @returns {{ id: string, title: string, content: object }}
 */
export function buildRiskSection(issues, metrics) {
  if (!Array.isArray(issues)) {
    throw new TypeError('issues 必须是数组');
  }

  // 风险级别定义
  const RISK_LEVEL = { high: 3, medium: 2, low: 1 };

  /**
   * 判断风险级别
   * @param {object} issue
   * @returns {string}
   */
  function riskLevel(issue) {
    if (issue.level) return issue.level;
    // 基于通过率推断
    if (metrics) {
      const passRate = toFloat(
        metrics.case?.passRate ?? metrics.case?.score ?? metrics.passRate,
        100
      );
      if (passRate < 60) return 'high';
      if (passRate < 80) return 'medium';
    }
    return 'low';
  }

  /**
   * 缓解建议模板
   * @param {string} level
   * @param {string} desc
   * @returns {string}
   */
  function mitigation(level, desc) {
    const templates = {
      high:   `【紧急】${desc}，建议立即处理并复盘。`,
      medium: `【关注】${desc}，建议尽快跟进。`,
      low:    `【提示】${desc}，可安排后续优化。`,
    };
    return templates[level] || desc;
  }

  // 排序：高风险优先
  const sorted = [...issues].sort((a, b) => {
    const la = RISK_LEVEL[riskLevel(a)] ?? 0;
    const lb = RISK_LEVEL[riskLevel(b)] ?? 0;
    return lb - la;
  });

  const highRisk   = sorted.filter(i => riskLevel(i) === 'high');
  const mediumRisk = sorted.filter(i => riskLevel(i) === 'medium');
  const lowRisk    = sorted.filter(i => riskLevel(i) === 'low');

  const items = sorted.map(issue => {
    const level = riskLevel(issue);
    return {
      id:          issue.id       || issue.name || 'N/A',
      description: issue.description || issue.msg || issue.summary || '无描述',
      level,
      mitigation:  mitigation(level, issue.description || issue.msg || ''),
      owner:       issue.owner    || '待指派',
      deadline:    issue.deadline || '未设置',
    };
  });

  const recommendations = [
    ...highRisk.map(i => mitigation('high',   i.description || i.msg || '')),
    ...mediumRisk.map(i => mitigation('medium', i.description || i.msg || '')),
    ...lowRisk.map(i => mitigation('low', i.description || i.msg || '')),
  ];

  const content = {
    summary: {
      total:   items.length,
      high:    highRisk.length,
      medium:  mediumRisk.length,
      low:     lowRisk.length,
      overall: highRisk.length > 0 ? 'high' : mediumRisk.length > 0 ? 'medium' : 'low',
    },
    items,
    recommendations,
  };

  return { id: 'risk', title: '风险评估', content };
}

// ─── 主报告入口 ──────────────────────────────────────────────────────────────

/**
 * 主报告生成入口
 * @param {object} aggregatedResult - UTRM 格式聚合结果
 * @param {object} metrics - 质量指标
 * @param {object} [options]
 * @param {string} [options.title]        - 报告标题，默认 "测试执行报告"
 * @param {string} [options.version]      - 报告版本，默认 "1.0.0"
 * @param {string} [options.format]       - "full" | "summary"，默认 "full"
 * @param {string} [options.projectName]  - 项目名称
 * @param {string} [options.env]          - 测试环境
 * @returns {{ summary: object, sections: object[], charts: object, recommendations: string[] }}
 */
export function buildReport(aggregatedResult, metrics, options = {}) {
  if (!aggregatedResult || typeof aggregatedResult !== 'object') {
    throw new TypeError('aggregatedResult 必须是对象');
  }

  const opts = {
    title:       options.title      || '测试执行报告',
    version:     options.version    || '1.0.0',
    format:      options.format     || 'full',
    projectName: options.projectName || '',
    env:         options.env         || '',
  };

  // 执行概况
  const summarySection = buildSummarySection(
    aggregatedResult.summary || aggregatedResult
  );

  // 缺陷分析
  const defects = aggregatedResult.defects || [];
  const defectSection = buildDefectSection(defects);

  // 质量指标
  const metricsSection = buildMetricsSection(
    metrics || aggregatedResult.metrics || {}
  );

  // 风险评估
  const rawIssues = [
    // 从失败用例生成风险项
    ...(aggregatedResult.failedItems || []).map(item => ({
      id:          item.id   || item.name || 'N/A',
      description: `用例失败：${item.name || item.id}`,
      level:       'high',
      owner:       item.owner || '待指派',
    })),
    // 从未解缺陷生成风险项
    ...defects
      .filter(d => !d.resolved && d.severity !== 'info')
      .map(d => ({
        id:          d.id    || d.name  || 'N/A',
        description: `未解决缺陷（${d.severity}）：${d.summary || d.name}`,
        level:       d.severity === 'critical' || d.severity === 'major' ? 'high' : 'medium',
        owner:       d.owner || '待指派',
      })),
    // 传入的显式 issues
    ...(aggregatedResult.issues || []),
  ];

  const riskSection = buildRiskSection(rawIssues, metricsSection.content);

  const sections = [summarySection, defectSection, metricsSection, riskSection];

  // 图表数据
  const charts = {
    passRatePie: {
      title: '通过率',
      data: [
        { label: '通过', value: summarySection.content.overview.passed,  color: '#16a34a' },
        { label: '失败', value: summarySection.content.overview.failed,  color: '#dc2626' },
        { label: '跳过', value: summarySection.content.overview.skipped, color: '#ca8a04' },
        { label: '阻塞', value: summarySection.content.overview.blocked, color: '#7c3aed' },
      ],
    },
    severityPie:    defectSection.content.severityPie,
    metricsRadar:   metricsSection.content.radar,
    metricsBar:     metricsSection.content.dimensions.map(d => ({
      label: d.label,
      value: d.value,
      target: d.target,
    })),
  };

  const summary = {
    title:       opts.title,
    version:     opts.version,
    projectName: opts.projectName,
    env:         opts.env,
    generatedAt: new Date().toISOString(),
    passRate:    summarySection.content.overview.passRate,
    total:       summarySection.content.overview.total,
    overallScore: metricsSection.content.overall.value,
    riskLevel:   riskSection.content.summary.overall,
  };

  return {
    summary,
    sections,
    charts,
    recommendations: riskSection.content.recommendations,
  };
}

// ─── 自测 ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== report-builder.js 自测 ===\n');

  const mockExecResult = {
    total: 100,
    passed: 82,
    failed: 8,
    skipped: 6,
    blocked: 4,
    duration: 45230,
    history: [
      { date: '2026-07-10', passed: 78, total: 100 },
      { date: '2026-07-11', passed: 80, total: 100 },
      { date: '2026-07-12', passed: 82, total: 100 },
    ],
  };

  const mockDefects = [
    { id: 'D-001', summary: '登录页面加载超时', severity: 'critical', module: '认证模块', frequency: 3 },
    { id: 'D-002', summary: '数据导出失败',       severity: 'major',    module: '报表模块', frequency: 5 },
    { id: 'D-003', summary: '分页显示异常',       severity: 'minor',    module: '列表页',   frequency: 2 },
    { id: 'D-004', summary: '提示文案错误',       severity: 'info',     module: 'UI',        frequency: 1 },
    { id: 'D-005', summary: '接口返回错误',       severity: 'major',    module: '认证模块', frequency: 4 },
  ];

  const mockMetrics = {
    coverage:  { score: 85, target: 80 },
    execution: { score: 92, target: 95 },
    defect:    { score: 88, target: 90 },
    case:      { score: 82, target: 90 },
  };

  const mockIssues = [
    { id: 'R-001', description: '通过率低于目标值', level: 'high' },
    { id: 'R-002', description: '部分模块覆盖率不足', level: 'medium' },
  ];

  // 1. buildSummarySection
  const s = buildSummarySection(mockExecResult);
  console.log('[summary] passRate:', s.content.overview.passRate);
  console.log('[summary] duration:', s.content.overview.durationReadable);
  console.assert(s.id === 'summary', 'id应为summary');

  // 2. buildDefectSection
  const d = buildDefectSection(mockDefects);
  console.log('[defects] total:', d.content.stats.total, '| open:', d.content.stats.open);
  console.log('[defects] topIssue[0]:', d.content.topIssues[0].summary);
  console.assert(d.content.stats.critical === 1, '应有1个critical');

  // 3. buildMetricsSection
  const m = buildMetricsSection(mockMetrics);
  console.log('[metrics] overall:', m.content.overall.value.toFixed(2), '%');
  console.log('[metrics] achieved:', m.content.overall.achieved);
  console.assert(m.content.dimensions.length === 4, '应有4个维度');

  // 4. buildRiskSection
  const r = buildRiskSection(mockIssues, m.content);
  console.log('[risk] overall:', r.content.summary.overall);
  console.log('[risk] high:', r.content.summary.high);
  console.assert(r.content.summary.high === 1, '应有1个高风险');

  // 5. buildReport
  const report = buildReport(
    { ...mockExecResult, defects: mockDefects, issues: mockIssues },
    mockMetrics,
    { title: '项目X 测试报告', projectName: '项目X', env: 'staging' }
  );
  console.log('[report] title:', report.summary.title);
  console.log('[report] overallScore:', report.summary.overallScore.toFixed(2));
  console.log('[report] sections count:', report.sections.length);
  console.log('[report] charts keys:', Object.keys(report.charts).join(', '));

  console.log('\n✅ 所有自测通过，无报错');
}
