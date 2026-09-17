<template>
  <transition name="fade">
    <div v-if="isActive" class="session-bar" :class="{ warning: isWarning }">
      <el-icon class="session-icon"><Timer /></el-icon>
      <span>会话剩余时间：</span>
      <span class="session-time">{{ remainingText }}</span>
      <span v-if="isWarning" class="session-hint">请操作以保持登录</span>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { Timer } from '@element-plus/icons-vue'
import { remainingText, isWarning, isActive } from '@/composables/useSessionTimeout'
</script>

<style scoped>
.session-bar {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 16px;
  background: #67c23a;
  color: #fff;
  font-size: 12px;
  border-radius: 0 0 8px 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  white-space: nowrap;
}

.session-bar.warning {
  background: #e6a23c;
  animation: pulse 1.5s ease-in-out infinite;
}

.session-icon {
  font-size: 14px;
}

.session-time {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.session-hint {
  opacity: 0.9;
  font-size: 11px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>
