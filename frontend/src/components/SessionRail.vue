<script setup lang="ts">
/**
 * 会话产物侧栏（2026-11-25 · 对话改造第三步）
 *
 * 解决的问题：一个任务只能改一份交付物，想让 AI 从「需求分析」做到
 * 「用例生成」，用户得退出、新建任务、把上一份产出再传一遍。
 *
 * 这个侧栏把同一会话里的产物按顺序列出来（需求分析 → 用例生成 → 方案），
 * 点一下就能切到那份产物继续对话。
 *
 * 设计约束：
 *   - **只做导航，不做执行**。会话不改变任务的执行方式，任务仍是唯一执行单元。
 *   - 侧栏可收起：不需要多产物的用户不该被打扰（默认收起）。
 *   - 序号来自 session_seq，不靠创建时间——同秒创建时时间排序不确定。
 */
import { ref, computed } from 'vue'
import MsIcon from '@/components/MsIcon.vue'
import { sessionApi } from '@/api'

const props = defineProps<{
  /** 当前所属会话；为空时不显示侧栏 */
  sessionId?: string | null
  /** 当前正在看的任务（高亮） */
  activeTaskId?: string | null
}>()

const emit = defineEmits<{
  (e: 'open', taskId: string): void
}>()

const collapsed = ref(true)
const loading = ref(false)
const items = ref<any[]>([])
const loadedFor = ref<string>('')

const AGENT_LABEL: Record<string, string> = {
  'test-requirement-analyzer': '需求分析',
  'test-case-generator': '测试用例',
  'test-scheme-generator': '测试方案',
  'test-data-generator': '测试数据',
  'security-sentinel': '安全测试',
  'api-executor': '接口测试',
  'ui-e2e-executor': 'UI 测试',
  'defect-analyzer': '缺陷分析',
}

const agentLabel = (id: string) => AGENT_LABEL[id] || id || '产物'

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  running: '执行中',
  pending: '等待中',
  failed: '失败',
}

const count = computed(() => items.value.length)

async function load() {
  const sid = props.sessionId
  if (!sid) {
    items.value = []
    loadedFor.value = ''
    return
  }
  // 同一会话不重复拉
  if (loadedFor.value === sid && items.value.length) return
  loading.value = true
  try {
    const res = await sessionApi.tasks(sid)
    if (res.success) {
      items.value = res.tasks || []
      loadedFor.value = sid
    } else {
      items.value = []
    }
  } catch (_) {
    items.value = []
  } finally {
    loading.value = false
  }
}

/** 展开时才拉数据，避免每次进页面都发请求 */
function toggle() {
  collapsed.value = !collapsed.value
  if (!collapsed.value) load()
}

defineExpose({ load, toggle })
</script>

<template>
  <div v-if="sessionId" class="session-rail" :class="{ collapsed }">
    <button class="sr-toggle" type="button" @click="toggle" :title="collapsed ? '展开会话产物' : '收起'">
      <MsIcon :name="collapsed ? 'chevron_right' : 'chevron_left'" :size="18" />
      <span v-if="collapsed" class="sr-toggle-label">产物</span>
    </button>

    <div v-if="!collapsed" class="sr-body">
      <div class="sr-head">
        <MsIcon name="inventory_2" :size="16" />
        <span class="sr-title">会话产物</span>
        <span class="sr-count">{{ count }}</span>
      </div>

      <div v-if="loading" class="sr-empty">加载中…</div>
      <div v-else-if="!count" class="sr-empty">
        这个会话还没有产物。让 AI 继续做一个环节，产物会自动串到这里。
      </div>
      <ul v-else class="sr-list">
        <li
          v-for="it in items"
          :key="it.id"
          class="sr-item"
          :class="{ active: it.id === activeTaskId, failed: it.status === 'failed' }"
          @click="emit('open', it.id)"
        >
          <span class="sr-seq">{{ it.seq }}</span>
          <span class="sr-main">
            <span class="sr-line1">
              <span class="sr-agent">{{ agentLabel(it.agentId) }}</span>
              <span class="sr-status" :data-status="it.status">{{ STATUS_LABEL[it.status] || it.status }}</span>
            </span>
            <span class="sr-line2" v-if="it.title">{{ it.title }}</span>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.session-rail {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-left: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  transition: width .15s;
  width: 240px;
  flex: 0 0 240px;
}
.session-rail.collapsed {
  width: 40px;
  flex: 0 0 40px;
}
.sr-toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding: 8px 4px;
  border: none;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  font-size: 12px;
  writing-mode: horizontal-tb;
}
.sr-toggle:hover { background: var(--el-fill-color-light); }
.sr-toggle-label { writing-mode: vertical-rl; letter-spacing: 2px; margin-top: 4px; }
.sr-body { flex: 1 1 auto; overflow-y: auto; padding: 0 8px 8px; }
.sr-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.sr-count {
  margin-left: auto;
  font-weight: 400;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
.sr-empty {
  padding: 16px 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-placeholder);
}
.sr-list { list-style: none; margin: 0; padding: 0; }
.sr-item {
  display: flex;
  gap: 8px;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color .12s;
}
.sr-item:hover { background: var(--el-fill-color-light); }
.sr-item.active {
  background: var(--el-color-primary-light-9);
  box-shadow: inset 2px 0 0 var(--el-color-primary);
}
.sr-item.failed .sr-agent { color: var(--el-color-danger); }
.sr-seq {
  flex: 0 0 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  background: var(--el-fill-color);
  border-radius: 9px;
}
.sr-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sr-line1 { display: flex; align-items: center; gap: 6px; }
.sr-agent { font-size: 13px; color: var(--el-text-color-primary); }
.sr-status {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}
.sr-status[data-status="completed"] { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.sr-status[data-status="failed"] { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.sr-status[data-status="running"] { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.sr-line2 {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
