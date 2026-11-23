-- 「每用户至多一个默认 Key」由数据库强制（2026-11-20）
--
-- 背景：`is_default` 的语义是**用户级**的——每个用户各自指定自己用于调大模型的
-- 默认 Key，与平台统一提供的 Key（.env 的 DEEPSEEK_API_KEY / PLATFORM_API_KEY）
-- 完全是两件事。改这里不会、也不该影响其他用户或平台兜底 Key。
--
-- 原实现只在 DAO 里用事务保证「先全部清零再置一」：
--   UPDATE ... SET is_default = 0 WHERE user_id = ?
--   UPDATE ... SET is_default = 1 WHERE user_id = ? AND id = ?
-- 这条不变量靠代码纪律维持，DB 层没有兜底。一旦有路径漏了事务、
-- 或并发插入，就会出现同一用户两条 is_default=1；而 getDefaultApiKeyRecord
-- 用 `LIMIT 1` 静默取一条，症状是「明明设了默认，用的却是另一把 Key」——
-- 这种静默错配极难排查。
--
-- 做法：加一个生成列 default_owner，只在 is_default=1 时等于 user_id，
-- 否则为 NULL。唯一索引不约束 NULL，所以：
--   - 同一用户最多只能有一条 is_default=1  → 正是要的不变量
--   - 同一用户的非默认 Key（NULL）可以有任意多条 → 不误伤
-- 这是把「代码约定」升级成「数据库约束」，DAO 的 SQL 一句都不用改。
--
-- 执行顺序很重要：必须先自愈历史脏数据，再建唯一索引，否则建不上。

-- 第 1 步：加生成列（幂等）
ALTER TABLE `user_api_keys`
  ADD COLUMN IF NOT EXISTS `default_owner` varchar(36)
    GENERATED ALWAYS AS (CASE WHEN `is_default` = 1 THEN `user_id` ELSE NULL END) PERSISTENT
    COMMENT '仅在 is_default=1 时等于 user_id，配合唯一索引强制每用户至多一个默认'
    AFTER `is_default`;

-- 第 2 步：自愈历史脏数据
-- 若已存在同一用户多条默认，保留最早创建的那条，其余清零。
-- 用 <=> 做 NULL 安全比较，避免 created_at 为 NULL 时误清全部。
UPDATE `user_api_keys` k
  JOIN (
    SELECT `user_id`, MIN(`created_at`) AS keep_at
      FROM `user_api_keys`
     WHERE `is_default` = 1
     GROUP BY `user_id`
    HAVING COUNT(*) > 1
  ) d ON d.`user_id` = k.`user_id`
   SET k.`is_default` = 0
 WHERE k.`is_default` = 1
   AND NOT (k.`created_at` <=> d.keep_at);

-- 第 3 步：建唯一索引
-- MariaDB 的 ALTER TABLE ... ADD UNIQUE KEY 不支持 IF NOT EXISTS，
-- 重复执行会报 Duplicate key name。部署时若提示该错误，说明索引已存在，可忽略。
ALTER TABLE `user_api_keys`
  ADD UNIQUE KEY `uk_user_default_owner` (`default_owner`);
