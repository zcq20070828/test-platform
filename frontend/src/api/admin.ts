// 管理员 API
import { request } from './index'

// 系统配置项类型
export interface SystemConfig {
  [key: string]: {
    value: string
    description: string
  }
}

// 获取系统配置
export async function getSystemConfig(): Promise<{ success: boolean; data?: SystemConfig; error?: string }> {
  return request<SystemConfig>('/api/admin/system-config')
}

// 更新系统配置
export async function updateSystemConfig(updates: Record<string, string>): Promise<{ success: boolean; message?: string; error?: string }> {
  return request<{ message: string }>('/api/admin/system-config', {
    method: 'PATCH',
    body: JSON.stringify(updates)
  })
}

// 超时任务类型
export interface LongRunningTask {
  id: string
  type: string
  status: string
  agent_id: string
  user_id: string
  input: string
  created_at: string
  updated_at: string
  minutes_running: number
}

// 获取超时任务列表
export async function getLongRunningTasks(thresholdMinutes: number): Promise<LongRunningTask[]> {
  const res = await request<{ data: LongRunningTask[]; thresholdMinutes: number }>(
    `/api/admin/tasks/long-running?threshold=${thresholdMinutes}`
  )
  if (res.success && res.data) {
    return res.data.data || []
  }
  return []
}

// 清理超时任务
export async function cleanupTasks(thresholdMinutes?: number): Promise<{
  success: boolean
  message?: string
  cleanedCount?: number
  cleanedIds?: string[]
  thresholdMinutes?: number
  error?: string
}> {
  const body: Record<string, any> = {}
  if (thresholdMinutes !== undefined) {
    body.thresholdMinutes = thresholdMinutes
  }
  return request<{
    message: string
    cleanedCount: number
    cleanedIds: string[]
    thresholdMinutes: number
  }>('/api/admin/tasks/cleanup', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}
