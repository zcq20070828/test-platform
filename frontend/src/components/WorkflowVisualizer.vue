<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useWorkflowStore } from '@/stores/workflow'
import type { WorkflowStep } from '@/types'

const store = useWorkflowStore()

// 缩放和平移
const scale = ref(1)
const translateX = ref(50)
const translateY = ref(50)
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

// 选中的节点
const selectedNode = ref<WorkflowStep | null>(null)
const showDetail = ref(false)

// 节点尺寸
const nodeWidth = 180
const nodeHeight = 80
const gapX = 60
const gapY = 120

// 计算节点位置（动态排列）
const nodePositions = computed(() => {
  const positions: Record<number, { x: number; y: number }> = {}
  const steps = store.steps
  
  if (!steps || steps.length === 0) return positions

  // 每4步为一组（1个执行+3个审核）
  let colIndex = 0
  for (let i = 0; i < steps.length; i += 4) {
    const executorStep = steps[i]
    const reviewerSteps = steps.slice(i + 1, i + 4)
    
    // 执行节点在上方
    if (executorStep) {
      positions[executorStep.id] = {
        x: colIndex * (nodeWidth + gapX) + 20,
        y: 50
      }
    }
    
    // 3个审核节点在下方垂直排列
    reviewerSteps.forEach((reviewer, idx) => {
      if (reviewer) {
        positions[reviewer.id] = {
          x: colIndex * (nodeWidth + gapX) + 20,
          y: 50 + (idx + 1) * (nodeHeight + gapY)
        }
      }
    })
    
    colIndex++
  }

  return positions
})

// 获取节点位置（带默认值）
function getNodePosition(id: number): { x: number; y: number } {
  return nodePositions.value[id] || { x: 0, y: 0 }
}

// 计算连线（每个执行节点连接到其后面的3个审核节点，以及最后的审核节点连接到下一个执行节点）
const connections = computed(() => {
  const conns: { from: number; to: number }[] = []
  const steps = store.steps
  
  if (!steps || steps.length === 0) return conns

  for (let i = 0; i < steps.length; i += 4) {
    const executor = steps[i]
    const reviewers = steps.slice(i + 1, i + 4)
    
    // 执行 -> 3个审核
    if (executor) {
      reviewers.forEach(reviewer => {
        if (reviewer) {
          conns.push({ from: executor.id, to: reviewer.id })
        }
      })
    }
    
    // 3个审核 -> 下一个执行（第4个步骤是下一个执行节点）
    const nextExecutorIdx = i + 4
    if (nextExecutorIdx < steps.length) {
      const nextExecutor = steps[nextExecutorIdx]
      reviewers.forEach(reviewer => {
        if (reviewer && nextExecutor) {
          conns.push({ from: reviewer.id, to: nextExecutor.id })
        }
      })
    }
  }

  return conns
})

// 获取节点状态样式
function getNodeClass(step: WorkflowStep): string {
  return `node-${step.status}`
}

// 获取节点图标
function getNodeIcon(status: string): string {
  const icons: Record<string, string> = {
    pending: 'Clock',
    running: 'Loading',
    completed: 'CircleCheck',
    failed: 'CircleClose'
  }
  return icons[status] || 'Clock'
}

// 判断是否是审核节点
function isReviewer(agentId: string): boolean {
  return agentId.includes('reviewer')
}

// 获取节点标签
function getNodeLabel(step: WorkflowStep): string {
  if (isReviewer(step.agent)) {
    return '🛡️ 审核'
  }
  return '⚡ 执行'
}

// 获取连线颜色
function getLineColor(fromStep: WorkflowStep, toStep: WorkflowStep): string {
  if (fromStep.status === 'completed' && toStep.status === 'completed') {
    return '#67c23a'
  }
  if (fromStep.status === 'completed' && toStep.status === 'running') {
    return '#409eff'
  }
  return '#dcdfe6'
}

// 点击节点
function handleNodeClick(step: WorkflowStep) {
  selectedNode.value = step
  showDetail.value = true
}

// 缩放
function handleZoom(delta: number) {
  scale.value = Math.min(2, Math.max(0.5, scale.value + delta))
}

// 重置视图
function resetView() {
  scale.value = 1
  translateX.value = 50
  translateY.value = 50
}

// 鼠标拖拽
function handleMouseDown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.workflow-node')) return
  isDragging.value = true
  dragStart.value = { x: e.clientX - translateX.value, y: e.clientY - translateY.value }
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  translateX.value = e.clientX - dragStart.value.x
  translateY.value = e.clientY - dragStart.value.y
}

function handleMouseUp() {
  isDragging.value = false
}

// 获取SVG路径（贝塞尔曲线）
function getPathD(fromId: number, toId: number): string {
  const from = getNodePosition(fromId)
  const to = getNodePosition(toId)

  const fromY = from.y + nodeHeight / 2
  const toY = to.y + nodeHeight / 2

  const midX = (from.x + to.x) / 2
  return `M ${from.x + nodeWidth} ${fromY} C ${from.x + nodeWidth + 30} ${fromY}, ${to.x - 30} ${toY}, ${to.x} ${toY}`
}

// 生命周期
onMounted(() => {
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
})
</script>

<template>
  <div class="workflow-visualizer">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="zoom-controls">
        <el-button size="small" @click="handleZoom(0.1)">
          <el-icon><ZoomIn /></el-icon>
        </el-button>
        <span class="zoom-level">{{ Math.round(scale * 100) }}%</span>
        <el-button size="small" @click="handleZoom(-0.1)">
          <el-icon><ZoomOut /></el-icon>
        </el-button>
        <el-button size="small" @click="resetView">
          <el-icon><RefreshRight /></el-icon>
        </el-button>
      </div>

      <div class="legend">
        <span class="legend-item">
          <span class="dot pending"></span> 待执行
        </span>
        <span class="legend-item">
          <span class="dot running"></span> 执行中
        </span>
        <span class="legend-item">
          <span class="dot completed"></span> 已完成
        </span>
        <span class="legend-item">
          <span class="dot failed"></span> 失败
        </span>
      </div>
    </div>

    <!-- 流程图画布 -->
    <div
      class="canvas-container"
      @mousedown="handleMouseDown"
    >
      <svg
        class="workflow-svg"
        :style="{
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          transformOrigin: '0 0',
          minWidth: `${Math.max(1200, (store.steps.length / 4) * 250)}px`
        }"
      >
        <!-- 连线 -->
        <g class="connections">
          <path
            v-for="conn in connections"
            :key="`${conn.from}-${conn.to}`"
            :d="getPathD(conn.from, conn.to)"
            :stroke="getLineColor(
              store.steps.find(s => s.id === conn.from) || { status: 'pending' } as WorkflowStep,
              store.steps.find(s => s.id === conn.to) || { status: 'pending' } as WorkflowStep
            )"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
          />
        </g>

        <!-- 节��� -->
        <g class="nodes">
          <g
            v-for="step in store.steps"
            :key="step.id"
            :transform="`translate(${getNodePosition(step.id).x}, ${getNodePosition(step.id).y})`"
            class="workflow-node"
            @click="handleNodeClick(step)"
          >
            <!-- 节点背景 -->
            <rect
              width="180"
              height="80"
              rx="8"
              :class="getNodeClass(step)"
            />

            <!-- 节点内容 -->
            <foreignObject x="10" y="10" width="160" height="60">
              <div class="node-content">
                <div class="node-header">
                  <el-icon :class="{ rotating: step.status === 'running' }">
                    <component :is="getNodeIcon(step.status)" />
                  </el-icon>
                  <span class="node-label" :class="{ 'label-reviewer': isReviewer(step.agent) }">
                    {{ getNodeLabel(step) }}
                  </span>
                </div>
                <div class="node-name" :title="step.name">{{ step.name.slice(0, 12) }}{{ step.name.length > 12 ? '...' : '' }}</div>
                <div class="node-agent">{{ step.agent }}</div>
              </div>
            </foreignObject>
          </g>
        </g>
      </svg>
    </div>

    <!-- 节点详情抽屉 -->
    <el-drawer
      v-model="showDetail"
      title="步骤详情"
      size="400px"
    >
      <div v-if="selectedNode" class="step-detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="步骤ID">#{{ selectedNode.id }}</el-descriptions-item>
          <el-descriptions-item label="步骤名称">{{ selectedNode.name }}</el-descriptions-item>
          <el-descriptions-item label="执行智能体">{{ selectedNode.agent }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="selectedNode.status === 'completed' ? 'success' : selectedNode.status === 'running' ? 'warning' : selectedNode.status === 'failed' ? 'danger' : 'info'">
              {{ selectedNode.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="类型">{{ isReviewer(selectedNode.agent) ? 'AI质量审核' : '执行' }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="selectedNode.output" class="output-section">
          <h4>输出结果</h4>
          <pre class="output-content">{{ selectedNode.output }}</pre>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.workflow-visualizer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-fill-color-lighter);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: white;
  border-bottom: 1px solid var(--el-border-color-light);
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-level {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  min-width: 50px;
  text-align: center;
}

.legend {
  display: flex;
  gap: 16px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.dot.pending { background: #909399; }
.dot.running { background: #409eff; animation: pulse 1.5s infinite; }
.dot.completed { background: #67c23a; }
.dot.failed { background: #f56c6c; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.canvas-container {
  flex: 1;
  overflow: auto;
  cursor: grab;
  position: relative;
}

.canvas-container:active {
  cursor: grabbing;
}

.workflow-svg {
  width: 100%;
  height: 100%;
  min-height: 600px;
}

.workflow-node {
  cursor: pointer;
  transition: transform 0.2s;
}

.workflow-node:hover {
  transform: scale(1.02);
}

.node-content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.node-label {
  font-size: 10px;
  color: var(--el-color-primary);
  font-weight: 500;
}

.node-label.label-reviewer {
  color: var(--el-color-danger);
}

.node-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-agent {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}

/* 节点状态样式 */
.node-pending {
  fill: white;
  stroke: #dcdfe6;
  stroke-width: 2;
}

.node-running {
  fill: #ecf5ff;
  stroke: #409eff;
  stroke-width: 2;
}

.node-completed {
  fill: #f0f9eb;
  stroke: #67c23a;
  stroke-width: 2;
}

.node-failed {
  fill: #fef0f0;
  stroke: #f56c6c;
  stroke-width: 2;
}

.rotating {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.step-detail {
  padding: 0 12px;
}

.output-section {
  margin-top: 20px;
}

.output-section h4 {
  margin-bottom: 12px;
}

.output-content {
  background: var(--el-fill-color-light);
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  max-height: 300px;
  overflow-y: auto;
}
</style>