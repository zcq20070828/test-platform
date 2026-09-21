<template>
  <div class="compat-view">
    <!-- 头部 -->
    <div class="view-header">
      <div>
        <h2 class="view-title">🌐 兼容性测试</h2>
        <p class="view-subtitle">多浏览器 × 多分辨率 × 控制台监控</p>
      </div>
      <div class="header-actions">
        <el-button @click="loadStats" :icon="Refresh" circle />
      </div>
    </div>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="🚀 测试执行-Web" name="execute">
        <CompatTestExecutor storage-key="web" />
      </el-tab-pane>
      <el-tab-pane label="📱 测试执行-移动APP" name="execute-mobile" lazy>
        <CompatTestExecutor
          storage-key="mobile"
          icon="📱"
          :platforms="['Android', 'iOS', 'HarmonyOS']"
          full-label="全平台完整流程"
          full-desc="自动串联 Android/iOS/鸿蒙 三大移动平台兼容测试（原生 App 包出设计，网页/H5 URL 设备仿真实测）"
          full-scope="移动APP全平台(android,ios,harmony)"
        />
      </el-tab-pane>
      <el-tab-pane label="💻 测试执行-PC客户端" name="execute-pc" lazy>
        <CompatTestExecutor
          storage-key="pc"
          icon="💻"
          :platforms="['Windows', 'macOS']"
          full-label="全平台完整流程"
          full-desc="自动串联 Windows/macOS 两大桌面平台兼容测试（客户端出设计，网页 URL 设备仿真实测）"
          full-scope="PC全平台(windows,mac)"
        />
      </el-tab-pane>
      <el-tab-pane label="📋 兼容性报告" name="reports">
    <!-- 统计卡片 -->
    <el-row :gutter="12" class="stat-cards">
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon">📋</div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.totalReports }}</div>
            <div class="stat-label">测试报告</div>
          </div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card" :class="{ 'stat-card--warn': stats.avgScore < 80 }">
          <div class="stat-icon">📊</div>
          <div class="stat-info">
            <div class="stat-value" :class="scoreClass(stats.avgScore)">{{ stats.avgScore }}<span class="stat-unit">分</span></div>
            <div class="stat-label">平均兼容评分</div>
          </div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon">🌐</div>
          <div class="stat-info">
            <div class="stat-value">3×5</div>
            <div class="stat-label">默认矩阵规模</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 主内容：左侧执行 + 右侧报告列表 -->
    <el-row :gutter="12">
      <!-- 左侧：新建测试 -->
      <el-col :span="8">
        <el-card class="new-test-card">
          <template #header>
            <div class="card-header">🚀 新建测试</div>
          </template>

          <el-form label-position="top" @submit.prevent="submitTest">
            <el-form-item label="被测页面 URL" required>
              <el-input
                v-model="testForm.url"
                placeholder="https://your-site.com 或 http://localhost:5174"
                clearable
              />
            </el-form-item>

            <el-form-item label="超时时间 (ms)">
              <el-input-number v-model="testForm.timeout" :min="5000" :max="120000" :step="5000" style="width:100%" />
            </el-form-item>

            <el-form-item label="自定义浏览器矩阵">
              <el-switch v-model="testForm.useCustomMatrix" />
              <span class="form-tip">关闭时使用默认矩阵（Chromium/Firefox/WebKit × 5种分辨率）</span>
            </el-form-item>

            <div v-if="testForm.useCustomMatrix" class="matrix-preview">
              <div class="matrix-row matrix-header">
                <span class="browser-label"></span>
                <span v-for="vp in DEFAULT_VIEWPORTS" :key="vp.name" class="vp-label" :title="vp.label">{{ vp.name }}</span>
              </div>
              <div v-for="browser in DEFAULT_BROWSERS" :key="browser.name" class="matrix-row">
                <span class="browser-label">{{ browser.label }}</span>
                <span v-for="vp in DEFAULT_VIEWPORTS" :key="vp.name" class="vp-cell vp-cell--default">—</span>
              </div>
            </div>

            <div class="submit-row">
              <el-button type="primary" native-type="submit" :loading="submitting" @click="submitTest" style="width:100%">
                {{ submitting ? `执行中 (报告ID: ${submittingReportId})` : '▶ 开始测试' }}
              </el-button>
            </div>
          </el-form>

          <!-- SSE 进度提示 -->
          <div v-if="submitting" class="sse-hint">
            <el-icon class="is-loading"><Loading /></el-icon>
            测试进行中，结果将自动更新...
          </div>
        </el-card>
      </el-col>

      <!-- 右侧：报告列表 -->
      <el-col :span="16">
        <el-card class="reports-card">
          <template #header>
            <div class="card-header">📋 测试报告</div>
          </template>

          <el-table :data="reports" v-loading="loadingReports" stripe>
            <el-table-column prop="url" label="被测 URL" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">
                <a :href="row.url" target="_blank" class="url-link">{{ row.url }}</a>
              </template>
            </el-table-column>
            <el-table-column prop="total" label="总测试" width="80" align="center">
              <template #default="{ row }">{{ row.total || 0 }}</template>
            </el-table-column>
            <el-table-column prop="passed" label="通过" width="70" align="center">
              <template #default="{ row }">
                <span class="count-pass">{{ row.passed || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="failed" label="失败" width="70" align="center">
              <template #default="{ row }">
                <span class="count-fail" v-if="(row.failed || 0) > 0">{{ row.failed }}</span>
                <span v-else class="text-muted">0</span>
              </template>
            </el-table-column>
            <el-table-column prop="errored" label="错误" width="70" align="center">
              <template #default="{ row }">
                <span class="count-err" v-if="(row.errored || 0) > 0">{{ row.errored }}</span>
                <span v-else class="text-muted">0</span>
              </template>
            </el-table-column>
            <el-table-column prop="score" label="评分" width="80" align="center">
              <template #default="{ row }">
                <span :class="scoreClass(row.score)">{{ row.score ?? '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="测试时间" width="160">
              <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="viewReport(row)">详情</el-button>
                <el-button link type="primary" size="small" @click="downloadReport(row)">下载</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-wrap" v-if="totalReports > pageSize">
            <el-pagination
              v-model:current-page="page"
              :page-size="pageSize"
              :total="totalReports"
              layout="prev, pager, next"
              @current-change="loadReports"
            />
          </div>
        </el-card>
      </el-col>
    </el-row>
      </el-tab-pane>
    </el-tabs>

    <!-- 报告详情抽屉 -->
    <el-drawer v-model="detailDrawerVisible" title="兼容性测试报告" size="780px" direction="rtl">
      <div v-if="selectedReport" class="report-detail">
        <!-- 报告概览 -->
        <div class="detail-meta">
          <div class="meta-row"><span class="meta-label">报告ID</span><span class="meta-value mono">{{ selectedReport.id }}</span></div>
          <div class="meta-row"><span class="meta-label">被测URL</span><a :href="selectedReport.url" target="_blank" class="meta-value url-link">{{ selectedReport.url }}</a></div>
          <div class="meta-row"><span class="meta-label">执行时间</span><span class="meta-value">{{ fmtTime(selectedReport.created_at) }}</span></div>
          <div class="meta-row"><span class="meta-label">评分</span><span :class="scoreClass(selectedReport.score)" class="big-score">{{ selectedReport.score ?? '—' }}</span></div>
        </div>

        <!-- 评分概览 -->
        <div class="summary-bars">
          <div class="sum-bar sum-bar--pass">
            <span class="sum-label">通过</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: selectedReport.total ? (selectedReport.passed / selectedReport.total * 100) + '%' : '0%' }"></div></div>
            <span class="sum-count">{{ selectedReport.passed || 0 }}/{{ selectedReport.total || 0 }}</span>
          </div>
          <div class="sum-bar sum-bar--fail">
            <span class="sum-label">失败</span>
            <div class="bar-track"><div class="bar-fill bar-fill--fail" :style="{ width: selectedReport.total ? (selectedReport.failed / selectedReport.total * 100) + '%' : '0%' }"></div></div>
            <span class="sum-count">{{ selectedReport.failed || 0 }}</span>
          </div>
          <div class="sum-bar sum-bar--err">
            <span class="sum-label">错误</span>
            <div class="bar-track"><div class="bar-fill bar-fill--err" :style="{ width: selectedReport.total ? (selectedReport.errored / selectedReport.total * 100) + '%' : '0%' }"></div></div>
            <span class="sum-count">{{ selectedReport.errored || 0 }}</span>
          </div>
        </div>

        <!-- 兼容性矩阵热力图 -->
        <div class="matrix-section">
          <h4>📊 兼容性矩阵</h4>
          <div class="matrix-grid">
            <div class="matrix-row matrix-header">
              <span class="matrix-cell browser-cell"></span>
              <span v-for="vp in VIEWPORT_LABELS" :key="vp.key" class="matrix-cell vp-cell" :title="vp.label">{{ vp.key }}</span>
            </div>
            <div v-for="browser in BROWSER_LABELS" :key="browser.key" class="matrix-row">
              <span class="matrix-cell browser-cell">{{ browser.label }}</span>
              <span
                v-for="vp in VIEWPORT_LABELS"
                :key="vp.key"
                class="matrix-cell result-cell"
                :class="getResultClass(browser.key, vp.key)"
                :title="getResultTitle(browser.key, vp.key)"
              >
                {{ getResultIcon(browser.key, vp.key) }}
              </span>
            </div>
          </div>
          <div class="matrix-legend">
            <span class="legend-item legend-pass">✅ 通过</span>
            <span class="legend-item legend-warn">⚠️ 失败</span>
            <span class="legend-item legend-err">❌ 错误</span>
          </div>
        </div>

        <!-- 问题清单 -->
        <div v-if="failedResults.length" class="issues-section">
          <h4>⚠️ 问题清单 ({{ failedResults.length }})</h4>
          <div v-for="(item, idx) in failedResults" :key="idx" class="issue-item">
            <div class="issue-header">
              <el-tag size="small" :type="item.status === 'error' ? 'danger' : 'warning'">
                {{ item.status === 'error' ? '错误' : '失败' }}
              </el-tag>
              <span class="issue-browser">{{ BROWSER_LABEL_MAP[item.browser] || item.browser }}</span>
              <span class="issue-vp">{{ VIEWPORT_LABEL_MAP[item.viewport] || item.viewport }} ({{ item.resolution }})</span>
            </div>
            <div v-if="item.consoleErrors && item.consoleErrors.length" class="issue-errors">
              <code v-for="(err, ei) in item.consoleErrors.slice(0, 3)" :key="ei" class="error-code">{{ err.text }}</code>
            </div>
            <div v-if="item.error" class="issue-errors">
              <code class="error-code">{{ item.error }}</code>
            </div>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Loading } from '@element-plus/icons-vue'
import { compatApi } from '@/api/index'
import CompatTestExecutor from '@/components/CompatTestExecutor.vue'

// 常量
const DEFAULT_BROWSERS = [
  { name: 'chromium', label: 'Chromium' },
  { name: 'firefox', label: 'Firefox' },
  { name: 'webkit', label: 'Safari/WebKit' },
]
const DEFAULT_VIEWPORTS = [
  { name: 'desktop-lg', label: '大屏桌面 1920×1080' },
  { name: 'desktop-md', label: '笔记本 1366×768' },
  { name: 'tablet', label: '平板 768×1024' },
  { name: 'mobile-lg', label: '大屏手机 414×896' },
  { name: 'mobile-sm', label: '小屏手机 375×667' },
]
const BROWSER_LABELS = [
  { key: 'chromium', label: 'Chromium' },
  { key: 'firefox', label: 'Firefox' },
  { key: 'webkit', label: 'Safari/WebKit' },
]
const VIEWPORT_LABELS = [
  { key: 'desktop-lg', label: '大屏桌面' },
  { key: 'desktop-md', label: '笔记本' },
  { key: 'tablet', label: '平板' },
  { key: 'mobile-lg', label: '大屏手机' },
  { key: 'mobile-sm', label: '小屏手机' },
]
const BROWSER_LABEL_MAP: Record<string, string> = {
  chromium: 'Chromium', firefox: 'Firefox', webkit: 'Safari/WebKit',
}
const VIEWPORT_LABEL_MAP: Record<string, string> = {
  'desktop-lg': '大屏桌面', 'desktop-md': '笔记本', 'tablet': '平板',
  'mobile-lg': '大屏手机', 'mobile-sm': '小屏手机',
}

// 状态
const loadingReports = ref(false)
const submitting = ref(false)
const submittingReportId = ref('')
const detailDrawerVisible = ref(false)
const reports = ref<Record<string, unknown>[]>([])
const totalReports = ref(0)
const selectedReport = ref<Record<string, unknown> | null>(null)
const page = ref(1)
const pageSize = 20
const activeTab = ref('execute')

const stats = reactive({
  totalReports: 0,
  avgScore: 0,
})

const testForm = reactive({
  url: '',
  timeout: 30000,
  useCustomMatrix: false,
})

// 计算属性
const failedResults = computed(() => {
  if (!selectedReport.value?.reportData) return []
  return (selectedReport.value.reportData as Record<string, unknown>[]).filter(
    (r: Record<string, unknown>) => r.status === 'failed' || r.status === 'error'
  )
})

// 辅助
const scoreClass = (score: number | null | undefined) => {
  if (score == null) return 'text-muted'
  if (score >= 90) return 'score-high'
  if (score >= 70) return 'score-mid'
  return 'score-low'
}
const fmtTime = (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '—'

function getResultClass(browser: string, viewport: string): string {
  const r = getResult(browser, viewport)
  if (!r) return 'result-unknown'
  if (r.status === 'passed') return 'result-pass'
  if (r.status === 'error') return 'result-error'
  return 'result-failed'
}
function getResultIcon(browser: string, viewport: string): string {
  const r = getResult(browser, viewport)
  if (!r) return '—'
  if (r.status === 'passed') return '✅'
  if (r.status === 'error') return '❌'
  return '⚠️'
}
function getResultTitle(browser: string, viewport: string): string {
  const r = getResult(browser, viewport)
  if (!r) return '无数据'
  const label = (s: string) => BROWSER_LABEL_MAP[s] || s
  const vlabel = (s: string) => VIEWPORT_LABEL_MAP[s] || s
  if (r.status === 'passed') return `${label(browser)} × ${vlabel(viewport)}：通过`
  if (r.status === 'error') return `${label(browser)} × ${vlabel(viewport)}：错误 ${r.error || ''}`
  const errs = (r.consoleErrors || []).map((e: Record<string, string>) => e.text).join('; ')
  return `${label(browser)} × ${vlabel(viewport)}：失败 ${errs ? '— ' + errs.slice(0, 60) : ''}`
}
function getResult(browser: string, viewport: string): Record<string, unknown> | null {
  if (!selectedReport.value?.reportData) return null
  return (selectedReport.value.reportData as Record<string, unknown>[]).find(
    (r: Record<string, unknown>) => r.browser === browser && r.viewport === viewport
  ) || null
}

// 加载统计
async function loadStats() {
  try {
    const data = await compatApi.getStats()
    if (data) {
      stats.totalReports = data.totalReports || 0
      stats.avgScore = data.avgScore || 0
    }
  } catch { /* silent */ }
}

// 加载报告列表
async function loadReports() {
  loadingReports.value = true
  try {
    const res = await compatApi.getReports({ limit: pageSize, offset: (page.value - 1) * pageSize })
    if (res) {
      reports.value = res.data as Record<string, unknown>[]
      totalReports.value = res.total || 0
    }
  } catch { /* silent */ }
  finally { loadingReports.value = false }
}

// 提交测试
async function submitTest() {
  if (!testForm.url) {
    ElMessage.warning('请输入被测页面 URL')
    return
  }
  submitting.value = true
  submittingReportId.value = ''
  try {
    const res = await compatApi.runTest({
      url: testForm.url,
      timeout: testForm.timeout,
    })
    if (res && res.reportId) {
      submittingReportId.value = res.reportId
      ElMessage.success(`测试已启动，报告ID: ${res.reportId}`)
      setTimeout(() => {
        submitting.value = false
        loadReports()
        loadStats()
      }, 3000)
    }
  } catch (e: any) {
    ElMessage.error('提交失败: ' + (e.message || '未知错误'))
    submitting.value = false
  }
}

// 查看报告
async function viewReport(row: Record<string, unknown>) {
  try {
    const data = await compatApi.getReport(row.id as string)
    if (data) {
      selectedReport.value = data as Record<string, unknown>
      detailDrawerVisible.value = true
    } else {
      ElMessage.error('报告不存在')
    }
  } catch (e: any) {
    ElMessage.error('加载报告失败: ' + (e.message || ''))
  }
}

// 下载报告
function downloadReport(row: Record<string, unknown>) {
  compatApi.getReport(row.id as string).then(data => {
    if (!data) return
    const r = data as Record<string, unknown>
    const lines = [
      '# Web 兼容性测试报告',
      `**被测URL**: ${r.url}`,
      `**执行时间**: ${fmtTime(r.created_at as string)}`,
      `**评分**: ${r.score ?? '—'} / 100`,
      `**通过**: ${r.passed || 0} / ${r.total || 0}`,
      `**失败**: ${r.failed || 0} | **错误**: ${r.errored || 0}`,
      '',
      '## 兼容性矩阵',
      '',
    ]
    const vpKeys = ['desktop-lg', 'desktop-md', 'tablet', 'mobile-lg', 'mobile-sm']
    const vpTitles = ['大屏桌面', '笔记本', '平板', '大屏手机', '小屏手机']
    lines.push('| 浏览器 | ' + vpTitles.join(' | ') + ' |')
    lines.push('|--------|' + vpTitles.map(() => '------').join('|') + '|')
    const browsers = ['chromium', 'firefox', 'webkit']
    const blabels = ['Chromium', 'Firefox', 'Safari/WebKit']
    browsers.forEach((bKey, bi) => {
      const cells = vpKeys.map(vp => {
        const r = ((r.reportData as Record<string, unknown>[]) || []).find(x => x.browser === bKey && x.viewport === vp)
        if (!r) return '—'
        return r.status === 'passed' ? '✅' : r.status === 'error' ? '❌' : '⚠️'
      })
      lines.push(`| ${blabels[bi]} | ${cells.join(' | ')} |`)
    })
    lines.push('')
    const failures = ((r.reportData as Record<string, unknown>[]) || []).filter(x => x.status !== 'passed')
    if (failures.length) {
      lines.push('## 问题清单')
      failures.forEach((item, i) => {
        lines.push(`${i + 1}. **${blabels[browsers.indexOf(item.browser as string)]} × ${VIEWPORT_LABEL_MAP[item.viewport as string] || item.viewport}** [${item.status}]`)
        if (item.consoleErrors && (item.consoleErrors as Record<string, unknown>[]).length) {
          (item.consoleErrors as Record<string, unknown>[]).forEach(e => {
            lines.push(`   - ${e.text}`)
          })
        }
        if (item.error) lines.push(`   - Error: ${item.error}`)
      })
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `compat-report-${r.id}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }).catch(() => ElMessage.error('下载失败'))
}

onMounted(() => {
  loadStats()
  loadReports()
})
</script>

<style scoped>
.compat-view { padding: 20px; }
.view-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.view-title { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.view-subtitle { color: #909399; font-size: 13px; margin: 0; }
.stat-cards { margin-bottom: 16px; }
.stat-card { background: #fff; border-radius: 8px; padding: 16px; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.stat-card--warn { border-left: 3px solid #e6a23c; }
.stat-icon { font-size: 24px; }
.stat-value { font-size: 22px; font-weight: 700; color: #303133; }
.stat-unit { font-size: 14px; font-weight: 400; margin-left: 2px; }
.stat-label { font-size: 12px; color: #909399; }

.card-header { font-weight: 600; font-size: 14px; }
.new-test-card { margin-bottom: 0; }
.form-tip { font-size: 12px; color: #909399; margin-left: 8px; }
.matrix-preview { background: #f5f7fa; border-radius: 6px; padding: 8px; margin: 8px 0; }
.matrix-row { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.matrix-row:last-child { margin-bottom: 0; }
.browser-label { width: 80px; font-size: 12px; color: #606266; flex-shrink: 0; }
.vp-label { flex: 1; text-align: center; font-size: 11px; color: #909399; }
.matrix-header .browser-label { font-weight: 600; color: #606266; }
.vp-cell { text-align: center; font-size: 12px; }
.vp-cell--default { color: #c0c4cc; }
.submit-row { margin-top: 12px; }
.sse-hint { margin-top: 10px; font-size: 12px; color: #409eff; display: flex; align-items: center; gap: 6px; }
.reports-card {}

.url-link { color: #409eff; text-decoration: none; font-size: 12px; }
.url-link:hover { text-decoration: underline; }
.count-pass { color: #67c23a; font-weight: 600; }
.count-fail { color: #f56c6c; font-weight: 600; }
.count-err { color: #e6a23c; font-weight: 600; }
.pagination-wrap { display: flex; justify-content: center; margin-top: 16px; }
.text-muted { color: #c0c4cc; }
.score-high { color: #67c23a; font-weight: 700; }
.score-mid { color: #409eff; font-weight: 700; }
.score-low { color: #f56c6c; font-weight: 700; }

/* 抽屉详情 */
.report-detail { padding: 0 4px; }
.detail-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
.meta-row { display: flex; gap: 8px; align-items: flex-start; }
.meta-label { color: #909399; font-size: 13px; min-width: 72px; flex-shrink: 0; }
.meta-value { font-size: 13px; color: #303133; word-break: break-all; }
.mono { font-family: monospace; font-size: 11px; }
.big-score { font-size: 28px; font-weight: 700; }

.summary-bars { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.sum-bar { display: flex; align-items: center; gap: 8px; }
.sum-label { width: 40px; font-size: 12px; color: #606266; }
.bar-track { flex: 1; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: #67c23a; border-radius: 4px; transition: width 0.3s; }
.bar-fill--fail { background: #f56c6c; }
.bar-fill--err { background: #e6a23c; }
.sum-count { width: 48px; text-align: right; font-size: 12px; font-weight: 600; color: #303133; }

.matrix-section { margin-bottom: 20px; }
.matrix-section h4 { margin: 0 0 10px; font-size: 14px; }
.matrix-grid { background: #f9f9f9; border-radius: 6px; overflow: hidden; }
.matrix-cell { padding: 6px 4px; font-size: 12px; }
.browser-cell { width: 90px; font-weight: 600; color: #606266; padding-left: 8px; }
.vp-cell { text-align: center; font-size: 11px; color: #909399; font-weight: 500; }
.result-cell { text-align: center; font-size: 16px; }
.result-pass { background: #f0f9eb; }
.result-failed { background: #fef0f0; }
.result-error { background: #fdf6ec; }
.result-unknown { background: #f5f5f5; }
.matrix-legend { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; color: #606266; }
.legend-pass { color: #67c23a; }
.legend-warn { color: #f56c6c; }
.legend-err { color: #e6a23c; }

.issues-section h4 { margin: 0 0 10px; font-size: 14px; }
.issue-item { background: #fef0f0; border-left: 3px solid #f56c6c; border-radius: 4px; padding: 8px 12px; margin-bottom: 8px; }
.issue-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.issue-browser { font-weight: 600; font-size: 13px; color: #303133; }
.issue-vp { font-size: 12px; color: #606266; }
.issue-errors { display: flex; flex-direction: column; gap: 4px; }
.error-code { font-size: 11px; color: #f56c6c; background: #fff; padding: 4px 8px; border-radius: 4px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
