-- 2026-08-27: Web 兼容性测试表
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
);
