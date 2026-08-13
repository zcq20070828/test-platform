-- 工作流预估人工工时字段
ALTER TABLE workflows ADD COLUMN manual_hours DECIMAL(10,2) DEFAULT NULL COMMENT '预估人工工时(小时)' AFTER scenario;
