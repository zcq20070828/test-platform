-- performance_reports 表
CREATE TABLE IF NOT EXISTS performance_reports (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  test_id         VARCHAR(64)  NOT NULL UNIQUE COMMENT '报告唯一ID(=workflowId)',
  target          VARCHAR(500) NOT NULL COMMENT '被测目标 URL/接口',
  test_type       VARCHAR(50)  NOT NULL DEFAULT 'load' COMMENT 'load|stress|stability|concurrency',
  tool            VARCHAR(50)  DEFAULT 'jmeter' COMMENT 'jmeter|k6|locust|artillery',
  status          VARCHAR(20)  NOT NULL DEFAULT 'running' COMMENT 'running|completed|failed',
  overall_score   DECIMAL(5,2) DEFAULT NULL COMMENT '0-100 综合评分',
  grade           VARCHAR(20)  DEFAULT NULL COMMENT '优秀|良好|合格|不达标',
  sla_pass        TINYINT(1)   DEFAULT NULL COMMENT 'SLA是否达标',
  metrics_summary JSON         DEFAULT NULL COMMENT '{tps,avg_rt,p95_rt,p99_rt,error_rate,throughput,cpu,memory,duration}',
  findings_count  INT          DEFAULT 0,
  recommendations TEXT,
  tester          VARCHAR(50)  DEFAULT 'performance-tester',
  duration_ms     INT          DEFAULT NULL,
  created_by      VARCHAR(50)  NOT NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_test_id   (test_id),
  INDEX idx_created_by(created_at, created_by),
  INDEX idx_status    (status),
  INDEX idx_target    (target(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- performance_findings 表
CREATE TABLE IF NOT EXISTS performance_findings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  report_id      INT          NOT NULL COMMENT '关联 performance_reports.id',
  finding_type   VARCHAR(50)  NOT NULL COMMENT 'response_time|throughput|resource|stability|error_rate',
  severity       VARCHAR(20)  NOT NULL COMMENT 'critical|high|medium|low|info',
  title          VARCHAR(200) NOT NULL,
  description    TEXT,
  metric_detail  VARCHAR(200) DEFAULT NULL,
  threshold      VARCHAR(100) DEFAULT NULL,
  actual_value   VARCHAR(100) DEFAULT NULL,
  remediation    TEXT,
  status         VARCHAR(20)  DEFAULT 'open' COMMENT 'open|accepted|fixed',
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_report_id     (report_id),
  INDEX idx_severity      (severity),
  INDEX idx_finding_type  (finding_type),
  INDEX idx_status        (status),
  FOREIGN KEY (report_id) REFERENCES performance_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- performance_configs 表
CREATE TABLE IF NOT EXISTS performance_configs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  config_key   VARCHAR(100) NOT NULL UNIQUE,
  config_value TEXT,
  description  VARCHAR(200) DEFAULT NULL,
  updated_by   VARCHAR(50)  DEFAULT NULL,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 预设默认配置
INSERT IGNORE INTO performance_configs (config_key, config_value, description) VALUES
  ('default_vu_count', '100', '默认并发虚拟用户数'),
  ('default_duration', '60s', '默认压测持续时间'),
  ('default_ramp', '30s', '默认爬坡时间'),
  ('sla_rt_p95', '2000', 'SLA P95响应时间阈值(ms)'),
  ('sla_rt_avg', '1000', 'SLA平均响应时间阈值(ms)'),
  ('sla_tps_min', '50', 'SLA最小TPS'),
  ('sla_error_rate', '1.0', 'SLA最大错误率(%)');
