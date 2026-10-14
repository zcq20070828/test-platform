import { createRouter, createWebHistory } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { ElMessage } from 'element-plus'

// 路由配置
const routes = [
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/auth/callback',
    name: 'AuthCallback',
    component: () => import('@/views/AuthCallbackView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/agents',
    name: 'Agents',
    component: () => import('@/views/AgentsView.vue'),
    // 【平台瘦身 2026-10-14】模块已下线：路由保留、页面代码保留，但禁止访问。
    // 恢复方法：删掉 meta 里的 disabled / disabledTip 两个字段，
    //          并取消 App.vue 菜单中「智能体」项的注释。
    meta: {
      requiresAuth: true,
      disabled: true,
      disabledTip: '「智能体」模块已下线，暂不开放'
    }
  },
  {
    path: '/knowledge',
    name: 'Knowledge',
    component: () => import('@/views/KnowledgeView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/tasks',
    name: 'Tasks',
    component: () => import('@/views/TasksView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/workflow',
    name: 'Workflow',
    component: () => import('@/views/WorkflowView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/performance',
    name: 'Performance',
    component: () => import('@/views/PerformanceView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/stats',
    name: 'Stats',
    component: () => import('@/views/StatsView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/stats/user-actions',
    name: 'UserActions',
    component: () => import('@/views/UserActionsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '用户行为明细' }
  },
  {
    path: '/stats/token-usage',
    name: 'TokenUsage',
    component: () => import('@/views/TokenUsageView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: 'Token 使用明细' }
  },
  {
    path: '/stats/defects',
    name: 'DefectsDetail',
    component: () => import('@/views/DefectsDetailView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/stats/quality',
    name: 'QualityDetail',
    component: () => import('@/views/QualityDetailView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/users',
    name: 'UserManagement',
    component: () => import('@/views/UserManagementView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/performance-test',
    name: 'PerformanceTest',
    component: () => import('@/views/PerformanceTestView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/security',
    name: 'Security',
    component: () => import('@/views/SecurityView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/web-compatibility',
    name: 'WebCompatibility',
    component: () => import('@/views/WebCompatibilityView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/admin',
    name: 'AdminDashboard',
    component: () => import('@/views/AdminDashboardView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { requiresAuth: true, title: '个人信息' }
  },
  {
    path: '/test-runner',
    name: 'TestRunner',
    component: () => import('@/views/TestRunnerView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/evaluation',
    name: 'Evaluation',
    component: () => import('@/views/EvaluationView.vue'),
    meta: { requiresAuth: true }
  }
]

// 创建路由实例
const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫 (Vue Router 4 新语法：返回值替代 next())
// 添加 errorHandler 来捕获路由错误
router.onError((error) => {
  console.error('[Router Error]', error)
  // 尝试重新加载页面（针对 chunk 加载失败）
  if (error.message.includes('Loading chunk') || error.message.includes('Failed to fetch dynamically imported module')) {
    console.log('[Router] Chunk load failed, reloading...')
    window.location.reload()
  }
})

router.beforeEach((to, from) => {
  // 获取 store 实例（Pinia 已在 main.ts 中初始化）
  const mainStore = useMainStore()

  // 详细诊断日志
  console.log('[Router beforeEach]', to.name, '| user.value:', !!mainStore.user, '| isLoggedIn:', mainStore.isLoggedIn, '| localStorage user:', !!localStorage.getItem('user'), '| localStorage token:', !!localStorage.getItem('token'))

  // 检查是否需要登录
  if (to.meta.requiresAuth && !mainStore.isLoggedIn) {
    console.log('[Router] 未登录，跳转 /login')
    return { name: 'Login' }
  }

  // 如果已登录且访问登录页，重定向到首页
  if (to.name === 'Login' && mainStore.isLoggedIn) {
    console.log('[Router] 已登录，跳转 /dashboard')
    return { name: 'Dashboard' }
  }

  // 如果需要管理员权限但当前用户不是管理员，重定向到首页
  if (to.meta.requiresAdmin && !mainStore.isAdmin) {
    ElMessage.error('需要管理员权限')
    return { name: 'Dashboard' }
  }

  // 已下线模块（平台瘦身）：路由仍存在但禁止进入，直接拦回首页
  if (to.meta.disabled) {
    ElMessage.warning(String(to.meta.disabledTip || '该模块已下线，暂不开放'))
    return { name: 'Dashboard' }
  }

  // 其他情况：继续导航（隐式返回 undefined）
})

export default router
