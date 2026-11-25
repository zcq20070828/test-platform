<script setup lang="ts">
/**
 * 变更计划确认卡（2026-11-25 · 对话改造第一步）
 *
 * 解决的问题：以前「整体感觉不够严格」这类模糊指令会直接把 14 万字重写一遍，
 * 用户发完只能干等几分钟，看不到它打算改什么，也没法只改其中一部分。
 *
 * 现在后端先给一份变更计划，这里渲染成可勾选清单：
 *   - 每项都能单独勾选/取消，取消的那项不会被执行
 *   - 显示影响规模（改几条 / 全文重写），让用户预判代价
 *   - 点「执行」才真正调用智能体
 *
 * 设计取舍：
 *   - 默认全部勾选。用户发指令的意图就是要改，默认全选最省事，
 *     而他可以取消掉不想动的部分——这比逐项勾选更快。
 *   - 不展示 planId 等技术字段，只展示人能理解的内容。
 *   - 一旦确认或取消，卡片变为只读状态，避免重复提交。
 */
import { ref, computed, watch } from 'vue'
import MsIcon from '@/components/MsIcon.vue'

export interface PlanItem {
  type: 'modify' | 'add' | 'remove' | 'global'
  caseIds?: string[]
  count?: number | null
  reason?: string
}

export interface ChangePlan {
  summary: string
  mode: 'surgical' | 'append' | 'refine'
  scale: 'small' | 'medium' | 'large'
  items: PlanItem[]
}

const props = defineProps<{
  plan: ChangePlan
  planId: string
  /** 已确认/已取消后锁定，避免重复执行 */
  resolved?: boolean
  /** 提交中 */
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', payload: { planId: string; plan: ChangePlan }): void
  (e: 'cancel', planId: string): void
}>()

// 默认全选：用户发指令本意就是要改
const checked = ref<number[]>([])

watch(
  () => props.planId,
  () => {
    checked.value = (props.plan?.items || []).map((_, i) => i)
  },
  { immediate: true },
)

const items = computed(() => props.plan?.items || [])

const TYPE_LABEL: Record<string, string> = {
  modify: '修改',
  add: '新增',
  remove: '删除',
  global: '全文调整',
}

const TYPE_ICON: Record<string, string> = {
  modify: 'edit',
  add: 'add_circle',
  remove: 'delete',
  global: 'tune',
}

const SCALE_LABEL: Record<string, string> = {
  small: '改动较小',
  medium: '改动中等',
  large: '改动较大',
}

const SCALE_COLOR: Record<string, string> = {
  small: '#67C23A',
  medium: '#E6A23C',
  large: '#F56C6C',
}

function itemHead(it: PlanItem): string {
  const label = TYPE_LABEL[it.type] || it.type
  if (it.type === 'add') return `${label} ${it.count || 0} 条`
  if (it.type === 'global') return label
  const ids = it.caseIds || []
  const shown = ids.slice(0, 6).join('、')
  return `${label} ${ids.length} 条：${shown}${ids.length > 6 ? ` 等 ${ids.length} 条` : ''}`
}

const allChecked = computed(() => checked.value.length === items.value.length)
const noneChecked = computed(() => checked.value.length === 0)

function toggleAll() {
  if (props.resolved || props.loading) return
  checked.value = allChecked.value ? [] : items.value.map((_, i) => i)
}

function toggle(i: number) {
  if (props.resolved || props.loading) return
  const at = checked.value.indexOf(i)
  if (at >= 0) checked.value.splice(at, 1)
  else checked.value.push(i)
}

/** 只把勾选项回传给后端——取消的项不该被执行 */
function onConfirm() {
  if (props.resolved || props.loading || noneChecked.value) return
  const selected = checked.value
    .slice()
    .sort((a, b) => a - b)
    .map((i) => items.value[i])
    .filter((x): x is PlanItem => !!x)
  emit('confirm', {
    planId: props.planId,
    plan: { ...props.plan, items: selected },
  })
}

function onCancel() {
  if (props.resolved || props.loading) return
  emit('cancel', props.planId)
}
</script>

<template>
  <div class="change-plan" :class="{ 'is-resolved': resolved }">
    <div class="cp-head">
      <MsIcon name="checklist" :size="16" />
      <span class="cp-title">变更计划</span>
      <span class="cp-summary">{{ plan.summary }}</span>
      <span
        class="cp-scale"
        :style="{ color: SCALE_COLOR[plan.scale] || '#909399', borderColor: SCALE_COLOR[plan.scale] || '#909399' }"
      >
        {{ SCALE_LABEL[plan.scale] || plan.scale }}
      </span>
    </div>

    <div class="cp-hint" v-if="!resolved">
      它打算改这些地方。<strong>取消勾选的项目不会被执行</strong>——确认前可以先划掉不想动的。
    </div>
    <div class="cp-hint" v-else>
      该计划已处理，本条为历史记录。
    </div>

    <ul class="cp-items">
      <li
        v-for="(it, i) in items"
        :key="i"
        class="cp-item"
        :class="{ active: checked.includes(i), disabled: resolved }"
        @click="toggle(i)"
      >
        <span class="cp-check">
          <MsIcon :name="resolved ? 'check' : (checked.includes(i) ? 'check_box' : 'check_box_outline_blank')" :size="18" />
        </span>
        <span class="cp-type" :data-type="it.type">
          <MsIcon :name="TYPE_ICON[it.type] || 'edit'" :size="14" />
        </span>
        <span class="cp-body">
          <span class="cp-line">{{ itemHead(it) }}</span>
          <span class="cp-reason" v-if="it.reason">{{ it.reason }}</span>
        </span>
      </li>
    </ul>

    <div class="cp-actions" v-if="!resolved">
      <el-button link size="small" @click="toggleAll" :disabled="loading">
        {{ allChecked ? '全部取消' : '全部勾选' }}
      </el-button>
      <span class="cp-spacer" />
      <el-button size="small" @click="onCancel" :disabled="loading">不用了</el-button>
      <el-button
        type="primary"
        size="small"
        :loading="loading"
        :disabled="noneChecked"
        @click="onConfirm"
      >
        按勾选的 {{ checked.length }} 项执行
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.change-plan {
  margin: 8px 0;
  padding: 12px 14px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 8px;
  background: var(--el-color-primary-light-9);
}
.change-plan.is-resolved {
  opacity: .72;
  border-color: var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}
.cp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.cp-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.cp-summary {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-scale {
  flex: 0 0 auto;
  font-size: 12px;
  padding: 0 6px;
  border: 1px solid;
  border-radius: 10px;
  line-height: 18px;
}
.cp-hint {
  margin: 6px 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.cp-items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cp-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color .12s;
}
.cp-item:hover { background: var(--el-color-primary-light-8); }
.cp-item.disabled { cursor: default; }
.cp-item:not(.active) { opacity: .5; }
.cp-check { flex: 0 0 auto; display: flex; color: var(--el-color-primary); }
.cp-type {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  color: var(--el-text-color-secondary);
}
.cp-type[data-type="add"] { color: var(--el-color-success); }
.cp-type[data-type="remove"] { color: var(--el-color-danger); }
.cp-type[data-type="global"] { color: var(--el-color-warning); }
.cp-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cp-line { font-size: 13px; color: var(--el-text-color-primary); }
.cp-reason { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.5; }
.cp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.cp-spacer { flex: 1 1 auto; }
</style>
