<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { useMainStore } from '@/stores/main'
import { ElMessage } from 'element-plus'
import type { Agent, ChatMessage, ThinkingStep, AttachmentFile } from '@/types'
import VoiceInput from '@/components/VoiceInput.vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import {
  CircleClose, User, ChatDotRound,
  InfoFilled, Loading, SuccessFilled,
  Monitor, Document, Check, Promotion,
  EditPen, DataAnalysis, PictureFilled, FolderOpened, View, Download, CopyDocument, ArrowRight
} from '@element-plus/icons-vue'

// ===== 全局 marked 配置：highlight.js 语法高亮 + 复制按钮 =====
const ThinkingIcon = 'Setting'
const Tools = 'Tools'
const _codeRenderer = new marked.Renderer()
_codeRenderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang || ''
  const uid = 'cb-' + Math.random().toString(36).substr(2, 8)
  let highlighted: string
  try {
    highlighted = (language && hljs.getLanguage(language))
      ? hljs.highlight(text, { language }).value
      : hljs.highlightAuto(text).value
  } catch {
    highlighted = text
  }
  const copyScript = `navigator.clipboard.writeText(document.getElementById("${uid}").textContent||"").then(()=>{const b=this;b.textContent="已复制!";setTimeout(()=>b.textContent="复制",1500)}).catch(()=>{this.textContent="失败"})`
  return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">${language || 'code'}</span><button class="code-block-copy" onclick="${copyScript}">复制</button></div><pre class="code-block-pre"><code id="${uid}" class="hljs language-${language}">${highlighted}</code></pre></div>`
}
marked.use({ renderer: _codeRenderer, breaks: true, gfm: true })
function renderMarkdown(text: string): string {
  if (!text) return ''
  try { return marked.parse(text) as string } catch { return escapeHtml(text) }
}
function renderContent(text: string): string { return renderMarkdown(text) }

const props = defineProps<{
  modelValue: string
  currentAgent: Agent | null
  messages: ChatMessage[]
  isLoading: boolean
  /** 简洁模式：不显示智能体选择头部 */
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: [files?: AttachmentFile[]]
  clear: []
  decision: [data: { workflowId: string, decision: string }]
}>()

const store = useMainStore()

const messagesContainer = ref<HTMLElement | null>(null)
const localInput = ref(props.modelValue)
const fileInput = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)
const attachments = ref<AttachmentFile[]>([])
const isVoiceActive = ref(false)

// 预览弹窗
const previewVisible = ref(false)
const previewArtifact = ref<any>(null)
const previewRenderedContent = ref('')

function openPreview(artifact: any) {
  previewArtifact.value = artifact
  if (artifact.content) {
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
    previewRenderedContent.value = marked.parse(artifact.content) as string
  } else {
    previewRenderedContent.value = '<p style="color:#999;text-align:center;">无预览内容</p>'
  }
  previewVisible.value = true
}

function useArtifactAsInput(artifact: any) {
  if (!artifact.content) {
    ElMessage.warning('该输出物没有内容可用作输入')
    return
  }
  const prefix = localInput.value ? localInput.value.trim() + '\n\n--- 以下为输出物内容 ---\n\n' : ''
  localInput.value = prefix + artifact.content
  emit('update:modelValue', localInput.value)
  ElMessage.success('已添加到输入框，可发送进行下一步操作')
}

// 滚动到底部
async function scrollToBottom() {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

// 监听消息变化，自动滚动
watch(() => props.messages, scrollToBottom, { deep: true })

// 同步本地输入与外部v-model
watch(() => props.modelValue, (val) => {
  localInput.value = val
})

watch(localInput, (val) => {
  emit('update:modelValue', val)
})

// 发送消息
function handleSend() {
  if (!localInput.value.trim() && attachments.value.length === 0) return
  emit('send', attachments.value.length > 0 ? [...attachments.value] : undefined)
  attachments.value = []
  localInput.value = ''
  emit('update:modelValue', '')
}

function onEnterKey(e: KeyboardEvent) {
  e.preventDefault()
  handleSend()
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

// 文件拖放
function handleDragOver() { isDragOver.value = true }
function handleDragLeave() { isDragOver.value = false }

function handleDrop(e: DragEvent) {
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files) {
    Array.from(files).forEach(file => {
      if (!checkFileSize(file)) return
      // ✅ 所有文件类型都读取 dataUrl，供 KB 上传使用
      const reader = new FileReader()
      reader.onload = (ev) => {
        attachments.value.push({
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl: ev.target?.result as string
        })
      }
      reader.readAsDataURL(file)
    })
  }
}

// 文件选择
function handleFileSelect() {
  fileInput.value?.click()
}

function handleFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files) {
    Array.from(files).forEach(file => {
      if (!checkFileSize(file)) return
      // ✅ 所有文件类型都读取 dataUrl，供 KB 上传使用
      const reader = new FileReader()
      reader.onload = (ev) => {
        attachments.value.push({
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl: ev.target?.result as string
        })
      }
      reader.readAsDataURL(file)
    })
  }
  ;(e.target as HTMLInputElement).value = ''
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1)
}

// 语音输入
function handleVoiceResult(text: string) {
  localInput.value += text
  emit('update:modelValue', localInput.value)
}

// 格式化时间
function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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

// 编辑输出物
const editingArtifact = ref<any>(null)
const editDialogVisible = ref(false)
const editContent = ref('')

function editArtifact(artifact: any) {
  if (!artifact.content) {
    ElMessage.warning('该输出物没有可编辑的内容')
    return
  }
  editingArtifact.value = artifact
  editContent.value = typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content, null, 2)
  editDialogVisible.value = true
}

function saveArtifactEdit() {
  if (editingArtifact.value) {
    editingArtifact.value.content = editContent.value
    ElMessage.success('输出物已更新')
  }
  editDialogVisible.value = false
}

function cancelArtifactEdit() {
  editDialogVisible.value = false
}

// 下载输出物
async function downloadArtifact(artifact: any) {
  try {
    let blob: Blob
    let filename = artifact.name
    
    if (artifact.content) {
      blob = new Blob([artifact.content], { type: artifact.contentType || 'text/plain;charset=utf-8' })
    } else if (artifact.downloadUrl) {
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

// 处理用户决策
async function handleDecision(msg: any, decision: 'continue' | 'manual' | 'stop') {
  try {
    let url = ''
    let method = 'POST'
    let body: any = null
    
    switch (decision) {
      case 'continue':
        url = `/api/workflow/${msg.metadata?.workflowId}/continue`
        break
      case 'manual':
        url = `/api/workflow/${msg.metadata?.workflowId}/manual`
        body = JSON.stringify({ reason: '用户选择人工处理' })
        break
      case 'stop':
        url = `/api/workflow/${msg.metadata?.workflowId}/stop`
        break
    }
    
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body
    })
    
    if (!response.ok) {
      throw new Error('决策失败')
    }
    
    const decisionText = { continue: '继续', manual: '人工处理', stop: '停止' }[decision]
    emit('decision', { workflowId: msg.metadata?.workflowId || '', decision })
    ElMessage.success(`已选择：${decisionText}`)
  } catch (error) {
    ElMessage.error('决策失败: ' + (error as Error).message)
  }
}

// 获取智能体emoji
function getAgentEmoji(agentId: string | undefined): string {
  const emojiMap: Record<string, string> = {
    'test-master': '👑',
    'test-requirement-analyzer': '🔍',
    'test-scheme-generator': '📋',
    'test-case-generator': '✅',
    'test-data-generator': '📊',
    'api-executor': '🔌',
    'ui-e2e-executor': '🖥️',
    'knowledge-manager': '📚',
    'test-reporter': '📊',
    'defect-analyzer': '🐛',
    'data-masking': '🎭',
    'ai-quality-reviewer-1': '🤖',
    'ai-quality-reviewer-2': '🤖',
    'ai-quality-reviewer-3': '🤖',
    'default': '🤖'
  }
  return emojiMap[agentId || ''] || emojiMap['default'] || '🤖'
}

// 获取步骤图标
function getStepIcon(type: string) {
  switch (type) {
    case 'thinking': return 'Cpu'
    case 'tool_call': return 'Tools'
    case 'tool_result': return 'Check'
    case 'step': return 'Monitor'
    default: return 'Document'
  }
}

// 获取步骤类型标签
function getStepTypeLabel(type: string) {
  switch (type) {
    case 'thinking': return '思考'
    case 'tool_call': return '工具调用'
    case 'tool_result': return '工具结果'
    case 'step': return '步骤'
    case 'output': return '输出'
    default: return type
  }
}

onMounted(() => {
  scrollToBottom()
})
</script>

<template>
  <div class="unified-chat-panel" :class="{ compact: compact }">
    <!-- 头部：智能体信息 -->
    <div v-if="!compact" class="panel-header">
      <div class="agent-info">
        <el-avatar :size="40" class="agent-avatar-icon">
          {{ currentAgent ? getAgentEmoji(currentAgent.id) : '🤖' }}
        </el-avatar>
        <div class="agent-details">
          <h3 class="agent-name-label">{{ currentAgent?.name || '测试主控' }}</h3>
          <p class="agent-desc">{{ currentAgent?.description || currentAgent?.desc || '测试主控Agent,调度中枢' }}</p>
        </div>
      </div>
      <div class="header-actions">
        <el-button text @click="emit('clear')">
          <el-icon><CircleClose /></el-icon>
          清空对话
        </el-button>
      </div>
    </div>

    <!-- 消息区域 -->
    <div class="messages-container" ref="messagesContainer">
      <div v-if="messages.length === 0" class="empty-state">
        <div class="empty-icon-wrap">
          <el-icon :size="48"><ChatDotRound /></el-icon>
          <span class="live-dot"></span>
        </div>
        <p class="empty-title">{{ compact ? '实时流式对话' : '测试中台 · 流式交互' }}</p>
        <p class="hint">输入需求后，所有智能体的输出将在此实时同步展示：<br/>
          <span class="hint-tags">
            <el-tag size="small" effect="plain" type="warning">💭 Test-Master 思考过程</el-tag>
            <el-tag size="small" effect="plain" type="primary">🔧 工具调用</el-tag>
            <el-tag size="small" effect="plain" type="success">📋 子智能体输出</el-tag>
          </span>
        </p>
        <div class="empty-divider"></div>
        <p class="hint-secondary">按时间先后顺序实时同步所有智能体的完整工作过程</p>
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
            <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
          </div>
          <el-avatar :size="32" class="user-avatar">
            <el-icon><User /></el-icon>
          </el-avatar>
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
            </div>
            <!-- 思考过程（流式时展开，完成后折叠） -->
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
                    <div
                      v-for="step in msg.thinking"
                      :key="step.id"
                      class="thinking-step"
                      :class="'step-' + step.type"
                    >
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
                        <div v-else>
                          {{ step.content }}
                        </div>
                      </div>
                    </div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>

            <!-- 消息文本 -->
            <div class="message-text" v-if="msg.content" :class="{ 'is-streaming-text': msg.isStreaming }">
              <span v-html="msg.isStreaming ? msg.content : renderContent(msg.content)"></span><span v-if="msg.isStreaming" class="typing-cursor">▊</span>
            </div>
            
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
                      v-if="artifact.content"
                      text size="small"
                      @click="openPreview(artifact)"
                    >
                      <el-icon><View /></el-icon> 预览
                    </el-button>
                    <el-button
                      v-if="artifact.content"
                      text size="small" type="success"
                      @click="useArtifactAsInput(artifact)"
                    >
                      <el-icon><ArrowRight /></el-icon> 用作输入
                    </el-button>
                    <el-button
                      text size="small" type="warning"
                      @click="editArtifact(artifact)"
                    >
                      <el-icon><EditPen /></el-icon> 编辑
                    </el-button>
                    <el-button
                      text size="small" type="primary"
                      @click="downloadArtifact(artifact)"
                    >
                      <el-icon><Download /></el-icon> 下载
                    </el-button>
                    <el-button
                      v-if="artifact.content"
                      text size="small"
                      @click="copyToClipboard(artifact.content)"
                    >
                      <el-icon><CopyDocument /></el-icon> 复制
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 用户决策按钮 -->
            <div v-if="msg.type === 'user_decision'" class="decision-buttons">
              <el-button type="primary" size="small" @click="handleDecision(msg, 'continue')">
                <el-icon><Check /></el-icon>
                继续
              </el-button>
              <el-button type="warning" size="small" @click="handleDecision(msg, 'manual')">
                <el-icon><Tools /></el-icon>
                人工处理
              </el-button>
              <el-button type="danger" size="small" @click="handleDecision(msg, 'stop')">
                <el-icon><CircleClose /></el-icon>
                停止
              </el-button>
            </div>
            
            <!-- 流式输出指示器 -->
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

      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-indicator">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>智能体正在思考...</span>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-section">
      <!-- 附件预览 -->
      <div v-if="attachments.length > 0" class="attachments-preview">
        <div
          v-for="(file, index) in attachments"
          :key="index"
          class="attachment-item"
        >
          <img v-if="file.dataUrl && file.type?.startsWith('image/')" :src="file.dataUrl" class="attachment-image" />
          <div v-else class="attachment-file">
            <el-icon><Document /></el-icon>
            <span>{{ file.name }}</span>
          </div>
          <el-button
            class="remove-attachment"
            text
            size="small"
            @click="removeAttachment(index)"
          >
            <el-icon><CircleClose /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 输入框 -->
      <div
        class="input-box"
        :class="{ 'drag-over': isDragOver }"
        @dragover.prevent="handleDragOver"
        @dragleave.prevent="handleDragLeave"
        @drop="handleDrop"
      >
        <div class="input-toolbar">
          <el-button text @click="handleFileSelect">
            <el-icon><Document /></el-icon>
          </el-button>
          <el-button text @click="isVoiceActive = !isVoiceActive">
            <el-icon><ChatDotRound /></el-icon>
          </el-button>
          <input
            ref="fileInput"
            type="file"
            multiple
            style="display: none"
            @change="handleFileChange"
          />
        </div>

        <el-input
          v-model="localInput"
          type="textarea"
          :rows="3"
          placeholder="输入您的需求...（Shift+Enter 换行，Enter 发送）"
          resize="none"
          @keydown.enter.exact="onEnterKey"
          @keydown.shift.enter.prevent="localInput += '\n'"
        />

        <div class="input-actions">
          <VoiceInput v-if="isVoiceActive" @result="handleVoiceResult" />
          <el-button
            type="primary"
            :loading="isLoading"
            :disabled="!localInput.trim() && attachments.length === 0"
            @click="handleSend"
          >
            <el-icon v-if="!isLoading"><Promotion /></el-icon>
            {{ isLoading ? '执行中...' : '发送' }}
          </el-button>
        </div>
      </div>

      <!-- 文件类型提示 -->
      <div class="input-hint">
        <el-icon><InfoFilled /></el-icon>
        <span>支持拖拽文件、图片到输入框 | Shift+Enter 换行</span>
      </div>
    </div>

    <!-- 输出物编辑对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑输出物" width="70%" :close-on-click-modal="false">
      <div class="edit-dialog-header">
        <span class="artifact-name">{{ editingArtifact?.name || '输出物' }}</span>
        <el-tag size="small" type="info">{{ editingArtifact?.type || 'text' }}</el-tag>
      </div>
      <el-input
        v-model="editContent"
        type="textarea"
        :autosize="{ minRows: 10, maxRows: 30 }"
        placeholder="编辑输出物内容..."
      />
      <template #footer>
        <el-button @click="cancelArtifactEdit">取消</el-button>
        <el-button type="primary" @click="saveArtifactEdit">保存</el-button>
      </template>
    </el-dialog>

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
  </div>
</template>

<style scoped>
.unified-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-bg-color);
  border-radius: 8px;
  overflow: hidden;
}

.unified-chat-panel.compact .messages-container {
  min-height: 280px;
  max-height: 50vh;
}

/* 头部 */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--el-color-primary-light-9);
  border-bottom: 1px solid var(--el-border-color-light);
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.agent-avatar-icon {
  background: var(--el-color-primary-light-7);
}

.agent-details {
  flex: 1;
}

.agent-name-label {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: var(--el-text-color-primary);
}

.agent-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

/* 消息容器 */
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
  color: var(--el-text-color-secondary);
  gap: 8px;
  padding: 24px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 8px 0 4px;
}

.empty-icon-wrap {
  position: relative;
  display: inline-flex;
}

.empty-state .hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  text-align: center;
  line-height: 1.8;
}

.hint-tags {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
}

.empty-divider {
  width: 60px;
  height: 1px;
  background: var(--el-border-color-lighter);
  margin: 12px 0;
}

.hint-secondary {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

/* 脉冲圆点 */
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-success);
  display: inline-block;
  position: relative;
  vertical-align: middle;
}

.live-dot::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  background: var(--el-color-success);
  opacity: 0.4;
  animation: live-pulse 1.5s ease-in-out infinite;
}

.empty-icon-wrap .live-dot {
  position: absolute;
  top: -2px;
  right: -2px;
}

/* 消息项 */
.message-item {
  display: flex;
  gap: 12px;
  width: 100%;
}

.user-message {
  flex-direction: row-reverse;
}

.agent-message {
}

.message-content {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
}

.message-bubble {
  padding: 12px 16px;
  border-radius: 12px;
  position: relative;
  word-break: break-word;
  flex: 1;
  min-width: 0;
}

.user-bubble {
  background: var(--el-color-primary);
  color: white;
  border-bottom-right-radius: 4px;
}

.agent-bubble {
  background: var(--el-bg-color-page);
  border: 1px solid var(--el-border-color-light);
  border-bottom-left-radius: 4px;
}

.message-text {
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
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

.message-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.message-time {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

/* 思考过程 */
.thinking-section {
  margin-bottom: 12px;
  border-radius: 8px;
  overflow: hidden;
}

.thinking-live {
  border: 1px solid var(--el-color-success-light-5);
  background: var(--el-color-success-light-9);
}

.thinking-title {
  display: flex;
  align-items: center;
}

.thinking-count {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-left: 4px;
}

.thinking-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.thinking-step {
  padding: 8px;
  border-radius: 6px;
  border-left: 3px solid var(--el-color-info);
}

.step-thinking {
  border-left-color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.step-tool_call {
  border-left-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.step-tool-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-primary);
  display: inline-block;
  padding: 2px 8px;
  background: var(--el-color-primary-light-8);
  border-radius: 4px;
  margin-bottom: 6px;
}

.step-tool_result {
  border-left-color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.step-step {
  border-left-color: var(--el-color-info);
  background: var(--el-color-info-light-9);
}

.step-output {
  border-left-color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.step-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
}

.step-type {
  flex: 1;
}

.step-time {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.step-content {
  font-size: 13px;
  line-height: 1.5;
}

.step-content pre {
  margin: 8px 0 0 0;
  padding: 8px;
  background: var(--el-bg-color);
  border-radius: 4px;
  overflow-x: auto;
  font-size: 12px;
}

.tool-call strong,
.tool-result strong {
  color: var(--el-color-primary);
}

/* 流式输出指示器 */
.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
   color: var(--el-color-primary);
}

.pulse-ring {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--el-color-primary);
  position: relative;
}

.pulse-ring::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid var(--el-color-primary);
  animation: live-pulse 1.5s ease-in-out infinite;
}

/* 打字光标 */
.typing-cursor {
  animation: blink-cursor 0.8s steps(2) infinite;
  color: var(--el-color-primary);
  font-weight: bold;
}

.is-streaming-text {
  position: relative;
}

/* 动画关键帧 */
@keyframes live-pulse {
  0%, 100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.6); opacity: 0; }
}

@keyframes blink-cursor {
  0% { opacity: 1; }
  50% { opacity: 0; }
  100% { opacity: 1; }
}

/* 加载指示器 */
.loading-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  color: var(--el-color-primary);
  font-size: 14px;
}

/* 输入区域 */
.input-section {
  border-top: 1px solid var(--el-border-color-light);
  padding: 16px;
  background: var(--el-bg-color);
}

.attachments-preview {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.attachment-item {
  position: relative;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 4px;
  max-width: 120px;
}

.attachment-image {
  max-width: 100%;
  max-height: 80px;
  border-radius: 4px;
}

.attachment-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  font-size: 12px;
}

.remove-attachment {
  position: absolute;
  top: -8px;
  right: -8px;
  padding: 0;
  margin: 0;
}

/* 输入框 */
.input-box {
  border: 2px dashed transparent;
  border-radius: 8px;
  padding: 12px;
  background: var(--el-bg-color-page);
  transition: all 0.3s;
}

.input-box.drag-over {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.input-toolbar {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.input-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

/* 头像 */
.user-avatar {
  background: var(--el-color-primary);
  color: white;
}

.agent-avatar-icon {
  background: var(--el-color-success-light-7);
}

/* 决策按钮 */
.decision-buttons {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

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
.edit-dialog-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.edit-dialog-header .artifact-name { font-weight: 600; color: var(--el-text-color-primary); }

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

.artifact-actions { display: flex; gap: 4px; flex-wrap: wrap; }
</style>
