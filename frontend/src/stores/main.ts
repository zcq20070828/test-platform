// 用户信息接口
export interface User {
  id: string
  username?: string
  name: string
  role: 'admin' | 'tester' | 'viewer'
  token?: string
  refreshToken?: string
  authSource?: 'local' | 'keycloak'
}

// 实时事件日志接口
export interface RealtimeEvent {
  id: string
  type: string
  agentId?: string
  taskId?: string
  message: string
  timestamp: string
  status?: 'info' | 'success' | 'warning' | 'error'
}

// 获取智能体Emoji图标（前端版本）
function getAgentEmoji(agentId: string): string {
  const emojiMap: Record<string, string> = {
    'test-master': '👑',
    'test-requirement-analyzer': '🔍',
    'test-scheme-generator': '📋',
    'test-case-generator': '✅',
    'test-data-generator': '📊',
    'api-executor': '🔌',
    'ui-e2e-executor': '🖥️',
    'knowledge-manager': '📚',
    'requirement-optimizer': '✨',
    'scheme-optimizer': '🎯',
    'case-optimizer': '💎',
    'data-optimizer': '💡',
    'executor-optimizer': '⚡',
    'performance-analyzer': '📈',
    'test-reporter': '📊',
    'defect-analyzer': '🐛',
    'data-masking': '🎭',
    'ai-quality-reviewer-1': '🤖',
    'ai-quality-reviewer-2': '🤖',
    'ai-quality-reviewer-3': '🤖',
    'default': '🤖'
  }
  return emojiMap[agentId] ?? emojiMap['default']!
}

// 统计接口
export interface Stats {
  tasks: { total: number; completed: number; running: number; failed: number }
  workflows: { total: number; running: number }
  agents: { total: number; active: number; summary: { id: string; status: string }[] }
  knowledge: { docs: number }
  today: { tasksCreated: number; tasksCompleted: number }
  connections: { ws: number; sse: number }
  system: { memoryMB: number; uptime: number }
  timestamp: string
}

// 主状态管理 Store

/**
 * 从文本中提取输出物（代码块等）
 */
function extractArtifacts(content: string, _opts?: { stageName?: string }): any[] {
  if (!content || typeof content !== 'string') return []
  const artifacts: any[] = []
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  let match
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1] || 'text'
    const code = match[2]!
    if (code.trim().length > 50) {
      artifacts.push({
        id: `code-${artifacts.length}`,
        type: 'code',
        contentType: `text/${language}`,
        name: `${getLangLabel(language)}.${getExtension(language)}`,
        content: code,
        createdAt: new Date().toISOString()
      })
    }
  }

  // 识别 Markdown 报告结构（标题 / 表格 / 列表），作为交付物展示
  // 与后端 server.js 的 extractArtifacts 保持一致：长文本含 markdown 结构即视为报告
  const hasMarkdownStructure =
    /(^|\n)\s*(#{1,6}\s+|\|\|?[^|\n]+(\|[^|\n]+)+\|?|[\-*]\s+[^\n]+\n)/m.test(content)
    && content.trim().length > 200

  if (hasMarkdownStructure) {
    // unshift：报告放最前面，优先展示
    artifacts.unshift({
      id: `report-${Date.now()}`,
      type: 'report',
      contentType: 'text/markdown',
      name: '交付报告.md',
      content,
      createdAt: new Date().toISOString()
    })
  } else {
    // JSON 兜底：无 markdown 结构但内容是有效 JSON（审核报告等），也作为报告交付物
    const trimmed = content.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed)
        const keyCount = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).length : 0
        if (keyCount >= 1 && trimmed.length > 100) {
          artifacts.unshift({
            id: `report-${Date.now()}`,
            type: 'report',
            contentType: 'application/json',
            name: '交付报告.json',
            content: trimmed,
            createdAt: new Date().toISOString()
          })
        }
      } catch (_) { /* not JSON, skip */ }
    }
  }

  return artifacts
}

function getLangLabel(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
    java: 'Java', go: 'Go', rust: 'Rust', sql: 'SQL', json: 'JSON',
    yaml: 'YAML', xml: 'XML', html: 'HTML', css: 'CSS', shell: 'Shell',
    bash: 'Bash', markdown: 'Markdown', plaintext: 'Text'
  }
  return map[lang] || lang
}

function getExtension(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'js', typescript: 'ts', python: 'py', java: 'java',
    go: 'go', rust: 'rs', sql: 'sql', json: 'json', yaml: 'yaml',
    xml: 'xml', html: 'html', css: 'css', shell: 'sh', bash: 'sh',
    markdown: 'md', plaintext: 'txt'
  }
  return map[lang] || lang
}

import { defineStore } from 'pinia'
import { ref, computed, nextTick, watch } from 'vue'
import type { Agent, Task, ChatMessage, KnowledgeDoc } from '@/types'
import { agentApi, taskApi, knowledgeApi, getAuthHeaders } from '@/api'
import { ssoApi } from '@/api/sso'
import type { SsoConfig } from '@/api/sso'
import { useKnowledgeStore } from './knowledge'
import { startSession, stopSession, checkSession } from '@/composables/useSessionTimeout'

export const useMainStore = defineStore('main', () => {
  // 用户状态
  const user = ref<User | null>(null)
  const token = ref<string | null>(null)
  const ssoConfig = ref<SsoConfig | null>(null)
  const refreshToken = ref<string | null>(null)

  // 状态
  const agents = ref<Agent[]>([])
  const tasks = ref<Task[]>([])
  const knowledgeDocs = ref<KnowledgeDoc[]>([])
  const currentAgent = ref<Agent | null>(null)
  const messages = ref<ChatMessage[]>([])
  // 按智能体分离的消息存储（切换智能体时保留历史消息）
  const messagesByAgent = ref<Record<string, ChatMessage[]>>({})
  const isLoading = ref(false)
  const wsConnected = ref(false)

  // 实时事件状态
  const realtimeLogs = ref<RealtimeEvent[]>([])

  // 智能体“真正调用”可执行 skill 后回传的结构化结果（如 UTRM）
  const realtimeSkillResult = ref<any>(null)
  const stats = ref<Stats | null>(null)
  const statsLoading = ref(false)
  let eventSource: EventSource | null = null
  let statsInterval: ReturnType<typeof setInterval> | null = null
  let tokenRefreshInterval: ReturnType<typeof setInterval> | null = null

  // 流式消息 Map (streamMsgId -> message index in messages)
  const streamingMap = new Map<string, number>()

  // ===== 重构后：事件归属分发器（不分发、不转发） =====
  // 原则：每个事件有一个归属面板
  //   - 安全测试（wfId 以 security- 开头）→ Dashboard（store.messages）
  //   - 普通工作流 + 任务级事件 → WorkflowView（workflowMessages）
  //   - 任务创建/完成（无 workflowId）→ TasksView（全局任务列表 + messages）
  function belongsToSecurityWorkflow(data: any): boolean {
    const wfId = data?.workflowId || data?.task?.workflowId
    return typeof wfId === 'string' && wfId.startsWith('security-')
  }
  function belongsToActiveWorkflow(data: any): boolean {
    const wfId = data?.workflowId || data?.task?.workflowId
    return !!wfId && !belongsToSecurityWorkflow(data)
  }

  // 计算属性
  const agentCount = computed(() => agents.value.length)
  const taskCount = computed(() => tasks.value.length)
  const completedCount = computed(() =>
    tasks.value.filter(t => t.status === 'completed').length
  )
  const runningCount = computed(() => {
    const myId = user.value?.id
    return tasks.value.filter((t: any) => t.status === 'running' && (!myId || t.userId === myId)).length
  })
  const isLoggedIn = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const avgTaskTime = computed(() => {
    const completed = tasks.value.filter(t => t.status === 'completed' && t.endTime)
    if (completed.length === 0) return '-'
    const totalMs = completed.reduce((sum, t) => {
      const start = new Date(t.startTime || 0).getTime()
      const end = new Date(t.endTime || 0).getTime()
      return sum + (end - start)
    }, 0)
    const avgMs = totalMs / completed.length
    const avgMin = Math.round(avgMs / 60000)
    return avgMin < 1 ? '<1分钟' : `${avgMin}分钟`
  })

  // 🔒 用户隔离：完整清理所有用户级状态（切换/退出登录时调用）
  async function resetUserState() {
    messages.value = []
    messagesByAgent.value = {}
    tasks.value = []
    knowledgeDocs.value = []
    realtimeLogs.value = []
    realtimeSkillResult.value = null
    stats.value = null
    statsLoading.value = false
    currentAgent.value = null
    streamingMap.clear()
    // 🔒 重置所有其他 store
    try {
      const { useKnowledgeStore } = await import('./knowledge')
      useKnowledgeStore().reset()
    } catch (e) { console.warn('[User Isolation] knowledge reset 失败:', e) }
    try {
      const { useWorkflowStore } = await import('./workflow')
      useWorkflowStore().reset()
    } catch (e) { console.warn('[User Isolation] workflow reset 失败:', e) }
    try {
      const { useFileStore } = await import('./file')
      useFileStore().reset()
    } catch (e) { console.warn('[User Isolation] file reset 失败:', e) }
    try {
      const { useUploadStore } = await import('./upload')
      useUploadStore().reset()
    } catch (e) { console.warn('[User Isolation] upload reset 失败:', e) }
    try {
      const { usePerformanceStore } = await import('./performance')
      usePerformanceStore().reset()
    } catch (e) { console.warn('[User Isolation] performance reset 失败:', e) }
    console.log('[User Isolation] 已清理用户级状态')
  }

  // 用户相关方法
  async function setUser(newUser: User | null) {
    // 🔒 用户隔离：如果登录的是不同用户，先清理旧状态
    if (newUser && user.value && newUser.id !== user.value.id) {
      console.log(`[User Isolation] 切换用户 ${user.value.name} → ${newUser.name}，清理旧状态`)
      await resetUserState()
    }

    user.value = newUser
    if (newUser) {
      token.value = newUser.token || ''
      localStorage.setItem('user', JSON.stringify(newUser))
      localStorage.setItem('token', token.value)
      // 存储 refreshToken（local 与 keycloak 共用，用于静默续期）
      if (newUser.refreshToken) {
        refreshToken.value = newUser.refreshToken
        localStorage.setItem('refreshToken', newUser.refreshToken)
      } else {
        refreshToken.value = null
        localStorage.removeItem('refreshToken')
      }
      // 存储认证来源
      if (newUser.authSource) {
        localStorage.setItem('authSource', newUser.authSource)
      } else {
        localStorage.removeItem('authSource')
      }
      // 登录成功后立即连接 SSE
      connectRealtimeEvents()
      // 启动 Token 自动刷新
      startTokenRefresh()
      // 启动会话超时监控（仅本地用户）
      if (!newUser.authSource || newUser.authSource === 'local') {
        startSession(() => {
          setUser(null)
        })
      }
    } else {
      token.value = null
      localStorage.removeItem('user')
      localStorage.removeItem('token')
      localStorage.removeItem('authSource')
      stopSession()
    }
  }

  async function logout() {
    stopSession()
    // 清除 Token 刷新定时器
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval)
      tokenRefreshInterval = null
    }
    // 🔒 用户隔离：退出登录时清理所有用户相关状态，防止下一用户看到上一用户数据
    await resetUserState()

    // 如果是 Keycloak 用户，先调用 SSO 退出获取重定向 URL
    const authSource = localStorage.getItem('authSource')
    if (authSource === 'keycloak') {
      try {
        const result = await ssoApi.ssoLogout()
        // 清除本地存储
        localStorage.removeItem('refreshToken')
        setUser(null)
        // 如果有 Keycloak 退出重定向 URL，跳转过去
        if (result?.redirectUrl) {
          window.location.href = result.redirectUrl
          return
        }
      } catch {
        console.warn('[logout] SSO logout API 调用失败，继续本地登出')
        localStorage.removeItem('refreshToken')
        await setUser(null)
      }
    } else {
      await setUser(null)
    }
  }

  // Token 自动刷新（accessToken 有效期约 30 分钟，提前约 17 分钟刷新）
  // 保险机制：连续失败 N 次后禁用后续刷新，避免网络抖动期间不停触发 401 死循环
  let tokenRefreshFailCount = 0
  const MAX_REFRESH_FAILS = 3  // 连续失败上限
  let tokenRefreshDisabled = false

  function disableTokenRefresh(reason: string) {
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval)
      tokenRefreshInterval = null
    }
    tokenRefreshDisabled = true
    console.warn(`[Token] 已禁用自动刷新：${reason}`)
  }

  function startTokenRefresh() {
    // 先清除旧的定时器
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval)
      tokenRefreshInterval = null
    }
    tokenRefreshDisabled = false
    tokenRefreshFailCount = 0
    // 每 13 分钟尝试刷新一次 token
    tokenRefreshInterval = setInterval(async () => {
      if (tokenRefreshDisabled) return
      const refreshed = await refreshAccessToken()
      if (refreshed) {
        if (tokenRefreshFailCount > 0) {
          console.log(`[Token] 自动刷新恢复（之前连续失败 ${tokenRefreshFailCount} 次）`)
        }
        tokenRefreshFailCount = 0
        // fetch 成功刷新 token 后，立即重建 SSE 连接（EventSource 无法自动续 token）
        // 这样 SSE 持有的始终是最新的 access token，避免 30 分钟后因 token 过期被踢
        if (user.value) {
          disconnectRealtimeEvents()
          connectRealtimeEvents()
        }
        return
      }
      tokenRefreshFailCount++
      console.warn(`[Token] 自动刷新失败 ${tokenRefreshFailCount}/${MAX_REFRESH_FAILS}`)
      if (tokenRefreshFailCount >= MAX_REFRESH_FAILS) {
        // 连续失败：禁用自动刷新，但不去踢用户，让现有 session 继续走直到真正 401
        disableTokenRefresh(`连续失败 ${MAX_REFRESH_FAILS} 次（网络抖动或 refreshToken 已过期）`)
      }
    }, 13 * 60 * 1000)
  }

  function loadUserFromStorage() {
    console.log('[Auth] loadUserFromStorage called, storedUser:', !!localStorage.getItem('user'), 'storedToken:', !!localStorage.getItem('token'))
    const storedUser = localStorage.getItem('user')
    const storedToken = localStorage.getItem('token')
    const storedRefreshToken = localStorage.getItem('refreshToken')
    const storedAuthSource = localStorage.getItem('authSource')
    if (storedUser && storedToken) {
      try {
        const parsedUser = JSON.parse(storedUser)
        console.log('[Auth] parsedUser:', parsedUser?.id, parsedUser?.name, '| authSource:', storedAuthSource)
        user.value = parsedUser
        token.value = storedToken
        if (storedRefreshToken) refreshToken.value = storedRefreshToken
        // 如果是 Keycloak 用户，不需要会话超时监控
        if (storedAuthSource === 'keycloak') {
          console.log('[Auth] Keycloak 用户，跳过会话超时监控')
        } else {
          // 本地用户：会话未过期则恢复监控
          const sessionOk = checkSession()
          console.log('[Auth] checkSession():', sessionOk)
          if (sessionOk) {
            console.log('[Auth] 会话有效，启动会话监控')
            startSession(() => {
              setUser(null)
            })
          } else {
            // 会话超时：先尝试用 refreshToken 静默续期，成功则恢复会话，失败才登出
            console.log('[Session] 会话已过期，尝试 refreshToken 静默续期...')
            refreshAccessToken().then((refreshed) => {
              console.log('[Session] refreshAccessToken 结果:', refreshed)
              if (refreshed) {
                console.log('[Session] refreshToken 续期成功，恢复会话')
                startSession(() => {
                  setUser(null)
                })
                // 续期成功后重建 SSE（EventSource 需要新 token）
                if (user.value) {
                  disconnectRealtimeEvents()
                  connectRealtimeEvents()
                }
              } else {
                console.log('[Session] refreshToken 续期失败，登出')
                setUser(null)
              }
            })
          }
        }
        // 页面加载时：用户已登录则启动 Token 自动刷新
        startTokenRefresh()
      } catch (e) {
        console.error('解析存储的用户信息失败:', e)
        setUser(null)
      }
    } else {
      console.log('[Auth] 无 storedUser 或 storedToken，不做任何处理')
    }
  }

  // 初始化
  loadUserFromStorage()

  // 加载 SSO 配置
  async function loadSsoConfig() {
    try {
      ssoConfig.value = await ssoApi.getConfig()
    } catch {
      ssoConfig.value = null
    }
  }

  // SSO 统一认证登录
  async function ssoLogin() {
    try {
      const result = await ssoApi.getLoginUrl()
      if (result?.loginUrl) {
        window.location.href = result.loginUrl
      } else {
        console.error('[ssoLogin] 获取登录地址失败')
      }
    } catch (e) {
      console.error('[ssoLogin] SSO 登录失败:', e)
    }
  }

  // 处理 SSO 回调
  async function handleSsoCallback(code: string, state: string) {
    try {
      const redirectUri = `${window.location.origin}/auth/callback`
      const result = await ssoApi.callback(code, state, redirectUri)
      if (!result) return null

      // 设置用户信息
      setUser({
        id: result.user.id,
        username: result.user.username,
        name: result.user.name,
        role: result.user.role as User['role'],
        token: result.token,
        authSource: 'keycloak'
      })

      // 存储 refresh token
      refreshToken.value = result.refreshToken
      localStorage.setItem('refreshToken', result.refreshToken)

      return result
    } catch (e) {
      console.error('[handleSsoCallback] 失败:', e)
      return null
    }
  }

  // 刷新 Access Token
  async function refreshAccessToken(): Promise<boolean> {
    const storedRefreshToken = refreshToken.value || localStorage.getItem('refreshToken')
    if (!storedRefreshToken) return false
    try {
      const result = await ssoApi.refreshToken(storedRefreshToken)
      if (result) {
        token.value = result.token
        localStorage.setItem('token', result.token)
        // 同步更新 localStorage.user 里的 token，避免刷新后 user.value.token 仍是旧值
        const storedUser = localStorage.getItem('user')
        if (storedUser) {
          try {
            const parsedUser = JSON.parse(storedUser)
            parsedUser.token = result.token
            localStorage.setItem('user', JSON.stringify(parsedUser))
            user.value = parsedUser
          } catch { /* ignore */ }
        }
        return true
      }
    } catch {
      // 刷新失败
    }
    return false
  }

  // 防止 session:expired 事件重复触发 logout（401 重试循环的防护）
  let isForcingLogout = false
  window.addEventListener('session:expired', () => {
    if (isForcingLogout) return
    isForcingLogout = true
    console.warn('[Session] 检测到 401，强制登出')
    logout().finally(() => { isForcingLogout = false })
  })

  // 加载智能体列表
  async function loadAgents() {
    isLoading.value = true
    try {
      agents.value = await agentApi.getAll()
      console.log('[Store] 加载智能体成功:', agents.value.length)
    } catch (error: any) {
      console.error('[Store] 加载智能体失败:', error)
      // 如果是 401 错误，抛出让上层处理
      if (error?.message?.includes('401') || error?.status === 401) {
        throw new Error('401 Unauthorized')
      }
      // 其他错误，清空智能体列表
      agents.value = []
    } finally {
      isLoading.value = false
    }
  }

  // 加载任务列表
  async function loadTasks() {
    const list = await taskApi.getAll()
    const myId = user.value?.id
    const myCount = list.filter((t: any) => t.userId === myId).length
    const otherCount = list.length - myCount
    console.log(`[loadTasks] userId=${myId} total=${list.length} mine=${myCount} others=${otherCount}`)
    if (otherCount > 0) {
      console.log('[loadTasks] OTHER USER TASKS:', list.filter((t: any) => t.userId !== myId).map((t: any) => `${t.id}(${t.userId})`).slice(0, 5))
    }
    tasks.value = list
  }

  // 加载知识库文档
  async function loadKnowledgeDocs(kbType?: string) {
    knowledgeDocs.value = await knowledgeApi.getDocs(kbType)
  }

  // 加载 Agent 会话历史（页面进入时填充 Test-Master 历史输出）
  async function loadConversationHistory(agentId: string = 'test-master', limit: number = 20) {
    try {
      const res = await fetch(`/api/conversations/${agentId}/history?limit=${limit}`, {
        headers: { ...getAuthHeaders() }
      })
      if (!res.ok) {
        console.warn('[History] 加载历史失败:', res.status)
        return
      }
      const json = await res.json()
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        // 确保每条消息有 type 字段，完善 ChatMessage 结构
        const normalized = json.data.map((m: any) => ({
          ...m,
          id: m.id || `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: m.type || (m.role === 'user' ? 'user' : m.role === 'assistant' ? 'agent' : 'system')
        }))
        // 排重：避免重复（按 content + timestamp + agentId 组合判断）
        const keySet = new Set(messages.value.map(m => `${m.content}|${m.timestamp}|${m.agentId || ''}`))
        const newMessages = normalized.filter((m: any) => !keySet.has(`${m.content}|${m.timestamp}|${m.agentId || ''}`))
        if (newMessages.length > 0) {
          messages.value.unshift(...newMessages)
        }
        console.log(`[History] 加载了 ${newMessages.length}/${json.data.length} 条 ${agentId} 的历史消息`)
      }
    } catch (err) {
      console.warn('[History] 加载历史失败:', err)
    }
  }

  // 创建任务
  // SSE 断线兜底：提交任务后轮询任务状态，完成后从 GET /api/tasks/:id 拉取 artifacts，
  // 确保聊天面板必现交付物（即使 task_completed 的 SSE 事件被丢也不会漏）。
  async function ensureTaskDeliverable(taskId: string, agentId: string, maxAttempts = 40) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      let task: any = null
      try {
        task = await taskApi.getById(taskId)
      } catch {
        continue
      }
      if (!task) continue
      if (task.status === 'completed' || task.status === 'failed') {
        const taskOutput = task.output || task.result || ''
        const baseArtifacts: any[] = task.artifacts || []
        // 前端兜底：服务端没交付物时，从输出里提取 markdown 报告，避免聊天面板空白
        const reportArtifacts = extractArtifacts(taskOutput).filter((a: any) => a.type === 'report')
        const taskArtifacts: any[] = baseArtifacts.length > 0 ? baseArtifacts : reportArtifacts
        const artifactMsgs =
          taskArtifacts.length > 0
            ? `\n\n📦 输出物（${taskArtifacts.length}个）: ${taskArtifacts
                .map((a: any) => a.name || a.title || 'unnamed')
                .join(', ')}`
            : ''
        const content = `任务 ${taskId} 完成\n\n${taskOutput}${artifactMsgs}`
        const existing = messages.value.find((m) => m.id === `task-output-${taskId}`)
        if (existing) {
          // SSE 已推送过，仅刷新 artifacts（防止 SSE 携带的数据不完整）
          existing.artifacts = taskArtifacts.length > 0 ? taskArtifacts : undefined
          existing.content = content
        } else if (taskOutput || taskArtifacts.length > 0) {
          // SSE 漏推，主动补一条带交付物的消息
          messages.value.push({
            id: `task-output-${taskId}`,
            role: 'assistant',
            type: 'agent',
            content,
            timestamp: new Date().toISOString(),
            agentId,
            artifacts: taskArtifacts.length > 0 ? taskArtifacts : undefined,
          })
        }
        break
      }
    }
  }

  // 加载最近已完成任务的完整结果到 messages（用于刷新页面后恢复历史）
  // 解决：刷新后 chat panel 空白、或流式中断导致 agent 消息只显示部分内容的问题
  async function loadRecentTaskResults(limit: number = 5) {
    try {
      const allTasks = await taskApi.getAll()
      // 【修复】过滤掉"测试流水线"（workflow）运行记录，避免分步测试页面显示"测试流水线"消息
      // 后端 GET /api/tasks 合并了 workflows 表的运行记录（source='workflow'、isWorkflow=true、agentName='测试流水线'），
      // 这些是工作流场景，dashboard 是分步测试入口，不需要显示
      const completed = (allTasks || [])
        .filter((t: any) => t.status === 'completed' && !t.isWorkflow && t.source !== 'workflow' && (t.result || t.output))
        .sort((a: any, b: any) => {
          const ta = new Date(a.completedAt || a.updatedAt || a.createdAt || 0).getTime()
          const tb = new Date(b.completedAt || b.updatedAt || b.createdAt || 0).getTime()
          return tb - ta
        })
        .slice(0, limit)
      let loadedCount = 0
      for (const task of completed) {
        const taskId = task.id
        const taskOutput = task.output || (typeof task.result === 'string' ? task.result : (task.result ? JSON.stringify(task.result) : ''))
        if (!taskOutput) continue
        // 跳过已存在的消息（避免与 task-output-XXX 或任务流式残留重复）
        if (messages.value.some(m => m.id === `loaded-task-${taskId}` || m.id === `task-output-${taskId}`)) continue
        // 提取 artifacts（与 task_completed 处理保持一致）
        const reportArtifacts = extractArtifacts(taskOutput).filter((a: any) => a.type === 'report')
        const baseArtifacts = task.artifacts || []
        const taskArtifacts = baseArtifacts.length > 0 ? baseArtifacts : reportArtifacts
        const agentId = task.agentId || task.agent
        messages.value.push({
          id: `loaded-task-${taskId}`,
          role: 'assistant',
          type: 'agent',
          content: `✅ 任务 ${taskId} 完成\n\n${taskOutput}`,
          timestamp: task.completedAt || task.updatedAt || task.createdAt || new Date().toISOString(),
          agentId,
          agentName: task.agentName || agentId,
          agentIcon: getAgentEmoji(agentId || 'unknown'),
          isStreaming: false,
          artifacts: taskArtifacts.length > 0 ? taskArtifacts : undefined,
        })
        loadedCount++
      }
      console.log(`[History] loadRecentTaskResults 加载了 ${loadedCount} 个最近完成任务结果`)
    } catch (err) {
      console.warn('[History] loadRecentTaskResults 失败:', err)
    }
  }

  async function createTask(
    agentId: string,
    input: string,
    files?: { kbType?: string; filename?: string; name?: string; content?: string }[],
    options?: { source?: 'step' | 'workflow'; type?: string }
  ) {
    console.log('[Store] createTask called:', { agentId, input: input.substring(0, 50), filesCount: files?.length || 0 })
    try {
      const res = await taskApi.create(agentId, input, files, options)
      console.log('[Store] createTask result:', res)
      if (res.success && res.task) {
        tasks.value.unshift(res.task)
        addMessage({
          id: Date.now().toString(),
          role: 'system',
          type: 'system',
          content: `任务已创建: ${res.task.id}`,
          timestamp: new Date().toISOString()
        })
        // 启动 SSE 断线兜底：轮询拉取交付物，确保聊天面板必现交付物卡片
        ensureTaskDeliverable(res.task.id, agentId).catch((err) =>
          console.warn('[Store] 交付物轮询兜底异常:', err)
        )
        return res.task
      } else {
        console.error('[Store] createTask failed:', res.error)
        return null
      }
    } catch (error: any) {
      console.error('[Store] createTask error:', error)
      // 如果是后端返回的 409 冲突错误，抛出自定义错误供调用方处理
      if (error?.status === 409 || error?.code === 'TASK_CONFLICT') {
        const errMsg = error?.error || error?.message || '同一用户同一时间只能执行一个任务'
        throw { code: 'TASK_CONFLICT', message: errMsg, status: 409 }
      }
      return null
    }
  }

  // 添加消息
  function addMessage(message: ChatMessage) {
    messages.value.push(message)
  }

  // 清空消息
  function clearMessages() {
    messages.value = []
  }

  // 设置当前智能体（自动保存/恢复消息）
  function setCurrentAgent(agent: Agent | null) {
    // 保存当前智能体的消息
    if (currentAgent.value) {
      messagesByAgent.value[currentAgent.value.id] = [...messages.value]
    }
    
    currentAgent.value = agent
    
    // 恢复新智能体的消息（如果有）
    if (agent) {
      const savedMessages = messagesByAgent.value[agent.id]
      if (savedMessages && savedMessages.length > 0) {
        messages.value = savedMessages
      } else {
        messages.value = []
      }
    } else {
      messages.value = []
    }
  }
  
  // 清除指定智能体的消息
  function clearMessagesForAgent(agentId: string) {
    delete messagesByAgent.value[agentId]
    if (currentAgent.value?.id === agentId) {
      messages.value = []
    }
  }
  
  // 清除所有消息
  function clearAllMessages() {
    messages.value = []
    messagesByAgent.value = {}
  }

  // 设置 WebSocket 连接状态
  function setWsConnected(connected: boolean) {
    wsConnected.value = connected
  }

  // ==================== 实时事件处理 ====================
  function addRealtimeLog(event: Omit<RealtimeEvent, 'id'>) {
    const newEvent: RealtimeEvent = {
      ...event,
      id: Date.now().toString()
    }
    realtimeLogs.value.unshift(newEvent)
    // 最多保留 100 条日志
    if (realtimeLogs.value.length > 100) {
      realtimeLogs.value = realtimeLogs.value.slice(0, 100)
    }
  }

  // 连接 SSE 并处理实时事件
  function connectRealtimeEvents() {
    if (eventSource) {
      eventSource.close()
    }

    const authToken = token.value
    if (!authToken) {
      console.warn('[SSE] No auth token available, skipping connection')
      setTimeout(connectRealtimeEvents, 5000)
      return
    }
    eventSource = new EventSource('/api/events?token=' + encodeURIComponent(authToken))

    eventSource.onopen = () => {
      console.log('[SSE] Connected to realtime events')
      wsConnected.value = true
    }

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        // agent_stream_chunk 流式块太多，只输出到控制台作为日志，不刷屏
        if (data.type !== 'agent_stream_chunk') {
          console.log('[SSE] Received event:', data.type, data, 'lastEventId=', e.lastEventId)
        }
        handleRealtimeEvent(data)
      } catch (err) {
        console.error('[SSE] Parse error:', err)
      }
    }

    eventSource.onerror = (err) => {
      // 浏览器 EventSource 原生重连机制:断开后会自动重连,并自动带 Last-Event-ID 头
      // 后端会从 Last-Event-ID 重放断开期间的事件,这样不会丢消息
      // 不要再用 setTimeout 自定义重连,否则会创建新连接但丢 Last-Event-ID
      console.warn('[SSE] Connection error, browser will auto-reconnect with Last-Event-ID', err)
      wsConnected.value = false
      // 仅在 user 登出后手动关闭,防止 401 后死循环
      if (!user.value) {
        eventSource?.close()
        eventSource = null
      }
    }
  }

  // 处理实时事件
  function handleRealtimeEvent(data: any) {
    const timestamp = new Date().toISOString()
    let message = ''
    let status: RealtimeEvent['status'] = 'info'

    // ===== 多用户隔离：所有用户（含管理员）只接收属于自己的任务级事件，防止会话串扰 =====
    const currentUser = user.value
    if (currentUser?.id) {
      const evtUserId = data.task?.userId || data.userId || data.targetUserId
      console.log('[ISO-FRONT] evtUserId=', evtUserId, 'currentUser.id=', currentUser.id, 'type=', data.type, 'match=', evtUserId === currentUser.id)
      if (evtUserId && evtUserId !== currentUser.id) {
        console.log('[ISO-FRONT] 丢弃事件，不属于当前用户')
        return
      }
    }

    // ===== 重构后：事件归属判定 =====
    // 规则：
    //   - 安全测试（wfId 以 security- 开头）→ Dashboard（messages）
    //   - 普通 workflow 事件、任务级事件、流式事件 → WorkflowView（workflowMessages）
    //   - 纯任务管理事件（task_created/completed、kb_*）→ TasksView 全局
    const wfId = data.workflowId || data.task?.workflowId
    // 归属判定：
    //   - security- 工作流 → Dashboard（messages）
    //   - 带非 security 的 workflowId 的真实工作流 → WorkflowView（workflowMessages）
    //   - 普通单任务（无 workflowId）→ Dashboard（messages）  ← 04a2df4 重构把默认错写成 'workflow'，导致 Dashboard 面板收不到普通任务输出
    const isSecurityWorkflow = typeof wfId === 'string' && wfId.startsWith('security-')
    const panel: 'dashboard' | 'workflow' = (wfId && !isSecurityWorkflow) ? 'workflow' : 'dashboard'

    // 面板写入 helper（先定义后调用，避免 TS hoisting 报错）
    const writeMsg = (msg: ChatMessage) => {
      if (panel === 'workflow') workflowMessages.value.push(msg)
      else messages.value.push(msg)
    }

    // 性能测试专属阶段事件文案（perf-wf- 走 Dashboard，workflowId 直接判断，不依赖 panel）
    if ((data.workflowId?.startsWith('perf-wf-') || data.workflowId?.startsWith('perf-single-')) && (data.type === 'workflow_stage_started' || data.type === 'workflow_stage_completed' || data.type === 'workflow_completed' || data.type === 'workflow_complete' || data.type === 'workflow_error' || data.type === 'workflow_failed')) {
      const id = `perf-stage-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
      let content = ''
      let artifacts = undefined
      
      if (data.type === 'workflow_stage_started') {
        content = `⚡ 性能测试阶段开始: ${data.stage || '执行阶段'}`
      } else if (data.type === 'workflow_stage_completed') {
        const statusText = data.success === false ? '⚠️ 阶段失败' : '✅ 阶段完成'
        content = `${statusText}: ${data.stage || '执行阶段'}`

        // 【修复】优先使用后端落盘的三格式文件交付物(md/docx/xlsx,带真实 downloadUrl)
        if (data.artifacts && data.artifacts.length > 0) {
          artifacts = data.artifacts
          content += `\n\n📦 交付物（${data.artifacts.length}个,含 md/docx/xlsx）: ${data.artifacts.map((a: any) => a.name).join(', ')}`
        } else {
          // 兜底：从流式文本里抽取 code/report 交付物(纯文本,无文件下载)
          const output = data.result?.text || data.result?.content || ''
          const allArtifacts = extractArtifacts(output)
          const codeArtifacts = allArtifacts.filter((a: any) => a.type === 'code')
          const reportArtifacts = allArtifacts.filter((a: any) => a.type === 'report')
          // 性能测试各阶段交付物名称前缀（按阶段语义划分）
          const stage = data.stage || ''
          const stagePrefix = stage.includes('脚本') || stage.includes('实现') ? '性能测试脚本'
            : stage.includes('报告') ? '性能测试报告'
            : stage.includes('瓶颈') || stage.includes('结果分析') ? '性能瓶颈分析'
            : stage.includes('执行') ? '性能测试结果'
            : '性能测试交付物'

          if (codeArtifacts.length > 0 || reportArtifacts.length > 0) {
            const renamedArtifacts = [
              ...codeArtifacts.map((a: any, i: number) => ({
                ...a,
                id: `code-${id}-${i}`,
                name: i === 0 ? `${stagePrefix}.${getExtension(a.contentType?.split('/')[1] || 'txt')}` : `${stagePrefix}_${i + 1}.${getExtension(a.contentType?.split('/')[1] || 'txt')}`,
              })),
              ...reportArtifacts.map((a: any, i: number) => ({
                ...a,
                id: `report-${id}-${i}`,
                name: i === 0 ? `${stagePrefix}报告.md` : `${stagePrefix}报告_${i + 1}.md`,
              })),
            ]
            artifacts = renamedArtifacts
            content += `\n\n📦 交付物（${renamedArtifacts.length}个）: ${renamedArtifacts.map((a: any) => a.name).join(', ')}`
          } else if (output && output.length > 50) {
            // 无结构化交付物但有输出内容，包装为 markdown 报告交付物
            const reportName = `${stagePrefix}报告.md`
            artifacts = [{
              id: `report-${id}-0`,
              type: 'report',
              contentType: 'text/markdown',
              name: reportName,
              content: output,
              createdAt: new Date().toISOString(),
            }]
            content += `\n\n📦 交付物（1个）: ${reportName}`
          }
        }
      } else if (data.type === 'workflow_error' || data.type === 'workflow_failed') {
        content = `❌ 性能测试工作流失败: ${data.error || data.stage || '未知错误'}`
      } else {
        content = `🎉 性能测试工作流执行完毕`
        // 【修复】完整工作流完成时携带后端落盘的三格式交付物(md/docx/xlsx)
        if (data.artifacts && data.artifacts.length > 0) {
          artifacts = data.artifacts
          content += `\n\n📦 交付物（${data.artifacts.length}个,含 md/docx/xlsx）: ${data.artifacts.map((a: any) => a.name).join(', ')}`
        }
      }
      
      // 性能测试统一写到 Dashboard messages；同时写入 workflowMessages 以便持久化历史（PerfTestExecutor 重进时回显）
      const perfMsg = {
        id,
        role: 'assistant',
        type: 'system',
        content,
        timestamp: new Date().toISOString(),
        artifacts,
        workflowId: data.workflowId,
      }
      messages.value.push(perfMsg)
      workflowMessages.value.push({ ...perfMsg })
      return
    }

    // 安全测试专属阶段事件文案（security- 走 Dashboard）
    if ((panel === 'dashboard' || data.workflowId?.startsWith('sec-single-')) && (data.type === 'workflow_stage_started' || data.type === 'workflow_stage_completed' || data.type === 'workflow_completed' || data.type === 'workflow_complete' || data.type === 'workflow_error' || data.type === 'workflow_failed')) {
      const id = `sec-stage-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
      let content = ''
      let artifacts = undefined
      
      if (data.type === 'workflow_stage_started') {
        content = `🔍 安全测试阶段开始: ${data.stage || '执行阶段'}`
      } else if (data.type === 'workflow_stage_completed') {
        const statusText = data.success === false ? '⚠️ 阶段失败' : '✅ 阶段完成'
        content = `${statusText}: ${data.stage || '执行阶段'}`

        // 【修复】优先使用后端落盘的三格式文件交付物(md/docx/xlsx,带真实 downloadUrl)
        if (data.artifacts && data.artifacts.length > 0) {
          artifacts = data.artifacts
          content += `\n\n📦 交付物（${data.artifacts.length}个,含 md/docx/xlsx）: ${data.artifacts.map((a: any) => a.name || a.title || 'unnamed').join(', ')}`
        } else {
          // 兜底：从流式文本里抽取 code/report 交付物
          const output = data.result?.text || data.result?.content || ''
          const allArtifacts = extractArtifacts(output)
          const codeArtifacts = allArtifacts.filter((a: any) => a.type === 'code')
          const reportArtifacts = allArtifacts.filter((a: any) => a.type === 'report')
          if (codeArtifacts.length > 0 || reportArtifacts.length > 0) {
            artifacts = [...codeArtifacts, ...reportArtifacts]
            content += `\n\n📦 交付物（${artifacts.length}个）: ${artifacts.map((a: any) => a.name || a.title || 'unnamed').join(', ')}`
          }
        }
      } else if (data.type === 'workflow_error' || data.type === 'workflow_failed') {
        content = `❌ 安全测试工作流失败: ${data.error || data.stage || '未知错误'}`
      } else {
        content = `🎉 安全测试工作流执行完毕`
        // 【修复】完整工作流完成时携带后端落盘的三格式交付物(md/docx/xlsx)
        if (data.artifacts && data.artifacts.length > 0) {
          artifacts = data.artifacts
          content += `\n\n📦 交付物（${data.artifacts.length}个,含 md/docx/xlsx）: ${data.artifacts.map((a: any) => a.name || a.title || 'unnamed').join(', ')}`
        }
      }
      
      messages.value.push({
        id,
        role: 'assistant',
        type: 'system',
        content,
        timestamp: new Date().toISOString(),
        artifacts,
        workflowId: data.workflowId,
      })
      return
    }

    // 普通 workflow 阶段事件（走 WorkflowView，panel='workflow' 时已由 writeMsg 处理）

    switch (data.type) {
      case 'connected':
        // 连接成功，不添加日志
        wsConnected.value = true
        return

      case 'chat_message':
        // 后端推送的 ChatMessage，直接加入消息列表供 DashboardChatPanel 显示
        if (data.data && data.data.role && data.data.content) {
          writeMsg(data.data)
        }
        return

      case 'agent_output':
        // 智能体流式输出：实时追加/更新 assistant 消息，DashboardChatPanel 会渲染 messages
        if (data.agentId && data.fullContent !== undefined) {
          const lastMsg = messages.value[messages.value.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            // 更新最后一条 assistant 消息（流式追加效果）
            lastMsg.content = data.fullContent
          } else {
            // 新建 assistant 消息
            writeMsg({
              id: `agent-${Date.now()}`,
              role: 'assistant',
              type: 'agent',
              content: data.fullContent || '',
              timestamp: new Date().toISOString(),
              agentId: data.agentId,
              thinking: [],
              isStreaming: false,
            })
          }
        }
        return

      case 'agent_skill_result':
        // 智能体通过工具调用真正执行了 skill（如 ui/api-test-tool-invoker），回传结构化结果
        realtimeSkillResult.value = data
        return

      case 'task_created':
        message = `任务已创建: ${data.task?.id || 'unknown'}`
        status = 'info'
        if (data.task) {
          tasks.value.unshift(data.task)
        }
        break

      case 'agent_rejected':
        // Agent 输入物校验未通过，提示用户补充输入
        writeMsg({
          id: `agent-rejected-${data.taskId}`,
          role: 'system',
          type: 'system',
          content: `❌ 智能体 [${data.agentId || '未知'}] 拒绝执行：${data.reason || data.message || '输入物不足'}\n${data.description ? `\n补充建议：${data.description}` : ''}\n\n请在下方输入补充信息后重新提交。`,
          timestamp: new Date().toISOString(),
        })
        break

      case 'task_started':
        message = `任务开始执行: ${data.taskId}`
        status = 'info'
        break

      case 'task_progress':
        message = `进度更新: ${data.message || data.taskId} (${data.progress || 0}%)`
        status = 'info'
        // 更新任务列表中的进度
        if (data.taskId) {
          const task = tasks.value.find(t => t.id === data.taskId)
          if (task) {
            task.status = 'running'
            task.progress = data.progress
          }
        }
        break

      case 'task_interaction':
        message = `[${data.agentId}] ${data.message || '交互中'} `
        status = 'info'
        break

      case 'reviewer_started':
        // 与流水线页一致：🛡️ AI质量审核-X 开始审核（第X/3个）
        writeMsg({
          id: `reviewer-started-${data.taskId || Date.now()}-${data.reviewerIndex}`,
          role: 'assistant',
          type: 'agent',
          agentName: data.reviewerName || data.reviewerId,
          content: `🛡️ ${data.reviewerName || data.reviewerId} 开始审核（第${data.reviewerIndex}/${data.totalReviewers}个）`,
          timestamp: new Date().toISOString(),
        })
        break

      case 'reviewer_completed':
        // 与流水线页一致：🛡️ AI质量审核-X 审核完成（XX分 ✅）+ 产出物预览代码块
        {
          const vetoMark = data.veto ? '❌否决' : '✅'
          const now = new Date().toISOString()
          // 产出物预览：把审核输出用 markdown 代码块包裹（黑色背景区域）
          // 注意：data.output 可能是空字符串，要用 != null 判断
          const rawOutput = data.output != null ? data.output : (data.reason || '')
          const outputPreview = rawOutput && String(rawOutput).trim()
            ? `\n\n📄 **产出物预览：**\n\`\`\`\n${typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2)}\n\`\`\``
            : ''
          writeMsg({
            id: `reviewer-completed-${data.taskId || Date.now()}-${data.reviewerIndex}`,
            role: 'assistant',
            type: 'agent',
            agentName: data.reviewerName || data.reviewerId,
            content: `🛡️ ${data.reviewerName || data.reviewerId} 审核完成（${data.score}分 ${vetoMark}）${outputPreview}`,
            timestamp: now,
            // 审核结果同时作为可下载的输出物
            artifacts: rawOutput && String(rawOutput).trim() ? [{
              id: `artifact-${Date.now()}-review`,
              name: '审核结果.json',
              type: 'code',
              contentType: 'application/json',
              content: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2),
              createdAt: now
            }] : undefined
          })
        }
        break

      case 'task_completed':
        message = `✅ 任务完成: ${data.task?.id || data.taskId}`
        status = 'success'
        // 【修复】兼容平铺结构：安全测试工作流的 task_completed 无 data.task（只有 taskId/status/result/userId），
        // 由后端同时下发 task 对象；这里再做一次平铺兜底，确保任何结构都能渲染到聊天面板
        const taskData = data.task || (data.taskId ? {
          id: data.taskId,
          status: data.status,
          result: data.result,
          output: data.output,
          userId: data.userId,
          agent: data.agentId || data.agent,
          agentName: data.agentName,
          artifacts: data.artifacts,
        } : null)
        if (taskData) {
          const idx = tasks.value.findIndex(t => t.id === taskData.id)
          if (idx >= 0) {
            // 合并：保留已有 username（GET /api/tasks 拉的完整数据），用 SSE 数据补全其余字段
            tasks.value[idx] = { ...tasks.value[idx], ...taskData, username: tasks.value[idx].username }
          } else {
            tasks.value.unshift(taskData)
          }

          // 将任务输出和输出物同步到 messages，供聊天面板显示
          let taskOutput = taskData.output || ''
          if (!taskOutput && taskData.result) {
            taskOutput = typeof taskData.result === 'string' ? taskData.result : JSON.stringify(taskData.result)
          }
          const baseArtifacts = taskData.artifacts || []
          // 前端兜底：服务端没交付物时，从输出里提取 markdown 报告，避免聊天面板空白
          const reportArtifacts = extractArtifacts(taskOutput).filter((a: any) => a.type === 'report')
          const taskArtifacts = baseArtifacts.length > 0 ? baseArtifacts : reportArtifacts

          // 【Bug修复】覆盖已有的 agent 流式消息（agent_stream_start 创建的，content 只是流式累积的片段）：
          // 当流式中断、部分 chunk 丢失或 agent 未输出实际内容时，agent 消息只显示片段
          // （如"我先读取..."+ tool_call 文本而无后续完整报告）。任务完成时用 taskData.result 覆盖
          // 该 agent 消息的 content，保证用户看到完整报告，thinking/tool_call 累积保留。
          const streamAgentMsg = messages.value.find(m =>
            m.role === 'assistant' && m.type === 'agent' &&
            m.agentId === (taskData.agentId || taskData.agent) &&
            m.id !== `task-output-${taskData.id}`
          )
          if (streamAgentMsg && taskOutput) {
            // 【修复】覆盖流式片段为完整报告，并追加明确的“任务完成”标记，避免用户看不到完成信号
            streamAgentMsg.content = `✅ 任务 ${taskData.id} 完成\n\n${taskOutput}`
            if (taskArtifacts.length > 0) streamAgentMsg.artifacts = taskArtifacts
            if (streamAgentMsg.isStreaming) streamAgentMsg.isStreaming = false
          }

          // 【修复重复输出】ensureTaskDeliverable 轮询兜底已在任务完成前插入了消息，
          // 这里检查是否已存在，避免 SSE 事件重复推送导致同一个交付物出现两条
          const existingMsgId = `task-output-${taskData.id}`
          const alreadyExists = messages.value.some(m => m.id === existingMsgId)
          if (alreadyExists) {
            // 已由轮询兜底插入，仅更新 artifacts 和 content（确保内容最新）
            const existingMsg = messages.value.find(m => m.id === existingMsgId)!
            existingMsg.content = `任务 ${taskData.id} 完成\n\n${taskOutput}${taskArtifacts.length > 0 ? `\n\n📦 输出物（${taskArtifacts.length}个）: ${taskArtifacts.map((a: any) => a.name || a.title || 'unnamed').join(', ')}` : ''}`
            existingMsg.artifacts = taskArtifacts.length > 0 ? taskArtifacts : undefined
          } else if (taskOutput || taskArtifacts.length > 0) {
            const artifactMsgs = taskArtifacts.length > 0
              ? `\n\n📦 输出物（${taskArtifacts.length}个）: ${taskArtifacts.map((a: any) => a.name || a.title || 'unnamed').join(', ')}`
              : '';
            writeMsg({
              id: existingMsgId,
              role: 'assistant',
              type: 'agent',
              content: `任务 ${taskData.id} 完成\n\n${taskOutput}${artifactMsgs}`,
              timestamp: new Date().toISOString(),
              agentId: taskData.agentId || taskData.agent,
              artifacts: taskArtifacts.length > 0 ? taskArtifacts : undefined,
            });
          }

          // 【方案A】任务完成后自动进入对话模式——通过 localStorage 桥接 store 与 view
          try {
            const taskId = taskData.id
            const agentId = taskData.agentId || taskData.agent
            const taskName = taskData.agentName || taskData.type || agentId || '任务'
            localStorage.setItem('__autoChatMode', JSON.stringify({
              taskId,
              agentId,
              taskName,
              timestamp: Date.now()
            }))
          } catch (_) {}
        }
        break

      case 'task_review_exhausted':
        // 审核未通过，推送消息到聊天面板供用户看到原因
        const exhaustedReason = data.reason || data.message || '达到最大重试次数'
        message = `❌ AI审核未通过：${exhaustedReason}`
        status = 'error'
        writeMsg({
          id: `review-exhausted-${data.taskId}`,
          role: 'system',
          type: 'system',
          content: `❌ 任务 ${data.taskId} 审核未通过：${exhaustedReason}\n\n请检查输入内容是否充分或调整需求后重新提交。`,
          timestamp: new Date().toISOString(),
        })
        if (data.taskId) {
          const idx = tasks.value.findIndex(t => t.id === data.taskId)
          if (idx >= 0) {
            const task = tasks.value[idx]!
            task.reviewResults = data.reviewResults
            task.reviewPassed = false
            task.reviewFailed = true
            task.reviewing = false
          }
        }
        // 【修复】审核未通过也展示脚本交付件(后端已在 task_review_exhausted 中保留 artifacts)
        if (data.artifacts && data.artifacts.length > 0) {
          const outId = `task-output-${data.taskId}`
          const existing = messages.value.find(m => m.id === outId)
          if (existing) {
            existing.artifacts = data.artifacts
            if (!existing.content.includes('📦')) {
              existing.content += `\n\n📦 已保留生成的脚本交付物(${data.artifacts.length}个): ${data.artifacts.map((a: any) => a.name || a.title || 'unnamed').join(', ')}`
            }
          } else {
            writeMsg({
              id: outId,
              role: 'assistant',
              type: 'agent',
              content: `📦 AI 审核未通过,但已保留生成的脚本交付物(${data.artifacts.length}个): ${data.artifacts.map((a: any) => a.name || a.title || 'unnamed').join(', ')}`,
              timestamp: new Date().toISOString(),
              artifacts: data.artifacts,
            })
          }
        }
        break
      case 'task_review_failed':
        // 本轮审核未通过，提示用户
        message = `⚠️ 本轮审核未通过，将自动重试`
        status = 'warning'
        writeMsg({
          id: `review-failed-${data.taskId}`,
          role: 'system',
          type: 'system',
          content: `⚠️ 任务 ${data.taskId} 本轮审核未通过，系统将自动重试。`,
          timestamp: new Date().toISOString(),
        })
        if (data.taskId) {
          const idx = tasks.value.findIndex(t => t.id === data.taskId)
          if (idx >= 0) {
            const task = tasks.value[idx]!
            task.reviewResults = data.reviewResults
            task.reviewing = true
          }
        }
        break

      case 'task_review_started':
        message = `🛡️ ${data.agentName} 任务执行完成，开始 AI 质量审核（共 ${data.reviewerCount} 个审核智能体）`
        status = 'info'
        if (data.taskId) {
          const idx = tasks.value.findIndex(t => t.id === data.taskId)
          if (idx >= 0) {
            const task = tasks.value[idx]!
            task.reviewing = true
          }
        }
        break

      case 'task_review_passed':
        message = `✅ AI审核通过！评分：${data.reviewResults?.map((r: any) => r.score).join(', ') || ''}`
        status = 'success'
        if (data.taskId) {
          const idx = tasks.value.findIndex(t => t.id === data.taskId)
          if (idx >= 0) {
            const task = tasks.value[idx]!
            task.reviewResults = data.reviewResults
            task.reviewPassed = true
            task.reviewing = false
            // 如果有 artifacts，同步到任务对象
            if (data.artifacts && data.artifacts.length > 0) {
              task.artifacts = data.artifacts
            }
          }
          // 将审核通过和输出物同步到 messages，供聊天面板显示
          const taskArtifacts = data.artifacts || []
          const outputFiles = data.outputFiles || []
          if (taskArtifacts.length > 0) {
            const artifactMsgs = `\n\n📦 输出物（${taskArtifacts.length}个）: ${taskArtifacts.map((a: any) => a.name || a.title || 'unnamed').join(', ')}`
            writeMsg({
              id: `task-review-output-${data.taskId}`,
              role: 'assistant',
              type: 'agent',
              content: `${message}${artifactMsgs}`,
              timestamp: new Date().toISOString(),
              agentId: data.agentId,
              artifacts: taskArtifacts,
            });
          }
        }
        break

      case 'task_review_retry':
        message = `🔄 正在重新执行任务（第 ${data.retry} 次重试）...`
        status = 'warning'
        break

      case 'task_error':
        message = `❌ 任务错误: ${data.taskId} - ${data.error}`
        status = 'error'
        if (data.task) {
          const idx = tasks.value.findIndex(t => t.id === data.task.id)
          if (idx >= 0) {
            tasks.value[idx] = data.task
          }
        }
        break

      case 'workflow_started':
        message = `🚀 工作流启动: ${data.workflowId}`
        status = 'info'
        break

      case 'workflow_phase':
        message = `📋 工作流阶段: ${data.phase || data.phaseName}`
        status = 'info'
        break

      case 'workflow_step':
        message = `🔄 工作流步骤: ${data.stepName || data.step}`
        status = 'info'
        break

      case 'workflow_completed':
        {
          message = `🎉 工作流完成: ${data.workflowId}`
          status = 'success'
          // 更新任务状态为 completed
          const wfIdx = tasks.value.findIndex(t => t.id === data.workflowId)
          if (wfIdx >= 0) {
            const workflowTask = tasks.value[wfIdx]!
            const updated = { ...workflowTask, status: 'completed' as const, completedAt: data.completedAt || new Date().toISOString() }
            const updatedTasks = [...tasks.value]
            updatedTasks[wfIdx] = updated
            tasks.value = updatedTasks
            console.log(`[Workflow] Task ${data.workflowId} status updated to completed`)
          }
          // 提取 artifacts：从 executorResults 或 workflow.executorResults 中提取
          const executorResults = data.executorResults || (data.workflow && data.workflow.workflowResults && data.workflow.workflowResults.executorResults) || []
          if (executorResults.length > 0 && wfIdx >= 0) {
            const workflowTask = tasks.value[wfIdx]!
            const existing = workflowTask.artifacts || []
            const newArtifacts: any[] = []
            for (const r of executorResults) {
              if (r.artifacts && r.artifacts.length > 0) {
                for (const a of r.artifacts) {
                  if (!existing.find((e: any) => e.name === a.name)) {
                    newArtifacts.push(a)
                  }
                }
              }
              // 也尝试从 result 文本中提取（兜底）
              if (r.result && typeof r.result === 'string') {
                const extracted = extractArtifacts(r.result, { stageName: r.stage || r.agentId })
                for (const a of extracted) {
                  if (!existing.find((e: any) => e.name === a.name) && !newArtifacts.find((e: any) => e.name === a.name)) {
                    newArtifacts.push(a)
                  }
                }
              }
            }
            if (newArtifacts.length > 0) {
              const updated = { ...workflowTask, artifacts: [...existing, ...newArtifacts] }
              const updatedTasks = [...tasks.value]
              updatedTasks[wfIdx] = updated
              tasks.value = updatedTasks
              console.log(`[Workflow] Extracted ${newArtifacts.length} artifacts from workflow_completed`)
            }
          }
          // 发送工作流完成消息到聊天面板
          writeMsg({
            id: `wf-completed-${data.workflowId}-${Date.now()}`,
            role: 'assistant',
            type: 'system',
            content: `🎉 工作流执行完成\n\n**任务ID**: ${data.workflowId}\n**状态**: 已完成\n**完成时间**: ${new Date().toLocaleString()}`,
            timestamp: new Date().toISOString(),
            workflowId: data.workflowId
          })
          break
        }

      case 'workflow_failed':
      case 'workflow_error':
        {
          message = `💥 工作流失败: ${data.workflowId} - ${data.error}`
          status = 'error'
          // 更新任务状态为 failed
          const wfIdx = tasks.value.findIndex(t => t.id === data.workflowId)
          if (wfIdx >= 0) {
            const workflowTask = tasks.value[wfIdx]!
            const updated = { ...workflowTask, status: 'failed' as const, error: data.error || '工作流执行失败' }
            const updatedTasks = [...tasks.value]
            updatedTasks[wfIdx] = updated
            tasks.value = updatedTasks
            console.log(`[Workflow] Task ${data.workflowId} status updated to failed`)
          }
          // 发送工作流失败消息到聊天面板
          writeMsg({
            id: `wf-failed-${data.workflowId}-${Date.now()}`,
            role: 'assistant',
            type: 'system',
            content: `💥 工作流执行失败\n\n**任务ID**: ${data.workflowId}\n**错误**: ${data.error || '未知错误'}`,
            timestamp: new Date().toISOString(),
            workflowId: data.workflowId
          })
          break
        }

      case 'workflow_timeout':
        {
          message = `⏰ 工作流超时: ${data.workflowId} - ${data.message || '执行超时'}`
          status = 'error'
          // 更新任务状态为 failed（超时也算失败）
          const wfIdx = tasks.value.findIndex(t => t.id === data.workflowId)
          if (wfIdx >= 0) {
            const workflowTask = tasks.value[wfIdx]!
            const updated = { ...workflowTask, status: 'failed' as const, error: data.message || '工作流执行超时' }
            const updatedTasks = [...tasks.value]
            updatedTasks[wfIdx] = updated
            tasks.value = updatedTasks
            console.log(`[Workflow] Task ${data.workflowId} status updated to failed (timeout)`)
          }
          break
        }

      case 'executor_completed':
        message = `⚡ 执行器完成: ${data.executorId}`
        status = 'success'
        break

      case 'agent_started':
        // 工作流阶段开始，创建流式消息占位
        if (data.workflowId && data.agentId) {
          const agentMessage: ChatMessage = {
            id: `${data.workflowId}-${data.agentId}-${Date.now()}`,
            role: 'assistant',
            type: 'agent',
            content: data.message || `🤖 ${data.agentId} 开始执行...`,
            timestamp: data.timestamp || new Date().toISOString(),
            agentName: data.agentId ? (data.agentId.replace('test-', '').replace(/-/g, ' ')) : '智能体',
            agentIcon: getAgentEmoji(data.agentId || 'unknown'),
            agentId: data.agentId,
            isStreaming: true,
            thinking: [],
            workflowId: data.workflowId,
            stage: data.stage
          }
          writeMsg(agentMessage)
        }
        return

      case 'agent_completed':
        {
          // 智能体执行完成，查找对应的消息并附加输出物
          const msgId = data.streamMsgId || (data.agentId && data.workflowId ? `${data.workflowId}-${data.agentId}` : null)
          // 根据 panel 确定搜索哪个消息列表
          const targetMessages = panel === 'workflow' ? workflowMessages.value : messages.value
          let target = msgId ? targetMessages.find(m => m.id === msgId) : null
          // 兜底：streamMsgId/workflowId 都缺失时，匹配该智能体最后一条流式消息
          if (!target && data.agentId) {
            const candidates = targetMessages.filter(m => m.agentId === data.agentId && m.isStreaming)
            if (candidates.length > 0) target = candidates[candidates.length - 1]
          }
          if (target) {
            target.isStreaming = false
            if (data.result && data.result.trim()) {
              target.content = data.result
            }
            if (data.artifacts && data.artifacts.length > 0) {
              target.artifacts = data.artifacts
            } else if (data.result) {
              // 后端未传artifacts时前端自行提取（含 markdown 报告）
              target.artifacts = extractArtifacts(data.result)
            }
          } else if (data.result) {
            // 没找到任何可附加的消息，作为新消息展示完整输出
            const agentMessage: ChatMessage = {
              id: `agent-comp-${Date.now()}`,
              role: 'assistant',
              type: 'agent',
              content: data.result,
              timestamp: data.timestamp || new Date().toISOString(),
              agentName: data.agentId ? (data.agentId.replace('test-', '').replace(/-/g, ' ')) : '智能体',
              agentIcon: getAgentEmoji(data.agentId || 'unknown'),
              agentId: data.agentId,
              isStreaming: false,
              thinking: [],
              artifacts: data.artifacts
            }
            writeMsg(agentMessage)
          } else {
            message = `✅ ${data.agentId || '智能体'} 执行完成`
            status = 'success'
          }
        }
        break

      case 'reviewer_started':
        message = `🛡️ ${data.reviewerName || data.reviewerId} 开始审核（第${data.reviewerIndex}/${data.totalReviewers}个）`
        status = 'info'
        break
      case 'reviewer_completed':
        message = `🛡️ ${data.reviewerName || data.reviewerId} 审核完成（${data.score}分 ${data.veto ? '❌否决' : '✅' }）`
        status = data.veto ? 'error' : 'success'
        break
      case 'parallel_review_completed':
        message = `🛡️ 并行审核完成: ${data.taskId}`
        status = 'success'
        break

      // 人机交互模式：已改为自动重试，移除用户决策等待
      // case 'step_passed_wait_user': // 不再需要，后端自动重试
      //   break

      case 'workflow_manual_processing':
        message = `🔧 工作流进入人工处理模式: ${data.workflowId}`
        status = 'info'
        break

      case 'workflow_stopped':
        message = `⏹️ 工作流已停止: ${data.workflowId}`
        status = 'info'
        break

      // ==================== 人机交互模式自动重试事件 ====================
      
      case 'workflow_review_failed':
        message = `⚠️ AI审核未通过，将自动重新执行\n原因：${data.reason || '审核不通过'}\n${data.reviewResults ? `审核结果：${data.reviewResults.map((r: any) => r.reviewerName + ': ' + r.score + '分').join(', ')}` : ''}`
        status = 'warning'
        console.log(`[SSE] Workflow ${data.workflowId} review failed, auto retry triggered`);
        break

      case 'workflow_auto_retry':
        message = `🔄 自动重新执行当前阶段（第 ${data.retryCount}/${data.maxRetries} 次尝试）...`
        status = 'warning'
        console.log(`[SSE] Workflow ${data.workflowId} auto retry ${data.retryCount}/${data.maxRetries}`);
        // 可以通过自定义事件通知前端显示重试进度
        window.dispatchEvent(new CustomEvent('workflow-auto-retry', { detail: data }));
        break

      case 'workflow_failed':
        message = `❌ 工作流失败：已达最大重试次数（${data.reason || '审核未通过'}）`
        status = 'error'
        console.log(`[SSE] Workflow ${data.workflowId} failed after max retries`);
        // 通知前端显示失败消息
        window.dispatchEvent(new CustomEvent('workflow-failed', { detail: data }));
        break

      case 'workflow_consensus_passed':
        message = `✅ 共识通过: ${data.workflowId}`
        status = 'success'
        break

      case 'kb_updated':
        message = `📚 知识库更新: ${data.doc?.name || '文档'} 已${data.action === 'upload' ? '上传' : '更新'}`
        status = 'success'
        break

      case 'kb_vectorized':
        message = `📊 文档已向量化: ${data.docId}`
        status = 'success'
        break

      case 'debug_test':
        message = `🔔 测试广播: ${data.message}`
        status = 'info'
        break

      // ==================== 流式输出消息 ====================
      case 'agent_stream_event':
        // 后端 auto-with-review / executeAutoNativeWorkflow 用 agent_stream_event 包裹真实类型
        if (data.event && data.event.type) {
          const inner = { ...data.event, workflowId: data.workflowId, streamMsgId: data.event.streamMsgId || data.streamMsgId, agentId: data.event.agentId || data.agentId, agentName: data.event.agentName || data.agentName };
          handleRealtimeEvent(inner);
        }
        return

      case 'agent_stream_start':
        {
          const streamMsg: ChatMessage = {
            id: data.streamMsgId || Date.now().toString(),
            role: 'assistant',
            type: 'agent',
            content: '',
            timestamp: new Date().toISOString(),
            agentName: data.agentName || (data.agentId ? (data.agentId.replace('test-', '').replace(/-/g, ' ')) : '智能体'),
            agentIcon: getAgentEmoji(data.agentId || 'unknown'),
            agentId: data.agentId,
            isStreaming: true,
            thinking: [],
            // 携带 workflowId，供 PerfTestExecutor 等按 workflowId 过滤实时面板内容
            workflowId: data.workflowId,
          }
          writeMsg(streamMsg)
          // 自动滚动到底部
          nextTick(() => {
            const container = document.querySelector('.messages-container')
            if (container) container.scrollTop = container.scrollHeight
          })
        }
        return

      case 'agent_stream_chunk':
        {
          // 流式消息可能写入 messages（单任务/security）或 workflowMessages（perf-wf-/perf-single- 等工作流），两处都找
          const target = messages.value.find(m => m.id === data.streamMsgId)
            || workflowMessages.value.find(m => m.id === data.streamMsgId)
          if (!target) return
          // 兼容两种字段名：后端发 content/chunkText，前端期望 chunkType/chunkText
          const chunkType = data.chunkType || 'content'
          const chunkText = data.chunkText || data.content || ''
          if (chunkType === 'thinking') {
            // 追加到最后一个 thinking step 或创建新的
            if (target.thinking && target.thinking.length > 0) {
              const lastStep = target.thinking[target.thinking.length - 1]
              if (lastStep && lastStep.type === 'thinking') {
                lastStep.content += chunkText
              } else {
                target.thinking.push({
                  id: `think-${Date.now()}`,
                  type: 'thinking',
                  content: chunkText,
                  timestamp: new Date().toISOString()
                })
              }
            } else {
              target.thinking = [{
                id: `think-${Date.now()}`,
                type: 'thinking',
                content: chunkText,
                timestamp: new Date().toISOString()
              }]
            }
          } else if (chunkType === 'tool_call') {
            // 尝试解析 JSON 格式的工具调用
            try {
              const toolInfo = JSON.parse(chunkText)
              if (!target.thinking) target.thinking = []
              // 智能合并：查找同名的最后一个 tool_call 进行内容合并，避免重复
              const toolName = toolInfo.name || toolInfo.tool || 'unknown'
              const lastToolStep = [...target.thinking].reverse().find(s => s.type === 'tool_call' && s.toolName === toolName)
              if (lastToolStep) {
                // 追加参数（流式累积）
                try {
                  const merged = JSON.parse(lastToolStep.content)
                  const incoming = toolInfo.arguments || toolInfo
                  if (typeof incoming === 'string') {
                    // 正在流式累积 JSON 字符串片段，直接拼接
                    lastToolStep.content = lastToolStep.content.replace(/\s*$/, '') + (typeof incoming === 'string' ? incoming : JSON.stringify(incoming, null, 2))
                  } else {
                    Object.assign(merged, incoming)
                    lastToolStep.content = JSON.stringify(merged, null, 2)
                  }
                } catch {
                  lastToolStep.content += chunkText
                }
              } else {
                target.thinking.push({
                  id: `tool-${Date.now()}`,
                  type: 'tool_call',
                  content: JSON.stringify(toolInfo.arguments || toolInfo, null, 2),
                  timestamp: new Date().toISOString(),
                  toolName
                })
              }
            } catch {
              target.content += chunkText
            }
          } else {
            target.content += chunkText
          }
        }
        return

      case 'agent_stream_end':
        {
          let target = messages.value.find(m => m.id === data.streamMsgId)
            || workflowMessages.value.find(m => m.id === data.streamMsgId)
          // 兜底：streamMsgId 未匹配时，取该智能体最后一条流式消息
          if (!target && data.agentId) {
            const candidates = [...messages.value, ...workflowMessages.value].filter(m => m.agentId === data.agentId && m.isStreaming)
            if (candidates.length > 0) target = candidates[candidates.length - 1]
          }
          if (target) {
            target.isStreaming = false
            // 如果有完整内容，覆盖（确保最终结果一致）
            // 兼容两种字段名
            if ((data.fullContent || data.content) && (data.fullContent || data.content).trim()) {
              target.content = data.fullContent || data.content
            }
            // 提取输出物（代码块 / markdown 报告等）
            if (!target.artifacts || target.artifacts.length === 0) {
              target.artifacts = extractArtifacts(target.content)
            }
          }
        }
        return

      case 'agent_artifacts':
        // 智能体生成的输出物
        console.log(`[SSE] Artifacts from ${data.agentId}:`, data.artifacts)
        {
          const target = messages.value.find(m => m.id === data.streamMsgId)
            || workflowMessages.value.find(m => m.id === data.streamMsgId)
          if (target && data.artifacts && data.artifacts.length > 0) {
            target.artifacts = data.artifacts
          }
        }
        return

      // ==================== 任务实时交互消息 ====================
      case 'task_user_message':
        // 用户发送到任务的消息（已在handleSendTask中添加，这里避免重复）
        console.log(`[SSE] User message for task ${data.taskId}: ${data.message}`)
        break

      case 'task_agent_message':
        {
          // 智能体发送到前端的消息
          console.log(`[SSE] Agent message for task ${data.taskId}: ${data.message}`)
          // 将智能体消息添加到消息列表
          const agentMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'assistant',
            type: 'agent',
            content: data.message,
            timestamp: data.timestamp || new Date().toISOString(),
            agentName: data.agentId || '智能体',
            agentIcon: getAgentEmoji(data.agentId || 'unknown')
          }
          writeMsg(agentMessage)
        }
        break

      case 'kb_learn_progress':
        {
          const kb = useKnowledgeStore()
          kb.updateLearnProgress(data)
        }
        return

      case 'kb_learn_done':
        {
          const kb = useKnowledgeStore()
          kb.finishLearn(data)
          message = `📚 知识学习完成：共 ${data.total} 篇文档，覆盖 ${data.learnedAgents} 个智能体`
          status = 'success'
        }
        break

      default:
        message = `${data.type}: ${JSON.stringify(data).slice(0, 50)}`
        status = 'info'
    }

    addRealtimeLog({
      type: data.type,
      agentId: data.agentId,
      taskId: data.taskId,
      message,
      timestamp,
      status
    })
  }

  // ==================== Workflow 聊天消息持久化 ====================
  const WF_STORAGE_KEY = 'wf_messages_store'
  const WF_TTL = 7 * 24 * 3600 * 1000 // 7 天

  // 所有任务的聊天消息
  const workflowMessages = ref<ChatMessage[]>([])

  // 重构后：store 自动持久化 workflowMessages（防抖 500ms）
  let _wfPersistTimer: ReturnType<typeof setTimeout> | null = null
  watch(() => workflowMessages.value.length, () => {
    if (_wfPersistTimer) clearTimeout(_wfPersistTimer)
    _wfPersistTimer = setTimeout(() => persistWorkflowMessages(), 500)
  })

  /** 从 localStorage 恢复所有任务的聊天消息 */
  function restoreWorkflowMessages() {
    const raw = localStorage.getItem(WF_STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      if (Date.now() - data.savedAt > WF_TTL) {
        localStorage.removeItem(WF_STORAGE_KEY)
        workflowMessages.value = []
        return
      }
      workflowMessages.value = data.messages || []
    } catch {
      workflowMessages.value = []
    }
  }

  /** 持久化聊天消息到 localStorage */
  function persistWorkflowMessages(messages?: ChatMessage[]) {
    const msgs = messages ?? workflowMessages.value
    const payload = { messages: msgs, savedAt: Date.now() }
    localStorage.setItem(WF_STORAGE_KEY, JSON.stringify(payload))
  }

  // 断开实时事件连接
  function disconnectRealtimeEvents() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    if (statsInterval) {
      clearInterval(statsInterval)
      statsInterval = null
    }
  }

  // ==================== 统计刷新 ====================
  async function fetchStats() {
    statsLoading.value = true
    try {
      const response = await fetch('/api/stats', { headers: { ...getAuthHeaders() } })
      if (response.ok) {
        stats.value = await response.json()
      }
    } catch (error) {
      console.error('获取统计信息失败:', error)
    } finally {
      statsLoading.value = false
    }
  }

  function startStatsRefresh() {
    // 立即获取一次
    fetchStats()
    // 每 3 分钟刷新一次
    statsInterval = setInterval(fetchStats, 3 * 60 * 1000)
  }

  return {
    // 用户状态
    user,
    token,
    ssoConfig,
    refreshToken,
    isLoggedIn,
    isAdmin,

    // 状态
    agents,
    tasks,
    knowledgeDocs,
    currentAgent,
    messages,
    isLoading,
    wsConnected,

    // 实时事件
    realtimeLogs,
    realtimeSkillResult,
    stats,
    statsLoading,

    // 计算属性
    agentCount,
    taskCount,
    completedCount,
    runningCount,
    avgTaskTime,

    // 用户方法
    setUser,
    logout,
    loadUserFromStorage,
    loadSsoConfig,
    ssoLogin,
    handleSsoCallback,
    refreshAccessToken,

    // 方法
    loadAgents,
    loadTasks,
    loadKnowledgeDocs,
    loadConversationHistory,
    loadRecentTaskResults,
    createTask,
    addMessage,
    clearMessages,
    clearMessagesForAgent,
    clearAllMessages,
    setCurrentAgent,
    messagesByAgent,
    setWsConnected,

    // 实时事件
    connectRealtimeEvents,
    disconnectRealtimeEvents,
    workflowMessages,
    restoreWorkflowMessages,
    persistWorkflowMessages,
    addRealtimeLog,
    handleRealtimeEvent,

    // 统计
    fetchStats,
    startStatsRefresh,
    startTokenRefresh,
  }
})