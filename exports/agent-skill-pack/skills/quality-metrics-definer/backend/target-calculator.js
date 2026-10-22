/**
 * target-calculator.js — 目标值计算器
 * 计算通过率、测试效率等量化指标，并支持 Markdown 格式化输出
 *
 * @module quality-metrics-definer/backend/target-calculator
 * @exports calcPassRateFloor
 * @exports calcTestEfficiency
 * @exports formatMetricsSummary
 */

/**
 * 计算最低通过率目标
 * 基于当前覆盖率与目标覆盖率的关系推导
 *
 * @param {number} currentCoverage - 当前代码覆盖率（0~1）
 * @param {number} targetCoverage - 目标覆盖率（0~1）
 * @returns {{ passRateFloor: number, status: string, reason: string }}
 */
export function calcPassRateFloor(currentCoverage, targetCoverage) {
  if (typeof currentCoverage !== 'number' || currentCoverage < 0 || currentCoverage > 1) {
    throw new Error('[calcPassRateFloor] currentCoverage 必须为 0~1 之间的数字');
  }
  if (typeof targetCoverage !== 'number' || targetCoverage < 0 || targetCoverage > 1) {
    throw new Error('[calcPassRateFloor] targetCoverage 必须为 0~1 之间的数字');
  }

  const ratio = currentCoverage / targetCoverage;

  let passRateFloor;
  let status;
  let reason;

  if (currentCoverage >= targetCoverage) {
    // 已达标：最低通过率贴近覆盖率本身
    passRateFloor = Math.min(1.0, targetCoverage * 0.98);
    status = '达标区间';
    reason = `当前覆盖率 ${(currentCoverage * 100).toFixed(1)}% 已达到或超过目标 ${(targetCoverage * 100).toFixed(1)}%，通过率下限可适度宽松`;
  } else if (ratio >= 0.9) {
    // 接近目标（差距 <10%）
    passRateFloor = Math.min(1.0, targetCoverage * 0.95);
    status = '接近达标';
    reason = `当前覆盖率 ${(currentCoverage * 100).toFixed(1)}% 接近目标 ${(targetCoverage * 100).toFixed(1)}%，差距 <10%，维持较高通过率要求`;
  } else if (ratio >= 0.7) {
    // 中等差距（10%~30%）
    passRateFloor = Math.min(1.0, targetCoverage * 0.90);
    status = '差距较大';
    reason = `当前覆盖率 ${(currentCoverage * 100).toFixed(1)}% 低于目标 ${(targetCoverage * 100).toFixed(1)}% 超过 10%，通过率要求适度降低以鼓励测试充分`;
  } else {
    // 严重落后（差距 ≥30%）
    passRateFloor = Math.min(1.0, targetCoverage * 0.85);
    status = '严重落后';
    reason = `当前覆盖率 ${(currentCoverage * 100).toFixed(1)}% 远低于目标 ${(targetCoverage * 100).toFixed(1)}%（差距 ≥30%），通过率门槛降至 85% 基准，避免无效阻塞`;
  }

  return {
    passRateFloor,
    display: `${(passRateFloor * 100).toFixed(1)}%`,
    status,
    reason,
  };
}

/**
 * 计算测试效率指标
 *
 * @param {number} defects - 发现的缺陷总数
 * @param {number} testcases - 执行的测试用例总数
 * @param {number} duration - 测试执行时长（分钟）
 * @returns {{ defectDiscoveryRate: number, testCaseEfficiency: number, avgDefectAge: number|null, reason: string }}
 */
export function calcTestEfficiency(defects, testcases, duration) {
  if (typeof defects !== 'number' || defects < 0 || !Number.isInteger(defects)) {
    throw new Error('[calcTestEfficiency] defects 必须为非负整数');
  }
  if (typeof testcases !== 'number' || testcases <= 0 || !Number.isInteger(testcases)) {
    throw new Error('[calcTestEfficiency] testcases 必须为正整数');
  }
  if (typeof duration !== 'number' || duration <= 0) {
    throw new Error('[calcTestEfficiency] duration 必须为正数（分钟）');
  }

  // 缺陷发现率（每百用例发现缺陷数）
  const defectDiscoveryRate = (defects / testcases) * 100;

  // 测试用例有效率（发现缺陷的用例占比估算，基于行业经验：平均约 15% 用例能发现缺陷）
  // 这里用缺陷密度来推断有效率：有效率 ≈ min(100%, defects/testcases * 100 / 0.15)
  const rawEfficiency = Math.min(1.0, (defects / testcases) / 0.15);
  const testCaseEfficiency = Math.round(rawEfficiency * 1000) / 10;

  // 每分钟执行的测试用例数
  const casesPerMinute = testcases / duration;

  let efficiencyLevel;
  if (defectDiscoveryRate >= 5) {
    efficiencyLevel = '极高';
  } else if (defectDiscoveryRate >= 2) {
    efficiencyLevel = '高';
  } else if (defectDiscoveryRate >= 0.5) {
    efficiencyLevel = '正常';
  } else if (defects === 0) {
    efficiencyLevel = '无缺陷（优质或待改进）';
  } else {
    efficiencyLevel = '偏低（建议检查用例质量或被测系统）';
  }

  return {
    defectDiscoveryRate: {
      value: defectDiscoveryRate,
      display: `${defectDiscoveryRate.toFixed(2)} 缺陷/百用例`,
    },
    testCaseEfficiency: {
      value: testCaseEfficiency / 100,
      display: `${testCaseEfficiency}%`,
    },
    casesPerMinute: {
      value: casesPerMinute,
      display: `${casesPerMinute.toFixed(1)} 用例/分钟`,
    },
    efficiencyLevel,
    reason: `基于 ${testcases} 条用例、${defects} 个缺陷、${duration} 分钟执行数据评估`,
  };
}

/**
 * 将指标集格式化为 Markdown 表格字符串
 *
 * @param {Object} metrics - 来自 defineMetrics 的指标集对象
 * @param {Object} [extraMetrics] - 额外的自定义指标（key: label, value: display）
 * @returns {string} Markdown 表格
 */
export function formatMetricsSummary(metrics, extraMetrics) {
  if (!metrics || typeof metrics !== 'object') {
    throw new Error('[formatMetricsSummary] metrics 参数必须为对象');
  }

  const rows = [
    ['测试覆盖率目标', metrics.testCoverageTarget?.display ?? 'N/A', metrics.testCoverageTarget?.reason ?? ''],
    ['缺陷密度阈值', metrics.defectDensityThreshold?.display ?? 'N/A', metrics.defectDensityThreshold?.reason ?? ''],
    ['回归测试比例', metrics.regressionRatio?.display ?? 'N/A', metrics.regressionRatio?.reason ?? ''],
    ['严重缺陷上限', metrics.criticalBlockerThreshold?.display ?? 'N/A', metrics.criticalBlockerThreshold?.reason ?? ''],
    ['通过率下限', metrics.passRateFloor?.display ?? 'N/A', metrics.passRateFloor?.reason ?? ''],
  ];

  // 合并额外指标
  if (extraMetrics && typeof extraMetrics === 'object') {
    for (const [key, val] of Object.entries(extraMetrics)) {
      if (val != null) {
        rows.push([key, String(val), '']);
      }
    }
  }

  // 构建 Markdown 表
  const header = '| 指标名称 | 目标值 | 说明 |\n|---|---|---|';
  const body = rows
    .map(([name, value, reason]) => `| ${name} | ${value} | ${reason} |`)
    .join('\n');

  // 附加严重度阈值子表（如有）
  let severitySection = '';
  if (metrics._internal?.defectSeverityThresholds) {
    const st = metrics._internal.defectSeverityThresholds;
    severitySection =
      '\n### 缺陷严重度阈值\n\n' +
      '| 严重度 | 上限 | 说明 |\n' +
      '|---|---|---|\n' +
      `| Critical（严重） | ${st.critical.max} | ${st.critical.label} |\n` +
      `| High（高） | ${st.high.max} | ${st.high.label} |\n` +
      `| Medium（中） | ${st.medium.max} | ${st.medium.label} |\n` +
      `| Low（低） | ${st.low.max >= 9999 ? '不限' : '≤' + st.low.max} | ${st.low.label} |\n`;
  }

  return `## 质量指标汇总

**模块**: ${metrics._internal?.module ?? '未知'} &nbsp;|&nbsp; **优先级**: ${metrics._internal?.priority ?? 'P2'}

${header}
${body}
${severitySection}

> 📌 以上指标基于测试需求分析自动生成，发布前请结合实际项目情况做最终确认。`;
}

// ============================================================
// 自测块
// ============================================================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== target-calculator.js 自测 ===\n');

  // 1. calcPassRateFloor
  console.log('1. calcPassRateFloor:');
  console.log('   已达标 (0.90/0.85):', JSON.stringify(calcPassRateFloor(0.90, 0.85)));
  console.log('   接近达标 (0.80/0.85):', JSON.stringify(calcPassRateFloor(0.80, 0.85)));
  console.log('   差距较大 (0.60/0.85):', JSON.stringify(calcPassRateFloor(0.60, 0.85)));
  console.log('   严重落后 (0.50/0.90):', JSON.stringify(calcPassRateFloor(0.50, 0.90)));

  try {
    calcPassRateFloor(1.5, 0.9);
  } catch (e) {
    console.log('   越界校验 ->', e.message, '✓');
  }

  // 2. calcTestEfficiency
  console.log('\n2. calcTestEfficiency:');
  console.log('   高效场景 (50缺陷/200用例/120min):');
  console.log(JSON.stringify(calcTestEfficiency(50, 200, 120), null, 2));
  console.log('   低效场景 (2缺陷/300用例/60min):');
  console.log(JSON.stringify(calcTestEfficiency(2, 300, 60), null, 2));
  console.log('   零缺陷场景 (0/150/45min):');
  console.log(JSON.stringify(calcTestEfficiency(0, 150, 45), null, 2));

  try {
    calcTestEfficiency(-1, 100, 60);
  } catch (e) {
    console.log('   负数校验 ->', e.message, '✓');
  }

  // 3. formatMetricsSummary
  console.log('\n3. formatMetricsSummary:');

  // 引入 metrics-definer 生成测试数据
  const { defineMetrics } = await import('./metrics-definer.js');
  const testMetrics = defineMetrics({
    module: '用户认证模块',
    priority: 'P1',
    currentCoverage: 0.88,
  });

  const formatted = formatMetricsSummary(testMetrics, {
    '额外指标-安全扫描覆盖率': '100%',
    '额外指标-自动化率': '≥90%',
  });
  console.log(formatted);

  console.log('\n=== 自测完成 ===');
}
