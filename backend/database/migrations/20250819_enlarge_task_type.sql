-- 扩大 tasks.type 列长度，支持 agent_id 存储
ALTER TABLE tasks MODIFY COLUMN type VARCHAR(50) DEFAULT 'general';
