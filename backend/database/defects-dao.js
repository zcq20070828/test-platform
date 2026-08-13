/**
 * 缺陷数据访问对象 (DAO)
 * 提供缺陷的 CRUD 操作
 */

import { query } from './db.js';

/**
 * 创建缺陷
 */
async function createDefect(data) {
  const sql = `
    INSERT INTO defects (
      task_id, session_id, severity, defect_type, module,
      title, description, status, found_by, reporter_id,
      assignee_id, priority, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;
  const params = [
    data.taskId || null,
    data.sessionId || null,
    data.severity || 'minor',
    data.defectType || null,
    data.module || null,
    data.title,
    data.description || null,
    data.status || 'open',
    data.foundBy || 'ai',
    data.reporterId || null,
    data.assigneeId || null,
    data.priority || 'P2',
  ];
  const result = await query(sql, params);
  return result.insertId;
}

/**
 * 根据 ID 获取缺陷
 */
async function getDefect(id) {
  const sql = 'SELECT * FROM defects WHERE id = ?';
  const rows = await query(sql, [id]);
  if (rows.length === 0) return null;
  return formatDefect(rows[0]);
}

/**
 * 列出缺陷(支持分页和过滤)
 * filters: { taskId, sessionId, status, severity, foundBy, page, size }
 */
async function listDefects(filters = {}) {
  const page = parseInt(filters.page) || 1;
  const size = Math.min(parseInt(filters.size) || 20, 100);
  const offset = (page - 1) * size;

  const conditions = [];
  const params = [];

  if (filters.taskId) {
    conditions.push('task_id = ?');
    params.push(filters.taskId);
  }
  if (filters.sessionId) {
    conditions.push('session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.severity) {
    conditions.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters.foundBy) {
    conditions.push('found_by = ?');
    params.push(filters.foundBy);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 查询总数
  const countSql = `SELECT COUNT(*) as total FROM defects ${where}`;
  const countRows = await query(countSql, params);
  const total = countRows[0].total;

  // 查询列表
  const listSql = `
    SELECT * FROM defects ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  const listRows = await query(listSql, [...params, size, offset]);

  return {
    items: listRows.map(formatDefect),
    total,
    page,
    size,
    pages: Math.ceil(total / size),
  };
}

/**
 * 更新缺陷(仅允许更新部分字段)
 */
async function updateDefect(id, data) {
  const allowedFields = ['status', 'assignee_id', 'reporter_id', 'priority', 'title', 'description'];
  const updates = [];
  const params = [];

  const fieldMap = {
    status: 'status',
    assigneeId: 'assignee_id',
    assignee_id: 'assignee_id',
    reporterId: 'reporter_id',
    reporter_id: 'reporter_id',
    priority: 'priority',
    title: 'title',
    description: 'description',
  };

  for (const [key, value] of Object.entries(data)) {
    const dbField = fieldMap[key];
    if (dbField && allowedFields.includes(dbField)) {
      updates.push(`${dbField} = ?`);
      params.push(value);
    }
  }

  if (updates.length === 0) return 0;

  // 自动更新状态时间戳
  if (data.status === 'fixed' || data.status === 'closed') {
    updates.push('fixed_at = IF(?, NOW(), fixed_at)');
    params.push(data.status === 'fixed' ? 1 : 0);
  }
  if (data.status === 'closed') {
    updates.push('closed_at = NOW()');
  }
  if (data.status === 'verified' || data.status === 'closed') {
    updates.push('verified_at = NOW()');
  }

  params.push(id);
  const sql = `UPDATE defects SET ${updates.join(', ')} WHERE id = ?`;
  const result = await query(sql, params);
  return result.affectedRows;
}

/**
 * 删除缺陷(物理删除)
 */
async function deleteDefect(id) {
  const sql = 'DELETE FROM defects WHERE id = ?';
  const result = await query(sql, [id]);
  return result.affectedRows;
}

/**
 * 获取缺陷聚合统计
 * filters: { startDate, endDate, taskId, sessionId }
 */
async function getDefectStats(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.startDate) {
    conditions.push('created_at >= ?');
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push('created_at <= ?');
    params.push(filters.endDate);
  }
  if (filters.taskId) {
    conditions.push('task_id = ?');
    params.push(filters.taskId);
  }
  if (filters.sessionId) {
    conditions.push('session_id = ?');
    params.push(filters.sessionId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 按严重程度统计
  const bySeveritySql = `
    SELECT severity, COUNT(*) as count
    FROM defects ${where}
    GROUP BY severity
    ORDER BY FIELD(severity, 'critical', 'major', 'minor', 'suggestion')
  `;

  // 按状态统计
  const byStatusSql = `
    SELECT status, COUNT(*) as count
    FROM defects ${where}
    GROUP BY status
    ORDER BY FIELD(status, 'open', 'in_progress', 'fixed', 'closed', 'rejected')
  `;

  // 按发现方式统计
  const byFoundBySql = `
    SELECT found_by, COUNT(*) as count
    FROM defects ${where}
    GROUP BY found_by
  `;

  // 按类型统计
  const byTypeSql = `
    SELECT defect_type, COUNT(*) as count
    FROM defects ${where}
    GROUP BY defect_type
    ORDER BY count DESC
  `;

  // 总数
  const totalSql = `SELECT COUNT(*) as total FROM defects ${where}`;

  const [bySeverity, byStatus, byFoundBy, byType, totalRows] = await Promise.all([
    query(bySeveritySql, params),
    query(byStatusSql, params),
    query(byFoundBySql, params),
    query(byTypeSql, params),
    query(totalSql, params),
  ]);

  return {
    total: totalRows[0].total,
    bySeverity: bySeverity.map(r => ({ severity: r.severity, count: r.count })),
    byStatus: byStatus.map(r => ({ status: r.status, count: r.count })),
    byFoundBy: byFoundBy.map(r => ({ foundBy: r.found_by, count: r.count })),
    byType: byType.map(r => ({ defectType: r.defect_type, count: r.count })),
  };
}

/**
 * 将数据库行格式化为缺陷对象(驼峰命名)
 */
function formatDefect(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    severity: row.severity,
    defectType: row.defect_type,
    module: row.module,
    title: row.title,
    description: row.description,
    status: row.status,
    foundBy: row.found_by,
    reporterId: row.reporter_id,
    assigneeId: row.assignee_id,
    priority: row.priority,
    reopenCount: row.reopen_count,
    createdAt: row.created_at,
    fixedAt: row.fixed_at,
    closedAt: row.closed_at,
    verifiedAt: row.verified_at,
  };
}

export { createDefect, getDefect, listDefects, updateDefect, deleteDefect, getDefectStats };
