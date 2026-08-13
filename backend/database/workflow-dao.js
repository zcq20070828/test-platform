/**
 * workflow-dao.js — 工作流数据访问层
 * 替代 workflows 内存 Map，数据持久化到 MySQL
 */

import { query, getConnection } from './db.js';

export async function createWorkflow(workflow) {
  await query(
    `INSERT INTO workflows (id, user_id, input, status, steps, current_step,
     mode, scenario, manual_hours, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      workflow.id,
      workflow.userId || null,
      workflow.input || '',
      workflow.status || 'running',
      JSON.stringify(workflow.steps || []),
      workflow.currentStep || 0,
      workflow.mode || null,
      workflow.scenario || null,
      workflow.manualHours || null,
    ]
  );
}

export async function updateWorkflow(id, updates) {
  const fields = [];
  const vals = [];

  if ('status'        in updates) { fields.push('status         = ?'); vals.push(updates.status); }
  if ('currentStep'   in updates) { fields.push('current_step  = ?'); vals.push(updates.currentStep); }
  if ('results'       in updates) { fields.push('results        = ?'); vals.push(JSON.stringify(updates.results)); }
  if ('workflowResults' in updates){ fields.push('workflow_results = ?'); vals.push(JSON.stringify(updates.workflowResults)); }
  if ('manualHours'    in updates) { fields.push('manual_hours   = ?'); vals.push(updates.manualHours); }
  if ('completedAt'   in updates) {
    const ca = updates.completedAt;
    if (!ca) {
      vals.push(null);
    } else {
      const d = new Date(ca);
      vals.push(isNaN(d.getTime()) ? null : d.toLocaleString('sv', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T').slice(0, 19).replace('T', ' '));
    }
    fields.push('completed_at  = ?');
  }

  if (fields.length === 0) return;
  vals.push(id);
  await query(`UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`, vals);
}

export async function getWorkflow(id) {
  const rows = await query('SELECT * FROM workflows WHERE id = ?', [id]);
  return rows[0] ? formatWorkflow(rows[0]) : null;
}

export async function getWorkflows(filters = {}) {
  let sql = 'SELECT * FROM workflows WHERE 1=1';
  const params = [];

  if (filters.userId)   { sql += ' AND user_id = ?';        params.push(filters.userId); }
  if (filters.status)   { sql += ' AND status = ?';         params.push(filters.status); }
  if (filters.limit)    { sql += ' ORDER BY started_at DESC LIMIT ?'; params.push(filters.limit); }
  else                   { sql += ' ORDER BY started_at DESC'; }

  const rows = await query(sql, params);
  return rows.map(formatWorkflow);
}

export async function deleteWorkflow(id) {
  await query('DELETE FROM workflows WHERE id = ?', [id]);
}

/** 内存格式 ← DB 行 */
function formatWorkflow(row) {
  if (!row) return null;
  return {
    id:              row.id,
    userId:          row.user_id,
    input:           row.input,
    status:          row.status,
    steps:           parseJsonField(row.steps, []),
    currentStep:     row.current_step,
    results:         parseJsonField(row.results, []),
    workflowResults:  parseJsonField(row.workflow_results, null),
    manualHours:     row.manual_hours !== null ? Number(row.manual_hours) : null,
    mode:            row.mode,
    scenario:        row.scenario,
    startedAt:       row.started_at ? row.started_at.toISOString() : null,
    completedAt:     row.completed_at ? row.completed_at.toISOString() : null,
  };
}

/** 安全解析 JSON 字段:mysql2 已自动解析的 array/object 直接返回,字符串才 parse */
function parseJsonField(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    if (val === '') return fallback;
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val; // 已经是 object/array
}
