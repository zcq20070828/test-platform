-- 为 security_vulnerabilities 表加 created_by 字段，并补历史数据

-- 1. 加字段（允许 NULL，旧数据先不填）
ALTER TABLE security_vulnerabilities
  ADD COLUMN created_by VARCHAR(50) NULL DEFAULT NULL AFTER cvss;

-- 2. 通过 report_id 关联 security_reports.created_by 补历史数据
UPDATE security_vulnerabilities v
INNER JOIN security_reports r ON r.id = v.report_id
SET v.created_by = r.created_by
WHERE v.created_by IS NULL;

-- 3. 验证
SELECT
  SUM(created_by IS NULL) AS still_null,
  COUNT(*) AS total,
  COUNT(DISTINCT created_by) AS distinct_users
FROM security_vulnerabilities;
