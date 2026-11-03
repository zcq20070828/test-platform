<template>
  <div class="admin-dashboard-view">
    <el-tabs v-model="activeTab" class="admin-tabs" tab-position="top">
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
import { ref } from 'vue'
import StatsView from './StatsView.vue'
import UserManagementView from './UserManagementView.vue'
import SettingsView from './SettingsView.vue'
import AdminToolsView from './AdminToolsView.vue'
import MsIcon from '@/components/MsIcon.vue'
// [已下线-性能监控] 配套上方 tab-pane 注释一并停用，恢复时取消注释
// import PerformanceView from './PerformanceView.vue'

const activeTab = ref('stats')
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
:deep(.performance-panel) {
  padding: 0;
  background: transparent;
}

.tab-label { display: inline-flex; align-items: center; gap: 6px; }
.view-title, .page-title, h2, .header-title { min-width: 0; }
.view-title { display: inline-flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
