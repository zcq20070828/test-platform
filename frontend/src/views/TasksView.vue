<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { taskApi, getAuthHeaders } from '@/api'
import type { Task, TaskStatus, Artifact } from '@/types'
import { ElMessage, ElMessageBox } from 'element-plus'
import { escapeHtml as escapeHtmlUtil } from '@/utils/safe-html'
import MsIcon from '@/components/MsIcon.vue'
import QualityCard from '@/components/QualityCard.vue'
import { formatDateTime } from '@/utils/time'
import { formatFailure, failureLabel } from '@/utils/failure-message'
import { renderMarkdownSafe } from '@/utils/safe-html'
import { summarizeTaskOutput } from '@/utils/tool-summary'

const store = useMainStore()
const router = useRouter()
const route = useRoute()

// ===== 筛选状态 =====
const searchKeyword = ref('')
const statusFilter = ref<TaskStatus | ''>('')
const agentFilter = ref('')
const dateRange = ref<[string, string] | null>(null)

// ===== 分页 =====
const currentPage = ref(1)
const pageSize = ref(20)

// ===== 详情弹窗 =====
const detailVisible = ref(false)
const selectedTask = ref<Task | null>(null)

/**
 * 审核结论 → 展示元信息（2026-11-17）
 *
 * 三态化之后，「通过」不再是唯一的好结果：
 *   passed            → 绿色「审核通过」
 *   passed_with_notes → 橙色「已交付 · 附改进建议」（交付物可用，只是还有优化点）
 *   failed            → 红色「审核未通过」
 *   inconclusive      → 灰色「审核未定论」（有效评审不足，已放行）
 * 老任务没有 reviewVerdict 时按 reviewPassed 推断，避免显示成「未知」。
 */
const reviewVerdictMeta = computed(() => {
  const t = selectedTask.value
  if (!t) return { type: 'info' as const, label: '审核结论未知' }
  const verdict = t.reviewVerdict
    || (t.reviewPassed === true ? 'passed' : t.reviewPassed === false ? 'failed' : null)
  const noteCount = Array.isArray(t.reviewNotes) ? t.reviewNotes.length : 0
  switch (verdict) {
    case 'passed':
      return { type: 'success' as const, label: noteCount > 0 ? `审核通过（附 ${noteCount} 条改进建议）` : '审核通过' }
    case 'passed_with_notes':
      return { type: 'warning' as const, label: `已交付 · 附 ${noteCount || ''} 条改进建议`.replace('附  条', '附') }
    case 'inconclusive':
      return { type: 'info' as const, label: '审核未定论（已放行）' }
    case 'veto':
      return { type: 'danger' as const, label: '审核未通过（一票否决）' }
    case 'failed':
      return { type: 'danger' as const, label: '审核未通过' }
    default:
      return { type: 'info' as const, label: '未进入审核' }
  }
})

/** 任务列表用的短标签（列宽有限，「已交付·附建议」七个字刚好） */
function rowVerdictMeta(row: any): { type: 'success' | 'warning' | 'danger' | 'info'; label: string; short: string } {
  const verdict = row.reviewVerdict
    || (row.reviewPassed === true ? 'passed' : row.reviewPassed === false ? 'failed' : null)
  // 列表接口只给 reviewNoteCount（不含完整 notes），详情接口才给 reviewNotes
  const noteCount = Array.isArray(row.reviewNotes) ? row.reviewNotes.length : (Number(row.reviewNoteCount) || 0)
  switch (verdict) {
    case 'passed':
      return { type: 'success', label: noteCount > 0 ? `审核通过（附 ${noteCount} 条改进建议）` : '审核通过', short: '通过' }
    case 'passed_with_notes':
      return { type: 'warning', label: `已交付 · 附 ${noteCount} 条改进建议`, short: '已交付·附建议' }
    case 'inconclusive':
      return { type: 'info', label: '有效评审不足，已放行', short: '未定论' }
    case 'veto':
      return { type: 'danger', label: '审核未通过（一票否决）', short: '否决' }
    case 'failed':
      return { type: 'danger', label: '审核未通过', short: '未通过' }
    default:
      return { type: 'info', label: '', short: '' }
  }
}

// ===== 自动刷新 =====
const autoRefresh = ref(false)
let refreshTimer: ReturnType<typeof setTimeout> | null = null

// 智能体选项（从tasks提取去重）
const agentOptions = computed(() => {
  const names = new Set(store.tasks.map(t => t.agentName || t.agent).filter(Boolean))
  return Array.from(names).sort()
})

// 过滤后的任务
const filteredTasks = computed(() => {
  let list = [...store.tasks]

  // 关键词
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    list = list.filter(t =>
      t.agentName.toLowerCase().includes(kw) ||
      t.input.toLowerCase().includes(kw) ||
      t.id.toLowerCase().includes(kw)
    )
  }

  // 状态
  if (statusFilter.value) {
    list = list.filter(t => t.status === statusFilter.value)
  }

  // 智能体
  if (agentFilter.value) {
    list = list.filter(t => t.agentName === agentFilter.value)
  }

  // 日期范围
  if (dateRange.value) {
    const [start, end] = dateRange.value
    list = list.filter(t => {
      const d = t.startTime ? t.startTime.slice(0, 10) : '' // 取日期部分 YYYY-MM-DD
      return d >= start && d <= end
    })
  }

  return list
})

// 分页数据
const pagedTasks = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredTasks.value.slice(start, start + pageSize.value)
})

// 统计
const statusStats = computed(() => ({
  total: store.tasks.length,
  running: store.tasks.filter(t => t.status === 'running').length,
  completed: store.tasks.filter(t => t.status === 'completed').length,
  failed: store.tasks.filter(t => t.status === 'failed').length,
  cancelled: store.tasks.filter(t => t.status === 'cancelled').length,
}))

// ===== 辅助函数 =====
function getStatusType(status: string) {
  const types: Record<string, string> = {
    pending: 'info', running: 'warning', completed: 'success', failed: 'danger', cancelled: 'warning'
  }
  return types[status] || 'info'
}

/** 详情页的失败说明（markdown → 清洗后的 HTML） */
function renderFailure(task: any): string {
  if (!task) return ''
  const text = formatFailure(task.failure, task.error)
  return renderMarkdownSafe(text)
}

/** 列表里的失败原因悬浮说明：优先用诊断，没有就退回原始错误 */
function failureHint(row: any): string {
  if (!row || row.status !== 'failed') return ''
  if (row.failure && row.failure.title) {
    return formatFailure(row.failure).replace(/[*_>`]/g, '').slice(0, 260)
  }
  const raw = String(row.error || '').trim()
  return raw ? raw.slice(0, 200) : ''
}

function getStatusText(status: string) {
  const texts: Record<string, string> = {
    pending: '等待中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消'
  }
  return texts[status] || status
}

// 统一按北京时区渲染（2026-11-19）：见 frontend/src/utils/time.ts 的说明
function formatTime(ts: string) {
  return formatDateTime(ts)
}

// 格式化任务输入（处理对象/JSON），敏感信息脱敏
function maskCredential(text: string): string {
  if (!text) return text
  // 脱敏:支持中英文冒号、中文引号、ASCII引号、空格分隔
  return text
    .replace(/(?:密码|password|pwd)\s*[:：\u201c\u201d'"\s]\s*([^\s,，;。;}\u201c\u201d'"]+)/gi, () => `密码"***"`)
    .replace(/(?:账号|account|用户名|username)\s*[:：\u201c\u201d'"\s]\s*([^\s,，;。;}\u201c\u201d'"]+)/gi, () => `账号"***"`)
    .replace(/[\u201c\u201d'"](?:password|pwd|secret)[\u201c\u201d'"]\s*:\s*[^,}\s]+/gi, '"password":"***"')
}
function formatTaskInput(input: any): string {
  if (!input) return ''
  if (typeof input === 'string') return maskCredential(input)
  if (typeof input === 'object') {
    try {
      return maskCredential(JSON.stringify(input, null, 2))
    } catch {
      return String(input)
    }
  }
  return String(input)
}

function getDuration(task: Task) {
  if (!task.startTime) return '-'
  const start = new Date(task.startTime).getTime()
  const end = task.endTime ? new Date(task.endTime).getTime() : Date.now()
  const sec = Math.round((end - start) / 1000)
  if (sec < 60) return `${sec}秒`
  if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒`
  return `${Math.floor(sec / 3600)}时${Math.floor((sec % 3600) / 60)}分`
}

// 格式化工时（小时）
function formatHours(hours: number | string | null | undefined): string {
  const h = typeof hours === 'string' ? parseFloat(hours) : hours
  if (!h || h === 0) return '-'
  if (h < 1) return `${Math.round(h * 60)}分钟`
  if (h < 8) return `${h.toFixed(1)}小时`
  const days = Math.floor(h / 8)
  const remainingHours = h % 8
  if (remainingHours === 0) return `${days}人天`
  return `${days}人天${remainingHours.toFixed(0)}小时`
}

// 格式化金额（统一精度为2位小数，与金钱/成本相关展示口径一致）
function formatMoney(amount: number | string | null | undefined): string {
  const a = typeof amount === 'string' ? parseFloat(amount) : amount
  if (a === undefined || a === null || isNaN(a) || a === 0) return '0.00'
  return a.toFixed(2)
}

// 格式化数字（千分位）
function formatNumber(num: number | string): string {
  const n = typeof num === 'string' ? parseFloat(num) : num
  if (!n || n === 0) return '0'
  return n.toLocaleString('en-US')
}

// 判断是否有成本信息
function hasCostInfo(task: Task): boolean {
  return !!(task.manualHours || task.actualCost || task.estimatedCost || task.savedCost || task.inputTokens || task.outputTokens)
}

// 获取输出物类型标签
function getArtifactTypeLabel(type: string): string {
  const labelMap: Record<string, string> = {
    'text': '文本',
    'code': '代码',
    'report': '报告',
    'image': '图片',
    'file': '文件'
  }
  return labelMap[type] || '未知'
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + units[i]
}

// 预览输出物
async function previewArtifact(artifact: Artifact) {
  let content = artifact.content
  if (!content && artifact.downloadUrl) {
    try {
      const res = await fetch(artifact.downloadUrl, {
        headers: getAuthHeaders()
      })
      if (res.ok) {
        content = await res.text()
      }
    } catch (e) {
      // fall through
    }
  }
  if (!content) {
    ElMessage.warning('该输出物没有预览内容')
    return
  }
  const previewWindow = window.open('', '_blank')
  if (previewWindow) {
    // 断开 opener,避免新窗口通过 window.opener 读回本页 localStorage.token
    try { previewWindow.opener = null } catch { /* 跨域时忽略 */ }
    // 安全整改(2026-10-19): artifact.name 来自 AI/用户文件名,此前未转义直接进 HTML,
    // `</h3><img src=x onerror=...>` 可在新窗口执行。这里名称与正文都统一转义。
    const safeName = escapeHtml(artifact.name)
    previewWindow.document.write(`
      <html>
        <head><title>预览 - ${safeName}</title></head>
        <body style="font-family: monospace; padding: 20px; background: #f5f5f5;">
          <h3>${safeName}</h3>
          <pre style="background: white; padding: 16px; border-radius: 8px; overflow: auto;">${escapeHtml(content)}</pre>
        </body>
      </html>
    `)
    previewWindow.document.close()
  }
}

// HTML 转义：统一使用 safe-html 工具，避免三处重复实现
function escapeHtml(text: string): string {
  return escapeHtmlUtil(text)
}

// 下载输出物
async function downloadArtifact(artifact: Artifact) {
  try {
    let blob: Blob
    let filename = artifact.name
    
    if (artifact.content) {
      blob = new Blob([artifact.content], { type: artifact.contentType || 'text/plain;charset=utf-8' })
    } else if (artifact.downloadUrl) {
      const res = await fetch(artifact.downloadUrl, {
        headers: getAuthHeaders()
      })
      if (!res.ok) {
        const errText = await res.text()
        ElMessage.error(`下载失败：${errText}`)
        return
      }
      blob = await res.blob()
    } else {
      ElMessage.warning('该输出物没有可下载的内容')
      return
    }
    
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    
    ElMessage.success(`已下载：${filename}`)
  } catch (err: any) {
    ElMessage.error(`下载失败：${err.message}`)
  }
}

// 下载完整输出物（包含输入、输出、审核结果）
async function downloadFullOutput(task: Task) {
  try {
    ElMessage.info('正在获取完整输出物...')
    
    const response = await fetch(`/api/tasks/${task.id}/output`, { headers: getAuthHeaders() })
    const data = await response.json()
    
    if (!response.ok) {
      ElMessage.error(data.error || '获取输出物失败')
      return
    }
    
    // 构建完整输出内容
    let content = `# 任务执行报告

## 基本信息
- 任务ID：${task.id}
- 智能体：${task.agentName || task.agent || ''}
- 状态：${task.status}
- 开始时间：${formatTime(task.startTime || '')}
- 结束时间：${task.endTime ? formatTime(task.endTime) : '-'}

## AI审核结果
`
    
    if (data.reviewResults && data.reviewResults.length > 0) {
      data.reviewResults.forEach((review: any, index: number) => {
        // 与界面同一口径：单个审核员只报「评分是否达到 80」，不作交付物结论
        const reviewerScoreState = review.veto
          ? '一票否决'
          : (Number(review.score) >= 80 ? '评分达标（≥80）' : '评分偏低（<80）')
        content += `### 审核员 ${index + 1}：${review.reviewerName}
- 评分：${review.score}分
- 该审核员评分：${reviewerScoreState}

`
      })
      // 审核结论三态化（2026-11-17）：通过的也要把改进建议一并带进下载文件，
      // 否则「已交付·附建议」的建议在导出后就丢了。
      const verdictLabel = data.reviewVerdict === 'passed_with_notes'
        ? '已交付（附改进建议）'
        : (data.reviewPassed ? '审核通过' : '审核未通过')
      content += `### 综合结果：${verdictLabel}

`
      if (data.reviewSummary) content += `> ${data.reviewSummary}\n\n`
      if (Array.isArray(data.reviewNotes) && data.reviewNotes.length) {
        content += `### 改进建议（${data.reviewNotes.length} 条）\n\n`
        for (const n of data.reviewNotes) {
          content += `- [${n.severity}] ${n.caseId ? `${n.caseId} ` : ''}${n.description}${n.suggestion ? ` → ${n.suggestion}` : ''}\n`
        }
        content += '\n'
      }
    }
    
    content += `## 任务输入
\`\`\`
${data.input || task.input}
\`\`\`

## 任务输出
\`\`\`
${data.output || task.output}
\`\`\`
`
    
    // 如果有提取的代码片段，也包含进去
    if (data.artifacts && data.artifacts.length > 0) {
      content += `\n## 输出物详情（共 ${data.artifacts.length} 个）\n\n`
      data.artifacts.forEach((artifact: any, index: number) => {
        if (artifact.content && artifact.content.length > 50) {
          content += `### ${artifact.name}\n\`\`\`${artifact.contentType?.split('/')[1] || 'text'}\n${artifact.content}\n\`\`\`\n`
        }
      })
    }
    
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `task-output-${task.id.substring(0, 8)}.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    
    ElMessage.success('完整输出物已下载')
  } catch (err: any) {
    console.error('Download full output error:', err)
    ElMessage.error(`下载失败：${err.message}`)
  }
}

// ===== 操作 =====
async function viewDetail(task: Task) {
  // 列表接口不返回 reviewNotes（最多 30 条 × 400 字，会把列表拖慢），
  // 只给 reviewNoteCount。打开详情时必须补拉一次，否则「改进建议」区块永远空着。
  selectedTask.value = task
  detailVisible.value = true
  try {
    const full = await taskApi.getById(task.id)
    if (full && selectedTask.value && selectedTask.value.id === task.id) {
      selectedTask.value = { ...task, ...full }
    }
  } catch (e) {
    console.warn('[TasksView] 拉取任务详情失败，沿用列表数据', e)
  }
}

async function cancelTask(task: Task) {
  try {
    await ElMessageBox.confirm(`确定取消任务「${task.agentName}」？`, '确认取消', {
      confirmButtonText: '取消任务',
      cancelButtonText: '保留',
      type: 'warning',
    })
    const result = await taskApi.cancel(task.id)
    if (result.success && result.ok) {
      ElMessage.success('任务已取消')
      // 同步更新 store 中的任务状态
      const t = store.tasks.find(t => t.id === task.id)
      if (t) { t.status = 'cancelled'; }
      // 如果当前详情页显示的就是这个任务，同步更新
      if (selectedTask.value?.id === task.id) {
        selectedTask.value = { ...selectedTask.value, status: 'cancelled' }
      }
    } else {
      ElMessage.error('取消失败：' + (result.error || '无法取消该任务'))
    }
  } catch { /* 取消对话框用户点了取消 */ }
}

async function retryTask(task: Task) {
  try {
    await ElMessageBox.confirm(`重新执行任务「${task.agentName}」？`, '确认重试')
    
    // 前端预检查：查询后端确认是否有正在执行的任务
    try {
      const executingRes = await fetch('/api/auth/executing-task', {
        headers: { 'Authorization': `Bearer ${store.token}` }
      })
      if (executingRes.ok) {
        const executingData = await executingRes.json()
        if (executingData.hasExecutingTask) {
          ElMessage.warning({
            message: `您有一个任务正在执行中（${executingData.taskId?.substring(0, 8)}...），请等待完成后再发起新任务`,
            duration: 5000
          })
          return
        }
      }
    } catch (e) {
      console.warn('[TasksView] 检查执行状态失败:', e)
    }
    
    // 重新执行时携带原始任务的完整上下文（输入+上次输出），避免 Agent 重复询问需求
    const contextInput = task.output
      ? `[重新执行任务] 原始需求：${task.input}\n\n上一次执行结果（供参考）：${task.output}\n\n请基于以上上下文重新执行任务。`
      : task.input
    
    try {
      const result = await taskApi.create(task.agent, contextInput)
      if (result.success) {
        ElMessage.success('任务已重新提交')
        await store.loadTasks()
      } else {
        ElMessage.error('提交失败：' + (result.error || '请稍后重试'))
      }
    } catch (err: any) {
      if (err.code === 'TASK_CONFLICT') {
        ElMessage.warning({
          message: err.message || '同一用户同一时间只能执行一个任务',
          duration: 5000
        })
      } else {
        ElMessage.error('提交失败：' + (err.message || err))
      }
    }
  } catch { /* 取消 */ }
}

function copyTaskId(id: string) {
  navigator.clipboard.writeText(id)
  ElMessage.success('已复制任务ID')
}

async function refreshTasks() {
  await store.loadTasks()
}

// 自动刷新（user.value 为空时停止，防止 logout 期间轮询触发 401 死循环）
// 指数退避：后端 ECONNREFUSED 时拉长间隔，后端恢复后重置
let _pollBackoff = 0   // 连续失败次数
let _pollNextDelay = 5000
function _scheduleNextPoll() {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = setTimeout(async () => {
    if (!store.user) return
    try {
      await store.loadTasks()
      // 成功后重置退避
      if (_pollBackoff > 0) {
        _pollBackoff = 0
        _pollNextDelay = 5000
      }
    } catch (err: any) {
      // 后端宕机时（ECONNREFUSED / TypeError: Failed to fetch）拉长间隔，避免炸日志
      const msg = String(err?.message || err || '')
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('502')) {
        _pollBackoff = Math.min(_pollBackoff + 1, 6)  // 最多 64s
        _pollNextDelay = 5000 * Math.pow(2, _pollBackoff)  // 10/20/40/80/160s 上限 64s
      }
    } finally {
      if (autoRefresh.value && store.user) _scheduleNextPoll()
    }
  }, _pollNextDelay)
}

watch(autoRefresh, (val) => {
  if (val && store.user) {
    _pollBackoff = 0
    _pollNextDelay = 5000
    _scheduleNextPoll()
  } else {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
  }
})

// user 变为 null 时强制停止轮询（logout 期间防止 401 死循环）
watch(() => store.user, (user) => {
  if (!user && refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
    autoRefresh.value = false
  }
})

// 组件卸载时清理定时器
onUnmounted(() => {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
})

// 页码重置 + URL 同步
watch([searchKeyword, statusFilter, agentFilter, dateRange], () => {
  currentPage.value = 1
  // 同步筛选条件到 URL query params（支持外部 deep-link）
  const query: Record<string, string> = {}
  if (searchKeyword.value) query.keyword = searchKeyword.value
  if (statusFilter.value) query.status = statusFilter.value
  if (agentFilter.value) query.agent = agentFilter.value
  if (dateRange.value) { query.startDate = dateRange.value[0]; query.endDate = dateRange.value[1] }
  router.replace({ query })
})

// 同步 URL 参数到筛选状态（支持明细页 deep-link）
const syncUrlParams = () => {
  const q = route.query
  if (q.status) statusFilter.value = q.status as TaskStatus
  if (q.agent) agentFilter.value = q.agent as string
  if (q.startDate || q.endDate) dateRange.value = [q.startDate as string, q.endDate as string]
  if (q.keyword) searchKeyword.value = q.keyword as string
}

// 加载
onMounted(() => {
  syncUrlParams()
  store.loadTasks()
  store.loadAgents()
})
</script>

<template>
  <div class="tasks-view" data-testid="tasks-page">
    <!-- 统计卡片（Precision TestOps Throughput 风格） -->
    <div class="stats-row">
      <div class="stat-card" @click="statusFilter = ''">
        <div class="stat-card-top">
          <div class="pto-icon-tile pto-icon-tile--sm pto-icon-tile--indigo">
            <span class="material-symbols-outlined" style="font-size:16px">assignment</span>
          </div>
          <span class="pto-badge pto-badge--neutral">ALL</span>
        </div>
        <span class="stat-num">{{ statusStats.total }}</span>
        <span class="stat-label">全部任务</span>
      </div>
      <div class="stat-card running" @click="statusFilter = 'running'">
        <div class="stat-card-top">
          <div class="pto-icon-tile pto-icon-tile--sm pto-icon-tile--indigo">
            <span class="material-symbols-outlined" style="font-size:16px">play_circle</span>
          </div>
          <span class="pto-badge pto-badge--running">RUN</span>
        </div>
        <span class="stat-num">{{ statusStats.running }}</span>
        <span class="stat-label">执行中</span>
      </div>
      <div class="stat-card completed" @click="statusFilter = 'completed'">
        <div class="stat-card-top">
          <div class="pto-icon-tile pto-icon-tile--sm pto-icon-tile--emerald">
            <span class="material-symbols-outlined" style="font-size:16px">check_circle</span>
          </div>
          <span class="pto-badge pto-badge--pass">PASS</span>
        </div>
        <span class="stat-num">{{ statusStats.completed }}</span>
        <span class="stat-label">已完成</span>
      </div>
      <div class="stat-card failed" @click="statusFilter = 'failed'">
        <div class="stat-card-top">
          <div class="pto-icon-tile pto-icon-tile--sm pto-icon-tile--rose">
            <span class="material-symbols-outlined" style="font-size:16px">error</span>
          </div>
          <span class="pto-badge pto-badge--fail">FAIL</span>
        </div>
        <span class="stat-num">{{ statusStats.failed }}</span>
        <span class="stat-label">失败</span>
      </div>
      <div class="stat-card cancelled" @click="statusFilter = 'cancelled'">
        <div class="stat-card-top">
          <div class="pto-icon-tile pto-icon-tile--sm pto-icon-tile--amber">
            <span class="material-symbols-outlined" style="font-size:16px">block</span>
          </div>
          <span class="pto-badge pto-badge--flaky">SKIP</span>
        </div>
        <span class="stat-num">{{ statusStats.cancelled }}</span>
        <span class="stat-label">已取消</span>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="filter-group">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索关键词/任务ID..."
          clearable
          style="width: 240px"
        >
          <template #prefix><MsIcon name="search" /></template>
        </el-input>

        <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 130px">
          <el-option label="等待中" value="pending" />
          <el-option label="执行中" value="running" />
          <el-option label="已完成" value="completed" />
          <el-option label="失败" value="failed" />
        </el-select>

        <el-select v-model="agentFilter" placeholder="智能体筛选" clearable style="width: 160px">
          <el-option v-for="name in agentOptions" :key="name" :label="name" :value="name" />
        </el-select>

        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="-"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 260px"
          value-format="YYYY-MM-DD"
        />
      </div>

      <div class="action-group">
        <el-switch v-model="autoRefresh" active-text="自动刷新" />
        <el-button @click="refreshTasks" :loading="store.isLoading">
          <MsIcon name="refresh" />
          刷新
        </el-button>
      </div>
    </div>

    <!-- 任务表格 -->
    <el-table
      :data="pagedTasks"
      stripe
      v-loading="store.isLoading"
      @row-click="viewDetail"
      style="width: 100%"
      :header-cell-style="{ background: 'var(--el-fill-color-light)' }"
    >
      <el-table-column prop="agentName" label="智能体" width="160">
        <template #default="{ row }">
          <el-tag effect="plain">{{ row.agentName }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="来源" width="120" align="center">
        <template #default="{ row }">
          <el-tag :type="row.source === 'workflow' ? 'warning' : 'info'" size="small" effect="plain">
            {{ row.source === 'workflow' ? '测试流水线' : '分步测试' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="用户" width="120" align="center">
        <template #default="{ row }">
          {{ row.username || '—' }}
        </template>
      </el-table-column>

      <el-table-column prop="input" label="任务输入" min-width="280">
        <template #default="{ row }">
          <el-tooltip 
            placement="top" 
            :disabled="!row.input || String(row.input).length < 50"
            effect="light"
            :popper-class="'task-input-tooltip'"
          >
            <template #content>
              <pre style="margin: 0; white-space: pre-wrap; word-break: break-all;">{{ formatTaskInput(row.input) }}</pre>
            </template>
            <span class="task-input-text">{{ formatTaskInput(row.input) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>

      <el-table-column prop="status" label="状态" width="150" align="center">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)" size="small" effect="light">
            {{ getStatusText(row.status) }}
          </el-tag>
          <!-- 失败原因类别（2026-11-20）：列表上就能看出是余额不足还是限流，
               不用点进去翻技术错误。悬浮给完整原因与建议。 -->
          <el-tooltip
            v-if="row.status === 'failed' && failureHint(row)"
            :content="failureHint(row)"
            placement="top"
            :show-after="300"
          >
            <el-tag type="danger" size="small" effect="plain" class="failure-chip">
              {{ failureLabel(row.failure?.category) }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>

      <!-- 审核结论（2026-11-17 三元化）：把「已交付但附建议」在列表上就能看到，
           否则用户以为任务失败/成功二选一，忽略掉审核意见 -->
      <el-table-column label="审核" width="130" align="center">
        <template #default="{ row }">
          <el-tooltip
            v-if="rowVerdictMeta(row).label"
            :content="row.reviewSummary || rowVerdictMeta(row).label"
            placement="top"
            :show-after="300"
          >
            <el-tag :type="rowVerdictMeta(row).type" size="small" effect="light">
              {{ rowVerdictMeta(row).short }}
            </el-tag>
          </el-tooltip>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="耗时" width="100" align="center">
        <template #default="{ row }">
          <span class="duration">{{ getDuration(row) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="预估工时" width="100" align="center">
        <template #default="{ row }">
          <span v-if="row.manualHours != null" class="manual-hours">{{ formatHours(row.manualHours) }}</span>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="实际Token" width="140" align="center">
        <template #default="{ row }">
          <span v-if="row.inputTokens || row.outputTokens" class="token-info">
            {{ formatNumber(row.inputTokens || 0) }} + {{ formatNumber(row.outputTokens || 0) }}
          </span>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="模型" width="120" align="center">
        <template #default="{ row }">
          <span v-if="row.model" class="model-tag">{{ row.model }}</span>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="中台成本" width="100" align="center">
        <template #default="{ row }">
          <span v-if="row.actualCost !== undefined && row.actualCost > 0" class="actual-cost">
            ¥{{ formatMoney(row.actualCost) }}
          </span>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="人工成本" width="100" align="center">
        <template #default="{ row }">
          <span v-if="row.estimatedCost !== undefined && row.estimatedCost > 0" class="estimated-cost">
            ¥{{ formatMoney(row.estimatedCost) }}
          </span>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="节省成本" width="120" align="center">
        <template #default="{ row }">
          <span v-if="row.savedCost !== undefined && row.savedCost > 0" class="saved-cost">
            ¥{{ formatMoney(row.savedCost) }}
          </span>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>

      <el-table-column prop="startTime" label="开始时间" width="170">
        <template #default="{ row }">
          {{ formatTime(row.startTime) }}
        </template>
      </el-table-column>

      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="viewDetail(row)">详情</el-button>
          <el-button
            v-if="row.status === 'running' && row.source !== 'workflow'"
            link type="danger"
            @click.stop="cancelTask(row)"
          >取消</el-button>
          <el-button
            v-if="row.status === 'failed' && row.source !== 'workflow'"
            link type="warning"
            @click.stop="retryTask(row)"
          >重试</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-row">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="filteredTasks.length"
        layout="total, sizes, prev, pager, next, jumper"
        background
      />
    </div>

    <!-- 空状态 -->
    <el-empty
      v-if="filteredTasks.length === 0 && !store.isLoading"
      description="暂无任务"
    />

    <!-- 任务详情弹窗 -->
    <el-dialog
      v-model="detailVisible"
      :title="selectedTask ? `任务详情` : '任务详情'"
      width="65%"
      @close="selectedTask = null"
      destroy-on-close
    >
      <div v-if="selectedTask" class="task-detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="任务ID">
            <span class="task-id" @click="copyTaskId(selectedTask.id)">
              {{ selectedTask.id }}
              <MsIcon name="content_copy" :size="12" />
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="智能体">
            {{ selectedTask.agentName }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusType(selectedTask.status)" effect="light">
              {{ getStatusText(selectedTask.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="耗时">
            {{ getDuration(selectedTask) }}
          </el-descriptions-item>
          <el-descriptions-item label="用户">
            {{ selectedTask.username || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="开始时间">
            {{ formatTime(selectedTask.startTime || '') }}
          </el-descriptions-item>
          <el-descriptions-item label="结束时间">
            {{ selectedTask.endTime ? formatTime(selectedTask.endTime) : '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 成本与工作量统计 -->
        <div v-if="hasCostInfo(selectedTask)" class="section cost-section">
          <h4 class="tab-label"><MsIcon name="payments" :size="16" /> 成本与工作量</h4>
          <el-descriptions :column="3" border class="cost-descriptions">
            <el-descriptions-item label="预估工时">
              <span class="cost-value">{{ formatHours(selectedTask.manualHours) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="实际Token">
              <span class="cost-value">
                {{ selectedTask.inputTokens ? selectedTask.inputTokens.toLocaleString() : 0 }}
                + {{ selectedTask.outputTokens ? selectedTask.outputTokens.toLocaleString() : 0 }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="模型">
              <span class="cost-value">{{ selectedTask.modelName || '-' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="中台成本">
              <span class="cost-value actual-cost">¥{{ formatMoney(selectedTask.actualCost) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="人工成本">
              <span class="cost-value manual-cost">¥{{ formatMoney(selectedTask.estimatedCost) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="节省成本">
              <span class="cost-value saved-cost">¥{{ formatMoney(selectedTask.savedCost) }}</span>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 失败诊断（2026-11-20）：任务失败时把「技术错误」翻译成
             「什么问题 + 可以怎么做」，用户不用猜是 Key 坏了还是网络问题 -->
        <div v-if="selectedTask.status === 'failed'" class="section failure-section">
          <h4 class="tab-label"><MsIcon name="error" :size="16" /> 失败原因</h4>
          <div class="failure-card">
            <div class="failure-content" v-html="renderFailure(selectedTask)"></div>
          </div>
        </div>

        <div class="section">
          <h4 class="tab-label"><MsIcon name="edit_note" :size="16" /> 任务输入</h4>
          <pre class="content-block">{{ selectedTask.input }}</pre>
        </div>

        <div v-if="selectedTask.output" class="section">
          <h4 class="tab-label"><MsIcon name="assignment" :size="16" /> 执行结果</h4>
          <div class="content-block result-block">
            <!-- 安全扫描等链路把 JSON 直接当 output 落库，这里转自然语言；
                 Markdown 报告原样返回，不做改写。完整原文走「完整输出物下载」。 -->
            <pre>{{ summarizeTaskOutput(selectedTask.output) }}</pre>
          </div>
          <div class="section-actions" v-if="selectedTask.source !== 'workflow'">
            <el-button type="primary" size="small" @click="downloadFullOutput(selectedTask)">
              <MsIcon name="download" /> 完整输出物下载
            </el-button>
          </div>
        </div>

        <!-- AI审核结果 -->
        <div v-if="selectedTask.reviewResults && selectedTask.reviewResults.length > 0" class="section">
          <h4 class="tab-label"><MsIcon name="shield" :size="16" /> AI质量审核结果</h4>
          <div class="review-scope-hint">
            单个审核员的「评分达标 / 偏低」只反映他自己的打分（满分 100，达标线 80 分）；
            交付物是否通过由**门禁结果 + 三人问题并集 + major 问题密度**综合判定，见下方「综合结果」。
          </div>
          <div class="review-results">
            <div 
              v-for="(review, index) in selectedTask.reviewResults" 
              :key="index" 
              class="review-card"
              :class="{
                'review-veto': review.veto,
                'review-scored-high': !review.veto && review.score >= 80,
                'review-scored-low': !review.veto && review.score < 80,
              }"
            >
              <div class="review-header">
                <span class="review-name">{{ review.reviewerName || '审核员 ' + (index + 1) }}</span>
                <!-- 审核智能体自身失败（网关超时/模型不可用）不是产出物的质量问题，
                     必须与「认真审了给低分」区分显示，否则用户会以为交付物被判不合格 -->
                <el-tag v-if="review.error" type="warning" size="small">审核异常</el-tag>
                <!-- 单个审核员的标签只表示「他的评分是否达到 80」，不表示交付物结论。
                     任务级结论由「门禁 + 三人问题并集 + major 密度」判定（见下方综合结果），
                     两套口径不同，所以这里不能写「通过/未通过」，否则会出现
                     「三个审核员全红、任务却已交付」的自相矛盾展示。 -->
                <el-tag v-else-if="review.veto" type="danger" size="small">一票否决</el-tag>
                <el-tag v-else-if="review.score >= 80" type="success" size="small">评分达标</el-tag>
                <el-tag v-else type="info" size="small">评分偏低</el-tag>
              </div>
              <div v-if="review.error" class="review-feedback">
                审核智能体未完成（{{ review.error }}），该评分不计入判定。
              </div>
              <template v-else>
                <div class="review-score">
                  <span class="score-label">评分：</span>
                  <span class="score-value" :class="{ 'score-high': review.score >= 90, 'score-low': review.score < 90 }">
                    {{ review.score }}分
                  </span>
                </div>
                <div v-if="review.feedback" class="review-feedback">
                  {{ review.feedback }}
                </div>
              </template>
            </div>
          </div>
          <!-- 审核结论（2026-11-17 三元化）：passed / passed_with_notes / failed
               注意：passed_with_notes 的交付物可用性与 passed 相同，
               区别只是「还有改进建议」，所以用 warning 色而不是 danger，
               并且必须说明「已交付」——否则用户会以为任务失败了。 -->
          <div class="review-summary">
            <el-tag v-if="reviewVerdictMeta.type === 'success'" type="success" size="large" effect="light">
              {{ reviewVerdictMeta.label }}
            </el-tag>
            <el-tag v-else-if="reviewVerdictMeta.type === 'warning'" type="warning" size="large" effect="light">
              {{ reviewVerdictMeta.label }}
            </el-tag>
            <el-tag v-else-if="reviewVerdictMeta.type === 'info'" type="info" size="large" effect="light">
              {{ reviewVerdictMeta.label }}
            </el-tag>
            <el-tag v-else type="danger" size="large" effect="light">
              {{ reviewVerdictMeta.label }}
            </el-tag>
            <span v-if="selectedTask.reviewAttempts && selectedTask.reviewAttempts > 1" class="verdict-extra">
              经 {{ selectedTask.reviewAttempts }} 轮审核
            </span>
            <span v-if="selectedTask.reviewStats" class="verdict-extra">{{ selectedTask.reviewStats }}</span>
          </div>

          <!-- 结论摘要：说明「为什么是这个结论」 -->
          <div v-if="selectedTask.reviewSummary" class="verdict-reason">
            {{ selectedTask.reviewSummary }}
          </div>

          <!-- 改进建议：passed_with_notes 场景下这是用户最需要看的内容 -->
          <div v-if="selectedTask.reviewNotes && selectedTask.reviewNotes.length" class="review-notes">
            <div class="review-notes-head">
              <MsIcon name="lightbulb" :size="16" />
              <strong>改进建议（{{ selectedTask.reviewNotes.length }} 条）</strong>
              <span class="review-notes-hint">
                {{ reviewVerdictMeta.type === 'warning'
                  ? '交付物已可用，以下为可继续优化的点'
                  : '以下问题导致本次未通过' }}
              </span>
            </div>
            <div class="review-notes-list">
              <div
                v-for="(note, i) in selectedTask.reviewNotes"
                :key="i"
                class="review-note"
                :class="'note-' + note.severity"
              >
                <div class="note-head">
                  <el-tag :type="note.severity === 'blocker' ? 'danger' : note.severity === 'major' ? 'warning' : 'info'" size="small">
                    {{ note.severity }}
                  </el-tag>
                  <span class="note-category">{{ note.category }}</span>
                  <span v-if="note.caseId" class="note-case">{{ note.caseId }}</span>
                </div>
                <div class="note-desc">{{ note.description }}</div>
                <div v-if="note.suggestion" class="note-suggestion">→ {{ note.suggestion }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 交付物质量与人工复核（阶段四） -->
        <div class="section">
          <h4 class="tab-label"><MsIcon name="verified" :size="16" /> 交付物质量</h4>
          <QualityCard
            :task-id="selectedTask.id"
            :content="selectedTask.result || ''"
            :review-verdict="selectedTask.reviewVerdict || null"
            :review-note-count="selectedTask.reviewNotes?.length || 0"
          />
        </div>

        <!-- 输出物列表 -->
        <div v-if="selectedTask.artifacts && selectedTask.artifacts.length > 0" class="section">
          <h4 class="tab-label"><MsIcon name="inventory_2" :size="16" /> 输出物（{{ selectedTask.artifacts.length }}个）</h4>
          <div class="artifacts-list">
            <div v-for="artifact in selectedTask.artifacts" :key="artifact.id" class="artifact-card">
              <div class="artifact-icon">
                <MsIcon v-if="artifact.type === 'text'" name="description" />
                <MsIcon v-else-if="artifact.type === 'code'" name="edit" />
                <MsIcon v-else-if="artifact.type === 'report'" name="analytics" />
                <MsIcon v-else-if="artifact.type === 'image'" name="image" />
                <MsIcon v-else name="folder_open" />
              </div>
              <div class="artifact-info">
                <div class="artifact-name">{{ artifact.name }}</div>
                <div class="artifact-meta">
                  <span class="artifact-type">{{ getArtifactTypeLabel(artifact.type) }}</span>
                  <span v-if="artifact.size" class="artifact-size">{{ formatFileSize(artifact.size) }}</span>
                  <span class="artifact-time">{{ formatTime(artifact.createdAt) }}</span>
                </div>
              </div>
              <div class="artifact-actions">
                <el-button 
                  v-if="artifact.content" 
                  text 
                  size="small" 
                  @click="previewArtifact(artifact)"
                >
                  <MsIcon name="visibility" /> 预览
                </el-button>
                <el-button 
                  text 
                  size="small" 
                  type="primary"
                  @click="downloadArtifact(artifact)"
                >
                  <MsIcon name="download" /> 下载
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="selectedTask.status === 'failed'" class="section">
          <el-button type="warning" @click="retryTask(selectedTask)">
            <MsIcon name="refresh" />
            重新执行
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.tasks-view {
  padding: 24px;
}

/* 统计卡片 */
.stats-row {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  flex: 1;
  padding: 14px 16px;
  border-radius: var(--radius-card);
  background: var(--surface);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: border-color var(--transition), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-card-lift);
}

.stat-card-top {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stat-card.running { border-color: var(--running-border); }
.stat-card.completed { border-color: var(--success-border); }
.stat-card.failed { border-color: var(--danger-border); }
.stat-card.cancelled { color: var(--el-text-color-secondary); }

.stat-num {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--el-text-color-primary);
  line-height: 1.1;
}

.stat-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-top: 0;
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 表格 */
.task-input-text {
  font-size: 13px;
  color: var(--el-text-color-regular);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
  max-height: 3em;
}

/* 任务输入tooltip样式 */
:deep(.task-input-tooltip) {
  max-width: 600px !important;
  max-height: 400px !important;
  overflow-y: auto !important;
  white-space: pre-wrap !important;
  word-wrap: break-word !important;
  font-size: 13px !important;
  line-height: 1.6 !important;
}

.duration {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
}

/* 分页 */
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

/* 详情弹窗 */
.task-detail {
  padding: 8px 0;
}

.task-id {
  cursor: pointer;
  font-family: monospace;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--el-color-primary);
}

.task-id:hover {
  text-decoration: underline;
}

.section {
  margin-top: 20px;
}

.section h4 {
  margin-bottom: 10px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.content-block {
  background: var(--el-fill-color-lighter);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 400px;
  overflow-y: auto;
}

.result-block {
  border-left: 3px solid var(--el-color-success);
}

/* 输出物展示区 */
.artifacts-list { display: flex; flex-direction: column; gap: 10px; }
.artifact-card { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--el-fill-color-lighter); border-radius: 8px; border: 1px solid var(--el-border-color-light); transition: all 0.2s; }
.artifact-card:hover { border-color: var(--el-color-primary-light-3); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.artifact-icon { font-size: 28px; color: var(--el-color-primary); flex-shrink: 0; }
.artifact-info { flex: 1; min-width: 0; }
.artifact-name { font-size: 14px; font-weight: 500; color: var(--el-text-color-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artifact-meta { display: flex; gap: 8px; align-items: center; margin-top: 4px; font-size: 11px; color: var(--el-text-color-secondary); }
.artifact-type { background: var(--el-color-info-light-9); padding: 1px 6px; border-radius: 3px; font-size: 10px; }
.artifact-size { color: var(--el-text-color-placeholder); }
.artifact-time { color: var(--el-text-color-placeholder); }
.artifact-actions { display: flex; gap: 4px; flex-shrink: 0; }

/* 操作按钮 */
.section-actions { margin-top: 12px; display: flex; gap: 8px; }

/* AI审核结果 */
.review-scope-hint { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; margin-bottom: 10px; }
.review-results { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
.review-card { padding: 14px; border-radius: 8px; border: 1px solid var(--el-border-color-light); background: var(--el-fill-color-lighter); }
/* 左边框只反映「这个审核员自己的评分」，不代表交付物结论 */
.review-card.review-scored-high { border-left: 3px solid var(--el-color-success); }
.review-card.review-scored-low { border-left: 3px solid var(--el-border-color); }
.review-card.review-veto { border-left: 3px solid var(--el-color-danger); }
.review-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.review-name { font-weight: 500; color: var(--el-text-color-primary); }
.review-score { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.score-label { font-size: 13px; color: var(--el-text-color-secondary); }
.score-value { font-size: 18px; font-weight: 600; }
.score-high { color: var(--el-color-success); }
.score-low { color: var(--el-color-danger); }
.review-feedback { font-size: 12px; color: var(--el-text-color-secondary); padding: 8px; background: var(--el-fill-color); border-radius: 4px; margin-top: 6px; }
.review-summary { text-align: center; margin-top: 12px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: center; }
.review-summary .el-tag { font-size: 14px; padding: 8px 20px; }
.verdict-extra { font-size: 12px; color: var(--el-text-color-secondary); }
.muted { color: var(--el-text-color-placeholder); }
.verdict-reason {
  margin-top: 10px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
}
.failure-chip {
  margin-top: 4px;
  max-width: 100%;
}

.failure-card {
  background: var(--el-color-danger-light-9);
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: 8px;
  padding: 14px 16px;
}

.failure-content {
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.failure-content :deep(p) { margin: 6px 0; }
.failure-content :deep(ol) { margin: 6px 0 6px 20px; }
.failure-content :deep(blockquote) {
  margin: 8px 0 0;
  padding-left: 10px;
  border-left: 3px solid var(--el-color-danger-light-5);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.review-notes { margin-top: 14px; }
.review-notes-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 8px;
}
.review-notes-hint { font-size: 12px; color: var(--el-text-color-secondary); font-weight: normal; }
.review-notes-list { max-height: 380px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.review-note {
  border: 1px solid var(--el-border-color-lighter);
  border-left-width: 3px;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}
.review-note.note-blocker { border-left-color: var(--el-color-danger); }
.review-note.note-major { border-left-color: var(--el-color-warning); }
.review-note.note-minor { border-left-color: var(--el-color-info); }
.note-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.note-category { font-size: 12px; color: var(--el-text-color-secondary); }
.note-case { font-family: monospace; font-size: 12px; color: var(--el-color-primary); }
.note-desc { line-height: 1.5; }
.note-suggestion { margin-top: 4px; font-size: 12px; color: var(--el-color-success); line-height: 1.5; }

/* 成本与工作量信息 */
.cost-section { background: linear-gradient(135deg, #f8f9fc 0%, #f0f2f5 100%); border-radius: 10px; padding: 16px 20px; }
.cost-descriptions { margin-top: 12px; }
.cost-value { font-weight: 600; font-size: 15px; color: var(--el-text-color-primary); }
.actual-cost { color: var(--el-color-primary); font-weight: 600; }
.estimated-cost { color: var(--el-color-warning); font-weight: 600; }
.manual-cost { color: var(--el-color-warning); }
.saved-cost { color: var(--el-color-success); font-size: 17px; }
.manual-hours { font-weight: 600; color: var(--el-color-warning); }
.saved-cost { font-weight: 600; }
.text-muted { color: var(--el-text-color-placeholder); }
.token-info { font-size: 12px; color: var(--el-text-color-regular); }
.model-tag { font-size: 12px; color: var(--el-color-info); background: var(--el-fill-color-light); padding: 2px 6px; border-radius: 4px; }

.tab-label { display: inline-flex; align-items: center; gap: 6px; }
.view-title, .page-title, h2, .header-title { min-width: 0; }
.view-title { display: inline-flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
