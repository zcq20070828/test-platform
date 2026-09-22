import { pool } from './db.js';

/**
 * 安全测试 DAO — 永久存储安全扫描报告与漏洞
 *
 * ⚠️ 注意：所有写操作使用 pool.query() 而非 pool.execute()
 * 原因：mysql2 的 execute() 会将 JS undefined/null 转为字符串 'undefined'/'null'，
 *       导致 MySQL DECIMAL 列报错 "Incorrect decimal value: 'undefined'"
 */

// ── 表创建（幂等）─────────────────────────────────────────────
export async function ensureSecurityTables() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS security_reports (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        scan_id      VARCHAR(64)  NOT NULL,
        target       VARCHAR(500)  NOT NULL COMMENT '扫描目标 URL/host',
        scan_type    VARCHAR(50)  NOT NULL DEFAULT 'full' COMMENT 'full|xss|sql|os|network|business',
        status       VARCHAR(20)  NOT NULL DEFAULT 'running' COMMENT 'running|completed|failed',
        overall_score DECIMAL(5,2) DEFAULT NULL COMMENT '0-100 安全评分',
        severity_dist JSON        DEFAULT NULL COMMENT '{"critical":N,"high":N,"medium":N,"low":N}',
        findings_count INT         DEFAULT 0,
        recommendations TEXT       DEFAULT NULL,
        scanner       VARCHAR(50)  DEFAULT 'security-sentinel',
        duration_ms   INT          DEFAULT NULL,
        created_by    VARCHAR(50)  NOT NULL COMMENT 'user id',
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_scan_id   (scan_id),
        INDEX idx_created_by(created_at, created_by),
        INDEX idx_status    (status),
        INDEX idx_target    (target(100))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS security_vulnerabilities (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        report_id    INT          NOT NULL,
        vuln_type   VARCHAR(50)  NOT NULL COMMENT 'sql_injection|xss|csrf|auth_bypass|...',
        severity     VARCHAR(20)  NOT NULL COMMENT 'critical|high|medium|low|info',
        title        VARCHAR(200) NOT NULL,
        description  TEXT,
        location     VARCHAR(500) DEFAULT NULL COMMENT 'URL/endpoint/file:line',
        evidence     TEXT,
        remediation  TEXT,
        status       VARCHAR(20)  DEFAULT 'open' COMMENT 'open|accepted|fixed',
        cve          VARCHAR(30)  DEFAULT NULL,
        cwe          VARCHAR(30)  DEFAULT NULL,
        cvss         DECIMAL(3,1) DEFAULT NULL,
        created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_report_id (report_id),
        INDEX idx_severity  (severity),
        INDEX idx_vuln_type (vuln_type),
        INDEX idx_status    (status),
        FOREIGN KEY (report_id) REFERENCES security_reports(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS security_configs (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        config_key   VARCHAR(100) NOT NULL UNIQUE,
        config_value TEXT,
        description  VARCHAR(200) DEFAULT NULL,
        updated_by   VARCHAR(50)  DEFAULT NULL,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── 扩展列（幂等：列已存在则忽略）────────────────────────────
    // 支持多域测试域(domain)、报告级扩展 JSON、漏洞级扩展 JSON
    const alters = [
      `ALTER TABLE security_reports ADD COLUMN test_domain VARCHAR(30) NOT NULL DEFAULT 'web'`,
      `ALTER TABLE security_reports ADD COLUMN report_json MEDIUMTEXT NULL`,
      `ALTER TABLE security_vulnerabilities ADD COLUMN ext_json MEDIUMTEXT NULL`,
    ];
    for (const sql of alters) {
      try { await conn.query(sql); } catch (_) { /* 列已存在 */ }
    }
  } finally {
    conn.release();
  }
}

// ── 报告 CRUD ────────────────────────────────────────────────
export async function createSecurityReport(report) {
  const {
    scanId, target, scanType = 'full', status = 'running',
    createdBy, scanner = 'security-sentinel',
    testDomain = 'web', reportJson = null
  } = report;
  const [result] = await pool.query(
    `INSERT INTO security_reports (scan_id, target, scan_type, status, created_by, scanner, test_domain, report_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [scanId, target, scanType, status, createdBy, scanner, testDomain, reportJson ? JSON.stringify(reportJson) : null]
  );
  return result.insertId;
}

export async function updateSecurityReport(id, patch) {
  const fields = [];
  const vals = [];
  const allowed = [
    'status', 'overall_score', 'severity_dist',
    'findings_count', 'recommendations', 'duration_ms',
    'test_domain', 'report_json'
  ];
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(patch[k] === null ? null : (typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]));
    }
  }
  if (!fields.length) return;
  vals.push(id);
  await pool.query(
    `UPDATE security_reports SET ${fields.join(', ')} WHERE id = ?`,
    vals
  );
}

export async function getSecurityReports({ createdBy, limit = 50, offset = 0, status }) {
  let sql = `SELECT id, scan_id, target, scan_type, status, overall_score,
                    severity_dist, findings_count, recommendations,
                    scanner, duration_ms, created_at, updated_at, created_by, test_domain
             FROM security_reports WHERE 1=1`;
  const params = [];
  if (createdBy) { sql += ` AND created_by = ?`; params.push(createdBy); }
  if (status) { sql += ` AND status = ?`; params.push(status); }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  const [rows] = await pool.execute(sql, params);
  return rows.map(r => ({
    ...r,
    severity_dist: typeof r.severity_dist === 'string' ? JSON.parse(r.severity_dist) : r.severity_dist
  }));
}

// 将漏洞行的 ext_json（bizRisk/compliance/codeFix/poc/verified/cvssScore/owaspCategory）解析并合并
function parseVulnExt(v) {
  let ext = {};
  if (v.ext_json) {
    try { ext = typeof v.ext_json === 'string' ? JSON.parse(v.ext_json) : v.ext_json; } catch (_) { ext = {}; }
  }
  const { ext_json, ...rest } = v;
  return { ...rest, ...ext };
}

export async function getSecurityReportById(id) {
  const [[row]] = await pool.execute(
    `SELECT * FROM security_reports WHERE id = ?`, [id]
  );
  if (!row) return null;
  const [vulns] = await pool.execute(
    `SELECT * FROM security_vulnerabilities WHERE report_id = ? ORDER BY
       FIELD(severity,'critical','high','medium','low','info'), id`, [id]
  );
  let reportJson = {};
  if (row.report_json) {
    try { reportJson = typeof row.report_json === 'string' ? JSON.parse(row.report_json) : row.report_json; } catch (_) { reportJson = {}; }
  }
  return {
    ...row,
    test_domain: row.test_domain || 'web',
    report_json: reportJson,
    severity_dist: typeof row.severity_dist === 'string' ? JSON.parse(row.severity_dist) : row.severity_dist,
    vulnerabilities: vulns.map(parseVulnExt)
  };
}

export async function deleteSecurityReport(id) {
  await pool.query(`DELETE FROM security_reports WHERE id = ?`, [id]);
}

export async function countSecurityReports(createdBy, status) {
  let sql = `SELECT COUNT(*) as cnt FROM security_reports WHERE created_by = ?`;
  const params = [createdBy];
  if (status) { sql += ` AND status = ?`; params.push(status); }
  const [[{ cnt }]] = await pool.execute(sql, params);
  return cnt;
}

// ── 漏洞 CRUD ────────────────────────────────────────────────
/**
 * 创建漏洞
 * 接受两套字段名（兼容 server.js 传的 snake_case）：
 *   reportId, title, severity, vuln_type (或 vulnType),
 *   description, evidence, recommendation (或 remediation),
 *   cwe_id (或 cwe), cve_id (或 cve), status, location
 */
export async function createVulnerability(v) {
  const {
    reportId,
    title,
    severity,
    vuln_type  = v.vulnType  || '',
    description = '',
    evidence    = null,
    recommendation = v.remediation || null,
    cwe_id     = v.cwe || null,
    cve_id     = v.cve || null,
    status     = 'open',
    location   = null,
    cvss       = null,
    extJson    = null
  } = v;
  const [result] = await pool.query(
    `INSERT INTO security_vulnerabilities
       (report_id, vuln_type, severity, title, description, location, evidence, remediation, cve, cwe, cvss, status, ext_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [reportId, vuln_type, severity, title, description, location, evidence, recommendation, cve_id, cwe_id, cvss, status, extJson ? JSON.stringify(extJson) : null]
  );
  return result.insertId;
}

export async function bulkCreateVulnerabilities(vulns) {
  if (!vulns.length) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const v of vulns) {
      await conn.execute(
        `INSERT INTO security_vulnerabilities
           (report_id, vuln_type, severity, title, description, location, evidence, remediation, cve, cwe, cvss, status, ext_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v.reportId, v.vuln_type || v.vulnType || '', v.severity || 'info',
          v.title || '', v.description || '',
          v.location || null, v.evidence || null, v.remediation || v.recommendation || null,
          v.cve_id || v.cve || null, v.cwe_id || v.cwe || null, v.cvss || null,
          v.status || 'open',
          v.extJson ? JSON.stringify(v.extJson) : (v.ext_json ? JSON.stringify(v.ext_json) : null)
        ]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateVulnerabilityStatus(id, status) {
  await pool.query(
    `UPDATE security_vulnerabilities SET status = ? WHERE id = ?`,
    [status, id]
  );
}

export async function getVulnerabilities({ createdBy, severity, vulnType, status, reportId, limit = 100, offset = 0 }) {
  const sql = `
    SELECT sv.*, sr.target, sr.scan_type, sr.created_at as report_date
    FROM security_vulnerabilities sv
    JOIN security_reports sr ON sr.id = sv.report_id
    WHERE sr.created_by = ?
    ${reportId ? ` AND sv.report_id = ?` : ''}
    ${severity ? ` AND sv.severity = ?` : ''}
    ${vulnType ? ` AND sv.vuln_type = ?` : ''}
    ${status ? ` AND sv.status = ?` : ''}
    ORDER BY FIELD(sv.severity,'critical','high','medium','low','info'), sv.id
    LIMIT ? OFFSET ?
  `;
  const params = [createdBy];
  if (reportId) params.push(reportId);
  if (severity) params.push(severity);
  if (vulnType) params.push(vulnType);
  if (status) params.push(status);
  params.push(limit, offset);
  const [rows] = await pool.execute(sql, params);
  return rows.map(parseVulnExt);
}

export async function countVulnerabilities(createdBy, severity, vulnType, status, reportId) {
  const sql = `
    SELECT COUNT(*) as cnt FROM security_vulnerabilities sv
    JOIN security_reports sr ON sr.id = sv.report_id
    WHERE sr.created_by = ?
    ${reportId ? ` AND sv.report_id = ?` : ''}
    ${severity ? ` AND sv.severity = ?` : ''}
    ${vulnType ? ` AND sv.vuln_type = ?` : ''}
    ${status ? ` AND sv.status = ?` : ''}
  `;
  const params = [createdBy];
  if (reportId) params.push(reportId);
  if (severity) params.push(severity);
  if (vulnType) params.push(vulnType);
  if (status) params.push(status);
  const [[{ cnt }]] = await pool.execute(sql, params);
  return cnt;
}

// ── 统计 ────────────────────────────────────────────────────
export async function getSecurityStats(createdBy) {
  const [[total]] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM security_reports WHERE created_by = ?`, [createdBy]
  );
  const [[openVulns]] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM security_vulnerabilities sv
     JOIN security_reports sr ON sr.id = sv.report_id
     WHERE sr.created_by = ? AND sv.status = 'open'`, [createdBy]
  );
  const [[avgScore]] = await pool.execute(
    `SELECT AVG(overall_score) as avg FROM security_reports
     WHERE created_by = ? AND overall_score IS NOT NULL`, [createdBy]
  );
  const severityDist = {};
  for (const sev of ['critical','high','medium','low','info']) {
    const [[{ cnt }]] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM security_vulnerabilities sv
       JOIN security_reports sr ON sr.id = sv.report_id
       WHERE sr.created_by = ? AND sv.severity = ? AND sv.status = 'open'`,
      [createdBy, sev]
    );
    severityDist[sev] = cnt;
  }
  return { totalReports: total.cnt, openVulns: openVulns.cnt, avgScore: avgScore.avg || 0, severityDist };
}
