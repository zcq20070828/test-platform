<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePerformanceStore } from '@/stores/performance'
import {
  Microphone,
  Monitor,
  Cpu,
  Connection,
  Warning,
  CircleCheck,
  CircleClose,
  Timer
} from '@element-plus/icons-vue'

const store = usePerformanceStore()

// 图表数据
const chartData = computed(() => ({
  cpu: store.metrics.slice(-20).map(m => m.cpu),
  memory: store.metrics.slice(-20).map(m => m.memory),
  timestamps: store.metrics.slice(-20).map(m => new Date(m.timestamp).toLocaleTimeString())
}))

// 当前选中查看的智能体
const selectedAgentId = ref<string | null>(null)

const selectedAgent = computed(() => {
  if (!selectedAgentId.value || !store.latestMetric) return null
  return store.latestMetric.agents.find(a => a.id === selectedAgentId.value)
})

// 开始/停止监控
function toggleMonitoring() {
  if (store.isMonitoring) {
    store.stopMonitoring()
  } else {
    store.startMonitoring()
  }
}

// 格式化字节
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// 获取状态颜色
function getStatusColor(status: string): string {
  switch (status) {
    case 'running': return '#67c23a'
    case 'idle': return '#909399'
    case 'error': return '#f56c6c'
    default: return '#909399'
  }
}

// 获取告警类型图标
function getAlertIcon(type: string) {
  switch (type) {
    case 'error': return CircleClose
    case 'warning': return Warning
    default: return CircleCheck
  }
}

// 生命周期
onMounted(() => {
  // 自动开始监控
  store.startMonitoring()
})

onUnmounted(() => {
  store.stopMonitoring()
})
</script>

<template>
  <div class="performance-panel">
    <!-- 顶部控制栏 -->
    <div class="control-bar">
      <div class="title">
        <el-icon><Monitor /></el-icon>
        <span>性能监控</span>
      </div>
      <div class="actions">
        <el-tag :type="store.isMonitoring ? 'success' : 'info'" size="small">
          {{ store.isMonitoring ? '监控中' : '已停止' }}
        </el-tag>
        <el-button
          :type="store.isMonitoring ? 'danger' : 'primary'"
          size="small"
          @click="toggleMonitoring"
        >
          {{ store.isMonitoring ? '停止监控' : '开始监控' }}
        </el-button>
      </div>
    </div>

    <!-- 核心指标卡片 -->
    <div class="metrics-grid">
      <el-card class="metric-card">
        <div class="metric-icon cpu">
          <el-icon><Cpu /></el-icon>
        </div>
        <div class="metric-info">
          <div class="metric-label">CPU 使用率</div>
          <div class="metric-value">{{ store.avgCpu }}%</div>
          <el-progress
            :percentage="store.avgCpu"
            :stroke-width="6"
            :color="store.avgCpu > 80 ? '#f56c6c' : store.avgCpu > 60 ? '#e6a23c' : '#67c23a'"
          />
        </div>
      </el-card>

      <el-card class="metric-card">
        <div class="metric-icon memory">
          <el-icon><Monitor /></el-icon>
        </div>
        <div class="metric-info">
          <div class="metric-label">内存使用率</div>
          <div class="metric-value">{{ store.avgMemory }}%</div>
          <el-progress
            :percentage="store.avgMemory"
            :stroke-width="6"
            :color="store.avgMemory > 80 ? '#f56c6c' : store.avgMemory > 60 ? '#e6a23c' : '#67c23a'"
          />
        </div>
      </el-card>

      <el-card class="metric-card">
        <div class="metric-icon network">
          <el-icon><Connection /></el-icon>
        </div>
        <div class="metric-info">
          <div class="metric-label">网络流量</div>
          <div class="metric-value">
            ↑ {{ formatBytes(store.totalNetworkOut) }} / ↓ {{ formatBytes(store.totalNetworkIn) }}
          </div>
        </div>
      </el-card>

      <el-card class="metric-card">
        <div class="metric-icon agents">
          <el-icon><Microphone /></el-icon>
        </div>
        <div class="metric-info">
          <div class="metric-label">活跃智能体</div>
          <div class="metric-value">{{ store.activeAgents }} 个</div>
        </div>
      </el-card>
    </div>

    <!-- 图表区域 -->
    <div class="charts-section">
      <el-card>
        <template #header>
          <span>资源使用趋势</span>
        </template>
        <div class="chart-container">
          <!-- 简化版折线图（使用CSS绘制） -->
          <div class="simple-chart">
            <div class="chart-legend">
              <span class="legend-item"><span class="dot cpu"></span> CPU</span>
              <span class="legend-item"><span class="dot memory"></span> 内存</span>
            </div>
            <div class="chart-lines">
              <div class="line-wrapper">
                <div
                  v-for="(val, idx) in chartData.cpu"
                  :key="idx"
                  class="point cpu"
                  :style="{ bottom: val + '%', left: (idx / 19 * 100) + '%' }"
                >
                  <span class="tooltip">{{ val }}%</span>
                </div>
              </div>
              <div class="line-wrapper">
                <div
                  v-for="(val, idx) in chartData.memory"
                  :key="idx"
                  class="point memory"
                  :style="{ bottom: val + '%', left: (idx / 19 * 100) + '%' }"
                />
              </div>
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 智能体状态列表 -->
    <div class="agents-section">
      <el-card>
        <template #header>
          <span>智能体状态</span>
        </template>
        <div v-if="store.latestMetric" class="agents-list">
          <div
            v-for="agent in store.latestMetric.agents"
            :key="agent.id"
            class="agent-item"
            @click="selectedAgentId = agent.id"
          >
            <div class="agent-status" :style="{ background: getStatusColor(agent.status) }" />
            <div class="agent-info">
              <div class="agent-name">{{ agent.name }}</div>
              <div class="agent-meta">
                <el-tag size="small" type="info">{{ agent.tasks }} 任务</el-tag>
                <el-tag size="small">
                  <el-icon><Timer /></el-icon>
                  {{ agent.avgResponseTime }}ms
                </el-tag>
              </div>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无数据" />
      </el-card>
    </div>

    <!-- 告警列表 -->
    <div class="alerts-section">
      <el-card>
        <template #header>
          <div class="alerts-header">
            <span>告警通知</span>
            <el-badge :value="store.unhealthyAlerts.length" :hidden="store.unhealthyAlerts.length === 0">
              <el-button size="small" text @click="store.clearAlerts">清空</el-button>
            </el-badge>
          </div>
        </template>
        <div v-if="store.alerts.length > 0" class="alerts-list">
          <div
            v-for="alert in store.alerts.slice(0, 10)"
            :key="alert.id"
            :class="['alert-item', alert.type, { resolved: alert.resolved }]"
          >
            <el-icon>
              <component :is="getAlertIcon(alert.type)" />
            </el-icon>
            <div class="alert-content">
              <div class="alert-message">{{ alert.message }}</div>
              <div class="alert-time">{{ new Date(alert.timestamp).toLocaleString() }}</div>
            </div>
            <el-button
              v-if="!alert.resolved"
              size="small"
              text
              @click="store.resolveAlert(alert.id)"
            >
              处理
            </el-button>
          </div>
        </div>
        <el-empty v-else description="暂无告警" />
      </el-card>
    </div>

    <!-- 智能体详情抽屉 -->
    <el-drawer
      :model-value="selectedAgentId !== null"
      title="智能体详情"
      size="400px"
      @close="selectedAgentId = null"
    >
      <div v-if="selectedAgent" class="agent-detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="ID">{{ selectedAgent.id }}</el-descriptions-item>
          <el-descriptions-item label="名称">{{ selectedAgent.name }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="selectedAgent.status === 'running' ? 'success' : selectedAgent.status === 'error' ? 'danger' : 'info'">
              {{ selectedAgent.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="执行任务数">{{ selectedAgent.tasks }}</el-descriptions-item>
          <el-descriptions-item label="平均响应时间">{{ selectedAgent.avgResponseTime }}ms</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.performance-panel {
  padding: 20px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto 1fr;
  gap: 20px;
  height: calc(100vh - 140px);
}

.control-bar {
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.metrics-grid {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 16px;
}

.metric-card :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.metric-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: white;
}

.metric-icon.cpu { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.metric-icon.memory { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
.metric-icon.network { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
.metric-icon.agents { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); }

.metric-info {
  flex: 1;
}

.metric-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.metric-value {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 8px;
}

.charts-section {
  grid-column: 1;
  grid-row: 3;
}

.agents-section {
  grid-column: 2;
  grid-row: 3;
}

.alerts-section {
  grid-column: 1 / -1;
}

.chart-container {
  height: 200px;
}

.simple-chart {
  position: relative;
  height: 100%;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
  padding: 20px;
}

.chart-legend {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 16px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot.cpu { background: #667eea; }
.dot.memory { background: #f5576c; }

.chart-lines {
  position: relative;
  height: 100%;
}

.line-wrapper {
  position: absolute;
  inset: 0;
}

.point {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translate(-50%, 50%);
  transition: all 0.3s;
}

.point.cpu { background: #667eea; }
.point.memory { background: #f5576c; }

.point:hover {
  transform: translate(-50%, 50%) scale(1.5);
}

.point .tooltip {
  position: absolute;
  bottom: 15px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

.point:hover .tooltip {
  opacity: 1;
}

.agents-list {
  max-height: 300px;
  overflow-y: auto;
}

.agent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.agent-item:hover {
  background: var(--el-fill-color-light);
}

.agent-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.agent-info {
  flex: 1;
}

.agent-name {
  font-weight: 500;
  margin-bottom: 4px;
}

.agent-meta {
  display: flex;
  gap: 8px;
}

.alerts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.alerts-list {
  max-height: 200px;
  overflow-y: auto;
}

.alert-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 8px;
  background: var(--el-fill-color-lighter);
}

.alert-item.error {
  background: rgba(245, 108, 108, 0.1);
}

.alert-item.warning {
  background: rgba(230, 162, 60, 0.1);
}

.alert-item.resolved {
  opacity: 0.5;
}

.alert-content {
  flex: 1;
}

.alert-message {
  font-size: 13px;
  margin-bottom: 2px;
}

.alert-time {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 1200px) {
  .performance-panel {
    grid-template-columns: 1fr;
  }

  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .metrics-grid {
    grid-template-columns: 1fr;
  }
}
</style>
