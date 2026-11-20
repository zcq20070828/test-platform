/**
 * 智能体经验库 DAO（2026-11-20）
 *
 * 自我进化闭环的存储层：经验条目的增删改查、命中统计、进化决策落库。
 *
 * 关键约定：
 *   - `occurrences_before` / `occurrences_after` 是算「注入有没有用」的唯一依据：
 *     注入前记一次基线，注入后累计，命中率下降才算经验有效。
 *   - status 有四种：active（在用）/ watch（有效但样本不足）/ dormant（长期不出现，
 *     休眠省上下文）/ suppressed（人工废除，永不再用）。休眠的经验被重新命中会自动
 *     复活（resurrected），不会因为一次休眠就永久丢弃。
 */
import { randomUUID } from 'node:crypto';
import { query, pool } from './db.js';

/** 对外视图（前端看板用，不含内部实现细节） */
export function publicExperienceView(row) {
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agent_id,
    category: row.category,
    title: row.title,
    guidance: row.guidance,
    source: row.source,
    status: row.status,
    level: Number(row.level) || 1,
    occurrencesTotal: Number(row.occurrences_total) || 0,
    occurrencesBefore: Number(row.occurrences_before) || 0,
    occurrencesAfter: Number(row.occurrences_after) || 0,
    tasksBefore: Number(row.tasks_before) || 0,
    tasksAfter: Number(row.tasks_after) || 0,
    effectiveness: row.effectiveness === null || row.effectiveness === undefined
      ? null
      : Number(row.effectiveness),
    suppressedReason: row.suppressed_reason || null,
    samples: safeParseSamples(row.samples),
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    injectedSince: row.injected_since || null,
  };
}

function safeParseSamples(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * 记录一次命中（新建或累加）
 *
 * @param {Object} exp experience-normalizer 产出的候选
 * @param {Object} [ctx]
 * @param {string} ctx.agentId
 * @param {string} [ctx.taskId]
 * @param {boolean} [ctx.afterInjection] 该任务是否在「经验已注入」之后跑的
 */
export async function recordOccurrence(exp, ctx) {
  if (!exp || !exp.patternKey || !ctx?.agentId) return null;
  const { agentId, afterInjection = false } = ctx;

  const rows = await query(
    'SELECT * FROM agent_experiences WHERE agent_id = ? AND category = ? AND pattern_key = ? LIMIT 1',
    [agentId, exp.category, exp.patternKey],
  );
  const existing = rows[0];

  if (!existing) {
    const id = randomId();
    await pool.execute(
      `INSERT INTO agent_experiences
        (id, agent_id, category, pattern_key, title, guidance, source, samples,
         occurrences_total, occurrences_before, occurrences_after, tasks_before, status)
       VALUES (?,?,?,?,?,?,?,?,1,1,0,0,?)`,
      [
        id, agentId, exp.category, exp.patternKey,
        exp.title || exp.patternKey, exp.guidance || '', 'review',
        JSON.stringify(exp.sample ? [exp.sample] : []),
        'watch',
      ],
    );
    await logEvolution(id, agentId, 'created', null, 1, `首次命中：${String(exp.sample || exp.title || '').slice(0, 80)}`);
    return { id, created: true };
  }

  // 已存在：累加。注入前/后的计数分开记，才能算效果。
  const beforeInc = afterInjection ? 0 : 1;
  const afterInc = afterInjection ? 1 : 0;
  // 任务分母由 recordObservation 统一累加（含未命中的任务），这里不再重复加
  const tasksInc = 0;
  const tasksAfterInc = 0;

  // 样本最多留 3 条，去重
  const samples = safeParseSamples(existing.samples);
  if (exp.sample && !samples.includes(exp.sample) && samples.length < 3) {
    samples.push(exp.sample);
  }

  // 休眠/废除的经验被重新命中 → 复活（废除的除外：那是人工决定，必须尊重）
  let status = existing.status;
  let action = null;
  if (status === 'dormant') {
    status = 'watch';
    action = 'resurrected';
  }

  await pool.execute(
    `UPDATE agent_experiences
        SET occurrences_total = occurrences_total + 1,
            occurrences_before = occurrences_before + ?,
            occurrences_after = occurrences_after + ?,
            tasks_before = tasks_before + ?,
            tasks_after = tasks_after + ?,
            last_seen_at = CURRENT_TIMESTAMP,
            samples = ?,
            status = ?
      WHERE id = ?`,
    [beforeInc, afterInc, tasksInc, tasksAfterInc, JSON.stringify(samples), status, existing.id],
  );

  if (action) await logEvolution(existing.id, agentId, action, existing.level, existing.level, '休眠后又命中，自动恢复');
  return { id: existing.id, created: false, resurrected: action === 'resurrected' };
}

/**
 * 一个任务处理完毕时调用：批量记录该任务暴露出的所有经验
 *
 * @param {Object} params
 * @param {string} params.agentId
 * @param {string} params.taskId
 * @param {Array} params.candidates experience-normalizer 产出的候选数组
 * @param {boolean} [params.afterInjection] 该任务运行时经验是否已注入
 */
export async function recordTaskExperiences({ agentId, taskId, candidates, afterInjection = false }) {
  if (!agentId) return { recorded: 0, created: 0 };

  // 空候选 = 本任务没有暴露已知问题 → 这是一次「干净观测」，必须计入分母。
  // 否则「注入后问题消失」这件事无法被统计，经验永远升不了级（实测踩到）。
  if (!Array.isArray(candidates) || !candidates.length) {
    await recordObservation(agentId, afterInjection);
    return { recorded: 0, created: 0, observed: true };
  }
  let recorded = 0;
  let created = 0;
  // 本任务已算作一次观测 → 累加分母（命中任务同样要进分母）
  await recordObservation(agentId, afterInjection);

  // 同一任务内同类问题只计一次（一道题错了 20 条用例，不该算 20 次经验）
  const seen = new Set();
  for (const c of candidates) {
    if (!c || !c.patternKey) continue;
    if (seen.has(c.patternKey)) continue;
    seen.add(c.patternKey);
    try {
      const r = await recordOccurrence(c, { agentId, taskId, afterInjection });
      if (r) {
        recorded += 1;
        if (r.created) created += 1;
      }
    } catch (e) {
      console.warn(`[Experience] 记录经验失败 ${c.patternKey}: ${e.message}`);
    }
  }
  return { recorded, created };
}

/**
 * 记录一次「观测」：某个任务跑完了，但没有命中任何新经验
 *
 * 为什么必须记：效果 = 注入前后「每任务命中率」的对比。
 * 如果只记「命中」，分母（跑过多少任务）永远是 0，命中率就无法计算，
 * 经验永远停在「样本不足」，也就永远不会升级或休眠——
 * 实测就是这个症状：注入后问题消失了，反而看不出效果。
 *
 * 把「未命中的任务」也记上，才能得到「每 N 个任务命中几次」这个真实频率。
 *
 * @param {string} agentId
 * @param {boolean} afterInjection 该任务是否在注入后跑的
 */
export async function recordObservation(agentId, afterInjection = false) {
  if (!agentId) return 0;
  // 列名不用模板拼接（写错一个字符就是静默失效），分成两条明确语句
  const sql = afterInjection
    ? `UPDATE agent_experiences
          SET tasks_after = tasks_after + 1
        WHERE agent_id = ? AND status IN ('active','watch') AND injected_since IS NOT NULL`
    : `UPDATE agent_experiences
          SET tasks_before = tasks_before + 1
        WHERE agent_id = ? AND status IN ('active','watch')`;
  try {
    const [res] = await pool.execute(sql, [agentId]);
    return res.affectedRows || 0;
  } catch (e) {
    console.warn(`[Experience] 记录观测失败: ${e.message}`);
    return 0;
  }
}

/**
 * 取该智能体「当前应注入」的经验
 *
 * 只取 active / watch，suppressed 与 dormant 不注入（省上下文）。
 * 按「失败强度」排序：次数多、level 高的优先，限制条数以控制提示词体积。
 *
 * @param {string} agentId
 * @param {Object} [opts]
 * @param {number} [opts.limit=8]
 */
export async function getInjectableExperiences(agentId, opts = {}) {
  const limit = Math.max(1, Math.min(30, Number(opts.limit) || 8));
  try {
    const rows = await query(
      `SELECT * FROM agent_experiences
        WHERE agent_id = ? AND status IN ('active','watch')
        ORDER BY level DESC, occurrences_total DESC, last_seen_at DESC
        LIMIT ?`,
      [agentId, limit],
    );
    return rows.map(publicExperienceView);
  } catch (e) {
    console.warn(`[Experience] 读取经验失败: ${e.message}`);
    return [];
  }
}

/** 列表（看板用，含所有状态） */
export async function listExperiences({ agentId = null, status = null, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (agentId) { where.push('agent_id = ?'); params.push(agentId); }
  if (status) { where.push('status = ?'); params.push(status); }
  params.push(Math.max(1, Math.min(500, Number(limit) || 100)));
  const rows = await query(
    `SELECT * FROM agent_experiences
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY status ASC, occurrences_total DESC, last_seen_at DESC
      LIMIT ?`,
    params,
  );
  return rows.map(publicExperienceView);
}

/** 汇总统计（看板顶部数字） */
export async function experienceStats() {
  const rows = await query(
    `SELECT agent_id, status, COUNT(*) AS cnt,
            SUM(occurrences_total) AS occ,
            SUM(CASE WHEN effectiveness IS NOT NULL AND effectiveness > 0 THEN 1 ELSE 0 END) AS improved
       FROM agent_experiences
      GROUP BY agent_id, status`,
  );
  const byAgent = {};
  const totals = { all: 0, active: 0, watch: 0, dormant: 0, suppressed: 0, improved: 0, occurrences: 0 };
  for (const r of rows) {
    const cnt = Number(r.cnt) || 0;
    const occ = Number(r.occ) || 0;
    totals.all += cnt;
    totals.occurrences += occ;
    if (r.status === 'active') totals.active += cnt;
    else if (r.status === 'watch') totals.watch += cnt;
    else if (r.status === 'dormant') totals.dormant += cnt;
    else if (r.status === 'suppressed') totals.suppressed += cnt;
    totals.improved += Number(r.improved) || 0;

    if (!byAgent[r.agent_id]) byAgent[r.agent_id] = { all: 0, active: 0, watch: 0, dormant: 0, suppressed: 0 };
    byAgent[r.agent_id].all += cnt;
    if (byAgent[r.agent_id][r.status] !== undefined) byAgent[r.agent_id][r.status] += cnt;
  }
  return { totals, byAgent };
}

/** 人工废除 / 恢复 */
export async function setExperienceStatus(id, status, { reason = '', by = null } = {}) {
  const allowed = ['active', 'watch', 'dormant', 'suppressed'];
  if (!allowed.includes(status)) return false;
  const rows = await query('SELECT * FROM agent_experiences WHERE id = ? LIMIT 1', [id]);
  const rec = rows[0];
  if (!rec) return false;

  await pool.execute(
    'UPDATE agent_experiences SET status = ?, suppressed_reason = ? WHERE id = ?',
    [status, status === 'suppressed' ? String(reason || '人工废除').slice(0, 255) : null, id],
  );
  const action = status === 'suppressed' ? 'suppressed' : 'resurrected';
  await logEvolution(id, rec.agent_id, action, rec.level, rec.level,
    `${by ? by + ' ' : ''}${status === 'suppressed' ? '人工废除' : '人工恢复'}${reason ? '：' + reason : ''}`);
  return true;
}

/**
 * 进化：根据「注入前后命中率」决定升级 / 休眠
 *
 * 判定口径（有意保守，避免把噪声当效果）：
 *   - 注入后观测任务数 < MIN_TASKS → 不下结论，保持 watch
 *   - 命中率（每任务平均命中次数）下降 ≥ PROMOTE_DROP → 升级（说明提示起效，
 *     但还没根除，加强约束让模型更当回事）
 *   - 命中率下降 ≥ DORMANT_DROP 且注入后任务数足够 → 休眠（基本不再犯，省上下文）
 *   - 命中率反而上升 → 降级到 watch 并记录（说明这条提示没说到点上，需要人看）
 *
 * @returns {Promise<{promoted:number,dormant:number,demoted:number}>}
 */
export async function evolveExperiences(agentId, opts = {}) {
  const MIN_TASKS = Number(opts.minTasks) || 3;
  const PROMOTE_DROP = Number(opts.promoteDrop) || 0.3;
  const DORMANT_DROP = Number(opts.dormantDrop) || 0.7;

  const rows = await query(
    `SELECT * FROM agent_experiences
      WHERE agent_id = ? AND status IN ('active','watch')
        AND injected_since IS NOT NULL
        AND tasks_after >= ?
      LIMIT 100`,
    [agentId, MIN_TASKS],
  );

  let promoted = 0;
  let dormant = 0;
  let demoted = 0;

  for (const r of rows) {
    const eff = computeEffectiveness(r);
    if (eff === null) continue;

    let nextStatus = r.status;
    let nextLevel = Number(r.level) || 1;
    let action = null;
    let detail = '';

    if (eff >= DORMANT_DROP) {
      nextStatus = 'dormant';
      action = 'dormant';
      detail = `命中率下降 ${(eff * 100).toFixed(0)}%，基本不再犯，休眠省上下文`;
      dormant += 1;
    } else if (eff >= PROMOTE_DROP && nextLevel < 3) {
      nextLevel += 1;
      nextStatus = 'active';
      action = 'promoted';
      detail = `命中率下降 ${(eff * 100).toFixed(0)}%，提示有效但未根除，加强约束到 L${nextLevel}`;
      promoted += 1;
    } else if (eff < 0 && r.status === 'active') {
      nextLevel = Math.max(1, nextLevel - 1);
      nextStatus = 'watch';
      action = 'demoted';
      detail = `命中率上升 ${(-eff * 100).toFixed(0)}%，这条提示可能没说到点上，降级待人工复核`;
      demoted += 1;
    } else if (r.status === 'watch' && nextLevel === 1 && eff >= PROMOTE_DROP / 2) {
      // 有一定改善但没到升级线 → 转为 active（进入正式注入队列）
      nextStatus = 'active';
      action = 'promoted';
      detail = `命中率下降 ${(eff * 100).toFixed(0)}%，转为正式生效`;
      promoted += 1;
    }

    await pool.execute(
      'UPDATE agent_experiences SET status = ?, level = ?, effectiveness = ? WHERE id = ?',
      [nextStatus, nextLevel, eff.toFixed(4), r.id],
    );
    if (action) await logEvolution(r.id, agentId, action, Number(r.level) || 1, nextLevel, detail);
  }

  return { promoted, dormant, demoted };
}

/**
 * 计算经验的效果：注入前后「每任务平均命中次数」的下降比例
 * @returns {number|null} 0~1 表示下降比例；null 表示样本不足
 */
export function computeEffectiveness(row) {
  const tasksBefore = Number(row.tasks_before) || 0;
  const tasksAfter = Number(row.tasks_after) || 0;
  if (tasksBefore <= 0 || tasksAfter <= 0) return null;

  const rateBefore = (Number(row.occurrences_before) || 0) / tasksBefore;
  const rateAfter = (Number(row.occurrences_after) || 0) / tasksAfter;
  if (rateBefore <= 0) return null;
  // 下降为正，上升为负
  return (rateBefore - rateAfter) / rateBefore;
}

/** 标记某经验已开始注入（只标一次，作为效果统计的起算点） */
export async function markInjected(ids, agentId) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const [res] = await pool.execute(
    `UPDATE agent_experiences
        SET injected_since = COALESCE(injected_since, CURRENT_TIMESTAMP)
      WHERE agent_id = ? AND id IN (${placeholders})`,
    [agentId, ...ids],
  );
  return res.affectedRows || 0;
}

async function logEvolution(experienceId, agentId, action, fromLevel, toLevel, detail) {
  try {
    await pool.execute(
      `INSERT INTO experience_evolution_log (experience_id, agent_id, action, from_level, to_level, detail)
       VALUES (?,?,?,?,?,?)`,
      [experienceId, agentId, action, fromLevel ?? null, toLevel ?? null, String(detail || '').slice(0, 500)],
    );
  } catch (e) {
    console.warn(`[Experience] 写进化日志失败: ${e.message}`);
  }
}

export async function listEvolutionLog({ agentId = null, limit = 50 } = {}) {
  const params = [];
  let where = '';
  if (agentId) { where = 'WHERE agent_id = ?'; params.push(agentId); }
  params.push(Math.max(1, Math.min(200, Number(limit) || 50)));
  const rows = await query(
    `SELECT id, experience_id, agent_id, action, from_level, to_level, detail, created_at
       FROM experience_evolution_log ${where}
      ORDER BY id DESC LIMIT ?`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    experienceId: r.experience_id,
    agentId: r.agent_id,
    action: r.action,
    fromLevel: r.from_level,
    toLevel: r.to_level,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}

// ---------------- 阈值自动校准（用审核评分作弱标签）----------------

/** 读取用于校准的样本：门禁可用率 + 审核结论 */
export async function getThresholdSamples({ days = 90, agentId = null } = {}) {
  const params = [Number(days) || 90];
  let agentFilter = '';
  if (agentId) { agentFilter = 'AND agent_id = ?'; params.push(agentId); }
  try {
    const rows = await query(
      `SELECT task_id, usability_gate, review_median, review_verdict, gate_passed
         FROM task_quality_metrics
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND review_verdict IS NOT NULL
          ${agentFilter}
        ORDER BY created_at DESC
        LIMIT 2000`,
      params,
    );
    return rows.map((r) => ({
      taskId: r.task_id,
      usability: Number(r.usability_gate) || 0,
      reviewMedian: r.review_median === null ? null : Number(r.review_median),
      reviewVerdict: r.review_verdict,
      gatePassed: Number(r.gate_passed) === 1,
    }));
  } catch {
    return [];
  }
}

export async function saveThresholdChange({ threshold, previous, sampleTasks, agreement, source = 'auto_review', detail = '' }) {
  await pool.execute(
    `INSERT INTO gate_threshold_history (threshold, previous, sample_tasks, agreement, source, detail)
     VALUES (?,?,?,?,?,?)`,
    [threshold, previous ?? null, sampleTasks || 0,
      agreement === null || agreement === undefined ? null : agreement.toFixed(4),
      source, String(detail || '').slice(0, 500)],
  );
}

export async function listThresholdHistory(limit = 20) {
  const rows = await query(
    `SELECT threshold, previous, sample_tasks, agreement, source, detail, created_at
       FROM gate_threshold_history ORDER BY id DESC LIMIT ?`,
    [Math.max(1, Math.min(100, Number(limit) || 20))],
  );
  return rows.map((r) => ({
    threshold: Number(r.threshold),
    previous: r.previous === null ? null : Number(r.previous),
    sampleTasks: r.sample_tasks,
    agreement: r.agreement === null ? null : Number(r.agreement),
    source: r.source,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}

/** 与项目其它表一致：36 位 UUID */
function randomId() {
  return randomUUID();
}
