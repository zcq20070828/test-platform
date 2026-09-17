<template>
  <div class="admin-dashboard-view">
    <el-tabs v-model="activeTab" class="admin-tabs" tab-position="top">
      <!-- 数据统计 -->
      <el-tab-pane name="stats" label="📊 统计数据">
        <StatsView :embedded="true" />
      </el-tab-pane>
      <!-- 用户管理 -->
      <el-tab-pane name="users" label="👥 用户管理">
        <UserManagementView :embedded="true" />
      </el-tab-pane>
      <!-- 系统设置 -->
      <el-tab-pane name="settings" label="⚙️ 系统设置">
        <SettingsView :embedded="true" />
      </el-tab-pane>
      <!-- 工具管理 -->
      <el-tab-pane name="tools" label="🛠️ 工具管理">
        <AdminToolsView :embedded="true" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import StatsView from './StatsView.vue'
import UserManagementView from './UserManagementView.vue'
import SettingsView from './SettingsView.vue'
import AdminToolsView from './AdminToolsView.vue'

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
:deep(.admin-tools-view) {
  padding: 0;
  background: transparent;
}
</style>
