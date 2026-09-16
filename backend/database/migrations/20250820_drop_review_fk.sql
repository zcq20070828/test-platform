-- 20250820: task_review_results 外键约束导致 workflow 审核无法落库
-- workflow(auto-with-review) 的审核记录 task_id = workflowId，但 workflow 不写 tasks 表
-- 外键 REFERENCES tasks(id) 导致 INSERT 失败(被 catch 吞掉)
-- 修复: 去掉外键，保留普通索引(idx_task_id)
-- 注意: dev 库约束名为 `1`(SHOW CREATE TABLE 确认)，生产可能不同，需先查再执行
ALTER TABLE task_review_results DROP FOREIGN KEY `1`;
