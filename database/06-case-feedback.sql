-- 用例级采纳反馈与质量度量（2026-11-06 · 阶段四）
--
-- 用途：
--   1. case_feedback   记录人工对每条用例的「可用/不可用」判定与拒绝原因，
--      这是唯一能算出**真实可用率**的数据源（门禁算的是规则可用率）。
--   2. task_quality_metrics  每个任务一份质量快照（门禁算出的可用率、
--      各原因计数、输入侧解析告警数），用于按周统计趋势。
--
-- 幂等：CREATE TABLE IF NOT EXISTS，可重复执行。

CREATE TABLE IF NOT EXISTS `case_feedback` (
  `id` varchar(36) NOT NULL,
  `task_id` varchar(36) NOT NULL COMMENT '关联任务',
  `case_id` varchar(32) NOT NULL COMMENT '用例编号，如 TC-012',
  `usable` tinyint(1) NOT NULL COMMENT '1=可用 0=不可用',
  `reject_reason` varchar(64) DEFAULT NULL COMMENT '断言缺失/输入占位/重复/无价值/与需求不符/其他',
  `comment` varchar(500) DEFAULT NULL COMMENT '人工备注',
  `reviewer` varchar(64) DEFAULT NULL COMMENT '标记人用户名',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_case` (`task_id`,`case_id`),
  KEY `idx_task` (`task_id`),
  KEY `idx_reason` (`reject_reason`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `task_quality_metrics` (
  `id` varchar(36) NOT NULL,
  `task_id` varchar(36) NOT NULL,
  `agent_id` varchar(64) NOT NULL,
  `total_cases` int(11) DEFAULT 0,
  `usable_cases` int(11) DEFAULT 0,
  `usability_gate` decimal(6,4) DEFAULT NULL COMMENT '规则引擎算出的可用率 0~1',
  `usability_human` decimal(6,4) DEFAULT NULL COMMENT '人工标记算出的可用率 0~1',
  `blocker_count` int(11) DEFAULT 0,
  `major_count` int(11) DEFAULT 0,
  `auto_repairs` int(11) DEFAULT 0 COMMENT '系统自动修复的占位输入数',
  `repair_rounds` int(11) DEFAULT 0 COMMENT '定向修复轮数',
  `by_reason` json DEFAULT NULL COMMENT '按原因归类计数',
  `input_warnings` int(11) DEFAULT 0 COMMENT '输入侧解析告警数（表格丢失/截断等）',
  `gate_passed` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task` (`task_id`),
  KEY `idx_agent` (`agent_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
