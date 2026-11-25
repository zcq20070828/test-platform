-- 会话级多产物（2026-11-25 · 对话改造第三步）
--
-- 要解决的问题：现在对话的边界是「任务」，一个任务 = 一次交付物生成，
-- 对话只能改这一份。想让 AI 从「需求分析」一路做到「用例生成」，
-- 用户得自己退出、新建任务、把上一份产出再传一遍。
-- 真实 AI 工具的心智是「一个会话贯穿始终」，产物在会话里自然沉淀。
--
-- 设计取舍：**不改任务的执行方式**。任务仍是唯一的执行单元
-- （仍是 spawnAgentSession + 智能体 + skill），会话只是加在任务之上的分组。
-- 这样：
--   1) 执行链路、门禁、审核、成本归属全都不用动——风险最小；
--   2) 原有的「任务列表」「任务详情」照旧能用，不破坏现有心智；
--   3) 回滚只需让 session_id 全为 NULL，行为与改造前完全一致。
--
-- ★ 表名为什么是 chat_sessions 而不是 sessions
--
--   `sessions` 这张表**已经存在**（QClaw 遗留：agent_id/status/ended_at），
--   只在 migrate-from-json.js 里提及。第一版迁移脚本用了
--   CREATE TABLE IF NOT EXISTS `sessions`，在已有旧表的库上会静默跳过，
--   然后往旧表里插 title/project_key 列 → Unknown column。
--   这类「静默跳过 + 插错列」在 dev 上暴露了；若直接上生产会污染旧表。
--   改名彻底避开。
--
-- 为什么不复用已有的 tasks.workflow_id：实测生产 311 个任务该列**全为 NULL**，
-- createTask 里根本没写这一列，是历史遗留的死列。不能拿它当会话用。

CREATE TABLE IF NOT EXISTS `chat_sessions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `title` varchar(200) DEFAULT NULL COMMENT '会话标题（默认取首个任务的输入摘要）',
  `project_key` varchar(80) DEFAULT NULL COMMENT '项目标识（用于把同项目的产物串起来）',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_updated` (`user_id`, `updated_at`),
  KEY `idx_project` (`project_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话会话（任务的分组容器，不参与执行）';

-- 任务挂到会话上（2026-11-25）
--
-- 可为 NULL：NULL 表示「未归属会话」，与改造前行为完全一致。
-- 这样上线不需要回填历史数据，也不会因为缺 session_id 让老任务出问题。
ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `session_id` varchar(36) DEFAULT NULL
    COMMENT '所属会话（NULL=未归属，行为与改造前一致）' AFTER `user_id`;

ALTER TABLE `tasks`
  ADD KEY IF NOT EXISTS `idx_session` (`session_id`);

-- 产物在会话里的顺序（2026-11-25）
--
-- 同一个会话里，需求分析 → 用例生成 → 测试方案是有先后依赖的。
-- 按 created_at 排序在并发场景下不可靠（同秒创建会乱序），
-- 显式记一个序号，让「上一份产物」有确定答案。
ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `session_seq` int(11) DEFAULT NULL
    COMMENT '会话内序号（1 起，用于确定产物先后）' AFTER `session_id`;
