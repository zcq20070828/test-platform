// 性能监控 Store

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getPerformanceMetrics } from '@/api/performance'
import { request } from '@/api/index'
import { ElMessage } from 'element-plus'

export interface MetricRecord {
  id: string
  timestamp: number
  cpu: number
  memory: number
  network: {
    inbound: number
    outbound: number
  }
  agents: {
    id: string
    name: string
    status: 'idle' | 'running' | 'error'
    tasks: number
    avgResponseTime: number
  }[]
}

export interface AlertRecord {
  id: string
  type: 'warning' | 'error' | 'info'
  message: string
  timestamp: number
  resolved: boolean
}

export const usePerformanceStore = defineStore('performance', () => {
  // 状态
  const metrics = ref<MetricRecord[]>([])
  const alerts = ref<AlertRecord[]>([])
  const maxRecords = 60 // 保留最近60条记录（5分钟，每5秒采集一次）
  const isMonitoring = ref(false)
  let monitoringInterval: ReturnType<typeof setInterval> | null = null

  // 计算属性
  const latestMetric = computed(() => metrics.value[metrics.value.length - 1] || null)

  const avgCpu = computed(() => {
    if (metrics.value.length === 0) return 0
    return Math.round(metrics.value.reduce((sum, m) => sum + m.cpu, 0) / metrics.value.length)
  })

  const avgMemory = computed(() => {
    if (metrics.value.length === 0) return 0
    return Math.round(metrics.value.reduce((sum, m) => sum + m.memory, 0) / metrics.value.length)
  })

  const totalNetworkIn = computed(() => {
    return metrics.value.reduce((sum, m) => sum + m.network.inbound, 0)
  })

  const totalNetworkOut = computed(() => {
    return metrics.value.reduce((sum, m) => sum + m.network.outbound, 0)
  })

  const activeAgents = computed(() => {
    const latest = latestMetric.value
    if (!latest) return 0
    return latest.agents.filter(a => a.status === 'running').length
  })

  const unhealthyAlerts = computed(() =>
    alerts.value.filter(a => !a.resolved && a.type === 'error')
  )

  const warningAlerts = computed(() =>
    alerts.value.filter(a => !a.resolved && a.type === 'warning')
  )

  // 方法
  function addMetric(metric: MetricRecord) {
    metrics.value.push(metric)
    // 保持最大记录数
    if (metrics.value.length > maxRecords) {
      metrics.value.shift()
    }

    // 检查是否需要生成告警
    checkAlerts(metric)
  }

  function addAlert(alert: AlertRecord) {
    alerts.value.unshift(alert)
    // 保持最近100条告警
    if (alerts.value.length > 100) {
      alerts.value.pop()
    }
  }

  /**
   * 真正的告警处理
   * - CPU/内存告警: 提示用户检查系统资源
   * - 智能体错误告警: 尝试重置智能体熔断器
   */
  async function resolveAlert(alertId: string) {
    const alert = alerts.value.find(a => a.id === alertId)
    if (!alert) return

    const message = alert.message

    // 根据告警类型执行不同的处理
    if (message.includes('CPU')) {
      // CPU 告警: 仅提示（不自动执行命令，避免影响正在运行的测试）
      ElMessage.warning({
        message: `CPU 告警已标记: ${message}\n建议手动检查高占用进程，或重启后端服务释放资源。`,
        duration: 5000,
      })
    } else if (message.includes('内存')) {
      // 内存告警: 方案A — 调用后端主动 GC 接口（需后端带 --expose-gc 启动）
      try {
        const res = await request('/api/performance/gc', {
          method: 'POST',
          body: JSON.stringify({}),
        })
        if (res.success) {
          const freed = (res as any).freed || {}
          const lines = []
          if (freed.heapUsed) lines.push(`堆内存释放: ${freed.heapUsed}`)
          if (freed.rss) lines.push(`RSS 释放: ${freed.rss}`)
          ElMessage.success({
            message: `内存告警已处理: ${lines.join(' | ') || 'GC 执行完成'}
后续请观察内存是否回落。`,
            duration: 6000,
          })
        } else if (res.error?.includes('GC 不可用')) {
          ElMessage.warning({
            message: `内存告警已标记: ${message}\n${(res as any).hint || res.error}\n建议手动重启后端服务释放资源。`,
            duration: 6000,
          })
        } else {
          ElMessage.error('主动 GC 失败: ' + (res.error || '未知错误'))
        }
      } catch (err) {
        console.error('[Performance] 主动 GC 失败:', err)
        ElMessage.error('主动 GC 失败: ' + (err as Error).message)
      }
    } else if (message.includes('智能体')) {
      // 智能体错误: 尝试重置熔断器
      try {
        const res = await request('/api/circuit-breaker/reset', {
          method: 'POST',
          body: JSON.stringify({}), // 重置全部
        })
        if (res.success) {
          ElMessage.success('智能体熔断器已重置，请观察是否恢复正常')
        } else {
          ElMessage.error('重置熔断器失败')
        }
      } catch (err) {
        console.error('[Performance] 重置熔断器失败:', err)
        ElMessage.error('重置熔断器失败: ' + (err as Error).message)
      }
    }

    // 标记为已处理
    alert.resolved = true
  }

  function checkAlerts(metric: MetricRecord) {
    // CPU 告警
    if (metric.cpu > 80) {
      addAlert({
        id: `cpu-${Date.now()}`,
        type: metric.cpu > 90 ? 'error' : 'warning',
        message: `CPU 使用率过高: ${metric.cpu}%`,
        timestamp: Date.now(),
        resolved: false
      })
    }

    // 内存告警
    if (metric.memory > 80) {
      addAlert({
        id: `mem-${Date.now()}`,
        type: metric.memory > 90 ? 'error' : 'warning',
        message: `内存使用率过高: ${metric.memory}%`,
        timestamp: Date.now(),
        resolved: false
      })
    }

    // 智能体错误告警
    const errorAgents = metric.agents.filter(a => a.status === 'error')
    if (errorAgents.length > 0) {
      addAlert({
        id: `agent-${Date.now()}`,
        type: 'error',
        message: `${errorAgents.length} 个智能体处于错误状态`,
        timestamp: Date.now(),
        resolved: false
      })
    }
  }

  // 从后端API采集真实性能指标
  async function collectMetrics() {
    try {
      const data = await getPerformanceMetrics()
      if (!data) {
        throw new Error('无法获取性能指标');
      }
      
      // 转换为 MetricRecord 格式
      const metric: MetricRecord = {
        id: `metric-${Date.now()}`,
        timestamp: data.timestamp || Date.now(),
        cpu: data.cpu?.usage || 0,
        memory: data.memory?.percent || 0,
        network: {
          inbound: data.network?.inbound || 0,
          outbound: data.network?.outbound || 0
        },
        agents: data.agents || []
      };
      
      addMetric(metric);
    } catch (error) {
      console.error('[Performance] 采集指标失败:', error);
      // 可选：使用浏览器API作为回退方案（仅Chrome）
      if (performance && (performance as any).memory) {
        const mem = (performance as any).memory;
        const metric: MetricRecord = {
          id: `metric-${Date.now()}`,
          timestamp: Date.now(),
          cpu: 0, // 浏览器无法获取CPU
          memory: Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100),
          network: { inbound: 0, outbound: 0 },
          agents: []
        };
        addMetric(metric);
      }
    }
  }

  function startMonitoring() {
    if (isMonitoring.value) return

    isMonitoring.value = true
    // 立即采集一次
    collectMetrics()

    // 每5秒采集一次
    monitoringInterval = setInterval(() => {
      collectMetrics()
    }, 5000)
  }

  function stopMonitoring() {
    isMonitoring.value = false
    if (monitoringInterval) {
      clearInterval(monitoringInterval)
      monitoringInterval = null
    }
  }

  function clearMetrics() {
    metrics.value = []
  }

  function clearAlerts() {
    alerts.value = []
  }

  // 🔒 重置 performance store 状态（用户隔离用）
  function reset() {
    metrics.value = []
    alerts.value = []
    isMonitoring.value = false
  }

  return {
    // 状态
    metrics,
    alerts,
    isMonitoring,

    // 计算属性
    latestMetric,
    avgCpu,
    avgMemory,
    totalNetworkIn,
    totalNetworkOut,
    activeAgents,
    unhealthyAlerts,
    warningAlerts,

    // 方法
    addMetric,
    addAlert,
    resolveAlert,
    startMonitoring,
    stopMonitoring,
    clearMetrics,
    clearAlerts,
    reset
  }
})
