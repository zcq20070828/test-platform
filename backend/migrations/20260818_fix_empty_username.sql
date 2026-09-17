-- 修复 users 表 username 为空的记录（2026-08-18）
-- 背景：注册时未强制 username 必填，导致部分用户 username=NULL/''，
--       task-dao getTasks LEFT JOIN users 后 username 字段为空，任务列表显示 "-"

-- Step 1：生成替代 username（guest_时间戳_序号）
-- 对于 username 为空或 NULL 的记录，生成 guest_xxx 格式的临时用户名
UPDATE users
SET username = CONCAT('guest_', UNIX_TIMESTAMP(), '_', ROW_NUMBER() OVER (ORDER BY created_at))
WHERE username IS NULL OR username = '';

-- Step 2：确保 username 非空约束（避免未来再次写入空值）
-- 如果表已存在约束，先删除
-- ALTER TABLE users DROP INDEX idx_username;  -- 如有唯一索引冲突可处理
ALTER TABLE users MODIFY COLUMN username VARCHAR(255) NOT NULL DEFAULT 'unknown';

-- Step 3：验证修复结果
SELECT
  COUNT(*) AS total_users,
  SUM(CASE WHEN username IS NULL OR username = '' THEN 1 ELSE 0 END) AS empty_username_count,
  SUM(CASE WHEN name IS NULL OR name = '' THEN 1 ELSE 0 END) AS empty_name_count
FROM users;
