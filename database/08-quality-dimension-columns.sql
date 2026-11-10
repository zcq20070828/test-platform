-- 迁移：质量快照记录九维覆盖情况（2026-11-09）
--
-- 背景：门禁从「只看单条可用率」升级为「可用率 + 九维必测点覆盖」双判定。
-- 需要把维度覆盖结果也落库，否则趋势页看不到「覆盖率是标注还是约束」的差别，
-- 也无法回答「加严维度判定后有多少任务从通过变成不通过」。
--
-- 幂等：ADD COLUMN IF NOT EXISTS（MariaDB 10.4+ 支持）。

ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `dimension_coverage` decimal(6,4) DEFAULT NULL COMMENT '九维必测点覆盖率 0~1' AFTER `by_reason`;

ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `dimension_missing` varchar(255) DEFAULT NULL COMMENT '缺失的维度键，逗号分隔' AFTER `dimension_coverage`;

ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `dimension_waived` varchar(255) DEFAULT NULL COMMENT '声明豁免的维度键，逗号分隔' AFTER `dimension_missing`;

ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `skipped_rows` int(11) DEFAULT 0 COMMENT '编号非法被跳过、未纳入检查的行数' AFTER `dimension_waived`;

ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `usability_pass` tinyint(1) DEFAULT NULL COMMENT '单条可用率是否达标（与 gate_passed 区分：两者都达标 gate_passed 才为 1）' AFTER `skipped_rows`;
