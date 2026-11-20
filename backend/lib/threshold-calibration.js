/**
 * 门禁阈值人工校准（2026-11-09）
 *
 * 问题：0.85 这个可用率阈值是设计时拍定的，从来没有用人工判定校验过。
 * 五个样本里两个不达标，但没人知道「门禁说 85% 达标」对应的人感是「够用」还是「勉强」。
 *
 * 校准思路（不引入新的人工口径，全部基于已有的 case_feedback）：
 *   1. 取一批同时有「门禁可用率」和「人工可用率」的任务作为样本；
 *   2. 对每个候选阈值 T，算出「门禁判为通过的任务，人工真实可用率是多少」(precision)
 *      和「通过的任务占比」(coverage)；
 *   3. 选出**最宽松**的 T，使 precision ≥ 目标人感线（默认 0.90，即
 *      「门禁放行的交付物，人工实际能用掉九成」）。
 *
 * 这样阈值不再是拍脑袋的常数，而是「你想要多高的人感质量，就该把门禁卡在哪」。
 *
 * 本模块是纯函数（不碰 DB），便于单测；取数由 server.js 的接口完成。
 */

export const DEFAULT_TARGET_HUMAN_RATE = 0.9;
export const MIN_SAMPLES = 5;
export const MIN_MARKED_CASES = 100;
export const THRESHOLD_RANGE = { min: 0.5, max: 0.99, step: 0.01 };

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

/**
 * 从样本里挑出可用样本
 * @param {Array<{taskId:string, gateRate:number|null, humanRate:number|null, marked?:number}>} samples
 */
export function usableSamples(samples) {
  return (Array.isArray(samples) ? samples : []).filter(
    (s) => s && typeof s.gateRate === 'number' && typeof s.humanRate === 'number',
  );
}

/**
 * 在给定阈值下评估门禁表现
 *
 * @param {Array} samples - usableSamples 的输出
 * @param {number} threshold
 * @returns {{threshold:number, passed:number, coverage:number, meanHumanRate:number|null, minHumanRate:number|null, falsePass:number, falseFail:number}}
 */
export function evaluateThreshold(samples, threshold) {
  const passed = samples.filter((s) => s.gateRate >= threshold);
  const failed = samples.filter((s) => s.gateRate < threshold);

  const humanOf = (list) => list.map((s) => s.humanRate);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  return {
    threshold: round3(threshold),
    passed: passed.length,
    coverage: samples.length ? round3(passed.length / samples.length) : 0,
    meanHumanRate: mean(humanOf(passed)) === null ? null : round3(mean(humanOf(passed))),
    minHumanRate: passed.length ? round3(Math.min(...humanOf(passed))) : null,
    // 门禁放行但人工实际很差（人感 < 0.5）：漏放
    falsePass: passed.filter((s) => s.humanRate < 0.5).length,
    // 门禁拦下但人工其实能用（人感 ≥ 0.9）：误拦
    falseFail: failed.filter((s) => s.humanRate >= 0.9).length,
  };
}

/**
 * 计算推荐阈值
 *
 * @param {Array} samples
 * @param {Object} [options]
 * @param {number} [options.targetHumanRate=0.9] - 期望的「门禁放行后的真实可用率」
 * @param {number} [options.currentThreshold] - 当前使用的阈值（用于对比）
 * @param {number} [options.markedCases] - 样本涉及的人工标记用例总数（用于判断样本是否足够）
 * @returns {Object}
 */
export function calibrateThreshold(samples, options = {}) {
  const target = Number(options.targetHumanRate ?? DEFAULT_TARGET_HUMAN_RATE);
  const current = options.currentThreshold != null ? Number(options.currentThreshold) : null;
  const markedCases = Number(options.markedCases ?? 0);
  const list = usableSamples(samples);

  const base = {
    sampleCount: list.length,
    markedCases,
    targetHumanRate: target,
    currentThreshold: current,
    current: current != null ? evaluateThreshold(list, current) : null,
  };

  if (!list.length) {
    return {
      ...base,
      status: 'no_data',
      recommended: null,
      message: '还没有任何任务同时具备门禁可用率与人工可用率，无法校准。请先在任务详情里逐条标记用例可用性。',
      curve: [],
    };
  }

  if (list.length < MIN_SAMPLES || markedCases < MIN_MARKED_CASES) {
    return {
      ...base,
      status: 'insufficient',
      recommended: null,
      message: `样本不足：当前 ${list.length} 个任务 / ${markedCases} 条人工标记，至少需要 ${MIN_SAMPLES} 个任务且 ${MIN_MARKED_CASES} 条标记后再校准。`,
      curve: buildCurve(list, target),
    };
  }

  const curve = buildCurve(list, target);
  const feasible = curve.filter((c) => c.meetsTarget);
  const recommended = feasible.length
    ? feasible.reduce((lo, c) => (c.threshold < lo.threshold ? c : lo), feasible[0])
    : null;

  if (!recommended) {
    return {
      ...base,
      status: 'infeasible',
      recommended: null,
      message: `在 ${THRESHOLD_RANGE.min}~${THRESHOLD_RANGE.max} 区间内，没有任何阈值能让放行交付物的人工可用率达到 ${(target * 100).toFixed(0)}%。说明门禁判定的缺陷类型与人工拒绝原因不一致，需要先统一判定口径（例如门禁新增「维度未标注」等人工也关心的项）。`,
      curve,
    };
  }

  const delta = current == null ? null : round3(recommended.threshold - current);
  const direction = delta == null ? 'n/a'
    : delta > 0 ? `应收紧 ${(delta * 100).toFixed(0)} 个百分点`
      : delta < 0 ? `可放宽 ${(-delta * 100).toFixed(0)} 个百分点`
        : '与当前阈值一致';

  return {
    ...base,
    status: 'ok',
    recommended: recommended.threshold,
    recommendedDetail: recommended,
    delta,
    message: `基于 ${list.length} 个任务 / ${markedCases} 条人工标记：推荐阈值 ${(recommended.threshold * 100).toFixed(0)}%（当前 ${current == null ? '未设置' : `${(current * 100).toFixed(0)}%`}，${direction}）。该阈值下被放行的任务，人工真实可用率均值 ${(recommended.meanHumanRate * 100).toFixed(1)}%，覆盖 ${(recommended.coverage * 100).toFixed(0)}% 的任务。`,
    curve,
  };
}

function buildCurve(samples, target) {
  const curve = [];
  const steps = Math.round((THRESHOLD_RANGE.max - THRESHOLD_RANGE.min) / THRESHOLD_RANGE.step);
  for (let i = 0; i <= steps; i += 1) {
    const threshold = round3(THRESHOLD_RANGE.min + i * THRESHOLD_RANGE.step);
    const e = evaluateThreshold(samples, threshold);
    curve.push({
      ...e,
      meetsTarget: e.meanHumanRate !== null && e.meanHumanRate >= target,
    });
  }
  return curve;
}

/**
 * 不一致明细：门禁与人工判断相反的样本，用于排查「门禁抓错了什么」
 * @param {Array} samples
 * @param {number} threshold
 */
export function listDisagreements(samples, threshold) {
  const list = usableSamples(samples);
  const out = [];
  for (const s of list) {
    const gatePass = s.gateRate >= threshold;
    const humanPass = s.humanRate >= 0.9;
    if (gatePass === humanPass) continue;
    out.push({
      taskId: s.taskId,
      gateRate: s.gateRate,
      humanRate: s.humanRate,
      marked: s.marked,
      type: gatePass ? 'false_pass' : 'false_fail',
      hint: gatePass
        ? '门禁放行但人工判定不可用率高，检查人工拒绝原因是否属于门禁未覆盖的类型'
        : '门禁拦下但人工基本可用，检查门禁是否对某些格式/编号过严',
    });
  }
  return out;
}

export default {
  DEFAULT_TARGET_HUMAN_RATE,
  MIN_SAMPLES,
  MIN_MARKED_CASES,
  THRESHOLD_RANGE,
  usableSamples,
  evaluateThreshold,
  calibrateThreshold,
  listDisagreements,
};

// ============================================================
// 审核弱标签自动校准（2026-11-20）
// ------------------------------------------------------------
// 上面的人工校准需要「逐条标记用例可用性」，实测几乎无人使用
// （case_feedback 全库只有 3 条），阈值因此永远停在默认 0.85。
//
// 但审核员每轮都在给评分——这是天然的弱标签，虽然不如人工精确，
// 但样本量足够，能形成闭环。本函数用「审核结论」反推阈值：
//
//   对每个候选阈值 t：把样本分成两组
//     t 以上（门禁认为合格）→ 期望审核也认为合格
//     t 以下（门禁认为不合格）→ 期望审核也不合格
//   一致率 = 两组各自与审核结论吻合的比例
//   选一致率最高、且「放行了审核认为不合格的」比例不超过容忍线的 t
//
// 生动地说：调阈值不是为了多放行，而是让「门禁的判断」和「审核的判断」尽量一致。
// ============================================================

/** 审核结论 → 是否「审核认为可用」 */
export function reviewUsable(verdict) {
  const v = String(verdict || '').toLowerCase();
  if (v === 'passed' || v === 'passed_with_notes') return true;
  if (v === 'failed' || v === 'veto') return false;
  return null; // inconclusive / null：不参与判定
}

/**
 * 用审核结论自动校准门禁阈值
 *
 * @param {Array<{usability:number, reviewVerdict:string}>} samples
 * @param {Object} [options]
 * @param {number} [options.currentThreshold=0.85]
 * @param {number} [options.minSamples=8] 少于此数不给结论（避免拿 3 个样本就改阈值）
 * @param {number} [options.maxFalsePassRate=0.25] 容忍「门禁放行但审核判不合格」的比例
 * @param {number} [options.minDelta=0.02] 与当前阈值差小于此值就不建议改（避免抖动）
 * @returns {Object}
 */
export function calibrateByReviewVerdict(samples, options = {}) {
  const list = (Array.isArray(samples) ? samples : [])
    .map((s) => ({
      usability: Number(s.usability),
      usable: reviewUsable(s.reviewVerdict),
    }))
    .filter((s) => Number.isFinite(s.usability) && s.usable !== null);

  const minSamples = Number(options.minSamples) || 8;
  const maxFalsePass = Number(options.maxFalsePassRate) || 0.25;
  const minDelta = Number(options.minDelta ?? 0.02);
  const current = options.currentThreshold != null ? Number(options.currentThreshold) : null;

  const base = {
    sampleCount: list.length,
    currentThreshold: current,
    labelSource: 'review_median',
    target: 'maximize agreement with review verdict',
  };

  if (list.length < minSamples) {
    return {
      ...base,
      status: 'insufficient',
      recommended: null,
      message: `样本不足：当前 ${list.length} 个同时具备门禁可用率与审核结论的任务，至少需要 ${minSamples} 个。继续跑任务即可自动积累。`,
      curve: [],
    };
  }

  // 候选阈值：0.60 ~ 0.95，步长 0.01
  const curve = [];
  for (let i = 60; i <= 95; i += 1) {
    const t = i / 100;
    let passTotal = 0;
    let passJudgedUsable = 0;
    let failTotal = 0;
    let failJudgedUnusable = 0;
    for (const s of list) {
      const gatePass = s.usability >= t;
      if (gatePass) {
        passTotal += 1;
        if (s.usable) passJudgedUsable += 1;
      } else {
        failTotal += 1;
        if (!s.usable) failJudgedUnusable += 1;
      }
    }
    const falsePass = passTotal ? 1 - passJudgedUsable / passTotal : 0;
    const recall = failTotal ? failJudgedUnusable / failTotal : 1;
    // 一致率 = 两组各自吻合的加权比例
    const agreement = list.length ? (passJudgedUsable + failJudgedUnusable) / list.length : 0;
    curve.push({
      threshold: Number(t.toFixed(2)),
      passCount: passTotal,
      falsePassRate: Number(falsePass.toFixed(4)),
      rejectRecall: Number(recall.toFixed(4)),
      agreement: Number(agreement.toFixed(4)),
    });
  }

  // 选阈值：先剔除「误放行超容忍线」的，再按一致率排序，一致率相同取更高的阈值。
  //
  // ⚠ 必须加「不得低于当前阈值」的硬约束。
  // 否则算法会为了拉高「一致率」而放松门禁：实测样本里审核判失败的任务门禁分都很高
  // （因为门禁只看可用率，看不出逻辑错误），于是一致率在低阈值处反而更高，
  // 算出「建议把 0.85 降到 0.67」——这是把质量门禁往松里调，方向完全错。
  //
  // 校准的语义是「让门禁更准」，不是「让通过率更好看」。所以只允许上调或不动。
  const currentPoint = current != null
    ? curve.find((c) => Math.abs(c.threshold - current) < 0.005) || null
    : null;

  const notLowerThanCurrent = (c) => current == null || c.threshold >= current - 0.0001;
  const viable = curve.filter((c) => c.falsePassRate <= maxFalsePass && notLowerThanCurrent(c));
  // 连「不低于当前」的候选都没有（说明当前阈值已是最严）→ 保持当前，不乱动
  const pool2 = viable.length ? viable : [];
  if (!pool2.length) {
    return {
      ...base,
      status: 'ok',
      recommended: current,
      best: null,
      currentPoint,
      delta: 0,
      applied: false,
      message: `当前阈值 ${current} 已处于合理区间（再调高会误杀合格交付物，调低会放松质量门禁），保持不动。`,
      curve,
    };
  }
  const best = [...pool2].sort((a, b) => (b.agreement - a.agreement) || (b.threshold - a.threshold))[0];

  // 差异太小就不改（避免每次跑完都微调，阈值来回抖）
  const delta = current != null && best ? Math.abs(best.threshold - current) : null;
  const shouldApply = best && (current == null || (delta !== null && delta >= minDelta));

  return {
    ...base,
    status: 'ok',
    recommended: shouldApply ? best.threshold : current,
    best,
    currentPoint,
    delta,
    applied: shouldApply,
    message: shouldApply
      ? `建议把阈值从 ${current ?? '(未设置)'} 调整为 ${best.threshold}：该阈值下门禁与审核的一致率 ${(best.agreement * 100).toFixed(1)}%，误放行率 ${(best.falsePassRate * 100).toFixed(1)}%。`
      : `当前阈值 ${current} 已接近最优（最佳 ${best?.threshold}，差异 ${delta === null ? '—' : (delta * 100).toFixed(1) + 'pp'} 小于 ${(minDelta * 100).toFixed(0)}pp），不建议调整。`,
    curve,
  };
}
