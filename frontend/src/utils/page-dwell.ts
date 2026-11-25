/**
 * 页面停留时长追踪（page-dwell tracker）
 *
 * - Vue router beforeEach 钩子记录每次路由切换
 * - 在切换到下一路由、或 visibilitychange=hidden、或 unload 时，发送 page_leave 事件
 * - 使用 sendBeacon 防止 unload 时请求被丢弃
 *
 * ⚠️ 身份传递（2026-11-25 修）：
 *   `navigator.sendBeacon` **无法设置 Authorization 头**——它只能发 Blob/FormData，
 *   请求头由浏览器决定。所以早期实现里所有 page_leave 都没有身份，
 *   后端只能记成 anonymous，行为明细里显示成「访客」。
 *   实测生产 4713 条匿名记录里 4709 条是 page_leave（99.9%）。
 *
 *   修法：把 token 放进 **URL 查询参数**（sendBeacon 可以任意拼 URL），
 *   后端 log 端点支持 `?token=` 且同样做 JWT 验签（签名 + iss + aud）。
 *   安全性不降级——身份仍来自可验证的 token，而非可伪造的 body 字段。
 */
import { userActionApi, getAuthHeaders } from '@/api'

let currentRoute: { path: string; name?: string; start: number } | null = null
let leaving = false

/** 取当前访问令牌（与普通请求同源：localStorage 里的 token） */
function currentToken(): string {
  try {
    const auth = getAuthHeaders()['Authorization'] || ''
    return auth.startsWith('Bearer ') ? auth.slice(7) : ''
  } catch {
    return ''
  }
}

function sendLeave(durationMs: number, path: string, routeName?: string) {
  if (!path || durationMs <= 0) return
  const payload = JSON.stringify({
    action: 'page_leave',
    resourceType: 'page',
    resourceId: path,
    durationMs,
    metadata: { path, routeName }
  })

  // token 走查询参数：sendBeacon 设不了请求头，这是唯一能带上身份的途径
  const token = currentToken()
  const url = token
    ? `/api/user-actions/log?token=${encodeURIComponent(token)}`
    : '/api/user-actions/log'

  // 优先用 sendBeacon（unload 时也能发出）
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([payload], { type: 'application/json' })
      const ok = navigator.sendBeacon(url, blob)
      if (ok) return
    } catch { /* fallthrough */ }
  }
  // fallback：普通请求（走 request()，Authorization 头自动带上）
  userActionApi.log({
    action: 'page_leave',
    resourceType: 'page',
    resourceId: path,
    durationMs,
    metadata: { path, routeName }
  }).catch(() => { /* ignore */ })
}

function flushNow(reason: string) {
  if (leaving || !currentRoute) return
  const durationMs = Date.now() - currentRoute.start
  leaving = true
  sendLeave(durationMs, currentRoute.path, currentRoute.name)
  // 下一帧重置（防止同 tick 内再调）
  setTimeout(() => { leaving = false }, 50)
  console.debug(`[page-dwell] ${reason} ${currentRoute.path} (${Math.round(durationMs)}ms)`)
}

export function setupPageDwell(router: any) {
  // 初始化：首屏立即记起点
  // vue-router 5 移除了 router.onReady，改用 router.beforeEach 首次 from===start 来兜底
  let isFirstNav = true
  router.beforeEach((to: any, from: any) => {
    if (isFirstNav) {
      isFirstNav = false
      // 首屏：from 是初始路由，直接设起点
      if (!currentRoute) {
        currentRoute = { path: to.fullPath, name: to.name as string | undefined, start: Date.now() }
      }
    }
    // 切走前：结算上一个
    if (currentRoute && from.fullPath !== to.fullPath) {
      flushNow('route-change')
      currentRoute = null
    }
  })

  router.afterEach((to: any) => {
    currentRoute = { path: to.fullPath, name: to.name as string | undefined, start: Date.now() }
  })

  // 切到后台时也结算（visibilitychange 在移动端/多窗口时常用）
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushNow('visibility-hidden')
      } else if (document.visibilityState === 'visible' && currentRoute) {
        // 回到前台，重新计时
        currentRoute.start = Date.now()
      }
    })
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => flushNow('pagehide'))
    window.addEventListener('beforeunload', () => flushNow('beforeunload'))
  }
}

export function teardownPageDwell() {
  flushNow('teardown')
}