-- 2026-08-31 多轮对话续写 + 交付物版本支持
-- 1) tasks.chat_history: 多轮对话历史(用户消息 + agent 回复 + 版本号),以 JSON 文本存储(兼容 MySQL 5.6+)
ALTER TABLE tasks ADD COLUMN chat_history LONGTEXT DEFAULT NULL COMMENT '多轮对话历史(JSON 文本)';

-- 2) task_output_files 增加版本字段
--    version:        全局递增序号(同一任务内)
--    version_source: agent=智能体生成; user_revision=用户人工修改后回填
--    display_version: 展示用版本号, 如 v1 / v1.5 / v2
ALTER TABLE task_output_files ADD COLUMN version INT DEFAULT 1 COMMENT '交付物版本序号(同一任务内递增)';
ALTER TABLE task_output_files ADD COLUMN version_source VARCHAR(20) DEFAULT 'agent' COMMENT '来源: agent=智能体生成, user_revision=用户人工修订';
ALTER TABLE task_output_files ADD COLUMN display_version VARCHAR(10) DEFAULT NULL COMMENT '展示版本号 如 v1 / v1.5 / v2';
