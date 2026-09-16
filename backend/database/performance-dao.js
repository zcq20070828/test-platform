import { pool } from './db.js';

/**
 * 性能测试 DAO — 永久存储性能测试报告与瓶颈发现
 *
 * ⚠️ 注意：所有写操作使用 pool.query() 而非 pool.execute()
 * 原因：mysql2 的 execute() 会将 JS undefined/null 转为字符串 'undefined'/'null'，
 *       导致 MySQL DECIMAL 列报错 "Incorrect decimal value: 'undefined'"
 */

// ── 表创建（幂等）─────────────────────────────────────────────
export async function ensurePerformanceTables() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS performance_reports (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        test_id         VARCHAR(64)  NOT NULL UNIQUE,
        target          VARCHAR(500) NOT NULL COMMENT '被测目标 URL/接口',
        test_type       VARCHAR(50)  NOT NULL DEFAULT 'load' COMMENT 'load|stress|stability|concurrency',
        tool            VARCHAR(50)  DEFAULT 'jmeter' COMMENT 'jmeter|k6|locust|artillery',
        status          VARCHAR(20)  NOT NULL DEFAULT 'running' COMMENT 'running|completed|failed',
        overall_score   DECIMAL(5,2) DEFAULT NULL COMMENT '0-100 综合评分',
        grade           VARCHAR(20)  DEFAULT NULL COMMENT '优秀|良好|合格|不达标',
        sla_pass        TINYINT(1)   DEFAULT NULL COMMENT 'SLA是否达标',
        metrics_summary JSON         DEFAULT NULL COMMENT '{tps, avg_rt, p95_rt, p99_rt, error_rate, throughput, cpu, memory, duration}',
        findings_count  INT          DEFAULT 0,
        recommendations TEXT,
        tester          VARCHAR(50)  DEFAULT 'performance-tester',
        duration_ms     INT          DEFAULT NULL,
        created_by      VARCHAR(50)  NOT NULL,
        created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_test_id   (test_id),
        INDEX idx_created_by(created_at, created_by),
        INDEX idx_status    (status),
        INDEX idx_target    (target(100))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS performance_findings (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        report_id      INT          NOT NULL,
        finding_type   VARCHAR(50)  NOT NULL COMMENT 'response_time|throughput|resource|stability|error_rate',
        severity       VARCHAR(20)  NOT NULL COMMENT 'critical|high|medium|low|info',
        title          VARCHAR(200) NOT NULL,
        description    TEXT,
        metric_detail  VARCHAR(200) DEFAULT NULL,
        threshold      VARCHAR(100) DEFAULT NULL,
        actual_value   VARCHAR(100) DEFAULT NULL,
        remediation    TEXT,
        status         VARCHAR(20)  DEFAULT 'open' COMMENT 'open|accepted|fixed',
        created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_report_id (report_id),
        INDEX idx_severity  (severity),
        INDEX idx_finding_type (finding_type),
        INDEX idx_status    (status),
        FOREIGN KEY (report_id) REFERENCES performance_reports(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS performance_configs (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        config_key   VARCHAR(100) NOT NULL UNIQUE,
        config_value TEXT,
        description  VARCHAR(200) DEFAULT NULL,
        updated_by   VARCHAR(50)  DEFAULT NULL,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 预设默认配置（幂等）
    const defaultConfigs = [
      ['default_vu_count', '100', '默认并发虚拟用户数'],
      ['default_duration', '60s', '默认压测持续时间'],
      ['default_ramp', '30s', '默认爬坡时间'],
      ['sla_rt_p95', '2000', 'SLA P95响应时间阈值(ms)'],
      ['sla_rt_avg', '1000', 'SLA平均响应时间阈值(ms)'],
      ['sla_tps_min', '50', 'SLA最小TPS'],
      ['sla_error_rate', '1.0', 'SLA最大错误率(%)'],
    ];
    for (const [key, val, desc] of defaultConfigs) {
      await conn.query(
        `INSERT IGNORE INTO performance_configs (config_key, config_value, description) VALUES (?, ?, ?)`,
        [key, val, desc]
      );
    }
  } finally {
    conn.release();
  }
}

// ── 报告 CRUD ────────────────────────────────────────────────
export async function createPerformanceReport(report) {
  const { testId, target, testType, tool, tester, createdBy } = report;
  const [rows] = await pool.query(
    `INSERT INTO performance_reports (test_id, target, test_type, tool, tester, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    [testId, target, testType || 'load', tool || 'jmeter', tester || 'performance-tester', createdBy]
  );
  return rows.insertId;
}

export async function updatePerformanceReport(testId, updates) {
  const fields = [];
  const vals = [];
  const allowed = ['status', 'overall_score', 'grade', 'sla_pass', 'metrics_summary',
    'findings_count', 'recommendations', 'duration_ms', 'manual_hours'];
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      fields.push(`${k} = ?`);
      // null 是 typeof 'object'，但不要 JSON.stringify(null)='null'，直接传 null
      const v = updates[k];
      if (v === null) {
        vals.push(null);
      } else if (typeof v === 'object') {
        vals.push(JSON.stringify(v));
      } else {
        vals.push(v);
      }
    }
  }
  if (!fields.length) return;
  vals.push(testId);
  await pool.query(`UPDATE performance_reports SET ${fields.join(', ')} WHERE test_id = ?`, vals);
}

export async function getPerformanceReport(testId) {
  const [rows] = await pool.query(
    `SELECT * FROM performance_reports WHERE test_id = ?`, [testId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  if (r.metrics_summary && typeof r.metrics_summary === 'string') {
    r.metrics_summary = JSON.parse(r.metrics_summary);
  }
  return r;
}

export async function getPerformanceReports({ userId, status, limit = 20, offset = 0 }) {
  let sql = `SELECT * FROM performance_reports WHERE 1=1`;
  const params = [];
  if (userId) { sql += ` AND created_by = ?`; params.push(userId); }
  if (status) { sql += ` AND status = ?`; params.push(status); }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));
  const [rows] = await pool.query(sql, params);
  return rows.map(r => {
    if (r.metrics_summary && typeof r.metrics_summary === 'string') {
      r.metrics_summary = JSON.parse(r.metrics_summary);
    }
    return r;
  });
}

export async function countPerformanceReports({ userId, status }) {
  let sql = `SELECT COUNT(*) as total FROM performance_reports WHERE 1=1`;
  const params = [];
  if (userId) { sql += ` AND created_by = ?`; params.push(userId); }
  if (status) { sql += ` AND status = ?`; params.push(status); }
  const [rows] = await pool.query(sql, params);
  return rows[0].total;
}

export async function deletePerformanceReport(testId) {
  await pool.query(`DELETE FROM performance_reports WHERE test_id = ?`, [testId]);
}

// ── 瓶颈 findings CRUD ────────────────────────────────────────
export async function bulkCreateFindings(reportId, findings) {
  if (!findings || !findings.length) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const f of findings) {
      await conn.query(
        `INSERT INTO performance_findings (report_id, finding_type, severity, title, description, metric_detail, threshold, actual_value, remediation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, f.finding_type || 'general', f.severity || 'medium',
         f.title || '', f.description || '', f.metric_detail || null,
         f.threshold || null, f.actual_value || null, f.remediation || '']
      );
    }
    // 更新 findings_count
    await conn.query(
      `UPDATE performance_reports SET findings_count = (SELECT COUNT(*) FROM performance_findings WHERE report_id = ?) WHERE id = ?`,
      [reportId, reportId]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function getPerformanceFindings({ reportId, severity, status, limit = 50, offset = 0 }) {
  let sql = `SELECT * FROM performance_findings WHERE 1=1`;
  const params = [];
  if (reportId) { sql += ` AND report_id = ?`; params.push(reportId); }
  if (severity) { sql += ` AND severity = ?`; params.push(severity); }
  if (status) { sql += ` AND status = ?`; params.push(status); }
  sql += ` ORDER BY FIELD(severity, 'critical','high','medium','low','info'), id LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function updateFinding(id, updates) {
  const fields = [];
  const vals = [];
  const allowed = ['status', 'severity', 'title', 'description', 'remediation'];
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(updates[k]);
    }
  }
  if (!fields.length) return;
  vals.push(id);
  await pool.query(`UPDATE performance_findings SET ${fields.join(', ')} WHERE id = ?`, vals);
}

// ── 统计 ─────────────────────────────────────────────────────
export async function getPerformanceStats(userId) {
  const [totalRows] = await pool.query(
    `SELECT COUNT(*) as total, AVG(overall_score) as avg_score,
            SUM(CASE WHEN sla_pass=1 THEN 1 ELSE 0 END) as sla_pass_count,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_count
     FROM performance_reports WHERE created_by = ?`,
    [userId]
  );
  const { total, avg_score, sla_pass_count, completed_count } = totalRows[0];

  const [severityRows] = await pool.query(
    `SELECT severity, COUNT(*) as count FROM performance_findings pf
     JOIN performance_reports pr ON pf.report_id = pr.id
     WHERE pr.created_by = ? GROUP BY severity`,
    [userId]
  );
  const severityDist = {};
  for (const row of severityRows) {
    severityDist[row.severity] = row.count;
  }

  return {
    total: total || 0,
    avgScore: avg_score ? Number(avg_score.toFixed(1)) : null,
    slaPassRate: total > 0 ? Math.round((sla_pass_count / total) * 100) : null,
    completedCount: completed_count || 0,
    severityDist,
  };
}

// ── 配置 ─────────────────────────────────────────────────────
export async function getPerformanceConfigs() {
  const [rows] = await pool.query(`SELECT * FROM performance_configs`);
  const config = {};
  for (const r of rows) config[r.config_key] = r.config_value;
  return config;
}

export async function updatePerformanceConfig(key, value, updatedBy) {
  await pool.query(
    `INSERT INTO performance_configs (config_key, config_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)`,
    [key, value, updatedBy]
  );
}
