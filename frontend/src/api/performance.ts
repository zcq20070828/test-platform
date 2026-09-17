// 性能监控 API
const API_BASE = ''

interface PerformanceData {
  timestamp?: number
  cpu?: { usage: number }
  memory?: { percent: number }
  network?: { inbound: number; outbound: number }
  agents?: any[]
}

// 通用请求方法（复用 index.ts 的模式）
async function request<T>(
  endpoint: string,
  options?: RequestInit & { raw?: boolean }
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const isRaw = options?.raw && options?.body instanceof FormData
    const headers = isRaw
      ? { ...options?.headers }
      : { 'Content-Type': 'application/json', ...options?.headers }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// 获取系统性能指标
export async function getPerformanceMetrics(): Promise<PerformanceData | null> {
  const res = await request<PerformanceData>('/api/performance/metrics', {
    headers: getAuthHeaders()
  })
  return res.success ? res.data ?? null : null
}

// 获取智能体性能数据
export async function getAgentPerformance(timeRange?: string) {
  const params = timeRange ? `?timeRange=${timeRange}` : ''
  const res = await request(`/api/performance/agents${params}`, {
    headers: getAuthHeaders()
  })
  return res.success ? res.data : null
}

// 获取任务统计
export async function getTaskStatistics(timeRange?: string) {
  const params = timeRange ? `?timeRange=${timeRange}` : ''
  const res = await request(`/api/performance/tasks${params}`, {
    headers: getAuthHeaders()
  })
  return res.success ? res.data : null
}

// 获取系统日志
export async function getSystemLogs(level?: string, limit: number = 100) {
  const params = new URLSearchParams()
  if (level) params.append('level', level)
  params.append('limit', limit.toString())
  const res = await request(`/api/performance/logs?${params}`, {
    headers: getAuthHeaders()
  })
  return res.success ? res.data : null
}

// 获取认证头
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}
