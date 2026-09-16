/**
 * database/web-compatibility-dao.js
 * Web 兼容性测试报告 DAO (ESM · 具名导出，与 performance-dao 保持一致)
 */

import { pool } from './db.js';

// 初始化表
export async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_compatibility_reports (
      id              VARCHAR(36) PRIMARY KEY,
      url             VARCHAR(500) NOT NULL,
      total           INT DEFAULT 0,
      passed          INT DEFAULT 0,
      failed          INT DEFAULT 0,
      errored         INT DEFAULT 0,
      score           INT DEFAULT 0,
      matrix_config   JSON,
      report_data     JSON,
      created_by      VARCHAR(36),
      created_by_name VARCHAR(100),
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created_by (created_by),
      INDEX idx_created_at (created_at)
    )
  `);
}

// 创建报告
export async function create({ id, url, total, passed, failed, errored, score, matrixConfig, reportData, createdBy, createdByName }) {
  await pool.query(
    `INSERT INTO web_compatibility_reports (id, url, total, passed, failed, errored, score, matrix_config, report_data, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      url,
      total || 0,
      passed || 0,
      failed || 0,
      errored || 0,
      score || 0,
      JSON.stringify(matrixConfig || {}),
      JSON.stringify(reportData || []),
      createdBy || null,
      createdByName || null,
    ]
  );
}

// 按用户查询报告列表
export async function findByUser(userId, { limit = 50, offset = 0 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, url, total, passed, failed, errored, score, created_by, created_by_name, created_at
     FROM web_compatibility_reports
     WHERE created_by = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

// 统计报告数（按用户）
export async function countByUser(userId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) as total FROM web_compatibility_reports WHERE created_by = ?`,
    [userId]
  );
  return row?.total || 0;
}

// 读取报告详情
export async function findById(id) {
  const [rows] = await pool.query(
    `SELECT * FROM web_compatibility_reports WHERE id = ?`,
    [id]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    ...r,
    matrixConfig: r.matrix_config ? JSON.parse(r.matrix_config) : null,
    reportData: r.report_data ? JSON.parse(r.report_data) : [],
  };
}
