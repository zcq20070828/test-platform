-- 智能体评估数据库表结构
-- 创建时间: 2026-07-14
-- 更新时间: 2026-07-14 14:35 - 添加数据收集表

-- 1. 评估报告表
CREATE TABLE IF NOT EXISTS evaluation_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  task_type TEXT,
  timestamp TEXT NOT NULL,
  
  -- 综合评分
  overall_score INTEGER NOT NULL,
  overall_grade TEXT NOT NULL,
  overall_level INTEGER NOT NULL,
  
  -- 能力层评分
  capability_score INTEGER,
  capability_metrics TEXT,  -- JSON: [{key, name, score, weight}]
  
  -- 质量层评分
  quality_score INTEGER,
  quality_metrics TEXT,  -- JSON
  
  -- 业务价值层评分
  business_score INTEGER,
  business_metrics TEXT,  -- JSON
  
  -- 输入元数据
  input_duration INTEGER,
  input_output_length INTEGER,
  input_created_at TEXT,
  
  -- 趋势
  trend_capability_delta INTEGER DEFAULT 0,
  trend_capability_trend TEXT DEFAULT 'stable',
  trend_quality_delta INTEGER DEFAULT 0,
  trend_quality_trend TEXT DEFAULT 'stable',
  trend_business_delta INTEGER DEFAULT 0,
  trend_business_trend TEXT DEFAULT 'stable',
  trend_overall_delta INTEGER DEFAULT 0,
  trend_overall_trend TEXT DEFAULT 'stable',
  
  -- 改进建议
  recommendations TEXT,  -- JSON array
  
  -- 下次评估时间
  next_evaluation_at TEXT,
  
  -- 任务统计
  task_count INTEGER DEFAULT 0,
  avg_score INTEGER,
  
  -- 评估范围
  scope TEXT,  -- JSON array: ["capability", "quality", "business"]
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_evaluation_reports_agent_id ON evaluation_reports(agent_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_reports_task_id ON evaluation_reports(task_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_reports_timestamp ON evaluation_reports(timestamp);
CREATE INDEX IF NOT EXISTS idx_evaluation_reports_overall_grade ON evaluation_reports(overall_grade);

-- 2. 评估指标历史表（用于趋势分析）
CREATE TABLE IF NOT EXISTS evaluation_metrics_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  layer TEXT NOT NULL,  -- capability/quality/business
  score INTEGER NOT NULL,
  weight REAL NOT NULL,
  timestamp TEXT NOT NULL,
  
  FOREIGN KEY (report_id) REFERENCES evaluation_reports(id)
);

CREATE INDEX IF NOT EXISTS idx_metrics_history_agent_id ON evaluation_metrics_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_metrics_history_metric_key ON evaluation_metrics_history(metric_key);
CREATE INDEX IF NOT EXISTS idx_metrics_history_timestamp ON evaluation_metrics_history(timestamp);

-- 3. 评估任务表（记录每次评估执行的元信息）
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,  -- UUID
  run_type TEXT NOT NULL,  -- 'agent' or 'task'
  agent_ids TEXT,  -- JSON array
  task_id TEXT,
  scope TEXT NOT NULL,  -- JSON array
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/running/completed/failed
  started_at TEXT,
  completed_at TEXT,
  total_agents INTEGER DEFAULT 0,
  total_tasks INTEGER DEFAULT 0,
  avg_score INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_run_id ON evaluation_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_status ON evaluation_runs(status);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_started_at ON evaluation_runs(started_at);

-- 4. 智能体评估配置表（定时评估配置）
CREATE TABLE IF NOT EXISTS evaluation_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  period TEXT NOT NULL,  -- daily/weekly/monthly
  scope TEXT NOT NULL,  -- JSON array
  last_evaluation_at TEXT,
  next_evaluation_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluation_configs_agent_id ON evaluation_configs(agent_id);

-- 5. 评估任务数据收集表（记录从 tasks.json 收集的任务数据）
CREATE TABLE IF NOT EXISTS evaluation_collected_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_type TEXT,
  input TEXT,
  output TEXT,
  status TEXT,
  duration INTEGER,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_collected_tasks_agent_id ON evaluation_collected_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_collected_tasks_task_id ON evaluation_collected_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_collected_tasks_collected_at ON evaluation_collected_tasks(collected_at);

-- 6. 评估数据收集会话表（记录每次数据收集）
CREATE TABLE IF NOT EXISTS evaluation_collection_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  collection_type TEXT NOT NULL,  -- 'auto' or 'manual'
  agent_ids TEXT,  -- JSON array
  days_back INTEGER DEFAULT 30,
  limit_per_agent INTEGER DEFAULT 20,
  total_tasks INTEGER DEFAULT 0,
  agents_covered INTEGER DEFAULT 0,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_collection_sessions_session_id ON evaluation_collection_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_collection_sessions_collected_at ON evaluation_collection_sessions(collected_at);
