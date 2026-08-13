/**
 * trend-engine.js — 趋势分析引擎
 * 线性回归 / 移动平均 / 周期性检测 / 趋势分段 / 转折点识别
 *
 * @module trend-engine
 */

/**
 * 计算简单线性回归
 * @param {Array<{date:string|Date,value:number}>} points
 * @returns {{slope:number,intercept:number,rSquared:number}}
 */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.value ?? 0, rSquared: 1 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += points[i].value;
    sumXY += i * points[i].value;
    sumX2 += i * i;
    sumY2 += points[i].value * points[i].value;
  }
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const meanY = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * i;
    ssRes += (points[i].value - pred) ** 2;
    ssTot += (points[i].value - meanY) ** 2;
  }
  const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 1;
  return { slope, intercept, rSquared };
}

/**
 * 计算皮尔逊相关系数
 */
function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n === 0) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

/**
 * 检测数据周期性（月/周）
 * @param {Array<{date:Date,value:number}>} points
 * @returns {{periodicity:string|null,confidence:number}}
 */
function detectPeriodicity(points) {
  const n = points.length;
  if (n < 14) return { periodicity: null, confidence: 0 };

  const values = points.map(p => p.value);
  const diffs = [];
  for (let lag = 1; lag <= Math.min(31, Math.floor(n / 2)); lag++) {
    const xs = values.slice(0, n - lag);
    const ys = values.slice(lag);
    diffs.push({ lag, corr: pearsonCorrelation(xs, ys) });
  }

  // 找最大自相关（排除 lag=1 的低相关）
  const peak = diffs
    .filter(d => d.lag >= 3)
    .sort((a, b) => b.corr - a.corr)[0];

  if (!peak || peak.corr < 0.5) return { periodicity: null, confidence: 0 };

  const days = peak.lag;
  let periodicity;
  if (days >= 25 && days <= 35) periodicity = 'monthly';
  else if (days >= 5 && days <= 9) periodicity = 'weekly';
  else periodicity = `custom_${days}d`;

  return { periodicity, confidence: Math.round(peak.corr * 100) / 100 };
}

/**
 * 将数据划分为连续的趋势段（上升/平稳/下降）
 * @param {Array<{date:Date,value:number}>} points
 * @returns {Array<{start:number,end:number,direction:string,avg:number}>}
 */
function segmentTrend(points) {
  if (points.length < 3) {
    return [{
      start: 0,
      end: points.length - 1,
      direction: 'stable',
      avg: points.reduce((s, p) => s + p.value, 0) / (points.length || 1)
    }];
  }

  // 使用滚动线性回归（窗口=5）判断每段方向
  const windowSize = Math.min(5, Math.floor(points.length / 2));
  const segments = [];
  let segStart = 0;

  for (let i = windowSize; i < points.length; i++) {
    const window = points.slice(i - windowSize, i);
    const { slope } = linearRegression(window);
    const prevSlope = i > windowSize + 1
      ? linearRegression(points.slice(i - windowSize - 1, i)).slope
      : slope;

    // 转折点判断：斜率符号改变且幅度足够大
    const threshold = 0.05;
    const changed = (Math.sign(slope) !== Math.sign(prevSlope)) &&
      (Math.abs(slope - prevSlope) > threshold);

    if (changed) {
      const avg = points.slice(segStart, i).reduce((s, p) => s + p.value, 0) / (i - segStart);
      const dir = avgDirection(points.slice(segStart, i));
      segments.push({ start: segStart, end: i - 1, direction: dir, avg: Math.round(avg * 100) / 100 });
      segStart = i - 1;
    }
  }

  // 最后一个段
  if (segStart < points.length) {
    const tail = points.slice(segStart);
    const avg = tail.reduce((s, p) => s + p.value, 0) / tail.length;
    segments.push({
      start: segStart,
      end: points.length - 1,
      direction: avgDirection(tail),
      avg: Math.round(avg * 100) / 100
    });
  }

  return segments;
}

function avgDirection(points) {
  if (points.length < 2) return 'stable';
  const { slope } = linearRegression(points);
  if (slope > 0.05) return 'rising';
  if (slope < -0.05) return 'falling';
  return 'stable';
}

function buildMeta(points) {
  if (points.length === 0) return { totalPoints: 0, dateRange: { from: '', to: '' } };
  return {
    totalPoints: points.length,
    dateRange: {
      from: points[0].date.toISOString().slice(0, 10),
      to: points[points.length - 1].date.toISOString().slice(0, 10)
    }
  };
}

/**
 * 简单线性外推预测
 * @param {Array<{date:Date,value:number}>} points
 * @param {number} stepsAhead
 * @returns {Array<{date:Date,value:number}>}
 */
function forecast(points, stepsAhead = 3) {
  if (points.length < 3) return [];
  const { slope, intercept } = linearRegression(points);
  const lastIdx = points.length - 1;
  const lastDate = new Date(points[lastIdx].date);

  const result = [];
  for (let i = 1; i <= stepsAhead; i++) {
    const forecastDate = new Date(lastDate);
    forecastDate.setDate(forecastDate.getDate() + i * Math.ceil((points[points.length - 1].date - points[0].date) / (86400000 * (points.length - 1 || 1))) || 1);
    // 简化：假设每日递增
    const dailyStep = (points[points.length - 1].date - points[0].date) / (86400000 * (points.length - 1 || 1));
    forecastDate.setTime(lastDate.getTime() + i * dailyStep * 86400000);
    result.push({
      date: forecastDate,
      value: Math.round((intercept + slope * (lastIdx + i)) * 100) / 100
    });
  }
  return result;
}

/**
 * 主趋势分析入口
 *
 * @param {Array<{date:string|Date,value:number}>} dataPoints - 带时间戳的数据点
 * @param {{window?:number,forecastSteps?:number,minPoints?:number}} [options]
 * @returns {{direction:string,slope:number,changeRate:number,periodicity?:object,segments:Array,forecast?:Array,meta:{totalPoints:number,dateRange:{from:string,to:string}}}}
 */
export function analyzeTrend(dataPoints, options = {}) {
  // 输入校验
  if (!Array.isArray(dataPoints)) throw new TypeError('dataPoints must be an array');
  if (dataPoints.length === 0) throw new Error('dataPoints cannot be empty');
  for (const p of dataPoints) {
    if (p.value == null || typeof p.value !== 'number' || isNaN(p.value)) {
      throw new Error(`Invalid data point value: ${JSON.stringify(p)}`);
    }
  }

  const { window: maWindow = 7, forecastSteps = 3, minPoints = 3 } = options;

  const points = dataPoints.map(p => ({
    date: p.date instanceof Date ? p.date : new Date(p.date),
    value: p.value
  })).sort((a, b) => a.date - b.date);

  if (points.length < minPoints) {
    return {
      direction: 'unknown',
      slope: 0,
      changeRate: 0,
      segments: [],
      meta: buildMeta(points)
    };
  }

  const { slope, intercept, rSquared } = linearRegression(points);
  const { periodicity, confidence } = detectPeriodicity(points);
  const segments = segmentTrend(points);

  // 整体方向
  let direction = 'stable';
  if (slope > 0.05) direction = 'rising';
  else if (slope < -0.05) direction = 'falling';

  // 环比变化率（最后一段 vs 前面均值）
  const half = Math.floor(points.length / 2);
  const firstHalfAvg = points.slice(0, half).reduce((s, p) => s + p.value, 0) / (half || 1);
  const lastHalfAvg = points.slice(half).reduce((s, p) => s + p.value, 0) / (points.length - half);
  const changeRate = firstHalfAvg !== 0 ? Math.round(((lastHalfAvg - firstHalfAvg) / firstHalfAvg) * 10000) / 100 : 0;

  const result = {
    direction,
    slope: Math.round(slope * 10000) / 10000,
    rSquared: Math.round(rSquared * 10000) / 10000,
    changeRate,
    segments,
    meta: buildMeta(points)
  };

  if (periodicity) {
    result.periodicity = { type: periodicity, confidence };
  }

  if (forecastSteps > 0) {
    result.forecast = forecast(points, forecastSteps).map(f => ({
      date: f.date.toISOString().slice(0, 10),
      value: f.value
    }));
  }

  return result;
}

/**
 * 检测趋势转折点（从上升到下降或反之）
 *
 * @param {Array<{date:string|Date,value:number}>} data - 数据序列
 * @returns {Array<{index:number,date:string,from:string,to:string,value:number}>}
 */
export function detectChangePoints(data) {
  if (!Array.isArray(data)) throw new TypeError('data must be an array');
  if (data.length < 4) return [];

  const points = data.map(p => ({
    date: p.date instanceof Date ? p.date : new Date(p.date),
    value: p.value
  })).sort((a, b) => a.date - b.date);

  const windowSize = Math.min(5, Math.floor(points.length / 3));
  const changes = [];

  for (let i = windowSize; i < points.length - windowSize; i++) {
    const before = points.slice(i - windowSize, i);
    const after = points.slice(i, i + windowSize);
    const slopeBefore = linearRegression(before).slope;
    const slopeAfter = linearRegression(after).slope;

    if (Math.sign(slopeBefore) !== 0 && Math.sign(slopeAfter) !== 0 &&
      Math.sign(slopeBefore) !== Math.sign(slopeAfter)) {
      // 避免重复记录相邻转折点
      if (changes.length === 0 || i - changes[changes.length - 1].index >= windowSize) {
        changes.push({
          index: i,
          date: points[i].date.toISOString().slice(0, 10),
          from: slopeBefore > 0 ? 'rising' : 'falling',
          to: slopeAfter > 0 ? 'rising' : 'falling',
          value: points[i].value
        });
      }
    }
  }

  return changes;
}

/**
 * 计算移动平均
 *
 * @param {Array<{date:string|Date,value:number}>} data - 数据序列
 * @param {number} window - 窗口大小（默认7）
 * @returns {Array<{date:string,value:number}>}
 */
export function calculateMovingAverage(data, window = 7) {
  if (!Array.isArray(data)) throw new TypeError('data must be an array');
  if (window < 1) throw new RangeError('window must be >= 1');
  if (data.length === 0) return [];

  const points = data.map(p => ({
    date: p.date instanceof Date ? p.date : new Date(p.date),
    value: p.value
  })).sort((a, b) => a.date - b.date);

  const result = [];
  for (let i = 0; i < points.length; i++) {
    if (i < window - 1) {
      // 前面的点用已知数据平均
      const slice = points.slice(0, i + 1);
      const avg = slice.reduce((s, p) => s + p.value, 0) / slice.length;
      result.push({
        date: points[i].date.toISOString().slice(0, 10),
        value: Math.round(avg * 100) / 100,
        _partial: true
      });
    } else {
      const slice = points.slice(i - window + 1, i + 1);
      const avg = slice.reduce((s, p) => s + p.value, 0) / window;
      result.push({
        date: points[i].date.toISOString().slice(0, 10),
        value: Math.round(avg * 100) / 100
      });
    }
  }

  return result;
}

/**
 * 比较两个时间段的关键指标差异
 *
 * @param {Array<{date:string|Date,value:number}>} data - 完整数据序列
 * @param {{start:string|Date,end:string|Date}} periodA - 第一个时间段
 * @param {{start:string|Date,end:string|Date}} periodB - 第二个时间段
 * @returns {{periodA:{range:{from:string,to:string},count:number,avg:number,min:number,max:number,stdDev:number},periodB:{range:{from:string,to:string},count:number,avg:number,min:number,max:number,stdDev:number},comparison:{avgDiff:number,avgDiffPct:number,maxDiff:number,minDiff:number,trendShift:string}}}
 */
export function comparePeriods(data, periodA, periodB) {
  if (!Array.isArray(data)) throw new TypeError('data must be an array');
  if (!periodA?.start || !periodA?.end) throw new Error('periodA requires start and end');
  if (!periodB?.start || !periodB?.end) throw new Error('periodB requires start and end');

  const parseDate = d => d instanceof Date ? d : new Date(d);
  const startA = parseDate(periodA.start);
  const endA = parseDate(periodA.end);
  const startB = parseDate(periodB.start);
  const endB = parseDate(periodB.end);

  const filterPeriod = (points, s, e) =>
    points.filter(p => p.date >= s && p.date <= e);

  const points = data.map(p => ({
    date: p.date instanceof Date ? p.date : new Date(p.date),
    value: p.value
  })).sort((a, b) => a.date - b.date);

  const pa = filterPeriod(points, startA, endA);
  const pb = filterPeriod(points, startB, endB);

  const summary = (arr, s, e) => {
    if (arr.length === 0) return { range: { from: '', to: '' }, count: 0, avg: 0, min: 0, max: 0, stdDev: 0 };
    const avg = arr.reduce((sum, p) => sum + p.value, 0) / arr.length;
    const min = Math.min(...arr.map(p => p.value));
    const max = Math.max(...arr.map(p => p.value));
    const variance = arr.reduce((sum, p) => sum + (p.value - avg) ** 2, 0) / arr.length;
    return {
      range: { from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) },
      count: arr.length,
      avg: Math.round(avg * 100) / 100,
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      stdDev: Math.round(Math.sqrt(variance) * 100) / 100
    };
  };

  const sa = summary(pa, startA, endA);
  const sb = summary(pb, startB, endB);

  const avgDiff = Math.round((sb.avg - sa.avg) * 100) / 100;
  const avgDiffPct = sa.avg !== 0 ? Math.round((avgDiff / sa.avg) * 10000) / 100 : 0;
  const maxDiff = Math.round((sb.max - sa.max) * 100) / 100;
  const minDiff = Math.round((sb.min - sa.min) * 100) / 100;

  let trendShift = 'stable';
  if (avgDiffPct > 5) trendShift = 'improving';
  else if (avgDiffPct < -5) trendShift = 'declining';

  return {
    periodA: sa,
    periodB: sb,
    comparison: { avgDiff, avgDiffPct, maxDiff, minDiff, trendShift }
  };
}

// ── 自测 ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== trend-engine.js self-test ===\n');

  // 模拟 30 天评估数据
  const now = Date.now();
  const mockData = Array.from({ length: 30 }, (_, i) => {
    const base = 70 + i * 0.8; // 整体上升趋势
    const noise = (Math.random() - 0.5) * 8;
    const weekly = Math.sin((i / 7) * Math.PI * 2) * 3;
    return {
      date: new Date(now - (29 - i) * 86400000),
      value: Math.round((base + noise + weekly) * 10) / 10
    };
  });

  console.log('1. analyzeTrend:');
  const trend = analyzeTrend(mockData, { window: 7, forecastSteps: 3 });
  console.log(JSON.stringify(trend, null, 2));

  console.log('\n2. detectChangePoints:');
  const cps = detectChangePoints(mockData);
  console.log(JSON.stringify(cps, null, 2));

  console.log('\n3. calculateMovingAverage (window=7):');
  const ma = calculateMovingAverage(mockData, 7);
  console.log(ma.slice(0, 5));

  console.log('\n4. comparePeriods:');
  const comp = comparePeriods(
    mockData,
    { start: mockData[0].date, end: mockData[14].date },
    { start: mockData[15].date, end: mockData[29].date }
  );
  console.log(JSON.stringify(comp, null, 2));

  console.log('\n✓ All self-tests passed — no errors.');
}
