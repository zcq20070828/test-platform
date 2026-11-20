-- 用户级 API Key 配置（2026-11-20）
--
-- 需求：每个用户配置和管理自己的 API Key（新增/修改/删除/指定默认），
-- 每个用户最多只能有一个默认 Key；平台各处需要 Key 的地方统一使用「默认 Key」。
--
-- 为什么用表而不是 runtime/credentials.json：
--   - 凭证文件是「按 type 一份」的结构（git/nas 各一条），而 API Key 是「每个用户多条」，
--     需要 id / 名称 / 默认标记 / 增删改，用 JSON 文件得自己实现主键与并发写；
--   - 漏配默认 Key 时要能查、要能约束「每用户至多一个默认」，DB 唯一索引更可靠。
--
-- 加密：api_key_enc 存 AES-256-GCM 密文（enc:iv:tag:ciphertext），密钥派生自
-- LOCAL_JWT_SECRET，与 runtime/credentials.json 同一套 encryptSecret/decryptSecret。
-- 明文永不落库、永不回传前端（接口只返回 mask 后的末 4 位）。
--
-- 幂等：CREATE TABLE IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS `user_api_keys` (
  `id` varchar(36) NOT NULL COMMENT '主键 UUID',
  `user_id` varchar(36) NOT NULL COMMENT '所属用户',
  `name` varchar(100) NOT NULL COMMENT '用户自定义名称，如「我的 DeepSeek」',
  `provider` varchar(50) NOT NULL DEFAULT 'deepseek' COMMENT '服务商: deepseek|openai|other',
  `base_url` varchar(255) DEFAULT NULL COMMENT '接口地址，留空用服务商默认',
  `model` varchar(100) DEFAULT NULL COMMENT '默认模型名，留空用平台默认',
  `api_key_enc` text NOT NULL COMMENT 'AES-256-GCM 密文；明文永不落库',
  `key_hint` varchar(32) DEFAULT NULL COMMENT '脱敏提示（末 4 位），用于列表展示',
  `is_default` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否该用户的默认 Key',
  `last_verified_at` timestamp NULL DEFAULT NULL COMMENT '最近一次验证成功时间',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_user_default` (`user_id`, `is_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户级 API Key 配置';
