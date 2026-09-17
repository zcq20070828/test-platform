-- 2026-08-14 用户行为日志username回填
-- 问题: 1555条历史记录username为空，其中大部分是anonymous(未登录用户)
-- 解决: 根据user_id关联users表填充username，对于anonymous保持为空

-- 方案1: 根据user_id关联users表填充
UPDATE user_action_logs ual
INNER JOIN users u ON ual.user_id = u.id
SET ual.username = COALESCE(NULLIF(u.name, ''), u.username)
WHERE ual.username IS NULL OR ual.username = '';

-- 方案2: 对于anonymous记录，标记为'访客'便于区分
UPDATE user_action_logs
SET username = '访客'
WHERE (username IS NULL OR username = '')
  AND user_id = 'anonymous';

-- 验证结果
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN username IS NOT NULL AND username != '' AND username != '访客' THEN 1 ELSE 0 END) as filled_from_users,
  SUM(CASE WHEN username = '访客' THEN 1 ELSE 0 END) as guest_count
FROM user_action_logs;
