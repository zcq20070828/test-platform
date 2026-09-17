<script setup lang="ts">
defineProps<{
  icon: string
  name: string
  desc: string
}>()

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <el-card class="quick-task-card" shadow="hover" @click="emit('click')">
    <div class="quick-task-icon">{{ icon }}</div>
    <div class="quick-task-name">{{ name }}</div>
    <div class="quick-task-desc">{{ desc }}</div>
  </el-card>
</template>

<style scoped>
.quick-task-card {
  cursor: pointer;
  text-align: center;
  transition: all 0.3s ease;
}

.quick-task-card:hover {
  transform: translateY(-2px);
  border-color: var(--el-color-primary);
}

.quick-task-icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.quick-task-name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}

.quick-task-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
