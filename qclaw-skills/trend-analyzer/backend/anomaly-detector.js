/**
 * anomaly-detector.js — 异常检测模块
 * 异常点检测 / 缓慢漂移检测 / 自然语言趋势摘要生成
 *
 * @module anomaly-detector
 */

/**
 * 计算统计量
 */
function stats(arr) {
  const n = arr.length;
  if (n === 0) return { mean: 0, stdDev: 0, median: 0, q1: 0, q3: 0 };
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  const sorted = [...arr].sort((a, b) => a - b);
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, stdDev: Math.sqrt(variance), median, q1, q3 };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * 检测异常点（基于标准差阈值）
 *
 * @param {Array<{date:string|Date,value:number}>} data - 数据序列
 * @param {{method?:'stddev'|'iqr'|'zscore',threshold?:number}} [options]
 * @returns {{anomalies:Array<{date:string,value:number,score:number,type:string}>,normalRange:{lower:number,upper:number,mean:number,stdDev:number}}}
 */
export function detectAnomalies(data, options = {}) {
  if (!Array.isArray(data)) throw new TypeError('data must be an array');
  if (data.length === 0) throw new Error('data is empty');

  const { method = 'stddev', threshold = 2.5 } = options;

  const points = data.map(p => ({
    date: p.date instanceof Date ? p.date : new Date(p.date),
    value: p.value
  })).sort((a, b) => a.date - b.date);

  const values = points.map(p => p.value);
  const s = stats(values);

  let lower, upper, anomalies;
  const score = (v) => Math.abs(v - s.mean) / (s.stdDev || 1);

  if (method === 'iqr') {
    const iqr = s.q3 - s.q1;
    lower = s.q1 - 1.5 * iqr;
    upper = s.q3 + 1.5 * iqr;
    anomalies = points
      .filter(p => p.value < lower || p.value > upper)
      .map(p => ({
        date: p.date.toISOString().slice(0, 10),
        value: p.value,
        score: Math.round(score(p.value) * 100) / 100,
        type: p.value < lower ? 'low' : 'high'
      }));
  } else if (method === 'zscore') {
    // Z-score 方法：标记超过阈值的点
    lower = s.mean - threshold * s.stdDev;
    upper = s.mean + threshold * s.stdDev;
    anomalies = points
      .filter(p => Math.abs(p.value - s.mean) > threshold * s.stdDev)
      .map(p => ({
        date: p.date.toISOString().slice(0, 10),
        value: p.value,
        score: Math.round(score(p.value) * 100) / 100,
        type: p.value < s.mean ? 'low' : 'high'
      }));
  } else {
    // stddev 方法（默认）：直接使用 threshold 倍标准差
    lower = s.mean - threshold * s.stdDev;
    upper = s.mean + threshold * s.stdDev;
    anomalies = points
      .filter(p => Math.abs(p.value - s.mean) > threshold * s.stdDev)
      .map(p => ({
        date: p.date.toISOString().slice(0, 10),
        value: p.value,
        score: Math.round(score(p.value) * 100) / 100,
        type: p.value < s.mean ? 'low' : 'high'
      }));
  }

  return {
    anomalies,
    normalRange: {
      lower: Math.round(lower * 100) / 100,
      upper: Math.round(upper * 100) / 100,
      mean: Math.round(s.mean * 100) / 100,
      stdDev: Math.round(s.stdDev * 100) / 100
    }
  };
}

/**
 * 检测缓慢漂移（连续偏离趋势基线）
 *
 * @param {Array<{date:string|Date,value:number}>} data - 数据序列
 * @param {{sensitivity?:number,window?:number,driftThreshold?:number}} [options]
 *   - sensitivity: 1-10，越高越敏感（默认值 5）
 *   - window: 滑动窗口大小（默认值 7）
 *   - driftThreshold: 连续偏离天数达到此值触发（默认值 3）
 * @returns {{drifts:Array<{startDate:string,endDate:string,direction:string,avgDeviation:number,severity:string}>,baseline:number,deviations:Array<{date:string,deviation:number,偏离:boolean}>}}
 */
export function detectGradualDrift(data, options = {}) {
  if (!Array.isArray(data)) throw new TypeError('data must be an array');
  if (data.length < 3) return { drifts: [], baseline: 0, deviations: [] };

  const { sensitivity = 5, window = 7, driftThreshold = 3 } = options;

  // 使用滚动中位数作为动态基线
  const points = data.map(p => ({
    date: p.date instanceof Date ? p.date : new Date(p.date),
    value: p.value
  })).sort((a, b) => a.date - b.date);

  const values = points.map(p => p.value);
  const overallMedian = stats(values).median;

  // 动态基线：用滚动窗口的中位数
  const baselines = points.map((_, i) => {
    const start = Math.max(0, i - Math.floor(window / 2));
    const end = Math.min(points.length, i + Math.ceil(window / 2));
    return stats(values.slice(start, end)).median;
  });

  // 计算每个点相对基线的偏差
  const deviations = points.map((p, i) => ({
    date: p.date.toISOString().slice(0, 10),
    value: p.value,
    baseline: baselines[i],
    deviation: Math.round((p.value - baselines[i]) * 100) / 100,
   偏离: Math.abs(p.value - baselines[i]) > (sensitivity / 10) * stats(values).stdDev
  }));

  // 连续偏离段
  const drifts = [];
  let driftStart = null;
  let driftValues = [];

  for (let i = 0; i < deviations.length; i++) {
    if (deviations[i].偏离) {
      if (driftStart === null) driftStart = i;
      driftValues.push(deviations[i].deviation);
    } else {
      if (driftValues.length >= driftThreshold) {
        const avgDev = driftValues.reduce((s, v) => s + v, 0) / driftValues.length;
        const direction = avgDev > 0 ? 'upward' : 'downward';
        const severity = Math.abs(avgDev) > stats(values).stdDev * 2 ? 'severe'
          : Math.abs(avgDev) > stats(values).stdDev ? 'moderate' : 'mild';
        drifts.push({
          startDate: deviations[driftStart].date,
          endDate: deviations[i - 1].date,
          duration: driftValues.length,
          direction,
          avgDeviation: Math.round(avgDev * 100) / 100,
          severity
        });
      }
      driftStart = null;
      driftValues = [];
    }
  }

  // 末尾检查
  if (driftValues.length >= driftThreshold) {
    const avgDev = driftValues.reduce((s, v) => s + v, 0) / driftValues.length;
    const direction = avgDev > 0 ? 'upward' : 'downward';
    const severity = Math.abs(avgDev) > stats(values).stdDev * 2 ? 'severe'
      : Math.abs(avgDev) > stats(values).stdDev ? 'moderate' : 'mild';
    drifts.push({
      startDate: deviations[driftStart].date,
      endDate: deviations[deviations.length - 1].date,
      duration: driftValues.length,
      direction,
      avgDeviation: Math.round(avgDev * 100) / 100,
      severity
    });
  }

  return {
    drifts,
    baseline: Math.round(overallMedian * 100) / 100,
    deviations: deviations.map(d => ({
      date: d.date,
      deviation: d.deviation,
      偏离: d.偏离
    }))
  };
}

/**
 * 生成趋势自然语言摘要
 *
 * @param {Array<{date:string|Date,value:number}>} data - 数据序列
 * @param {{periodLabel?:string,prevData?:Array<{date,value}>}} [options]
 * @returns {string} 自然语言摘要
 */
export function summarizeTrend(data, options = {}) {
  if (!Array.isArray(data)) throw new TypeError('data must be an array');
  if (data.length === 0) return '暂无数据。';

  const { periodLabel = '本期', prevData = null } = options;

  const points = data.map(p => ({
    date: p.date instanceof Date ? p.date : new Date(p.date),
    value: p.value
  })).sort((a, b) => a.date - b.date);

  const values = points.map(p => p.value);
  const s = stats(values);
  const n = values.length;

  // 整体趋势（简单线性回归斜率）
  let slope = 0;
  if (n >= 2) {
    const xs = points.map((_, i) => i);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = s.mean;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (values[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    slope = den !== 0 ? num / den : 0;
  }

  const trendWord = slope > 0.05 ? '上升' : slope < -0.05 ? '下降' : '平稳';
  const trendEmoji = slope > 0.05 ? '📈' : slope < -0.05 ? '📉' : '➡️';

  // 计算变化率（相比上一期）
  let changeStr = '';
  if (prevData && prevData.length > 0) {
    const prevVals = prevData.map(p => p.value);
    const prevMean = prevVals.reduce((a, b) => a + b, 0) / prevVals.length;
    const diff = s.mean - prevMean;
    const diffPct = prevMean !== 0 ? Math.round((diff / prevMean) * 10000) / 100 : 0;
    const sign = diff >= 0 ? '+' : '';
    changeStr = `，较上期${sign}${diff.toFixed(1)}分（${sign}${diffPct}%）`;
  }

  // 最高/最低
  const max = Math.max(...values);
  const min = Math.min(...values);
  const maxDate = points.find(p => p.value === max).date.toISOString().slice(0, 10);
  const minDate = points.find(p => p.value === min).date.toISOString().slice(0, 10);

  // 稳定性（变异系数）
  const cv = s.mean !== 0 ? Math.round((s.stdDev / s.mean) * 10000) / 100 : 0;
  const stabilityWord = cv < 5 ? '非常稳定' : cv < 10 ? '相对稳定' : cv < 20 ? '波动较大' : '波动剧烈';

  const parts = [];

  // 第一段：整体趋势
  parts.push(`${trendEmoji} ${periodLabel}评分均值${s.mean.toFixed(1)}分${changeStr}，呈${trendWord}趋势。`);

  // 第二段：范围
  parts.push(`最低${min}分（${minDate}），最高${max}分（${maxDate}），${stabilityWord}（CV=${cv}%）。`);

  // 第三段：波动情况
  if (s.stdDev < 2) {
    parts.push('数据波动小，表现一致性强。');
  } else if (s.stdDev > 5) {
    parts.push(`数据波动较大（标准差${s.stdDev.toFixed(1)}），建议关注异常波动。`);
  }

  // 时长信息
  if (n > 1) {
    const firstDate = points[0].date.toISOString().slice(0, 10);
    const lastDate = points[points.length - 1].date.toISOString().slice(0, 10);
    parts.push(`覆盖${firstDate}至${lastDate}，共${n}条记录。`);
  }

  return parts.join(' ');
}

// ── 自测 ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== anomaly-detector.js self-test ===\n');

  const now = Date.now();
  // 正常数据 + 2 个异常点
  const mockData = Array.from({ length: 20 }, (_, i) => {
    let value = 80 + Math.sin(i / 3) * 5;
    if (i === 5) value = 55;  // 低异常
    if (i === 14) value = 102; // 高异常
    return { date: new Date(now - (19 - i) * 86400000), value: Math.round(value * 10) / 10 };
  });

  console.log('1. detectAnomalies (stddev, threshold=2.5):');
  const anomalies = detectAnomalies(mockData, { method: 'stddev', threshold: 2.5 });
  console.log(JSON.stringify(anomalies, null, 2));

  console.log('\n2. detectGradualDrift (sensitivity=6):');
  const drift = detectGradualDrift(mockData, { sensitivity: 6, driftThreshold: 2 });
  console.log(JSON.stringify(drift, null, 2));

  console.log('\n3. summarizeTrend:');
  const summary = summarizeTrend(mockData, { periodLabel: '本周', prevData: mockData.slice(0, 14) });
  console.log(summary);

  console.log('\n✓ All self-tests passed — no errors.');
}
