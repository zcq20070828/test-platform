-- 20261004: tasks.input 由 TEXT(64KB) 扩容为 MEDIUMTEXT(16MB)
--
-- 背景(实测取证):
--   分步测试页发起 UI/E2E 任务并上传用例文档时,input 达到 66460 字节,
--   超出 TEXT 列的 65535 字节上限。MySQL/MariaDB 截断时把多字节汉字从中间切断,
--   产生非法 UTF-8 序列,触发:
--     - ER_TRUNCATED_WRONG_VALUE_FOR_FIELD(1366) Incorrect string value
--       (截断落在多字节字符中间时)
--     - ER_DATA_TOO_LONG(1406) Data too long
--       (截断正好落在字符边界时)
--   最终导致 POST /api/tasks 返回 500,任务根本创建不出来。
--
-- 取证结论(排除字符集/脏字节假设):
--   input 为合法 UTF-8 JS 字符串,Buffer 往返一致(roundTripOk=true),
--   非法字节数 badByteCount=0;连接/库/列字符集均为 utf8mb4。
--   故与字符集无关,纯粹是列容量不足。
--
-- 修复: input 扩容为 MEDIUMTEXT(最大 16MB),彻底消除 64KB 上限导致的创建失败。
ALTER TABLE tasks
  MODIFY COLUMN input MEDIUMTEXT
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  NOT NULL
  COMMENT '用户输入';
