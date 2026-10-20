-- 测试中台初始化数据增量（自动生成 2026-07-30，2026-10-19 安全整改）
-- 用法: mysql -u appuser -p <你的库名> < database/02-init-data-incremental.sql
--       例: mysql -u appuser -p test_platform_dev < database/02-init-data-incremental.sql
-- 幂等: INSERT IGNORE 补齐缺失账户/配置，已存在则跳过。
--
-- ⚠ 2026-10-19 安全整改：
--   1. 文件内不再写 `USE test_platform;`。此前它会把数据写进负责人正式库，
--      同事按 README 执行 `... test_platform_dev < 02-init-data-incremental.sql`
--      时会直接串库（违反「绝不碰 test_platform」红线）。库名由命令行指定。
--   2. 不再用 `ON DUPLICATE KEY UPDATE password_hash = ...`。此前重跑会把已存在
--      admin 的密码重置回默认值。现在只补缺失行，已存在的账号不会被改动。
--   3. 初始密码仅用于本地开发库；生产请用 backend 首次启动随机生成的密码，
--      或显式配置 DEFAULT_ADMIN_PASSWORD。

-- =====================================================
-- 测试中台数据库初始化数据
-- 生成时间: 2026-07-18（封版 v1.0.0-20260718）
-- 说明: 默认账户密码 / 系统配置初始值
-- 使用方法见 database/README.md
-- =====================================================

-- -----------------------------------------------------
-- 1. 默认管理员账户（仅本地开发库使用）
--    用户名: admin    密码: admin123
--    用户名: test1    密码: test123
--    用户名: testuser 密码: test123
--    用户名: tester2  密码: test123
-- 密码为 bcrypt 哈希（成本因子 10），与后端 bcrypt.compareSync 校验一致。
-- 部署后请尽快在「用户管理」中修改默认密码。
-- 若已存在同名账号：直接跳过，不覆盖其密码与角色。
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
   '测试用户3', 'user', NOW());

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
   '任务清理阈值（分钟），管理员点击清理时，将终止超过此时间未完成的任务');
