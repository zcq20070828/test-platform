-- 测试中台数据库表结构
-- 创建时间: 2026-07-15
-- 数据库: test_platform

-- =====================================================
-- 第一部分：核心业务表（从 tasks.json 迁移）
-- =====================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL COMMENT '密码加密存储',
  name VARCHAR(100),
  role ENUM('admin', 'user') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 任务表
CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(20) DEFAULT 'general' COMMENT '任务类型',
  status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending' COMMENT '任务状态',
  -- 20261004 扩容: TEXT(64KB) -> MEDIUMTEXT(16MB)
  -- 上传用例文档后 input 可达 66KB+,超出 TEXT 上限会被截断并切断多字节汉字,
  -- 触发 1366 Incorrect string value 导致任务创建 500。详见
  -- migrations/20261004_enlarge_task_input.sql
  input MEDIUMTEXT NOT NULL COMMENT '用户输入',
  agent_id VARCHAR(50) NOT NULL COMMENT '执行智能体ID',
  priority ENUM('low', 'normal', 'high') DEFAULT 'normal' COMMENT '优先级',
  user_id VARCHAR(36) NOT NULL COMMENT '用户ID',
  result LONGTEXT COMMENT '执行结果（可能很长）',
  -- 20261004 扩容: TEXT(64KB) -> MEDIUMTEXT(16MB)
  -- 智能体执行失败时写入的 error 可能含完整错误堆栈/大段工具返回原文,
  -- 超 64KB 会复现与 input 相同的 1366/1406 截断故障(中文堆栈尤其易命中)。
  -- 详见 migrations/20261004_enlarge_task_error.sql
  error MEDIUMTEXT COMMENT '错误信息',
  require_review BOOLEAN DEFAULT TRUE COMMENT '是否需要审核',
  review_passed BOOLEAN COMMENT '审核是否通过',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL COMMENT '完成时间',
  -- 成本相关字段
  input_tokens INT DEFAULT 0 COMMENT '输入token消耗',
  output_tokens INT DEFAULT 0 COMMENT '输出token消耗',
  token_cost DECIMAL(10,6) DEFAULT 0 COMMENT '每1K token价格(元)',
  actual_cost DECIMAL(10,4) DEFAULT 0 COMMENT '实际执行成本(元)',
  manual_hours DECIMAL(8,2) DEFAULT 0 COMMENT '预估人工执行工时(小时)',
  labor_cost DECIMAL(10,4) DEFAULT 0 COMMENT '每小时人力成本(元)',
  estimated_cost DECIMAL(10,4) DEFAULT 0 COMMENT '预估人工执行成本(元)',
  saved_cost DECIMAL(10,4) DEFAULT 0 COMMENT '节省成本(元)',
  INDEX idx_status (status),
  INDEX idx_user_id (user_id),
  INDEX idx_agent_id (agent_id),
  INDEX idx_created_at (created_at),
  INDEX idx_review_passed (review_passed),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务表';

-- 任务审核结果表
CREATE TABLE IF NOT EXISTS task_review_results (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  reviewer_id VARCHAR(50) NOT NULL COMMENT '审核智能体ID',
  reviewer_name VARCHAR(100) COMMENT '审核智能体名称',
  score INT COMMENT '评分',
  veto BOOLEAN DEFAULT FALSE COMMENT '是否一票否决',
  passed BOOLEAN COMMENT '是否通过',
  output MEDIUMTEXT 
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task_id (task_id),
  INDEX idx_reviewer_id (reviewer_id),
  INDEX idx_passed (passed),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务审核结果表';

-- 任务附件表
CREATE TABLE IF NOT EXISTS task_artifacts (
  id VARCHAR(50) PRIMARY KEY COMMENT 'artifact-0, artifact-1...',
  task_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL COMMENT '附件名称',
  type VARCHAR(20) COMMENT '附件类型',
  file_path VARCHAR(500) COMMENT '文件路径',
  download_url VARCHAR(500) COMMENT '下载URL',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task_id (task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务附件表';

-- 任务输出文件表
CREATE TABLE IF NOT EXISTS task_output_files (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  file_path VARCHAR(500) NOT NULL COMMENT '输出文件路径',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task_id (task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务输出文件表';

-- 认证凭据表
CREATE TABLE IF NOT EXISTS credentials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36),
  provider VARCHAR(50) COMMENT '提供商: github/google/etc',
  access_token MEDIUMTEXT 
  refresh_token MEDIUMTEXT 
  expires_at TIMESTAMP NULL COMMENT '过期时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_provider (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='认证凭据表';

-- =====================================================
-- 第二部分：OpenClaw 系统表（从 openclaw.sqlite 迁移）
-- =====================================================

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36),
  agent_id VARCHAR(50),
  status ENUM('active', 'ended') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_agent_id (agent_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话表';

-- 定时任务表
CREATE TABLE IF NOT EXISTS cron_jobs (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  schedule VARCHAR(100) NOT NULL COMMENT 'cron表达式',
  agent_id VARCHAR(50),
  payload JSON COMMENT '任务参数',
  enabled BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMP NULL,
  next_run_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_enabled (enabled),
  INDEX idx_next_run (next_run_at),
  INDEX idx_agent_id (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='定时任务表';

-- 事件队列表
CREATE TABLE IF NOT EXISTS event_queue (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL COMMENT '事件类型',
  payload JSON COMMENT '事件数据',
  status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  error MEDIUMTEXT 
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='事件队列表';

-- =====================================================
-- 第三部分：评估系统表（从 evaluation.db 迁移）
-- =====================================================

-- 评估报告表
CREATE TABLE IF NOT EXISTS evaluation_reports (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL COMMENT '被评估智能体ID',
  evaluator_id VARCHAR(50) COMMENT '评估智能体ID',
  overall_score DECIMAL(5,2) COMMENT '总体评分',
  capability_score DECIMAL(5,2) COMMENT '能力层评分',
  quality_score DECIMAL(5,2) COMMENT '质量层评分',
  business_value_score DECIMAL(5,2) COMMENT '业务价值层评分',
  status ENUM('draft', 'pending', 'completed', 'failed') DEFAULT 'draft',
  report_data JSON COMMENT '完整报告数据',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_agent_id (agent_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评估报告表';

-- 评估指标历史表
CREATE TABLE IF NOT EXISTS evaluation_metrics_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL,
  metric_name VARCHAR(100) NOT NULL COMMENT '指标名称',
  metric_value DECIMAL(10,2) COMMENT '指标值',
  unit VARCHAR(20) COMMENT '单位',
  evaluation_id VARCHAR(36) COMMENT '关联评估ID',
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_id (agent_id),
  INDEX idx_metric_name (metric_name),
  INDEX idx_evaluation_id (evaluation_id),
  FOREIGN KEY (evaluation_id) REFERENCES evaluation_reports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评估指标历史表';

-- 评估运行记录表
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL,
  evaluation_type VARCHAR(50) COMMENT '评估类型',
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMP NULL,
  status ENUM('running', 'completed', 'failed') DEFAULT 'running',
  result_summary MEDIUMTEXT 
  INDEX idx_agent_id (agent_id),
  INDEX idx_status (status),
  INDEX idx_start_time (start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评估运行记录表';

-- 评估配置表
CREATE TABLE IF NOT EXISTS evaluation_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(50) UNIQUE COMMENT '智能体ID（唯一）',
  config_key VARCHAR(100) NOT NULL,
  config_value MEDIUMTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_agent_id (agent_id),
  INDEX idx_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评估配置表';

-- 评估收集的任务数据表
CREATE TABLE IF NOT EXISTS evaluation_collected_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL COMMENT '收集会话ID',
  task_id VARCHAR(36) NOT NULL COMMENT '任务ID',
  agent_id VARCHAR(50) NOT NULL,
  task_status VARCHAR(20),
  collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_id (session_id),
  INDEX idx_task_id (task_id),
  INDEX idx_agent_id (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评估收集的任务数据表';

-- 评估收集会话表
CREATE TABLE IF NOT EXISTS evaluation_collection_sessions (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL,
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMP NULL,
  status ENUM('running', 'completed', 'failed') DEFAULT 'running',
  task_count INT DEFAULT 0 COMMENT '收集的任务数',
  INDEX idx_agent_id (agent_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评估收集会话表';

-- =====================================================
-- 第四部分：知识库表（从 Markdown 文件迁移）
-- =====================================================

-- 知识库文档表
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(50) NOT NULL COMMENT '分类: general/api/ui/performance',
  title VARCHAR(200) NOT NULL,
  content LONGTEXT NOT NULL COMMENT 'Markdown内容',
  tags JSON COMMENT '标签数组',
  file_path VARCHAR(500) COMMENT '原文件路径',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FULLTEXT INDEX ft_title_content (title, content) COMMENT '全文检索索引',
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库文档表';

-- =====================================================
-- 第五部分：初始数据
-- =====================================================

-- 插入默认管理员账户（密码: admin123，需要在应用中重新hash）
INSERT INTO users (id, username, password_hash, name, role, created_at)
VALUES ('c3d621f4-13dc-4fab-b726-0e9df59aed77', 'admin', 'PLACEHOLDER_REHASH', '系统管理员', 'admin', NOW())
ON DUPLICATE KEY UPDATE username='admin';

-- 插入测试用户
INSERT INTO users (id, username, password_hash, name, role, created_at)
VALUES 
('f866d017-e3f5-48b2-87aa-d5b47022944d', 'test1', 'PLACEHOLDER_REHASH', 'Test User', 'user', NOW()),
('e3801b62-6bca-4613-bad6-4007eab301f2', 'testuser', 'PLACEHOLDER_REHASH', 'Test User 2', 'user', NOW()),
('534cfdee-9629-4918-ac1b-eeb838b93c8f', 'tester2', 'PLACEHOLDER_REHASH', 'Tester 2', 'user', NOW())
ON DUPLICATE KEY UPDATE username=VALUES(username);

-- ============================================================
-- V2 进库改造（2026-07-21）
-- ============================================================

-- 工作流表（替代 workflows 内存 Map）
CREATE TABLE IF NOT EXISTS workflows (
  id            VARCHAR(36) PRIMARY KEY,
  user_id       VARCHAR(36) DEFAULT NULL,
  input         MEDIUMTEXT,
  status        ENUM('running','completed','failed','rejected','interactive') DEFAULT 'running',
  steps         JSON        DEFAULT NULL COMMENT '阶段列表 JSON',
  current_step  INT         DEFAULT 0,
  results       JSON        DEFAULT NULL COMMENT '各阶段执行结果',
  workflow_results JSON     DEFAULT NULL COMMENT '完整工作流结果',
  mode          VARCHAR(20) DEFAULT NULL,
  scenario      VARCHAR(200) DEFAULT NULL,
  manual_hours  DECIMAL(10,2) DEFAULT NULL COMMENT '预估人工工时(小时)',
  started_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  completed_at  TIMESTAMP   DEFAULT NULL,
  created_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id  (user_id),
  INDEX idx_status   (status),
  INDEX idx_started  (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流表';

-- 用户-智能体对话历史表（替代 conversationHistory 内存 Map）
CREATE TABLE IF NOT EXISTS conversation_history (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)  NOT NULL,
  agent_id    VARCHAR(100) NOT NULL,
  role        ENUM('user','assistant') NOT NULL,
  content     MEDIUMTEXT 
  turn_index  INT  DEFAULT 0 COMMENT '本轮的 turn 编号',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_agent (user_id, agent_id),
  INDEX idx_turn       (user_id, agent_id, turn_index),
  UNIQUE KEY uk_seq (user_id, agent_id, turn_index, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话历史表';

-- 等待用户输入的会话表（替代 waitingInputSessions 内存 Map）
CREATE TABLE IF NOT EXISTS waiting_input_sessions (
  task_id     VARCHAR(36)  PRIMARY KEY,
  agent_id    VARCHAR(100) NOT NULL,
  workflow_id VARCHAR(36)  DEFAULT NULL,
  started_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow (workflow_id),
  INDEX idx_agent    (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='等待输入会话表';

-- ============================================================
-- V3 知识学习持久化（2026-07-22）
-- ============================================================

-- 智能体知识学习记录表（替代 learnedKnowledge 内存 Map）
CREATE TABLE IF NOT EXISTS agent_learned_knowledge (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '用户ID',
  agent_id VARCHAR(50) NOT NULL COMMENT '智能体ID',
  kb_type VARCHAR(50) NOT NULL COMMENT '知识库类型: general/project-test/project-biz',
  doc_path VARCHAR(500) NOT NULL COMMENT '文档相对路径',
  doc_hash VARCHAR(64) NOT NULL COMMENT '文档内容SHA256哈希(用于检测变化)',
  learned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '学习时间',
  content_preview MEDIUMTEXT 
  INDEX idx_user_agent (user_id, agent_id),
  INDEX idx_kb_doc (kb_type, doc_path),
  INDEX idx_learned_at (learned_at),
  UNIQUE KEY uk_user_agent_kb_doc (user_id, agent_id, kb_type, doc_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='智能体知识学习记录表';
