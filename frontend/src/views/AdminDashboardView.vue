<template>
  <div class="admin-dashboard-view">
    <el-tabs v-model="activeTab" class="admin-tabs" tab-position="top">
      <!-- API KEY配置：所有登录用户都能管自己的 Key（2026-11-20） -->
      <el-tab-pane name="apikeys">
        <template #label><span class="tab-label"><MsIcon name="key" :size="18" /> API KEY配置</span></template>
        <ApiKeySettingsView :embedded="true" />
      </el-tab-pane>

      <!-- 以下四项仅管理员可见（2026-11-20：权限由整页下放到 tab 级） -->
      <template v-if="isAdmin">
        <!-- 数据统计 -->
        <el-tab-pane name="stats">
          <template #label><span class="tab-label"><MsIcon name="analytics" :size="18" /> 统计数据</span></template>
          <StatsView :embedded="true" />
        </el-tab-pane>
        <!-- 用户管理 -->
        <el-tab-pane name="users">
          <template #label><span class="tab-label"><MsIcon name="group" :size="18" /> 用户管理</span></template>
          <UserManagementView :embedded="true" />
        </el-tab-pane>
        <!-- 系统设置 -->
        <el-tab-pane name="settings">
          <template #label><span class="tab-label"><MsIcon name="settings" :size="18" /> 系统设置</span></template>
          <SettingsView :embedded="true" />
        </el-tab-pane>
        <!-- 工具管理 -->
        <el-tab-pane name="tools">
          <template #label><span class="tab-label"><MsIcon name="handyman" :size="18" /> 工具管理</span></template>
          <AdminToolsView :embedded="true" />
        </el-tab-pane>
        <!-- 自我进化（2026-11-20）：能看到平台从历史任务里学到了什么、效果如何，可废除错误经验 -->
        <el-tab-pane name="experience">
          <template #label><span class="tab-label"><MsIcon name="neurology" :size="18" /> 自我进化</span></template>
          <ExperienceView :embedded="true" />
        </el-tab-pane>
      </template>
      <!-- [已下线-性能监控] 2026-10-19 用户拍板：性能监控暂无业务价值，先屏蔽。
           恢复方式：取消本段注释，并取消下方 import PerformanceView 的注释；
                    同时删除 router/index.ts 中 /performance 的 meta.disabled / disabledTip。
           页面文件 views/PerformanceView.vue 保留未删，可随时还原。 -->
      <!--
      <el-tab-pane name="performance"><template #label><span class="tab-label"><MsIcon name="monitoring" :size="16" /> 性能监控</span></template>
        <PerformanceView />
      </el-tab-pane>
      -->
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMainStore } from '@/stores/main'
import StatsView from './StatsView.vue'
import UserManagementView from './UserManagementView.vue'
import SettingsView from './SettingsView.vue'
import AdminToolsView from './AdminToolsView.vue'
import ExperienceView from './ExperienceView.vue'
import ApiKeySettingsView from './ApiKeySettingsView.vue'
import MsIcon from '@/components/MsIcon.vue'
// [已下线-性能监控] 配套上方 tab-pane 注释一并停用，恢复时取消注释
// import PerformanceView from './PerformanceView.vue'

const store = useMainStore()
const isAdmin = computed(() => store.isAdmin)

// 默认停在「API KEY配置」：这是普通用户进来唯一能用的 tab，
// 管理员进来也最常先看自己的 Key。
const activeTab = ref('apikeys')

// 非管理员访问 ?tab=users 这类地址时，回落到底一个可用 tab，
// 避免 el-tabs 停在空白页
watch([isAdmin, activeTab], () => {
  if (!isAdmin.value && activeTab.value !== 'apikeys') {
    activeTab.value = 'apikeys'
  }
}, { immediate: true })
</script>

<style scoped>
.admin-dashboard-view {
  padding: 0 24px 24px;
  min-height: calc(100vh - 120px);
}

.admin-tabs {
  background: #fff;
  border-radius: 8px;
  padding: 0;
}

/* 去掉内嵌视图的页头，避免双重标题 */
:deep(.view-header),
:deep(.page-header),
:deep(.el-page-header) {
  display: none;
}

:deep(.stats-view),
:deep(.user-management),
:deep(.settings-view),
:deep(.admin-tools-view),
:deep(.performance-panel),
:deep(.api-key-settings-view) {
  padding: 0;
  background: transparent;
}

.tab-label { display: inline-flex; align-items: center; gap: 6px; }
.view-title, .page-title, h2, .header-title { min-width: 0; }
.view-title { display: inline-flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
