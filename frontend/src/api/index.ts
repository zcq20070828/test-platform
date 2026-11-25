// API 服务 - 与后端通信

import type { Agent, Task, KnowledgeDoc, ApiResponse } from '@/types'

const API_BASE = ''

// 获取认证头
export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  if (token) {
    return { 'Authorization': `Bearer ${token}` }
  }
  return {}
}

// 401 静默续期：single-flight（并发 401 只发一次刷新，避免后到的请求用旧 token 失败）
let refreshPromise: Promise<string | null> | null = null

function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return Promise.resolve(null)

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) return null
      const data = await res.json()
      if (!data?.token) return null
      localStorage.setItem('token', data.token)
      // 同步 localStorage.user，避免刷新页面后 user.token 仍是旧值
      const storedUser = localStorage.getItem('user')
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser)
          parsed.token = data.token
          localStorage.setItem('user', JSON.stringify(parsed))
        } catch { /* ignore */ }
      }
      // 通知 Pinia（SSE 重连等仍持有旧 token 的地方）刷新内存态
      try {
        window.dispatchEvent(new CustomEvent('auth:token-refreshed', { detail: { token: data.token } }))
      } catch { /* ignore */ }
      return data.token as string
    } catch {
      return null
    } finally {
      // 释放锁放到微任务，保证同一事件循环内的并发请求共享同一个 promise
      setTimeout(() => { refreshPromise = null }, 0)
    }
  })()
  return refreshPromise
}

// 通用请求方法
export async function request<T>(
  endpoint: string,
  options?: RequestInit & { raw?: boolean }
): Promise<ApiResponse<T>> {
  try {
    const isRaw = options?.raw && options?.body instanceof FormData
    const buildHeaders = (token?: string | null) => {
      const auth = token ? { 'Authorization': `Bearer ${token}` } : getAuthHeaders()
      return isRaw
        ? { ...auth, ...options?.headers }
        : { 'Content-Type': 'application/json', ...auth, ...options?.headers }
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: buildHeaders()
    })

    // 401 未授权 → single-flight 刷新后重试一次，仍失败才触发会话过期
    if (response.status === 401) {
      const isAuthEndpoint = endpoint === '/api/auth/login' || endpoint === '/api/auth/register' || endpoint === '/api/auth/refresh'
      if (!isAuthEndpoint) {
        const newToken = await refreshAccessToken()
        if (newToken) {
          const retryResponse = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: buildHeaders(newToken)
          })
          if (retryResponse.ok) {
            const retryData = await retryResponse.json().catch(() => ({}))
            try { autoLogAction((options?.method || 'GET').toUpperCase(), endpoint) } catch { /* ignore */ }
            return { success: true, data: retryData }
          }
        } else {
          localStorage.removeItem('refreshToken')
        }
        window.dispatchEvent(new CustomEvent('session:expired'))
      }
      const data = await response.json().catch(() => ({}))
      return { success: false, error: data.error || `HTTP ${response.status}` }
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      // 需要用户做选择的响应（如意图不明确时的候选列表）必须把结构化数据透出去，
      // 只留 error 字符串的话前端拿不到 candidates，只能干瞪眼。
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
        code: data.code,
        message: data.message,
        details: data,
      } as ApiResponse<T>
    }

    // 204 / 空响应不强行 json()，避免正常请求被包装成失败
    if (response.status === 204) return { success: true, data: undefined as unknown as T }
    const text = await response.text()
    const data = text ? JSON.parse(text) : undefined
    // 自动记录关键用户行为（防抖，失败静默忽略）
    try { autoLogAction((options?.method || 'GET').toUpperCase(), endpoint) } catch { /* ignore */ }
    return { success: true, data: data as T }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// 拼接查询字符串
function buildQuery(params: Record<string, any>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

// ===== 用户行为自动记录（只记关键 action，最低 3 秒一条） =====
let _lastActionLog = 0
const ACTION_MAP: Record<string, string> = {
  'POST:/api/tasks$': 'task_create',
  'POST:/api/tasks/.*/complete': 'task_complete',
  'POST:/api/workflow/': 'workflow_run',
  'GET:/api/kb$': 'kb_view',
  'POST:/api/kb/upload': 'kb_upload',
  'POST:/api/evaluation': 'evaluation_run',
  'POST:/api/defects$': 'defect_create',
}

function guessAction(method: string, url: string): string | null {
  const key = `${method}:${url.split('?')[0]}`
  for (const [pattern, action] of Object.entries(ACTION_MAP)) {
    if (new RegExp(pattern).test(key)) return action
  }
  return null
}

function autoLogAction(method: string, endpoint: string) {
  if (endpoint.startsWith('/api/user-actions')) return // 避免自身递归
  const action = guessAction(method, endpoint)
  if (action && Date.now() - _lastActionLog > 3000) {
    _lastActionLog = Date.now()
    userActionApi.log({ action, metadata: { url: endpoint, method } }).catch(() => {})
  }
}

// 用户行为统计 API
export const userActionApi = {
  // 记录一条用户行为
  log: (data: { action: string; resourceType?: string; resourceId?: string; metadata?: any; durationMs?: number }) =>
    request<void>('/api/user-actions/log', { method: 'POST', body: JSON.stringify(data) }),
  // 行为明细列表
  list: (params?: { userId?: string; action?: string; resourceType?: string; startDate?: string; endDate?: string; page?: number; size?: number }) =>
    request<any>(`/api/user-actions${buildQuery(params || {})}`),
  // 行为聚合统计（管理员）
  stats: (params?: { startDate?: string; endDate?: string; userId?: string }) =>
    request<any>(`/api/user-actions/stats${buildQuery(params || {})}`)
}

// Token 使用统计 API（管理员）
export const tokenStatsApi = {
  get: (params?: { startDate?: string; endDate?: string; agentId?: string }) =>
    request<any>(`/api/token-stats${buildQuery(params || {})}`)
}

// 认证 API
export const authApi = {
  // 登录
  async login(username: string, password: string): Promise<{ token: string; refreshToken: string; user: any } | null> {
    // 安全整改(2026-10-19): 删除所有凭据日志(此前 password 明文进控制台并打进生产包)
    const res = await request<{ token: string; refreshToken: string; user: any }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    })

    if (res.success) return res.data!
    // 将后端错误信息附加到返回值，供视图显示
    const errMsg = res.error || '登录失败'
    return { token: '', user: null, error: errMsg } as any
  },

  // 注册
  async register(username: string, password: string, name?: string): Promise<{ token: string; user: any } | null> {
    const res = await request<any>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, name })
    })
    if (!res.success) {
      // 将后端错误信息附加到返回值，供视图显示
      return { token: '', user: null, error: res.error || '注册失败' } as any
    }
    const data = res.data!
    // 后端 register 返回 {id, username, name, role}，不含 token
    // 注册成功后需要登录才能获取 token，这里返回用户信息供跳转登录页
    return {
      token: data.token || '',
      user: {
        id: data.id,
        username: data.username,
        name: data.name,
        role: data.role
      }
    }
  }
}

// 智能体 API
export const agentApi = {
  // 获取所有智能体
  async getAll(): Promise<Agent[]> {
    const res = await request<Agent[]>('/api/agents')
    return res.success ? res.data! : []
  },

  // 获取单个智能体
  async getById(id: string): Promise<Agent | null> {
    const res = await request<Agent>(`/api/agents/${id}`)
    return res.success ? res.data! : null
  }
}

// 对话历史 API
export const conversationApi = {
  // 获取最近的对话记录
  async getRecent(limit: number = 20): Promise<any[]> {
    const res = await request<any[]>(`/api/conversations/recent?limit=${limit}`)
    return res.success ? res.data! : []
  }
}

// 任务 API
export const taskApi = {
  // 创建任务
  // files 支持两种格式:
  // 1. KB引用: { kbType: string, filename: string } - 从知识库读取
  // 2. 直接内容: { name: string, content: string } - 直接使用传入的内容
  async create(
    agentId: string,
    input: string,
    files?: { kbType?: string; filename?: string; name?: string; content?: string; base64?: string }[],
    options?: {
      source?: 'step' | 'workflow'
      type?: string
      /**
       * 由输入内容决定执行哪个智能体（2026-11-23）
       *
       * 置 true 时 agentId 降级为「弱偏好」：
       * 后端先用输入内容做意图识别，识别明确就按内容走（可能与 agentId 不同）；
       * 内容识别不出时才回退到 agentId。
       * 之前前端每次都把下拉框的值当「指定智能体」传，导致输入框内容从不参与决策。
       */
      intentDriven?: boolean
      /**
       * 会话归属（2026-11-25 · 对话改造第三步）
       *
       * newSession=true  → 后端自动新建一个会话并把任务挂进去
       * sessionId=xxx    → 挂到已有会话（在同一会话里继续做下一个环节）
       *
       * 不传则任务不归属任何会话，行为与改造前完全一致。
       */
      newSession?: boolean
      sessionId?: string
    }
  ): Promise<{ task?: Task } & ApiResponse<any>> {
    const body: Record<string, any> = {
      input,
      files: files || [],
      source: options?.source || 'step',
      type: options?.type,
    }
    if (options?.intentDriven) {
      // 弱偏好，不叫 agent——后端据此不做 confirmedAgent 处理
      body.preferAgent = agentId
      body.intentDriven = true
    } else {
      body.agent = agentId
    }
    // 会话归属（2026-11-25）：不传则不入会话，行为与改造前一致
    if (options?.newSession) body.newSession = true
    else if (options?.sessionId) body.sessionId = options.sessionId
    console.log('[taskApi.create] Request body:', JSON.stringify({ ...body, input: `${input.slice(0, 50)}…` }))
    const res = await request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (res.success) return { task: res.data!, success: true }
    return { task: undefined, success: false, error: res.error || '创建任务失败' }
  },

  // 获取所有任务
  async getAll(): Promise<Task[]> {
    const res = await request<Task[]>('/api/tasks')
    return res.success ? res.data! : []
  },

  // 获取单个任务
  async getById(id: string): Promise<Task | null> {
    const res = await request<Task>(`/api/tasks/${id}`)
    return res.success ? res.data! : null
  },

  /**
   * 任务过程时间线（2026-11-11）
   *
   * 门禁结果、三个审核员的评分、定向修复轮次这些过程信息过去只活在内存里，
   * 刷新或换设备就没了。后端现在把它们按 seq 落盘，这里按序读回来重放。
   * 同时返回 quality（门禁快照）与 reviews（审核历史）作为兜底：
   * 历史任务没有时间线记录时，也能显示「三轮各打了多少分」。
   */
  async getTimeline(id: string, afterSeq = 0, limit = 200): Promise<any> {
    const res = await request<any>(`/api/tasks/${id}/timeline?afterSeq=${afterSeq}&limit=${limit}`)
    return res.success ? res.data : null
  },

  // 取消运行中的任务
  async cancel(id: string): Promise<{ ok: boolean; task?: Task } & ApiResponse<any>> {
    const res = await request<{ ok: boolean; task: Task }>(`/api/tasks/${id}/cancel`, {
      method: 'POST',
    })
    if (res.success) return { ok: res.data!.ok, task: res.data!.task, success: true }
    return { ok: false, task: undefined, success: false, error: res.error || '取消任务失败' }
  },

  // 向运行中的任务发送消息（交互式工作流）
  async sendMessage(id: string, message: string): Promise<boolean> {
    const res = await request(`/api/tasks/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    })
    return res.success
  },

  // 多轮对话续写（任意状态的任务都可继续对话/修改交付物）
  //
  // options.planId + options.confirmedPlan（2026-11-25 · 对话改造第一步）：
  // 模糊的整体指令会先返回一份变更计划而非直接执行；用户勾选确认后
  // 带上 planId 与裁剪过的 plan 重新调用，后端校验归属后再真正执行。
  async sendChat(
    taskId: string,
    message: string,
    attachments?: { name: string; content?: string; base64?: string }[],
    options?: { planId?: string; confirmedPlan?: any }
  ): Promise<any> {
    const res = await request(`/api/tasks/${taskId}/chat`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        attachments: attachments || [],
        ...(options?.planId ? { planId: options.planId } : {}),
        ...(options?.confirmedPlan ? { confirmedPlan: options.confirmedPlan } : {}),
      }),
    })
    return res
  },

  /**
   * 轻量问答（提交框直接问问题，2026-11-20）
   *
   * 与 create 的区别：不创建任务、不落交付物、不跑三审、不占用串行锁。
   * 回答通过 SSE 的 chat_message / agent_stream_* 推回来，前端消息面板照常渲染。
   */
  async ask(
    question: string,
    options?: {
      agent?: string
      attachments?: { name: string; content?: string; base64?: string }[]
      /** 追加提问时带上上一轮的 askId，让模型接上上下文 */
      continueAskId?: string
    }
  ): Promise<{ success: boolean; askId?: string; agentId?: string; agentName?: string; error?: string }> {
    const res = await request<{ askId: string; agentId: string; agentName: string }>('/api/ask', {
      method: 'POST',
      body: JSON.stringify({
        question,
        agent: options?.agent,
        attachments: options?.attachments || [],
        continueAskId: options?.continueAskId,
      }),
    })
    if (res.success && res.data) return { success: true, ...res.data }
    return { success: false, error: res.error || '提问失败' }
  },
}

/**
 * 会话 API（2026-11-25 · 对话改造第三步）
 *
 * 会话是任务的分组容器，不参与执行——任务仍是唯一执行单元。
 * 目的：让「需求分析 → 用例生成 → 测试方案」在同一上下文里串起来。
 */
export const sessionApi = {
  /** 会话列表（按最近更新排序，带任务数/完成数） */
  async list(limit = 50): Promise<{ success: boolean; sessions?: any[]; error?: string }> {
    const res = await request<{ sessions: any[] }>(`/api/sessions?limit=${limit}`)
    if (res.success && res.data) return { success: true, sessions: (res.data as any).sessions || [] }
    return { success: false, error: res.error || '查询会话失败' }
  },

  /** 新建会话 */
  async create(payload: { title?: string; projectKey?: string } = {}): Promise<{ success: boolean; id?: string; error?: string }> {
    const res = await request<{ id: string }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (res.success && res.data) return { success: true, id: (res.data as any).id }
    return { success: false, error: res.error || '创建会话失败' }
  },

  /** 会话内的产物列表（按序号升序） */
  async tasks(sessionId: string): Promise<{ success: boolean; tasks?: any[]; error?: string }> {
    const res = await request<{ tasks: any[] }>(`/api/sessions/${sessionId}/tasks`)
    if (res.success && res.data) return { success: true, tasks: (res.data as any).tasks || [] }
    return { success: false, error: res.error || '查询会话产物失败' }
  },
}

// 测试框架 API
export const testFrameworkApi = {
  // 执行测试
  async execute(body: {
    testPath: string
    framework?: string
    options?: {
      workers?: number
      timeout?: number
      retries?: number
      coverage?: boolean
      verbose?: boolean
      debug?: boolean
      env?: Record<string, string>
      testFile?: string
      testTag?: string
    }
  }): Promise<{
    success: boolean
    total?: number
    passed?: number
    failed?: number
    skipped?: number
    duration?: number
    failures?: { name: string; message: string; stack?: string }[]
  } | null> {
    const res = await request<{
      success: boolean
      total?: number
      passed?: number
      failed?: number
      skipped?: number
      duration?: number
      failures?: { name: string; message: string; stack?: string }[]
    }>('/api/test-framework/execute', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return res.success ? res.data! : null
  },

  // 检测框架
  async detect(testPath: string): Promise<{ framework: string | null; installed: boolean } | null> {
    const res = await request<{ framework: string | null; installed: boolean }>(
      `/api/test-framework/detect?testPath=${encodeURIComponent(testPath)}`
    )
    return res.success ? res.data! : null
  },
}

// 知识库 API
export const knowledgeApi = {
  // 获取知识库文档列表
  async getDocs(kbType?: string): Promise<KnowledgeDoc[]> {
    const endpoint = kbType ? `/api/kb?type=${kbType}` : '/api/kb'
    const res = await request<KnowledgeDoc[]>(endpoint)
    return res.success ? res.data! : []
  },

  // 上传文件到知识库
  async upload(file: File, kbType: string): Promise<any> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('kbType', kbType)
    const res = await request('/api/kb/upload', {
      method: 'POST',
      body: formData,
      raw: true
    })
    return res
  },

  // 抓取网络链接正文并入库（后端 POST /api/kb/fetch-url）
  // 需要登录才能访问的云文档（腾讯文档/飞书/语雀）抓不到正文，后端会返回 EMPTY_CONTENT 提示
  async fetchWebLink(url: string, name?: string, kbType?: string): Promise<any> {
    const res = await request('/api/kb/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url, name, kbType: kbType || 'general' })
    })
    return res
  },

  // 从本地路径（NAS/Git）导入文件到知识库
  async importFromPaths(paths: string[], kbType: string): Promise<{ imported: number; results: any[]; errors: any[] } | null> {
    const res = await request<{ imported: number; results: any[]; errors: any[] }>('/api/kb/import', {
      method: 'POST',
      body: JSON.stringify({ paths, kbType })
    })
    return res.success ? res.data! : null
  },

  // 向量化（解析）文档
  async vectorize(docPath: string): Promise<boolean> {
    const res = await request('/api/kb/process', {
      method: 'POST',
      body: JSON.stringify({ docId: docPath })
    })
    return res.success
  },

  // 批量向量化
  // docIds 存在时只解析选中文档；否则按 kbType 解析整个知识库
  async batchVectorize(kbType?: string, docIds?: string[]): Promise<any> {
    const body: any = { all: true, kbType }
    if (docIds && docIds.length > 0) {
      delete body.all
      body.docIds = docIds
    }
    const res = await request('/api/kb/process', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    return res
  },

  // 删除文档
  async deleteDoc(kbType: string, docPath: string): Promise<boolean> {
    const res = await request(`/api/kb/${kbType}/${encodeURIComponent(docPath)}`, {
      method: 'DELETE'
    })
    return res.success
  },

  // 批量删除文档
  async batchDelete(documents: Array<{ kbType: string; path: string }>): Promise<{ total: number; deleted: number; results: any[] } | null> {
    const res = await request<{ total: number; deleted: number; results: any[] }>('/api/kb/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ documents })
    })
    return res.success ? res.data! : null
  },

  // 获取向量状态
  async getVectorStatus(): Promise<any> {
    const res = await request('/api/kb/vector-status')
    return res.success ? res.data! : null
  },

  // 语义搜索
  async search(query: string, kbType?: string, mode: 'semantic' | 'keyword' = 'semantic'): Promise<KnowledgeDoc[]> {
    const res = await request<{ results: KnowledgeDoc[] }>('/api/kb/search', {
      method: 'POST',
      body: JSON.stringify({ query, kbType, mode })
    })
    return res.success && res.data ? res.data.results : []
  },

  // 获取交付件模板列表
  async getDeliverableTemplates(): Promise<{ total: number; templates: any[] }> {
    const res = await request<{ total: number; templates: any[] }>('/api/kb/deliverable-templates')
    return res.success ? res.data! : { total: 0, templates: [] }
  },

  // 触发“学习知识”：后端逐智能体、逐知识库、逐文档学习当前用户可见的知识
  async learn(): Promise<{ jobId: string; message: string } | null> {
    const res = await request<{ jobId: string; message: string }>('/api/kb/learn', {
      method: 'POST'
    })
    return res.success ? res.data! : null
  },

  // 下载交付件模板
  downloadTemplate(format: string, templateName: string) {
    const token = localStorage.getItem('token') || ''
    const url = `/api/kb/deliverable-templates/download?format=${encodeURIComponent(format)}&template=${encodeURIComponent(templateName)}`
    // 通过 fetch 下载并触发浏览器下载
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${templateName}.${format}`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(err => { console.error('下载失败', err) })
  }
}

// 文件系统 API（NAS/本地浏览）
export const fsApi = {
  async browse(browsePath?: string): Promise<any> {
    const endpoint = browsePath
      ? `/api/fs/browse?path=${encodeURIComponent(browsePath)}`
      : '/api/fs/browse'
    const res = await request(endpoint)
    return res.success ? res.data! : null
  },

  async readFile(filePath: string): Promise<any> {
    const res = await request(`/api/fs/read?path=${encodeURIComponent(filePath)}`)
    return res.success ? res.data! : null
  }
}

// Git API
export const gitApi = {
  async clone(url: string, branch?: string, targetPath?: string): Promise<any> {
    const res = await request('/api/git/clone', {
      method: 'POST',
      body: JSON.stringify({ url, branch, targetPath })
    })
    return res.success ? res.data! : null
  },

  async listFiles(repoPath: string, relPath?: string): Promise<any> {
    const params = new URLSearchParams({ repoPath })
    if (relPath) params.set('relPath', relPath)
    const res = await request(`/api/git/files?${params}`)
    return res.success ? res.data! : null
  }
}

// 工作流 API
export const workflowApi = {
  // 执行全自动工作流（含AI审核）
  async executeAutoWithReview(input: string): Promise<{ workflowId: string } | null> {
    const res = await request<{ workflowId: string }>('/api/workflow/auto-with-review', {
      method: 'POST',
      body: JSON.stringify({ input })
    })
    return res.success ? res.data! : null
  }
}

// 文件解析 API
export const parseApi = {
  // 解析图片（发送 base64 到后端，支持 OCR 扩展）
  async parseImage(file: File): Promise<{ description: string } | null> {
    try {
      const base64 = await fileToBase64(file)
      const res = await request<{ message: string; note?: string }>('/api/parse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64, mimeType: file.type })
      })
      return res.success
        ? { description: res.data?.message || res.data?.note || '图片已解析' }
        : null
    } catch {
      return null
    }
  },

  // 解析 Word 文档（发送 base64 到后端）
  async parseWord(file: File): Promise<{ content: string } | null> {
    try {
      const base64 = await fileToBase64(file)
      const res = await request<{ text: string }>('/api/parse/word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64 })
      })
      return res.success ? { content: res.data?.text || '' } : null
    } catch {
      return null
    }
  }
}

// File -> base64 辅助函数
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // 去掉 data:image/xxx;base64, 前缀
      resolve(result.split(',')[1] || result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 用户管理 API
export const userApi = {
  // 获取用户列表
  async list(): Promise<any[] | null> {
    const res = await request<any[]>('/api/users')
    return res.success ? res.data! : null
  },
  // 创建用户
  async create(data: { username: string; password: string; name: string; role: string }): Promise<{ ok?: boolean } & ApiResponse<any>> {
    const res = await request('/api/users', {
      method: 'POST',
      body: JSON.stringify(data)
    })
    return res
  },
  // 更新用户
  async update(id: string, data: Record<string, any>): Promise<ApiResponse<any>> {
    return await request(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  },
  // 删除用户
  async delete(id: string): Promise<ApiResponse<any>> {
    return await request(`/api/users/${id}`, {
      method: 'DELETE'
    })
  }
}

// 凭证管理 API（Git/NAS）
export interface GitCredential {
  type: 'https' | 'ssh'
  token?: string
  hasKey?: boolean
  privateKey?: string
  keyPath?: string
}
export interface NasCredential {
  type: 'smb'
  host: string
  share: string
  username?: string  // masked
  hasPassword?: boolean
  workgroup?: string
}

export const credentialsApi = {
  // 获取当前用户凭证（脱敏）
  async get(): Promise<{ git: GitCredential | null; nas: NasCredential | null } | null> {
    const res = await request<any>('/api/credentials')
    return res.success ? res.data! : null
  },

  // 保存 Git 凭证
  async saveGit(data: { type: 'https' | 'ssh'; token?: string; privateKey?: string; keyPath?: string }): Promise<any | null> {
    const res = await request('/api/credentials/git', {
      method: 'PUT',
      body: JSON.stringify(data)
    })
    return res.success ? res.data! : null
  },

  // 保存 NAS 凭证
  async saveNas(data: { type: 'smb'; host: string; share: string; username: string; password: string; workgroup?: string }): Promise<any | null> {
    const res = await request('/api/credentials/nas', {
      method: 'PUT',
      body: JSON.stringify(data)
    })
    return res.success ? res.data! : null
  },

  // 删除凭证
  async remove(type: 'git' | 'nas'): Promise<boolean> {
    const res = await request(`/api/credentials/${type}`, { method: 'DELETE' })
    return res.success
  },

  // 验证 Git 凭证
  async verifyGit(data: { type: 'https' | 'ssh'; token?: string; privateKey?: string; keyPath?: string }): Promise<{ success: boolean; message: string; detail?: string }> {
    const res = await request<any>('/api/credentials/git/verify', {
      method: 'POST',
      body: JSON.stringify(data)
    })
    return res.success ? res.data! : { success: false, message: res.error || '验证失败' }
  },

  // 验证 NAS 凭证
  async verifyNas(data: { type: 'smb'; host: string; share: string; username: string; password: string; workgroup?: string }): Promise<{ success: boolean; message: string }> {
    const res = await request<any>('/api/credentials/nas/verify', {
      method: 'POST',
      body: JSON.stringify(data)
    })
    return res.success ? res.data! : { success: false, message: res.error || '验证失败' }
  },

  // SMB浏览（使用已保存凭证）
  async smbBrowse(host: string, share: string, path: string = ''): Promise<any | null> {
    const res = await request<any>(`/api/smb/browse?host=${encodeURIComponent(host)}&share=${encodeURIComponent(share)}&path=${encodeURIComponent(path)}`)
    return res.success ? res.data! : null
  }
}

// 评估系统 API
export const evaluationApi = {
  // 启动评估（SSE流式返回进度）
  async run(body: {
    agentIds?: string[]
    daysBack?: number
    limitPerAgent?: number
  }): Promise<{ success: boolean } | null> {
    const res = await request<{ success: boolean }>('/api/evaluation/run', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    return res.success ? res.data! : null
  },

  // 获取评估报告列表
  async getReports(params?: { agentId?: string; limit?: number }): Promise<any[]> {
    const qs = params ? '?' + new URLSearchParams(params as Record<string,string>).toString() : ''
    const res = await request<any[]>(`/api/evaluation/reports${qs}`)
    return res.success ? res.data! : []
  },

  // 获取单个评估报告
  async getReport(reportId: string): Promise<any | null> {
    const res = await request<any>(`/api/evaluation/report/${reportId}`)
    return res.success ? res.data! : null
  },

  // 获取评估趋势
  async getTrend(params: { agentId: string; metric?: string }): Promise<any[]> {
    const qs = '?' + new URLSearchParams(params as Record<string,string>).toString()
    const res = await request<any[]>(`/api/evaluation/trend${qs}`)
    return res.success ? res.data! : []
  },

  // 获取评估统计数据
  async getStats(): Promise<any | null> {
    const res = await request<any>('/api/evaluation/stats')
    return res.success ? res.data! : null
  },

  // 获取定时评估配置（后端按 userId 隔离存储）
  async getSchedule(): Promise<any | null> {
    const res = await request<{ schedule: any }>('/api/evaluation/schedule')
    return res.success ? (res.data?.schedule ?? null) : null
  },

  // 新建/更新定时评估配置
  async saveSchedule(body: {
    enabled?: boolean
    freq: 'daily' | 'weekly'
    time: string
    weekday?: number | null
    mode?: 'rule' | 'both'
    daysBack?: number
    limitPerAgent?: number
    agentIds?: string[]
  }): Promise<any | null> {
    const res = await request('/api/evaluation/schedule', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    return res.success ? res.data : null
  },

  // 删除定时评估配置
  async deleteSchedule(): Promise<boolean> {
    const res = await request('/api/evaluation/schedule', { method: 'DELETE' })
    return res.success
  }
}

// ─── 用户级 API Key 管理（2026-11-20）─────────────────────────────────────────
// 所有登录用户都能管自己的 Key；后端按 token 里的用户隔离，前端不传 userId。
export interface UserApiKey {
  id: string
  name: string
  provider: string
  baseUrl: string
  model: string
  keyHint: string
  isDefault: boolean
  lastVerifiedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface ApiKeyListResult {
  keys: UserApiKey[]
  hasDefault: boolean
  platformKeyAvailable: boolean
  platformKeyHint: string
  /**
   * 管理员是否配置了可共享的 Key（2026-11-24）
   *
   * 回退顺序：用户自己的默认 Key → 管理员共享 Key → 平台 .env Key。
   * 用户没配 Key 时，系统会优先用管理员的，所以提示要准确说"在用谁的"。
   */
  adminSharedKeyAvailable: boolean
  // 后端下发的服务商清单：前端不硬编码，避免两边不一致导致发错地址
  providers: Array<{
    value: string
    group: string
    label: string
    model: string
    modelHint: string
    requiresModel: boolean
    models: string[]
  }>
}

// request() 返回 { success, data }，其中 data 是后端原始响应体
// （{ success, data, message, error }），所以业务字段在两层 data 之下。
function unwrapApiKeyBody(raw: any) {
  return raw && typeof raw === 'object' ? raw : {}
}

export const userApiKeyApi = {
  // 列出自己的 Key（含「平台 Key 是否可用」提示）
  async list(): Promise<ApiKeyListResult | null> {
    const res = await request<any>('/api/user/api-keys')
    if (!res.success) return null
    const body = unwrapApiKeyBody(res.data)
    const payload = body.data || {}
    return {
      keys: Array.isArray(payload.keys) ? payload.keys : [],
      hasDefault: !!payload.hasDefault,
      platformKeyAvailable: !!payload.platformKeyAvailable,
      platformKeyHint: payload.platformKeyHint || '',
      adminSharedKeyAvailable: !!payload.adminSharedKeyAvailable,
      providers: Array.isArray(payload.providers) ? payload.providers : [],
    }
  },

  // 新增；第一条会自动设为默认（后端行为）
  // 传名称 + 服务商 + Key：接口地址与模型由服务商自动决定（2026-11-20）
  async create(payload: {
    name: string
    apiKey: string
    provider?: string
    model?: string
  }): Promise<{ ok: boolean; message: string; id?: string; isDefault?: boolean }> {
    const res = await request<any>('/api/user/api-keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const body = unwrapApiKeyBody(res.data)
    return res.success
      ? { ok: true, message: body.message || '已保存', id: body.data?.id, isDefault: body.data?.isDefault }
      : { ok: false, message: res.error || '保存失败' }
  },

  // 修改；apiKey 留空表示「不换 Key，只改名称/服务商」
  async update(id: string, payload: {
    name: string
    apiKey?: string
    provider?: string
    model?: string
  }): Promise<{ ok: boolean; message: string }> {
    const res = await request<any>(`/api/user/api-keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    const body = unwrapApiKeyBody(res.data)
    return { ok: res.success, message: res.success ? (body.message || '已更新') : (res.error || '更新失败') }
  },

  async remove(id: string): Promise<{ ok: boolean; message: string; newDefaultId?: string | null }> {
    const res = await request<any>(`/api/user/api-keys/${id}`, { method: 'DELETE' })
    const body = unwrapApiKeyBody(res.data)
    return {
      ok: res.success,
      message: res.success ? (body.message || '已删除') : (res.error || '删除失败'),
      newDefaultId: body.data?.newDefaultId ?? null,
    }
  },

  // 指定默认（每个用户只能有一个，后端用事务保证）
  async setDefault(id: string): Promise<{ ok: boolean; message: string }> {
    const res = await request<any>(`/api/user/api-keys/${id}/default`, { method: 'POST', body: JSON.stringify({}) })
    const body = unwrapApiKeyBody(res.data)
    return { ok: res.success, message: res.success ? (body.message || '已设为默认') : (res.error || '设置失败') }
  },

  /**
   * 查某个服务商的可用模型清单（2026-11-20）
   *
   * 传 keyId 用已保存的 Key 拉该账号真实清单（source=account）；
   * 传 apiKey 用刚填的 Key 现拉；都不传返回内置清单（source=builtin）。
   */
  async listModels(params: { provider: string; keyId?: string; apiKey?: string }): Promise<{
    models: Array<{ id: string; name: string; contextWindow: number | null }>
    defaultModel: string
    source: 'account' | 'builtin'
    note: string
    currentModel: string
  } | null> {
    const q = new URLSearchParams({ provider: params.provider })
    if (params.keyId) q.set('keyId', params.keyId)
    if (params.apiKey) q.set('apiKey', params.apiKey)
    const res = await request<any>(`/api/user/api-keys/models?${q.toString()}`)
    if (!res.success) return null
    const body = unwrapApiKeyBody(res.data)
    const d = body.data || {}
    return {
      models: Array.isArray(d.models) ? d.models : [],
      defaultModel: d.defaultModel || '',
      source: d.source === 'account' ? 'account' : 'builtin',
      note: d.note || '',
      currentModel: d.currentModel || '',
    }
  },

  // 真实发一次最小请求验证 Key 是否可用（不是只校验格式）
  async verify(id: string): Promise<{ ok: boolean; message: string }> {
    const res = await request<any>(`/api/user/api-keys/${id}/verify`, { method: 'POST', body: JSON.stringify({}) })
    const body = unwrapApiKeyBody(res.data)
    // 验证失败时后端仍返回 HTTP 200 + success:false（业务失败，不是请求失败）
    const bizOk = body.success !== false
    return {
      ok: res.success && bizOk,
      message: bizOk ? (body.message || '验证通过') : (body.error || '验证失败'),
    }
  },
}

// ─── 管理员系统配置 API ────────────────────────────────────────────────────────
export const adminApi = {
  // 获取所有系统配置
  async getSystemConfig(): Promise<Record<string, { value: string; description: string }> | null> {
    const res = await request<Record<string, { value: string; description: string }>>('/api/admin/system-config')
    // 后端返回 { success, data: {...} }，需解开内层 data
    if (res.success && res.data && typeof res.data === 'object' && 'data' in (res.data as any)) {
      return (res.data as any).data || null
    }
    return res.success ? (res.data as any || null) : null
  },

  // 更新系统配置
  async updateSystemConfig(updates: Record<string, string>): Promise<boolean> {
    const res = await request('/api/admin/system-config', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
    return res.success
  },

  // 获取长时间运行任务列表
  async getLongRunningTasks(thresholdMinutes = 30): Promise<any[]> {
    const res = await request<any[]>(
      `/api/admin/tasks/long-running?threshold=${thresholdMinutes}`
    )
    if (res.success && res.data && typeof res.data === 'object' && 'data' in (res.data as any)) {
      return (res.data as any).data || []
    }
    return Array.isArray(res.data) ? res.data : []
  },

  // 管理员清理超时任务
  async cleanupTimeoutTasks(): Promise<{ success: boolean; cleanedCount: number; cleanedIds: string[]; message: string; error?: string }> {
    const res = await request<{ success: boolean; cleanedCount: number; cleanedIds: string[]; message: string }>(
      '/api/admin/tasks/cleanup',
      { method: 'POST', body: JSON.stringify({}) }
    )
    if (res.success && res.data) {
      return res.data as { success: boolean; cleanedCount: number; cleanedIds: string[]; message: string }
    }
    return { success: false, cleanedCount: 0, cleanedIds: [], message: res.error || '清理失败', error: res.error }
  },

  // 成本配置
  async getCostConfig(): Promise<{ hourlySalary: number; manualConfig: Record<string, number>; tokenPrices?: Record<string, { input: number; output: number }> } | null> {
    const res = await request<{ hourlySalary: number; manualConfig: Record<string, number>; tokenPrices?: Record<string, { input: number; output: number }> }>(
      '/api/stats/cost-config'
    )
    return res.success ? res.data as any : null
  },
  async updateCostConfig(payload: { hourlySalary?: number; manualConfig?: Record<string, number>; tokenPrices?: Record<string, { input: number; output: number }> }): Promise<boolean> {
    const res = await request<{ ok: boolean; changed: number }>('/api/stats/cost-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    return res.success
  },
}

// 安全测试 API
export const securityApi = {
  // 发起扫描（retestOf：复测时传入被复测报告 ID，形成复测闭环）
  async startScan(payload: { target: string; scanType?: string; files?: Array<{ name: string; content: string }>; retestOf?: number | null }): Promise<{ id: number; scanId: string; target: string } | null> {
    const res = await request<{ id: number; scanId: string; target: string }>('/api/security/scan', {
      method: 'POST', body: JSON.stringify(payload)
    })
    return res.success ? res.data as any : null
  },
  // 更新扫描结果
  async updateScan(id: number, patch: Record<string, unknown>): Promise<boolean> {
    const res = await request(`/api/security/scan/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
    return res.success
  },
  // 批量写入漏洞
  async addVulnerabilities(id: number, vulns: Record<string, unknown>[]): Promise<number> {
    const res = await request<{ count: number }>(`/api/security/scan/${id}/vulnerabilities`, {
      method: 'POST', body: JSON.stringify({ vulnerabilities: vulns })
    })
    return res.success ? (res.data as any).count : 0
  },
  // 报告列表
  async getReports(params?: { limit?: number; offset?: number; status?: string }): Promise<{ reports: Record<string, unknown>[]; total: number } | null> {
    const p = new URLSearchParams()
    if (params?.limit) p.set('limit', String(params.limit))
    if (params?.offset) p.set('offset', String(params.offset))
    if (params?.status) p.set('status', params.status)
    const res = await request<{ data: Record<string, unknown>[]; total: number }>(`/api/security/reports?${p}`)
    return res.success ? { reports: (res.data as any).data || (res.data as any) || [], total: (res.data as any).total || 0 } : null
  },

  // ── 开源真实扫描器 ──
  // 工具可用性与版本
  async getScanners(refresh = false): Promise<any[] | null> {
    const res = await request<{ data: any[] }>(`/api/security/scanners${refresh ? '?refresh=1' : ''}`)
    return res.success ? (res.data as any)?.data ?? [] : null
  },
  // 执行真实扫描（mode=source 跑 SAST/SCA；mode=url 跑 DAST）
  async runRealScan(payload: { mode: 'source' | 'url'; target: string; tools?: string[]; testDomain?: string }): Promise<any | null> {
    const res = await request<any>('/api/security/scan/real', { method: 'POST', body: JSON.stringify(payload) })
    return res.success ? (res.data as any) : null
  },
  // 发起安全测试工作流（5阶段自动串联，真实工具执行）
  async startWorkflow(
    target: string,
    scanType?: string,
    description?: string,
    stage?: number,
    testDomain?: string,
    sourcePath?: string,
    files?: { name: string; base64?: string; content?: string }[],
  ) {
    const url = stage !== undefined ? `/api/security/workflow?stage=${stage}` : '/api/security/workflow'
    const res = await request<{ workflowId: string; taskId: string } | { success: boolean; stage: string; output: unknown }>(url, {
      method: 'POST',
      body: JSON.stringify({
        target,
        scanType: scanType || 'full',
        description,
        testDomain: testDomain || 'all',
        sourcePath: sourcePath || '',
        files: files || [],
      }),
    })
    return res.success ? (res.data as any) : null
  },
  // 报告详情
  async getReport(id: number): Promise<Record<string, unknown> | null> {
    const res = await request<Record<string, unknown>>(`/api/security/reports/${id}`)
    return res.success ? (res.data ?? null) : null
  },
  // 删除报告
  async deleteReport(id: number): Promise<boolean> {
    const res = await request(`/api/security/reports/${id}`, { method: 'DELETE' })
    return res.success
  },
  // 漏洞列表
  async getVulnerabilities(params?: { reportId?: number; severity?: string; vulnType?: string; status?: string; limit?: number; offset?: number }): Promise<{ vulns: Record<string, unknown>[]; total: number } | null> {
    const p = new URLSearchParams()
    if (params?.reportId) p.set('reportId', String(params.reportId))
    if (params?.severity) p.set('severity', params.severity)
    if (params?.vulnType) p.set('vulnType', params.vulnType)
    if (params?.status) p.set('status', params.status)
    if (params?.limit) p.set('limit', String(params.limit))
    if (params?.offset) p.set('offset', String(params.offset))
    const res = await request<{ data: Record<string, unknown>[]; total: number }>(`/api/security/vulnerabilities?${p}`)
    return res.success ? { vulns: (res.data as any).data || (res.data as any) || [], total: (res.data as any).total || 0 } : null
  },
  // 更新漏洞状态
  async updateVulnStatus(id: number, status: string): Promise<boolean> {
    const res = await request(`/api/security/vulnerabilities/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })
    return res.success
  },
  // 统计数据
  async getStats(): Promise<{ totalReports: number; openVulns: number; avgScore: number; severityDist: Record<string, number> } | null> {
    const res = await request<{ data: { totalReports: number; openVulns: number; avgScore: number; severityDist: Record<string, number> } }>('/api/security/stats')
    // 后端返回 { success: true, data: { totalReports, ... } }，所以取 res.data.data
    return res.success ? (res.data as any)?.data : null
  },
  // 下载安全测试报告（Markdown，按通用知识库模板渲染）
  async downloadReportMd(id: number): Promise<void> {
    const token = localStorage.getItem('token') || '';
    const res = await fetch(`/api/security/reports/${id}/markdown`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`下载失败: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers.get('Content-Disposition') || `attachment; filename="security_report_${id}.md"`;
    const fn = cd.match(/filename="?([^"]+)"?/)?.[1] || `security_report_${id}.md`;
    a.download = fn;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  // 导出三格式交付物（md / docx / xlsx），后端基于安全报告数据生成真实 Word/Excel
  exportReport(id: number, format: 'md' | 'docx' | 'xlsx'): Promise<void> {
    const token = localStorage.getItem('token') || ''
    const url = `/api/security/reports/${id}/export?format=${format}`
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = `安全测试报告_${id}.${format}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(objectUrl)
      })
  },
}
// ══════════════════════════════════════════════════════════════════════
// 性能测试 API
// ══════════════════════════════════════════════════════════════════════
export const performanceTestApi = {
  async startScan(payload: { target: string; testType?: string; tool?: string; description?: string }): Promise<{ id: number; testId: string; target: string } | null> {
    const res = await request<{ id: number; testId: string; target: string }>('/api/performance-test/scan', { method: 'POST', body: JSON.stringify(payload) })
    return res.success ? res.data as any : null
  },
  async updateScan(id: number, patch: Record<string, unknown>): Promise<boolean> {
    const r = await request(`/api/performance-test/scan/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
    return r.success
  },
  async addFindings(id: number, findings: Record<string, unknown>[]): Promise<number> {
    const r = await request<{ count: number }>(`/api/performance-test/scan/${id}/findings`, { method: 'POST', body: JSON.stringify({ findings }) })
    return r.success ? (r.data as any).count : 0
  },
  async getReports(params?: { limit?: number; offset?: number; status?: string }): Promise<{ reports: Record<string, unknown>[]; total: number } | null> {
    const p = new URLSearchParams()
    if (params?.limit) p.set('limit', String(params.limit))
    if (params?.offset) p.set('offset', String(params.offset))
    if (params?.status) p.set('status', params.status)
    const res = await request<{ data: Record<string, unknown>[]; total: number }>(`/api/performance-test/reports?${p}`)
    if (!res.success) return null
    const d = res.data as any
    return { reports: d?.data || d || [], total: d?.total || 0 }
  },
  async startWorkflow(
    target: string,
    description?: string,
    stage?: number,
    files?: { name: string; base64?: string; content?: string }[],
  ) {
    const url = stage !== undefined ? `/api/performance-test/workflow?stage=${stage}` : '/api/performance-test/workflow'
    const res = await request<{ workflowId: string; testId: string } | { success: boolean; stage: string; output: unknown }>(url, {
      method: 'POST',
      body: JSON.stringify({ target, description, files: files || [] }),
    })
    // 完整工作流后端返回 { success, data: { workflowId, testId, target } }（嵌套 data），需解包；
    // 单阶段返回 { success, stage, phase, output, taskId }（无嵌套），原样返回
    const body: any = res.data
    return res.success ? (body?.data?.workflowId || body?.data?.testId ? body.data : body) : null
  },
  async getReport(id: number): Promise<Record<string, unknown> | null> {
    const res = await request<Record<string, unknown>>(`/api/performance-test/reports/${id}`)
    return res.success ? (res.data ?? null) : null
  },
  async deleteReport(id: number): Promise<boolean> {
    const res = await request(`/api/performance-test/reports/${id}`, { method: 'DELETE' })
    return res.success
  },
  async getFindings(params?: { report_id?: number; severity?: string; status?: string; limit?: number; offset?: number }): Promise<{ findings: Record<string, unknown>[]; total: number } | null> {
    const p = new URLSearchParams()
    if (params?.report_id) p.set('report_id', String(params.report_id))
    if (params?.severity) p.set('severity', params.severity)
    if (params?.status) p.set('status', params.status)
    if (params?.limit) p.set('limit', String(params.limit))
    if (params?.offset) p.set('offset', String(params.offset))
    const res = await request<{ data: Record<string, unknown>[] }>(`/api/performance-test/findings?${p}`)
    if (!res.success) return null
    const d = res.data as any
    return { findings: d?.data || d || [], total: (d?.data || d || []).length }
  },
  async updateFinding(id: number, patch: { status: string }): Promise<boolean> {
    const r = await request(`/api/performance-test/findings/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
    return r.success
  },
  async getStats(): Promise<{ totalReports: number; openFindings: number; avgScore: number | null; severityDist: Record<string, number> } | null> {
    const res = await request<{ data: { totalReports: number; openFindings: number; avgScore: number | null; severityDist: Record<string, number> } }>('/api/performance-test/stats')
    return res.success ? (res.data as any).data : null
  },
  async downloadReportMd(id: number): Promise<void> {
    const token = localStorage.getItem('token') || ''
    const res = await fetch(`/api/performance-test/reports/${id}/markdown`, { headers: { 'Authorization': `Bearer ${token}` } })
    if (!res.ok) throw new Error(`下载失败: ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `perf-report-${id}.md`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },
}

// Web 兼容性测试 API
export const compatApi = {
  async runTest(payload: { url: string; matrix?: Record<string, unknown>; timeout?: number }): Promise<{ reportId: string } | null> {
    const res = await request<{ success: boolean; reportId: string; message?: string }>('/api/compatibility/web', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (!res.success) return null
    const d = (res.data as any)
    return { reportId: d?.reportId || '' }
  },
  async getReports(params?: { limit?: number; offset?: number }): Promise<{ data: Record<string, unknown>[]; total: number } | null> {
    const p = new URLSearchParams()
    if (params?.limit) p.set('limit', String(params.limit))
    if (params?.offset) p.set('offset', String(params.offset))
    const res = await request<{ data: Record<string, unknown>[]; total: number }>(`/api/compatibility/web/reports?${p}`)
    if (!res.success) return null
    const d = res.data as any
    return { data: d?.data || [], total: d?.total || 0 }
  },
  async getReport(id: string): Promise<Record<string, unknown> | null> {
    const res = await request<Record<string, unknown>>(`/api/compatibility/web/reports/${id}`)
    return res.success ? (res.data ?? null) : null
  },
  async getStats(): Promise<{ totalReports: number; avgScore: number; recentScores: Record<string, unknown>[] } | null> {
    const res = await request<{ totalReports: number; avgScore: number; recentScores: Record<string, unknown>[] }>('/api/compatibility/web/stats')
    return res.success ? (res.data as any) : null
  },
  // 导出三格式交付物（md / docx / xlsx），后端基于报告数据生成真实 Word/Excel
  exportReport(id: string, format: 'md' | 'docx' | 'xlsx'): Promise<void> {
    const token = localStorage.getItem('token') || ''
    const url = `/api/compatibility/web/reports/${encodeURIComponent(id)}/export?format=${format}`
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = `兼容性测试报告_${id}.${format}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(objectUrl)
      })
  },
}


// 工具管理 API（自动化测试 + 安全测试）
export const toolsApi = {
  // 获取工具列表
  async list(category?: 'automation' | 'security'): Promise<any[]> {
    const url = category ? `/api/tools/list?category=${category}` : '/api/tools/list'
    const res = await request<{ data: any[] }>(url)
    return res.success ? (res.data as any).data : []
  },
  
  // 获取单个工具
  async get(toolId: string): Promise<any | null> {
    const res = await request<{ data: any }>(`/api/tools/${toolId}`)
    return res.success ? (res.data as any).data : null
  },
  
  // 生成安装脚本（platform 可选，后端自动检测）
  async generateInstallScript(tools: string[], platform?: 'mac' | 'linux' | 'windows'): Promise<{ filename: string; content: string; commands: string[]; failedTools: string[]; platform: string } | null> {
    const body: any = { tools }
    if (platform) body.platform = platform
    const res = await request<{ data: { filename: string; content: string; commands: string[]; failedTools: string[]; platform: string } }>('/api/tools/install-script', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return res.success ? (res.data as any).data : null
  },

  // 后端直接安装（异步）+ SSE 进度（前端用 EventSource 监听）
  async install(tool: string, action: 'install' | 'upgrade' = 'install'): Promise<{ taskId: string } | null> {
    const res = await request<{ data: { taskId: string } }>('/api/tools/install', {
      method: 'POST',
      body: JSON.stringify({ tool, action }),
    })
    return res.success ? (res.data as any).data : null
  },

  // 批量检测工具安装状态（本地检测）
  async checkStatus(tools: string[]): Promise<Record<string, { installed: boolean; version: string | null; needUpdate: boolean }> | null> {
    const res = await request<{ data: Record<string, { installed: boolean; version: string | null; needUpdate: boolean }> }>('/api/tools/check-status', {
      method: 'POST',
      body: JSON.stringify({ tools }),
    })
    return res.success ? (res.data as any).data : null
  },
}

// OWASP 知识库 API
export const kbApi = {
  // 获取 OWASP 知识库状态
  async getOwaspStatus(): Promise<{ lastUpdated?: string; chunks?: number; vectorized?: boolean } | null> {
    const res = await request<{ data: { lastUpdated?: string; chunks?: number; vectorized?: boolean } }>('/api/owasp/status')
    return res.success ? (res.data as any).data : null
  },

  // 更新 OWASP 知识库
  async updateOwasp(): Promise<boolean> {
    const res = await request('/api/owasp/update', { method: 'POST' })
    return res.success
  },
}

// WebSocket 连接
export function createWebSocket(onMessage: (event: MessageEvent) => void): WebSocket {
  const ws = new WebSocket(`ws://${API_BASE.replace(/^https?:\/\//, '')}`)
  ws.onmessage = onMessage
  return ws
}

// 交付物质量 API（2026-11-06 阶段四）
// ─── 自我进化：经验库 + 阈值自动校准（2026-11-20）────────────────────────
export interface AgentExperience {
  id: string
  agentId: string
  category: string
  title: string
  guidance: string
  source: string
  status: 'active' | 'watch' | 'dormant' | 'suppressed' | string
  level: number
  occurrencesTotal: number
  occurrencesBefore: number
  occurrencesAfter: number
  tasksBefore: number
  tasksAfter: number
  effectiveness: number | null
  suppressedReason: string | null
  samples: string[]
  firstSeenAt: string | null
  lastSeenAt: string | null
  injectedSince: string | null
}

export interface ExperienceStats {
  totals: { all: number; active: number; watch: number; dormant: number; suppressed: number; improved: number; occurrences: number }
  byAgent: Record<string, { all: number; active: number; watch: number; dormant: number; suppressed: number }>
}

function unwrapQualityBody(raw: any) {
  return raw && typeof raw === 'object' ? raw : {}
}

export const experienceApi = {
  /** 经验列表 + 汇总统计 */
  async list(params: { agentId?: string; status?: string; limit?: number } = {}): Promise<{
    experiences: AgentExperience[]
    stats: ExperienceStats
  }> {
    const q = new URLSearchParams()
    if (params.agentId) q.set('agentId', params.agentId)
    if (params.status) q.set('status', params.status)
    if (params.limit) q.set('limit', String(params.limit))
    const res = await request<any>(`/api/quality/experiences?${q.toString()}`)
    const body = unwrapQualityBody(res.data)
    const d = body.data || {}
    return {
      experiences: Array.isArray(d.experiences) ? d.experiences : [],
      stats: d.stats || { totals: { all: 0, active: 0, watch: 0, dormant: 0, suppressed: 0, improved: 0, occurrences: 0 }, byAgent: {} },
    }
  },

  /** 进化动作日志 */
  async evolutionLog(params: { agentId?: string; limit?: number } = {}): Promise<any[]> {
    const q = new URLSearchParams()
    if (params.agentId) q.set('agentId', params.agentId)
    if (params.limit) q.set('limit', String(params.limit))
    const res = await request<any>(`/api/quality/experiences/evolution-log?${q.toString()}`)
    const body = unwrapQualityBody(res.data)
    return Array.isArray(body.data) ? body.data : []
  },

  /** 废除 / 恢复一条经验（人工否决权，防止错误经验反复注入） */
  async setStatus(id: string, status: 'suppressed' | 'active' | 'watch' | 'dormant', reason = ''): Promise<{ ok: boolean; message: string }> {
    const res = await request<any>(`/api/quality/experiences/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    })
    const body = unwrapQualityBody(res.data)
    return { ok: res.success, message: res.success ? (body.message || '已更新') : (res.error || '更新失败') }
  },

  /** 立刻跑一次进化（升级/休眠/降级） */
  async evolve(agentId?: string): Promise<{ agents: number; changes: any[] }> {
    const res = await request<any>('/api/quality/experiences/evolve', {
      method: 'POST',
      body: JSON.stringify(agentId ? { agentId } : {}),
    })
    const body = unwrapQualityBody(res.data)
    return body.data || { agents: 0, changes: [] }
  },

  /** 阈值自动校准：GET 看建议，POST 采纳 */
  async calibrationPreview(days = 90): Promise<any> {
    const res = await request<any>(`/api/quality/threshold-auto-calibration?days=${days}`)
    const body = unwrapQualityBody(res.data)
    return body.data || null
  },

  /** 某条经验的同期对照结果（RCT） */
  async trialEffect(id: string): Promise<{
    ready: boolean
    treatment: { n: number; hit: number }
    control: { n: number; hit: number }
    treatmentRate?: number
    controlRate?: number
    effect?: number
    message: string
  } | null> {
    const res = await request<any>(`/api/quality/experiences/${id}/trial`)
    if (!res.success) return null
    const body = unwrapQualityBody(res.data)
    return body.data || null
  },

  async calibrationApply(days = 90): Promise<{ applied: boolean; message: string; data: any }> {
    const res = await request<any>('/api/quality/threshold-auto-calibration', {
      method: 'POST',
      body: JSON.stringify({ days }),
    })
    const body = unwrapQualityBody(res.data)
    return {
      applied: !!body.applied,
      message: body.message || (res.success ? '' : (res.error || '采纳失败')),
      data: body.data || null,
    }
  },
}

export const qualityApi = {
  /** 质量趋势（门禁可用率 vs 人工可用率） */
  async trend(days = 30): Promise<ApiResponse<any>> {
    return request(`/api/quality/trend?days=${days}`)
  },
  /** 拒绝原因排行 + 反例库文本 */
  async rejectReasons(days = 30): Promise<ApiResponse<any>> {
    return request(`/api/quality/reject-reasons?days=${days}`)
  },
  /** 提交用例级反馈 */
  async submitCaseFeedback(taskId: string, items: Array<{ caseId: string; usable: boolean; rejectReason?: string | null; comment?: string | null }>) {
    return request(`/api/tasks/${taskId}/case-feedback`, { method: 'POST', body: JSON.stringify({ items }) })
  },
  /**
   * 门禁阈值人工校准（2026-11-09）
   * 用人工逐条判定的真实可用率反算「门禁该卡在哪」，回答 0.85 从哪来的问题。
   */
  async thresholdCalibration(days = 180, target?: number): Promise<ApiResponse<any>> {
    const qs = new URLSearchParams({ days: String(days) })
    if (target != null) qs.set('target', String(target))
    return request(`/api/quality/threshold-calibration?${qs.toString()}`)
  },
  /** 采纳校准结果（管理员） */
  async adoptThreshold(rate: number): Promise<ApiResponse<any>> {
    return request('/api/quality/threshold', { method: 'POST', body: JSON.stringify({ rate }) })
  },
}
