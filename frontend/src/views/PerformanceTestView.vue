<template>
  <div class="perf-test-view">
    <!-- 头部 -->
    <div class="view-header">
      <div>
        <h2 class="view-title">📈 性能测试</h2>
        <p class="view-subtitle">负载测试 · 压力测试 · 瓶颈分析 · SLA 评估</p>
      </div>
      <div class="header-actions">
        <el-button @click="loadStats" :icon="Refresh" circle />
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="12" class="stat-cards">
      <el-col :span="6">
        <div class="stat-card" :class="{ 'stat-card--active': stats.totalReports > 0 }">
          <div class="stat-icon">📋</div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.totalReports }}</div>
            <div class="stat-label">测试报告</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card" :class="{ 'stat-card--danger': stats.openFindings > 0 }">
          <div class="stat-icon">⚠️</div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.openFindings }}</div>
            <div class="stat-label">待处理瓶颈</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-info">
            <div class="stat-value">{{ Number(stats.avgScore || 0).toFixed(1) }}</div>
            <div class="stat-label">平均性能评分</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card stat-card--severity">
          <div class="severity-bars">
            <div v-for="sev in ['critical','high','medium','low']" :key="sev" class="sev-row">
              <span class="sev-dot" :class="`sev-dot--${sev}`"></span>
              <span class="sev-label">{{ sevMap[sev] }}</span>
              <span class="sev-count">{{ stats.severityDist?.[sev] || 0 }}</span>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 报告 & 瓶颈 Tab -->
    <el-card class="main-card">
      <el-tabs v-model="activeTab">
        <!-- 报告列表 -->
        <el-tab-pane label="🚀 测试执行" name="execute">
          <PerfTestExecutor />
        </el-tab-pane>

        <el-tab-pane label="📋 测试报告" name="reports">
          <!-- 工具栏 -->
          <div class="toolbar">
            <div class="toolbar-filters">
              <el-select v-model="filterStatus" placeholder="状态" clearable style="width:120px" @change="loadReports">
                <el-option label="全部" value="" />
                <el-option label="进行中" value="running" />
                <el-option label="已完成" value="completed" />
                <el-option label="失败" value="failed" />
              </el-select>
            </div>
          </div>

          <!-- 报告表格 -->
          <el-table :data="reports" v-loading="loadingReports" stripe class="report-table">
            <el-table-column prop="test_id" label="报告ID" width="240" show-overflow-tooltip />
            <el-table-column prop="target" label="被测目标" min-width="200" show-overflow-tooltip />
            <el-table-column prop="test_type" label="测试类型" width="100">
              <template #default="{ row }">
                <el-tag :type="testTypeMap[row.test_type] || 'info'" size="small">{{ testTypeMap[row.test_type] || row.test_type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="tool" label="工具" width="90">
              <template #default="{ row }">{{ row.tool || 'N/A' }}</template>
            </el-table-column>
            <el-table-column prop="overall_score" label="评分" width="80" align="center">
              <template #default="{ row }">
                <span v-if="row.overall_score != null" :class="scoreClass(row.overall_score)">{{ row.overall_score }}</span>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="grade" label="等级" width="80" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.grade" :type="gradeType(row.grade)" size="small">{{ row.grade }}</el-tag>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="sla_pass" label="SLA" width="70" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.sla_pass != null" :type="row.sla_pass ? 'success' : 'danger'" size="small">
                  {{ row.sla_pass ? '通过' : '未达标' }}
                </el-tag>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="开始时间" width="160">
              <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="viewReport(row)">详情</el-button>
                <el-button link type="primary" size="small" @click="downloadMd(row)">下载</el-button>
                <el-button link type="danger" size="small" @click="deleteReport(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 分页 -->
          <div class="pagination-wrap" v-if="totalReports > pageSize">
            <el-pagination
              v-model:current-page="page"
              :page-size="pageSize"
              :total="totalReports"
              layout="prev, pager, next"
              @current-change="loadReports"
            />
          </div>
        </el-tab-pane>

        <!-- 瓶颈列表 -->
        <el-tab-pane label="⚠️ 瓶颈分析" name="findings">
          <div class="toolbar">
            <el-select v-model="findingSeverity" placeholder="严重级别" clearable style="width:120px" @change="loadFindings">
              <el-option label="全部" value="" />
              <el-option label="Critical" value="critical" />
              <el-option label="High" value="high" />
              <el-option label="Medium" value="medium" />
              <el-option label="Low" value="low" />
            </el-select>
          </div>
          <el-table :data="findings" v-loading="loadingFindings" stripe>
            <el-table-column prop="severity" label="严重级" width="100">
              <template #default="{ row }">
                <el-tag :type="sevType(row.severity)" size="small">{{ row.severity }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="问题标题" min-width="200" />
            <el-table-column prop="finding_type" label="类型" width="120">
              <template #default="{ row }">{{ findingTypeMap[row.finding_type] || row.finding_type }}</template>
            </el-table-column>
            <el-table-column prop="metric_detail" label="指标" width="140" show-overflow-tooltip />
            <el-table-column prop="actual_value" label="实测值" width="120" />
            <el-table-column prop="threshold" label="阈值" width="120" />
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'fixed' ? 'success' : row.status === 'accepted' ? 'warning' : 'info'" size="small">
                  {{ findingStatusMap[row.status] || row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-select v-if="row.status === 'open'" v-model="row.newStatus" size="small" placeholder="处理" @change="handleFindingStatus(row, $event)">
                  <el-option label="已修复" value="fixed" />
                  <el-option label="已接受" value="accepted" />
                </el-select>
                <span v-else class="text-muted">{{ findingStatusMap[row.status] }}</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap" v-if="totalFindings > pageSize">
            <el-pagination v-model:current-page="findingPage" :page-size="pageSize" :total="totalFindings"
              layout="prev, pager, next" @current-change="loadFindings" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 报告详情抽屉 -->
    <el-drawer v-model="detailDrawerVisible" title="测试报告详情" size="640px" direction="rtl">
      <div v-if="selectedReport" class="report-detail">
        <div class="detail-meta">
          <div class="meta-row"><span class="meta-label">报告ID</span><span class="meta-value">{{ selectedReport.test_id }}</span></div>
          <div class="meta-row"><span class="meta-label">被测目标</span><span class="meta-value">{{ selectedReport.target }}</span></div>
          <div class="meta-row"><span class="meta-label">测试类型</span><el-tag size="small">{{ testTypeMap[selectedReport.test_type] }}</el-tag></div>
          <div class="meta-row"><span class="meta-label">压测工具</span><span class="meta-value">{{ selectedReport.tool || 'N/A' }}</span></div>
          <div class="meta-row"><span class="meta-label">评分</span><span :class="scoreClass(selectedReport.overall_score)">{{ selectedReport.overall_score ?? '—' }}</span></div>
          <div class="meta-row"><span class="meta-label">等级</span><el-tag v-if="selectedReport.grade" :type="gradeType(selectedReport.grade)" size="small">{{ selectedReport.grade }}</el-tag><span v-else>—</span></div>
          <div class="meta-row"><span class="meta-label">SLA</span>
            <el-tag v-if="selectedReport.sla_pass != null" :type="selectedReport.sla_pass ? 'success' : 'danger'" size="small">
              {{ selectedReport.sla_pass ? '通过' : '未达标' }}
            </el-tag>
          </div>
          <div class="meta-row"><span class="meta-label">状态</span><el-tag :type="statusType(selectedReport.status)" size="small">{{ statusLabel(selectedReport.status) }}</el-tag></div>
          <div class="meta-row"><span class="meta-label">开始时间</span><span class="meta-value">{{ fmtTime(selectedReport.created_at) }}</span></div>
          <div class="meta-row" v-if="selectedReport.duration_ms"><span class="meta-label">耗时</span><span class="meta-value">{{ (selectedReport.duration_ms/60000).toFixed(1) }}分钟</span></div>
        </div>

        <!-- 性能指标 -->
        <div v-if="selectedReport.metrics_summary" class="metrics-grid">
          <div class="metric-card">
            <div class="metric-value">{{ selectedReport.metrics_summary.tps ?? '—' }}</div>
            <div class="metric-label">TPS</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ selectedReport.metrics_summary.avg_rt ?? selectedReport.metrics_summary.avgRt ?? '—' }}</div>
            <div class="metric-label">平均RT(ms)</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ selectedReport.metrics_summary.p95_rt ?? selectedReport.metrics_summary.p95Rt ?? '—' }}</div>
            <div class="metric-label">P95 RT(ms)</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ selectedReport.metrics_summary.p99_rt ?? selectedReport.metrics_summary.p99Rt ?? '—' }}</div>
            <div class="metric-label">P99 RT(ms)</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ selectedReport.metrics_summary.error_rate ?? selectedReport.metrics_summary.errorRate ?? '—' }}%</div>
            <div class="metric-label">错误率</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ selectedReport.metrics_summary.cpu ?? '—' }}</div>
            <div class="metric-label">CPU%</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ selectedReport.metrics_summary.memory ?? '—' }}</div>
            <div class="metric-label">内存%</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ selectedReport.findings?.length ?? 0 }}</div>
            <div class="metric-label">瓶颈数</div>
          </div>
        </div>

        <!-- 瓶颈列表 -->
        <div v-if="reportFindings.length" class="findings-section">
          <h4>瓶颈分析</h4>
          <div v-for="f in reportFindings" :key="f.id" class="finding-item" :class="`finding-item--${f.severity}`">
            <div class="finding-header">
              <el-tag :type="sevType(f.severity)" size="small">{{ f.severity }}</el-tag>
              <span class="finding-title">{{ f.title }}</span>
            </div>
            <div class="finding-body">{{ f.description }}</div>
            <div class="finding-remediation">修复建议：{{ f.remediation }}</div>
          </div>
        </div>

        <div class="detail-actions">
          <el-button type="primary" @click="downloadMd(selectedReport)">下载 Markdown</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { performanceTestApi } from '@/api/index'
import PerfTestExecutor from '@/components/PerfTestExecutor.vue'

// 状态
const activeTab = ref('execute')
const loadingReports = ref(false)
const loadingFindings = ref(false)
const detailDrawerVisible = ref(false)

// 列表数据
const reports = ref<Record<string, any>[]>([])
const totalReports = ref(0)
const findings = ref<Record<string, any>[]>([])
const totalFindings = ref(0)
const reportFindings = ref<Record<string, any>[]>([])
const selectedReport = ref<Record<string, any> | null>(null)

// 分页
const page = ref(1)
const findingPage = ref(1)
const pageSize = 20

// 过滤
const filterStatus = ref('')
const findingSeverity = ref('')

// 统计
const stats = reactive({
  totalReports: 0,
  openFindings: 0,
  avgScore: null as number | null,
  severityDist: {} as Record<string, number>,
})

// 映射
const sevMap: Record<string, string> = { critical: '致命', high: '高', medium: '中', low: '低', info: '提示' }
const testTypeMap: Record<string, string> = { load: '负载', stress: '压力', stability: '稳定', concurrency: '并发', workflow: '工作流' }
const findingTypeMap: Record<string, string> = { response_time: '响应时间', throughput: '吞吐量', resource: '资源', stability: '稳定性', error_rate: '错误率' }
const findingStatusMap: Record<string, string> = { open: '待处理', fixed: '已修复', accepted: '已接受' }

const sevType = (s: string) => ({ critical: 'danger', high: 'danger', medium: 'warning', low: 'info', info: 'info' }[s] || 'info')
const statusType = (s: string) => ({ running: 'primary', completed: 'success', failed: 'danger' }[s] || 'info')
const statusLabel = (s: string) => ({ running: '进行中', completed: '已完成', failed: '失败' }[s] || s)
const scoreClass = (score: number | null) => score == null ? '' : score >= 90 ? 'score-high' : score >= 80 ? 'score-mid' : 'score-low'
const gradeType = (g: string) => ({ 优秀: 'success', 良好: 'primary', 合格: 'warning', 不达标: 'danger' }[g] || 'info')

const fmtTime = (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '—'

// 加载统计
async function loadStats() {
  const data = await performanceTestApi.getStats()
  if (!data) return
  stats.totalReports = data.totalReports || 0
  stats.openFindings = data.openFindings || 0
  stats.avgScore = data.avgScore ?? null
  stats.severityDist = (data.severityDist && typeof data.severityDist === 'object') ? data.severityDist as Record<string, number> : {}
}

// 加载报告列表
async function loadReports() {
  loadingReports.value = true
  try {
    console.log('[PerfDebug] loadReports filterStatus:', filterStatus.value)
    const res = await performanceTestApi.getReports({ status: filterStatus.value || undefined, limit: pageSize, offset: (page.value - 1) * pageSize })
    console.log('[PerfDebug] getReports result:', JSON.stringify(res)?.slice(0, 300))
    if (res) {
      reports.value = res.reports as Record<string, any>[]
      totalReports.value = res.total
      console.log('[PerfDebug] reports count:', reports.value.length, 'total:', res.total)
    } else {
      console.warn('[PerfDebug] getReports returned null')
    }
  } catch(e: any) {
    console.error('[PerfDebug] loadReports error:', e.message, e.stack)
  } finally {
    loadingReports.value = false
  }
}

// 加载瓶颈列表
async function loadFindings() {
  loadingFindings.value = true
  try {
    const res = await performanceTestApi.getFindings({
      severity: findingSeverity.value || undefined,
      limit: pageSize,
      offset: (findingPage.value - 1) * pageSize,
    })
    if (res) {
      findings.value = res.findings as Record<string, any>[]
      totalFindings.value = res.total
    }
  } finally {
    loadingFindings.value = false
  }
}

// 查看报告详情
async function viewReport(row: Record<string, any>) {
  selectedReport.value = row
  const data = await performanceTestApi.getReport(row.id as number)
  if (data) {
    selectedReport.value = { ...row, ...data }
    reportFindings.value = (data.findings as Record<string, any>[]) || []
  } else {
    reportFindings.value = []
  }
  detailDrawerVisible.value = true
}

// 下载 Markdown
async function downloadMd(row: Record<string, any>) {
  try {
    await performanceTestApi.downloadReportMd(row.id as number)
  } catch {
    ElMessage.error('下载失败')
  }
}

// 删除报告
async function deleteReport(row: Record<string, any>) {
  try {
    await ElMessageBox.confirm('确认删除此报告？', '提示', { type: 'warning' })
    const ok = await performanceTestApi.deleteReport(row.id as number)
    if (ok) {
      ElMessage.success('已删除')
      loadReports()
      loadStats()
    }
  } catch { /* cancel */ }
}

// 瓶颈状态更新
async function handleFindingStatus(row: Record<string, any>, status: string) {
  const ok = await performanceTestApi.updateFinding(row.id as number, { status })
  if (ok) {
    row.status = status
    ElMessage.success(`已标记为${findingStatusMap[status]}`)
    loadFindings()
    loadStats()
  }
}

onMounted(() => {
  loadReports()
  loadFindings()
  loadStats()
})
</script>

<style scoped>
.perf-test-view { padding: 20px; }
.view-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.view-title { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.view-subtitle { color: #909399; font-size: 13px; margin: 0; }
.stat-cards { margin-bottom: 16px; }
.stat-card { background: #fff; border-radius: 8px; padding: 16px; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.stat-card--active { border-left: 3px solid #409eff; }
.stat-card--danger { border-left: 3px solid #f56c6c; }
.stat-icon { font-size: 24px; }
.stat-value { font-size: 22px; font-weight: 700; color: #303133; }
.stat-label { font-size: 12px; color: #909399; }
.stat-card--severity { flex: 1; }
.severity-bars { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.sev-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.sev-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sev-dot--critical { background: #f56c6c; }
.sev-dot--high { background: #e6a23c; }
.sev-dot--medium { background: #e6a23c; }
.sev-dot--low { background: #909399; }
.sev-label { color: #606266; flex: 1; }
.sev-count { font-weight: 600; color: #303133; }
.main-card { border-radius: 8px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; }
.toolbar-filters { display: flex; gap: 8px; }
.report-table { margin-top: 8px; }
.pagination-wrap { display: flex; justify-content: center; margin-top: 16px; }
.form-tip { font-size: 12px; color: #909399; margin-top: 4px; }
.report-detail { padding: 0 4px; }

.detail-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
.meta-row { display: flex; gap: 8px; align-items: flex-start; }
.meta-label { color: #909399; font-size: 13px; min-width: 72px; flex-shrink: 0; }
.meta-value { font-size: 13px; color: #303133; word-break: break-all; }
.metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
.metric-card { background: #f5f7fa; border-radius: 6px; padding: 12px; text-align: center; }
.metric-value { font-size: 20px; font-weight: 700; color: #303133; }
.metric-label { font-size: 11px; color: #909399; margin-top: 4px; }
.findings-section h4 { margin: 0 0 12px; font-size: 14px; color: #303133; }
.finding-item { border-left: 3px solid; border-radius: 4px; padding: 10px 12px; margin-bottom: 10px; background: #f5f7fa; }
.finding-item--critical, .finding-item--high { border-color: #f56c6c; }
.finding-item--medium { border-color: #e6a23c; }
.finding-item--low, .finding-item--info { border-color: #909399; }
.finding-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.finding-title { font-weight: 600; font-size: 13px; color: #303133; }
.finding-body { font-size: 12px; color: #606266; margin-bottom: 6px; }
.finding-remediation { font-size: 12px; color: #409eff; }
.detail-actions { margin-top: 16px; display: flex; justify-content: center; }
.text-muted { color: #c0c4cc; }
.score-high { color: #67c23a; font-weight: 700; }
.score-mid { color: #409eff; font-weight: 700; }
.score-low { color: #f56c6c; font-weight: 700; }
</style>
