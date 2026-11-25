/**
 * 审核尺度漂移监测（2026-11-25 · 自我进化第三条）
 *
 * 要解决的问题
 *
 * 实测现象：用例交付物门禁可用率 98.3%（462 条里 454 条可执行），
 * 三审综合分却只有 74/78/80，中位数 78。差 20 分不是质量问题——
 * 是**审核尺度**问题：17 条 major 里相当一部分是「需求没写长度约束，
 * 用例补了 1/64 位边界」这类合理推断被判成编造。
 *
 * 为什么现有机制发现不了：
 *   - 自我进化只喂生成端（经验注入在生成 prompt），审核端不读经验库
 *   - 经验的效果判定只回答「这条经验有没有减少对应问题」，
 *     不回答「这个判定标准本身是否偏严」
 *
 * 本模块的判据（全部可确定性计算，不调 LLM）：
 *
 *   **同类 major 问题在多个任务里反复出现，而这些任务的可用率都很高**
 *   → 说明门禁认为可执行、审核却持续判重大缺陷。两者矛盾时，
 *     要么门禁漏了、要么审核偏严。结合「问题是否属于需求未定义而模型补充」
 *     这类特征，可以判定为尺度偏严并给出建议。
 *
 *   反向判据同样重要：**major 密集但可用率也低** → 门禁和审核一致，
 *   这是真质量问题，不该报漂移（否则会把真问题当误判放过）。
 */

/**
 * 从审核意见里识别「可能是尺度问题」的类别特征
 *
 * 只收那些「需求未定义、模型合理补充」会被归入的类别。
 * 纯格式/占位/重复类是硬伤，不在此列——它们被判 major 是应该的。
 */
const SCALE_SENSITIVE_CATEGORIES = new Set([
  'fact',        // 编造：可能是「需求没写，模型补了常见值」被误判成编造
  'requirement', // 需求一致性：可能是「超出需求范围」的合理扩展
  'coverage',    // 覆盖：可能是维度权重理解差异
  'traceability',// 追溯：可能是编号体系不同
]);

/** 明确属于硬伤的类别——它们高频不算尺度问题 */
const HARD_DEFECT_CATEGORIES = new Set([
  'placeholder', 'duplicate', 'format', 'assertion', 'logic',
]);

/**
 * 计算一次任务的「审核-门禁背离度」
 *
 * @param {Object} task
 * @param {number} task.usabilityRate    门禁可用率 0~1
 * @param {Array} task.notes             审核意见（含 severity/category）
 * @param {number} [task.totalCases]     用例总数（算密度用）
 * @returns {{divergent:boolean, reason:string, sensitiveMajor:number, hardMajor:number, majorDensity:number}}
 */
export function assessDivergence({ usabilityRate, notes, totalCases }) {
  const rate = Number(usabilityRate);
  const list = Array.isArray(notes) ? notes : [];
  const total = Number(totalCases) || 0;
  if (!Number.isFinite(rate) || !list.length || total <= 0) {
    return { divergent: false, reason: '数据不足', sensitiveMajor: 0, hardMajor: 0, majorDensity: 0 };
  }

  const majors = list.filter((n) => n && n.severity === 'major');
  const majorDensity = majors.length / total;

  const sensitiveMajor = majors.filter((n) => SCALE_SENSITIVE_CATEGORIES.has(String(n.category || ''))).length;
  const hardMajor = majors.filter((n) => HARD_DEFECT_CATEGORIES.has(String(n.category || ''))).length;

  // 判据（2026-11-25 用真实 20 个任务校准过）
  //
  //   可用率高（≥90%）+ major 以「尺度敏感类」为主 + 硬伤类 major 很少
  //
  // 初期阈值设 60% 时漏掉了真实案例（93a8fad4 是 5/17=29%，但那不是尺度问题，
  // 它确实有 12 条硬伤，判不背离是对的）。而 0135e5ac（3/4=75%）能命中。
  //
  // 现在定为：敏感类占 major 的 **50% 以上**，且硬伤类 ≤ 总数的 1%。
  // 门槛从 60% 降到 50%，因为「过半」已经说明矛盾主要集中在尺度上；
  // 同时保留硬伤上限，避免把真有硬伤的交付物误报成「尺度问题」而放松审核。
  const highUsability = rate >= 0.90;
  const sensitiveDominant = majors.length > 0 && sensitiveMajor / majors.length > 0.5;
  const fewHardDefects = hardMajor <= Math.max(1, total * 0.01);

  if (highUsability && sensitiveDominant && fewHardDefects) {
    return {
      divergent: true,
      reason: `可用率 ${(rate * 100).toFixed(1)}% 已达标，但 ${majors.length} 条 major 里 ${sensitiveMajor} 条属「需求未定义/合理补充」类，`
        + `硬伤仅 ${hardMajor} 条——审核尺度可能偏严`,
      sensitiveMajor,
      hardMajor,
      majorDensity: Math.round(majorDensity * 1000) / 10,
    };
  }

  return {
    divergent: false,
    reason: highUsability ? '审核与门禁基本一致' : '可用率低，major 判定与门禁一致（真质量问题）',
    sensitiveMajor,
    hardMajor,
    majorDensity: Math.round(majorDensity * 1000) / 10,
  };
}

/**
 * 从多条任务记录里汇总漂移信号
 *
 * 单个任务偶然背离不算漂移——可能是这个任务确实特殊。
 * 要求**同一智能体在多个任务上重复背离**才报，避免误报。
 *
 * @param {Array<{agentId:string, usabilityRate:number, notes:Array, totalCases:number, taskId:string}>} records
 * @param {Object} [opts]
 * @param {number} [opts.minTasks=3]     至少多少个任务发生背离才报
 * @param {number} [opts.windowSize=20]  只看最近多少个任务
 * @returns {{drifted:boolean, byAgent:Array, summary:string}}
 */
export function detectScaleDrift(records, opts = {}) {
  const minTasks = Number(opts.minTasks) ?? 3;
  const list = Array.isArray(records) ? records.slice(0, Number(opts.windowSize) || 20) : [];

  const byAgent = new Map();
  for (const r of list) {
    if (!r || !r.agentId) continue;
    const a = assessDivergence({
      usabilityRate: r.usabilityRate,
      notes: r.notes,
      totalCases: r.totalCases,
    });
    if (!byAgent.has(r.agentId)) {
      byAgent.set(r.agentId, { agentId: r.agentId, checked: 0, divergent: 0, samples: [], sensitive: 0, hard: 0 });
    }
    const bucket = byAgent.get(r.agentId);
    bucket.checked += 1;
    if (a.divergent) {
      bucket.divergent += 1;
      bucket.sensitive += a.sensitiveMajor;
      bucket.hard += a.hardMajor;
      if (bucket.samples.length < 3) {
        bucket.samples.push({ taskId: r.taskId, reason: a.reason });
      }
    }
  }

  const result = [...byAgent.values()]
    .filter((b) => b.divergent >= minTasks)
    .map((b) => ({
      agentId: b.agentId,
      divergentTasks: b.divergent,
      checkedTasks: b.checked,
      conditionallyFabricated: b.sensitive,
      hardDefects: b.hard,
      samples: b.samples,
      advice: `近 ${b.checked} 个任务里 ${b.divergent} 个出现「门禁达标但审核判大量 major」。`
        + `建议复核审核标准中「需求未定义即判编造」的尺度：`
        + `当原始需求未给约束、模型补充了常见业务约束时，应判 minor + 要求标注「推断」，而非 major 直接压分。`,
    }))
    .sort((a, b) => b.divergentTasks - a.divergentTasks);

  const drifted = result.length > 0;
  const summary = drifted
    ? result.map((r) => `${r.agentId}：${r.divergentTasks}/${r.checkedTasks} 个任务尺度偏离`).join('；')
    : '未发现审核尺度漂移';

  return { drifted, byAgent: result, summary };
}
