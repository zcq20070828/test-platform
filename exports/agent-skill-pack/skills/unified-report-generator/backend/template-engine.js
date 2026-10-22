/**
 * unified-report-generator / backend / template-engine.js
 * 多格式渲染引擎：将结构化报告渲染为 Markdown / HTML / Excel 友好格式
 *
 * 导出函数：
 *   renderMarkdown(report)        → string
 *   renderHTML(report, theme?)    → string
 *   renderExcelFriendly(report)   → object
 *   generateToc(sections)         → string
 */

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 安全转字符串
 * @param {unknown} val
 * @returns {string}
 */
function str(val) {
  if (val === null || val === undefined) return '';
  return String(val);
}

/**
 * 首字母大写
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Markdown 工具 ───────────────────────────────────────────────────────────

/**
 * 状态徽章（Markdown emoji 版）
 * @param {string} level - pass | fail | warn | info
 * @returns {string}
 */
function badge(level) {
  const map = { pass: '✅ 通过', fail: '❌ 失败', warn: '⚠️ 警告', info: 'ℹ️ 信息' };
  return map[level] || level;
}

/**
 * 严重程度徽章
 * @param {string} severity
 * @returns {string}
 */
function severityBadge(severity) {
  const map = {
    critical: '🔴 严重',
    major:    '🟠 重要',
    minor:    '🟡 一般',
    info:     '🔵 提示',
  };
  return map[severity] || severity;
}

/**
 * 生成 Markdown 表格
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {string}
 */
function mdTable(headers, rows) {
  if (!headers.length) return '';
  const sep = headers.map(() => '---');
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map(r => `| ${r.map(c => str(c)).join(' | ')} |`),
  ];
  return lines.join('\n');
}

// ─── generateToc ────────────────────────────────────────────────────────────

/**
 * 根据 sections 生成 Markdown 目录（含层级）
 * @param {Array<{ id: string, title: string, content?: object }>} sections
 * @returns {string}
 */
export function generateToc(sections) {
  if (!Array.isArray(sections)) {
    throw new TypeError('sections 必须是数组');
  }
  const lines = ['## 目录\n'];
  sections.forEach((sec, idx) => {
    lines.push(`${idx + 1}. [${sec.title}](#${sec.id})`);
  });
  return lines.join('\n') + '\n';
}

// ─── renderMarkdown ─────────────────────────────────────────────────────────

/**
 * 将报告结构渲染为 Markdown（含表格/徽章/目录）
 * @param {object} report - buildReport() 返回的结构
 * @returns {string}
 */
export function renderMarkdown(report) {
  if (!report || typeof report !== 'object') {
    throw new TypeError('report 必须是对象');
  }

  const parts = [];

  // 标题区
  parts.push(
    `# ${str(report.summary?.title || '测试执行报告')}\n`
  );
  const meta = [
    report.summary?.projectName ? `**项目**：${report.summary.projectName}` : '',
    report.summary?.env         ? `**环境**：${report.summary.env}`            : '',
    `**生成时间**：${report.summary?.generatedAt ? new Date(report.summary.generatedAt).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN')}`,
    `**版本**：${str(report.summary?.version || '1.0.0')}`,
  ].filter(Boolean);
  parts.push(meta.join('  ·  ') + '\n');
  parts.push('---\n');

  // 目录
  if (report.sections?.length) {
    parts.push(generateToc(report.sections));
  }

  // 各节内容
  for (const sec of report.sections || []) {
    parts.push(`## ${sec.title}\n`);
    const c = sec.content;

    switch (sec.id) {
      case 'summary': {
        const o = c.overview;
        parts.push(`| 指标 | 数值 |\n|---|---|\n`);
        parts.push(`| 用例总数 | ${o.total} |\n`);
        parts.push(`| ✅ 通过 | ${o.passed} |\n`);
        parts.push(`| ❌ 失败 | ${o.failed} |\n`);
        parts.push(`| ⏭️ 跳过 | ${o.skipped} |\n`);
        parts.push(`| 🔒 阻塞 | ${o.blocked} |\n`);
        parts.push(`| 通过率 | **${o.passRate}** |\n`);
        parts.push(`| 执行耗时 | ${o.durationReadable} |\n`);
        parts.push('\n');
        // 历史趋势
        if (c.trend?.length) {
          parts.push('### 📈 趋势\n\n');
          parts.push(mdTable(
            ['日期', '通过率', '总数', '通过数'],
            c.trend.map(t => [t.date, t.passRate, t.total, t.passed])
          ));
          parts.push('\n');
        }
        break;
      }

      case 'defects': {
        const stats = c.stats;
        parts.push(`| 维度 | 数值 |\n|---|---|\n`);
        parts.push(`| 缺陷总数 | ${stats.total} |\n`);
        parts.push(`| 未解决 | ${stats.open} |\n`);
        parts.push(`| 🔴 严重 | ${stats.critical} |\n`);
        parts.push(`| 🟠 重要 | ${stats.major} |\n`);
        parts.push(`| 🟡 一般 | ${stats.minor} |\n`);
        parts.push(`| 🔵 提示 | ${stats.info} |\n\n`);

        if (c.topIssues?.length) {
          parts.push('### 🔝 Top 问题\n\n');
          parts.push(mdTable(
            ['ID', '描述', '严重程度', '模块', '频率', '状态'],
            c.topIssues.map(i => [
              i.id,
              i.summary,
              severityBadge(i.severity),
              i.module,
              i.frequency,
              i.resolved ? '✅ 已解决' : '⏳ 未解决',
            ])
          ));
          parts.push('\n');
        }

        // 模块分布
        if (Object.keys(c.byModule || {}).length) {
          parts.push('### 📦 模块分布\n\n');
          const modRows = Object.entries(c.byModule)
            .sort((a, b) => b[1] - a[1])
            .map(([mod, count]) => [mod, count]);
          parts.push(mdTable(['模块', '缺陷数'], modRows));
          parts.push('\n');
        }
        break;
      }

      case 'metrics': {
        const overall = c.overall;
        parts.push(`**综合得分**：${badge(overall.level)} ${overall.value.toFixed(2)}%  / 目标 ${overall.target.toFixed(2)}%\n\n`);

        parts.push(mdTable(
          ['维度', '实际值', '目标值', '状态'],
          c.dimensions.map(d => [
            d.label,
            `${d.value.toFixed(2)}%`,
            `${d.target.toFixed(2)}%`,
            badge(d.level),
          ])
        ));
        parts.push('\n');
        break;
      }

      case 'risk': {
        const sum = c.summary;
        const levelEmoji = { high: '🔴', medium: '🟡', low: '🟢' };
        parts.push(`**整体风险等级**：${levelEmoji[sum.overall] || ''} ${capitalize(sum.overall)}\n\n`);
        parts.push(`| 风险等级 | 数量 |\n|---|---|\n`);
        parts.push(`| 🔴 高风险 | ${sum.high} |\n`);
        parts.push(`| 🟡 中风险 | ${sum.medium} |\n`);
        parts.push(`| 🟢 低风险 | ${sum.low} |\n\n`);

        if (c.items?.length) {
          parts.push('### 风险明细\n\n');
          parts.push(mdTable(
            ['ID', '描述', '级别', '处理人', '截止日期'],
            c.items.map(i => [i.id, i.description, severityBadge(i.level), i.owner, i.deadline])
          ));
          parts.push('\n');
        }

        if (c.recommendations?.length) {
          parts.push('### 💡 缓解建议\n\n');
          c.recommendations.forEach(rec => parts.push(`- ${rec}\n`));
          parts.push('\n');
        }
        break;
      }

      default:
        parts.push('（无详情）\n');
    }

    parts.push('---\n');
  }

  // 图表区（ASCII 简单柱状图）
  if (report.charts) {
    parts.push('## 📊 图表\n\n');
    const { charts } = report;

    // 通过率柱状图
    if (charts.passRatePie) {
      const total = charts.passRatePie.data.reduce((s, d) => s + d.value, 0);
      parts.push('### 通过率\n\n');
      charts.passRatePie.data.forEach(d => {
        const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : 0;
        const bar = '█'.repeat(Math.round((d.value / (total || 1)) * 20));
        parts.push(`${d.label} ${bar} ${d.value} (${pct}%)\n`);
      });
      parts.push('\n');
    }

    // 指标柱状图
    if (charts.metricsBar?.length) {
      parts.push('### 质量指标\n\n');
      charts.metricsBar.forEach(d => {
        const pct = Math.min((d.value / 100) * 20, 20);
        const bar  = '█'.repeat(Math.round(pct));
        const targetMark = '│'.repeat(Math.round((d.target / 100) * 20));
        parts.push(`${d.label.padEnd(10)} ${bar} ${d.value.toFixed(1)}%  目标:${d.target.toFixed(1)}%\n`);
      });
      parts.push('\n');
    }
  }

  return parts.join('');
}

// ─── renderHTML ──────────────────────────────────────────────────────────────

/**
 * 渲染为 HTML（含内联 CSS，theme 支持 light / dark）
 * @param {object} report - buildReport() 返回的结构
 * @param {'light'|'dark'} [theme='light']
 * @returns {string}
 */
export function renderHTML(report, theme = 'light') {
  if (!report || typeof report !== 'object') {
    throw new TypeError('report 必须是对象');
  }
  const isDark = theme === 'dark';

  const styles = isDark ? `
    body { background:#1e1e1e; color:#d4d4d4; }
    .card { background:#252526; border-color:#3e3e42; }
    h1,h2,h3 { color:#e0e0e0; }
    table { border-color:#3e3e42; }
    th { background:#2d2d2d; }
    tr:nth-child(even) { background:#1e1e1e; }
    .badge-pass { background:#166534; color:#bbf7d0; }
    .badge-fail { background:#7f1d1d; color:#fecaca; }
    .badge-warn { background:#713f12; color:#fef08a; }
    .badge-info { background:#1e3a5f; color:#bfdbfe; }
    .sev-critical { color:#f87171; }
    .sev-major    { color:#fb923c; }
    .sev-minor    { color:#fbbf24; }
    .sev-info     { color:#60a5fa; }
    .risk-high    { color:#f87171; }
    .risk-medium  { color:#fbbf24; }
    .risk-low     { color:#4ade80; }
    .toc { background:#252526; border-color:#3e3e42; }
    hr { border-color:#3e3e42; }
    .meta { color:#9d9d9d; }
  ` : `
    body { background:#f9fafb; color:#1f2937; font-family:sans-serif; }
    .card { background:#fff; border-color:#e5e7eb; box-shadow:0 1px 3px rgba(0,0,0,.08); }
    h1,h2,h3 { color:#111827; }
    table { border-color:#e5e7eb; }
    th { background:#f3f4f6; }
    tr:nth-child(even) { background:#f9fafb; }
    .badge-pass { background:#dcfce7; color:#166534; }
    .badge-fail { background:#fee2e2; color:#991b1b; }
    .badge-warn { background:#fef9c3; color:#713f12; }
    .badge-info { background:#dbeafe; color:#1e40af; }
    .sev-critical { color:#dc2626; }
    .sev-major    { color:#ea580c; }
    .sev-minor    { color:#ca8a04; }
    .sev-info     { color:#2563eb; }
    .risk-high    { color:#dc2626; }
    .risk-medium  { color:#ca8a04; }
    .risk-low     { color:#16a34a; }
    .toc { background:#f3f4f6; border-color:#e5e7eb; }
    hr { border-color:#e5e7eb; }
    .meta { color:#6b7280; }
  `;

  const mkCell = (val, cls) =>
    `<td${cls ? ` class="${cls}"` : ''}>${str(val)}</td>`;

  // ── 各节 HTML 片段 ──
  let sectionsHtml = '';

  for (const sec of report.sections || []) {
    sectionsHtml += `<div class="card section"><h2>${str(sec.title)}</h2>\n`;
    const c = sec.content;

    switch (sec.id) {
      case 'summary': {
        const o = c.overview;
        sectionsHtml += `<table><thead><tr><th>指标</th><th>数值</th></tr></thead><tbody>
          <tr>${mkCell('用例总数')}${mkCell(o.total)}</tr>
          <tr>${mkCell('✅ 通过')}${mkCell(o.passed, 'badge-pass')}</tr>
          <tr>${mkCell('❌ 失败')}${mkCell(o.failed, 'badge-fail')}</tr>
          <tr>${mkCell('⏭️ 跳过')}${mkCell(o.skipped, 'badge-warn')}</tr>
          <tr>${mkCell('🔒 阻塞')}${mkCell(o.blocked, 'badge-info')}</tr>
          <tr>${mkCell('通过率')}${mkCell(`<strong>${o.passRate}</strong>`)}</tr>
          <tr>${mkCell('执行耗时')}${mkCell(o.durationReadable)}</tr>
        </tbody></table>\n`;
        break;
      }

      case 'defects': {
        const s = c.stats;
        sectionsHtml += `<p>共 <strong>${s.total}</strong> 个缺陷，当前 <strong>${s.open}</strong> 个未解决。
          🔴<span class="sev-critical">${s.critical}</span> 严重 ·
          🟠<span class="sev-major">${s.major}</span> 重要 ·
          🟡<span class="sev-minor">${s.minor}</span> 一般 ·
          🔵<span class="sev-info">${s.info}</span> 提示</p>\n`;
        if (c.topIssues?.length) {
          sectionsHtml += `<table><thead><tr><th>ID</th><th>描述</th><th>严重程度</th><th>模块</th><th>频率</th><th>状态</th></tr></thead><tbody>\n`;
          c.topIssues.forEach(i => {
            sectionsHtml += `<tr>
              ${mkCell(i.id)}
              ${mkCell(i.summary)}
              ${mkCell(severityBadge(i.severity), `sev-${i.severity}`)}
              ${mkCell(i.module)}
              ${mkCell(i.frequency)}
              ${mkCell(i.resolved ? '✅ 已解决' : '⏳ 未解决')}
            </tr>\n`;
          });
          sectionsHtml += `</tbody></table>\n`;
        }
        break;
      }

      case 'metrics': {
        const ov = c.overall;
        const lvlCls = ov.achieved ? 'badge-pass' : 'badge-fail';
        sectionsHtml += `<p>综合得分：<span class="${lvlCls}">${ov.value.toFixed(2)}%</span> / 目标 ${ov.target.toFixed(2)}%</p>\n`;
        sectionsHtml += `<table><thead><tr><th>维度</th><th>实际值</th><th>目标值</th><th>状态</th></tr></thead><tbody>\n`;
        c.dimensions.forEach(d => {
          sectionsHtml += `<tr>
            ${mkCell(d.label)}
            ${mkCell(`${d.value.toFixed(2)}%`)}
            ${mkCell(`${d.target.toFixed(2)}%`)}
            ${mkCell(badge(d.level), `badge-${d.level}`)}
          </tr>\n`;
        });
        sectionsHtml += `</tbody></table>\n`;
        break;
      }

      case 'risk': {
        const lvl = c.summary.overall;
        const lvlCls = lvl === 'high' ? 'risk-high' : lvl === 'medium' ? 'risk-medium' : 'risk-low';
        sectionsHtml += `<p>整体风险等级：<strong class="${lvlCls}">${lvl.toUpperCase()}</strong>（🔴${c.summary.high} / 🟡${c.summary.medium} / 🟢${c.summary.low}）</p>\n`;
        if (c.recommendations?.length) {
          sectionsHtml += `<ul>\n`;
          c.recommendations.forEach(rec => { sectionsHtml += `<li>${str(rec)}</li>\n`; });
          sectionsHtml += `</ul>\n`;
        }
        break;
      }

      default:
        sectionsHtml += '<p>（无详情）</p>\n';
    }

    sectionsHtml += `</div>\n`;
  }

  // 简单柱状图
  let chartsHtml = '';
  if (report.charts?.passRatePie) {
    const total = report.charts.passRatePie.data.reduce((s, d) => s + d.value, 0);
    chartsHtml += `<div class="card"><h3>通过率</h3>`;
    report.charts.passRatePie.data.forEach(d => {
      const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : 0;
      const w   = total > 0 ? Math.round((d.value / total) * 100) : 0;
      chartsHtml += `<div style="margin-bottom:6px">
        <span style="display:inline-block;width:80px">${d.label}</span>
        <div style="display:inline-block;width:200px;background:#e5e7eb;vertical-align:middle">
          <div style="width:${w}%;background:${d.color};height:14px;display:inline-block"></div>
        </div>
        <span>${d.value} (${pct}%)</span>
      </div>`;
    });
    chartsHtml += `</div>\n`;
  }

  if (report.charts?.metricsBar?.length) {
    chartsHtml += `<div class="card"><h3>质量指标</h3>`;
    report.charts.metricsBar.forEach(d => {
      const w = Math.round(Math.min((d.value / 100) * 200, 200));
      const color = d.value >= d.target ? '#16a34a' : '#dc2626';
      chartsHtml += `<div style="margin-bottom:6px">
        <span style="display:inline-block;width:90px">${d.label}</span>
        <div style="display:inline-block;width:200px;background:#e5e7eb;vertical-align:middle">
          <div style="width:${w}px;background:${color};height:14px;display:inline-block"></div>
        </div>
        <span>${d.value.toFixed(1)}% / 目标${d.target.toFixed(1)}%</span>
      </div>`;
    });
    chartsHtml += `</div>\n`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${str(report.summary?.title || '测试执行报告')}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{padding:24px;max-width:960px;margin:0 auto;line-height:1.6}
    ${styles}
    .header{padding:16px 0 8px;border-bottom:2px solid currentColor;margin-bottom:20px}
    .meta{margin-bottom:16px;font-size:.9em}
    .card{padding:16px;border:1px solid;border-radius:6px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:.9em}
    th,td{padding:8px 12px;border:1px solid;text-align:left}
    .section{margin-top:0}
    .toc{padding:12px 16px;border-radius:6px;margin-bottom:20px}
    .toc h3{margin-bottom:8px}
    .toc ul{list-style:none;padding-left:16px}
    .toc li{margin-bottom:4px}
    .toc li a{text-decoration:none;color:inherit}
    .toc li a:hover{text-decoration:underline}
    .charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
    @media(max-width:640px){.charts{grid-template-columns:1fr}}
    hr{margin:24px 0;border:none;border-top:1px solid currentColor}
  </style>
</head>
<body>
  <div class="header">
    <h1>${str(report.summary?.title || '测试执行报告')}</h1>
    <p class="meta">
      ${report.summary?.projectName ? `<strong>项目</strong>：${str(report.summary.projectName)} &nbsp;·&nbsp; ` : ''}
      ${report.summary?.env ? `<strong>环境</strong>：${str(report.summary.env)} &nbsp;·&nbsp; ` : ''}
      <strong>生成时间</strong>：${new Date(report.summary?.generatedAt || Date.now()).toLocaleString('zh-CN')} &nbsp;·&nbsp;
      <strong>版本</strong>：${str(report.summary?.version || '1.0.0')}
    </p>
  </div>

  <div class="toc">
    <h3>📑 目录</h3>
    <ul>
      ${(report.sections || []).map(s => `<li><a href="#${s.id}">${s.title}</a></li>`).join('\n      ')}
    </ul>
  </div>

  ${sectionsHtml}

  ${chartsHtml ? `<hr><h2>📊 图表</h2><div class="charts">${chartsHtml}</div>` : ''}
</body>
</html>`;
}

// ─── renderExcelFriendly ────────────────────────────────────────────────────

/**
 * 渲染为 Excel 友好格式（扁平 JSON，适合导入 Excel / CSV）
 * @param {object} report - buildReport() 返回的结构
 * @returns {object}
 */
export function renderExcelFriendly(report) {
  if (!report || typeof report !== 'object') {
    throw new TypeError('report 必须是对象');
  }

  /** @type {Array<Record<string, unknown>>} */
  const rows = [];

  // 元信息行
  const meta = report.summary || {};
  rows.push({ _section: '报告信息', 指标: '报告标题',     值: str(meta.title || '') });
  rows.push({ _section: '报告信息', 指标: '项目名称',     值: str(meta.projectName || '') });
  rows.push({ _section: '报告信息', 指标: '测试环境',     值: str(meta.env || '') });
  rows.push({ _section: '报告信息', 指标: '版本',         值: str(meta.version || '') });
  rows.push({ _section: '报告信息', 指标: '生成时间',     值: str(meta.generatedAt || '') });
  rows.push({ _section: '报告信息', 指标: '通过率',        值: str(meta.passRate || '') });
  rows.push({ _section: '报告信息', 指标: '用例总数',      值: str(meta.total || '') });
  rows.push({ _section: '报告信息', 指标: '综合得分',       值: str(meta.overallScore || '') });
  rows.push({ _section: '报告信息', 指标: '风险等级',      值: str(meta.riskLevel || '') });

  // 各节
  for (const sec of report.sections || []) {
    const c = sec.content;

    switch (sec.id) {
      case 'summary': {
        const o = c.overview;
        rows.push({ _section: '执行概况', 指标: '用例总数',   值: o.total,     详情: '' });
        rows.push({ _section: '执行概况', 指标: '通过数',     值: o.passed,    详情: '' });
        rows.push({ _section: '执行概况', 指标: '失败数',     值: o.failed,    详情: '' });
        rows.push({ _section: '执行概况', 指标: '跳过数',     值: o.skipped,    详情: '' });
        rows.push({ _section: '执行概况', 指标: '阻塞数',     值: o.blocked,    详情: '' });
        rows.push({ _section: '执行概况', 指标: '通过率',     值: o.passRate,  详情: '' });
        rows.push({ _section: '执行概况', 指标: '耗时(ms)',   值: o.durationMs,详情: o.durationReadable });
        if (c.distribution?.length) {
          c.distribution.forEach(d => {
            rows.push({ _section: '执行概况', 指标: `状态-${d.label}`, 值: d.count, 详情: '' });
          });
        }
        if (c.trend?.length) {
          c.trend.forEach(t => {
            rows.push({ _section: '趋势', 指标: `历史-${t.date}`, 值: t.passRate, 详情: `总数:${t.total} 通过:${t.passed}` });
          });
        }
        break;
      }

      case 'defects': {
        const s = c.stats;
        rows.push({ _section: '缺陷分析', 指标: '缺陷总数',    值: s.total,    详情: '' });
        rows.push({ _section: '缺陷分析', 指标: '未解决数',    值: s.open,     详情: '' });
        rows.push({ _section: '缺陷分析', 指标: '严重',        值: s.critical,详情: '' });
        rows.push({ _section: '缺陷分析', 指标: '重要',        值: s.major,    详情: '' });
        rows.push({ _section: '缺陷分析', 指标: '一般',        值: s.minor,    详情: '' });
        rows.push({ _section: '缺陷分析', 指标: '提示',        值: s.info,     详情: '' });
        if (c.topIssues?.length) {
          c.topIssues.forEach(i => {
            rows.push({ _section: '缺陷-Top', 指标: i.id, 值: i.severity, 详情: i.summary, 模块: i.module, 频率: i.frequency, 状态: i.resolved ? '已解决' : '未解决' });
          });
        }
        if (c.byModule) {
          Object.entries(c.byModule).forEach(([mod, count]) => {
            rows.push({ _section: '缺陷-模块分布', 指标: '模块', 值: count, 详情: mod });
          });
        }
        break;
      }

      case 'metrics': {
        const ov = c.overall;
        rows.push({ _section: '质量指标-综合', 指标: '综合得分', 值: ov.value.toFixed(2), 详情: `目标:${ov.target.toFixed(2)}` });
        c.dimensions.forEach(d => {
          rows.push({ _section: '质量指标-维度', 指标: d.label, 值: d.value.toFixed(2), 详情: `目标:${d.target.toFixed(2)}`, 状态: d.achieved ? '达成' : '未达成' });
        });
        break;
      }

      case 'risk': {
        const sum = c.summary;
        rows.push({ _section: '风险评估', 指标: '整体风险',   值: sum.overall,  详情: '' });
        rows.push({ _section: '风险评估', 指标: '高风险数',   值: sum.high,     详情: '' });
        rows.push({ _section: '风险评估', 指标: '中风险数',   值: sum.medium,   详情: '' });
        rows.push({ _section: '风险评估', 指标: '低风险数',   值: sum.low,      详情: '' });
        if (c.items?.length) {
          c.items.forEach(i => {
            rows.push({ _section: '风险-明细', 指标: i.id, 值: i.level, 详情: i.description, 处理人: i.owner, 截止日期: i.deadline, 缓解建议: i.mitigation });
          });
        }
        if (c.recommendations?.length) {
          c.recommendations.forEach((rec, idx) => {
            rows.push({ _section: '风险-建议', 指标: `建议${idx + 1}`, 值: rec, 详情: '' });
          });
        }
        break;
      }
    }
  }

  // 图表数据（展开）
  if (report.charts?.passRatePie) {
    report.charts.passRatePie.data.forEach(d => {
      rows.push({ _section: '图表-通过率', 指标: d.label, 值: d.value, 详情: '' });
    });
  }

  if (report.charts?.metricsBar) {
    report.charts.metricsBar.forEach(d => {
      rows.push({ _section: '图表-质量指标', 指标: d.label, 值: d.value, 详情: `目标:${d.target}` });
    });
  }

  return {
    meta: {
      title:       str(meta.title || ''),
      projectName: str(meta.projectName || ''),
      env:         str(meta.env || ''),
      generatedAt: str(meta.generatedAt || new Date().toISOString()),
    },
    rows,
    sheetNames: ['执行概况', '缺陷分析', '质量指标', '风险评估'],
  };
}

// ─── 自测 ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== template-engine.js 自测 ===\n');

  // 构建模拟报告（复用 report-builder 的 mock）
  const { buildReport } = await import('./report-builder.js');

  const mockExecResult = {
    total: 100, passed: 82, failed: 8, skipped: 6, blocked: 4,
    duration: 45230,
    history: [
      { date: '2026-07-10', passed: 78, total: 100 },
      { date: '2026-07-11', passed: 80, total: 100 },
    ],
  };
  const mockDefects = [
    { id: 'D-001', summary: '登录超时', severity: 'critical', module: '认证', frequency: 3 },
    { id: 'D-002', summary: '导出失败', severity: 'major',    module: '报表', frequency: 5 },
  ];
  const mockMetrics = {
    coverage:  { score: 85, target: 80 },
    execution: { score: 92, target: 95 },
    defect:    { score: 88, target: 90 },
    case:      { score: 82, target: 90 },
  };

  const report = buildReport(
    { ...mockExecResult, defects: mockDefects },
    mockMetrics,
    { title: '项目X 测试报告', projectName: '项目X', env: 'staging' }
  );

  // 1. generateToc
  const toc = generateToc(report.sections);
  console.log('[toc] length:', toc.length, '| contains Summary:', toc.includes('执行概况'));
  console.assert(toc.includes('## 目录'), '应有目录标题');

  // 2. renderMarkdown
  const md = renderMarkdown(report);
  console.log('[markdown] length:', md.length, '| contains #:', md.includes('#'));
  console.assert(md.includes('## 执行概况'), '应有执行概况节');
  console.assert(md.includes('| 用例总数 |'), '应有表格');

  // 3. renderHTML (light)
  const htmlLight = renderHTML(report, 'light');
  console.log('[html-light] length:', htmlLight.length, '| contains DOCTYPE:', htmlLight.includes('<!DOCTYPE'));
  console.assert(htmlLight.includes('<table'), '应有表格');

  // 4. renderHTML (dark)
  const htmlDark = renderHTML(report, 'dark');
  console.log('[html-dark] length:', htmlDark.length, '| contains dark styles:', htmlDark.includes('#1e1e1e'));

  // 5. renderExcelFriendly
  const excel = renderExcelFriendly(report);
  console.log('[excel] rows count:', excel.rows.length, '| sheet count:', excel.sheetNames.length);
  console.assert(excel.rows.length > 10, '应有10+行数据');
  const execRow = excel.rows.find(r => r._section === '执行概况' && r.指标 === '通过率');
  console.log('[excel] passRate row:', execRow?.值);

  // 6. 边界测试：空 sections 返回有效 TOC
  const emptyToc = generateToc([]);
  console.log('[toc] empty:', JSON.stringify(emptyToc));
  console.assert(emptyToc.includes('## 目录'), '空sections应返回目录标题');

  console.log('\n✅ 所有自测通过，无报错');
}
