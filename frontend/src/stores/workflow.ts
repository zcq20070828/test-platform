// 工作流状态管理

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { WorkflowStep, SSEEvent } from '@/types'
import { workflowApi } from '@/api'

export const useWorkflowStore = defineStore('workflow', () => {
  // 状态
  const steps = ref<WorkflowStep[]>([])
  const currentWorkflowId = ref<string | null>(null)
  const isRunning = ref(false)
  const currentStepIndex = ref(-1)
  const logs = ref<string[]>([])
  const error = ref<string | null>(null)

  // 持久化 currentWorkflowId 到 localStorage（页面刷新后恢复）
  const WF_ID_STORAGE_KEY = 'current_workflow_id'
  const savedWfId = localStorage.getItem(WF_ID_STORAGE_KEY)
  if (savedWfId) {
    currentWorkflowId.value = savedWfId
  }

  // 监听变化并持久化
  watch(currentWorkflowId, (newVal) => {
    if (newVal) {
      localStorage.setItem(WF_ID_STORAGE_KEY, newVal)
    } else {
      localStorage.removeItem(WF_ID_STORAGE_KEY)
    }
  })

  // 后端执行顺序（与 executeAutoWorkflowWithReview 一致）- 9步执行 + 每步后3审核
  const EXECUTOR_ORDER = [
    'test-requirement-analyzer',  // 1. 需求分析（必选）
    'test-scheme-generator',       // 2. 测试方案（可选）
    'test-case-generator',         // 3. 用例生成（必选）
    'test-data-generator',         // 4. 数据生成（可选）
    'data-masking',                // 5. 数据脱敏（可选）
    'api-executor',                // 6. 接口测试（可选）
    'ui-e2e-executor',             // 7. UI/E2E测试（必选）
    'defect-analyzer',             // 8. 缺陷分析（可选）
    'test-reporter'                // 9. 报告生成（必选）
  ]
  
  const REVIEWER_AGENTS = [
    'ai-quality-reviewer-1',
    'ai-quality-reviewer-2',
    'ai-quality-reviewer-3'
  ]

  // 智能体名称映射
  const agentNames: Record<string, string> = {
    'test-requirement-analyzer': '需求分析',
    'test-scheme-generator': '测试方案',
    'test-case-generator': '用例生成',
    'test-data-generator': '数据生成',
    'data-masking': '数据脱敏',
    'api-executor': '接口测试',
    'ui-e2e-executor': 'UI/E2E测试',
    'defect-analyzer': '缺陷分析',
    'test-reporter': '报告生成',
    'ai-quality-reviewer-1': 'AI审核-1',
    'ai-quality-reviewer-2': 'AI审核-2',
    'ai-quality-reviewer-3': 'AI审核-3'
  }

  // 智能体详细信息（使用Emoji图标保持与后端一致）
  const agentInfo: Record<string, { name: string; desc: string; icon: string }> = {
    'test-requirement-analyzer': { name: '需求分析', desc: '解析需求文档，提取功能点与测试条件', icon: '🔍' },
    'test-scheme-generator': { name: '测试方案', desc: '制定测试策略、范围与资源配置', icon: '📋' },
    'test-case-generator': { name: '用例生成', desc: '基于需求和方案编写测试用例', icon: '✅' },
    'test-data-generator': { name: '数据生成', desc: '根据用例需求批量生成测试数据', icon: '📊' },
    'data-masking': { name: '数据脱敏', desc: '识别敏感数据并生成脱敏规则', icon: '🔒' },
    'api-executor': { name: '接口测试', desc: '执行API接口测试并记录结果', icon: '🔌' },
    'ui-e2e-executor': { name: 'UI/E2E测试', desc: '自动化UI功能测试与回归', icon: '🖥️' },
    'defect-analyzer': { name: '缺陷分析', desc: '分析测试缺陷并分类定级', icon: '🐛' },
    'test-reporter': { name: '报告生成', desc: '汇总结果生成测试报告', icon: '📝' },
    'ai-quality-reviewer-1': { name: 'AI审核-事实逻辑', desc: '评估事实准确性(25%)+逻辑一致性(25%)', icon: '🔍' },
    'ai-quality-reviewer-2': { name: 'AI审核-安全合规', desc: '评估安全性与合规性，含否决项(25%)', icon: '🛡️' },
    'ai-quality-reviewer-3': { name: 'AI审核-格式结构', desc: '评估格式规范与结构完整性(25%)', icon: '📐' }
  }

  // 工作流可视化用的阶段定义（分组结构）
  // 全自动模式：每个执行阶段后紧跟3个审核智能体，审核通过才进入下一阶段
  const stages = computed(() => {
    // 必选执行阶段（与后端 EXECUTOR_ORDER_REQUIRED 一致）
    const requiredExecutors = [
      { id: 'test-requirement-analyzer', name: '需求分析', desc: '解析需求文档，提取功能点与测试条件' },
      { id: 'test-case-generator', name: '用例生成', desc: '基于需求和方案编写测试用例' },
      { id: 'ui-e2e-executor', name: 'UI/E2E测试', desc: '自动化UI功能测试与回归' },
      { id: 'test-reporter', name: '测试报告', desc: '汇总结果生成测试报告' }
    ]

    const reviewerIds = ['ai-quality-reviewer-1', 'ai-quality-reviewer-2', 'ai-quality-reviewer-3']

    // 每个执行阶段 + 紧跟的审核阶段 为一组
    const groupDefs: Array<{ name: string; description: string; steps: string[]; isReview?: boolean }> = []
    requiredExecutors.forEach((exec, idx) => {
      groupDefs.push({
        name: `Phase ${idx + 1}: ${exec.name}`,
        description: exec.desc,
        steps: [exec.id]
      })
      groupDefs.push({
        name: `审核 ${idx + 1}`,
        description: '三个AI审核智能体并行评估（三评均≥90分通过）',
        steps: reviewerIds,
        isReview: true
      })
    })

    return groupDefs.map(g => ({
      name: g.name,
      description: g.description,
      steps: g.steps,
      isReview: !!g.isReview
    }))
  })

  // 计算属性：当前阶段
  const currentStage = computed(() => {
    if (currentStepIndex.value < 0) return null
    // 从扁平步骤列表中获取当前步骤名称
    return steps.value[currentStepIndex.value]?.name || null
  })

  // 计算属性：进度百分比
  const progress = computed(() => {
    if (steps.value.length === 0) return 0
    const completed = steps.value.filter(s => s.status === 'completed').length
    return Math.round((completed / steps.value.length) * 100)
  })

  // 执行全自动工作流
  async function executeAutoWorkflow(input: string) {
    isRunning.value = true
    error.value = null
    logs.value = []
    currentStepIndex.value = -1

    // 初始化步骤 - 9个执行+每个后面3个审核 = 9 + 9*3 = 36步
    initSteps()

    addLog('🚀 工作流启动')
    addLog(`任务: ${input.slice(0, 100)}...`)
    addLog(`执行流程: ${EXECUTOR_ORDER.length}步执行，每步后3审核`)

    try {
      const result = await workflowApi.executeAutoWithReview(input)
      if (result) {
        currentWorkflowId.value = result.workflowId
        addLog(`工作流ID: ${result.workflowId}`)
      } else {
        throw new Error('工作流启动失败')
      }
    } catch (err) {
      error.value = String(err)
      addLog(`❌ 错误: ${err}`)
      isRunning.value = false
    }
  }

  // 初始化步骤（对应后端的 9步+每步3审核）
  function initSteps() {
    const allSteps: WorkflowStep[] = []
    let stepId = 1
    
    for (const executor of EXECUTOR_ORDER) {
      allSteps.push({
        id: stepId++,
        name: agentNames[executor] || executor,
        agent: executor,
        description: '执行',
        status: 'pending'
      })
      // 每个执行步骤后紧跟3个审核步骤
      for (const reviewer of REVIEWER_AGENTS) {
        allSteps.push({
          id: stepId++,
          name: agentNames[reviewer] || reviewer,
          agent: reviewer,
          description: '质量审核',
          status: 'pending'
        })
      }
    }
    
    steps.value = allSteps
    // 更新总数
    console.log(`[Workflow] Initialized ${steps.value.length} steps (9 executors × 4 including reviewers)`)
  }

  // 获取智能体名称

  // 获取智能体完整信息
  function getAgentDetail(agentId: string) {
    return agentInfo[agentId] || { name: agentId, desc: '', icon: 'Operation' }
  }

  // 添加日志
  function addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString()
    logs.value.push(`[${timestamp}] ${message}`)
  }

  // 更新步骤状态
  function updateStepStatus(stepId: number, status: WorkflowStep['status'], output?: string) {
    const step = steps.value.find(s => s.id === stepId)
    if (step) {
      step.status = status
      if (output) step.output = output
    }
  }

  // 处理 SSE 事件
  function handleSSEEvent(event: SSEEvent) {
    switch (event.type) {
      case 'workflow_started':
        addLog('📋 工作流开始执行')
        break
      case 'workflow_step_complete':
        addLog(`✅ 步骤完成: ${event.message}`)
        currentStepIndex.value++
        break
      case 'workflow_phase':
        if (event.phase === 'executor') {
          addLog(`🚀 进入执行阶段: ${event.message}`)
        } else if (event.phase === 'review') {
          addLog(`🛡️ 进入审核阶段: ${event.message}`)
        }
        break
      case 'task_progress':
        addLog(`⏳ ${event.message}`)
        break
      case 'executor_completed':
        addLog(`✅ 执行完成: ${event.agentName}`)
        break
      case 'reviewer_started':
        addLog(`🛡️ ${event.reviewerName || event.reviewerId} 开始审核（第${event.reviewerIndex}/${event.totalReviewers}个）`)
        break
      case 'reviewer_completed':
        addLog(`🛡️ ${event.reviewerName || event.reviewerId} 审核完成（${event.score}分 ${event.veto ? '❌否决' : '✅' }）`)
        break
      case 'parallel_review_completed':
        addLog(`🛡️ 审核完成: ${event.agentName}`)
        if (event.scores) {
          addLog(`   评分: ${event.scores.join(', ')}`)
        }
        break
      case 'workflow_complete':
        addLog('🎉 工作流完成')
        isRunning.value = false
        break
      case 'workflow_error':
        addLog(`❌ 错误: ${event.message}`)
        error.value = event.message
        isRunning.value = false
        break
      case 'workflow_failed':
        addLog(`❌ 工作流失败: ${event.message}`)
        error.value = event.message
        isRunning.value = false
        break
      case 'workflow_timeout':
        addLog(`⏰ ${event.message || '工作流超时（30分钟），系统已终止'}`)
        error.value = event.message
        isRunning.value = false
        break
    }
  }

  // 清空日志
  function clearLogs() {
    logs.value = []
  }

  // 重置工作流
  function reset() {
    steps.value = []
    currentWorkflowId.value = null
    isRunning.value = false
    currentStepIndex.value = -1
    logs.value = []
    error.value = null
  }

  return {
    // 状态
    steps,
    currentWorkflowId,
    isRunning,
    currentStepIndex,
    logs,
    error,
    stages,

    // 计算属性
    currentStage,
    progress,

    // 方法
    executeAutoWorkflow,
    updateStepStatus,
    handleSSEEvent,
    reset,
    clearLogs,
    addLog,
    getAgentDetail,
    agentInfo
  }
})
