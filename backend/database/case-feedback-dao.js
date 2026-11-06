/**
 * 用例反馈与质量度量 DAO（2026-11-06 · 阶段四）
 *
 * 两个职责：
 *   1. 记录人工对单条用例的「可用/不可用」判定（case_feedback）
 *   2. 落库每个任务的质量快照（task_quality_metrics）
 *
 * 有了这两张表才能：
 *   - 算出**真实可用率**（人工标记为准），校验门禁阈值设得对不对
 *   - 统计 top 拒绝原因，指导下一轮生成器/提示词改进
 *   - 把「被拒用例 + 原因」沉淀成反例注入提示词
 */
import { v4 as uuidv4 } from 'uuid';
import { query, pool } from './db.js';

// ============================================================
// 用例反馈
// ============================================================

/**
 * 保存/更新单条用例的人工判定（同一任务同一用例唯一）
 * @param {Object} input
 * @param {string} input.taskId
 * @param {string} input.caseId
 * @param {boolean} input.usable
 * @param {string} [input.rejectReason]
 * @param {string} [input.comment]
 * @param {string} [input.reviewer]
 */
export async function upsertCaseFeedback({ taskId, caseId, usable, rejectReason = null, comment = null, reviewer = null }) {
  if (!taskId || !caseId) throw new Error('taskId 与 caseId 必填');
  await query(
    `INSERT INTO case_feedback (id, task_id, case_id, usable, reject_reason, comment, reviewer)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       usable = VALUES(usable),
       reject_reason = VALUES(reject_reason),
       comment = VALUES(comment),
       reviewer = VALUES(reviewer),
       updated_at = NOW()`,
    [uuidv4(), taskId, String(caseId).slice(0, 32), usable ? 1 : 0, rejectReason, comment, reviewer],
  );
  return { taskId, caseId, usable };
}

/**
 * 批量保存（前端一次提交多条）
 * @param {string} taskId
 * @param {Array<{caseId:string, usable:boolean, rejectReason?:string, comment?:string}>} items
 * @param {string} [reviewer]
 * @returns {Promise<{saved:number}>}
 */
export async function bulkUpsertCaseFeedback(taskId, items, reviewer = null) {
  if (!Array.isArray(items) || !items.length) return { saved: 0 };
  let saved = 0;
  for (const it of items.slice(0, 2000)) {
    if (!it || !it.caseId) continue;
    await upsertCaseFeedback({
      taskId,
      caseId: it.caseId,
      usable: it.usable === true,
      rejectReason: it.rejectReason || null,
      comment: it.comment || null,
      reviewer,
    });
    saved += 1;
  }
  return { saved };
}

/** 读取某任务的反馈 */
export async function getCaseFeedback(taskId) {
  const rows = await query(
    'SELECT case_id, usable, reject_reason, comment, reviewer, updated_at FROM case_feedback WHERE task_id = ? ORDER BY case_id',
    [taskId],
  );
  return rows.map((r) => ({
    caseId: r.case_id,
    usable: r.usable === 1,
    rejectReason: r.reject_reason,
    comment: r.comment,
    reviewer: r.reviewer,
    updatedAt: r.updated_at,
  }));
}

/**
 * 真实可用率（以人工标记为准）
 * @param {string} taskId
 * @returns {Promise<{marked:number, usable:number, rate:number|null}>}
 */
export async function getHumanUsability(taskId) {
  const rows = await query(
    'SELECT COUNT(*) AS marked, SUM(usable) AS usable FROM case_feedback WHERE task_id = ?',
    [taskId],
  );
  const marked = Number(rows[0]?.marked) || 0;
  const usable = Number(rows[0]?.usable) || 0;
  return { marked, usable, rate: marked > 0 ? Math.round((usable / marked) * 1000) / 1000 : null };
}

/**
 * 拒绝原因统计（用于反例库与趋势）
 * @param {Object} [options]
 * @param {number} [options.days=30]
 * @param {number} [options.limit=20]
 */
export async function getRejectReasonStats({ days = 30, limit = 20 } = {}) {
  const rows = await query(
    `SELECT reject_reason, COUNT(*) AS cnt
       FROM case_feedback
      WHERE usable = 0 AND reject_reason IS NOT NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY reject_reason
      ORDER BY cnt DESC
      LIMIT ?`,
    [Number(days) || 30, Number(limit) || 20],
  );
  return rows.map((r) => ({ reason: r.reject_reason, count: Number(r.cnt) || 0 }));
}

// ============================================================
// 任务质量快照
// ============================================================

/**
 * 保存任务质量快照（每任务一条）
 * @param {Object} m
 */
export async function upsertTaskQuality(m) {
  if (!m || !m.taskId) return null;
  await query(
    `INSERT INTO task_quality_metrics
       (id, task_id, agent_id, total_cases, usable_cases, usability_gate, blocker_count,
        major_count, auto_repairs, repair_rounds, by_reason, gate_passed)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       total_cases = VALUES(total_cases),
       usable_cases = VALUES(usable_cases),
       usability_gate = VALUES(usability_gate),
       blocker_count = VALUES(blocker_count),
       major_count = VALUES(major_count),
       auto_repairs = VALUES(auto_repairs),
       repair_rounds = VALUES(repair_rounds),
       by_reason = VALUES(by_reason),
       gate_passed = VALUES(gate_passed)`,
    [
      uuidv4(),
      m.taskId,
      m.agentId || 'unknown',
      m.total || 0,
      m.usable || 0,
      typeof m.usabilityRate === 'number' ? m.usabilityRate : null,
      m.blockerCount || 0,
      m.majorCount || 0,
      m.autoRepairs || 0,
      m.repairRounds || 0,
      JSON.stringify(m.byReason || {}),
      m.pass ? 1 : 0,
    ],
  );
  return { taskId: m.taskId };
}

/** 回填人工可用率（供统计页展示真实值） */
export async function refreshHumanUsability(taskId) {
  const { rate } = await getHumanUsability(taskId);
  if (rate === null) return null;
  await query('UPDATE task_quality_metrics SET usability_human = ? WHERE task_id = ?', [rate, taskId]);
  return rate;
}

/**
 * 近期质量趋势（按天聚合）
 * @param {number} [days=30]
 */
export async function getQualityTrend(days = 30) {
  const rows = await query(
    `SELECT DATE(created_at) AS d,
            COUNT(*) AS tasks,
            AVG(usability_gate) AS avg_gate,
            AVG(usability_human) AS avg_human,
            SUM(gate_passed) AS passed
       FROM task_quality_metrics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY d`,
    [Number(days) || 30],
  );
  return rows.map((r) => ({
    date: r.d,
    tasks: Number(r.tasks) || 0,
    avgGate: r.avg_gate === null ? null : Number(r.avg_gate),
    avgHuman: r.avg_human === null ? null : Number(r.avg_human),
    passed: Number(r.passed) || 0,
  }));
}

/** 某任务的质量快照 */
export async function getTaskQuality(taskId) {
  const rows = await query('SELECT * FROM task_quality_metrics WHERE task_id = ? LIMIT 1', [taskId]);
  if (!rows.length) return null;
  const r = rows[0];
  let byReason = {};
  try { byReason = r.by_reason ? (typeof r.by_reason === 'string' ? JSON.parse(r.by_reason) : r.by_reason) : {}; } catch (_) { byReason = {}; }
  return {
    taskId: r.task_id,
    agentId: r.agent_id,
    total: r.total_cases,
    usable: r.usable_cases,
    usabilityGate: r.usability_gate === null ? null : Number(r.usability_gate),
    usabilityHuman: r.usability_human === null ? null : Number(r.usability_human),
    blockerCount: r.blocker_count,
    majorCount: r.major_count,
    autoRepairs: r.auto_repairs,
    repairRounds: r.repair_rounds,
    byReason,
    gatePassed: r.gate_passed === 1,
    createdAt: r.created_at,
  };
}

/**
 * 从历史被拒用例聚合「反例」（阶段四 4.2）
 * 输出可直接注入提示词的文本块
 * @param {number} [days=30]
 * @returns {Promise<{text:string, samples:Array}>}
 */
export async function buildCounterExamples(days = 30) {
  const rows = await query(
    `SELECT reject_reason, COUNT(*) AS cnt
       FROM case_feedback
      WHERE usable = 0 AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY reject_reason
      ORDER BY cnt DESC
      LIMIT 5`,
    [Number(days) || 30],
  );
  if (!rows.length) return { text: '', samples: [] };

  const LABELS = {
    assertion: '预期结果只写「功能正常」→ 必须写出可观测结果（状态码/字段值/文案/跳转/计数）',
    placeholder: '输入写「10位数字」「AAAAAA」→ 必须给符合业务规则的真实值',
    duplicate: '同一规则拆成多条用例 → 合并为 1 条并标注多方法',
    irrelevant: '覆盖了需求中不存在的功能 → 只测需求里的内容',
    wrong: '预期结果与需求矛盾 → 以原始需求为准',
    format: '表格列错位/字段留空 → 按模板结构填写',
  };

  const lines = ['【近期被人工判定不可用的用例类型（必须避免）】'];
  for (const r of rows) {
    const label = LABELS[r.reject_reason] || `拒绝原因 ${r.reject_reason}`;
    lines.push(`- ${label}（${Number(r.cnt)} 次）`);
  }
  return { text: lines.join('\n'), samples: rows.map((r) => ({ reason: r.reject_reason, count: Number(r.cnt) })) };
}

export default {
  upsertCaseFeedback,
  bulkUpsertCaseFeedback,
  getCaseFeedback,
  getHumanUsability,
  getRejectReasonStats,
  upsertTaskQuality,
  refreshHumanUsability,
  getQualityTrend,
  getTaskQuality,
  buildCounterExamples,
};
