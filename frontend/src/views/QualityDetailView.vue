<template>
  <div class="quality-detail-view" v-loading="loading">
    <!-- 顶部：返回 + 标题 -->
    <el-card shadow="never" class="header-card">
      <div class="toolbar">
        <el-button @click="goBack" :icon="ArrowLeft">返回统计概览</el-button>
        <span class="page-title">🎯 质量评估明细</span>
        <el-button type="primary" :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </el-card>

    <!-- 概览卡片 -->
    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :span="5">
        <el-card shadow="hover">
          <div class="stat-label">评估总数</div>
          <div class="stat-value">{{ overview.total }}</div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card shadow="hover">
          <div class="stat-label">综合均分</div>
          <div class="stat-value" :class="scoreClass(overview.avgScore)">
            {{ formatNum(overview.avgScore, 1) }}
          </div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card shadow="hover">
          <div class="stat-label">达标率（≥6 分）</div>
          <div class="stat-value" :class="overview.passRate >= 60 ? 'success' : overview.passRate >= 40 ? 'warning' : 'danger'">
            {{ overview.passRate }}%
          </div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card shadow="hover">
          <div class="stat-label">交付物均分</div>
          <div class="stat-value">{{ formatNum(overview.avgDeliverableScore, 1) }}<span class="unit">/10</span></div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover">
          <div class="stat-label">交付物总数</div>
          <div class="stat-value">{{ overview.deliverableTotal }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Tab 切换 -->
    <el-card shadow="never" style="margin-top: 20px">
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <!-- Tab1: 任务维度 -->
        <el-tab-pane label="📊 任务维度" name="task">
          <!-- 筛选栏 -->
          <el-form inline style="margin-bottom: 12px">
            <el-form-item label="智能体">
              <el-select v-model="filters.agentId" clearable placeholder="全部" style="width: 180px" @change="loadReports">
                <el-option v-for="a in agentOptions" :key="a.value" :label="a.label" :value="a.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="评估类型">
              <el-select v-model="filters.scope" clearable placeholder="全部" style="width: 140px" @change="loadReports">
                <el-option label="任务级" value="task" />
                <el-option label="智能体级" value="agent" />
              </el-select>
            </el-form-item>
            <el-form-item label="分数范围">
              <el-input-number v-model="filters.minScore" :min="0" :max="10" :step="0.5" placeholder="最低分" style="width: 110px" @change="loadReports" />
              <span style="margin: 0 6px">~</span>
              <el-input-number v-model="filters.maxScore" :min="0" :max="10" :step="0.5" placeholder="最高分" style="width: 110px" @change="loadReports" />
            </el-form-item>
          </el-form>

          <!-- 任务维度表格 -->
          <el-table :data="filteredReports" stripe border max-height="500">
            <el-table-column prop="timestamp" label="评估时间" width="170" sortable />
            <el-table-column prop="agentId" label="智能体" width="200" />
            <el-table-column prop="taskType" label="任务类型" width="140" />
            <el-table-column label="综合均分" width="100" sortable :sort-method="(a: any, b: any) => (a.overall?.score||0) - (b.overall?.score||0)">
              <template #default="{ row }">
                <span :class="scoreClass(row.overall?.score)">{{ formatNum(row.overall?.score, 1) || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="能力层" width="90">
              <template #default="{ row }">{{ formatNum(row.layers?.capability?.score) }}</template>
            </el-table-column>
            <el-table-column label="质量层" width="90">
              <template #default="{ row }">{{ formatNum(row.layers?.quality?.score) }}</template>
            </el-table-column>
            <el-table-column label="业务层" width="90">
              <template #default="{ row }">{{ formatNum(row.layers?.business?.score) }}</template>
            </el-table-column>
            <el-table-column label="交付物评分" width="100">
              <template #default="{ row }">
                <span v-if="row.deliverable_score != null" :class="scoreClass(row.deliverable_score)">
                  {{ formatNum(row.deliverable_score, 1) }}
                </span>
                <span v-else style="color: #999">-</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="viewReport(row)">详情</el-button>
                <el-button v-if="row.taskId" size="small" type="primary" link @click="goTask(row.taskId)">任务</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- Tab2: 交付物维度 -->
        <el-tab-pane label="📦 交付物维度" name="deliverable">
          <!-- 筛选栏 -->
          <el-form inline style="margin-bottom: 12px">
            <el-form-item label="智能体">
              <el-select v-model="dlFilters.agentId" clearable placeholder="全部" style="width: 180px" @change="loadDeliverables">
                <el-option v-for="a in dlAgentOptions" :key="a.value" :label="a.label" :value="a.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="任务状态">
              <el-select v-model="dlFilters.taskStatus" clearable placeholder="全部" style="width: 130px" @change="loadDeliverables">
                <el-option label="已完成" value="completed" />
                <el-option label="失败" value="failed" />
                <el-option label="执行中" value="running" />
              </el-select>
            </el-form-item>
            <el-form-item label="交付物评分">
              <el-input-number v-model="dlFilters.minScore" :min="0" :max="10" :step="0.5" placeholder="最低分" style="width: 110px" @change="loadDeliverables" />
              <span style="margin: 0 6px">~</span>
              <el-input-number v-model="dlFilters.maxScore" :min="0" :max="10" :step="0.5" placeholder="最高分" style="width: 110px" @change="loadDeliverables" />
            </el-form-item>
          </el-form>

          <!-- 交付物维度表格 -->
          <el-table :data="filteredDeliverables" stripe border max-height="500">
            <el-table-column prop="deliverable.createdAt" label="创建时间" width="170" sortable />
            <el-table-column prop="deliverable.name" label="交付物名称" min-width="200" show-overflow-tooltip />
            <el-table-column prop="agentId" label="智能体" width="160" />
            <el-table-column prop="deliverable.type" label="类型" width="80">
              <template #default="{ row }">
                <el-tag size="small">{{ row.deliverable.type || '-' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="交付物评分" width="110" sortable :sort-method="(a: any, b: any) => (a.deliverableScore||0) - (b.deliverableScore||0)">
              <template #default="{ row }">
                <span v-if="row.deliverableScore != null" :class="scoreClass(row.deliverableScore)">
                  {{ formatNum(row.deliverableScore, 1) }}
                </span>
                <span v-else style="color: #999">-</span>
              </template>
            </el-table-column>
            <el-table-column label="综合评分" width="100">
              <template #default="{ row }">
                <span v-if="row.overallScore != null">{{ formatNum(row.overallScore, 1) }}</span>
                <span v-else style="color: #999">-</span>
              </template>
            </el-table-column>
            <el-table-column label="审核结果" width="140">
              <template #default="{ row }">
                <template v-if="row.reviewSummary.total > 0">
                  <span :class="row.reviewSummary.vetoCount > 0 ? 'danger' : row.reviewSummary.passed === row.reviewSummary.total ? 'success' : 'warning'">
                    通过 {{ row.reviewSummary.passed }}/{{ row.reviewSummary.total }}
                  </span>
                  <el-tag v-if="row.reviewSummary.vetoCount > 0" type="danger" size="small" style="margin-left: 4px">
                    否决 {{ row.reviewSummary.vetoCount }}
                  </el-tag>
                </template>
                <span v-else style="color: #999">暂无审核</span>
              </template>
            </el-table-column>
            <el-table-column label="预估工时(h)" width="110">
              <template #default="{ row }">
                {{ row.deliverable.manualHours != null ? formatNum(row.deliverable.manualHours, 1) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="节省成本(¥)" width="110">
              <template #default="{ row }">
                {{ row.deliverable.savedCost != null ? formatMoney(row.deliverable.savedCost) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="viewDeliverable(row)">详情</el-button>
                <el-button size="small" type="primary" link @click="goTask(row.taskId)">任务</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 评估详情弹窗 -->
    <el-dialog v-model="detailVisible" title="评估报告详情" width="800px" :close-on-click-modal="false">
      <div v-if="selectedReport" class="report-detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="智能体">{{ selectedReport.agentId }}</el-descriptions-item>
          <el-descriptions-item label="任务 ID">{{ selectedReport.taskId || '-' }}</el-descriptions-item>
          <el-descriptions-item label="任务类型">{{ selectedReport.taskType || '-' }}</el-descriptions-item>
          <el-descriptions-item label="评估时间">{{ selectedReport.timestamp }}</el-descriptions-item>
          <el-descriptions-item label="综合评分">
            <span :class="scoreClass(selectedReport.overall?.score)">
              {{ formatNum(selectedReport.overall?.score, 1) || '-' }}
              <span v-if="selectedReport.overall?.grade">({{ selectedReport.overall.grade }})</span>
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="等级">Lv.{{ selectedReport.overall?.level ?? '-' }}</el-descriptions-item>
        </el-descriptions>

        <h4 style="margin-top: 20px">📊 三层评分</h4>
        <el-table :data="layerRows" border size="small">
          <el-table-column prop="layer" label="层级" width="100" />
          <el-table-column prop="score" label="分数" width="120">
            <template #default="{ row }">
              <span :class="scoreClass(row.score)">{{ formatNum(row.score, 1) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="trend" label="趋势" width="100">
            <template #default="{ row }">
              <span v-if="row.delta !== null && row.delta !== undefined">
                <el-icon v-if="row.delta > 0" color="#67C23A"><Top /></el-icon>
                <el-icon v-else-if="row.delta < 0" color="#F56C6C"><Bottom /></el-icon>
                {{ row.delta > 0 ? '+' : '' }}{{ Number(row.delta).toFixed(2) }}
              </span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="指标明细">
            <template #default="{ row }">
              <div v-for="m in row.metrics" :key="m.name" class="metric-row">
                <span>{{ m.name }}: <strong :class="scoreClass(m.value)">{{ formatNum(m.value, 1) }}</strong></span>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="selectedReport.recommendations?.length" style="margin-top: 20px">
          <h4>💡 改进建议</h4>
          <ul>
            <li v-for="(r, i) in selectedReport.recommendations" :key="i">{{ r }}</li>
          </ul>
        </div>
      </div>
    </el-dialog>

    <!-- 交付物详情弹窗 -->
    <el-dialog v-model="dlDetailVisible" title="交付物详情" width="700px" :close-on-click-modal="false">
      <div v-if="selectedDeliverable">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="交付物名称">{{ selectedDeliverable.deliverable.name }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ selectedDeliverable.deliverable.type || '-' }}</el-descriptions-item>
          <el-descriptions-item label="智能体">{{ selectedDeliverable.agentId }}</el-descriptions-item>
          <el-descriptions-item label="任务ID">{{ selectedDeliverable.taskId }}</el-descriptions-item>
          <el-descriptions-item label="任务状态">
            <el-tag :type="selectedDeliverable.taskStatus === 'completed' ? 'success' : selectedDeliverable.taskStatus === 'failed' ? 'danger' : 'warning'" size="small">
              {{ selectedDeliverable.taskStatus }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ selectedDeliverable.deliverable.createdAt }}</el-descriptions-item>
        </el-descriptions>

        <h4 style="margin-top: 20px">📦 质量评分</h4>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="交付物评分">
            <span :class="scoreClass(selectedDeliverable.deliverableScore)" style="font-size: 18px; font-weight: 600">
              {{ selectedDeliverable.deliverableScore != null ? formatNum(selectedDeliverable.deliverableScore, 1) : '-' }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="综合评分">
            {{ selectedDeliverable.overallScore != null ? formatNum(selectedDeliverable.overallScore, 1) : '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 style="margin-top: 20px">🔍 审核结果</h4>
        <el-table v-if="selectedDeliverable.reviewDetails?.length" :data="selectedDeliverable.reviewDetails" border size="small">
          <el-table-column prop="reviewerName" label="审核智能体" width="160" />
          <el-table-column label="评分" width="80">
            <template #default="{ row }">
              <span :class="scoreClass(row.score)">{{ row.score }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.veto ? 'danger' : row.passed ? 'success' : 'warning'" size="small">
                {{ row.veto ? '一票否决' : row.passed ? '通过' : '未通过' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="output" label="审核意见" show-overflow-tooltip />
        </el-table>
        <el-empty v-else description="暂无审核记录" :image-size="60" />

        <h4 style="margin-top: 20px">💰 成本数据</h4>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="预估工时">{{ selectedDeliverable.deliverable.manualHours != null ? formatNum(selectedDeliverable.deliverable.manualHours, 1) + 'h' : '-' }}</el-descriptions-item>
          <el-descriptions-item label="人工成本">¥{{ selectedDeliverable.deliverable.laborCost != null ? formatMoney(selectedDeliverable.deliverable.laborCost) : '-' }}</el-descriptions-item>
          <el-descriptions-item label="实际成本">¥{{ selectedDeliverable.deliverable.actualCost != null ? formatMoney(selectedDeliverable.deliverable.actualCost) : '-' }}</el-descriptions-item>
          <el-descriptions-item label="节省成本">¥{{ selectedDeliverable.deliverable.savedCost != null ? formatMoney(selectedDeliverable.deliverable.savedCost) : '-' }}</el-descriptions-item>
          <el-descriptions-item label="输入Token">{{ selectedDeliverable.deliverable.inputTokens != null ? formatNum(selectedDeliverable.deliverable.inputTokens) : '-' }}</el-descriptions-item>
          <el-descriptions-item label="输出Token">{{ selectedDeliverable.deliverable.outputTokens != null ? formatNum(selectedDeliverable.deliverable.outputTokens) : '-' }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Refresh, Top, Bottom } from '@element-plus/icons-vue'
import { request } from '@/api'
import { ElMessage } from 'element-plus'

const router = useRouter()

// 状态
const loading = ref(false)
const activeTab = ref('task')

// 任务维度数据
const reports = ref<any[]>([])
const filters = ref({
  agentId: '',
  scope: '',
  minScore: null as number | null,
  maxScore: null as number | null
})

// 交付物维度数据
const deliverables = ref<any[]>([])
const dlFilters = ref({
  agentId: '',
  taskStatus: '',
  minScore: null as number | null,
  maxScore: null as number | null
})

// 弹窗
const detailVisible = ref(false)
const selectedReport = ref<any>(null)
const dlDetailVisible = ref(false)
const selectedDeliverable = ref<any>(null)

// 智能体选项
const agentOptions = computed(() => {
  const set = new Map<string, string>()
  reports.value.forEach(r => { if (r.agentId) set.set(r.agentId, r.agentId) })
  return Array.from(set, ([value, label]) => ({ value, label }))
})

const dlAgentOptions = computed(() => {
  const set = new Map<string, string>()
  deliverables.value.forEach(d => { if (d.agentId) set.set(d.agentId, d.agentId) })
  return Array.from(set, ([value, label]) => ({ value, label }))
})

// 过滤后的报告
const filteredReports = computed(() => {
  return reports.value.filter(r => {
    if (filters.value.minScore !== null && (r.overall?.score || 0) < filters.value.minScore) return false
    if (filters.value.maxScore !== null && (r.overall?.score || 0) > filters.value.maxScore) return false
    return true
  })
})

// 过滤后的交付物
const filteredDeliverables = computed(() => {
  return deliverables.value.filter(d => {
    if (dlFilters.value.minScore !== null && (d.deliverableScore || 0) < dlFilters.value.minScore) return false
    if (dlFilters.value.maxScore !== null && (d.deliverableScore || 0) > dlFilters.value.maxScore) return false
    return true
  })
})

// 概览统计
const overview = computed(() => {
  const list = filteredReports.value
  const total = list.length
  if (total === 0) return { total: 0, avgScore: 0, passRate: 0, avgDeliverableScore: 0, deliverableTotal: 0 }
  const scores = list.map(r => r.overall?.score || 0).filter(s => s > 0)
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const passCount = list.filter(r => (r.overall?.score || 0) >= 6).length
  const passRate = Math.round((passCount / total) * 100)
  const deliverableScores = list.map((r: any) => r.deliverable_score).filter((s: any) => typeof s === 'number' && s > 0)
  const avgDeliverableScore = deliverableScores.length
    ? deliverableScores.reduce((a: number, b: number) => a + b, 0) / deliverableScores.length
    : 0
  return { total, avgScore, passRate, avgDeliverableScore, deliverableTotal: deliverables.value.length }
})

// 三层评分明细行
const layerRows = computed(() => {
  if (!selectedReport.value) return []
  const r = selectedReport.value
  const mk = (layer: string, score: number, metrics: any[], delta: number | null) => ({
    layer,
    score,
    metrics: metrics || [],
    delta
  })
  return [
    mk('能力层', r.layers?.capability?.score || 0, r.layers?.capability?.metrics || [], r.trends?.capability?.delta ?? null),
    mk('质量层', r.layers?.quality?.score || 0, r.layers?.quality?.metrics || [], r.trends?.quality?.delta ?? null),
    mk('业务层', r.layers?.business?.score || 0, r.layers?.business?.metrics || [], r.trends?.business?.delta ?? null)
  ]
})

// 工具函数
function formatNum(v: any, decimals = 0): string {
  if (v == null || v === '') return '-'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return '-'
  return decimals > 0 ? n.toFixed(decimals) : String(Math.round(n))
}

function formatMoney(v: any): string {
  if (v == null) return '-'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return '-'
  return n.toFixed(2)
}

function scoreClass(score: number | null | undefined): string {
  if (score == null) return ''
  if (score >= 7) return 'success'
  if (score >= 5) return 'warning'
  return 'danger'
}

// 加载数据
async function loadReports() {
  loading.value = true
  try {
    const params: any = { limit: 500 }
    if (filters.value.agentId) params.agentId = filters.value.agentId
    const res = await request<any>(`/api/evaluation/reports?${new URLSearchParams(params as any).toString()}`)
    const inner = (res as any)?.data
    const arr = Array.isArray(inner?.data) ? inner.data : Array.isArray(inner) ? inner : []
    reports.value = arr
    if (filters.value.scope) {
      const wantScope = filters.value.scope
      reports.value = reports.value.filter((r: any) => {
        if (wantScope === 'task') return r.taskId && r.taskType
        if (wantScope === 'agent') return !r.taskId
        return true
      })
    }
  } catch (e: any) {
    ElMessage.error('加载评估报告失败：' + (e?.message || '未知错误'))
    reports.value = []
  } finally {
    loading.value = false
  }
}

async function loadDeliverables() {
  loading.value = true
  try {
    const params: any = { limit: 200 }
    const res = await request<any>(`/api/evaluation/deliverables?${new URLSearchParams(params as any).toString()}`)
    const inner = (res as any)?.data
    deliverables.value = Array.isArray(inner?.data) ? inner.data : Array.isArray(inner) ? inner : []
  } catch (e: any) {
    ElMessage.error('加载交付物数据失败：' + (e?.message || '未知错误'))
    deliverables.value = []
  } finally {
    loading.value = false
  }
}

async function loadAll() {
  await Promise.all([loadReports(), loadDeliverables()])
}

function onTabChange(tabName: string) {
  if (tabName === 'deliverable' && deliverables.value.length === 0) {
    loadDeliverables()
  }
}

function viewReport(row: any) {
  selectedReport.value = row
  detailVisible.value = true
}

function viewDeliverable(row: any) {
  selectedDeliverable.value = row
  dlDetailVisible.value = true
}

function goTask(taskId: string) {
  router.push(`/tasks?keyword=${encodeURIComponent(taskId)}`)
}

function goBack() {
  router.push('/stats')
}

onMounted(() => {
  loadReports()
})
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; }
.page-title { font-size: 18px; font-weight: 600; flex: 1; }
.stat-label { color: #909399; font-size: 14px; }
.stat-value { font-size: 28px; font-weight: 600; color: #303133; margin-top: 8px; }
.stat-value .unit { font-size: 14px; color: #909399; margin-left: 4px; }
.success { color: #67C23A; }
.warning { color: #E6A23C; }
.danger { color: #F56C6C; }
.metric-row { padding: 2px 0; font-size: 13px; }
.report-detail { font-size: 14px; }
</style>
