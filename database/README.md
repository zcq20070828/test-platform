# 数据库中台增量更新脚本（2026-07-30）

本目录包含「从 v1.0.0 (17表) 到当前最新结构 (34表)」的**增量**更新，
**不会删除或重置现有数据**，仅补齐新增的表/列，并 INSERT IGNORE 初始化数据。
表/列来源为本地 dev 数据库（test_platform）的真实结构。

## 使用方法

在**目标服务器**（腾讯云，数据库名 test_platform）执行：

```bash
mysql -u root -p test_platform < 01-schema-incremental.sql
mysql -u root -p test_platform < 02-init-data-incremental.sql
```

## 幂等说明

- 新增表：`CREATE TABLE IF NOT EXISTS`，已存在则跳过。
- 新增列：`ALTER TABLE ADD COLUMN` 带 INFORMATION_SCHEMA 存在性检查，已存在则跳过。
- 初始化数据：`INSERT IGNORE`，已存在则跳过。

可重复执行，安全无副作用。

## 增量范围

- 新增表 17 张：workflows、conversation_history、waiting_input_sessions、
  agent_learned_knowledge、defects、overall_stats、kb_documents、kb_chunks、
  kb_chunk_terms、kb_doc_stats、kb_global_terms、*_daily_stats 统计表、
  user_action_logs、task_execution_logs、evaluation_configs
- 共有表新增列约 70 个：tasks 的 9 个成本列、evaluation_reports 的 28 个列
  （含 deliverable_score 等）、evaluation_runs / evaluation_metrics_history /
  evaluation_collected_tasks / evaluation_collection_sessions 的新列
- 初始化数据：管理员账户、system_config（INSERT IGNORE）

⚠️ 数据库名必须为 `test_platform`。
