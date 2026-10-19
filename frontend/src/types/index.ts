// 测试中台类型定义

// 智能体类型
export interface Agent {
  id: string
  name: string
  desc: string
  icon: string
  capabilities: string[]
  workflow: string[]
  skills?: string[]
  knowledgeBases?: string[]
  soulIntro?: string
  longDescription?: string
  passThreshold?: number
  description?: string
}

// 任务状态
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

// AI审核结果
export interface ReviewResult {
  reviewerId: string
  reviewerName: string
  reviewerIndex?: number
  totalReviewers?: number
  score: number
  passed: boolean
  veto?: boolean  // 一票否决
  feedback?: string
  dimensions?: {
    factual: number
    logic: number
    safety: number
    format: number
  }
}

// 任务类型
export interface Task {
  id: string
  agent: string
  agentName: string
  input: string
  output?: string
  artifacts?: Artifact[]
  status: TaskStatus
  startTime?: string
  endTime?: string
  progress?: number
  // 数据来源：分步测试任务 or 测试流水线运行记录
  source?: 'task' | 'workflow'
  // 任务所属用户的显示名（后端由 users 表 JOIN 得出，任务列表"用户"列使用）
  username?: string | null
  // 测试流水线步骤数
  workflowSteps?: number
  // AI审核相关
  reviewing?: boolean  // 是否正在审核中
  reviewPassed?: boolean  // 审核是否通过
  reviewFailed?: boolean  // 审核是否永久失败（达到最大重试次数）
  reviewResults?: ReviewResult[]  // 审核结果列表
  // 成本统计字段（数据库 tasks 表映射）
  manualHours?: number | null
  actualCost?: number | null
  estimatedCost?: number | null
  savedCost?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  modelName?: string | null
}

// 知识库文档
export interface KnowledgeDoc {
  id: string
  name: string
  kbType: string
  path: string
  size: number
  content?: string
  vectorized?: boolean
  score?: number // 语义搜索相似度分数
}

// 工作流步骤
export interface WorkflowStep {
  id: number
  name: string
  agent: string
  description: string
  status: TaskStatus
  output?: string
}

// 附件文件
export interface AttachmentFile {
  name: string
  size: number
  type: string
  dataUrl?: string
  path?: string
}

// 思考步骤
export interface ThinkingStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result' | 'step' | 'output'
  content: string
  timestamp: string
  toolName?: string
  toolResult?: string
}

// 输出物（任务处理过程输出物和最终输出物）
export interface Artifact {
  id: string
  name: string                 // 输出物名称，如“需求分析文档.md”
  type: 'text' | 'file' | 'image' | 'code' | 'report'
  contentType: string          // MIME 类型，如 "text/markdown", "application/pdf"
  content?: string             // 文本内容（type=text/code 时使用）
  downloadUrl?: string         // 文件下载地址（type=file/image 时使用）
  size?: number                // 文件大小（字节）
  createdAt: string
}

// 消息元数据（用于用户决策消息）
export interface MessageMetadata {
  workflowId?: string
  stepIndex?: number
  stepName?: string
  requireDecision?: boolean
  decisionOptions?: string[]
  reviewInProgress?: boolean
  reviewers?: ReviewerStatus[]
  workflowPhase?: 'requirements' | 'design' | 'tasks' | 'execution' | 'summary'
  progress?: { completed: number; total: number }
  isAutoRetry?: boolean
  retryCount?: number
  maxRetries?: number
  isWorkflowFailed?: boolean
  reason?: string
}

// 审核状态
export interface ReviewerStatus {
  agentId: string
  agentName: string
  status: 'waiting' | 'running' | 'done'
  score?: number
  feedback?: string
}

// 聊天消息
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  type?: 'user' | 'agent' | 'system' | 'progress' | 'interaction' | 'result' | 'error' | 'user_decision'
  content: string
  timestamp: string
  agentName?: string
  agentIcon?: string
  agentId?: string
  thinking?: ThinkingStep[]
  isStreaming?: boolean
  // 输出物列表
  artifacts?: Artifact[]
  // 用户决策消息的元数据
  metadata?: MessageMetadata
  // 流式处理时的状态标记
  isAutoRetry?: boolean
  isWorkflowFailed?: boolean
  // 所属工作流 ID（性能/安全等工作流事件消息携带，供按 workflowId 过滤）
  workflowId?: string
}

// API 响应
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// SSE 事件类型
export type SSEEventType =
  | 'task_started'
  | 'task_progress'
  | 'task_interaction'
  | 'task_completed'
  | 'task_error'
  | 'task_created'
  | 'task_deleted'
  | 'workflow_started'
  | 'workflow_step'
  | 'workflow_step_complete'
  | 'workflow_complete'
  | 'workflow_completed'
  | 'workflow_timeout'
  | 'workflow_error'
  | 'workflow_failed'
  | 'workflow_consensus_passed'
  | 'workflow_phase'
  | 'executor_completed'
  | 'parallel_review_completed'
  | 'reviewer_started'
  | 'reviewer_completed'
  | 'kb_updated'
  | 'kb_vectorized'
  | 'connected'
  | 'debug_test'
  | 'agent_stream_start'
  | 'agent_stream_chunk'
  | 'agent_stream_end'

export interface SSEEvent {
  type: SSEEventType
  taskId?: string
  workflowId?: string
  message: string
  agentId?: string
  agentName?: string
  phase?: string
  scores?: number[]
  score?: number // 单个审核分数（reviewer_score事件）
  input?: string
  executorCount?: number
  reviewerCount?: number
  // 审核员字段
  reviewerId?: string
  reviewerName?: string
  reviewerIndex?: number
  totalReviewers?: number
  veto?: boolean // 一票否决
  // 维度评分
  dimensions?: Record<string, number>
  data?: Record<string, unknown>
  // 流式输出字段
  streamMsgId?: string
  chunkType?: 'thinking' | 'content' | 'tool_call'
  chunkText?: string
  fullContent?: string
}
