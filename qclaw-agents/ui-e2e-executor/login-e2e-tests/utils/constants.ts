/**
 * 测试常量定义
 * 
 * 包含：
 * - 错误消息映射
 * - 正则表达式模式
 * - 测试数据模板
 * - 页面URL配置
 */

// ============================================================
// 错误消息定义
// ============================================================

export const ERROR_MESSAGES = {
  // 必填字段
  ACCOUNT_REQUIRED: '请输入账号',
  PASSWORD_REQUIRED: '请输入密码',
  SMS_CODE_REQUIRED: '请输入验证码',
  
  // 账号相关
  ACCOUNT_NOT_EXIST: '账号或密码错误', // 安全考虑，不透露具体原因
  ACCOUNT_LOCKED: '账号已被锁定',
  ACCOUNT_DISABLED: '账号已被禁用',
  
  // 密码相关
  WRONG_PASSWORD: '账号或密码错误',
  WEAK_PASSWORD: '密码强度不够',
  PASSWORD_MISMATCH: '两次密码输入不一致',
  
  // 验证码相关
  WRONG_SMS_CODE: '验证码错误',
  SMS_CODE_EXPIRED: '验证码已过期',
  SMS_CODE_REQUIRED_FIELD: '请输入验证码',
  SMS_SEND_FAILED: '验证码发送失败',
  
  // 频率限制
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  SMS_RATE_LIMITED: '验证码发送过于频繁',
  
  // 网络错误
  NETWORK_ERROR: '网络异常，请检查网络连接',
  SERVER_ERROR: '服务器异常，请稍后重试',
  TIMEOUT_ERROR: '请求超时，请稍后重试',
  
  // Session
  SESSION_EXPIRED: '登录状态已过期，请重新登录',
  SESSION_INVALID: '登录状态无效，请重新登录',
  
  // 第三方登录
  WECHAT_NOT_BINDING: '该微信未绑定账号',
  GOOGLE_NOT_BINDING: '该Google账号未绑定',
  AUTH_CANCELLED: '用户取消授权',
  AUTH_FAILED: '授权失败',
} as const;

// ============================================================
// 正则表达式模式
// ============================================================

export const REGEX_PATTERNS = {
  // 中国大陆手机号
  CHINA_PHONE: /^1[3-9]\d{9}$/,
  
  // 邮箱
  EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  
  // 强密码（8-20位，包含大小写字母、数字、特殊字符）
  STRONG_PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,20}$/,
  
  // 弱密码（简单数字或字母）
  WEAK_PASSWORD: /^(123456|password|qwerty|abc123|111111|000000)$/i,
  
  // 验证码（4-6位数字）
  SMS_CODE: /^\d{4,6}$/,
  
  // 图形验证码（4位字母数字）
  CAPTCHA: /^[a-zA-Z0-9]{4}$/,
  
  // 身份证号
  ID_CARD: /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/,
  
  // URL
  URL: /^https?:\/\/.+/,
} as const;

// ============================================================
// 测试数据
// ============================================================

export interface TestUser {
  phone: string;
  email: string;
  password: string;
  weakPassword: string;
  lockedPhone: string;
  nonExistentPhone: string;
  nonExistentEmail: string;
  invalidSmsCode: string;
}

export const TEST_USERS: TestUser = {
  // 有效账户
  phone: process.env.TEST_USER_PHONE || '13800138000',
  email: process.env.TEST_USER_EMAIL || 'test@example.com',
  password: process.env.TEST_USER_PASSWORD || 'Test@123',
  
  // 弱密码
  weakPassword: '123456',
  
  // 锁定账户
  lockedPhone: process.env.LOCKED_USER_PHONE || '13700137000',
  
  // 不存在的账户
  nonExistentPhone: '13999999999',
  nonExistentEmail: 'nonexistent@example.com',
  
  // 无效验证码
  invalidSmsCode: '000000',
} as const;

export const VALID_SMS_CODES = {
  CORRECT: '123456',
  WRONG: '654321',
  EXPIRED: '999999',
  TOO_SHORT: '12345',
  TOO_LONG: '1234567',
  LETTERS: 'abcdef',
} as const;

// ============================================================
// 测试数据变体（用于边界测试）
// ============================================================

export const PHONE_NUMBER_VARIANTS = {
  VALID: [
    '13800138000', // 标准有效
    '19912345678', // 199号段
    '16612345678', // 166号段
  ],
  INVALID: [
    '1380013800',   // 位数不足
    '138001380000', // 位数过多
    '1380013800a',  // 含字母
    '23800138000',  // 2开头
    '12800138000',  // 12开头
  ],
  BOUNDARY: {
    MIN: '13000000000', // 最小有效
    MAX: '19999999999', // 最大有效
  },
} as const;

export const EMAIL_VARIANTS = {
  VALID: [
    'test@example.com',
    'user.name@company.co.uk',
    'user+tag@gmail.com',
  ],
  INVALID: [
    'testexample.com',     // 缺少@
    'test@',              // 缺少域名
    '@example.com',       // 缺少用户名
    'test@.com',          // 缺少域名主体
    'test @example.com',  // 用户名含空格
  ],
} as const;

export const PASSWORD_VARIANTS = {
  VALID: [
    'Test@123',
    'Str0ng!Pass',
    'Abc123!@#',
  ],
  WEAK: [
    '123456',
    'password',
    'qwerty',
    '000000',
    'aaaaaa',
  ],
  INVALID: [
    'Test123',       // 无特殊字符
    'test@123',     // 无大写字母
    'TEST@123',     // 无小写字母
    'Test@ab',      // 长度不足
    'Test@12345678901234567890', // 长度过长
  ],
} as const;

// ============================================================
// 页面URL配置
// ============================================================

export const URLS = {
  BASE: process.env.BASE_URL || 'http://localhost:3000',
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  HOME: '/home',
  DASHBOARD: '/dashboard',
  PROFILE: '/profile',
  SETTINGS: '/settings',
  LOGOUT_API: '/api/auth/logout',
  LOGIN_API: '/api/auth/login',
  SMS_API: '/api/auth/sms/send',
  USER_INFO_API: '/api/user/info',
} as const;

// ============================================================
// 页面标题和文案
// ============================================================

export const PAGE_TITLES = {
  LOGIN: ['登录', 'Login', 'Sign In', '登录页'],
  REGISTER: ['注册', 'Register', 'Sign Up'],
  FORGOT_PASSWORD: ['忘记密码', '找回密码', 'Reset Password'],
  HOME: ['首页', 'Home', '主页', 'Dashboard'],
} as const;

// ============================================================
// 登录方式文本
// ============================================================

export const LOGIN_METHODS = {
  PASSWORD: ['密码登录', '账号密码登录', 'Account Password'],
  SMS: ['短信登录', '验证码登录', 'SMS Login', 'Mobile Code'],
  EMAIL: ['邮箱登录', 'Email Login'],
  WECHAT: ['微信登录', 'WeChat Login', 'Wechat'],
  GOOGLE: ['Google登录', 'Google Login'],
  APPLE: ['Apple登录', 'Apple Login', 'Sign in with Apple'],
} as const;

// ============================================================
// 超时配置（毫秒）
// ============================================================

export const TIMEOUTS = {
  PAGE_LOAD: 30000,
  ELEMENT_WAIT: 10000,
  ACTION_WAIT: 5000,
  CAPTCHA_WAIT: 15000,
  REDIRECT_WAIT: 15000,
  API_TIMEOUT: 30000,
  SMS_COOLDOWN: 60000,
  ACCOUNT_LOCK_DURATION: 30 * 60 * 1000, // 30分钟
} as const;

// ============================================================
// 账户锁定配置
// ============================================================

export const ACCOUNT_LOCK_CONFIG = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCK_DURATION_MINUTES: 30,
  CAPTCHA_TRIGGER_ATTEMPTS: 3,
  CAPTCHA_REQUIRED_ATTEMPTS: 3,
} as const;

// ============================================================
// 期望的登录后URL
// ============================================================

export const EXPECTED_POST_LOGIN_PATHS = [
  '/home',
  '/dashboard',
  '/',
  '/index',
  '/welcome',
] as const;
