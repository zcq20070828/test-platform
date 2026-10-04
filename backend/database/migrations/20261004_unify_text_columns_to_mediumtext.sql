-- 20261004: 全库 TEXT/TINYTEXT 列统一扩容为 MEDIUMTEXT(16MB) —— 统一根治容量类故障
--
-- 背景:
--   建表时大量列默认使用 TEXT(上限 65535 字节)。任何承载"长内容"的字段
--   (任务输入 / 智能体输出 / 审核输出 / 错误堆栈 / 知识库切片 / 对话历史 等)
--   一旦超过 64KB,MySQL/MariaDB 截断时会把多字节汉字从中间切断,抛出:
--     - ER_TRUNCATED_WRONG_VALUE_FOR_FIELD(1366) Incorrect string value
--       (截断落在多字节字符中间 —— 中文内容尤其容易命中)
--     - ER_DATA_TOO_LONG(1406) Data too long for column 'xxx'
--       (截断正好落在字符边界)
--   表现为接口 500、任务创建不出来。且报错信息完全不提"长度",极易被误判为
--   字符集 / 脏字节问题(本项目已因此连续打偏两次根因)。
--
-- 为什么统一做而不是逐列改:
--   tasks.input / tasks.error / task_review_results.output 已分别踩坑并单独扩容,
--   但全库仍有 35 个 TEXT 列属同类隐患。逐列打补丁必然遗漏,
--   故改为一次性统一扩容,从结构上消除这一整类故障。
--
-- 成本说明:
--   MEDIUMTEXT 与 TEXT 的存储开销几乎相同(仅长度前缀 2→3 字节),
--   对短字段无实际影响,可放心统一升级。
--
-- 覆盖范围(35 列):
-- agent_learned_knowledge.content_preview
-- conversation_history.content
-- conversation_history_garbled_backup_20260814.content
-- credentials.access_token
-- credentials.refresh_token
-- defects.description
-- evaluation_collected_tasks.input
-- evaluation_collected_tasks.output
-- evaluation_collection_sessions.agent_ids
-- evaluation_config.config_value
-- evaluation_configs.scope
-- evaluation_reports.business_metrics
-- evaluation_reports.capability_metrics
-- evaluation_reports.quality_metrics
-- evaluation_reports.recommendations
-- evaluation_reports.scope
-- evaluation_runs.agent_ids
-- evaluation_runs.error_message
-- evaluation_runs.scope
-- event_queue.error
-- kb_chunks.text
-- overall_stats.stat_value
-- performance_configs.config_value
-- performance_findings.description
-- performance_findings.remediation
-- performance_reports.recommendations
-- security_configs.config_value
-- security_reports.recommendations
-- security_vulnerabilities.description
-- security_vulnerabilities.evidence
-- security_vulnerabilities.remediation
-- system_config.config_value
-- task_execution_logs.error_message
-- task_review_results.output
-- workflows.input
--
-- 配套代码层护栏: backend/database/text-safety.js (fitUtf8Bytes 按字节安全截断,
--   保证即使将来某列忘记扩容,也不会因超限导致请求 500)

ALTER TABLE `agent_learned_knowledge`
  MODIFY COLUMN `content_preview` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL
  COMMENT 'å†…å®¹é¢„è§ˆ(å‰500å­—ç¬¦ï¼Œç”¨äºŽå¿«é€Ÿæ³¨å…¥)';

ALTER TABLE `conversation_history`
  MODIFY COLUMN `content` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NOT NULL;

ALTER TABLE `conversation_history_garbled_backup_20260814`
  MODIFY COLUMN `content` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NOT NULL;

ALTER TABLE `credentials`
  MODIFY COLUMN `access_token` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL
  COMMENT 'è®¿é—®ä»¤ç‰Œï¼ˆåŠ å¯†ï¼‰';

ALTER TABLE `credentials`
  MODIFY COLUMN `refresh_token` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL
  COMMENT 'åˆ·æ–°ä»¤ç‰Œï¼ˆåŠ å¯†ï¼‰';

ALTER TABLE `defects`
  MODIFY COLUMN `description` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_collected_tasks`
  MODIFY COLUMN `input` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_collected_tasks`
  MODIFY COLUMN `output` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_collection_sessions`
  MODIFY COLUMN `agent_ids` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_config`
  MODIFY COLUMN `config_value` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_configs`
  MODIFY COLUMN `scope` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NOT NULL;

ALTER TABLE `evaluation_reports`
  MODIFY COLUMN `business_metrics` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_reports`
  MODIFY COLUMN `capability_metrics` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_reports`
  MODIFY COLUMN `quality_metrics` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_reports`
  MODIFY COLUMN `recommendations` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_reports`
  MODIFY COLUMN `scope` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_runs`
  MODIFY COLUMN `agent_ids` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_runs`
  MODIFY COLUMN `error_message` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `evaluation_runs`
  MODIFY COLUMN `scope` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NOT NULL;

ALTER TABLE `event_queue`
  MODIFY COLUMN `error` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL
  COMMENT 'å¤„ç†é”™è¯¯ä¿¡æ¯';

ALTER TABLE `kb_chunks`
  MODIFY COLUMN `text` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NOT NULL
  COMMENT 'å—æ–‡æœ¬å†…å®¹';

ALTER TABLE `overall_stats`
  MODIFY COLUMN `stat_value` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `performance_configs`
  MODIFY COLUMN `config_value` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `performance_findings`
  MODIFY COLUMN `description` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `performance_findings`
  MODIFY COLUMN `remediation` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `performance_reports`
  MODIFY COLUMN `recommendations` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `security_configs`
  MODIFY COLUMN `config_value` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `security_reports`
  MODIFY COLUMN `recommendations` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `security_vulnerabilities`
  MODIFY COLUMN `description` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `security_vulnerabilities`
  MODIFY COLUMN `evidence` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `security_vulnerabilities`
  MODIFY COLUMN `remediation` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `system_config`
  MODIFY COLUMN `config_value` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `task_execution_logs`
  MODIFY COLUMN `error_message` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;

ALTER TABLE `task_review_results`
  MODIFY COLUMN `output` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL
  COMMENT 'å®¡æ ¸è¾“å‡º';

ALTER TABLE `workflows`
  MODIFY COLUMN `input` MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NULL;
