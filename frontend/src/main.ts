import './styles/variables.css'
import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/macos-theme.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import { setupPageDwell } from './utils/page-dwell'

// 抑制浏览器扩展相关的错误（如飞书、翻译插件、密码管理器等）
const originalConsoleError = console.error
console.error = function(...args: any[]) {
  const message = args.map(a => a?.toString?.() || '').join(' ')
  // 过滤掉浏览器扩展相关的错误
  if (message.includes('extensionAdapter') || 
      message.includes('sendMessageToTab') ||
      message.includes('Extension context invalidated') ||
      message.includes('chrome-extension://') ||
      message.includes('moz-extension://') ||
      message.includes('spoc') ||
      message.includes('background_worker') ||
      message.includes('inlineForm') ||
      message.includes('runtime.lastError') ||
      message.includes('background page')) {
    console.warn('[Filtered Extension Error]', ...args)
    return
  }
  originalConsoleError.apply(console, args)
}

// 捕获并抑制扩展相关的未捕获错误
window.addEventListener('error', (event) => {
  const message = event.message || ''
  const filename = event.filename || ''
  // 检查错误消息和文件名是否来自扩展
  if (message.includes('extensionAdapter') || 
      message.includes('sendMessageToTab') ||
      message.includes('Extension context') ||
      message.includes('spoc') ||
      message.includes('background_worker') ||
      message.includes('inlineForm') ||
      message.includes('runtime.lastError') ||
      message.includes('background page') ||
      filename.includes('chrome-extension://') ||
      filename.includes('moz-extension://')) {
    console.warn('[Filtered Global Error]', event.message)
    event.preventDefault()
    return false
  }
})

// 捕获并抑制扩展相关的未处理的 Promise 拒绝
window.addEventListener('unhandledrejection', (event) => {
  const message = event.reason?.toString?.() || ''
  if (message.includes('extensionAdapter') || 
      message.includes('sendMessageToTab') ||
      message.includes('Extension context') ||
      message.includes('spoc') ||
      message.includes('background_worker') ||
      message.includes('inlineForm') ||
      message.includes('runtime.lastError') ||
      message.includes('background page')) {
    console.warn('[Filtered Promise Rejection]', event.reason)
    event.preventDefault()
    return false
  }
})

const app = createApp(App)

// 注册所有 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

const pinia = createPinia()
app.use(pinia)

// 在 router 注册之前从 localStorage 恢复会话
// 这样路由守卫 beforeEach 执行时 store.isLoggedIn 已是正确的状态
// 不然刷新页面会错误跳 /login
import { useMainStore } from './stores/main'
const store = useMainStore()
store.loadUserFromStorage()

app.use(router)
app.use(ElementPlus, { size: 'default' })
setupPageDwell(router)

app.mount('#app')
