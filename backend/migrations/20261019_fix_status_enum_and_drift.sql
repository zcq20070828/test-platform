-- 2026-10-19 安全整改 / 数据一致性修复
-- 1) tasks.status ENUM 补齐代码实际写入的值（cancelled / reviewing / timeout）
--    此前代码写 'cancelled'、查询 'reviewing'，但 ENUM 只有 pending/running/completed/failed，
--    严格模式下 UPDATE 会报 ER_DATA_TRUNCATED，导致取消任务接口 500。
-- 2) workflows.status ENUM 补齐 'timeout'（工作流全局超时时写入）。
-- 3) tasks 补齐 DAO 已在使用、但 00-schema 里缺失的 workflow_id / workflow_step 列。
-- 4) task_daily_stats 排序规则统一为 utf8mb4_unicode_ci（原为 MariaDB 专有 uca1400）。
--
-- 幂等：全部使用 information_schema 守卫，可重复执行。

SET @db := DATABASE();

-- ---------- 1) tasks.status ----------
SET @sql := (
  SELECT IF(
    (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'status')
      NOT LIKE '%cancelled%',
    'ALTER TABLE tasks MODIFY COLUMN status ENUM(
       ''pending'',''running'',''completed'',''failed'',''cancelled'',''timeout'',''reviewing''
     ) NOT NULL DEFAULT ''pending''',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 2) workflows.status ----------
SET @sql := (
  SELECT IF(
    (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'status')
      NOT LIKE '%timeout%',
    'ALTER TABLE workflows MODIFY COLUMN status ENUM(
       ''running'',''completed'',''failed'',''rejected'',''interactive'',''timeout''
     ) NOT NULL DEFAULT ''running''',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 3) tasks.workflow_id / workflow_step ----------
SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'workflow_id') = 0,
    'ALTER TABLE tasks ADD COLUMN workflow_id VARCHAR(36) NULL AFTER agent_id, ADD KEY idx_tasks_workflow (workflow_id)',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'workflow_step') = 0,
    'ALTER TABLE tasks ADD COLUMN workflow_step INT NULL AFTER workflow_id',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 4) task_daily_stats 排序规则统一 ----------
-- 用 TABLE_COLLATION 判断（该表所有列都是数值/时间类型，COLUMNS.COLLATION_NAME 恒为 NULL，
-- 用列级判断会永远跳过转换）
SET @sql := (
  SELECT IF(
    (SELECT TABLE_COLLATION FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'task_daily_stats') IS NOT NULL
    AND (SELECT TABLE_COLLATION FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'task_daily_stats') <> 'utf8mb4_unicode_ci',
    'ALTER TABLE task_daily_stats CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 5) 常用复合索引（不存在才建） ----------
SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_user_status_created') = 0,
    'ALTER TABLE tasks ADD KEY idx_user_status_created (user_id, status, created_at)',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_status_created') = 0,
    'ALTER TABLE tasks ADD KEY idx_status_created (status, created_at)',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
