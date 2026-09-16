-- 2026-09-15: chatHistory 按 taskId 隔离，避免同智能体多任务上下文污染
-- 背景：原 histKey = ${userId}:${agentId}，跨 task 累积；同一 agent 多任务时旧任务的对话会污染新任务
-- 旧数据 task_id=NULL，新代码按 task_id 过滤时自然淘汰

ALTER TABLE conversation_history
  ADD COLUMN task_id VARCHAR(36) NULL AFTER agent_id,
  ADD INDEX idx_user_agent_task (user_id, agent_id, task_id, turn_index);