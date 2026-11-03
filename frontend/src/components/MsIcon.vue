<template>
  <span
    class="material-symbols-outlined ms-icon"
    :class="[cls, { 'is-loading': loading }]"
    :style="iconStyle"
    aria-hidden="true"
  >{{ name }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    color?: string
    filled?: boolean
    cls?: string
    loading?: boolean
  }>(),
  { size: 20, filled: false, loading: false }
)

const sizePx = computed(() =>
  typeof props.size === 'number' ? `${props.size}px` : String(props.size)
)

const iconStyle = computed(() => ({
  fontSize: sizePx.value,
  width: sizePx.value,
  height: sizePx.value,
  color: props.color || undefined,
  fontVariationSettings: props.filled
    ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
    : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24"
}))
</script>

<style scoped>
.ms-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-weight: 400;
  user-select: none;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
