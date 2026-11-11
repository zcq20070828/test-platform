-- 任务时间线（2026-11-11）
--
-- 背景：门禁结果、三个审核员的评分、定向修复轮次、规则门禁这些「过程信息」
-- 只由前端 handleRealtimeEvent 写进内存数组 messages.value。
-- 任务结束或刷新页面后走 loadRecentTaskResults()，它只恢复一条
-- 「任务X完成 + 最终产出」，过程消息全部丢失 —— 用户看到的就是「实时信息不完整」。
--
-- 但数据其实一直在库里（task_review_results 有每轮每人的分数，
-- task_quality_metrics 有门禁快照），只是没有任何接口把它们按时间顺序读回来。
--
-- 这张表补的是「事件流」这一层：把广播出去的task级过程事件按 seq 落盘，
-- 刷新后按 seq 重放，聊天面板就能完整复原当时的执行过程。
--
-- 幂等：CREATE TABLE IF NOT EXISTS，可重复执行。

CREATE TABLE IF NOT EXISTS `task_timeline_events` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(64) NOT NULL COMMENT '任务ID（工作流派生ID可达43字符）',
  `seq` int(11) NOT NULL COMMENT '任务内递增序号，用于稳定排序',
  `type` varchar(48) NOT NULL COMMENT '事件类型，如 reviewer_completed / case_quality_gate',
  `agent_id` varchar(64) DEFAULT NULL,
  `payload` mediumtext DEFAULT NULL COMMENT '事件负载（超长已截断，original_size 记原长度）',
  `original_size` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_seq` (`task_id`,`seq`),
  KEY `idx_task_created` (`task_id`,`created_at`),
  KEY `idx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
