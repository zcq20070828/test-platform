-- 任务审核结论持久化（2026-11-17）
--
-- 背景：审核判定从「中位数 ≥80」改为「并集 + 密度」后，多了一个结论状态
-- `passed_with_notes`（门禁客观达标、无 blocker，但审核有若干改进建议）。
-- 这个状态与 `passed` 在交付物可用性上没有区别，但用户需要知道
-- 「已经交付，同时还有 N 条改进建议」——否则审核意见等于白收集。
--
-- 此前只有 review_passed(0/1) 一个布尔列，无法表达三种结论：
--   passed / passed_with_notes / failed
--
-- 同时把「审核结论的成因」落库，便于任务详情页直接展示：
--   review_summary  一句话结论（含密度、blocker 数）
--   review_notes    改进建议（去重后的 issues 摘要，JSON）
--   review_attempts 经过几轮审核才定论
--
-- 幂等：ADD COLUMN IF NOT EXISTS（MariaDB 10.4+ 支持）。

ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `review_verdict` varchar(32) DEFAULT NULL COMMENT '审核结论: passed|passed_with_notes|failed|inconclusive|veto' AFTER `review_passed`;

ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `review_summary` varchar(500) DEFAULT NULL COMMENT '审核结论摘要（含密度与 blocker 数）' AFTER `review_verdict`;

ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `review_notes` mediumtext DEFAULT NULL COMMENT '改进建议 JSON 数组（并集去重后的 issues 摘要）' AFTER `review_summary`;

ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `review_attempts` int(11) DEFAULT NULL COMMENT '审核轮数（1 表示一轮通过，>1 表示经重试）' AFTER `review_notes`;

ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `review_stats` varchar(255) DEFAULT NULL COMMENT '并集统计 blocker/major/minor 与 major 密度' AFTER `review_attempts`;
