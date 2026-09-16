-- 补全 security_reports.created_by 历史数据
-- 策略：按 scan_id 关联 tasks 表，取 task.user_id 作为 created_by
-- 对于直接通过 POST /api/security/scan 创建的记录（scan_id = task.id），
--   tasks 表的 user_id 记录了原始创建者
-- 对于 workflow 路径创建的记录，同样用 tasks 表反查

UPDATE security_reports sr
INNER JOIN tasks t ON t.id = sr.scan_id
SET sr.created_by = t.user_id
WHERE sr.created_by IS NULL
  AND t.user_id IS NOT NULL;

-- 验证：补完后统计
SELECT
  SUM(created_by IS NULL) AS still_null,
  COUNT(*) AS total,
  COUNT(DISTINCT created_by) AS distinct_users
FROM security_reports;
