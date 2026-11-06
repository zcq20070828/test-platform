<script setup lang="ts">
/**
 * 交付物质量卡片 + 用例级可用性勾选（2026-11-06 · 阶段四）
 *
 * 左侧展示门禁算出的可用率与问题分布；右侧为「逐条勾选」入口。
 * 勾选结果提交到 /api/tasks/:id/case-feedback，用于：
 *   1. 计算真实可用率（校验门禁阈值是否合理）
 *   2. 统计拒绝原因，聚合反例注入生成提示词
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { request } from '@/api'

interface QualityInfo {
  total: number
  usable: number
  usabilityGate: number | null
  usabilityHuman: number | null
  gatePassed: boolean
  byReason: Record<string, number>
  autoRepairs: number
  repairRounds: number
}

interface FeedbackItem {
  caseId: string
  usable: boolean
  rejectReason: string | null
  comment: string | null
}

const props = defineProps<{
  taskId: string
  /** 交付物正文（含用例表），用于解析出可勾选的用例清单 */
  content?: string
}>()

const quality = ref<QualityInfo | null>(null)
const feedback = ref<Record<string, FeedbackItem>>({})
const caseIds = ref<string[]>([])
const saving = ref(false)
const showPanel = ref(false)

const REASON_LABELS: Record<string, string> = {
  assertion: '预期不可判定',
  placeholder: '输入是占位值',
  duplicate: '与其他用例重复',
  irrelevant: '与需求无关',
  wrong: '预期与需求不符',
  format: '格式/字段问题',
  other: '其他',
}

const reasonText = computed(() => {
  if (!quality.value) return ''
  const entries = Object.entries(quality.value.byReason || {})
  if (!entries.length) return '未发现问题'
  return entries.map(([k, v]) => `${REASON_LABELS[k] || k} ${v} 条`).join('；')
})

const gateRate = computed(() => {
  const r = quality.value?.usabilityGate
  return r == null ? '—' : `${(r * 100).toFixed(1)}%`
})

const humanRate = computed(() => {
  const r = quality.value?.usabilityHuman
  return r == null ? '未复核' : `${(r * 100).toFixed(1)}%`
})

const markedCount = computed(() => Object.keys(feedback.value).length)

/** 从 Markdown 用例表里抽出编号 */
function extractCaseIds(text: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    const first = cells[0] || ''
    if (/^[A-Za-z]{0,6}-?\d+$/.test(first) && !seen.has(first)) {
      seen.add(first)
      ids.push(first)
    }
  }
  return ids
}

async function loadQuality() {
  try {
    const res = await request<any>(`/api/tasks/${props.taskId}`)
    if (res.success && res.data) {
      const d = res.data as any
      if (d.quality) quality.value = d.quality
      const items: FeedbackItem[] = d.caseFeedback || []
      const map: Record<string, FeedbackItem> = {}
      for (const it of items) map[it.caseId] = it
      feedback.value = map
    }
  } catch (e) {
    console.warn('[QualityCard] 读取质量信息失败', e)
  }
}

function initCaseIds() {
  if (props.content) caseIds.value = extractCaseIds(props.content)
}

watch(() => [props.taskId, props.content], () => {
  initCaseIds()
  if (props.taskId) loadQuality()
}, { immediate: true })

function mark(caseId: string, usable: boolean) {
  feedback.value = {
    ...feedback.value,
    [caseId]: {
      caseId,
      usable,
      rejectReason: usable ? null : (feedback.value[caseId]?.rejectReason || 'assertion'),
      comment: feedback.value[caseId]?.comment || null,
    },
  }
}

function setReason(caseId: string, reason: string) {
  const cur = feedback.value[caseId]
  if (!cur) return
  feedback.value = { ...feedback.value, [caseId]: { ...cur, rejectReason: reason } }
}

async function submit() {
  const items = Object.values(feedback.value).map((f) => ({
    caseId: f.caseId,
    usable: f.usable,
    rejectReason: f.usable ? null : f.rejectReason,
    comment: f.comment,
  }))
  if (!items.length) {
    ElMessage.warning('请先标记至少一条用例')
    return
  }
  saving.value = true
  try {
    const res = await request<any>(`/api/tasks/${props.taskId}/case-feedback`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    })
    if (res.success && res.data) {
      const rate = (res.data as any).humanUsability
      ElMessage.success(`已保存 ${items.length} 条${rate != null ? `，真实可用率 ${(rate * 100).toFixed(1)}%` : ''}`)
      await loadQuality()
    } else {
      ElMessage.error(res.error || '保存失败')
    }
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="quality" class="quality-card">
    <div class="qc-head">
      <span class="qc-title">
        交付物质量
        <el-tag v-if="quality.gatePassed" type="success" size="small">门禁达标</el-tag>
        <el-tag v-else type="warning" size="small">门禁未达标</el-tag>
      </span>
      <el-button link type="primary" @click="showPanel = !showPanel">
        {{ showPanel ? '收起复核' : '人工复核' }}
      </el-button>
    </div>

    <div class="qc-metrics">
      <div class="qc-metric">
        <div class="qc-label">规则可用率</div>
        <div class="qc-value">{{ gateRate }}</div>
        <div class="qc-sub">{{ quality.usable }}/{{ quality.total }} 条可直接使用</div>
      </div>
      <div class="qc-metric">
        <div class="qc-label">人工可用率</div>
        <div class="qc-value">{{ humanRate }}</div>
        <div class="qc-sub">已标记 {{ markedCount }} 条</div>
      </div>
      <div class="qc-metric">
        <div class="qc-label">自动修复</div>
        <div class="qc-value">{{ quality.autoRepairs }}</div>
        <div class="qc-sub">定向修复 {{ quality.repairRounds }} 轮</div>
      </div>
    </div>

    <div v-if="reasonText" class="qc-reasons">问题分布：{{ reasonText }}</div>

    <div v-if="showPanel" class="qc-panel">
      <div class="qc-panel-hint">
        逐条勾选「可用 / 不可用」（默认不勾）。判定会用于计算真实可用率，并沉淀成生成智能体的反例。
      </div>
      <div class="qc-list">
        <div v-for="id in caseIds" :key="id" class="qc-row">
          <span class="qc-case-id">{{ id }}</span>
          <el-radio-group
            :model-value="feedback[id]?.usable === undefined ? '' : (feedback[id]!.usable ? 'y' : 'n')"
            size="small"
            @update:model-value="(v: any) => mark(id, v === 'y')"
          >
            <el-radio-button value="y">可用</el-radio-button>
            <el-radio-button value="n">不可用</el-radio-button>
          </el-radio-group>
          <el-select
            v-if="feedback[id] && feedback[id]!.usable === false"
            :model-value="feedback[id]!.rejectReason || 'assertion'"
            size="small"
            style="width: 150px"
            @update:model-value="(v: any) => setReason(id, v)"
          >
            <el-option v-for="(label, key) in REASON_LABELS" :key="key" :label="label" :value="key" />
          </el-select>
        </div>
      </div>
      <div class="qc-actions">
        <el-button type="primary" :loading="saving" @click="submit">保存复核结果</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quality-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  padding: 14px 16px;
  margin: 12px 0;
  background: var(--el-fill-color-blank);
}
.qc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.qc-title {
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.qc-metrics {
  display: flex;
  gap: 28px;
}
.qc-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.qc-value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
}
.qc-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.qc-reasons {
  margin-top: 10px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.qc-panel {
  margin-top: 14px;
  border-top: 1px dashed var(--el-border-color-lighter);
  padding-top: 12px;
}
.qc-panel-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 10px;
}
.qc-list {
  max-height: 320px;
  overflow: auto;
}
.qc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px solid var(--el-fill-color-lighter);
}
.qc-case-id {
  font-family: monospace;
  min-width: 80px;
  font-size: 13px;
}
.qc-actions {
  margin-top: 12px;
}
</style>
