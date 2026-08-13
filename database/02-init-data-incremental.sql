-- 测试中台初始化数据增量（自动生成 2026-07-30）
-- 用法: mysql -u root -p test_platform < 02-init-data-incremental.sql
-- 幂等: INSERT IGNORE 补齐缺失账户/配置，已存在则跳过。

-- =====================================================
-- 测试中台数据库初始化数据
-- 生成时间: 2026-07-18（封版 v1.0.0-20260718）
-- 说明: 默认账户密码 / 系统配置初始值
-- 使用方法见 database/README.md
-- =====================================================

USE test_platform;

-- -----------------------------------------------------
-- 1. 默认管理员账户
--    用户名: admin    密码: admin123
--    用户名: test1    密码: test123
--    用户名: testuser 密码: test123
--    用户名: tester2  密码: test123
-- 密码为 bcrypt 哈希（成本因子 10），与后端 bcrypt.compareSync 校验一致。
-- 部署后请尽快在「用户管理」中修改默认密码。
-- -----------------------------------------------------

INSERT IGNORE INTO users (id, username, password_hash, name, role, created_at)
VALUES
  ('c3d621f4-13dc-4fab-b726-0e9df59aed77', 'admin',
   '$2b$10$KNDPPMVwJVP9mRkxcxPuFO6ypYW4XSgLElwFGHNPbB2jlyDVfZ8fa',
   '系统管理员', 'admin', NOW()),
  ('f866d017-e3f5-48b2-87aa-d5b47022944d', 'test1',
   '$2b$10$JF9a1P3qvjpmzPZqxWTP2.wA6vgeHtjBSYLaRuVl7V7oXwtGhPb0a',
   '测试用户1', 'user', NOW()),
  ('e3801b62-6bca-4613-bad6-4007eab301f2', 'testuser',
   '$2b$10$JF9a1P3qvjpmzPZqxWTP2.wA6vgeHtjBSYLaRuVl7V7oXwtGhPb0a',
   '测试用户2', 'user', NOW()),
  ('534cfdee-9629-4918-ac1b-eeb838b93c8f', 'tester2',
   '$2b$10$JF9a1P3qvjpmzPZqxWTP2.wA6vgeHtjBSYLaRuVl7V7oXwtGhPb0a',
   '测试用户3', 'user', NOW())
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  name = VALUES(name),
  role = VALUES(role);

-- -----------------------------------------------------
-- 2. 系统配置初始值
--    task_timeout_minutes : 任务运行超时时间（分钟），超时未完成标记为失败
--    task_cleanup_threshold: 任务清理阈值（分钟），管理员点击清理时终止超过该时长的未完成任务
-- -----------------------------------------------------

INSERT IGNORE INTO system_config (config_key, config_value, description)
VALUES
  ('task_timeout_minutes', '30',
   '任务运行超时时间（分钟），超过该时间未完成的任务将被标记为失败'),
  ('task_cleanup_threshold', '10',
   '任务清理阈值（分钟），管理员点击清理时，将终止超过此时间未完成的任务')
ON DUPLICATE KEY UPDATE
  config_value = VALUES(config_value),
  description = VALUES(description);
