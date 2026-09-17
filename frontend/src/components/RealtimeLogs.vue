<script setup lang="ts">
import { computed } from 'vue'
import { useMainStore } from '@/stores/main'

const store = useMainStore()

// 格式化时间
function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  })
}

// 获取状态对应的颜色
function getStatusType(status: string) {
  switch (status) {
    case 'success': return 'success'
    case 'error': return 'danger'
    case 'warning': return 'warning'
    default: return 'info'
  }
}

// 截断长消息
function truncateMessage(msg: string, maxLen: number = 60) {
  return msg.length > maxLen ? msg.slice(0, maxLen) + '...' : msg
}
</script>

<template>
  <div class="realtime-logs">
    <div class="logs-header">
      <span class="logs-title">📡 实时事件</span>
      <el-tag 
        :type="store.wsConnected ? 'success' : 'danger'" 
        size="small"
        effect="plain"
      >
        {{ store.wsConnected ? '已连接' : '未连接' }}
      </el-tag>
    </div>
    
    <div class="logs-list" v-if="store.realtimeLogs.length > 0">
      <div 
        v-for="log in store.realtimeLogs.slice(0, 20)" 
        :key="log.id"
        class="log-item"
      >
        <el-tag :type="getStatusType(log.status || 'info')" size="small" effect="plain">
          {{ formatTime(log.timestamp) }}
        </el-tag>
        <span class="log-message" :title="log.message">
          {{ truncateMessage(log.message) }}
        </span>
      </div>
    </div>
    
    <div class="logs-empty" v-else>
      <el-empty description="暂无实时事件" :image-size="40" />
    </div>
  </div>
</template>

<style scoped>
.realtime-logs {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 12px;
  height: 200px;
  display: flex;
  flex-direction: column;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.logs-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.logs-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-size: 12px;
}

.log-message {
  flex: 1;
  color: var(--el-text-color-regular);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logs-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>