<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onErrorCaptured } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { ElMessageBox, ElMessage } from 'element-plus'
import SessionTimeoutBar from '@/components/SessionTimeoutBar.vue'

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
  const items = [
    { path: '/', icon: 'Odometer', title: '分步测试' },
    { path: '/agents', icon: 'User', title: '智能体' },
    { path: '/knowledge', icon: 'Collection', title: '知识库' },
    { path: '/tasks', icon: 'List', title: '任务' },
    { path: '/workflow', icon: 'Connection', title: '测试流水线' },
    { path: '/test-runner', icon: 'VideoPlay', title: '自动化测试' },
    { path: '/performance', icon: 'Monitor', title: '性能监控' },
    { path: '/performance-test', icon: 'DataLine', title: '性能测试' },
    { path: '/evaluation', icon: 'DataAnalysis', title: '智能评估' },
    { path: '/security', icon: 'Lock', title: '安全测试' },
    { path: '/web-compatibility', icon: 'Monitor', title: '兼容性' }
  ]
  
  // 仅管理员可见的菜单项
  if (store.isAdmin) {
    items.push({ path: '/admin', icon: 'Tools', title: '管理员功能' })
  }
  
  return items
})

// 当前页面标题
const pageTitle = computed(() => {
  if (route.meta?.title) return route.meta.title as string
  const item = menuItems.value.find((m: any) => m.path === route.path)
  return item?.title || '测试中台'
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
          <div class="brand-icon">🧪</div>
          <span class="brand-name">测试中台</span>
        </div>
        <div class="brand-icon brand-icon--collapsed" v-else>🧪</div>
      </div>
      <el-menu
        :default-active="route.path"
        :collapse="isCollapse"
        router
        class="sidebar-menu"
      >
        <el-menu-item
          v-for="item in menuItems"
          :key="item.path"
          :index="item.path"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <!-- 主内容区 -->
    <el-container>
      <!-- 顶部栏 -->
      <el-header class="header">
        <div class="header-left">
          <el-button
            :icon="isCollapse ? 'Expand' : 'Fold'"
            text
            @click="toggleSidebar"
          />
          <div class="page-title-wrap">
            <span class="page-title">{{ pageTitle }}</span>
          </div>
        </div>
        <div class="header-right">
          <el-dropdown v-if="store.isLoggedIn" @command="handleUserCommand">
            <span class="user-info">
              <el-icon><Avatar /></el-icon>
              {{ store.user?.name || '未登录' }}
              <el-tag v-if="store.user?.role" size="small" type="info">
                {{ store.user.role }}
              </el-tag>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <el-icon><User /></el-icon>
                  编辑个人信息
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>
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
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', Arial, sans-serif;
}

.app-container {
  height: 100vh;
}

.sidebar {
  background: var(--sidebar-bg);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-right: 1px solid var(--border);
  transition: width 0.2s cubic-bezier(0.32, 0.72, 0, 1);
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
  display: flex;
  gap: 8px;
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
  border-radius: 8px;
  background: linear-gradient(135deg, #007AFF, #4DA2FF);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  box-shadow: 0 2px 6px rgba(0, 122, 255, 0.3);
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
  font-size: 14px;
  transition: background-color var(--transition), color var(--transition);
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
  color: var(--primary);
  font-weight: 600;
}
.sidebar-menu .el-menu-item.is-active .el-icon {
  color: var(--primary);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-translucent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-bottom: 1px solid var(--border);
  padding: 0 28px;
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
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
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
  padding: 28px;
}

.error-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}
</style>
