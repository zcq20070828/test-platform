/**
 * useSessionTimeout - 会话超时管理（纯函数版本，供 Store 和 Composable 共用）
 * 行业标准：30分钟无操作自动登出
 * - 登录时记录时间戳
 * - 检测用户活动重置计时器
 * - 顶部显示剩余时间倒计时
 * - API 响应 401 自动登出
 */
import { ref, computed } from 'vue'

// 会话超时时间（毫秒）：30分钟（与后端 accessTokenExpires 保持一致）
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000
// 倒计时刷新间隔
const TICK_INTERVAL_MS = 1000
// 剩余 N 分钟以下显示警告
const WARN_THRESHOLD_MS = 5 * 60 * 1000

const KEY_LOGIN_TIME = 'session_login_time'

// 全局状态（单例）
const remainingMs = ref(0)
const isSessionActive = ref(false)
let tickTimer: ReturnType<typeof setInterval> | null = null
let warnShown = false

// 登出回调（由调用方注入）
let onExpireCallback: (() => void) | null = null

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0) return `${m}分${sec}秒`
  return `${sec}秒`
}

// 活动事件处理器
const onActivity = () => {
  if (!isSessionActive.value) return
  const now = Date.now()
  localStorage.setItem(KEY_LOGIN_TIME, String(now))
  remainingMs.value = SESSION_TIMEOUT_MS
  warnShown = false
}

// tick：每秒更新剩余时间
let _tickFn: () => void = () => {
  const loginTime = Number(localStorage.getItem(KEY_LOGIN_TIME))
  if (!loginTime) {
    remainingMs.value = 0
    return
  }
  const elapsed = Date.now() - loginTime
  remainingMs.value = Math.max(0, SESSION_TIMEOUT_MS - elapsed)

  // 即将过期警告（只提示一次）
  if (!warnShown && remainingMs.value > 0 && remainingMs.value <= WARN_THRESHOLD_MS) {
    warnShown = true
    if (onExpireCallback) {
      // 用延迟让消息在登出前显示
      setTimeout(() => {
        if (isSessionActive.value) {
          console.warn(`[Session] 会话将在 ${formatTime(remainingMs.value)} 后过期`)
        }
      }, 100)
    }
  }

  if (remainingMs.value === 0 && isSessionActive.value) {
    _expire()
  }
}

// 过期登出
function _expire() {
  isSessionActive.value = false
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  localStorage.removeItem(KEY_LOGIN_TIME)
  // token 的清理由 logout() 统一处理，这里只清 session 状态
  if (onExpireCallback) {
    onExpireCallback()
  }
}

// 启动会话监控（登录成功后调用）
export function startSession(expireCallback: () => void) {
  stopSession()
  onExpireCallback = expireCallback || null
  isSessionActive.value = true
  warnShown = false

  // 记录登录时间
  const now = Date.now()
  localStorage.setItem(KEY_LOGIN_TIME, String(now))
  remainingMs.value = SESSION_TIMEOUT_MS

  // 启动倒计时
  tickTimer = setInterval(_tickFn, TICK_INTERVAL_MS)
  _tickFn()

  // 监听用户活动
  const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click']
  events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
}

// 停止会话监控（登出时调用）
export function stopSession() {
  isSessionActive.value = false
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click']
  events.forEach(e => window.removeEventListener(e, onActivity))
  onExpireCallback = null
}

// 检查会话是否有效（页面刷新后调用）
export function checkSession(): boolean {
  const loginTime = Number(localStorage.getItem(KEY_LOGIN_TIME))
  if (!loginTime) return false
  const elapsed = Date.now() - loginTime
  if (elapsed >= SESSION_TIMEOUT_MS) {
    // 已过期，清理 session 状态（token 交给 logout() 统一清理）
    localStorage.removeItem(KEY_LOGIN_TIME)
    return false
  }
  return true
}

// 手动刷新活动时间（API 调用成功后）
export function refreshActivity() {
  if (isSessionActive.value) {
    onActivity()
  }
}

// 剩余时间文本（供 UI 显示）
export const remainingText = computed(() => formatTime(remainingMs.value))
// 是否在警告区间
export const isWarning = computed(() => remainingMs.value > 0 && remainingMs.value <= WARN_THRESHOLD_MS)
// 会话是否激活
export const isActive = computed(() => isSessionActive.value)
// 剩余毫秒数
export { remainingMs }
