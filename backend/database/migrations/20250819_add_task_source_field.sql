-- 任务来源字段：区分分步测试和测试流水线
ALTER TABLE tasks ADD COLUMN source ENUM('step', 'workflow') DEFAULT 'step' COMMENT '任务来源：step-分步测试, workflow-测试流水线' AFTER type;

-- 为已有任务设置默认值（根据 workflow_id 推断，后续会被覆盖）
UPDATE tasks SET source = CASE WHEN workflow_id IS NOT NULL THEN 'workflow' ELSE 'step' END;
