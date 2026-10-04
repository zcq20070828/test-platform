-- 20261004: tasks.error 由 TEXT(64KB) 扩容为 MEDIUMTEXT(16MB)
--
-- 背景(同类隐患,与 input 扩容同源):
--   tasks.input 已于同日扩容为 MEDIUMTEXT(见 20261004_enlarge_task_input.sql)。
--   但 tasks.error 仍为 TEXT,上限 65535 字节。智能体执行失败时写入的
--   error 内容可能包含完整错误堆栈 / 大段工具返回原文 / 模型原始输出片段,
--   一旦超过 64KB 就会复现与 input 完全相同的故障:
--     - ER_TRUNCATED_WRONG_VALUE_FOR_FIELD(1366) Incorrect string value
--       (截断落在多字节字符中间时 —— 中文堆栈尤其容易命中)
--     - ER_DATA_TOO_LONG(1406) Data too long for column 'error'
--       (截断正好落在字符边界时)
--   表现为任务执行结果无法落库 / 更新任务 500。
--
-- 修复: error 扩容为 MEDIUMTEXT(最大 16MB),与 input 一致,彻底消除 64KB 上限。
--   说明: result / chat_history / artifacts 已是 LONGTEXT,无需处理。
ALTER TABLE tasks
  MODIFY COLUMN error MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL
  COMMENT '错误信息';
