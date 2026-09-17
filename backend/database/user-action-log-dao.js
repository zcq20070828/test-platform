/**
 * 用户行为日志 DAO
 * 表：user_action_logs(id, user_id, username, action, resource_type, resource_id, metadata, duration_ms, ip_address, user_agent, created_at)
 */
import { query } from './db.js';

const JOIN_SUFFIX = ' COLLATE utf8mb4_unicode_ci';

/**
 * 记录用户行为
 */
export async function logAction(data) {
  const sql = `INSERT INTO user_action_logs (user_id, username, action, resource_type, resource_id, metadata, duration_ms, ip_address, user_agent) VALUES (?,?,?,?,?,?,?,?,?)`;
  const params = [
    data.userId || 'anonymous',
    data.username || null,
    data.action || 'unknown',
    data.resourceType || null,
    data.resourceId || null,
    data.metadata ? JSON.stringify(data.metadata) : null,
    data.durationMs != null && Number.isFinite(data.durationMs) ? Math.round(data.durationMs) : null,
    data.ipAddress || null,
    data.userAgent || null
  ];
  return await query(sql, params);
}

/**
 * 查询用户行为列表（支持分页+过滤，含用户名显示）
 */
export async function listActions(filters = {}) {
  const { userId, action, resourceType, startDate, endDate, page = 1, size = 20 } = filters;
  const where = [];
  const params = [];
  if (userId) { where.push('ual.user_id = ?'); params.push(userId); }
  if (action) { where.push('ual.action = ?'); params.push(action); }
  if (resourceType) { where.push('ual.resource_type = ?'); params.push(resourceType); }
  if (startDate) { where.push('ual.created_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('ual.created_at <= ?'); params.push(endDate); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countSql = `SELECT COUNT(*) as total FROM user_action_logs ual ${whereClause}`;
  const countRows = await query(countSql, params);
  const total = countRows[0]?.total || 0;

  const safePage = Math.max(parseInt(page) || 1, 1);
  const safeSize = Math.min(Math.max(parseInt(size) || 20, 1), 100);
  const offset = (safePage - 1) * safeSize;

  const dataSql = `
    SELECT ual.*,
      CASE
        WHEN ual.user_id = 'anonymous' THEN '访客'
        WHEN NULLIF(ual.username, '') IS NOT NULL THEN ual.username
        WHEN u.name IS NOT NULL AND NULLIF(u.name, '') IS NOT NULL THEN u.name
        ELSE ual.user_id
      END AS display_name
    FROM user_action_logs ual
    LEFT JOIN users u ON ual.user_id = u.id${JOIN_SUFFIX}
    ${whereClause}
    ORDER BY ual.created_at DESC LIMIT ${safeSize} OFFSET ${offset}`;

  const rows = await query(dataSql, params);

  return {
    items: rows.map(r => ({
      ...r,
      metadata: r.metadata
        ? (() => { try { return typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata; } catch { return {}; } })()
        : null
    })),
    total,
    page: safePage,
    size: safeSize
  };
}

/**
 * 用户行为聚合统计
 */
export async function getActionStats(filters = {}) {
  const { startDate, endDate, userId } = filters;
  const where = ['1=1'];
  const params = [];
  if (startDate) { where.push('ual.created_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('ual.created_at <= ?'); params.push(endDate); }
  if (userId) { where.push('ual.user_id = ?'); params.push(userId); }
  const whereStr = where.join(' AND ');

  const totalSql = `SELECT COUNT(*) as total FROM user_action_logs ual WHERE ${whereStr}`;
  const totalRows = await query(totalSql, params);

  const byActionSql = `SELECT ual.action, COUNT(*) as count FROM user_action_logs ual WHERE ${whereStr} GROUP BY ual.action ORDER BY count DESC`;
  const byAction = await query(byActionSql, params);

  const byResourceSql = `SELECT ual.resource_type, COUNT(*) as count FROM user_action_logs ual WHERE ${whereStr} GROUP BY ual.resource_type ORDER BY count DESC`;
  const byResource = await query(byResourceSql, params);

  const byUserSql = `
    SELECT ual.user_id,
      CASE
        WHEN ual.user_id = 'anonymous' THEN '访客'
        WHEN u.name IS NOT NULL AND NULLIF(u.name, '') IS NOT NULL THEN u.name
        ELSE ual.user_id
      END AS display_name,
      COUNT(*) as count
    FROM user_action_logs ual
    LEFT JOIN users u ON ual.user_id = u.id${JOIN_SUFFIX}
    WHERE ${whereStr}
    GROUP BY ual.user_id
    ORDER BY count DESC LIMIT 10`;
  const byUser = await query(byUserSql, params);

  const trendSql = `SELECT DATE(ual.created_at) as date, COUNT(*) as count FROM user_action_logs ual WHERE ${whereStr} GROUP BY DATE(ual.created_at) ORDER BY date DESC LIMIT 30`;
  const trend = await query(trendSql, params);

  const loginSql = `SELECT COUNT(*) as login_count FROM user_action_logs ual WHERE ${whereStr} AND ual.action = 'login'`;
  const loginRows = await query(loginSql, params);

  return {
    total: totalRows[0]?.total || 0,
    loginCount: loginRows[0]?.login_count || 0,
    byAction,
    byResource,
    byUser,
    trend: trend.reverse()
  };
}

/**
 * 获取各用户使用时长（基于 action 时间差估算）
 */
export async function getUserUsageSummary(filters = {}) {
  const { startDate, endDate } = filters;
  const where = ['1=1'];
  const params = [];
  if (startDate) { where.push('ual.created_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('ual.created_at <= ?'); params.push(endDate); }
  const whereStr = where.join(' AND ');

  const sql = `
    SELECT ual.user_id,
      COALESCE(NULLIF(u.name,''), ual.user_id) AS display_name,
      COUNT(*) as action_count,
      MIN(ual.created_at) as first_action,
      MAX(ual.created_at) as last_action,
      TIMESTAMPDIFF(SECOND, MIN(ual.created_at), MAX(ual.created_at)) as duration_seconds
    FROM user_action_logs ual
    LEFT JOIN users u ON ual.user_id = u.id${JOIN_SUFFIX}
    WHERE ${whereStr} AND ual.user_id IS NOT NULL
    GROUP BY ual.user_id
    ORDER BY action_count DESC`;
  return await query(sql, params);
}
