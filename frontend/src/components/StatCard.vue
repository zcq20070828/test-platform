<script setup lang="ts">
defineProps<{
  icon: string
  value: string | number
  label: string
}>()
</script>

<template>
  <el-card class="stat-card" shadow="hover">
    <div class="stat-icon">{{ icon }}</div>
    <div class="stat-value">{{ value }}</div>
    <div class="stat-label">{{ label }}</div>
  </el-card>
</template>

<style scoped>
.stat-card {
  text-align: center;
  transition: box-shadow var(--transition), transform var(--transition);
}

.stat-card:hover {
  transform: translateY(-2px);
}

.stat-icon {
  font-size: 26px;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: var(--el-color-primary);
  margin-bottom: 4px;
  letter-spacing: -0.02em;
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
