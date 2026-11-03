<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onErrorCaptured } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { ElMessageBox, ElMessage } from 'element-plus'
import SessionTimeoutBar from '@/components/SessionTimeoutBar.vue'
import MsIcon from '@/components/MsIcon.vue'

const store = useMainStore()
const route = useRoute()
const router = useRouter()

// 全局错误捕获
const hasLoadError = ref(false)
onErrorCaptured((err, instance, info) => {
  const errMsg = err?.toString?.() || ''
  const errInfo = info || ''
  
  // 过滤浏览器扩展相关的错误（这些错误不应该触发页面错误提示）
  const isExtensionError = 
    errMsg.includes('extensionAdapter') || 
    errMsg.includes('sendMessageToTab') ||
    errMsg.includes('spoc') ||
    errMsg.includes('background_worker') ||
    errMsg.includes('inlineForm') ||
    errMsg.includes('runtime.lastError') ||
    errMsg.includes('background page') ||
    errMsg.includes('Extension context') ||
    errInfo.includes('chrome-extension://') ||
    errInfo.includes('moz-extension://')
  
  if (isExtensionError) {
    console.warn('[Filtered Extension Error]', err)
    return false // 阻止冒泡但不显示错误
  }
  
  // 对于其他错误，只记录日志，不显示全屏错误提示
  // 这样可以避免误报影响用户体验
  console.error('[Global Error (suppressed)]', err, info)
  console.warn('[Error suppressed] Only showing in console, not blocking UI')
  return false // 阻止错误冒泡，不设置 hasLoadError
})

// 在 App 级别管理 SSE 连接，确保页面切换时不中断
onMounted(() => {
  // 仅在用户已登录时连接
  if (store.isLoggedIn) {
    store.connectRealtimeEvents()
    store.startStatsRefresh()
  }
})

onUnmounted(() => {
  // App 卸载时断开连接
  store.disconnectRealtimeEvents()
})

// 侧边栏是否折叠
const isCollapse = ref(false)

// 导航菜单
const menuItems = computed(() => {
  // msIcon: Material Symbols Outlined（对齐 Stitch / Precision TestOps 线框图标）
  // tone: soft tinted icon tile color from Stitch domain palette
  const items = [
    {
      path: '/functional',
      icon: 'Menu',
      msIcon: 'apps',
      tone: 'violet',
      title: '功能测试',
      children: [
        { path: '/', icon: 'Odometer', msIcon: 'account_tree', tone: 'indigo', title: '分步测试' },
        { path: '/workflow', icon: 'Connection', msIcon: 'schema', tone: 'indigo', title: '测试流水线' }
      ]
    },
    // 【平台瘦身 2026-10-14】「智能体」入口从菜单移除（页面保留、路由保留但禁止访问）。
    // 恢复方法：取消下一行注释即可（同时把 router/index.ts 中 /agents 的 meta.disabled 去掉）。
    // { path: '/agents', icon: 'User', msIcon: 'smart_toy', tone: 'violet', title: '智能体' },
    { path: '/knowledge', icon: 'Collection', msIcon: 'menu_book', tone: 'blue', title: '知识库' },
    { path: '/tasks', icon: 'List', msIcon: 'assignment', tone: 'amber', title: '任务' },
    { path: '/test-runner', icon: 'VideoPlay', msIcon: 'play_circle', tone: 'rose', title: '自动化测试' },
    { path: '/performance-test', icon: 'DataLine', msIcon: 'speed', tone: 'cyan', title: '性能测试' },
    { path: '/evaluation', icon: 'DataAnalysis', msIcon: 'psychology', tone: 'violet', title: '智能评估' },
    { path: '/security', icon: 'Lock', msIcon: 'shield', tone: 'teal', title: '安全测试' },
    { path: '/web-compatibility', icon: 'Monitor', msIcon: 'devices', tone: 'cyan', title: '兼容性测试' }
  ]

  // 仅管理员可见的菜单项
  if (store.isAdmin) {
    items.push({ path: '/admin', icon: 'Tools', msIcon: 'settings', tone: 'slate', title: '管理员功能' })
  }

  return items
})

// 当前页面标题（支持二级菜单递归查找）
const pageTitle = computed(() => {
  if (route.meta?.title) return route.meta.title as string
  const findTitle = (list: any[]): string | null => {
    for (const m of list) {
      if (m.path === route.path) return m.title
      if (m.children) {
        const t = findTitle(m.children)
        if (t) return t
      }
    }
    return null
  }
  return findTitle(menuItems.value) || '测试中台'
})

// 切换侧边栏
function toggleSidebar() {
  isCollapse.value = !isCollapse.value
}

// 顶部用户菜单
async function handleUserCommand(command: string) {
  if (command === 'logout') {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    store.logout()
    router.push('/login')
  } else if (command === 'profile') {
    router.push({ path: '/profile' })
  }
}

// 监听登录状态：登出（session过期/token失效）时自动跳转登录页
watch(() => store.isLoggedIn, (loggedIn) => {
  if (!loggedIn && route.path !== '/login') {
    router.push('/login')
  }
})
</script>

<template>
  <el-container class="app-container">
    <SessionTimeoutBar />
    <!-- 侧边栏 -->
    <el-aside :width="isCollapse ? '64px' : '248px'" class="sidebar">
      <div class="sidebar-head">
        <div class="mac-dots" v-if="!isCollapse">
          <span class="dot dot-red"></span>
          <span class="dot dot-yellow"></span>
          <span class="dot dot-green"></span>
        </div>
        <div class="brand" v-if="!isCollapse">
          <div class="brand-icon"><MsIcon name="science" :size="18" color="#fff" /></div>
          <span class="brand-name">测试中台</span>
        </div>
        <div class="brand-icon brand-icon--collapsed" v-else><MsIcon name="science" :size="18" color="#fff" /></div>
      </div>
      <el-menu
        :default-active="route.path"
        :collapse="isCollapse"
        router
        class="sidebar-menu"
      >
        <template v-for="item in menuItems" :key="item.path">
          <el-sub-menu v-if="item.children && item.children.length" :index="item.path">
            <template #title>
              <span class="nav-tile" :class="`pto-icon-tile--${item.tone || 'indigo'}`">
                <span class="material-symbols-outlined nav-ms">{{ item.msIcon }}</span>
              </span>
              <span>{{ item.title }}</span>
            </template>
            <el-menu-item
              v-for="child in item.children"
              :key="child.path"
              :index="child.path"
            >
              <span class="nav-tile" :class="`pto-icon-tile--${child.tone || 'indigo'}`">
                <span class="material-symbols-outlined nav-ms">{{ child.msIcon }}</span>
              </span>
              <template #title>{{ child.title }}</template>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="item.path">
            <span class="nav-tile" :class="`pto-icon-tile--${item.tone || 'indigo'}`">
              <span class="material-symbols-outlined nav-ms">{{ item.msIcon }}</span>
            </span>
            <template #title>{{ item.title }}</template>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <!-- 主内容区 -->
    <el-container>
      <!-- 顶部栏 -->
      <el-header class="header">
        <div class="header-left">
          <el-button
            text
            @click="toggleSidebar"
          >
            <MsIcon :name="isCollapse ? 'left_panel_open' : 'left_panel_close'" :size="18" />
          </el-button>
          <div class="page-title-wrap">
            <span class="page-title">{{ pageTitle }}</span>
          </div>
        </div>
        <div class="header-right">
          <el-dropdown v-if="store.isLoggedIn" @command="handleUserCommand">
            <span class="user-info">
              <MsIcon name="account_circle" />
              {{ store.user?.name || '未登录' }}
              <el-tag v-if="store.user?.role" size="small" type="info">
                {{ store.user.role }}
              </el-tag>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <MsIcon name="person" />
                  编辑个人信息
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <MsIcon name="logout" />
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 内容区 -->
      <el-main class="main">
        <!-- 全局加载指示器 -->
        <div v-if="hasLoadError" class="error-overlay">
          <el-result
            icon="error"
            title="页面加载失败"
            sub-title="请尝试刷新页面或返回首页"
          >
            <template #extra>
              <el-button type="primary" @click="router.push('/')">返回首页</el-button>
            </template>
          </el-result>
        </div>
        <RouterView v-else />
      </el-main>
    </el-container>
  </el-container>
</template>

<style>
/* 全局样式 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-ui);
}

.app-container {
  height: 100vh;
}

.sidebar {
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  transition: width 0.2s ease;
}

.sidebar-head {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--divider);
}

.mac-dots {
  display: none; /* 视觉去苹果三点，DOM 保留 */
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.dot-red { background: #FF5F57; }
.dot-yellow { background: #FEBC2E; }
.dot-green { background: #28C840; }

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.brand-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: linear-gradient(135deg, #4241bc, #5b5bd6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  box-shadow: none;
}
.brand-icon--collapsed {
  margin: 0 auto;
}
.brand-name {
  letter-spacing: -0.01em;
}

.sidebar-menu {
  border-right: none;
  background: transparent;
  padding: 8px 10px;
}
.sidebar-menu .el-menu-item {
  height: 40px;
  line-height: 40px;
  border-radius: var(--radius-sm);
  margin: 2px 0;
  color: var(--text-secondary);
  font-size: 13px;
  transition: background-color var(--transition), color var(--transition);
}
.sidebar-menu .el-sub-menu__title {
  height: 40px;
  line-height: 40px;
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.sidebar-menu .el-sub-menu .el-menu-item {
  font-size: 13px;
  font-weight: 500;
}
.sidebar-menu .el-menu-item .el-icon {
  font-size: 18px;
}
.sidebar-menu .el-menu-item:hover {
  background: var(--el-fill-color-light);
  color: var(--text);
}
.sidebar-menu .el-menu-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--primary-dark);
  font-weight: 600;
  border: 1px solid var(--el-color-primary-light-7);
}
.sidebar-menu .el-menu-item.is-active .el-icon {
  color: var(--primary);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0 16px;
  height: 48px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-title-wrap {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.page-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.main {
  background: var(--bg-page);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 20px 24px 28px;
}

.error-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

.nav-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid transparent;
  margin-right: 8px;
  flex-shrink: 0;
  vertical-align: middle;
  transition: transform 0.15s ease, border-color var(--transition), box-shadow var(--transition);
}
.material-symbols-outlined.nav-ms {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 18px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  font-variation-settings: 'FILL' 0, 'wght' 450, 'GRAD' 0, 'opsz' 20;
  color: inherit;
  margin-right: 0;
  width: auto;
  vertical-align: middle;
}
.sidebar-menu .el-menu-item.is-active .nav-tile,
.sidebar-menu .el-sub-menu.is-active > .el-sub-menu__title .nav-tile {
  box-shadow: var(--shadow-sm);
  transform: translateY(-0.5px);
}
.sidebar-menu .el-menu-item.is-active .nav-ms,
.sidebar-menu .el-sub-menu.is-active > .el-sub-menu__title .nav-ms {
  font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20;
}
.sidebar-menu .el-menu-item .nav-tile,
.sidebar-menu .el-sub-menu__title .nav-tile {
  flex-shrink: 0;
}
.sidebar-menu .el-sub-menu .el-menu-item {
  padding-left: 44px !important;
}
</style>
