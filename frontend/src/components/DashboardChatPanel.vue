<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed } from 'vue'
import { useMainStore } from '@/stores/main'
import { ElMessage } from 'element-plus'
import type { Agent, ChatMessage, AttachmentFile } from '@/types'
import VoiceInput from '@/components/VoiceInput.vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import {
  CircleClose, User, ChatDotRound,
  InfoFilled, Loading, SuccessFilled,
  Monitor, Document, Check, Promotion, Refresh,
  EditPen, DataAnalysis, PictureFilled, FolderOpened, View, Download, CopyDocument, ArrowRight, Upload
} from '@element-plus/icons-vue'

const props = defineProps<{
  modelValue: string
  currentAgent: Agent | null
  messages: ChatMessage[]
  isLoading: boolean
  chatMode?: { taskId: string; taskName: string } | null
  /** 只读模式：隐藏输入框与交互按钮（用于 DomainTestExecutor 嵌入页面） */
  readonly?: boolean
  /** 只读且空消息时的占位文案 */
  emptyText?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: [files?: AttachmentFile[], inputOverride?: string]
  clear: []
  decision: [data: { workflowId: string, decision: string }]
  startChat: [task: any]
  exitChat: []
}>()

const store = useMainStore()
const isChatMode = computed(() => !!props.chatMode)

// 选择历史任务对话框（方案 A：弹表格 + 搜索/筛选/分页）
const chatDialogVisible = ref(false)
const searchKeyword = ref('')
const filterAgent = ref('')
const filterStatus = ref('')
const pageNum = ref(1)
const pageSize = ref(10)

// 基础池：已完成或失败的任务
const chatBaseTasks = computed(() => (store.tasks || []).filter(t => t.status === 'completed' || t.status === 'failed'))
// 应用搜索/筛选
const filteredTasks = computed(() => chatBaseTasks.value.filter(t => {
  if (filterStatus.value && t.status !== filterStatus.value) return false
  if (filterAgent.value && t.agent !== filterAgent.value) return false
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    const hay = `${t.type || ''} ${t.agent || ''} ${t.id || ''}`.toLowerCase()
    if (!hay.includes(kw)) return false
  }
  return true
}))
// 分页
const pagedTasks = computed(() => {
  const start = (pageNum.value - 1) * pageSize.value
  return filteredTasks.value.slice(start, start + pageSize.value)
})
// 过滤变化时回到第一页
watch([searchKeyword, filterAgent, filterStatus], () => { pageNum.value = 1 })

function openChatDialog() { chatDialogVisible.value = true }
function selectChatTask(task: any) {
  chatDialogVisible.value = false
  emit('startChat', task)
}

const messagesContainer = ref<HTMLElement | null>(null)
const localInput = ref(props.modelValue)
const fileInput = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)
const attachments = ref<AttachmentFile[]>([])
const isVoiceActive = ref(false)

// 预览弹窗状态
const previewVisible = ref(false)
const previewArtifact = ref<any>(null)
const previewRenderedContent = ref('')

async function openPreview(artifact: any) {
  previewArtifact.value = artifact
  
  const fname = (artifact.name || '').toLowerCase()
  // 支持在线预览的二进制格式(docx/xlsx -> HTML),走后端预览接口
  const previewableBin = ['.docx', '.xlsx']
  if (previewableBin.some(ext => fname.endsWith(ext)) && artifact.downloadUrl) {
    try {
      const _token_ = localStorage.getItem('token')
      const previewUrl = artifact.downloadUrl.replace(/\/download$/, '/preview')
      const response = await fetch(previewUrl, { headers: _token_ ? { 'Authorization': `Bearer ${_token_}` } : {} })
      if (!response.ok) throw new Error(`预览生成失败(${response.status})`)
      previewRenderedContent.value = await response.text()
    } catch (err: any) {
      const msg = (err && err.message) ? err.message : String(err)
      previewRenderedContent.value = `<p style="color:#f56c6c;text-align:center;">预览失败：${msg}</p>`
    }
    previewVisible.value = true
    return
  }
  // 其余二进制格式仍不支持在线预览
  const otherBin = ['.pdf', '.zip', '.doc', '.xls', '.ppt', '.pptx']
  if (otherBin.some(ext => fname.endsWith(ext))) {
    previewRenderedContent.value = `<div style="text-align:center;padding:40px 20px;color:#909399;">
      <el-icon size="48" style="margin-bottom:16px;"><Document /></el-icon>
      <p style="font-size:16px;margin-bottom:8px;">该文件格式不支持在线预览</p>
      <p style="font-size:13px;color:#C0C4CC;margin-bottom:20px;">${artifact.name || ''}</p>
      <p style="font-size:13px;">请点击「下载」按钮，用对应软件打开查看</p>
    </div>`
    previewVisible.value = true
    return
  }
  
  // 加载内容
  let content = artifact.content
  if (!content && artifact.downloadUrl) {
    try {
      const _token_ = localStorage.getItem('token'); const response = await fetch(artifact.downloadUrl, { headers: _token_ ? { 'Authorization': `Bearer ${_token_}` } : {} })
      if (!response.ok) throw new Error('加载失败')
      content = await response.text()
    } catch (err: any) {
      previewRenderedContent.value = `<p style="color:#f56c6c;text-align:center;">加载失败：${err.message}</p>`
      previewVisible.value = true
      return
    }
  }
  
  // 使用 marked 渲染 markdown + highlight.js 代码高亮
  if (content) {
    const renderer = new marked.Renderer()
    renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
      const language = lang || ''
      let highlighted: string
      try {
        if (language && hljs.getLanguage(language)) {
          highlighted = hljs.highlight(text, { language }).value
        } else {
          highlighted = hljs.highlightAuto(text).value
        }
      } catch {
        highlighted = text
      }
      return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">${language || 'code'}</span></div><pre class="code-block-pre"><code class="hljs language-${language}">${highlighted}</code></pre></div>`
    }
    marked.use({ renderer, breaks: true, gfm: true })
    previewRenderedContent.value = marked.parse(content) as string
  } else {
    previewRenderedContent.value = '<p style="color:#999;text-align:center;">无预览内容</p>'
  }
  previewVisible.value = true
}

async function useArtifactAsInput(artifact: any) {
  let content = artifact.content
  
  if (!content && artifact.downloadUrl) {
    try {
      const _token_ = localStorage.getItem('token'); const response = await fetch(artifact.downloadUrl, { headers: _token_ ? { 'Authorization': `Bearer ${_token_}` } : {} })
      if (!response.ok) throw new Error('加载失败')
      content = await response.text()
    } catch (err: any) {
      ElMessage.error(`加载失败：${err.message}`)
      return
    }
  }
  
  if (!content) {
    ElMessage.warning('该输出物没有内容可用作输入')
    return
  }
  
  // 追加到输入框
  const prefix = localInput.value ? localInput.value.trim() + '\n\n--- 以下为输出物内容 ---\n\n' : ''
  localInput.value = prefix + content
  emit('update:modelValue', localInput.value)
  ElMessage.success('已添加到输入框，可发送进行下一步操作')
}

async function scrollToBottom() {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

watch(() => props.messages, scrollToBottom, { deep: true })
watch(() => props.modelValue, (val) => { localInput.value = val })
watch(localInput, (val) => { emit('update:modelValue', val) })

function handleSend() {
  console.log('[ChatPanel] handleSend called', {
    localInput: localInput.value,
    localInputTrim: localInput.value.trim(),
    attachmentsCount: attachments.value.length
  })
  if (!localInput.value.trim() && attachments.value.length === 0) {
    console.log('[ChatPanel] Early return: empty input')
    return
  }
  console.log('[ChatPanel] Emitting send event')
  // 保存当前输入和附件（在清空之前）
  const currentAttachments = attachments.value.length > 0 ? [...attachments.value] : undefined
  const currentInput = localInput.value
  
  // 先清空附件
  attachments.value = []
  
  // 【关键修复】通过 emit 传递当前输入值
  // 这样父组件 handleSendTask 可以立即获取到值，而不需要依赖 prop
  emit('send', currentAttachments, currentInput)
  
  // 清空本地输入
  localInput.value = ''
  emit('update:modelValue', '')
}

function handleDragOver() { isDragOver.value = true }
function handleDragLeave() { isDragOver.value = false }

function handleDrop(e: DragEvent) {
  e.preventDefault()  // 阻止浏览器默认行为（打开文件）
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files) {
    Array.from(files).forEach(file => {
      if (!checkFileSize(file)) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const mimeType = file.type || guessMimeType(file.name)
        attachments.value.push({ name: file.name, size: file.size, type: mimeType, dataUrl: ev.target?.result as string })
      }
      reader.readAsDataURL(file)
    })
  }
}

function guessMimeType(name: string): string {
  const ext = '.' + (name.split('.').pop() || '').toLowerCase()
  const map: Record<string, string> = {
    '.md': 'text/markdown', '.markdown': 'text/markdown',
    '.txt': 'text/plain', '.log': 'text/plain',
    '.json': 'application/json', '.xml': 'application/xml',
    '.csv': 'text/csv', '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pdf': 'application/pdf',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  }
  return map[ext] || 'application/octet-stream'
}

// 上传文件大小限制:单文件不超过 50MB(与后端 multer limits 一致)
const MAX_FILE_SIZE = 50 * 1024 * 1024

function checkFileSize(file: File): boolean {
  if (file.size > MAX_FILE_SIZE) {
    ElMessage.error(`文件 ${file.name} 超过 50MB 限制，已跳过`)
    return false
  }
  return true
}

function handleFileSelect() { fileInput.value?.click() }

function handleFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files) {
    Array.from(files).forEach(file => {
      if (!checkFileSize(file)) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const mimeType = file.type || guessMimeType(file.name)
        attachments.value.push({ name: file.name, size: file.size, type: mimeType, dataUrl: ev.target?.result as string })
      }
      reader.readAsDataURL(file)
    })
  }
  ;(e.target as HTMLInputElement).value = ''
}

function removeAttachment(index: number) { attachments.value.splice(index, 1) }
function handleVoiceResult(text: string) { localInput.value += text; emit('update:modelValue', localInput.value) }

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * 简易 Markdown 渲染：代码块带复制按钮，标题加粗，列表缩进
 */
function renderContent(text: string): string {
  if (!text) return ''
  let html = escapeHtml(text)
  // 代码块：```lang\ncode```
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m: string, lang: string, code: string) => {
    const id = 'cb-' + Math.random().toString(36).substr(2, 8)
    return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">${lang || 'code'}</span><button class="code-block-copy" onclick="navigator.clipboard.writeText(document.getElementById('${id}')?.textContent||'').then(()=>{const b=this;b.textContent='已复制!';setTimeout(()=>b.textContent='复制',1500)})">复制</button></div><pre class="code-block-pre"><code id="${id}">${code}</code></pre></div>`
  })
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
  // 标题
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_m: string, level: string, title: string) => {
    const n = level.length
    return `<h${n} class="md-heading md-h${n}">${title}</h${n}>`
  })
  // 加粗
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // 无序列表
  html = html.replace(/^-\s+(.+)$/gm, '<li>$1</li>')
  // 有序列表
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
  // 连续 li 包装
  html = html.replace(/((?:<li>[\s\S]*?<\/li>\n?)+)/g, '<ul class="md-list">$1</ul>')
  return html
}

/**
 * 复制文本到剪贴板
 */
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败')
  }
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
// HTML 转义
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// 获取阶段名称
function getPhaseName(phase: string): string {
  const phaseMap: Record<string, string> = {
    'requirements': '需求分析',
    'design': '方案设计',
    'tasks': '任务拆解',
    'execution': '执行任务',
    'summary': '总结报告'
  }
  return phaseMap[phase] || phase
}

// 复制输出物内容
async function copyArtifactContent(artifact: any) {
  // 【修复】docx/xlsx 等二进制格式不支持复制
  const binExts = ['.docx', '.xlsx', '.pdf', '.zip', '.doc', '.xls', '.ppt', '.pptx']
  const fname = (artifact.name || '').toLowerCase()
  if (binExts.some(ext => fname.endsWith(ext))) {
    ElMessage.info('Word/Excel 文件不支持复制内容，请下载后打开查看')
    return
  }
  try {
    let content = ''
    
    if (artifact.content) {
      content = artifact.content
    } else if (artifact.downloadUrl) {
      // 从 URL 加载内容
      const _token_ = localStorage.getItem('token'); const response = await fetch(artifact.downloadUrl, { headers: _token_ ? { 'Authorization': `Bearer ${_token_}` } : {} })
      if (!response.ok) throw new Error('加载失败')
      content = await response.text()
    } else {
      ElMessage.warning('该输出物没有可复制的内容')
      return
    }
    
    await navigator.clipboard.writeText(content)
    ElMessage.success('已复制到剪贴板')
  } catch (err: any) {
    ElMessage.error(`复制失败：${err.message}`)
  }
}

// 下载输出物
async function downloadArtifact(artifact: any) {
  try {
    let blob: Blob
    let filename = artifact.name
    
    if (artifact.content) {
      // 文本内容：创建 Blob 下载
      blob = new Blob([artifact.content], { type: artifact.contentType || 'text/plain;charset=utf-8' })
    } else if (artifact.downloadUrl) {
      // 文件URL：用 fetch 带认证头下载
      const token = localStorage.getItem('token')
      const res = await fetch(artifact.downloadUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
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
    
    // 创建下载链接
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

async function handleDecision(msg: any, decision: 'continue' | 'manual_edit' | 'retry' | 'stop') {
  try {
    const decisionMap: Record<string, string> = {
      'continue': '继续',
      'manual_edit': '人工修改',
      'retry': '重新执行',
      'stop': '停止'
    }
    const decisionApiMap: Record<string, string> = {
      'continue': 'continue',
      'manual_edit': 'manual',
      'retry': 'retry',
      'stop': 'stop'
    }
    const apiPath = decisionApiMap[decision]
    const url = `/api/workflow/${msg.metadata?.workflowId || msg.metadata?.executionId}/${apiPath}`
    // 重新执行时：找到原始用户输入，一起发给后端，避免后端要求重新输入
    let body: string | null = null
    if (decision === 'manual_edit') {
      body = JSON.stringify({ reason: '用户选择人工修改' })
    } else if (decision === 'retry') {
      // 找到第一条 user 消息（原始任务输入）
      const firstUserMsg = props.messages.find(m => m.role === 'user')
      if (firstUserMsg?.content) {
        body = JSON.stringify({ input: firstUserMsg.content })
      }
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body
    })
    if (!response.ok) throw new Error('决策失败')
    emit('decision', { workflowId: msg.metadata?.workflowId || msg.metadata?.executionId || '', decision })
    ElMessage.success(`已选择：${decisionMap[decision]}`)
  } catch (error) {
    ElMessage.error('决策失败: ' + (error as Error).message)
  }
}

function getPhaseStatusType(status: string) {
  switch (status) {
    case 'passed': return 'success'
    case 'rejected': return 'danger'
    case 'running': return 'warning'
    case 'pending': return 'info'
    default: return 'info'
  }
}

function getPhaseStatusText(status: string) {
  switch (status) {
    case 'passed': return '✅ 已通过'
    case 'rejected': return '❌ 未通过'
    case 'running': return '⏳ 执行中'
    case 'pending': return '⏸ 等待中'
    case 'retry': return '🔄 重试中'
    default: return status
  }
}

function getAgentEmoji(agentId: string | undefined): string {
  const emojiMap: Record<string, string> = {
    'test-master': '👑', 'test-requirement-analyzer': '🔍', 'test-scheme-generator': '📋',
    'test-case-generator': '✅', 'test-data-generator': '📊', 'api-executor': '🔌',
    'ui-e2e-executor': '🖥️', 'knowledge-manager': '📚', 'test-reporter': '📊', 'defect-analyzer': '🐛', 'data-masking': '🎭', 'ai-quality-reviewer-1': '🤖', 'ai-quality-reviewer-2': '🤖', 'ai-quality-reviewer-3': '🤖', 'default': '🤖'
  }
  return emojiMap[agentId || ''] || '🤖'
}

function getStepIcon(type: string) {
  switch (type) { case 'thinking': return 'Cpu'; case 'tool_call': return 'Tools'; case 'tool_result': return 'Check'; case 'step': return 'Monitor'; default: return 'Document' }
}

function getStepTypeLabel(type: string) {
  switch (type) { case 'thinking': return '思考'; case 'tool_call': return '工具调用'; case 'tool_result': return '工具结果'; case 'step': return '步骤'; case 'output': return '输出'; case 'workflow_start': return '工作流启动'; case 'phase_start': return '阶段开始'; case 'executor_call': return '调用执行智能体'; case 'review_start': return '启动审核'; case 'review_result': return '审核结果'; case 'phase_complete': return '阶段完成'; case 'workflow_complete': return '工作流完成'; default: return type }
}

onMounted(() => { scrollToBottom() })
</script>

<template>
  <div class="dashboard-chat-panel">
    <!-- 头部：智能体信息（紧凑单行布局） -->
    <div class="panel-header">
      <div class="agent-info-compact">
        <span class="agent-emoji">{{ currentAgent ? getAgentEmoji(currentAgent.id) : '🤖' }}</span>
        <span class="agent-name-compact">{{ currentAgent?.name || '测试主控' }}</span>
        <span class="agent-desc-compact">{{ currentAgent?.description || currentAgent?.desc || '测试主控Agent,调度中枢' }}</span>
      </div>
      <div class="header-actions" v-if="!readonly">
        <el-button link @click="openChatDialog">
          <el-icon><ChatDotRound /></el-icon>
          继续对话
        </el-button>
        <el-button link @click="emit('clear')">
          <el-icon><CircleClose /></el-icon>
          清空
        </el-button>
      </div>
    </div>

    <!-- 对话模式标签 -->
    <div v-if="isChatMode && !readonly" class="chat-mode-banner">
      <span>💬 对话中：{{ props.chatMode?.taskName }}</span>
      <el-button text size="small" @click="emit('exitChat')"><el-icon><CircleClose /></el-icon> 退出</el-button>
    </div>

    <!-- 消息区域 -->
    <div class="messages-container" ref="messagesContainer">
      <div v-if="messages.length === 0" class="empty-state">
        <template v-if="!readonly">
        <div class="empty-icon-wrap">
          <el-icon :size="48"><ChatDotRound /></el-icon>
          <span class="live-dot"></span>
        </div>
        <p class="empty-title">测试中台 · 流式交互</p>
        <p class="hint">输入需求后，所有智能体的输出将在此实时同步展示：<br/>
          <span class="hint-tags">
            <el-tag size="small" effect="plain" type="warning">💭 Test-Master 思考过程</el-tag>
            <el-tag size="small" effect="plain" type="primary">🔧 工具调用</el-tag>
            <el-tag size="small" effect="plain" type="success">📋 子智能体输出</el-tag>
          </span>
        </p>
        <div class="empty-divider"></div>
        <p class="hint-secondary">支持全自动和人机交互两种工作模式，按时间先后顺序实时同步所有智能体的完整工作过程</p>
        </template>
        <template v-else>
          <el-icon :size="48"><ChatDotRound /></el-icon>
          <p class="empty-title">{{ emptyText || '⏳ 等待阶段开始…' }}</p>
        </template>
      </div>

      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="message-item"
        :class="{ 'user-message': msg.role === 'user', 'agent-message': msg.role === 'assistant' }"
      >
        <!-- 用户消息 -->
        <div v-if="msg.role === 'user'" class="message-content user-content">
          <div class="message-bubble user-bubble">
            <div class="message-text">{{ msg.content }}</div>
            <div class="message-time">{{ formatTime(msg.timestamp) }}<span v-if="msg.versionLabel" style="background:#fff7e6;color:#d46b08;border:1px solid #ffd591;border-radius:4px;padding:0 6px;font-size:11px;margin-left:6px;">{{ msg.versionLabel }}</span></div>
          </div>
          <el-avatar :size="32" class="user-avatar">
            <el-icon><User /></el-icon>
          </el-avatar>
        </div>

        <!-- 系统消息 -->
        <div v-else-if="msg.role === 'system'" class="message-content system-content">
          <div class="message-bubble system-bubble">
            <div class="message-text">{{ msg.content }}</div>
            <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
          </div>
        </div>

        <!-- 智能体消息 -->
        <div v-else class="message-content agent-content">
          <el-avatar :size="32" class="agent-avatar-icon">
            {{ msg.agentIcon || '🤖' }}
          </el-avatar>
          <div class="message-bubble agent-bubble">
            <!-- 智能体执行头：显示执行者名称和状态 -->
            <div class="agent-header-badge">
              <span class="agent-badge-icon">{{ msg.agentIcon || '🤖' }}</span>
              <span class="agent-badge-name">{{ msg.agentName || '智能体' }}</span>
              <span v-if="msg.isStreaming" class="agent-badge-streaming">
                <span class="live-dot"></span>执行中
              </span>
              <span v-if="msg.versionLabel" style="background:#e6f7ff;color:#088;border:1px solid #91d5ff;border-radius:4px;padding:0 6px;font-size:11px;margin-left:6px;">{{ msg.versionLabel }}</span>
            </div>
            <div v-if="msg.thinking && msg.thinking.length > 0" class="thinking-section" :class="{ 'thinking-live': msg.isStreaming }">
              <el-collapse :model-value="msg.isStreaming ? ['thinking'] : []">
                <el-collapse-item name="thinking">
                  <template #title>
                    <span class="thinking-title">
                      <span>💭 思考过程</span>
                      <span v-if="msg.isStreaming" class="live-dot" style="margin-left: 6px"></span>
                      <span v-if="!msg.isStreaming" class="thinking-count">({{ msg.thinking.length }}步)</span>
                    </span>
                  </template>
                  <div class="thinking-steps">
                    <div v-for="step in msg.thinking" :key="step.id" class="thinking-step" :class="'step-' + step.type">
                      <div class="step-header">
                        <el-icon><component :is="getStepIcon(step.type)" /></el-icon>
                        <span class="step-type">{{ getStepTypeLabel(step.type) }}</span>
                        <span class="step-time">{{ formatTime(step.timestamp) }}</span>
                      </div>
                      <div class="step-content">
                        <div v-if="step.type === 'tool_call'" class="tool-call">
                          <span class="step-tool-name">🔧 {{ step.toolName }}</span>
                          <pre>{{ step.content }}</pre>
                        </div>
                        <div v-else-if="step.type === 'tool_result'" class="tool-result">
                          <pre>{{ step.toolResult || step.content }}</pre>
                        </div>
                        <div v-else>{{ step.content }}</div>
                      </div>
                    </div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>

            <!-- 工作流阶段信息 -->
            <div v-if="msg.metadata?.workflowPhase" class="workflow-phase-info">
              <el-icon><InfoFilled /></el-icon>
              <span>当前阶段：{{ getPhaseName(msg.metadata.workflowPhase) }}</span>
            </div>

            <!-- 智能体输出内容 -->
            <div v-if="msg.content" class="message-text" v-html="renderContent(msg.content)"></div>

            <!-- 输出物列表 -->
            <div v-if="msg.artifacts && msg.artifacts.length > 0" class="artifacts-section">
              <div class="artifacts-label">
                <el-icon><Document /></el-icon>
                输出物（{{ msg.artifacts.length }}个）
              </div>
              <div class="artifacts-list">
                <div v-for="artifact in msg.artifacts" :key="artifact.id" class="artifact-card">
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
                      v-if="artifact.content || artifact.downloadUrl"
                      text size="small"
                      @click="openPreview(artifact)"
                    >
                      <el-icon><View /></el-icon> 预览
                    </el-button>
                    <el-button
                      text size="small" type="info"
                      @click="copyArtifactContent(artifact)"
                    >
                      <el-icon><CopyDocument /></el-icon> 复制
                    </el-button>
                    <el-button
                      v-if="artifact.content || artifact.downloadUrl"
                      text size="small" type="success"
                      @click="useArtifactAsInput(artifact)"
                    >
                      <el-icon><ArrowRight /></el-icon> 用作输入
                    </el-button>
                    <el-button
                      text size="small" type="primary"
                      @click="downloadArtifact(artifact)"
                    >
                      <el-icon><Download /></el-icon> 下载
                    </el-button>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="msg.type === 'user_decision' || msg.metadata?.requireDecision" class="decision-buttons">
              <el-button type="primary" size="small" @click="handleDecision(msg, 'continue')"><el-icon><Check /></el-icon> 继续下一阶段</el-button>
              <el-button type="warning" size="small" @click="handleDecision(msg, 'manual_edit')">✏️ 人工修改</el-button>
              <el-button type="info" size="small" @click="handleDecision(msg, 'retry')"><el-icon><Refresh /></el-icon> 重新执行本阶段</el-button>
              <el-button type="danger" size="small" @click="handleDecision(msg, 'stop')"><el-icon><CircleClose /></el-icon> 停止工作流</el-button>
            </div>

            <div v-if="msg.isStreaming && !msg.content && (!msg.thinking || msg.thinking.length === 0)" class="streaming-indicator">
              <span class="pulse-ring"></span>
              <el-icon class="is-loading"><Loading /></el-icon>
              <span>正在思考...</span>
            </div>

            <div class="message-meta">
              <span class="agent-name-label">{{ msg.agentName || '智能体' }}</span>
              <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isLoading" class="loading-indicator">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>智能体正在思考...</span>
      </div>
    </div>

    <!-- 输入区域（只读模式隐藏） -->
    <div class="input-section" v-if="!readonly">
      <div v-if="attachments.length > 0" class="attachments-preview">
        <div v-for="(file, index) in attachments" :key="index" class="attachment-item">
          <img v-if="file.type?.startsWith('image/') && file.dataUrl" :src="file.dataUrl" class="attachment-image" />
          <div v-else class="attachment-file">
            <el-icon><Document /></el-icon>
            <div class="file-info">
              <span class="file-name">{{ file.name }}</span>
              <span class="file-size">{{ (file.size / 1024).toFixed(1) }}KB</span>
            </div>
          </div>
          <el-button class="remove-attachment" text size="small" @click="removeAttachment(index)">
            <el-icon><CircleClose /></el-icon>
          </el-button>
        </div>
      </div>

      <div class="input-box" :class="{ 'drag-over': isDragOver }" @dragover.prevent="handleDragOver" @dragleave.prevent="handleDragLeave" @drop="handleDrop">
        <div class="input-toolbar">
          <el-button text @click="handleFileSelect"><el-icon><Document /></el-icon></el-button>
          <el-button text @click="isVoiceActive = !isVoiceActive"><el-icon><ChatDotRound /></el-icon></el-button>
          <input ref="fileInput" type="file" multiple style="display: none" @change="handleFileChange" />
        </div>
        <el-input v-model="localInput" type="textarea" :rows="3" :placeholder="isChatMode ? '继续对话，补充需求或修改交付物…（Enter 发送）' : '输入您的需求...（Shift+Enter 换行，Enter 发送）'" resize="none" @keydown.enter.exact.prevent="handleSend" @keydown.shift.enter.prevent="localInput += '\n'" />
        <div class="input-actions">
          <VoiceInput v-if="isVoiceActive" @result="handleVoiceResult" />
          <el-button type="primary" :loading="isLoading" :disabled="!localInput.trim() && attachments.length === 0" @click="handleSend">
            <el-icon v-if="!isLoading"><Promotion /></el-icon>
            {{ isLoading ? '执行中...' : (isChatMode ? '发送对话' : '发送') }}
          </el-button>
        </div>
      </div>

      <div class="input-hint">
        <el-icon><InfoFilled /></el-icon>
        <span>支持拖拽文件、图片到输入框 | Shift+Enter 换行</span>
      </div>
    </div>
  </div>

  <!-- 输出物预览弹窗 -->
  <el-dialog
    v-model="previewVisible"
    :title="previewArtifact?.name || '输出物预览'"
    width="800px"
    :destroy-on-close="true"
    class="artifact-preview-dialog"
  >
    <div class="preview-meta" v-if="previewArtifact">
      <el-tag size="small" type="info">{{ previewArtifact.type?.toUpperCase() }}</el-tag>
      <span class="preview-size" v-if="previewArtifact.size">{{ formatFileSize(previewArtifact.size) }}</span>
      <div class="preview-actions">
        <el-button size="small" type="success" plain @click="useArtifactAsInput(previewArtifact)">
          <el-icon><ArrowRight /></el-icon> 用作输入
        </el-button>
        <el-button size="small" type="primary" plain @click="downloadArtifact(previewArtifact)">
          <el-icon><Download /></el-icon> 下载
        </el-button>
        <el-button size="small" plain @click="copyToClipboard(previewArtifact.content)">
          <el-icon><CopyDocument /></el-icon> 复制
        </el-button>
      </div>
    </div>
    <div class="preview-content" v-html="previewRenderedContent"></div>
    <template #footer>
      <el-button @click="previewVisible = false">关闭</el-button>
      <el-button type="success" @click="useArtifactAsInput(previewArtifact)">
        <el-icon><ArrowRight /></el-icon> 用作输入
      </el-button>
    </template>
  </el-dialog>

  <!-- 选择历史任务继续对话（方案 A：弹表格 + 搜索/筛选/分页）-->
  <el-dialog v-model="chatDialogVisible" title="选择历史任务继续对话" width="820px" :destroy-on-close="true">
    <div class="chat-history-filter">
      <el-input v-model="searchKeyword" placeholder="搜索任务名 / agent / ID" clearable style="width:240px;" />
      <el-select v-model="filterAgent" placeholder="全部 agent" clearable filterable style="width:200px;">
        <el-option v-for="a in (store.agents || [])" :key="a.id" :label="a.name || a.id" :value="a.id" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width:140px;">
        <el-option label="已完成" value="completed" />
        <el-option label="失败" value="failed" />
      </el-select>
    </div>
    <el-table :data="pagedTasks" @row-click="selectChatTask" stripe style="width:100%;margin-top:12px;cursor:pointer;" max-height="420">
      <el-table-column label="任务名" min-width="160">
        <template #default="{ row }">{{ row.type || row.agent || '任务' }}</template>
      </el-table-column>
      <el-table-column label="Agent" min-width="180">
        <template #default="{ row }">{{ getAgentEmoji(row.agent) }} {{ row.agent }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'completed' ? 'success' : 'danger'" size="small">{{ row.status === 'completed' ? '已完成' : '失败' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatTime(row.created_at || row.startTime || '') }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="pageNum"
      v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50]"
      :total="filteredTasks.length"
      layout="total, sizes, prev, pager, next"
      style="margin-top:12px;justify-content:flex-end;display:flex;" />
  </el-dialog>
</template>

<style scoped>
.dashboard-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-bg-color);
  border-radius: 8px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--el-color-primary-light-9);
  border-bottom: 1px solid var(--el-border-color-light);
}

.agent-info-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.agent-emoji {
  font-size: 18px;
  line-height: 1;
}

.agent-name-compact {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.agent-desc-compact {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.header-actions .el-button {
  padding: 4px 8px;
  font-size: 12px;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: calc(100% + 400px);
  color: var(--el-text-color-secondary);
  gap: 8px;
  padding: 24px;
}

.empty-title { font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); margin: 8px 0 4px; }
.empty-icon-wrap { position: relative; display: inline-flex; }
.empty-state .hint { font-size: 13px; color: var(--el-text-color-secondary); text-align: center; line-height: 1.8; }
.hint-tags { display: inline-flex; gap: 6px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
.empty-divider { width: 60px; height: 1px; background: var(--el-border-color-lighter); margin: 12px 0; }
.hint-secondary { font-size: 12px; color: var(--el-text-color-placeholder); text-align: center; }

.live-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--el-color-success);
  display: inline-block; position: relative; vertical-align: middle;
}
.live-dot::after {
  content: ''; position: absolute; inset: -3px; border-radius: 50%;
  background: var(--el-color-success); opacity: 0.4;
  animation: live-pulse 1.5s ease-in-out infinite;
}
.empty-icon-wrap .live-dot { position: absolute; top: -2px; right: -2px; }

.message-item { display: flex; gap: 12px; width: 100%; }
.user-message { flex-direction: row-reverse; }
.agent-message { }
.message-content { display: flex; gap: 8px; align-items: flex-start; flex: 1; min-width: 0; }
.message-bubble { padding: 12px 16px; border-radius: 12px; position: relative; word-break: break-word; flex: 1; min-width: 0; }
.user-bubble { background: var(--el-color-primary); color: white; border-bottom-right-radius: 4px; }
.agent-bubble { background: var(--el-bg-color-page); border: 1px solid var(--el-border-color-light); border-bottom-left-radius: 4px; }
.system-bubble { background: var(--el-color-info-light-9); border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: var(--el-text-color-secondary); max-width: 80%; margin: 8px auto; }
.message-text { line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.message-text :deep(.code-block-wrapper) { margin: 8px 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--el-border-color-light); }
.message-text :deep(.code-block-header) { display: flex; justify-content: space-between; align-items: center; padding: 4px 12px; background: var(--el-fill-color-light); font-size: 12px; color: var(--el-text-color-secondary); }
.message-text :deep(.code-block-lang) { font-family: monospace; }
.message-text :deep(.code-block-copy) { border: none; background: none; cursor: pointer; color: var(--el-color-primary); font-size: 12px; padding: 2px 8px; border-radius: 3px; transition: background 0.2s; }
.message-text :deep(.code-block-copy:hover) { background: var(--el-color-primary-light-9); }
.message-text :deep(.code-block-pre) { margin: 0; padding: 12px; background: #1e1e2e; color: #cdd6f4; font-size: 13px; line-height: 1.5; overflow-x: auto; }
.message-text :deep(.inline-code) { padding: 1px 6px; background: var(--el-fill-color); border-radius: 3px; font-family: monospace; font-size: 0.9em; color: var(--el-color-danger); }
.message-text :deep(.md-heading) { margin: 12px 0 6px; font-weight: 600; }
.message-text :deep(.md-h1) { font-size: 1.3em; }
.message-text :deep(.md-h2) { font-size: 1.15em; }
.message-text :deep(.md-h3) { font-size: 1.05em; }
.message-text :deep(.md-list) { margin: 4px 0; padding-left: 20px; }
.message-text :deep(.md-list li) { margin: 2px 0; }
.message-text :deep(strong) { font-weight: 600; color: var(--el-text-color-primary); }
.message-meta { display: flex; gap: 8px; align-items: center; margin-top: 4px; font-size: 11px; color: var(--el-text-color-placeholder); }
.message-time { font-size: 11px; color: var(--el-text-color-placeholder); }

.thinking-section { margin-bottom: 12px; border-radius: 8px; overflow: hidden; }
.thinking-live { border: 1px solid var(--el-color-success-light-5); background: var(--el-color-success-light-9); }
.thinking-title { display: flex; align-items: center; }
.thinking-count { font-size: 12px; color: var(--el-text-color-placeholder); margin-left: 4px; }
.thinking-steps { display: flex; flex-direction: column; gap: 8px; }
.thinking-step { padding: 8px; border-radius: 6px; border-left: 3px solid var(--el-color-info); }
.step-thinking { border-left-color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
.step-tool_call { border-left-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.step-tool-name { font-size: 12px; font-weight: 600; color: var(--el-color-primary); display: inline-block; padding: 2px 8px; background: var(--el-color-primary-light-8); border-radius: 4px; margin-bottom: 6px; }
.step-tool_result { border-left-color: var(--el-color-success); background: var(--el-color-success-light-9); }
.step-step { border-left-color: var(--el-color-info); background: var(--el-color-info-light-9); }
.step-output { border-left-color: var(--el-color-success); background: var(--el-color-success-light-9); }
.step-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 12px; font-weight: 600; }
.step-type { flex: 1; }
.step-time { font-size: 11px; color: var(--el-text-color-placeholder); }
.step-content { font-size: 13px; line-height: 1.5; }
.step-content pre { margin: 8px 0 0 0; padding: 8px; background: var(--el-bg-color); border-radius: 4px; overflow-x: auto; font-size: 12px; }

.streaming-indicator { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--el-color-primary); }
.pulse-ring { width: 10px; height: 10px; border-radius: 50%; background: var(--el-color-primary); position: relative; }
.pulse-ring::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--el-color-primary); animation: live-pulse 1.5s ease-in-out infinite; }

.typing-cursor { animation: blink-cursor 0.8s steps(2) infinite; color: var(--el-color-primary); font-weight: bold; }
.is-streaming-text { position: relative; }

@keyframes live-pulse { 0%, 100% { transform: scale(1); opacity: 0.4; } 50% { transform: scale(1.6); opacity: 0; } }
@keyframes blink-cursor { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 1; } }

.loading-indicator { display: flex; align-items: center; gap: 8px; padding: 12px; color: var(--el-color-primary); font-size: 14px; }

.input-section { border-top: 1px solid var(--el-border-color-light); padding: 16px; background: var(--el-bg-color); }
.attachments-preview { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.attachment-item { position: relative; border: 1px solid var(--el-border-color); border-radius: 6px; padding: 4px; max-width: 180px; }
.attachment-image { max-width: 100%; max-height: 80px; border-radius: 4px; display: block; }
.attachment-file { display: flex; align-items: center; gap: 6px; padding: 6px 8px; font-size: 12px; min-width: 120px; }
.attachment-file .file-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.attachment-file .file-name { font-size: 12px; color: var(--el-text-color-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
.attachment-file .file-size { font-size: 11px; color: var(--el-text-color-secondary); }
.remove-attachment { position: absolute; top: -8px; right: -8px; padding: 0; margin: 0; }

.input-box { border: 2px dashed transparent; border-radius: 8px; padding: 12px; background: var(--el-bg-color-page); transition: all 0.3s; }
.input-box.drag-over { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.input-toolbar { display: flex; gap: 4px; margin-bottom: 8px; }
.input-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
.input-hint { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 11px; color: var(--el-text-color-placeholder); }

.user-avatar { background: var(--el-color-primary); color: white; }
.agent-avatar-icon { background: var(--el-color-success-light-7); }
.decision-buttons { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

/* 工作流阶段卡片 */
.workflow-phase-card { margin: 12px 0; padding: 16px; background: var(--el-color-info-light-9); border-radius: 8px; border-left: 4px solid var(--el-color-primary); }
.phase-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.phase-card-icon { font-size: 20px; }
.phase-card-name { font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); flex: 1; }
.phase-card-output { margin: 12px 0; }
.output-label { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; font-weight: 600; }
.output-content { background: var(--el-bg-color); padding: 10px; border-radius: 6px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; max-height: 300px; overflow-y: auto; border: 1px solid var(--el-border-color-lighter); }
.phase-card-reviews { margin-top: 12px; }
.review-label { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 8px; font-weight: 600; }
.review-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin: 6px 0; border-radius: 6px; font-size: 13px; flex-wrap: wrap; }
.review-passed { background: var(--el-color-success-light-9); border: 1px solid var(--el-color-success-light-5); }
.review-rejected { background: var(--el-color-danger-light-9); border: 1px solid var(--el-color-danger-light-5); }
.review-agent { font-weight: 600; color: var(--el-text-color-primary); }
.review-score { color: var(--el-color-warning); font-weight: 600; }
.review-feedback { flex-basis: 100%; margin-top: 4px; font-size: 12px; color: var(--el-text-color-secondary); padding-left: 4px; border-left: 2px solid var(--el-border-color); }

/* 并行审核进度 */
.review-progress { margin: 12px 0; padding: 12px; background: var(--el-color-warning-light-9); border-radius: 8px; border: 1px solid var(--el-color-warning-light-5); }
.review-progress-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--el-color-warning); margin-bottom: 10px; }
.review-progress-bar { height: 6px; background: var(--el-border-color-lighter); border-radius: 3px; overflow: hidden; margin-bottom: 10px; }
.review-progress-fill { height: 100%; background: linear-gradient(90deg, var(--el-color-warning), var(--el-color-success)); border-radius: 3px; transition: width 0.5s ease; }
.review-progress-list { display: flex; flex-direction: column; gap: 6px; }
.reviewer-status { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-radius: 4px; font-size: 12px; }
.reviewer-status.waiting { background: var(--el-color-info-light-9); color: var(--el-text-color-placeholder); }
.reviewer-status.running { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.reviewer-status.done { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.reviewer-name { font-weight: 600; }
.reviewer-status-text { font-size: 11px; }

/* 输出物展示区 */
.artifacts-section { margin: 12px 0; padding: 12px; background: var(--el-color-primary-light-9); border-radius: 8px; border: 1px solid var(--el-color-primary-light-5); }
.artifacts-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--el-color-primary); margin-bottom: 10px; }
.artifacts-list { display: flex; flex-direction: column; gap: 8px; }
.artifact-card { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--el-bg-color); border-radius: 6px; border: 1px solid var(--el-border-color-light); transition: all 0.2s; }
.artifact-card:hover { border-color: var(--el-color-primary-light-3); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.artifact-icon { font-size: 24px; color: var(--el-color-primary); flex-shrink: 0; }
.artifact-info { flex: 1; min-width: 0; }
.artifact-name { font-size: 14px; font-weight: 500; color: var(--el-text-color-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artifact-meta { display: flex; gap: 8px; align-items: center; margin-top: 4px; font-size: 11px; color: var(--el-text-color-secondary); }
.artifact-type { background: var(--el-color-info-light-9); padding: 1px 6px; border-radius: 3px; font-size: 10px; }
.artifact-size { color: var(--el-text-color-placeholder); }
.artifact-time { color: var(--el-text-color-placeholder); }
.artifact-actions { display: flex; gap: 4px; flex-shrink: 0; }

/* 智能体执行头：气泡内顶部标识 */
.agent-header-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.agent-badge-icon { font-size: 14px; }
.agent-badge-name { color: var(--el-color-primary); font-weight: 600; }
.agent-badge-streaming {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--el-color-success);
  font-weight: 500;
  margin-left: auto;
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-success);
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

/* 预览弹窗样式 */
.preview-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  margin-bottom: 12px;
}
.preview-size { color: var(--el-text-color-secondary); font-size: 12px; }
.preview-actions { margin-left: auto; display: flex; gap: 6px; }

/* 预览内容 - markdown 渲染 */
.preview-content {
  max-height: 60vh;
  overflow-y: auto;
  line-height: 1.7;
  font-size: 14px;
}
.preview-content :deep(h1) { font-size: 1.4em; margin: 12px 0 6px; font-weight: 700; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 6px; }
.preview-content :deep(h2) { font-size: 1.2em; margin: 10px 0 5px; font-weight: 600; }
.preview-content :deep(h3) { font-size: 1.05em; margin: 8px 0 4px; font-weight: 600; }
.preview-content :deep(p) { margin: 8px 0; }
.preview-content :deep(ul), .preview-content :deep(ol) { padding-left: 20px; margin: 6px 0; }
.preview-content :deep(li) { margin: 3px 0; }
.preview-content :deep(table) { border-collapse: collapse; width: 100%; margin: 8px 0; }
.preview-content :deep(th), .preview-content :deep(td) { border: 1px solid var(--el-border-color); padding: 6px 12px; text-align: left; }
.preview-content :deep(th) { background: var(--el-fill-color-light); font-weight: 600; }
.preview-content :deep(code) { background: var(--el-fill-color); padding: 1px 5px; border-radius: 3px; font-size: 0.88em; font-family: 'Courier New', monospace; }
.preview-content :deep(.hljs) { background: #0d1117; border-radius: 6px; padding: 14px; overflow-x: auto; font-size: 13px; }
.preview-content :deep(pre) { margin: 8px 0; }
.preview-content :deep(blockquote) { border-left: 3px solid var(--el-color-primary-light-5); padding-left: 12px; color: var(--el-text-color-secondary); margin: 8px 0; }
.preview-content :deep(a) { color: var(--el-color-primary); }
.preview-content :deep(strong) { font-weight: 700; }
.preview-content :deep(hr) { border: none; border-top: 1px solid var(--el-border-color-light); margin: 12px 0; }

/* 预览弹窗内代码块 */
:deep(.artifact-preview-dialog .preview-content .hljs) {
  border-radius: 6px;
}

/* artifact-card 样式增强 */
.artifact-actions { display: flex; gap: 4px; flex-wrap: wrap; }

/* 历史任务表格弹窗 */
.chat-history-filter { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.chat-history-filter .el-pagination { width: 100%; margin-top: 12px; }

/* 对话模式标签 */
.chat-mode-banner {
  display: flex; align-items: center; justify-content: space-between;
  background: linear-gradient(90deg, #e6f7ff 0%, #f0f5ff 100%);
  border: 1px solid #91d5ff;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  color: #1677ff;
  font-weight: 600;
}

/* 历史任务卡片区 */
.history-tasks-bar { margin: 8px 0; }
.history-tasks-title { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.history-tasks-scroll {
  display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;
}
.history-task-card {
  flex: 0 0 auto;
  min-width: 120px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  background: var(--el-fill-color-blank);
  transition: all 0.15s;
}
.history-task-card:hover { border-color: var(--el-color-primary); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.history-task-card .ht-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-task-card .ht-id { font-size: 11px; color: var(--el-text-color-placeholder); font-family: monospace; margin: 2px 0; }
.history-task-card .ht-status { font-size: 11px; }
.history-task-card .ht-status.st-completed { color: #52c41a; }
.history-task-card .ht-status.st-failed { color: #f5222d; }
.history-task-card .ht-status.st-running { color: #1677ff; }
.history-task-card .ht-status.st-pending { color: #faad14; }</style>
