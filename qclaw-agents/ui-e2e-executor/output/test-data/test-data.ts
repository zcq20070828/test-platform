/**
 * APP 注册功能 E2E 测试数据
 *
 * 分类说明:
 *   valid     — 正常可用数据
 *   invalid   — 格式异常数据（前端/后端拦截）
 *   edge      — 边界值数据
 *   security  — 安全测试 payload
 */

export const TEST_USERS = {
  unregistered: {
    phone: '13800138001',
    email: 'test@example.com',
    password: 'Test@1234',
  },
  // 已注册用户（需预置或 mock）
  registered: {
    phone: '13900139001',
    email: 'registered@example.com',
    password: 'Pass@5678',
  },
  // 未激活邮箱用户
  inactive: {
    email: 'inactive@example.com',
    password: 'Inact@123',
  },
  // 弱网/超时场景
  timeout: {
    phone: '13700137001',
  },
} as const;

/** 验证码相关测试数据 */
export const VERIFICATION_CODES = {
  valid: '123456',
  expired: '999999',
  invalid: '000000',
  malformed: 'abcde',       // 非数字
  short: '12345',            // 不足6位
  long: '1234567',           // 超过6位
} as const;

/** 密码边界测试数据 */
export const PASSWORD_CASES = [
  { password: 'Test@1234',   expected: 'valid',         desc: '符合强度要求' },
  { password: '12345678',    expected: 'weak',          desc: '纯数字' },
  { password: 'abcdefgh',    expected: 'weak',          desc: '纯字母' },
  { password: 'Abc123',      expected: 'too_short',     desc: '6位过短' },
  { password: 'A'.repeat(128), expected: 'too_long',    desc: '128位过长' },
  { password: '12345678a',   expected: 'weak',          desc: '常见弱口令(纯数字+字母无大写特殊)' },
] as const;

/** 弱口令黑名单 */
export const WEAK_PASSWORDS = [
  '12345678', 'password', 'admin888',
  'qwerty123', '11111111', 'abc12345',
] as const;

/** 手机号格式测试数据 */
export const PHONE_FORMATS = [
  { phone: '12345',            expected: 'frontend_reject', desc: '位数不足' },
  { phone: 'abcdefghijk',      expected: 'frontend_reject', desc: '非数字' },
  { phone: '138001380001',     expected: 'frontend_reject', desc: '超长13位' },
  { phone: '010-12345678',     expected: 'backend_reject',  desc: '座机号码' },
  { phone: '13800',            expected: 'backend_reject',  desc: '空号段' },
  { phone: '+8613800138001',   expected: 'backend_reject',  desc: '带+号区号' },
  { phone: '13800138001',      expected: 'valid',           desc: '正常手机号' },
  { phone: '+8613800138001',   expected: 'backend_reject',  desc: '国际区号格式1' },
  { phone: '008613800138001',  expected: 'backend_reject',  desc: '国际区号格式2' },
  { phone: '138 0000 0000',    expected: 'backend_reject',  desc: '含空格' },
  { phone: '138-0000-0000',    expected: 'backend_reject',  desc: '含横线' },
] as const;

/** 邮箱格式测试数据 */
export const EMAIL_FORMATS = [
  { email: 'test@example.com',            expected: 'valid',          desc: '正常邮箱' },
  { email: 'testexample.com',             expected: 'frontend_reject', desc: '无@符号' },
  { email: 'test@',                       expected: 'frontend_reject', desc: '无域名' },
  { email: 'test@.com',                   expected: 'frontend_reject', desc: '无有效域名' },
  { email: 'test\n@example.com',          expected: 'frontend_reject', desc: '含换行符' },
  { email: 'user@mail.example.com',       expected: 'valid',          desc: '子域名格式' },
  { email: 'user+tag@example.com',        expected: 'valid',          desc: '加号别名' },
  { email: 'First.Last@domain.com',       expected: 'valid',          desc: '含点号' },
  { email: 'a'.repeat(256) + '@test.com', expected: 'backend_reject', desc: '邮箱超长256字符' },
] as const;

/** SQL 注入 payload */
export const SQL_INJECTION_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "13800138001' UNION SELECT * FROM users--",
  "' OR 1=1 --",
  "admin'--",
] as const;

/** XSS payload */
export const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  'javascript:alert("xss")',
] as const;

/** 期望的错误码 */
export const ERROR_CODES = {
  SUCCESS:              200,
  PHONE_INVALID:        '40001',   // 手机号格式不正确
  EMAIL_EXISTS:         '40002',   // 邮箱已存在
  SMS_CODE_WRONG:       '40003',   // 验证码错误
  SMS_CODE_EXPIRED:     '40004',   // 验证码已过期
  PASSWORD_TOO_LONG:    '40005',   // 密码长度超过限制
  WEAK_PASSWORD:        '40006',   // 弱口令
  DUPLICATE_REQUEST:    '40007',   // 注册已处理（幂等）
  PHONE_EXISTS:         '40008',   // 手机号已被注册
  RATE_LIMIT:           429,       // 请求过于频繁
  ACCOUNT_UNACTIVATED:  '40301',   // 账号未激活
  METHOD_NOT_ALLOWED:   405,       // 方法不允许
  BAD_REQUEST:          400,       // 参数错误
  UNSUPPORTED_MEDIA:    415,       // 不支持的媒体类型
} as const;

/** 接口路径 */
export const API_ENDPOINTS = {
  SEND_SMS:   '/api/v1/register/send-sms',
  REGISTER_PHONE: '/api/v1/register/phone',
  REGISTER_EMAIL: '/api/v1/register/email',
  THIRD_PARTY: '/api/v1/register/third-party',
  ACTIVATE:   '/api/v1/register/activate',
  RESEND_ACTIVATION: '/api/v1/register/resend-activation',
  LOGIN:      '/api/v1/login',
} as const;
