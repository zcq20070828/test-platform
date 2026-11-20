<template>
  <div class="experience-view">
    <div class="exp-header">
      <div>
        <h2 class="exp-title"><MsIcon name="neurology" :size="22" /> 自我进化 · 经验库</h2>
        <p class="exp-subtitle">
          平台把每一次审核意见和门禁缺陷沉淀成「经验」，下次生成前自动注入提示词。
          注入后同类问题减少 → 升级约束强度或休眠；不再减少 → 降级待你复核。
        </p>
      </div>
      <div class="header-actions">
        <el-button @click="load" :loading="loading" circle>
          <MsIcon name="refresh" :size="16" />
        </el-button>
        <el-button type="primary" plain :loading="evolving" @click="runEvolve">
          <MsIcon name="auto_awesome" :size="16" /> 立刻进化一次
        </el-button>
      </div>
    </div>

    <!-- 总览（与「统计数据」页同一套卡片写法） -->
    <el-card class="overview-card" shadow="hover">
      <div class="card-header">
        <span class="card-title">经验总览</span>
      </div>
      <el-row :gutter="16" style="margin-top: 16px">
        <el-col :span="4">
          <div class="stat-item primary">
            <div class="stat-value">{{ stats.totals.all }}</div>
            <div class="stat-label">累计经验</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item success">
            <div class="stat-value">{{ stats.totals.active }}</div>
            <div class="stat-label">生效中</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item warning">
            <div class="stat-value">{{ stats.totals.watch }}</div>
            <div class="stat-label">观察中</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item">
            <div class="stat-value">{{ stats.totals.dormant }}</div>
            <div class="stat-label">已休眠</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item danger">
            <div class="stat-value">{{ stats.totals.suppressed }}</div>
            <div class="stat-label">已废除</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item success">
            <div class="stat-value">{{ stats.totals.improved }}</div>
            <div class="stat-label">确认有效</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 阈值自动校准 -->
    <el-card class="calib-card" shadow="hover">
      <div class="calib-head">
        <div>
          <strong>门禁阈值自动校准</strong>
          <span class="calib-hint">
            用审核结论当弱标签，不需要人工逐条标注。目标是让「门禁的判断」尽量与「审核的判断」一致。
          </span>
        </div>
        <div class="calib-actions">
          <el-button size="small" @click="loadCalibration" :loading="calibLoading">查看建议</el-button>
          <el-button
            size="small"
            type="primary"
            :disabled="!calib || !calib.applied"
            :loading="calibApplying"
            @click="applyCalibration"
          >
            采纳建议
          </el-button>
        </div>
      </div>
      <div v-if="calib" class="calib-body">
        <div class="calib-kv">
          <span>当前阈值 <strong>{{ (calib.currentThreshold * 100).toFixed(0) }}%</strong></span>
          <span v-if="calib.status === 'ok'">
            建议 <strong>{{ calib.recommended != null ? (calib.recommended * 100).toFixed(0) + '%' : '保持' }}</strong>
          </span>
          <span>样本 <strong>{{ calib.sampleCount }}</strong> 个任务</span>
          <span v-if="calib.best">
            一致率 <strong>{{ (calib.best.agreement * 100).toFixed(1) }}%</strong> /
            误放行 <strong>{{ (calib.best.falsePassRate * 100).toFixed(1) }}%</strong>
          </span>
        </div>
        <div class="calib-msg" :class="{ warn: calib.status !== 'ok' }">{{ calib.message }}</div>
        <div v-if="calib.history && calib.history.length" class="calib-history">
          <span class="history-label">最近调整：</span>
          <span v-for="(h, i) in calib.history.slice(0, 3)" :key="i" class="history-item">
            {{ (h.previous * 100).toFixed(0) }}% → {{ (h.threshold * 100).toFixed(0) }}%
            <em>({{ h.sampleTasks }} 样本)</em>
          </span>
        </div>
      </div>
      <div v-else class="calib-empty">点「查看建议」了解当前阈值是否合理。</div>
    </el-card>

    <!-- 经验列表 -->
    <el-card class="list-card" shadow="hover">
      <div class="filter-row">
        <el-select v-model="filterAgent" placeholder="全部智能体" clearable style="width: 220px" @change="load">
          <el-option v-for="a in agentOptions" :key="a.value" :label="a.label" :value="a.value" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 160px" @change="load">
          <el-option label="生效中" value="active" />
          <el-option label="观察中" value="watch" />
          <el-option label="已休眠" value="dormant" />
          <el-option label="已废除" value="suppressed" />
        </el-select>
        <span class="count-hint">共 {{ experiences.length }} 条</span>
      </div>

      <el-table :data="experiences" stripe style="width: 100%" empty-text="还没有积累经验。跑几个任务后会自动沉淀。">
        <el-table-column label="经验内容" min-width="320">
          <template #default="{ row }">
            <div class="exp-main">
              <div class="exp-head">
                <el-tag :type="statusTagType(row.status)" size="small" effect="light">{{ statusLabel(row.status) }}</el-tag>
                <el-tag v-if="row.level >= 2" type="warning" size="small" effect="plain">
                  {{ row.level === 3 ? '会被门禁拦截' : '高频约束' }}
                </el-tag>
                <span class="exp-cat">{{ categoryLabel(row.category) }}</span>
              </div>
              <div class="exp-title-text">{{ row.title }}</div>
              <div class="exp-guidance">{{ row.guidance }}</div>
              <div v-if="row.samples && row.samples.length" class="exp-sample">
                真实样例：{{ row.samples[0] }}
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="命中次数" width="110" align="center">
          <template #default="{ row }">
            <el-tooltip :content="`注入前 ${row.occurrencesBefore} 次 / 注入后 ${row.occurrencesAfter} 次`" placement="top">
              <span class="occ">{{ row.occurrencesTotal }}</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column label="效果" width="130" align="center">
          <template #default="{ row }">
            <template v-if="row.effectiveness !== null">
              <el-tag :type="row.effectiveness > 0 ? 'success' : 'danger'" size="small" effect="plain">
                {{ row.effectiveness > 0 ? '下降' : '上升' }} {{ Math.abs(row.effectiveness * 100).toFixed(0) }}%
              </el-tag>
            </template>
            <span v-else class="muted">样本不足</span>
          </template>
        </el-table-column>

        <el-table-column prop="agentId" label="智能体" width="180" show-overflow-tooltip />

        <el-table-column label="最近命中" width="150">
          <template #default="{ row }">
            <span class="time-text">{{ formatDateTime(row.lastSeenAt) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status !== 'suppressed'"
              size="small"
              text
              type="danger"
              @click="suppress(row)"
            >
              废除
            </el-button>
            <el-button v-else size="small" text type="primary" @click="restore(row)">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 进化日志 -->
    <el-card class="log-card" shadow="hover">
      <div class="log-head">
        <strong>进化动作日志</strong>
        <span class="calib-hint">升级 / 休眠 / 降级 / 废除 都有记录，可追溯决策依据</span>
      </div>
      <el-timeline v-if="evolutionLog.length" class="log-timeline">
        <el-timeline-item
          v-for="item in evolutionLog"
          :key="item.id"
          :timestamp="formatDateTime(item.createdAt)"
          :type="logType(item.action)"
          placement="top"
        >
          <div class="log-item">
            <el-tag size="small" effect="plain">{{ actionLabel(item.action) }}</el-tag>
            <span class="log-agent">{{ item.agentId }}</span>
            <span class="log-detail">{{ item.detail }}</span>
          </div>
        </el-timeline-item>
      </el-timeline>
      <div v-else class="calib-empty">还没有进化动作。经验积累到一定量后会自动升级或休眠。</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { experienceApi } from '@/api/index'
import type { AgentExperience, ExperienceStats } from '@/api/index'
import { formatDateTime } from '@/utils/time'
import MsIcon from '@/components/MsIcon.vue'

defineProps<{ embedded?: boolean }>()

const experiences = ref<AgentExperience[]>([])
const evolutionLog = ref<any[]>([])
const stats = ref<ExperienceStats>({
  totals: { all: 0, active: 0, watch: 0, dormant: 0, suppressed: 0, improved: 0, occurrences: 0 },
  byAgent: {},
})
const loading = ref(false)
const evolving = ref(false)

const filterAgent = ref('')
const filterStatus = ref('')

const calib = ref<any>(null)
const calibLoading = ref(false)
const calibApplying = ref(false)

const agentOptions = computed(() => {
  const byAgent = stats.value.byAgent || {}
  return Object.keys(byAgent)
    .sort()
    .map((id) => ({ value: id, label: `${id}（${byAgent[id]?.all ?? 0}）` }))
})

const CATEGORY_LABELS: Record<string, string> = {
  assertion: '预期不可判定',
  placeholder: '输入是占位值',
  duplicate: '用例重复',
  coverage: '覆盖不足',
  format: '格式不合规',
  logic: '与需求矛盾',
  traceability: '跨环节断裂',
  other: '其他',
}

function categoryLabel(c: string) {
  return CATEGORY_LABELS[c] || c || '其他'
}

function statusLabel(s: string) {
  return { active: '生效中', watch: '观察中', dormant: '已休眠', suppressed: '已废除' }[s] || s
}

function statusTagType(s: string): 'success' | 'info' | 'warning' | 'danger' {
  if (s === 'active') return 'success'
  if (s === 'dormant') return 'info'
  if (s === 'suppressed') return 'danger'
  return 'warning'
}

function actionLabel(a: string) {
  return {
    created: '新建', promoted: '升级', demoted: '降级', dormant: '休眠',
    suppressed: '废除', resurrected: '恢复', applied: '应用',
  }[a] || a
}

function logType(a: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  if (a === 'promoted' || a === 'created') return 'success'
  if (a === 'dormant') return 'info'
  if (a === 'suppressed' || a === 'demoted') return 'danger'
  return 'primary'
}

async function load() {
  loading.value = true
  try {
    const [res, log] = await Promise.all([
      experienceApi.list({
        agentId: filterAgent.value || undefined,
        status: filterStatus.value || undefined,
        limit: 200,
      }),
      experienceApi.evolutionLog({ agentId: filterAgent.value || undefined, limit: 30 }),
    ])
    experiences.value = res.experiences
    stats.value = res.stats
    evolutionLog.value = log
  } finally {
    loading.value = false
  }
}

async function loadCalibration() {
  calibLoading.value = true
  try {
    calib.value = await experienceApi.calibrationPreview(90)
  } finally {
    calibLoading.value = false
  }
}

async function applyCalibration() {
  try {
    await ElMessageBox.confirm(
      `将把门禁阈值调整为 ${(calib.value.recommended * 100).toFixed(0)}%。这会立刻影响后续任务的判定。`,
      '采纳校准建议',
      { type: 'warning', confirmButtonText: '采纳', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  calibApplying.value = true
  try {
    const r = await experienceApi.calibrationApply(90)
    if (r.applied) {
      ElMessage.success(r.message)
      await loadCalibration()
    } else {
      ElMessage.info(r.message || '本次无需调整')
    }
  } finally {
    calibApplying.value = false
  }
}

async function runEvolve() {
  evolving.value = true
  try {
    const r = await experienceApi.evolve(filterAgent.value || undefined)
    const changed = r.changes.reduce((s, c) => s + (c.promoted || 0) + (c.dormant || 0) + (c.demoted || 0), 0)
    if (changed) {
      ElMessage.success(`进化完成：${r.changes.map((c) => `${c.agentId} 升级${c.promoted}/休眠${c.dormant}/降级${c.demoted}`).join('；')}`)
    } else {
      ElMessage.info('本次没有可调整的经验（样本不足或都在最优状态）')
    }
    await load()
  } finally {
    evolving.value = false
  }
}

async function suppress(row: AgentExperience) {
  let reason = ''
  try {
    const r = await ElMessageBox.prompt(
      `废除后这条经验不再注入提示词，也不会再统计效果。\n\n${row.title}`,
      '废除这条经验',
      { type: 'warning', confirmButtonText: '废除', cancelButtonText: '取消', inputPlaceholder: '废除原因（建议填写，便于以后复盘）' },
    )
    reason = r.value || ''
  } catch {
    return
  }
  const res = await experienceApi.setStatus(row.id, 'suppressed', reason)
  if (res.ok) {
    ElMessage.success(res.message)
    await load()
  } else {
    ElMessage.error(res.message)
  }
}

async function restore(row: AgentExperience) {
  const res = await experienceApi.setStatus(row.id, 'active', '人工恢复')
  if (res.ok) {
    ElMessage.success(res.message)
    await load()
  } else {
    ElMessage.error(res.message)
  }
}

onMounted(load)
</script>

<style scoped>
.experience-view {
  padding: 20px;
  max-width: 1400px;
}

.exp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.exp-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.exp-subtitle {
  margin: 0;
  max-width: 780px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 统计卡片沿用 StatsView 的写法，保持两个 tab 视觉一致 */
.overview-card {
  background: linear-gradient(135deg, #f5f7fa 0%, #fff 100%);
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-item {
  text-align: center;
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
}

.stat-item .stat-value {
  font-size: 32px;
  font-weight: bold;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.stat-item.success .stat-value { color: var(--el-color-success); }
.stat-item.warning .stat-value { color: var(--el-color-warning); }
.stat-item.danger .stat-value { color: var(--el-color-danger); }
.stat-item.primary .stat-value { color: var(--el-color-primary); }

.stat-label {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.calib-card,
.list-card,
.log-card {
  margin-bottom: 16px;
}

.calib-head,
.log-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.calib-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  font-weight: normal;
}

.calib-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.calib-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.calib-kv {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.calib-msg {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-color-success);
}

.calib-msg.warn {
  color: var(--el-color-warning);
}

.calib-history {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.history-label { margin-right: 6px; }
.history-item { margin-right: 12px; }
.history-item em { font-style: normal; color: var(--el-text-color-placeholder); }

.calib-empty {
  margin-top: 10px;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.count-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.exp-main { padding: 4px 0; }

.exp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.exp-cat {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.exp-title-text {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--el-text-color-primary);
}

.exp-guidance {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.exp-sample {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.occ { font-weight: 600; }
.time-text { font-size: 12px; color: var(--el-text-color-regular); }
.muted { font-size: 12px; color: var(--el-text-color-placeholder); }

.log-timeline {
  margin-top: 14px;
  padding-left: 4px;
  max-height: 420px;
  overflow: auto;
}

.log-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.log-agent {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.log-detail {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}
</style>
