<script setup lang="ts">
withDefaults(
  defineProps<{
    icon: string
    value: string | number
    label: string
    /** Optional delta text, e.g. "+14.2%" */
    delta?: string
    /** Icon/accent tone matching stitch tiles */
    tone?: 'blue' | 'indigo' | 'cyan' | 'rose' | 'emerald' | 'amber' | 'teal' | 'violet' | 'slate'
    /** Optional unit shown beside the metric */
    unit?: string
    /** Show decorative sparkline (visual only) */
    sparkline?: boolean
  }>(),
  {
    tone: 'indigo',
    sparkline: true
  }
)
</script>

<template>
  <el-card class="stat-card pto-throughput" shadow="hover">
    <div class="stat-top">
      <div class="stat-top-left">
        <div class="pto-icon-tile pto-icon-tile--sm" :class="`pto-icon-tile--${tone}`">
          <span v-if="icon.length <= 3" class="tile-emoji">{{ icon }}</span>
          <span v-else class="material-symbols-outlined">{{ icon }}</span>
        </div>
        <span class="stat-label">{{ label }}</span>
      </div>
      <span
        v-if="delta"
        class="pto-badge"
        :class="delta.trim().startsWith('-') ? 'pto-badge--delta-down' : 'pto-badge--delta-up'"
      >{{ delta }}</span>
    </div>

    <div class="stat-metric-row">
      <span class="stat-value pto-metric">{{ value }}</span>
      <span v-if="unit" class="stat-unit">{{ unit }}</span>
    </div>

    <div v-if="sparkline" class="pto-sparkline" :class="`pto-sparkline--${tone === 'blue' ? 'indigo' : tone}`">
      <span /><span /><span /><span /><span /><span /><span /><span />
    </div>
    <div v-else class="pto-accent-bar" :class="`pto-accent-bar--${tone === 'teal' || tone === 'violet' || tone === 'slate' ? 'indigo' : tone}`" />
  </el-card>
</template>

<style scoped>
.stat-card {
  transition: box-shadow var(--transition), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color var(--transition);
}
.stat-card:hover {
  transform: translateY(-2px);
}
.stat-card :deep(.el-card__body) {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.stat-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.stat-top-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tile-emoji {
  font-size: 14px;
  line-height: 1;
}
.stat-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stat-metric-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
}
.stat-value {
  font-size: 28px !important;
  line-height: 1.1 !important;
  color: var(--text) !important;
}
.stat-unit {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}
</style>
