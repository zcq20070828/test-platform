-- 智能体经验库（2026-11-20）
--
-- 背景：平台每天跑出大量质量信号，但没有任何一条回流去改进下一次生成：
--   task_review_results  351 行（三个审核员的 issues，8 类问题分布清晰）
--   task_quality_metrics  34 行（门禁的 byReason 缺陷分布）
--   case_feedback          3 行（人工标注，几乎无人使用）
-- 这些数据只被用来「判定这一次过不过」，从不影响「下一次怎么写」。
--
-- 这张表把它们聚成「经验」，形成真正的闭环：
--   1) 提取：每个任务结束后，把审核 issues / 门禁缺陷 / 人工标注归一成经验条目，
--      按 (agent_id, category, pattern_key) 去重累加次数。
--   2) 注入：生成前把「活跃且未失效」的经验拼进系统提示词。
--   3) 验证：记录注入前后的「命中率」（每 N 个任务命中几次），算出 effectiveness。
--   4) 进化：命中率没降 → 升级（从软提示升级为「会被门禁直接拦下」的强约束）；
--      长期不再出现 → 休眠，省掉上下文开销；人工可随时废除。
--
-- 幂等：CREATE TABLE IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS `agent_experiences` (
  `id` varchar(36) NOT NULL COMMENT '主键 UUID',
  `agent_id` varchar(50) NOT NULL COMMENT '适用智能体',
  `category` varchar(32) NOT NULL COMMENT '问题类别: assertion/placeholder/duplicate/coverage/format/logic/traceability/other',
  `pattern_key` varchar(160) NOT NULL COMMENT '归一化签名，用于跨任务去重',
  `title` varchar(160) NOT NULL COMMENT '一句话说明这是什么问题',
  `guidance` text NOT NULL COMMENT '可执行的改进要求（注入提示词的就是这段）',
  `source` varchar(16) NOT NULL DEFAULT 'review' COMMENT '最近一次来源: review/gate/human',
  `samples` text DEFAULT NULL COMMENT '最多 3 条真实样例（截断），供人工判断经验是否可信',

  -- 命中统计（用于算注入前后的效果）
  `occurrences_total` int(11) NOT NULL DEFAULT 1 COMMENT '累计命中次数',
  `occurrences_before` int(11) NOT NULL DEFAULT 1 COMMENT '开始注入前命中次数',
  `occurrences_after` int(11) NOT NULL DEFAULT 0 COMMENT '开始注入后命中次数',
  `tasks_before` int(11) NOT NULL DEFAULT 0 COMMENT '注入前观测到的任务数',
  `tasks_after` int(11) NOT NULL DEFAULT 0 COMMENT '注入后观测到的任务数',

  -- 进化状态
  `status` varchar(16) NOT NULL DEFAULT 'active' COMMENT 'active/watch/dormant/suppressed',
  `level` tinyint(4) NOT NULL DEFAULT 1 COMMENT '1=软提示 2=强约束提示 3=明确告知会被门禁拦截',
  `effectiveness` decimal(5,4) DEFAULT NULL COMMENT '命中率下降比例 0~1；NULL=样本不足',
  `suppressed_reason` varchar(255) DEFAULT NULL COMMENT '人工废除原因',

  `first_seen_at` timestamp NULL DEFAULT current_timestamp(),
  `last_seen_at` timestamp NULL DEFAULT current_timestamp(),
  `injected_since` timestamp NULL DEFAULT NULL COMMENT '开始注入的时间；NULL=尚未注入',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_category_pattern` (`agent_id`, `category`, `pattern_key`),
  KEY `idx_agent_status` (`agent_id`, `status`),
  KEY `idx_last_seen` (`last_seen_at`),
  KEY `idx_effectiveness` (`effectiveness`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='智能体经验库（自我进化闭环）';

-- 进化动作审计：什么时候升级/降级/休眠/废除，为什么
CREATE TABLE IF NOT EXISTS `experience_evolution_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `experience_id` varchar(36) NOT NULL,
  `agent_id` varchar(50) NOT NULL,
  `action` varchar(24) NOT NULL COMMENT 'created/promoted/demoted/dormant/suppressed/resurrected/applied',
  `from_level` tinyint(4) DEFAULT NULL,
  `to_level` tinyint(4) DEFAULT NULL,
  `detail` varchar(500) DEFAULT NULL COMMENT '决策依据（命中率、样本数等）',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_experience` (`experience_id`),
  KEY `idx_agent_created` (`agent_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='经验进化动作审计';

-- 门禁阈值自动校准的记录（用审核评分作弱标签）
CREATE TABLE IF NOT EXISTS `gate_threshold_history` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `threshold` decimal(5,4) NOT NULL COMMENT '采纳后的阈值',
  `previous` decimal(5,4) DEFAULT NULL,
  `sample_tasks` int(11) NOT NULL DEFAULT 0,
  `agreement` decimal(5,4) DEFAULT NULL COMMENT '该阈值下「门禁判定」与「审核判定」的一致率',
  `source` varchar(24) NOT NULL DEFAULT 'auto_review' COMMENT 'auto_review/manual',
  `detail` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='门禁阈值变更历史';

-- task_quality_metrics 补两列：审核结论（作为阈值校准的弱标签）
-- 之前这张表只存门禁自己的结论，没有「人/审核认为好不好」的对照，
-- 所以阈值永远无法被验证，也永远停在默认 0.85。
ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `review_median` decimal(5,2) DEFAULT NULL COMMENT '三个审核员评分中位数（弱标签）' AFTER `gate_passed`;

ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `review_verdict` varchar(32) DEFAULT NULL COMMENT '审核结论 passed/passed_with_notes/failed/inconclusive' AFTER `review_median`;
