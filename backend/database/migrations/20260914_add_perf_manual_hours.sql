-- 2026-09-14: performance_reports 表增加预估工时字段
ALTER TABLE performance_reports
  ADD COLUMN IF NOT EXISTS manual_hours DECIMAL(8,2) DEFAULT NULL COMMENT '预估人工工时(小时),由estimateManualEffort评估' AFTER duration_ms;
