-- 经验同期对照实验（2026-11-20）
--
-- 为什么要这张表：
--   第一版用「注入前 vs 注入后」的命中率对比算效果，这是**前后对照**，
--   会被任务难度漂移污染：用户今天提交的任务变简单了，命中率自然下降，
--   就被误判成「经验有效」而休眠。反之亦然。
--
-- 同期对照（concurrent control）的做法：
--   在同一次任务内，把召回到的经验随机分成两组——
--     treatment（注入）→ 看该经验对应的问题是否还出现
--     control  （留出）→ 看该经验对应的问题是否出现
--   两组的任务、模型、时间、难度完全相同，唯一差别就是「有没有注入这一条」，
--   所以两组问题发生率的差异就是这条经验的真实因果效应。
--
--   这是标准的随机对照试验（RCT），且**不会显著降低交付质量**：
--   只随机化「还没测准」的经验（默认 level<2 且样本不足），
--   已证明有效的经验永远注入；单任务最多留出 2 条，且不动相关性最高的那条。
--
-- 幂等：CREATE TABLE IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS `experience_trials` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(64) NOT NULL COMMENT '任务 ID',
  `agent_id` varchar(50) NOT NULL,
  `experience_id` varchar(36) NOT NULL,
  `pattern_key` varchar(160) NOT NULL COMMENT '该经验对应的问题签名（用于匹配本任务是否出现同类问题）',
  `arm` varchar(12) NOT NULL COMMENT 'treatment=注入 / control=留出',
  `problem_occurred` tinyint(1) NOT NULL DEFAULT 0 COMMENT '该经验对应的问题在本任务中是否出现',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_experience` (`task_id`, `experience_id`),
  KEY `idx_experience_arm` (`experience_id`, `arm`),
  KEY `idx_agent_created` (`agent_id`, `created_at`),
  KEY `idx_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='经验同期对照试验（每条任务×经验一行）';
