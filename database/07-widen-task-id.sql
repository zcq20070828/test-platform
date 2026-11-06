-- 迁移：放宽 case_feedback / task_quality_metrics 的 task_id 长度（2026-11-06）
--
-- 背景：工作流派生的任务 ID 形如 `<workflowId>-step-2`（36 + 7 = 43 字符），
-- 原 varchar(36) 导致质量快照落库报 ER_DATA_TOO_LONG，静默丢弃。
-- 幂等：MODIFY COLUMN 可重复执行。

ALTER TABLE `case_feedback`
  MODIFY COLUMN `task_id` varchar(64) NOT NULL COMMENT '关联任务（工作流派生 ID 可达 43 字符）';

ALTER TABLE `task_quality_metrics`
  MODIFY COLUMN `task_id` varchar(64) NOT NULL;
