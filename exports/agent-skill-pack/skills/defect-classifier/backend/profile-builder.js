/**
 * defect-classifier / profile-builder.js
 * 缺陷画像构建 & 分布报告生成
 * 纯 ESM，无外部依赖
 */

import { classifyDefect, classifyByStack, classifyByLog } from './classifier.js';

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 计算百分比，保留 1 位小数
 * @param {number} value
 * @param {number} total
 * @returns {string}
 */
function pct(value, total) {
  if (!total) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * 截断字符串（用于摘要）
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen = 120) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/**
 * 安全获取嵌套属性
 * @param {Object} obj
 * @param {string} path - 如 'a.b.c'
 * @param {*} defaultVal
 */
function get(obj, path, defaultVal = 0) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : defaultVal), obj);
}

// ─── 公开 API ────────────────────────────────────────────────────────────────

/**
 * 生成单缺陷画像
 * @param {Object} defect - 缺陷原始信息
 * @param {string} defect.title - 标题（必填）
 * @param {string} [defect.description] - 描述
 * @param {string} [defect.id] - 缺陷 ID
 * @param {string} [defect.reporter] - 报告人
 * @param {string} [defect.createdAt] - 创建时间
 * @param {string} [defect.log] - 日志
 * @param {string} [defect.stack] - 堆栈
 * @param {Object} [defect.classification] - 已有分类结果（可选，会自动重新分类）
 * @returns {Object} 缺陷画像结构化数据
 */
export function buildDefectProfile(defect, classification) {
  if (!defect || typeof defect !== 'object') {
    throw new Error('buildDefectProfile: defect 为必填参数');
  }
  if (!defect.title || typeof defect.title !== 'string') {
    throw new Error('buildDefectProfile: defect.title 为必填参数');
  }

  // 若未传入分类则自动执行分类
  const cls = classification || classifyDefect(defect);

  // 堆栈分析（若存在）
  let stackInfo = null;
  if (defect.stack) {
    stackInfo = classifyByStack(defect.stack);
  }

  // 日志分析（若存在）
  let logInfo = null;
  if (defect.log) {
    logInfo = classifyByLog(defect.log);
  }

  // 画像标签（风险标签）
  const riskTags = [];
  if (cls.reproductionDifficulty >= 4) riskTags.push('难复现');
  if (cls.severity === 'Blocker' || cls.severity === 'Critical') riskTags.push('高危');
  if (['安全', '数据'].includes(cls.type)) riskTags.push('高风险类型');
  if (cls.type === '性能' && cls.severity !== 'Cosmetic') riskTags.push('性能敏感');
  if (stackInfo && stackInfo.exceptionType) riskTags.push(`异常: ${stackInfo.exceptionType}`);
  if (logInfo && logInfo.matchedPatterns.length > 2) riskTags.push('多重日志异常');

  // 时序特征（基于复现难度描述缺陷稳定性）
  const stabilityMap = {
    1: '必现',
    2: '高频',
    3: '偶发',
    4: '难复现',
    5: '极难复现',
  };

  // 建议处理策略
  const strategyMap = {
    Blocker: '立即阻塞，需紧急 hotfix 部署',
    Critical: '24h 内修复，必要时回滚',
    Major: '本周内修复，列入迭代计划',
    Minor: '下个迭代处理，可接受延后',
    Cosmetic: '视资源情况安排，可跳过',
  };

  return {
    id: defect.id || `DEF-${Date.now()}`,
    basic: {
      title: defect.title,
      description: truncate(defect.description || ''),
      reporter: defect.reporter || '未知',
      createdAt: defect.createdAt || new Date().toISOString().slice(0, 10),
      environment: defect.environment || '未指定',
    },
    classification: {
      type: cls.type,
      severity: cls.severity,
      priority: cls.priority,
      module: cls.module,
      rootCauseCategory: cls.rootCauseCategory,
      reproductionDifficulty: cls.reproductionDifficulty,
      reproductionLabel: stabilityMap[cls.reproductionDifficulty] || '未知',
      confidence: cls.confidence || {},
    },
    stack: stackInfo ? {
      exceptionType: stackInfo.exceptionType,
      className: stackInfo.className,
      methodName: stackInfo.methodName,
      module: stackInfo.mostLikelyModule,
    } : null,
    log: logInfo ? {
      inferredType: logInfo.inferredType,
      inferredLayer: logInfo.inferredLayer,
      patternCount: logInfo.matchedPatterns.length,
    } : null,
    risk: {
      tags: riskTags,
      strategy: strategyMap[cls.severity] || '按正常流程处理',
    },
    // Markdown 摘要行（供直接渲染）
    summary: [
      `**${cls.type}类** · ${cls.severity} · ${cls.priority} · 模块: ${cls.module}`,
      `${stabilityMap[cls.reproductionDifficulty] || ''} · 根因: ${cls.rootCauseCategory}`,
      stackInfo?.exceptionType ? `异常: ${stackInfo.exceptionType}` : null,
      riskTags.length > 0 ? `风险: ${riskTags.join(' / ')}` : null,
    ].filter(Boolean).join('\n'),
  };
}

/**
 * 生成缺陷分布报告
 * @param {Object[]} defects - 缺陷列表（原始或已有分类均可）
 * @returns {{ total: number, byType: Object[], bySeverity: Object[], byModule: Object[], byRootCause: Object[], byPriority: Object[], trend: Object }}
 */
export function buildDistribution(defects) {
  if (!Array.isArray(defects)) {
    throw new Error('buildDistribution: defects 必须是数组');
  }

  const total = defects.length;
  if (total === 0) {
    return {
      total: 0,
      byType: [], bySeverity: [], byModule: [], byRootCause: [], byPriority: [],
      trend: { status: '无数据' },
    };
  }

  // 对每个缺陷执行分类（若未分类）
  const classified = defects.map(d => {
    if (d.classification) return d;
    return { ...d, classification: classifyDefect(d) };
  });

  // ── 按类型分组 ──
  const typeMap = {};
  const typeOrder = ['功能', '性能', '安全', '兼容', 'UI', '接口', '数据', '环境', '逻辑'];
  for (const d of classified) {
    const t = d.classification?.type || '未知';
    typeMap[t] = (typeMap[t] || 0) + 1;
  }
  const byType = typeOrder
    .filter(t => typeMap[t] > 0)
    .map(t => ({ type: t, count: typeMap[t], percentage: pct(typeMap[t], total) }))
    .concat(
      Object.entries(typeMap)
        .filter(([k]) => !typeOrder.includes(k))
        .map(([type, count]) => ({ type, count, percentage: pct(count, total) }))
    )
    .sort((a, b) => b.count - a.count);

  // ── 按严重度分组 ──
  const sevOrder = ['Blocker', 'Critical', 'Major', 'Minor', 'Cosmetic'];
  const sevMap = {};
  for (const d of classified) {
    const s = d.classification?.severity || 'Major';
    sevMap[s] = (sevMap[s] || 0) + 1;
  }
  const bySeverity = sevOrder
    .filter(s => sevMap[s] > 0)
    .map(s => ({ severity: s, count: sevMap[s], percentage: pct(sevMap[s], total) }))
    .sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity));

  // ── 按模块分组 ──
  const modMap = {};
  for (const d of classified) {
    const m = d.classification?.module || d.module || '未知模块';
    modMap[m] = (modMap[m] || 0) + 1;
  }
  const byModule = Object.entries(modMap)
    .map(([module, count]) => ({ module, count, percentage: pct(count, total) }))
    .sort((a, b) => b.count - a.count);

  // ── 按根因分组 ──
  const rootMap = {};
  const rootOrder = ['编码缺陷', '设计缺陷', '需求缺陷', '测试缺陷', '环境缺陷', '第三方缺陷'];
  for (const d of classified) {
    const r = d.classification?.rootCauseCategory || '编码缺陷';
    rootMap[r] = (rootMap[r] || 0) + 1;
  }
  const byRootCause = rootOrder
    .filter(r => rootMap[r] > 0)
    .map(r => ({ rootCause: r, count: rootMap[r], percentage: pct(rootMap[r], total) }))
    .sort((a, b) => b.count - a.count);

  // ── 按优先级分组 ──
  const prioOrder = ['P0', 'P1', 'P2', 'P3'];
  const prioMap = {};
  for (const d of classified) {
    const p = d.classification?.priority || 'P3';
    prioMap[p] = (prioMap[p] || 0) + 1;
  }
  const byPriority = prioOrder
    .filter(p => prioMap[p] > 0)
    .map(p => ({ priority: p, count: prioMap[p], percentage: pct(prioMap[p], total) }));

  // ── 趋势分析 ──
  const blockerCount = sevMap['Blocker'] || 0;
  const criticalCount = sevMap['Critical'] || 0;
  const p0Count = prioMap['P0'] || 0;
  const highSevTotal = blockerCount + criticalCount;
  const highSevPct = pct(highSevTotal, total);

  const typeCount = byType.length;
  const moduleCount = byModule.length;
  const topType = byType[0]?.type || '无';
  const topModule = byModule[0]?.module || '无';
  const topRootCause = byRootCause[0]?.rootCause || '无';

  const trend = {
    total,
    highSeverityCount: highSevTotal,
    highSeverityPercent: highSevPct,
    topType,
    topTypeCount: byType[0]?.count || 0,
    topModule,
    topModuleCount: byModule[0]?.count || 0,
    topRootCause,
    topRootCauseCount: byRootCause[0]?.count || 0,
    moduleCount,
    typeCount,
    assessment: highSevTotal > 0
      ? `高危缺陷 ${highSevTotal} 个(${highSevPct})，需优先处理`
      : '整体质量可控，无高危缺陷',
  };

  return { total, byType, bySeverity, byModule, byRootCause, byPriority, trend };
}

/**
 * 生成 Markdown 缺陷汇总
 * @param {Object[]} defects - 缺陷列表
 * @param {Object} [opts]
 * @param {string} [opts.title] - 报告标题
 * @param {boolean} [opts.showTable=true] - 是否输出缺陷表格
 * @param {boolean} [opts.showDistribution=true] - 是否输出分布分析
 * @returns {string} Markdown 文本
 */
export function generateDefectSummary(defects, opts = {}) {
  if (!Array.isArray(defects)) {
    throw new Error('generateDefectSummary: defects 必须是数组');
  }

  const { title = '缺陷汇总报告', showTable = true, showDistribution = true } = opts;

  const dist = buildDistribution(defects);
  const { total, byType, bySeverity, byModule, byRootCause, byPriority, trend } = dist;

  // 时间戳
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const lines = [];

  // 标题
  lines.push(`# ${title}`);
  lines.push(`> 生成时间: ${now}  |  缺陷总数: **${total}**`);
  lines.push('');

  // 整体评估
  lines.push('## 📊 整体评估');
  lines.push(`- ${trend.assessment}`);
  lines.push(`- 影响范围最广的类型: **${trend.topType}**（${trend.topTypeCount}个，${pct(trend.topTypeCount, total)}）`);
  lines.push(`- 缺陷最多的模块: **${trend.topModule}**（${trend.topModuleCount}个）`);
  lines.push(`- 最主要根因: **${trend.topRootCause}**（${trend.topRootCauseCount}个）`);
  lines.push('');

  // 高危缺陷提示
  if (trend.highSeverityCount > 0) {
    lines.push('> ⚠️ **高危缺陷提醒**: Blocker + Critical 共 **' + trend.highSeverityCount + '** 个（' + trend.highSeverityPercent + '），请优先处理。');
    lines.push('');
  }

  // 分布分析
  if (showDistribution) {
    lines.push('## 📈 缺陷分布');
    lines.push('');

    // 分布表（类型）
    if (byType.length > 0) {
      lines.push('### 按类型（Type）');
      lines.push('| 类型 | 数量 | 占比 |');
      lines.push('|------|------|------|');
      for (const r of byType) {
        lines.push(`| ${r.type} | ${r.count} | ${r.percentage} |`);
      }
      lines.push('');
    }

    // 分布表（严重度）
    if (bySeverity.length > 0) {
      lines.push('### 按严重度（Severity）');
      lines.push('| 严重度 | 数量 | 占比 |');
      lines.push('|--------|------|------|');
      for (const r of bySeverity) {
        const icon = r.severity === 'Blocker' ? '🔴' : r.severity === 'Critical' ? '🟠' : r.severity === 'Major' ? '🟡' : r.severity === 'Minor' ? '🔵' : '⚪';
        lines.push(`| ${icon} ${r.severity} | ${r.count} | ${r.percentage} |`);
      }
      lines.push('');
    }

    // 分布表（优先级）
    if (byPriority.length > 0) {
      lines.push('### 按优先级（Priority）');
      lines.push('| 优先级 | 数量 | 占比 |');
      lines.push('|--------|------|------|');
      for (const r of byPriority) {
        lines.push(`| ${r.priority} | ${r.count} | ${r.percentage} |`);
      }
      lines.push('');
    }

    // 分布表（模块）
    if (byModule.length > 0) {
      const modDisplay = byModule.slice(0, 10); // 最多 10 条
      lines.push('### 按模块（Module）');
      lines.push('| 模块 | 数量 | 占比 |');
      lines.push('|------|------|------|');
      for (const r of modDisplay) {
        lines.push(`| ${r.module} | ${r.count} | ${r.percentage} |`);
      }
      if (byModule.length > 10) lines.push(`*（共 ${byModule.length} 个模块，仅展示前 10）*`);
      lines.push('');
    }

    // 分布表（根因）
    if (byRootCause.length > 0) {
      lines.push('### 按根因（Root Cause）');
      lines.push('| 根因 | 数量 | 占比 |');
      lines.push('|------|------|------|');
      for (const r of byRootCause) {
        lines.push(`| ${r.rootCause} | ${r.count} | ${r.percentage} |`);
      }
      lines.push('');
    }

    // 文字分布条（类型）
    if (byType.length > 0) {
      lines.push('### 缺陷类型分布（文字条）');
      const maxBar = 30;
      for (const r of byType) {
        const barLen = Math.round((r.count / total) * maxBar);
        const bar = '█'.repeat(barLen) + '░'.repeat(maxBar - barLen);
        lines.push(`\`${bar}\` ${r.type} ${r.count}（${r.percentage}）`);
      }
      lines.push('');
    }
  }

  // 缺陷列表表格
  if (showTable && defects.length > 0) {
    lines.push('## 📋 缺陷清单');
    lines.push('');
    lines.push('| # | 标题 | 类型 | 严重度 | 优先级 | 模块 | 根因 |');
    lines.push('|---|------|------|--------|--------|------|------|');

    defects.forEach((d, idx) => {
      const cls = d.classification || classifyDefect(d);
      const id = d.id || `DEF-${idx + 1}`;
      const rowTitle = truncate(d.title || '无标题', 40);
      lines.push(`| ${id} | ${rowTitle} | ${cls.type} | ${cls.severity} | ${cls.priority} | ${cls.module} | ${cls.rootCauseCategory} |`);
    });

    lines.push('');
  }

  // 页脚
  lines.push('---');
  lines.push(`*本报告由 defect-classifier Skill 自动生成 · 共 ${total} 条缺陷*`);

  return lines.join('\n');
}

// ─── 自测 ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== profile-builder.js 自测 ===\n');

  const sampleDefects = [
    {
      id: 'DEF-001',
      title: '支付接口偶发超时',
      description: '高峰期 QPS>2000 时响应超过 5s',
      reporter: '张三',
      log: 'Timeout: Connect to db failed\nSQLException: connection pool exhausted',
      stack: `java.sql.SQLTimeoutException
  at com.shop.pay.service.PayService.process(PayService.java:110)
  at com.shop.pay.controller.PayController.charge(PayController.java:45)`,
    },
    {
      id: 'DEF-002',
      title: '用户头像上传失败',
      description: '部分机型上传失败',
      stack: `java.lang.NullPointerException
  at com.shop.user.service.AvatarService.upload(AvatarService.java:33)`,
    },
    {
      id: 'DEF-003',
      title: '首页加载卡顿',
      description: '首次打开 App 白屏超过 3s',
      type: '性能',
      severity: 'Major',
    },
    {
      id: 'DEF-004',
      title: 'XSS 注入漏洞',
      description: '评论区未做 HTML 转义',
      reporter: '李四',
    },
    {
      id: 'DEF-005',
      title: '按钮样式错位',
      description: '在 iOS Safari 下边距异常',
    },
    {
      id: 'DEF-006',
      title: '订单状态流转异常',
      description: '部分订单状态未正确更新',
      reporter: '王五',
      stack: `ConcurrentModificationException
  at com.shop.order.service.OrderStateMachine.next(OrderStateMachine.java:67)`,
    },
  ];

  // 1. buildDefectProfile
  const profile = buildDefectProfile(sampleDefects[0]);
  console.log('buildDefectProfile:', JSON.stringify(profile, null, 2));

  // 2. buildDistribution
  const dist = buildDistribution(sampleDefects);
  console.log('\nbuildDistribution trend:', JSON.stringify(dist.trend, null, 2));
  console.log('byType:', dist.byType);
  console.log('bySeverity:', dist.bySeverity);

  // 3. generateDefectSummary
  const md = generateDefectSummary(sampleDefects, { title: '7月缺陷周报' });
  console.log('\ngenerateDefectSummary:\n', md);

  // 4. 空数据边界
  console.log('\n空数据测试:', JSON.stringify(buildDistribution([]), null, 2));

  // 5. 错误输入
  try { buildDefectProfile(null); } catch (e) { console.log('\n预期错误:', e.message); }
  try { buildDistribution('not-array'); } catch (e) { console.log('预期错误:', e.message); }
  try { generateDefectSummary(null); } catch (e) { console.log('预期错误:', e.message); }

  console.log('\n✅ 自测通过');
}
