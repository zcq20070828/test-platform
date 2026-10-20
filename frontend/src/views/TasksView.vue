<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { taskApi, getAuthHeaders } from '@/api'
import type { Task, TaskStatus, Artifact } from '@/types'
import { ElMessage, ElMessageBox } from 'element-plus'
import { escapeHtml as escapeHtmlUtil } from '@/utils/safe-html'
import {
  Search, Refresh, CopyDocument, RefreshRight,
  Document, EditPen, DataAnalysis, PictureFilled, FolderOpened, View, Download
} from '@element-plus/icons-vue'

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

function getStatusText(status: string) {
  const texts: Record<string, string> = {
    pending: '等待中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消'
  }
  return texts[status] || status
}

function formatTime(ts: string) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
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
        content += `### 审核员 ${index + 1}：${review.reviewerName}
- 评分：${review.score}分
- 状态：${review.veto ? '一票否决' : (review.passed ? '通过' : '未通过')}

`
      })
      content += `### 综合结果：${data.reviewPassed ? '✅ 审核通过' : '❌ 审核未通过'}

`
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
function viewDetail(task: Task) {
  selectedTask.value = task
  detailVisible.value = true
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
    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card" @click="statusFilter = ''">
        <span class="stat-num">{{ statusStats.total }}</span>
        <span class="stat-label">全部任务</span>
      </div>
      <div class="stat-card running" @click="statusFilter = 'running'">
        <span class="stat-num">{{ statusStats.running }}</span>
        <span class="stat-label">执行中</span>
      </div>
      <div class="stat-card completed" @click="statusFilter = 'completed'">
        <span class="stat-num">{{ statusStats.completed }}</span>
        <span class="stat-label">已完成</span>
      </div>
      <div class="stat-card failed" @click="statusFilter = 'failed'">
        <span class="stat-num">{{ statusStats.failed }}</span>
        <span class="stat-label">失败</span>
      </div>
      <div class="stat-card cancelled" @click="statusFilter = 'cancelled'">
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
          <template #prefix><el-icon><Search /></el-icon></template>
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
          <el-icon><Refresh /></el-icon>
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
            effect="dark"
            :popper-class="'task-input-tooltip'"
          >
            <template #content>
              <pre style="margin: 0; white-space: pre-wrap; word-break: break-all;">{{ formatTaskInput(row.input) }}</pre>
            </template>
            <span class="task-input-text">{{ formatTaskInput(row.input) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>

      <el-table-column prop="status" label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)" size="small" effect="dark">
            {{ getStatusText(row.status) }}
          </el-tag>
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
              <el-icon size="12"><CopyDocument /></el-icon>
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="智能体">
            {{ selectedTask.agentName }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusType(selectedTask.status)" effect="dark">
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
          <h4>💰 成本与工作量</h4>
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

        <div class="section">
          <h4>📝 任务输入</h4>
          <pre class="content-block">{{ selectedTask.input }}</pre>
        </div>

        <div v-if="selectedTask.output" class="section">
          <h4>📋 执行结果</h4>
          <div class="content-block result-block">
            <pre>{{ selectedTask.output }}</pre>
          </div>
          <div class="section-actions" v-if="selectedTask.source !== 'workflow'">
            <el-button type="primary" size="small" @click="downloadFullOutput(selectedTask)">
              <el-icon><Download /></el-icon> 完整输出物下载
            </el-button>
          </div>
        </div>

        <!-- AI审核结果 -->
        <div v-if="selectedTask.reviewResults && selectedTask.reviewResults.length > 0" class="section">
          <h4>🛡️ AI质量审核结果</h4>
          <div class="review-results">
            <div 
              v-for="(review, index) in selectedTask.reviewResults" 
              :key="index" 
              class="review-card"
              :class="{ 'review-passed': review.passed, 'review-failed': !review.passed || review.veto }"
            >
              <div class="review-header">
                <span class="review-name">{{ review.reviewerName || '审核员 ' + (index + 1) }}</span>
                <el-tag :type="review.passed && !review.veto ? 'success' : 'danger'" size="small">
                  {{ review.veto ? '一票否决' : (review.passed ? '通过' : '未通过') }}
                </el-tag>
              </div>
              <div class="review-score">
                <span class="score-label">评分：</span>
                <span class="score-value" :class="{ 'score-high': review.score >= 90, 'score-low': review.score < 90 }">
                  {{ review.score }}分
                </span>
              </div>
              <div v-if="review.feedback" class="review-feedback">
                {{ review.feedback }}
              </div>
            </div>
          </div>
          <div class="review-summary">
            <el-tag v-if="selectedTask.reviewPassed" type="success" size="large" effect="dark">
              ✅ 审核通过
            </el-tag>
            <el-tag v-else type="danger" size="large" effect="dark">
              ❌ 审核未通过
            </el-tag>
          </div>
        </div>

        <!-- 输出物列表 -->
        <div v-if="selectedTask.artifacts && selectedTask.artifacts.length > 0" class="section">
          <h4>📦 输出物（{{ selectedTask.artifacts.length }}个）</h4>
          <div class="artifacts-list">
            <div v-for="artifact in selectedTask.artifacts" :key="artifact.id" class="artifact-card">
              <div class="artifact-icon">
                <el-icon v-if="artifact.type === 'text'"><Document /></el-icon>
                <el-icon v-else-if="artifact.type === 'code'"><EditPen /></el-icon>
                <el-icon v-else-if="artifact.type === 'report'"><DataAnalysis /></el-icon>
                <el-icon v-else-if="artifact.type === 'image'"><PictureFilled /></el-icon>
                <el-icon v-else><FolderOpened /></el-icon>
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
                  <el-icon><View /></el-icon> 预览
                </el-button>
                <el-button 
                  text 
                  size="small" 
                  type="primary"
                  @click="downloadArtifact(artifact)"
                >
                  <el-icon><Download /></el-icon> 下载
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="selectedTask.status === 'failed'" class="section">
          <el-button type="warning" @click="retryTask(selectedTask)">
            <el-icon><RefreshRight /></el-icon>
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
  padding: 16px 20px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.stat-card.running { border-left: 3px solid var(--el-color-warning); }
.stat-card.completed { border-left: 3px solid var(--el-color-success); }
.stat-card.failed { border-left: 3px solid var(--el-color-danger); }
.stat-card.cancelled { border-left: 3px solid var(--el-color-warning-light-3); color: var(--el-text-color-secondary); }

.stat-num {
  font-size: 28px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
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
.review-results { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
.review-card { padding: 14px; border-radius: 8px; border: 1px solid var(--el-border-color-light); background: var(--el-fill-color-lighter); }
.review-card.review-passed { border-left: 3px solid var(--el-color-success); }
.review-card.review-failed { border-left: 3px solid var(--el-color-danger); }
.review-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.review-name { font-weight: 500; color: var(--el-text-color-primary); }
.review-score { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.score-label { font-size: 13px; color: var(--el-text-color-secondary); }
.score-value { font-size: 18px; font-weight: 600; }
.score-high { color: var(--el-color-success); }
.score-low { color: var(--el-color-danger); }
.review-feedback { font-size: 12px; color: var(--el-text-color-secondary); padding: 8px; background: var(--el-fill-color); border-radius: 4px; margin-top: 6px; }
.review-summary { text-align: center; margin-top: 12px; }
.review-summary .el-tag { font-size: 14px; padding: 8px 20px; }

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
</style>
