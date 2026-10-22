/**
 * 结果聚合器
 * 收集、聚合、去重、排序测试结果，生成最终报告
 * Result Aggregator
 */

/**
 * 收集测试结果
 * @param {Array} results - 各智能体返回的结果数组
 * @returns {Object} 收集的结果
 */
function collectResults(results) {
  const collected = {
    total: 0,
    bySource: {},
    byStatus: {},
    byPriority: {},
    timestamp: new Date().toISOString()
  };
  
  // 验证输入
  if (!Array.isArray(results)) {
    throw new Error('results必须为数组');
  }
  
  collected.total = results.length;
  
  // 按来源分组
  results.forEach((result, idx) => {
    const source = result.source || `unknown-${idx}`;
    if (!collected.bySource[source]) {
      collected.bySource[source] = [];
    }
    collected.bySource[source].push(result);
  });
  
  // 按状态分组
  results.forEach(result => {
    const status = result.status || 'unknown';
    if (!collected.byStatus[status]) {
      collected.byStatus[status] = 0;
    }
    collected.byStatus[status]++;
  });
  
  // 按优先级分组
  results.forEach(result => {
    const priority = result.priority || 'medium';
    if (!collected.byPriority[priority]) {
      collected.byPriority[priority] = 0;
    }
    collected.byPriority[priority]++;
  });
  
  return collected;
}

/**
 * 聚合结果
 * @param {Array} results - 收集的结果数组
 * @param {Object} options - 聚合选项
 * @returns {Object} 聚合结果
 */
function aggregateResults(results, options = {}) {
  const aggregated = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    error: 0,
    passRate: '0.00%',
    failureRate: '0.00%',
    details: [],
    summary: ''
  };
  
  // 验证输入
  if (!Array.isArray(results)) {
    throw new Error('results必须为数组');
  }
  
  aggregated.total = results.length;
  
  // 统计各状态数量
  results.forEach(result => {
    const status = result.status || 'unknown';
    switch (status.toLowerCase()) {
      case 'passed':
      case 'pass':
      case 'success':
        aggregated.passed++;
        break;
      case 'failed':
      case 'fail':
      case 'failure':
        aggregated.failed++;
        break;
      case 'skipped':
      case 'skip':
        aggregated.skipped++;
        break;
      case 'error':
        aggregated.error++;
        break;
    }
  });
  
  // 计算通过率和失败率
  if (aggregated.total > 0) {
    aggregated.passRate = (aggregated.passed / aggregated.total * 100).toFixed(2) + '%';
    aggregated.failureRate = (aggregated.failed / aggregated.total * 100).toFixed(2) + '%';
  }
  
  // 生成详细结果
  aggregated.details = results.map(result => ({
    id: result.id || 'unknown',
    name: result.name || 'Unnamed Test',
    status: result.status || 'unknown',
    priority: result.priority || 'medium',
    source: result.source || 'unknown',
    duration: result.duration || 0,
    message: result.message || '',
    timestamp: result.timestamp || ''
  }));
  
  // 生成摘要
  aggregated.summary = `总共${aggregated.total}个测试，通过${aggregated.passed}个（${aggregated.passRate}），失败${aggregated.failed}个（${aggregated.failureRate}）`;
  
  return aggregated;
}

/**
 * 去重处理
 * @param {Array} results - 聚合结果数组
 * @param {Object} options - 去重选项
 * @returns {Object} 去重后的结果
 */
function deduplicateResults(results, options = {}) {
  const opts = {
    keyFields: ['id', 'name'],  // 用于去重的字段
    keepStrategy: 'first',       // 保留策略：first（保留第一个）、last（保留最后一个）、best（保留最佳结果）
    ...options
  };
  
  // 验证输入
  if (!Array.isArray(results)) {
    throw new Error('results必须为数组');
  }
  
  const deduplicated = {
    total: results.length,
    unique: 0,
    removed: 0,
    duplicates: [],
    uniqueResults: []
  };
  
  // 使用Map进行去重
  const seen = new Map();
  
  results.forEach((result, idx) => {
    // 生成去重键
    const keyParts = opts.keyFields.map(field => result[field] || '');
    const key = keyParts.join('|');
    
    if (!seen.has(key)) {
      // 第一次出现
      seen.set(key, { result, index: idx });
      deduplicated.uniqueResults.push(result);
    } else {
      // 重复出现
      const existing = seen.get(key);
      
      // 根据保留策略决定是否替换
      let shouldReplace = false;
      if (opts.keepStrategy === 'last') {
        shouldReplace = true;
      } else if (opts.keepStrategy === 'best') {
        // 保留状态更好的结果（passed > skipped > failed > error）
        const statusPriority = { passed: 4, skipped: 3, failed: 2, error: 1 };
        const existingPriority = statusPriority[existing.result.status] || 0;
        const currentPriority = statusPriority[result.status] || 0;
        shouldReplace = currentPriority > existingPriority;
      }
      
      if (shouldReplace) {
        // 替换现有结果
        const idx = deduplicated.uniqueResults.indexOf(existing.result);
        if (idx !== -1) {
          deduplicated.uniqueResults[idx] = result;
        }
        seen.set(key, { result, index: idx });
      }
      
      // 记录重复项
      deduplicated.duplicates.push({
        original: existing.index,
        duplicate: idx,
        key: key
      });
    }
  });
  
  deduplicated.unique = deduplicated.uniqueResults.length;
  deduplicated.removed = deduplicated.total - deduplicated.unique;
  
  return deduplicated;
}

/**
 * 排序优化
 * @param {Array} results - 去重后的结果数组
 * @param {Object} options - 排序选项
 * @returns {Array} 排序后的结果
 */
function sortResults(results, options = {}) {
  const opts = {
    sortBy: ['priority', 'status'],  // 排序字段：priority, status, duration, timestamp
    sortOrder: 'desc',                  // 排序顺序：asc（升序）、desc（降序）
    priorityOrder: ['critical', 'high', 'medium', 'low'],  // 优先级顺序
    statusOrder: ['failed', 'error', 'skipped', 'passed'],   // 状态顺序（failed排前面）
    ...options
  };
  
  // 验证输入
  if (!Array.isArray(results)) {
    throw new Error('results必须为数组');
  }
  
  // 创建副本以避免修改原数组
  const sorted = [...results];
  
  // 排序
  sorted.sort((a, b) => {
    for (const field of opts.sortBy) {
      let cmp = 0;
      
      switch (field) {
        case 'priority':
          const priorityIdxA = opts.priorityOrder.indexOf(a.priority || 'medium');
          const priorityIdxB = opts.priorityOrder.indexOf(b.priority || 'medium');
          cmp = priorityIdxA - priorityIdxB;
          break;
          
        case 'status':
          const statusIdxA = opts.statusOrder.indexOf(a.status || 'unknown');
          const statusIdxB = opts.statusOrder.indexOf(b.status || 'unknown');
          cmp = statusIdxA - statusIdxB;
          break;
          
        case 'duration':
          cmp = (a.duration || 0) - (b.duration || 0);
          break;
          
        case 'timestamp':
          cmp = (a.timestamp || '').localeCompare(b.timestamp || '');
          break;
          
        default:
          cmp = 0;
      }
      
      // 根据排序顺序调整比较结果
      if (opts.sortOrder === 'desc') {
        cmp = -cmp;
      }
      
      // 如果比较结果不为0，则返回
      if (cmp !== 0) {
        return cmp;
      }
    }
    
    return 0;
  });
  
  return sorted;
}

/**
 * 生成聚合报告
 * @param {Object} aggregated - 聚合结果
 * @param {Object} options - 报告选项
 * @returns {Object} 聚合报告
 */
function generateReport(aggregated, options = {}) {
  const opts = {
    format: 'markdown',  // 报告格式：markdown, html, json
    includeDetails: true,  // 是否包含详细结果
    groupBy: 'status',     // 分组方式：status, priority, source
    ...options
  };
  
  // 验证输入
  if (!aggregated || typeof aggregated !== 'object') {
    throw new Error('aggregated必须为非空对象');
  }
  
  const report = {
    title: '测试聚合报告',
    timestamp: new Date().toISOString(),
    summary: aggregated.summary || '',
    total: aggregated.total || 0,
    passRate: aggregated.passRate || '0.00%',
    failureRate: aggregated.failureRate || '0.00%',
    details: [],
    content: '',
    format: opts.format.toLowerCase()  // 添加format字段
  };
  
  // 生成详细结果
  if (opts.includeDetails && aggregated.details) {
    // 按分组方式组织详细结果
    const groups = {};
    
    aggregated.details.forEach(detail => {
      const groupKey = detail[opts.groupBy] || 'unknown';
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(detail);
    });
    
    report.details = Object.keys(groups).map(groupKey => ({
      group: groupKey,
      count: groups[groupKey].length,
      items: groups[groupKey]
    }));
  }
  
  // 根据格式生成报告内容
  switch (opts.format.toLowerCase()) {
    case 'markdown':
      report.content = generateMarkdownReport(report);
      break;
      
    case 'html':
      report.content = generateHtmlReport(report);
      break;
      
    case 'json':
      report.content = JSON.stringify(report, null, 2);
      break;
      
    default:
      throw new Error(`不支持的报告格式：${opts.format}`);
  }
  
  return report;
}

/**
 * 生成Markdown格式报告
 * @param {Object} report - 报告数据
 * @returns {string} Markdown格式报告
 */
function generateMarkdownReport(report) {
  let md = `# ${report.title}\n\n`;
  md += `**生成时间**：${report.timestamp}\n\n`;
  md += `## 摘要\n\n`;
  md += `- 总测试数：${report.total}\n`;
  md += `- 通过率：${report.passRate}\n`;
  md += `- 失败率：${report.failureRate}\n\n`;
  
  if (report.details && report.details.length > 0) {
    md += `## 详细结果\n\n`;
    
    report.details.forEach(group => {
      md += `### ${group.group}（${group.count}个）\n\n`;
      
      group.items.forEach(item => {
        md += `- **${item.name}** (${item.id})\n`;
        md += `  - 状态：${item.status}\n`;
        md += `  - 优先级：${item.priority}\n`;
        md += `  - 来源：${item.source}\n`;
        if (item.message) {
          md += `  - 消息：${item.message}\n`;
        }
        md += `\n`;
      });
    });
  }
  
  return md;
}

/**
 * 生成HTML格式报告
 * @param {Object} report - 报告数据
 * @returns {string} HTML格式报告
 */
function generateHtmlReport(report) {
  let html = `<!DOCTYPE html>
<html>
<head>
  <title>${report.title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    h2 { color: #666; }
    h3 { color: #999; }
    .summary { background-color: #f5f5f5; padding: 10px; border-radius: 5px; }
    .detail-group { margin-left: 20px; }
    .passed { color: green; }
    .failed { color: red; }
    .skipped { color: orange; }
    .error { color: darkred; }
  </style>
</head>
<body>
  <h1>${report.title}</h1>
  <p><strong>生成时间</strong>：${report.timestamp}</p>
  
  <div class="summary">
    <h2>摘要</h2>
    <p>总测试数：${report.total}</p>
    <p>通过率：${report.passRate}</p>
    <p>失败率：${report.failureRate}</p>
  </div>
  
  <h2>详细结果</h2>
`;
  
  if (report.details && report.details.length > 0) {
    report.details.forEach(group => {
      html += `  <div class="detail-group">\n`;
      html += `    <h3>${group.group}（${group.count}个）</h3>\n`;
      html += `    <ul>\n`;
      
      group.items.forEach(item => {
        const statusClass = item.status || 'unknown';
        html += `      <li class="${statusClass}">\n`;
        html += `        <strong>${item.name}</strong> (${item.id})<br>\n`;
        html += `        状态：${item.status}<br>\n`;
        html += `        优先级：${item.priority}<br>\n`;
        html += `        来源：${item.source}<br>\n`;
        if (item.message) {
          html += `        消息：${item.message}<br>\n`;
        }
        html += `      </li>\n`;
      });
      
      html += `    </ul>\n`;
      html += `  </div>\n`;
    });
  }
  
  html += `</body>\n</html>`;
  
  return html;
}

/**
 * 执行结果聚合分析
 * @param {Object} options - 分析选项
 * @returns {Object} 结果聚合分析分析结果
 */
async function executeResultAggregator(options) {
  const { 
    results, 
    collectOptions = {},
    aggregateOptions = {},
    deduplicateOptions = {},
    sortOptions = {},
    reportOptions = {}
  } = options;
  
  // 验证输入
  if (!Array.isArray(results)) {
    throw new Error('results必须为数组');
  }
  
  const result = {
    collected: null,
    aggregated: null,
    deduplicated: null,
    sorted: null,
    report: null
  };
  
  // 1. 收集结果
  result.collected = collectResults(results);
  
  // 2. 聚合结果
  result.aggregated = aggregateResults(results, aggregateOptions);
  
  // 3. 去重处理
  result.deduplicated = deduplicateResults(results, deduplicateOptions);
  
  // 4. 排序优化
  result.sorted = sortResults(result.deduplicated.uniqueResults, sortOptions);
  
  // 5. 生成报告
  // 使用去重和排序后的结果生成聚合结果
  const aggregatedForReport = aggregateResults(result.sorted, aggregateOptions);
  result.report = generateReport(aggregatedForReport, reportOptions);
  
  return result;
}

module.exports = {
  collectResults,
  aggregateResults,
  deduplicateResults,
  sortResults,
  generateReport,
  executeResultAggregator
};
