<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useWorkflowStore } from '@/stores/workflow'
import { useMainStore } from '@/stores/main'
import { ElMessage } from 'element-plus'
import { QuestionFilled, Clock, Timer, Promotion } from '@element-plus/icons-vue'
import WorkflowVisualizer from '@/components/WorkflowVisualizer.vue'
import UnifiedChatPanel from '@/components/UnifiedChatPanel.vue'
import type { ChatMessage, ThinkingStep } from '@/types'
import { getAuthHeaders, request } from '@/api/index'

const workflowStore = useWorkflowStore()
const mainStore = useMainStore()

// 任务输入
const taskInput = ref('')
const historyWorkflowId = ref('')

// 当前视图模式
const viewMode = ref<'overview' | 'execution'>('overview')

// 工作流对话消息（含流式输出）
// 重构后：从 store 直接订阅。store 根据事件归属（安全测试→dashboard，普通 workflow→workflow）统一分发。
// 本地只保留跳转逻辑（execution/overview 切换等 UI 状态）。
const workflowMessages = computed<ChatMessage[]>(() => mainStore.workflowMessages)

// 心跳:记录最后活跃时间,用于前端显示"执行中"状态
const lastHeartbeat = ref<string | null>(null)

// 心跳类型: 'agent' | 'reviewer' | 'stage'
const heartbeatLabel = ref<string>('')

// 心跳计时:从第一个心跳开始计时
const heartbeatElapsed = ref<number>(0)
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

// 工作流预估工时（由后端在 workflow_completed 事件返回）
const workflowManualHours = ref<number | null>(null)

function startHeartbeatTimer() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatElapsed.value = 0
  heartbeatTimer = setInterval(() => { heartbeatElapsed.value++ }, 1000)
}

function stopHeartbeatTimer() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  heartbeatElapsed.value = 0
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m < 60) return `${m}分${sec}秒`
  return `${Math.floor(m / 60)}小时${m % 60}分`
}

// 格式化工时（小时）
function formatHours(hours: number): string {
  if (!hours || hours === 0) return '-'
  if (hours < 1) return `${Math.round(hours * 60)}分钟`
  if (hours < 8) return `${hours.toFixed(1)}小时`
  const days = Math.floor(hours / 8)
  const remainingHours = hours % 8
  if (remainingHours === 0) return `${days}人天`
  return `${days}人天${remainingHours.toFixed(0)}小时`
}

// 流式消息 Map (streamMsgId -> index in workflowMessages)
const streamingMap = new Map<string, number>()

// 自动滚动到底部
function scrollChatToBottom() {
  nextTick(() => {
    const container = document.querySelector('#workflow-chat-messages .messages-container') as HTMLElement
    if (container) container.scrollTop = container.scrollHeight
  })
}

// ==================== SSE 事件处理 ====================
// SSE 连接已移至 App.vue 全局管理
// WorkflowView 只处理 SSE 事件，不管理连接

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

// 获取智能体显示名
function getAgentDisplayName(agentId: string | undefined): string {
  if (!agentId) return '智能体'
  const nameMap: Record<string, string> = {
    'test-master': '测试主控',
    'test-requirement-analyzer': '需求分析',
    'test-scheme-generator': '方案生成器',
    'test-case-generator': '用例生成器',
    'test-data-generator': '数据生成器',
    'api-executor': 'API执行器',
    'ui-e2e-executor': 'UI/E2E执行器',
    'knowledge-manager': '知识库管理器',
  }
  return nameMap[agentId] || agentId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
async function handleSendTask(_files?: any) {
  if (!taskInput.value.trim() && (!_files || _files.length === 0)) {
    ElMessage.warning('请输入任务内容或上传文件')
    return
  }

  const inputText = taskInput.value.trim()
  viewMode.value = 'execution'

  // 添加用户消息到对话
  const fileNames = _files && _files.length > 0
    ? _files.map((f: any) => `[附件: ${f.name}]`).join('、')
    : ''
  const displayContent = fileNames
    ? (inputText ? inputText + '\n\n' + fileNames : fileNames)
    : inputText
  mainStore.workflowMessages.push({
    id: `user-${Date.now()}`,
    role: 'user',
    type: 'user',
    content: displayContent,
    timestamp: new Date().toISOString()
  })
  scrollChatToBottom()

  // ========== 处理附件，提取文件内容后提交任务 ==========
  try {
    let filesToSubmit: { name: string; content: string }[] = []

    if (_files && Array.isArray(_files) && _files.length > 0) {
      console.log('[Workflow] 收到上传文件:', _files.map((f: any) => ({ name: f.name, hasDataUrl: !!f.dataUrl })))
      for (const file of _files as any[]) {
        if (!file.dataUrl) {
          console.warn('[Workflow] 跳过无 dataUrl 的文件:', file.name)
          continue
        }
        const dataUrl = file.dataUrl as string
        const base64Content = dataUrl.split(',').pop() || ''
        try {
          const binaryStr = atob(base64Content)
          const isTextFile = file.name.match(/\.(txt|md|json|xml|yaml|yml|csv|js|ts|py|java|c|cpp|h|html|css)$/i)
          if (isTextFile) {
            const bytes = new Uint8Array(binaryStr.length)
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i)
            }
            const decoder = new TextDecoder('utf-8', { fatal: false })
            filesToSubmit.push({ name: file.name, content: decoder.decode(bytes) })
          } else {
            const sizeKB = (file.size / 1024).toFixed(1)
            const sizeLabel = file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)}MB` : `${sizeKB}KB`
            filesToSubmit.push({ name: file.name, content: `[附件: ${file.name} (${sizeLabel})]` })
          }
        } catch (e) {
          console.warn('[Workflow] 文件解析失败:', file.name, e)
          filesToSubmit.push({ name: file.name, content: `[文件: ${file.name}, 大小: ${(file.size / 1024).toFixed(1)}KB]` })
        }
      }
    }

    const resp = await request<{ workflowId: string; status: string; message: string }>('/api/workflow/auto-with-review', {
      method: 'POST',
      body: JSON.stringify({
        input: inputText,
        scenario: '测试中台前端页面操作',
        mode: '全自动模式',
        files: filesToSubmit
      })
    })

    if (!resp.success) {
      throw new Error(resp.error || '启动工作流失败')
    }

    ElMessage.success('工作流已启动')

    mainStore.workflowMessages.push({
      id: `sys-${Date.now()}`,
      role: 'system',
      type: 'system',
      content: '🚀 工作流已启动（全自动模式），Test-Master 正在调度子智能体...\n\n💡 所有智能体的思考过程、工具调用和输出将在此实时展示。',
      timestamp: new Date().toISOString()
    })
    scrollChatToBottom()

  } catch (error) {
    ElMessage.error('启动工作流失败: ' + (error as Error).message)
  }

  taskInput.value = ''
}


// 切换视图
function startWorkflow() {
  viewMode.value = 'execution'
}

function backToOverview() {
  if (!workflowStore.isRunning) {
    viewMode.value = 'overview'
  }
}

// ==================== 阶段配置 ====================
const stageIcons: Record<string, string> = {
  'Phase 1: 需求分析': 'Search',
  'Phase 2: 用例生成': 'List',
  'Phase 3: UI/E2E测试': 'Monitor',
  'Phase 4: 测试报告': 'Document'
}

const stageColors: Record<string, string> = {
  'Phase 1: 需求分析': '#409eff',
  'Phase 2: 用例生成': '#67c23a',
  'Phase 3: UI/E2E测试': '#e6a23c',
  'Phase 4: 测试报告': '#b37feb'
}

// ==================== QClaw 原生对话历史加载 ====================
const API_BASE = import.meta.env.VITE_API_BASE || ''

// 加载所有智能体的历史（修复：之前硬编码 test-master 导致部分智能体历史丢失）
async function loadConversationHistory() {
  try {
    const res = await fetch(`${API_BASE}/api/conversations/all/history?limit=200`, {
      headers: { ...getAuthHeaders() }
    })
    const json = await res.json()
    if (!json.success || !json.data || json.data.length === 0) return

    // 按时间升序展示
    const history = (json.data as any[]).reverse()

    const mapped: ChatMessage[] = history.map(item => {
      const agentId = item.agentId || 'test-master'
      if (item.role === 'user') {
        return {
          id: item.id || `hist-${Math.random()}`,
          role: 'user' as const,
          type: 'user' as const,
          content: item.content || '',
          timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
        }
      } else {
        return {
          id: item.id || `hist-${Math.random()}`,
          role: 'assistant' as const,
          type: 'result' as const,
          content: item.content || '',
          timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
          agentName: getAgentDisplayName(agentId),
          agentIcon: getAgentEmoji(agentId),
          agentId,
          artifacts: item.artifacts || [],
        }
      }
    })

    // 追加到现有消息之前（避免覆盖 SSE 实时消息）
    mainStore.workflowMessages = [...mapped, ...mainStore.workflowMessages]
  } catch (err) {
    console.warn('[History] 加载对话历史失败:', err)
  }
}

// 加载当前工作流的历史消息（从 workflow_results 重建）
async function loadWorkflowHistory(workflowId: string) {
  if (!workflowId) return
  try {
    const res = await fetch(`${API_BASE}/api/workflow/${workflowId}/messages`, {
      headers: { ...getAuthHeaders() }
    })
    const json = await res.json()
    if (!json.success || !json.data || json.data.length === 0) {
      ElMessage.warning('该工作流暂无历史消息')
      return
    }

    const mapped: ChatMessage[] = json.data.map((msg: any) => ({
      id: msg.id || `wf-hist-${Math.random()}`,
      role: msg.role || (msg.type === 'user' ? 'user' : 'assistant'),
      type: msg.type || (msg.role === 'user' ? 'user' : 'agent'),
      content: msg.content || '',
      timestamp: msg.timestamp || new Date().toISOString(),
      agentId: msg.agentId || 'unknown',
      agentName: getAgentDisplayName(msg.agentId || 'unknown'),
      agentIcon: getAgentEmoji(msg.agentId || 'unknown'),
      stage: msg.stage,
      success: msg.success,
      artifacts: msg.artifacts || []
    }))

    // 替换消息（避免和旧 workflow 数据混合）
    mainStore.workflowMessages = mapped
    // 同时更新 currentWorkflowId，方便后续刷新自动加载
    workflowStore.currentWorkflowId = workflowId
    ElMessage.success(`已加载 ${mapped.length} 条历史消息`)
    console.log(`[WorkflowHistory] 加载了 ${mapped.length} 条历史消息`)
  } catch (err) {
    console.warn('[WorkflowHistory] 加载失败:', err)
    ElMessage.error('加载历史消息失败')
  }
}

// 通过输入框加载历史
async function loadHistoryById() {
  const id = historyWorkflowId.value.trim()
  if (!id) return
  await loadWorkflowHistory(id)
}

// ==================== 生命周期 ====================
// 重构后：所有 SSE 处理与持久化已下沉到 mainStore。组件仅负责 UI 状态与历史加载。
onMounted(() => {
  // SSE 连接在 App.vue 全局管理，事件由 store.handleRealtimeEvent 根据归属分发。
  // workflowMessages 已通过 computed 从 store 订阅，无需手动恢复。
  loadConversationHistory()

  // 如果有当前工作流 ID，加载历史消息（刷新页面后恢复）
  const wfId = workflowStore.currentWorkflowId
  if (wfId) {
    loadWorkflowHistory(wfId)
  }
})

onUnmounted(() => {
  stopHeartbeatTimer()
})
</script>

<template>
  <div class="workflow-view" data-testid="workflow-page">
    <!-- ======== 概览模式 ======== -->
    <div v-if="viewMode === 'overview'" class="workflow-overview">
      <!-- 顶部标题区 -->
      <div class="overview-header">
        <div class="header-content">
          <h1>全自动工作流引擎</h1>
          <p class="subtitle">输入测试需求，AI 驱动 7 个智能体完成从需求分析到报告输出的全流程（每阶段完成后 3 个 AI 审核员并行把关）</p>
          <div class="header-stats">
            <div class="stat-item">
              <span class="stat-num">4</span>
              <span class="stat-label">执行阶段</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-num">4</span>
              <span class="stat-label">审核关卡</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-num">7</span>
              <span class="stat-label">智能体</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-num">100%</span>
              <span class="stat-label">自动化</span>
            </div>
          </div>
        </div>
        <div class="header-action">
          <el-button type="primary" size="large" @click="startWorkflow">
            开始使用
          </el-button>
        </div>
      </div>

      <!-- 阶段流程卡片（执行+审核交替） -->
      <div class="stages-flow">
        <div
          v-for="(stage, index) in workflowStore.stages"
          :key="stage.name"
          class="stage-card"
          :class="{ 'review-card': stage.isReview }"
          :style="{ '--stage-color': stage.isReview ? '#f56c6c' : (stageColors[stage.name] || '#409eff') }"
        >
          <div class="stage-badge" :class="{ 'review-badge': stage.isReview }">
            <span v-if="stage.isReview">🛡️</span>
            <span v-else>{{ Math.floor(index / 2) + 1 }}</span>
          </div>
          <div class="stage-info">
            <h3>
              <el-icon v-if="!stage.isReview"><component :is="stageIcons[stage.name] || 'Operation'" /></el-icon>
              <el-icon v-else><Select /></el-icon>
              {{ stage.name }}
              <el-tag v-if="stage.isReview" type="danger" size="small" effect="dark" style="margin-left: 8px;">审核关卡</el-tag>
              <span class="step-count">{{ stage.steps.length }}个智能体</span>
            </h3>
            <p>{{ stage.description }}</p>
            <div class="stage-agents">
              <el-tag
                v-for="agentId in stage.steps"
                :key="agentId"
                size="small"
                :effect="stage.isReview ? 'dark' : 'plain'"
                :type="stage.isReview ? 'danger' : undefined"
                class="agent-tag"
              >
                <span class="agent-icon">{{ workflowStore.getAgentDetail(agentId).icon }}</span>
                {{ workflowStore.getAgentDetail(agentId).name }}
              </el-tag>
            </div>
          </div>
          <div v-if="index < workflowStore.stages.length - 1" class="stage-arrow">
            <el-icon><ArrowRight /></el-icon>
          </div>
        </div>
      </div>

      <!-- AI质量审核专区 -->
      <div class="review-section">
        <div class="section-header">
          <h2>
            <el-icon><Select /></el-icon>
            AI 质量审核机制
          </h2>
          <el-tag type="danger" effect="dark" size="small">核心关卡</el-tag>
        </div>
        <div class="review-content">
          <div class="review-flow">
            <div class="review-card">
              <div class="review-num">1</div>
              <div class="review-body">
                <h4>事实与逻辑审核</h4>
                <p>评估需求分析结果的<strong>事实准确性(25%)</strong>和<strong>逻辑一致性(25%)</strong></p>
                <div class="review-veto">
                  <el-tag type="danger" size="small" effect="plain">⚡ 否决项</el-tag>
                  <span>存在事实幻觉则直接不通过</span>
                </div>
              </div>
            </div>
            <div class="review-arrow">→</div>
            <div class="review-card">
              <div class="review-num">2</div>
              <div class="review-body">
                <h4>安全合规审核</h4>
                <p>评估<strong>安全性(15%)</strong>与<strong>合规性(10%)</strong>，含4个否决项</p>
                <div class="review-veto">
                  <el-tag type="danger" size="small" effect="plain">⚡ 否决项</el-tag>
                  <span>敏感内容、歧视偏见、提示注入</span>
                </div>
              </div>
            </div>
            <div class="review-arrow">→</div>
            <div class="review-card">
              <div class="review-num">3</div>
              <div class="review-body">
                <h4>格式结构审核</h4>
                <p>评估<strong>格式规范(12.5%)</strong>与<strong>结构完整性(12.5%)</strong></p>
                <div class="review-pass">
                  <el-tag type="success" size="small" effect="plain">✓ 通过条件</el-tag>
                  <span>三评均 ≥ 95分</span>
                </div>
              </div>
            </div>
          </div>
          <div class="review-note">
            <el-icon><InfoFilled /></el-icon>
            三个AI审核智能体独立完成完整4维度评估（各100分），只有三评均达到95分以上才能进入下一阶段。最多重试3次。
          </div>
        </div>
      </div>

      <!-- 快速开始 — 实时流式对话区 -->
      <div class="quick-start">
        <div class="section-header">
          <h2>
            <el-icon><Promotion /></el-icon>
            实时流式对话
          </h2>
          <el-tag type="success" effect="plain" size="small" class="live-tag">
            <span class="live-dot" style="margin-right: 4px;"></span>
            实时同步
          </el-tag>
        </div>
        <div class="quick-start-panel">
          <!-- 加载历史工作流 -->
        <div v-if="!workflowStore.isRunning && !workflowMessages.length" class="history-loader" style="margin-bottom: 12px; padding: 12px; background: var(--el-fill-color-lighter); border-radius: 8px; border: 1px dashed var(--el-border-color);">
          <div style="display: flex; gap: 8px; align-items: center;">
            <el-input
              v-model="historyWorkflowId"
              placeholder="输入工作流ID加载历史记录"
              size="small"
              style="flex: 1;"
              clearable
            />
            <el-button type="primary" size="small" @click="loadHistoryById" :disabled="!historyWorkflowId.trim()">
              <el-icon><Timer /></el-icon>
              加载历史
            </el-button>
          </div>
          <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 6px;">
            提示：可从任务列表复制 workflow ID，或刷新页面自动加载最近的工作流
          </div>
        </div>

        <div class="mode-switch" style="margin-bottom: 12px; padding: 10px; background: var(--el-fill-color-lighter); border-radius: 8px;">
            <span style="font-weight: 500;">🤖 全自动模式</span>
            <span v-if="lastHeartbeat && workflowStore.isRunning" style="margin-left: 8px; font-size: 12px; color: var(--el-color-primary); font-weight: 500;">
              💓 {{ heartbeatLabel }} {{ formatElapsed(heartbeatElapsed) }}
            </span>
            <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px;">
              工作流将自动执行到底，所有步骤由 Test-Master 统一调度。下方对话区将实时同步 Test-Master 及所有子智能体的思考过程、工具调用和输出内容。
            </div>
          </div>

          <UnifiedChatPanel
            id="workflow-chat-messages"
            v-model="taskInput"
            :current-agent="null"
            :messages="workflowMessages"
            :is-loading="workflowStore.isRunning"
            compact
            @send="handleSendTask"
            @clear="workflowMessages = []; streamingMap.clear()"
          />

        </div>
      </div>
    </div>

    <!-- ======== 执行详情模式（工作流执行，实时对话） ======== -->
    <div v-else class="task-list-view">
      <div class="exec-header">
        <el-button text @click="backToOverview">
          <el-icon><ArrowLeft /></el-icon>
          返回概览
        </el-button>
        <span class="exec-title">
          执行详情
          <el-tag v-if="lastHeartbeat && workflowStore.isRunning" type="primary" effect="plain" size="small" style="margin-left: 8px;">
            💓 {{ heartbeatLabel }} {{ formatElapsed(heartbeatElapsed) }}
          </el-tag>
          <el-tag v-else type="success" effect="plain" size="small" class="live-tag">
            <span class="live-dot" style="margin-right: 4px;"></span>
            实时同步中
          </el-tag>
        </span>
      </div>

      <!-- 实时流式对话面板（顶部） -->
      <!-- 工作流状态卡片 -->
      <div v-if="workflowStore.isRunning || workflowManualHours" class="workflow-status-card">
        <div class="status-info">
          <el-tag :type="workflowStore.isRunning ? 'warning' : 'success'" effect="dark" size="large">
            {{ workflowStore.isRunning ? '⏳ 执行中' : '✅ 已完成' }}
          </el-tag>
          <span v-if="workflowManualHours" class="effort-info">
            <el-icon><Clock /></el-icon>
            预估人工工时：<strong>{{ formatHours(workflowManualHours) }}</strong>
          </span>
        </div>
        <div v-if="workflowStore.isRunning" class="running-hint">
          <span class="live-dot"></span>
          {{ heartbeatLabel }} {{ formatElapsed(heartbeatElapsed) }}
        </div>
      </div>

      <div class="execution-chat-section">
        <UnifiedChatPanel
          id="workflow-chat-messages"
          v-model="taskInput"
          :current-agent="null"
          :messages="workflowMessages"
          :is-loading="workflowStore.isRunning"
          compact
          @send="handleSendTask"
          @clear="workflowMessages = []; streamingMap.clear()"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.workflow-view {
  height: calc(100vh - 100px);
  overflow-y: auto;
}

/* ===== 概览模式样式 ===== */
.workflow-overview {
  padding: 24px 32px;
  max-width: 1200px;
  margin: 0 auto;
}

.overview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px 36px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border-radius: 16px;
  color: white;
  margin-bottom: 28px;
}

.overview-header h1 {
  margin: 0 0 8px 0;
  font-size: 28px;
  font-weight: 700;
}

.subtitle {
  color: rgba(255,255,255,0.7);
  font-size: 14px;
  margin: 0 0 20px 0;
}

.header-stats {
  display: flex;
  align-items: center;
  gap: 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-num {
  font-size: 24px;
  font-weight: 700;
  color: #67c8ff;
}

.stat-label {
  font-size: 12px;
  color: rgba(255,255,255,0.5);
  margin-top: 2px;
}

.stat-divider {
  width: 1px;
  height: 32px;
  background: rgba(255,255,255,0.15);
}

.header-action .el-button {
  height: 44px;
  padding: 0 32px;
  font-size: 15px;
  border-radius: 8px;
}

/* 阶段流程 */
.stages-flow {
  margin-bottom: 28px;
}

.stage-card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px 24px;
  background: white;
  border-radius: 12px;
  margin-bottom: 12px;
  border-left: 4px solid var(--stage-color);
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative;
}

.stage-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.stage-card.review-card {
  background: linear-gradient(135deg, #fef0f0 0%, #fff 100%);
  border-left-color: #f56c6c;
}

.review-badge {
  background: #f56c6c;
}

.review-card .agent-tag {
  border-color: #f56c6c;
  color: #f56c6c;
}

.stage-badge {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--stage-color);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
}

.stage-info {
  flex: 1;
}

.stage-info h3 {
  margin: 0 0 6px 0;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  padding: 2px 8px;
  border-radius: 10px;
}

.stage-info p {
  margin: 0 0 10px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.stage-agents {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.agent-tag {
  font-size: 12px;
  border-color: var(--stage-color);
  color: var(--stage-color);
}

.agent-icon {
  margin-right: 2px;
}

.stage-arrow {
  position: absolute;
  right: -18px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--el-text-color-placeholder);
  font-size: 18px;
  z-index: 1;
}

/* AI审核专区 */
.review-section {
  margin-bottom: 28px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.section-header h2 {
  margin: 0;
  font-size: 18px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.live-tag {
  display: inline-flex;
  align-items: center;
}

.review-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

.review-flow {
  display: flex;
  align-items: stretch;
  gap: 12px;
  margin-bottom: 16px;
}

.review-card {
  flex: 1;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 16px;
  position: relative;
}

.review-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--el-color-danger-light-5);
  color: var(--el-color-danger);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 10px;
}

.review-card h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
}

.review-card p {
  margin: 0 0 10px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.review-veto, .review-pass {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.review-arrow {
  display: flex;
  align-items: center;
  font-size: 20px;
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.review-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 16px;
  background: var(--el-color-info-light-9);
  border-radius: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.review-note .el-icon {
  margin-top: 2px;
  color: var(--el-color-info);
  flex-shrink: 0;
}

/* 快速开始 */
.quick-start {
  margin-bottom: 40px;
}

.quick-start-panel {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  overflow: hidden;
}

.quick-start-panel .chat-panel {
  border-radius: 12px;
}

.quick-start-actions {
  padding: 12px 16px 16px;
  display: flex;
  justify-content: flex-end;
}

.quick-start-actions .el-button {
  height: 42px;
  padding: 0 28px;
  font-size: 15px;
  border-radius: 8px;
}

/* ===== 任务列表模式样式 ===== */
.task-list-view {
  height: calc(100vh - 100px);
  overflow-y: auto;
  background: #f5f7fa;
}

.exec-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: white;
  border-bottom: 1px solid var(--el-border-color-light);
  position: sticky;
  top: 0;
  z-index: 10;
}

.exec-title {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.execution-chat-section {
  padding: 16px 24px 0;
  max-height: 55vh;
}

/* ===== 实时脉冲点 ===== */
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

@keyframes live-pulse {
  0%, 100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.6); opacity: 0; }
}

/* 工作流状态卡片 */
.workflow-status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #f8f9fc 0%, #f0f2f5 100%);
  border-radius: 10px;
  border: 1px solid var(--el-border-color-light);
}

.status-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.effort-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 15px;
  color: var(--el-text-color-primary);
}

.effort-info strong {
  color: var(--el-color-warning);
  font-size: 17px;
}

.running-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--el-color-primary);
  font-weight: 500;
}

@media (max-width: 1200px) {
  .overview-header {
    flex-direction: column;
    text-align: center;
    gap: 20px;
  }

  .header-stats {
    justify-content: center;
  }

  .review-flow {
    flex-direction: column;
  }

  .review-arrow {
    transform: rotate(90deg);
    justify-content: center;
    padding: 4px 0;
  }
}
</style>
