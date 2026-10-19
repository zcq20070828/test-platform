-- =====================================================================
-- 测试中台数据库 · 完整建表脚本（由开发库 test_platform_dev 结构导出）
-- 用途：新成员在本机从零建库
-- 用法：
--   mysql -u root -p < database/00-schema-full.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `test_platform_dev`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `test_platform_dev`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

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
) ENGINE=InnoDB AUTO_INCREMENT=805 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `agent_learned_knowledge` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(36) NOT NULL COMMENT 'ç”¨æˆ·ID',
  `agent_id` varchar(50) NOT NULL COMMENT 'æ™ºèƒ½ä½“ID',
  `kb_type` varchar(50) NOT NULL COMMENT 'çŸ¥è¯†åº“ç±»åž‹: general/project-test/project-biz',
  `doc_path` varchar(500) NOT NULL COMMENT 'æ–‡æ¡£ç›¸å¯¹è·¯å¾„',
  `doc_hash` varchar(64) NOT NULL COMMENT 'æ–‡æ¡£å†…å®¹SHA256å“ˆå¸Œ(ç”¨äºŽæ£€æµ‹å˜åŒ–)',
  `learned_at` timestamp NULL DEFAULT current_timestamp() COMMENT 'å­¦ä¹ æ—¶é—´',
  `content_preview` mediumtext DEFAULT NULL COMMENT 'å†…å®¹é¢„è§ˆ(å‰500å­—ç¬¦ï¼Œç”¨äºŽå¿«é€Ÿæ³¨å…¥)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_agent_kb_doc` (`user_id`,`agent_id`,`kb_type`,`doc_path`),
  KEY `idx_user_agent` (`user_id`,`agent_id`),
  KEY `idx_kb_doc` (`kb_type`,`doc_path`),
  KEY `idx_learned_at` (`learned_at`)
) ENGINE=InnoDB AUTO_INCREMENT=3885 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='æ™ºèƒ½ä½“çŸ¥è¯†å­¦ä¹ è®°å½•è¡¨';
CREATE TABLE IF NOT EXISTS `conversation_history` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(36) NOT NULL,
  `agent_id` varchar(100) NOT NULL,
  `task_id` varchar(36) DEFAULT NULL,
  `role` enum('user','assistant') NOT NULL,
  `content` mediumtext NOT NULL,
  `turn_index` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_seq` (`user_id`,`agent_id`,`turn_index`,`role`),
  KEY `idx_user_agent` (`user_id`,`agent_id`),
  KEY `idx_turn` (`user_id`,`agent_id`,`turn_index`),
  KEY `idx_user_agent_task` (`user_id`,`agent_id`,`task_id`,`turn_index`)
) ENGINE=InnoDB AUTO_INCREMENT=542 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `conversation_history_garbled_backup_20260814` (
  `id` bigint(20) NOT NULL DEFAULT 0,
  `user_id` varchar(36) NOT NULL,
  `agent_id` varchar(100) NOT NULL,
  `role` enum('user','assistant') NOT NULL,
  `content` mediumtext NOT NULL,
  `turn_index` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `credentials` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(36) DEFAULT NULL,
  `provider` varchar(50) DEFAULT NULL COMMENT 'æä¾›å•†: github/google/etc',
  `access_token` mediumtext DEFAULT NULL COMMENT 'è®¿é—®ä»¤ç‰Œï¼ˆåŠ å¯†ï¼‰',
  `refresh_token` mediumtext DEFAULT NULL COMMENT 'åˆ·æ–°ä»¤ç‰Œï¼ˆåŠ å¯†ï¼‰',
  `expires_at` timestamp NULL DEFAULT NULL COMMENT 'è¿‡æœŸæ—¶é—´',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_provider` (`provider`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='è®¤è¯å‡­æ®è¡¨';
CREATE TABLE IF NOT EXISTS `cron_jobs` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `schedule` varchar(100) NOT NULL COMMENT 'cronè¡¨è¾¾å¼',
  `agent_id` varchar(50) DEFAULT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'ä»»åŠ¡å‚æ•°' CHECK (json_valid(`payload`)),
  `enabled` tinyint(1) DEFAULT 1,
  `last_run_at` timestamp NULL DEFAULT NULL,
  `next_run_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_enabled` (`enabled`),
  KEY `idx_next_run` (`next_run_at`),
  KEY `idx_agent_id` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='å®šæ—¶ä»»åŠ¡è¡¨';
CREATE TABLE IF NOT EXISTS `defects` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(64) DEFAULT NULL,
  `session_id` varchar(64) DEFAULT NULL,
  `severity` varchar(16) NOT NULL DEFAULT 'minor',
  `defect_type` varchar(32) DEFAULT NULL,
  `module` varchar(128) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` mediumtext DEFAULT NULL,
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
CREATE TABLE IF NOT EXISTS `evaluation_collected_tasks` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(255) NOT NULL,
  `agent_id` varchar(50) NOT NULL,
  `task_type` varchar(100) DEFAULT NULL,
  `input` mediumtext DEFAULT NULL,
  `output` mediumtext DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `duration` int(11) DEFAULT NULL,
  `collected_at` varchar(50) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ct_agent` (`agent_id`),
  KEY `idx_ct_task` (`task_id`),
  KEY `idx_ct_collected` (`collected_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2670 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `evaluation_collection_sessions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `session_id` varchar(36) NOT NULL,
  `collection_type` varchar(20) NOT NULL,
  `agent_ids` mediumtext DEFAULT NULL,
  `days_back` int(11) DEFAULT 30,
  `limit_per_agent` int(11) DEFAULT 20,
  `total_tasks` int(11) DEFAULT 0,
  `agents_covered` int(11) DEFAULT 0,
  `collected_at` varchar(50) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_sess_session` (`session_id`),
  KEY `idx_sess_collected` (`collected_at`)
) ENGINE=InnoDB AUTO_INCREMENT=100 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `evaluation_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `agent_id` varchar(50) DEFAULT NULL COMMENT 'æ™ºèƒ½ä½“IDï¼ˆå”¯ä¸€ï¼‰',
  `config_key` varchar(100) NOT NULL,
  `config_value` mediumtext DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `agent_id` (`agent_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='è¯„ä¼°é…ç½®è¡¨';
CREATE TABLE IF NOT EXISTS `evaluation_configs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `agent_id` varchar(50) NOT NULL,
  `enabled` int(11) DEFAULT 1,
  `period` varchar(20) NOT NULL,
  `scope` mediumtext NOT NULL,
  `last_evaluation_at` varchar(50) DEFAULT NULL,
  `next_evaluation_at` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_configs_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `evaluation_metrics_history` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `report_id` int(11) NOT NULL,
  `agent_id` varchar(50) NOT NULL,
  `metric_key` varchar(100) NOT NULL,
  `metric_name` varchar(200) NOT NULL,
  `layer` varchar(20) NOT NULL,
  `score` decimal(6,2) NOT NULL,
  `weight` decimal(5,2) NOT NULL,
  `timestamp` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_mh_agent` (`agent_id`),
  KEY `idx_mh_key` (`metric_key`),
  KEY `idx_mh_ts` (`timestamp`)
) ENGINE=InnoDB AUTO_INCREMENT=6520 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `evaluation_reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `agent_id` varchar(50) NOT NULL,
  `task_id` varchar(255) DEFAULT NULL,
  `task_type` varchar(100) DEFAULT NULL,
  `timestamp` varchar(50) NOT NULL,
  `overall_score` decimal(6,2) NOT NULL,
  `overall_grade` varchar(10) NOT NULL,
  `overall_level` int(11) NOT NULL,
  `capability_score` decimal(6,2) DEFAULT NULL,
  `capability_metrics` mediumtext DEFAULT NULL,
  `quality_score` decimal(6,2) DEFAULT NULL,
  `quality_metrics` mediumtext DEFAULT NULL,
  `business_score` decimal(6,2) DEFAULT NULL,
  `business_metrics` mediumtext DEFAULT NULL,
  `input_duration` int(11) DEFAULT NULL,
  `input_output_length` int(11) DEFAULT NULL,
  `input_created_at` varchar(50) DEFAULT NULL,
  `trend_capability_delta` int(11) DEFAULT 0,
  `trend_capability_trend` varchar(20) DEFAULT 'stable',
  `trend_quality_delta` int(11) DEFAULT 0,
  `trend_quality_trend` varchar(20) DEFAULT 'stable',
  `trend_business_delta` int(11) DEFAULT 0,
  `trend_business_trend` varchar(20) DEFAULT 'stable',
  `trend_overall_delta` int(11) DEFAULT 0,
  `trend_overall_trend` varchar(20) DEFAULT 'stable',
  `recommendations` mediumtext DEFAULT NULL,
  `next_evaluation_at` varchar(50) DEFAULT NULL,
  `task_count` int(11) DEFAULT 0,
  `avg_score` decimal(6,2) DEFAULT NULL,
  `scope` mediumtext DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deliverable_score` decimal(4,2) DEFAULT NULL COMMENT 'äº¤ä»˜ç‰©è´¨é‡åˆ†ï¼ˆ0-10ï¼‰',
  `deliverable_count` int(11) DEFAULT NULL COMMENT 'æœ¬æ¬¡è¯„ä¼°å…³è”äº¤ä»˜ç‰©æ•°é‡',
  `has_artifact` tinyint(1) DEFAULT 0 COMMENT 'ä»»åŠ¡æ˜¯å¦å«äº¤ä»˜ç‰©',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_task_ts` (`agent_id`,`task_id`,`timestamp`),
  KEY `idx_reports_agent` (`agent_id`),
  KEY `idx_reports_task` (`task_id`),
  KEY `idx_reports_ts` (`timestamp`),
  KEY `idx_reports_grade` (`overall_grade`)
) ENGINE=InnoDB AUTO_INCREMENT=822 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `evaluation_runs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `run_id` varchar(36) NOT NULL,
  `run_type` varchar(50) NOT NULL,
  `agent_ids` mediumtext DEFAULT NULL,
  `task_id` varchar(255) DEFAULT NULL,
  `scope` mediumtext NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `started_at` varchar(50) DEFAULT NULL,
  `completed_at` varchar(50) DEFAULT NULL,
  `total_agents` int(11) DEFAULT 0,
  `total_tasks` int(11) DEFAULT 0,
  `avg_score` decimal(6,2) DEFAULT NULL,
  `error_message` mediumtext DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_runs_run` (`run_id`),
  KEY `idx_runs_status` (`status`),
  KEY `idx_runs_started` (`started_at`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `event_queue` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `type` varchar(50) NOT NULL COMMENT 'äº‹ä»¶ç±»åž‹',
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'äº‹ä»¶æ•°æ®' CHECK (json_valid(`payload`)),
  `status` enum('pending','processing','completed','failed') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `processed_at` timestamp NULL DEFAULT NULL,
  `error` mediumtext DEFAULT NULL COMMENT 'å¤„ç†é”™è¯¯ä¿¡æ¯',
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_type` (`type`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='äº‹ä»¶é˜Ÿåˆ—è¡¨';
CREATE TABLE IF NOT EXISTS `kb_chunk_terms` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `chunk_id` int(11) NOT NULL COMMENT 'å…³è”çŸ¥è¯†å—ID',
  `term` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chunk_term` (`chunk_id`,`term`),
  KEY `idx_term` (`term`),
  KEY `idx_chunk_id` (`chunk_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4232365 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='çŸ¥è¯†å—è¯é¡¹ç´¢å¼•';
CREATE TABLE IF NOT EXISTS `kb_chunks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `doc_id` varchar(512) NOT NULL COMMENT 'å…³è”æ–‡æ¡£ID',
  `chunk_index` int(11) NOT NULL COMMENT 'å—ç´¢å¼•',
  `text` mediumtext NOT NULL COMMENT 'å—æ–‡æœ¬å†…å®¹',
  `term_count` int(11) DEFAULT 0 COMMENT 'è¯é¡¹æ•°é‡',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_doc_chunk` (`doc_id`,`chunk_index`),
  KEY `idx_doc_id` (`doc_id`)
) ENGINE=InnoDB AUTO_INCREMENT=105842 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='çŸ¥è¯†åº“çŸ¥è¯†å—';
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
) ENGINE=InnoDB AUTO_INCREMENT=200 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='æ–‡æ¡£çº§ç»Ÿè®¡ä¿¡æ¯';
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
) ENGINE=InnoDB AUTO_INCREMENT=214 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='çŸ¥è¯†åº“æ–‡æ¡£å…ƒæ•°æ®';
CREATE TABLE IF NOT EXISTS `kb_global_terms` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `term` varchar(255) NOT NULL,
  `doc_freq` int(11) DEFAULT 1 COMMENT 'åŒ…å«è¯¥è¯é¡¹çš„æ–‡æ¡£æ•°',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `term` (`term`),
  KEY `idx_term` (`term`)
) ENGINE=InnoDB AUTO_INCREMENT=436726 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='å…¨å±€è¯é¡¹æ–‡æ¡£é¢‘çŽ‡';
CREATE TABLE IF NOT EXISTS `knowledge_documents` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category` varchar(50) NOT NULL COMMENT 'åˆ†ç±»: general/api/ui/performance',
  `title` varchar(200) NOT NULL,
  `content` longtext NOT NULL COMMENT 'Markdownå†…å®¹',
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'æ ‡ç­¾æ•°ç»„' CHECK (json_valid(`tags`)),
  `file_path` varchar(500) DEFAULT NULL COMMENT 'åŽŸæ–‡ä»¶è·¯å¾„',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`),
  FULLTEXT KEY `ft_title_content` (`title`,`content`) COMMENT 'å…¨æ–‡æ£€ç´¢ç´¢å¼•'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='çŸ¥è¯†åº“æ–‡æ¡£è¡¨';
CREATE TABLE IF NOT EXISTS `overall_stats` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `stat_key` varchar(64) NOT NULL,
  `stat_value` mediumtext DEFAULT NULL,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stat_key` (`stat_key`)
) ENGINE=InnoDB AUTO_INCREMENT=3872 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `performance_configs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `config_key` varchar(100) NOT NULL,
  `config_value` mediumtext DEFAULT NULL,
  `description` varchar(200) DEFAULT NULL,
  `updated_by` varchar(50) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`)
) ENGINE=InnoDB AUTO_INCREMENT=1191 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `performance_findings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `report_id` int(11) NOT NULL COMMENT 'å…³è” performance_reports.id',
  `finding_type` varchar(50) NOT NULL COMMENT 'response_time|throughput|resource|stability|error_rate',
  `severity` varchar(20) NOT NULL COMMENT 'critical|high|medium|low|info',
  `title` varchar(200) NOT NULL,
  `description` mediumtext DEFAULT NULL,
  `metric_detail` varchar(200) DEFAULT NULL,
  `threshold` varchar(100) DEFAULT NULL,
  `actual_value` varchar(100) DEFAULT NULL,
  `remediation` mediumtext DEFAULT NULL,
  `status` varchar(20) DEFAULT 'open' COMMENT 'open|accepted|fixed',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_report_id` (`report_id`),
  KEY `idx_severity` (`severity`),
  KEY `idx_finding_type` (`finding_type`),
  KEY `idx_status` (`status`),
  CONSTRAINT `1` FOREIGN KEY (`report_id`) REFERENCES `performance_reports` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `performance_reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `test_id` varchar(64) NOT NULL COMMENT 'æŠ¥å‘Šå”¯ä¸€ID(=workflowId)',
  `target` varchar(500) NOT NULL COMMENT 'è¢«æµ‹ç›®æ ‡ URL/æŽ¥å£',
  `test_type` varchar(50) NOT NULL DEFAULT 'load' COMMENT 'load|stress|stability|concurrency',
  `tool` varchar(50) DEFAULT 'jmeter' COMMENT 'jmeter|k6|locust|artillery',
  `status` varchar(20) NOT NULL DEFAULT 'running' COMMENT 'running|completed|failed',
  `overall_score` decimal(5,2) DEFAULT NULL COMMENT '0-100 ç»¼åˆè¯„åˆ†',
  `grade` varchar(20) DEFAULT NULL COMMENT 'ä¼˜ç§€|è‰¯å¥½|åˆæ ¼|ä¸è¾¾æ ‡',
  `sla_pass` tinyint(1) DEFAULT NULL COMMENT 'SLAæ˜¯å¦è¾¾æ ‡',
  `metrics_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '{tps,avg_rt,p95_rt,p99_rt,error_rate,throughput,cpu,memory,duration}' CHECK (json_valid(`metrics_summary`)),
  `findings_count` int(11) DEFAULT 0,
  `recommendations` mediumtext DEFAULT NULL,
  `tester` varchar(50) DEFAULT 'performance-tester',
  `duration_ms` int(11) DEFAULT NULL,
  `manual_hours` decimal(8,2) DEFAULT NULL COMMENT 'é¢„ä¼°äººå·¥å·¥æ—¶(å°æ—¶),ç”±estimateManualEffortè¯„ä¼°',
  `created_by` varchar(50) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `test_id` (`test_id`),
  KEY `idx_test_id` (`test_id`),
  KEY `idx_created_by` (`created_at`,`created_by`),
  KEY `idx_status` (`status`),
  KEY `idx_target` (`target`(100))
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `security_configs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `config_key` varchar(100) NOT NULL,
  `config_value` mediumtext DEFAULT NULL,
  `description` varchar(200) DEFAULT NULL,
  `updated_by` varchar(50) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `security_reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `scan_id` varchar(64) NOT NULL,
  `target` varchar(500) NOT NULL COMMENT '扫描目标 URL/host',
  `scan_type` varchar(50) NOT NULL DEFAULT 'full' COMMENT 'full|xss|sql|os|network|business',
  `status` varchar(20) NOT NULL DEFAULT 'running' COMMENT 'running|completed|failed',
  `overall_score` decimal(5,2) DEFAULT NULL COMMENT '0-100 安全评分',
  `severity_dist` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '{"critical":N,"high":N,"medium":N,"low":N}' CHECK (json_valid(`severity_dist`)),
  `findings_count` int(11) DEFAULT 0,
  `recommendations` mediumtext DEFAULT NULL,
  `scanner` varchar(50) DEFAULT 'security-sentinel',
  `duration_ms` int(11) DEFAULT NULL,
  `created_by` varchar(50) NOT NULL COMMENT 'user id',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `test_domain` varchar(30) NOT NULL DEFAULT 'web',
  `report_json` mediumtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_scan_id` (`scan_id`),
  KEY `idx_created_by` (`created_at`,`created_by`),
  KEY `idx_status` (`status`),
  KEY `idx_target` (`target`(100))
) ENGINE=InnoDB AUTO_INCREMENT=70 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `security_vulnerabilities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `report_id` int(11) NOT NULL,
  `vuln_type` varchar(50) NOT NULL COMMENT 'sql_injection|xss|csrf|auth_bypass|...',
  `severity` varchar(20) NOT NULL COMMENT 'critical|high|medium|low|info',
  `title` varchar(200) NOT NULL,
  `description` mediumtext DEFAULT NULL,
  `location` varchar(500) DEFAULT NULL COMMENT 'URL/endpoint/file:line',
  `evidence` mediumtext DEFAULT NULL,
  `remediation` mediumtext DEFAULT NULL,
  `status` varchar(20) DEFAULT 'open' COMMENT 'open|accepted|fixed',
  `cve` varchar(30) DEFAULT NULL,
  `cwe` varchar(30) DEFAULT NULL,
  `cvss` decimal(3,1) DEFAULT NULL,
  `created_by` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `ext_json` mediumtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_report_id` (`report_id`),
  KEY `idx_severity` (`severity`),
  KEY `idx_vuln_type` (`vuln_type`),
  KEY `idx_status` (`status`),
  CONSTRAINT `1` FOREIGN KEY (`report_id`) REFERENCES `security_reports` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=261 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `agent_id` varchar(50) DEFAULT NULL,
  `status` enum('active','ended') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `ended_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ä¼šè¯è¡¨';
CREATE TABLE IF NOT EXISTS `system_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `config_key` varchar(100) NOT NULL,
  `config_value` mediumtext DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`)
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `task_artifacts` (
  `id` varchar(50) NOT NULL COMMENT 'artifact-0, artifact-1...',
  `task_id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL COMMENT 'é™„ä»¶åç§°',
  `type` varchar(20) DEFAULT NULL COMMENT 'é™„ä»¶ç±»åž‹',
  `file_path` varchar(500) DEFAULT NULL COMMENT 'æ–‡ä»¶è·¯å¾„',
  `download_url` varchar(500) DEFAULT NULL COMMENT 'ä¸‹è½½URL',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  CONSTRAINT `1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ä»»åŠ¡é™„ä»¶è¡¨';
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
) ENGINE=InnoDB AUTO_INCREMENT=570 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
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
  `error_message` mediumtext DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `task_output_files` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(36) NOT NULL,
  `file_path` varchar(500) NOT NULL COMMENT 'è¾“å‡ºæ–‡ä»¶è·¯å¾„',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `version` int(11) DEFAULT 1,
  `version_source` varchar(20) DEFAULT 'agent',
  `display_version` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1528 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ä»»åŠ¡è¾“å‡ºæ–‡ä»¶è¡¨';
CREATE TABLE IF NOT EXISTS `task_review_results` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(36) NOT NULL,
  `reviewer_id` varchar(50) NOT NULL COMMENT 'å®¡æ ¸æ™ºèƒ½ä½“ID',
  `reviewer_name` varchar(100) DEFAULT NULL COMMENT 'å®¡æ ¸æ™ºèƒ½ä½“åç§°',
  `score` int(11) DEFAULT NULL COMMENT 'è¯„åˆ†',
  `veto` tinyint(1) DEFAULT 0 COMMENT 'æ˜¯å¦ä¸€ç¥¨å¦å†³',
  `passed` tinyint(1) DEFAULT NULL COMMENT 'æ˜¯å¦é€šè¿‡',
  `output` mediumtext DEFAULT NULL COMMENT 'å®¡æ ¸è¾“å‡º',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_reviewer_id` (`reviewer_id`),
  KEY `idx_passed` (`passed`)
) ENGINE=InnoDB AUTO_INCREMENT=843 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ä»»åŠ¡å®¡æ ¸ç»“æžœè¡¨';
CREATE TABLE IF NOT EXISTS `tasks` (
  `id` varchar(36) NOT NULL,
  `type` varchar(50) DEFAULT 'general',
  `source` enum('step','workflow') DEFAULT 'step' COMMENT 'ä»»åŠ¡æ¥æºï¼šstep-åˆ†æ­¥æµ‹è¯•, workflow-æµ‹è¯•æµæ°´çº¿',
  `status` enum('pending','running','completed','failed') DEFAULT 'pending' COMMENT 'ä»»åŠ¡çŠ¶æ€',
  `input` mediumtext NOT NULL COMMENT 'ç”¨æˆ·è¾“å…¥',
  `agent_id` varchar(50) NOT NULL COMMENT 'æ‰§è¡Œæ™ºèƒ½ä½“ID',
  `priority` enum('low','normal','high') DEFAULT 'normal' COMMENT 'ä¼˜å…ˆçº§',
  `user_id` varchar(36) NOT NULL COMMENT 'ç”¨æˆ·ID',
  `result` longtext DEFAULT NULL COMMENT 'æ‰§è¡Œç»“æžœï¼ˆå¯èƒ½å¾ˆé•¿ï¼‰',
  `error` mediumtext DEFAULT NULL COMMENT 'é”™è¯¯ä¿¡æ¯',
  `artifacts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`artifacts`)),
  `require_review` tinyint(1) DEFAULT 1 COMMENT 'æ˜¯å¦éœ€è¦å®¡æ ¸',
  `review_passed` tinyint(1) DEFAULT NULL COMMENT 'å®¡æ ¸æ˜¯å¦é€šè¿‡',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL COMMENT 'å®Œæˆæ—¶é—´',
  `input_tokens` int(11) DEFAULT 0 COMMENT '输入token消耗',
  `output_tokens` int(11) DEFAULT 0 COMMENT '输出token消耗',
  `token_cost` decimal(10,6) DEFAULT 0.000000 COMMENT '每1K token价格(元)',
  `actual_cost` decimal(10,4) DEFAULT 0.0000 COMMENT '实际执行成本(元)',
  `manual_hours` decimal(8,2) DEFAULT 0.00 COMMENT '预估人工执行工时(小时)',
  `labor_cost` decimal(10,4) DEFAULT 0.0000 COMMENT '每小时人力成本(元)',
  `estimated_cost` decimal(10,4) DEFAULT 0.0000 COMMENT '预估人工执行成本(元)',
  `saved_cost` decimal(10,4) DEFAULT 0.0000 COMMENT '节省成本(元)',
  `chat_history` longtext DEFAULT NULL COMMENT '多轮对话历史(JSON 文本)',
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_review_passed` (`review_passed`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ä»»åŠ¡è¡¨';
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
  `username` varchar(100) DEFAULT NULL COMMENT '用户名（冗余存储）',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=5302 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=387 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `users` (
  `id` varchar(36) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL COMMENT 'å¯†ç åŠ å¯†å­˜å‚¨',
  `name` varchar(100) DEFAULT NULL,
  `role` enum('admin','user') DEFAULT 'user',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_username` (`username`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ç”¨æˆ·è¡¨';
CREATE TABLE IF NOT EXISTS `waiting_input_sessions` (
  `task_id` varchar(36) NOT NULL,
  `agent_id` varchar(100) NOT NULL,
  `workflow_id` varchar(36) DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`task_id`),
  KEY `idx_workflow` (`workflow_id`),
  KEY `idx_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `web_compatibility_reports` (
  `id` varchar(36) NOT NULL,
  `url` varchar(500) NOT NULL,
  `total` int(11) DEFAULT 0,
  `passed` int(11) DEFAULT 0,
  `failed` int(11) DEFAULT 0,
  `errored` int(11) DEFAULT 0,
  `score` int(11) DEFAULT 0,
  `matrix_config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`matrix_config`)),
  `report_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`report_data`)),
  `created_by` varchar(36) DEFAULT NULL,
  `created_by_name` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `workflows` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `input` mediumtext DEFAULT NULL,
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

SET FOREIGN_KEY_CHECKS = 1;
