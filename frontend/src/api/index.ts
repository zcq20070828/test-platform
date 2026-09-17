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

// 通用请求方法
export async function request<T>(
  endpoint: string,
  options?: RequestInit & { raw?: boolean }
): Promise<ApiResponse<T>> {
  try {
    const isRaw = options?.raw && options?.body instanceof FormData
    const headers = isRaw
      ? { ...getAuthHeaders(), ...options?.headers }
      : { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options?.headers }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    })

    // 401 未授权 → 尝试用 refreshToken 静默续期，失败才触发会话过期（登录/刷新接口除外）
    if (response.status === 401) {
      // 登录/刷新接口失败不应该触发 session:expired
      if (endpoint !== '/api/auth/login' && endpoint !== '/api/auth/register' && endpoint !== '/api/auth/refresh') {
        // 静默续期：local 与 keycloak 共用 /api/auth/refresh，刷新成功则重试原请求
        const refreshToken = localStorage.getItem('refreshToken')
        if (refreshToken) {
          let refreshed = false
          try {
            const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken })
            })
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json()
              localStorage.setItem('token', refreshData.token)
              // 同步更新 localStorage.user，避免 user.value.token 仍是旧值导致刷新页面后登出
              const storedUser = localStorage.getItem('user')
              if (storedUser) {
                try {
                  const parsedUser = JSON.parse(storedUser)
                  parsedUser.token = refreshData.token
                  localStorage.setItem('user', JSON.stringify(parsedUser))
                } catch { /* ignore */ }
              }
              // 用新 token 重试原始请求
              const retryHeaders = isRaw
                ? { 'Authorization': `Bearer ${refreshData.token}`, ...options?.headers }
                : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${refreshData.token}`, ...options?.headers }
              const retryResponse = await fetch(`${API_BASE}${endpoint}`, {
                ...options,
                headers: retryHeaders
              })
              if (retryResponse.ok) {
                const retryData = await retryResponse.json()
                return { success: true, data: retryData }
              }
              refreshed = true
            }
          } catch {
            // 刷新失败，继续走正常的 401 处理
          }
          if (!refreshed) {
            // refreshToken 无效或已过期，清理后触发登出
            localStorage.removeItem('refreshToken')
          }
        }
        window.dispatchEvent(new CustomEvent('session:expired'))
      }
      const data = await response.json().catch(() => ({}))
      return { success: false, error: data.error || `HTTP ${response.status}` }
    }

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const data = await response.json()
    // 自动记录关键用户行为（防抖，失败静默忽略）
    try { autoLogAction((options?.method || 'GET').toUpperCase(), endpoint) } catch { /* ignore */ }
    return { success: true, data }
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
    console.log('[authApi.login] 调用登录 API')
    console.log('[authApi.login] username:', username)
    console.log('[authApi.login] password:', password)
    console.log('[authApi.login] 请求体:', JSON.stringify({ username, password }))

    const res = await request<{ token: string; refreshToken: string; user: any }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    })

    console.log('[authApi.login] 响应:', res)
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
    files?: { kbType?: string; filename?: string; name?: string; content?: string }[],
    options?: { source?: 'step' | 'workflow'; type?: string }
  ): Promise<{ task?: Task } & ApiResponse<any>> {
    const body = { agent: agentId, input, files: files || [], source: options?.source || 'step', type: options?.type }
    console.log('[taskApi.create] Request body:', JSON.stringify(body))
    const res = await request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    console.log('[taskApi.create] Response:', res)
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
  async sendChat(taskId: string, message: string, attachments?: { name: string; content: string }[]): Promise<any> {
    const res = await request(`/api/tasks/${taskId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, attachments: attachments || [] }),
    })
    return res
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
  }
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
  // 发起扫描
  async startScan(payload: { target: string; scanType?: string; files?: Array<{ name: string; content: string }> }): Promise<{ id: number; scanId: string; target: string } | null> {
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

  // 发起安全测试工作流（5阶段自动串联）
  async startWorkflow(target: string, scanType?: string, description?: string, stage?: number) {
    const url = stage !== undefined ? `/api/security/workflow?stage=${stage}` : '/api/security/workflow'
    const res = await request<{ workflowId: string; taskId: string } | { success: boolean; stage: string; output: unknown }>(url, {
      method: 'POST',
      body: JSON.stringify({ target, scanType: scanType || 'full', description }),
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
  async startWorkflow(target: string, description?: string, stage?: number) {
    const url = stage !== undefined ? `/api/performance-test/workflow?stage=${stage}` : '/api/performance-test/workflow'
    const res = await request<{ workflowId: string; testId: string } | { success: boolean; stage: string; output: unknown }>(url, { method: 'POST', body: JSON.stringify({ target, description }) })
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
  async getStats(): Promise<Record<string, unknown> | null> {
    const res = await request<{ data: Record<string, unknown> }>('/api/performance-test/stats')
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
