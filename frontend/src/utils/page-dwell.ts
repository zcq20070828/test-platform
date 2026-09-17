/**
 * 页面停留时长追踪（page-dwell tracker）
 *
 * - Vue router beforeEach 钩子记录每次路由切换
 * - 在切换到下一路由、或 visibilitychange=hidden、或 unload 时，发送 page_leave 事件
 * - 使用 sendBeacon 防止 unload 时请求被丢弃
 */
import { userActionApi } from '@/api'

let currentRoute: { path: string; name?: string; start: number } | null = null
let leaving = false

function sendLeave(durationMs: number, path: string, routeName?: string) {
  if (!path || durationMs <= 0) return
  // 优先用 sendBeacon（unload 时也能发出）
  const url = '/api/user-actions/log'
  const payload = JSON.stringify({
    action: 'page_leave',
    resourceType: 'page',
    resourceId: path,
    durationMs,
    metadata: { path, routeName }
  })
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([payload], { type: 'application/json' })
      const ok = navigator.sendBeacon(url, blob)
      if (ok) return
    } catch { /* fallthrough */ }
  }
  // fallback：普通请求
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