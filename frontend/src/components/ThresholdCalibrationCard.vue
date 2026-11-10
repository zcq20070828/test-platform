<script setup lang="ts">
/**
 * 门禁阈值人工校准面板（2026-11-09）
 *
 * 解决的是一个一直没人回答的问题：0.85 这个可用率阈值是设计时拍定的，
 * 从来没有用人工判定校验过。五个样本里两个不达标，但没人知道
 * 「门禁说 85% 达标」对应的人感是「够用」还是「勉强」。
 *
 * 这里基于 case_feedback（人工逐条判定）反算：
 *   「门禁放行的交付物，人工实际能用掉多少」
 * 并给出推荐阈值——选满足人感目标（默认 90%）的最宽松阈值，
 * 既不放行半成品，也不白白卡掉可用交付物。
 *
 * 样本不足时明确说不足，不给假结论。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { qualityApi } from '@/api'
import MsIcon from '@/components/MsIcon.vue'

interface Calibration {
  status: 'ok' | 'no_data' | 'insufficient' | 'infeasible'
  message: string
  sampleCount: number
  markedCases: number
  targetHumanRate: number
  currentThreshold: number | null
  thresholdSource: string
  recommended: number | null
  delta: number | null
  current: { threshold: number; passed: number; coverage: number; meanHumanRate: number | null; falsePass: number; falseFail: number } | null
  recommendedDetail?: { threshold: number; passed: number; coverage: number; meanHumanRate: number | null; minHumanRate: number | null; falsePass: number; falseFail: number }
  curve: Array<{ threshold: number; coverage: number; meanHumanRate: number | null; meetsTarget: boolean }>
  disagreements: Array<{ taskId: string; gateRate: number; humanRate: number; type: string; hint: string }>
  samples: Array<{ taskId: string; gateRate: number; humanRate: number; marked: number }>
}

const loading = ref(false)
const saving = ref(false)
const data = ref<Calibration | null>(null)
const days = ref(180)
const target = ref(90)

const statusTag = computed(() => {
  switch (data.value?.status) {
    case 'ok': return { type: 'success' as const, text: '可校准' }
    case 'insufficient': return { type: 'warning' as const, text: '样本不足' }
    case 'infeasible': return { type: 'danger' as const, text: '口径不一致' }
    default: return { type: 'info' as const, text: '无数据' }
  }
})

const sourceText = computed(() => {
  switch (data.value?.thresholdSource) {
    case 'system_config': return '人工校准确认值'
    case 'env': return '环境变量（未校准）'
    default: return '设计默认值（未校准）'
  }
})

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`)

/** 曲线里标出可行区间，便于理解「为什么推荐这个值」 */
const curveRows = computed(() => {
  const list = data.value?.curve || []
  const rec = data.value?.recommended
  return list
    .filter((_, i) => i % 5 === 0)
    .map((c) => ({ ...c, isRecommended: rec != null && Math.abs(c.threshold - rec) < 0.005 }))
})

async function load() {
  loading.value = true
  try {
    const res = await qualityApi.thresholdCalibration(days.value, target.value / 100) as any
    // request() 把响应体包在 data 里：{ success, data: { status, message, ... } }
    const payload = res?.data && typeof res.data === 'object' ? res.data : res
    if (payload && payload.status) data.value = payload as Calibration
    else ElMessage.error(res?.error || '读取校准数据失败')
  } catch (e: any) {
    ElMessage.error('读取校准数据失败：' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function adopt() {
  const rate = data.value?.recommended
  if (rate == null) return
  try {
    await ElMessageBox.confirm(
      `确认把门禁可用率阈值从 ${data.value?.currentThreshold != null ? pct(data.value.currentThreshold) : '默认'} 改为 ${pct(rate)}？\n\n` +
      `依据：${data.value?.sampleCount} 个任务 / ${data.value?.markedCases} 条人工判定；` +
      `该阈值下放行的交付物人工真实可用率均值 ${pct(data.value?.recommendedDetail?.meanHumanRate)}。\n` +
      '修改后对后续任务立即生效。',
      '采纳校准结果',
      { type: 'warning', confirmButtonText: '确认采纳', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    const res = await qualityApi.adoptThreshold(rate) as any
    if (res?.success) {
      ElMessage.success(`阈值已更新为 ${pct(rate)}，对后续任务生效`)
      await load()
    } else {
      ElMessage.error(res?.error || '更新失败')
    }
  } catch (e: any) {
    ElMessage.error('更新失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <el-card shadow="never" class="calib-card" v-loading="loading">
    <div class="calib-head">
      <span class="calib-title">
        <MsIcon name="tune" :size="18" /> 门禁阈值校准
        <el-tag :type="statusTag.type" size="small">{{ statusTag.text }}</el-tag>
      </span>
      <div class="calib-controls">
        <span class="calib-label">统计区间</span>
        <el-select v-model="days" size="small" style="width: 110px" @change="load">
          <el-option :value="30" label="近 30 天" />
          <el-option :value="90" label="近 90 天" />
          <el-option :value="180" label="近 180 天" />
          <el-option :value="365" label="近 1 年" />
        </el-select>
        <span class="calib-label">人感目标</span>
        <el-select v-model="target" size="small" style="width: 130px" @change="load">
          <el-option :value="80" label="80% 够用" />
          <el-option :value="90" label="90% 够用" />
          <el-option :value="95" label="95% 够用" />
        </el-select>
        <el-button size="small" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="calib-desc">
      当前阈值 <strong>{{ pct(data?.currentThreshold) }}</strong>
      <el-tag size="small" type="info" style="margin-left: 6px">{{ sourceText }}</el-tag>
      <span class="calib-hint">
        ；校准口径：要求「门禁放行的交付物」人工真实可用率均值 ≥ {{ target }}%，取满足条件的最宽松阈值。
      </span>
    </div>

    <el-alert
      v-if="data"
      :title="data.message"
      :type="data.status === 'ok' ? 'success' : data.status === 'infeasible' ? 'error' : 'warning'"
      :closable="false"
      show-icon
      style="margin: 12px 0"
    />

    <div v-if="data" class="calib-metrics">
      <div class="calib-metric">
        <div class="calib-metric-label">有效样本任务</div>
        <div class="calib-metric-value">{{ data.sampleCount }}</div>
        <div class="calib-metric-sub">需同时有门禁率与人工率</div>
      </div>
      <div class="calib-metric">
        <div class="calib-metric-label">人工标记用例</div>
        <div class="calib-metric-value">{{ data.markedCases }}</div>
        <div class="calib-metric-sub">少于 100 条不校准</div>
      </div>
      <div class="calib-metric">
        <div class="calib-metric-label">当前阈值下的人感</div>
        <div class="calib-metric-value">{{ pct(data.current?.meanHumanRate) }}</div>
        <div class="calib-metric-sub">
          放行 {{ data.current?.passed ?? 0 }} 个 / 覆盖 {{ pct(data.current?.coverage) }}
        </div>
      </div>
      <div class="calib-metric">
        <div class="calib-metric-label">推荐阈值</div>
        <div class="calib-metric-value recommend">{{ pct(data.recommended) }}</div>
        <div class="calib-metric-sub">
          {{ data.delta == null ? '—' : data.delta > 0 ? `收紧 ${(data.delta * 100).toFixed(0)}pp` : data.delta < 0 ? `放宽 ${(-data.delta * 100).toFixed(0)}pp` : '与当前一致' }}
        </div>
      </div>
    </div>

    <div v-if="data?.recommended != null" class="calib-actions">
      <el-button type="primary" :loading="saving" @click="adopt">
        采纳推荐阈值 {{ pct(data.recommended) }}
      </el-button>
      <span class="calib-hint">
        采纳后写入 system_config，对后续任务生效；历史任务不受影响。
      </span>
    </div>

    <div v-if="curveRows.length" class="calib-curve">
      <div class="calib-subtitle">阈值 → 人感曲线（每 5 个百分点一行）</div>
      <el-table :data="curveRows" size="small" border max-height="260">
        <el-table-column label="阈值" width="90">
          <template #default="{ row }">
            <span :class="{ 'calib-rec': row.isRecommended }">{{ pct(row.threshold) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="放行任务覆盖率" width="130">
          <template #default="{ row }">{{ pct(row.coverage) }}</template>
        </el-table-column>
        <el-table-column label="放行后人工可用率均值" width="170">
          <template #default="{ row }">
            <span :class="row.meetsTarget ? 'calib-ok' : 'calib-bad'">{{ pct(row.meanHumanRate) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="是否满足人感目标">
          <template #default="{ row }">
            <el-tag v-if="row.meetsTarget" type="success" size="small">满足</el-tag>
            <el-tag v-else type="info" size="small">不满足</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="data?.disagreements?.length" class="calib-curve">
      <div class="calib-subtitle">门禁与人工判断相反的样本（排查门禁抓错了什么）</div>
      <el-table :data="data.disagreements" size="small" border max-height="220">
        <el-table-column prop="taskId" label="任务" min-width="200" show-overflow-tooltip />
        <el-table-column label="门禁可用率" width="120">
          <template #default="{ row }">{{ pct(row.gateRate) }}</template>
        </el-table-column>
        <el-table-column label="人工可用率" width="120">
          <template #default="{ row }">{{ pct(row.humanRate) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag :type="row.type === 'false_pass' ? 'danger' : 'warning'" size="small">
              {{ row.type === 'false_pass' ? '漏放' : '误拦' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="hint" label="排查方向" min-width="240" show-overflow-tooltip />
      </el-table>
    </div>
  </el-card>
</template>

<style scoped>
.calib-card { margin-top: 20px; }
.calib-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.calib-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 16px; }
.calib-controls { display: inline-flex; align-items: center; gap: 8px; }
.calib-label { font-size: 12px; color: var(--el-text-color-secondary); }
.calib-desc { margin-top: 10px; font-size: 13px; color: var(--el-text-color-regular); }
.calib-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.calib-metrics { display: flex; gap: 32px; margin-top: 6px; flex-wrap: wrap; }
.calib-metric-label { font-size: 12px; color: var(--el-text-color-secondary); }
.calib-metric-value { font-size: 22px; font-weight: 600; line-height: 1.3; }
.calib-metric-value.recommend { color: var(--el-color-primary); }
.calib-metric-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.calib-actions { margin-top: 14px; display: flex; align-items: center; gap: 12px; }
.calib-curve { margin-top: 18px; }
.calib-subtitle { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.calib-rec { font-weight: 700; color: var(--el-color-primary); }
.calib-ok { color: var(--el-color-success); }
.calib-bad { color: var(--el-text-color-secondary); }
</style>
