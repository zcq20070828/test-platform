-- 需求变更：用户行为明细数据要能关联到具体用户名
-- 为 user_action_logs 表添加 username 列，并补全历史数据的用户名

-- 1. 添加 username 列（IF NOT EXISTS 兼容）
ALTER TABLE user_action_logs
  ADD COLUMN IF NOT EXISTS username VARCHAR(100) DEFAULT NULL
  COMMENT '用户名（冗余存储，避免关联查询失败）';

-- 2. 补全历史数据：根据 user_id 关联 users 表回填 username
-- anonymous/anonymous 用户保持 NULL
UPDATE user_action_logs ual
  JOIN users u ON ual.user_id = u.id
SET ual.username = u.name
WHERE ual.username IS NULL
  AND ual.user_id IS NOT NULL
  AND ual.user_id != 'anonymous';
