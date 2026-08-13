-- 测试中台数据库增量更新脚本（自动生成 2026-07-30）
-- 基线: v1.0.0-20260718 (17表) → 本地最新结构 (34表)
-- 用法: mysql -u root -p test_platform < 01-schema-incremental.sql
-- 幂等安全: 仅补齐缺失的表/列，不删除/重置现有数据。
-- 说明: 表/列来源为本地 dev 数据库真实结构（含所有开发期运行时 ALTER 演进）。

USE test_platform;

-- ============ 第一部分：新增表（基线没有，本地最新结构有）============

-- 新增表: agent_daily_stats
CREATE TABLE IF NOT EXISTS `agent_daily_stats` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `stat_date` date NOT NULL,
  `agent_id` varchar(64) NOT NULL,
  `agent_name` varchar(128) DEFAULT NULL,
  `total_tasks` int(11) DEFAULT 0,
  `completed_tasks` int(11) DEFAULT 0,
  `failed_tasks` int(11) DEFAULT 0,
  `avg_duration_minutes` decimal(10,2) DEFAULT 0.00,
  `avg_score` decimal(5,2) DEFAULT 0.00,
  `avg_capability_score` decimal(5,2) DEFAULT 0.00 COMMENT '能力层平均分',
  `avg_business_score` decimal(5,2) DEFAULT 0.00 COMMENT '业务层平均分',
  `total_input_tokens` int(11) DEFAULT 0,
  `total_output_tokens` int(11) DEFAULT 0,
  `total_cost` decimal(10,4) DEFAULT 0.0000,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deliverable_count` int(11) DEFAULT 0,
  `avg_deliverable_score` decimal(4,2) DEFAULT 0.00,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_date_agent` (`stat_date`,`agent_id`),
  KEY `idx_stat_date` (`stat_date`),
  KEY `idx_agent_id` (`agent_id`)
) ENGINE=InnoDB AUTO_INCREMENT=241 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: agent_learned_knowledge
CREATE TABLE IF NOT EXISTS `agent_learned_knowledge` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(36) NOT NULL COMMENT 'ç”¨æˆ·ID',
  `agent_id` varchar(50) NOT NULL COMMENT 'æ™ºèƒ½ä½“ID',
  `kb_type` varchar(50) NOT NULL COMMENT 'çŸ¥è¯†åº“ç±»åž‹: general/project-test/project-biz',
  `doc_path` varchar(500) NOT NULL COMMENT 'æ–‡æ¡£ç›¸å¯¹è·¯å¾„',
  `doc_hash` varchar(64) NOT NULL COMMENT 'æ–‡æ¡£å†…å®¹SHA256å“ˆå¸Œ(ç”¨äºŽæ£€æµ‹å˜åŒ–)',
  `learned_at` timestamp NULL DEFAULT current_timestamp() COMMENT 'å­¦ä¹ æ—¶é—´',
  `content_preview` text DEFAULT NULL COMMENT 'å†…å®¹é¢„è§ˆ(å‰500å­—ç¬¦ï¼Œç”¨äºŽå¿«é€Ÿæ³¨å…¥)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_agent_kb_doc` (`user_id`,`agent_id`,`kb_type`,`doc_path`),
  KEY `idx_user_agent` (`user_id`,`agent_id`),
  KEY `idx_kb_doc` (`kb_type`,`doc_path`),
  KEY `idx_learned_at` (`learned_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2522 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='æ™ºèƒ½ä½“çŸ¥è¯†å­¦ä¹ è®°å½•è¡¨';

-- 新增表: conversation_history
CREATE TABLE IF NOT EXISTS `conversation_history` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(36) NOT NULL,
  `agent_id` varchar(100) NOT NULL,
  `role` enum('user','assistant') NOT NULL,
  `content` text NOT NULL,
  `turn_index` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_seq` (`user_id`,`agent_id`,`turn_index`,`role`),
  KEY `idx_user_agent` (`user_id`,`agent_id`),
  KEY `idx_turn` (`user_id`,`agent_id`,`turn_index`)
) ENGINE=InnoDB AUTO_INCREMENT=132 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: defects
CREATE TABLE IF NOT EXISTS `defects` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(64) DEFAULT NULL,
  `session_id` varchar(64) DEFAULT NULL,
  `severity` varchar(16) NOT NULL DEFAULT 'minor',
  `defect_type` varchar(32) DEFAULT NULL,
  `module` varchar(128) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'open',
  `found_by` varchar(16) NOT NULL DEFAULT 'ai',
  `reporter_id` varchar(64) DEFAULT NULL,
  `assignee_id` varchar(64) DEFAULT NULL,
  `priority` varchar(8) DEFAULT 'P2',
  `reopen_count` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `fixed_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  `verified_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_status` (`status`),
  KEY `idx_severity` (`severity`),
  KEY `idx_found_by` (`found_by`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: evaluation_configs
CREATE TABLE IF NOT EXISTS `evaluation_configs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `agent_id` varchar(50) NOT NULL,
  `enabled` int(11) DEFAULT 1,
  `period` varchar(20) NOT NULL,
  `scope` text NOT NULL,
  `last_evaluation_at` varchar(50) DEFAULT NULL,
  `next_evaluation_at` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_configs_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: kb_chunk_terms
CREATE TABLE IF NOT EXISTS `kb_chunk_terms` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `chunk_id` int(11) NOT NULL COMMENT 'å…³è”çŸ¥è¯†å—ID',
  `term` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chunk_term` (`chunk_id`,`term`),
  KEY `idx_term` (`term`),
  KEY `idx_chunk_id` (`chunk_id`)
) ENGINE=InnoDB AUTO_INCREMENT=685944 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='çŸ¥è¯†å—è¯é¡¹ç´¢å¼•';

-- 新增表: kb_chunks
CREATE TABLE IF NOT EXISTS `kb_chunks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `doc_id` varchar(512) NOT NULL COMMENT 'å…³è”æ–‡æ¡£ID',
  `chunk_index` int(11) NOT NULL COMMENT 'å—ç´¢å¼•',
  `text` text NOT NULL COMMENT 'å—æ–‡æœ¬å†…å®¹',
  `term_count` int(11) DEFAULT 0 COMMENT 'è¯é¡¹æ•°é‡',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_doc_chunk` (`doc_id`,`chunk_index`),
  KEY `idx_doc_id` (`doc_id`)
) ENGINE=InnoDB AUTO_INCREMENT=15530 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='çŸ¥è¯†åº“çŸ¥è¯†å—';

-- 新增表: kb_doc_stats
CREATE TABLE IF NOT EXISTS `kb_doc_stats` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `doc_id` varchar(512) NOT NULL COMMENT 'æ–‡æ¡£ID',
  `doc_length` int(11) DEFAULT 0 COMMENT 'æ–‡æ¡£æ€»è¯é¡¹æ•°',
  `term_count` int(11) DEFAULT 0 COMMENT 'å”¯ä¸€è¯é¡¹æ•°',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `doc_id` (`doc_id`),
  KEY `idx_doc_id` (`doc_id`)
) ENGINE=InnoDB AUTO_INCREMENT=85 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='æ–‡æ¡£çº§ç»Ÿè®¡ä¿¡æ¯';

-- 新增表: kb_documents
CREATE TABLE IF NOT EXISTS `kb_documents` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `doc_id` varchar(512) NOT NULL COMMENT 'æ–‡æ¡£IDï¼Œå¦‚ general/æµ‹è¯•è®¡åˆ’.docx',
  `kb_type` varchar(64) NOT NULL COMMENT 'çŸ¥è¯†åº“ç±»åž‹ï¼šgeneral/project-test/project-biz',
  `name` varchar(255) NOT NULL COMMENT 'æ–‡æ¡£åç§°',
  `chunks_count` int(11) DEFAULT 0 COMMENT 'çŸ¥è¯†å—æ•°é‡',
  `vectorized_at` timestamp NULL DEFAULT current_timestamp() COMMENT 'å‘é‡åŒ–æ—¶é—´',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `doc_id` (`doc_id`),
  KEY `idx_kb_type` (`kb_type`),
  KEY `idx_doc_id` (`doc_id`)
) ENGINE=InnoDB AUTO_INCREMENT=86 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='çŸ¥è¯†åº“æ–‡æ¡£å…ƒæ•°æ®';

-- 新增表: kb_global_terms
CREATE TABLE IF NOT EXISTS `kb_global_terms` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `term` varchar(255) NOT NULL,
  `doc_freq` int(11) DEFAULT 1 COMMENT 'åŒ…å«è¯¥è¯é¡¹çš„æ–‡æ¡£æ•°',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `term` (`term`),
  KEY `idx_term` (`term`)
) ENGINE=InnoDB AUTO_INCREMENT=69255 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='å…¨å±€è¯é¡¹æ–‡æ¡£é¢‘çŽ‡';

-- 新增表: overall_stats
CREATE TABLE IF NOT EXISTS `overall_stats` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `stat_key` varchar(64) NOT NULL,
  `stat_value` text DEFAULT NULL,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stat_key` (`stat_key`)
) ENGINE=InnoDB AUTO_INCREMENT=659 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: task_daily_stats
CREATE TABLE IF NOT EXISTS `task_daily_stats` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `stat_date` date NOT NULL,
  `total_tasks` int(11) DEFAULT 0,
  `completed_tasks` int(11) DEFAULT 0,
  `failed_tasks` int(11) DEFAULT 0,
  `timeout_tasks` int(11) DEFAULT 0,
  `avg_duration_minutes` decimal(10,2) DEFAULT 0.00,
  `total_duration_minutes` int(11) DEFAULT 0,
  `manual_hours` decimal(10,2) DEFAULT 0.00,
  `auto_hours` decimal(10,2) DEFAULT 0.00,
  `saved_hours` decimal(10,2) DEFAULT 0.00,
  `efficiency_rate` decimal(5,2) DEFAULT 0.00,
  `estimated_cost` decimal(10,2) DEFAULT 0.00,
  `actual_cost` decimal(10,2) DEFAULT 0.00,
  `saved_cost` decimal(10,2) DEFAULT 0.00,
  `evaluation_count` int(11) DEFAULT 0 COMMENT '评估次数',
  `quality_pass_count` int(11) DEFAULT 0 COMMENT '质量达标次数',
  `quality_pass_rate` decimal(5,2) DEFAULT 0.00 COMMENT '质量达标率(%)',
  `avg_overall_score` decimal(5,2) DEFAULT 0.00 COMMENT '综合平均分',
  `avg_quality_score` decimal(5,2) DEFAULT 0.00 COMMENT '质量层平均分',
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deliverable_count` int(11) DEFAULT 0 COMMENT 'å½“æ—¥è¯„ä¼°å…³è”äº¤ä»˜ç‰©æ€»æ•°',
  `deliverable_scored` int(11) DEFAULT 0 COMMENT 'å·²è¯„åˆ†äº¤ä»˜ç‰©æ•°',
  `avg_deliverable_score` decimal(4,2) DEFAULT 0.00 COMMENT 'äº¤ä»˜ç‰©å‡åˆ†ï¼ˆ0-10ï¼‰',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stat_date` (`stat_date`),
  KEY `idx_stat_date` (`stat_date`)
) ENGINE=InnoDB AUTO_INCREMENT=111 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- 新增表: task_execution_logs
CREATE TABLE IF NOT EXISTS `task_execution_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(64) NOT NULL,
  `agent_id` varchar(64) NOT NULL,
  `stage` varchar(32) DEFAULT NULL,
  `input_tokens` int(11) DEFAULT 0,
  `output_tokens` int(11) DEFAULT 0,
  `total_tokens` int(11) DEFAULT 0,
  `api_calls` int(11) DEFAULT 1,
  `cost` decimal(10,4) DEFAULT 0.0000,
  `start_time` datetime DEFAULT NULL,
  `end_time` datetime DEFAULT NULL,
  `duration_ms` int(11) DEFAULT NULL,
  `status` varchar(16) DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: user_action_logs
CREATE TABLE IF NOT EXISTS `user_action_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(64) NOT NULL,
  `action` varchar(64) NOT NULL,
  `resource_type` varchar(32) DEFAULT NULL,
  `resource_id` varchar(64) DEFAULT NULL,
  `metadata` longtext DEFAULT NULL CHECK (json_valid(`metadata`)),
  `duration_ms` int(11) DEFAULT NULL COMMENT 'åœç•™æ—¶é•¿æ¯«ç§’',
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=855 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: user_daily_stats
CREATE TABLE IF NOT EXISTS `user_daily_stats` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `stat_date` date NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `username` varchar(128) DEFAULT NULL,
  `total_tasks` int(11) DEFAULT 0,
  `completed_tasks` int(11) DEFAULT 0,
  `failed_tasks` int(11) DEFAULT 0,
  `avg_duration_minutes` decimal(10,2) DEFAULT 0.00,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_date_user` (`stat_date`,`user_id`),
  KEY `idx_stat_date` (`stat_date`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=75 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: waiting_input_sessions
CREATE TABLE IF NOT EXISTS `waiting_input_sessions` (
  `task_id` varchar(36) NOT NULL,
  `agent_id` varchar(100) NOT NULL,
  `workflow_id` varchar(36) DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`task_id`),
  KEY `idx_workflow` (`workflow_id`),
  KEY `idx_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 新增表: workflows
CREATE TABLE IF NOT EXISTS `workflows` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `input` text DEFAULT NULL,
  `status` enum('running','completed','failed','rejected','interactive') DEFAULT 'running',
  `steps` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`steps`)),
  `current_step` int(11) DEFAULT 0,
  `results` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`results`)),
  `workflow_results` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`workflow_results`)),
  `mode` varchar(20) DEFAULT NULL,
  `scenario` varchar(200) DEFAULT NULL,
  `manual_hours` decimal(10,2) DEFAULT NULL COMMENT '预估人工工时(小时)',
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ 第二部分：已有表新增列（带存在性检查，幂等）============

-- 表 evaluation_collected_tasks 新增列 (6): task_type, input, output, status, duration, created_at
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collected_tasks' AND COLUMN_NAME='task_type';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collected_tasks` ADD COLUMN `task_type` varchar(100) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collected_tasks' AND COLUMN_NAME='input';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collected_tasks` ADD COLUMN `input` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collected_tasks' AND COLUMN_NAME='output';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collected_tasks` ADD COLUMN `output` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collected_tasks' AND COLUMN_NAME='status';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collected_tasks` ADD COLUMN `status` varchar(50) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collected_tasks' AND COLUMN_NAME='duration';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collected_tasks` ADD COLUMN `duration` int(11) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collected_tasks' AND COLUMN_NAME='created_at';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collected_tasks` ADD COLUMN `created_at` timestamp NULL DEFAULT current_timestamp()', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 表 evaluation_collection_sessions 新增列 (9): session_id, collection_type, agent_ids, days_back, limit_per_agent, total_tasks, agents_covered, collected_at, created_at
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='session_id';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `session_id` varchar(36) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='collection_type';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `collection_type` varchar(20) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='agent_ids';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `agent_ids` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='days_back';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `days_back` int(11) DEFAULT 30', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='limit_per_agent';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `limit_per_agent` int(11) DEFAULT 20', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='total_tasks';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `total_tasks` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='agents_covered';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `agents_covered` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='collected_at';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `collected_at` varchar(50) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_collection_sessions' AND COLUMN_NAME='created_at';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_collection_sessions` ADD COLUMN `created_at` timestamp NULL DEFAULT current_timestamp()', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 表 evaluation_metrics_history 新增列 (6): report_id, metric_key, layer, score, weight, timestamp
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_metrics_history' AND COLUMN_NAME='report_id';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_metrics_history` ADD COLUMN `report_id` int(11) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_metrics_history' AND COLUMN_NAME='metric_key';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_metrics_history` ADD COLUMN `metric_key` varchar(100) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_metrics_history' AND COLUMN_NAME='layer';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_metrics_history` ADD COLUMN `layer` varchar(20) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_metrics_history' AND COLUMN_NAME='score';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_metrics_history` ADD COLUMN `score` decimal(6,2) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_metrics_history' AND COLUMN_NAME='weight';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_metrics_history` ADD COLUMN `weight` decimal(5,2) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_metrics_history' AND COLUMN_NAME='timestamp';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_metrics_history` ADD COLUMN `timestamp` varchar(50) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 表 evaluation_reports 新增列 (28): task_id, task_type, timestamp, overall_grade, overall_level, capability_metrics, quality_metrics, business_score, business_metrics, input_duration, input_output_length, input_created_at, trend_capability_delta, trend_capability_trend, trend_quality_delta, trend_quality_trend, trend_business_delta, trend_business_trend, trend_overall_delta, trend_overall_trend, recommendations, next_evaluation_at, task_count, avg_score, scope, deliverable_score, deliverable_count, has_artifact
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='task_id';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `task_id` varchar(255) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='task_type';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `task_type` varchar(100) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='timestamp';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `timestamp` varchar(50) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='overall_grade';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `overall_grade` varchar(10) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='overall_level';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `overall_level` int(11) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='capability_metrics';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `capability_metrics` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='quality_metrics';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `quality_metrics` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='business_score';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `business_score` decimal(6,2) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='business_metrics';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `business_metrics` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='input_duration';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `input_duration` int(11) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='input_output_length';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `input_output_length` int(11) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='input_created_at';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `input_created_at` varchar(50) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='trend_capability_delta';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `trend_capability_delta` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='trend_capability_trend';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `trend_capability_trend` varchar(20) DEFAULT ''stable''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='trend_quality_delta';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `trend_quality_delta` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='trend_quality_trend';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `trend_quality_trend` varchar(20) DEFAULT ''stable''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='trend_business_delta';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `trend_business_delta` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='trend_business_trend';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `trend_business_trend` varchar(20) DEFAULT ''stable''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='trend_overall_delta';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `trend_overall_delta` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='trend_overall_trend';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `trend_overall_trend` varchar(20) DEFAULT ''stable''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='recommendations';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `recommendations` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='next_evaluation_at';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `next_evaluation_at` varchar(50) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='task_count';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `task_count` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='avg_score';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `avg_score` decimal(6,2) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='scope';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `scope` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='deliverable_score';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `deliverable_score` decimal(4,2) DEFAULT NULL COMMENT ''äº¤ä»˜ç‰©è´¨é‡åˆ†ï¼ˆ0-10ï¼‰''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='deliverable_count';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `deliverable_count` int(11) DEFAULT NULL COMMENT ''æœ¬æ¬¡è¯„ä¼°å…³è”äº¤ä»˜ç‰©æ•°é‡''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_reports' AND COLUMN_NAME='has_artifact';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_reports` ADD COLUMN `has_artifact` tinyint(1) DEFAULT 0 COMMENT ''ä»»åŠ¡æ˜¯å¦å«äº¤ä»˜ç‰©''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 表 evaluation_runs 新增列 (12): run_id, run_type, agent_ids, task_id, scope, started_at, completed_at, total_agents, total_tasks, avg_score, error_message, created_at
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='run_id';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `run_id` varchar(36) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='run_type';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `run_type` varchar(50) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='agent_ids';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `agent_ids` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='task_id';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `task_id` varchar(255) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='scope';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `scope` text NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='started_at';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `started_at` varchar(50) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='completed_at';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `completed_at` varchar(50) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='total_agents';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `total_agents` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='total_tasks';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `total_tasks` int(11) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='avg_score';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `avg_score` decimal(6,2) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='error_message';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `error_message` text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='evaluation_runs' AND COLUMN_NAME='created_at';
SET @sql = IF(@ce = 0, 'ALTER TABLE `evaluation_runs` ADD COLUMN `created_at` timestamp NULL DEFAULT current_timestamp()', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 表 tasks 新增列 (9): artifacts, input_tokens, output_tokens, token_cost, actual_cost, manual_hours, labor_cost, estimated_cost, saved_cost
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='artifacts';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `artifacts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`artifacts`))', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='input_tokens';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `input_tokens` int(11) DEFAULT 0 COMMENT ''输入token消耗''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='output_tokens';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `output_tokens` int(11) DEFAULT 0 COMMENT ''输出token消耗''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='token_cost';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `token_cost` decimal(10,6) DEFAULT 0.000000 COMMENT ''每1K token价格(元)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='actual_cost';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `actual_cost` decimal(10,4) DEFAULT 0.0000 COMMENT ''实际执行成本(元)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='manual_hours';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `manual_hours` decimal(8,2) DEFAULT 0.00 COMMENT ''预估人工执行工时(小时)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='labor_cost';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `labor_cost` decimal(10,4) DEFAULT 0.0000 COMMENT ''每小时人力成本(元)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='estimated_cost';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `estimated_cost` decimal(10,4) DEFAULT 0.0000 COMMENT ''预估人工执行成本(元)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT COUNT(*) INTO @ce FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='test_platform' AND TABLE_NAME='tasks' AND COLUMN_NAME='saved_cost';
SET @sql = IF(@ce = 0, 'ALTER TABLE `tasks` ADD COLUMN `saved_cost` decimal(10,4) DEFAULT 0.0000 COMMENT ''节省成本(元)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
