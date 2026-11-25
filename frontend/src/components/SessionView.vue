<script setup lang="ts">
/**
 * 会话视图（2026-11-25 · 对话改造第三步）
 *
 * 解决的问题：一个任务 = 一次交付物生成，想让 AI 从「需求分析」做到
 * 「用例生成」，用户得退出、新建任务、把上一份产出再传一遍。
 *
 * 这个视图把任务按会话折叠起来：一个会话里能看到它产出的所有环节，
 * 顺序由 sessionSeq 决定（不靠时间，同秒创建时间排序不确定）。
 *
 * 设计约束：
 *   - **只做导航，不做执行**。会话不改变任务的执行方式。
 *   - 未归属会话的老任务单独归到「不在此视图内」，不假装它们属于某会话。
 *   - 数据从任务列表直接分组，不再多发一次请求——列表接口已带 sessionId。
 */
import { computed, ref } from 'vue'
import MsIcon from '@/components/MsIcon.vue'
import type { Task } from '@/types'

const props = defineProps<{
  tasks: Task[]
}>()

const emit = defineEmits<{
  (e: 'open', task: Task): void
}>()

const AGENT_LABEL: Record<string, string> = {
  'test-requirement-analyzer': '需求分析',
  'test-case-generator': '测试用例',
  'test-scheme-generator': '测试方案',
  'test-data-generator': '测试数据',
  'security-sentinel': '安全测试',
  'api-executor': '接口测试',
  'ui-e2e-executor': 'UI 测试',
  'defect-analyzer': '缺陷分析',
  'test-reporter': '测试报告',
}
const agentLabel = (id?: string) => AGENT_LABEL[id || ''] || id || '产物'

const STATUS_TEXT: Record<string, string> = {
  completed: '已完成',
  running: '执行中',
  pending: '等待中',
  failed: '失败',
  cancelled: '已取消',
}

/** 按 sessionId 分组，会话内按 sessionSeq 升序 */
const groups = computed(() => {
  const map = new Map<string, Task[]>()
  for (const t of props.tasks || []) {
    const sid = (t as any).sessionId
    if (!sid) continue
    if (!map.has(sid)) map.set(sid, [])
    map.get(sid)!.push(t)
  }
  const out = [...map.entries()].map(([sid, list]) => {
    const sorted = [...list].sort((a, b) => {
      const sa = Number((a as any).sessionSeq) || 0
      const sb = Number((b as any).sessionSeq) || 0
      if (sa !== sb) return sa - sb
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    })
    const latest = sorted.reduce((acc, t) => {
      const ta = String(t.createdAt || '')
      return ta > acc ? ta : acc
    }, '')
    return {
      id: sid,
      tasks: sorted,
      latest,
      completed: sorted.filter((t) => t.status === 'completed').length,
      running: sorted.some((t) => t.status === 'running'),
    }
  })
  // 最近活跃的会话排前面
  return out.sort((a, b) => b.latest.localeCompare(a.latest))
})

/** 没有会话归属的任务数——显式告知，不让用户以为任务丢了 */
const unassignedCount = computed(
  () => (props.tasks || []).filter((t) => !(t as any).sessionId).length,
)

const expanded = ref<Record<string, boolean>>({})

function isOpen(id: string, idx: number) {
  // 默认展开最近一个会话，其余收起
  if (expanded.value[id] !== undefined) return expanded.value[id]
  return idx === 0
}

function toggle(id: string) {
  const current = expanded.value[id]
  expanded.value = { ...expanded.value, [id]: current === undefined ? false : !current }
}

function whenText(t: Task) {
  const raw = t.createdAt || t.startTime || ''
  return String(raw).slice(5, 16) || ''
}
</script>

<template>
  <div class="session-view">
    <div v-if="!groups.length" class="sv-empty">
      <MsIcon name="inventory_2" :size="28" />
      <p class="sv-empty-title">还没有会话</p>
      <p class="sv-empty-hint">
        从「分步测试」提交任务后，产物会自动归入会话，这里就能按「哪个项目做到了哪一步」来看。
      </p>
    </div>

    <div v-else class="sv-list">
      <div v-for="(g, gi) in groups" :key="g.id" class="sv-group">
        <div class="sv-head" @click="toggle(g.id)">
          <MsIcon :name="isOpen(g.id, gi) ? 'expand_more' : 'chevron_right'" :size="18" />
          <span class="sv-seq-badge">{{ g.tasks.length }}</span>
          <span class="sv-title">
            会话 {{ g.id.slice(0, 8) }}
          </span>
          <span class="sv-meta">
            {{ g.completed }}/{{ g.tasks.length }} 已完成
            <span v-if="g.running" class="sv-running">· 执行中</span>
          </span>
          <span class="sv-time">{{ g.latest.slice(5, 16) }}</span>
        </div>

        <ul v-if="isOpen(g.id, gi)" class="sv-items">
          <li
            v-for="t in g.tasks"
            :key="t.id"
            class="sv-item"
            :class="t.status"
            @click="emit('open', t)"
          >
            <span class="sv-seq">{{ (t as any).sessionSeq }}</span>
            <span class="sv-agent">{{ agentLabel(t.agentId || t.agent) }}</span>
            <span class="sv-input">{{ (t.input || '').slice(0, 60) }}</span>
            <span class="sv-status" :data-status="t.status">{{ STATUS_TEXT[t.status] || t.status }}</span>
            <span class="sv-when">{{ whenText(t) }}</span>
          </li>
        </ul>
      </div>
    </div>

    <p v-if="unassignedCount" class="sv-foot">
      另有 {{ unassignedCount }} 个历史任务未归属会话（改造前创建的），在「按任务看」里照常可见。
    </p>
  </div>
</template>

<style scoped>
.session-view { padding: 4px 0; }
.sv-empty {
  padding: 60px 20px;
  text-align: center;
  color: var(--el-text-color-placeholder);
}
.sv-empty-title { margin: 12px 0 6px; font-size: 15px; color: var(--el-text-color-secondary); }
.sv-empty-hint { margin: 0; font-size: 13px; line-height: 1.7; }
.sv-list { display: flex; flex-direction: column; gap: 10px; }
.sv-group {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
}
.sv-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  background: var(--el-fill-color-lighter);
  font-size: 13px;
}
.sv-head:hover { background: var(--el-fill-color-light); }
.sv-seq-badge {
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  font-size: 12px;
  border-radius: 10px;
  color: #fff;
  background: var(--el-color-primary);
}
.sv-title { font-weight: 600; color: var(--el-text-color-primary); }
.sv-meta { color: var(--el-text-color-secondary); font-size: 12px; }
.sv-running { color: var(--el-color-primary); }
.sv-time { margin-left: auto; font-size: 12px; color: var(--el-text-color-placeholder); }
.sv-items { list-style: none; margin: 0; padding: 4px 0; }
.sv-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 30px;
  cursor: pointer;
  font-size: 13px;
}
.sv-item:hover { background: var(--el-color-primary-light-9); }
.sv-item.failed .sv-agent { color: var(--el-color-danger); }
.sv-seq {
  flex: 0 0 16px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}
.sv-agent { flex: 0 0 76px; color: var(--el-text-color-primary); }
.sv-input {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sv-status {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 0 5px;
  border-radius: 3px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}
.sv-status[data-status="completed"] { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.sv-status[data-status="failed"] { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.sv-status[data-status="running"] { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.sv-when { flex: 0 0 92px; text-align: right; font-size: 12px; color: var(--el-text-color-placeholder); }
.sv-foot {
  margin: 14px 2px 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>
