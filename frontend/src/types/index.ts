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
  // 第几轮审核（后端按 attempt 累积记录，前端只展示最大 attempt 那一轮）
  attempt?: number
  // 审核智能体自身失败原因（网关超时/模型不可用）。非空表示该评分不是真实判定，
  // 后端已将其排除在通过率之外，前端应显示为「审核异常」而非「0 分未通过」。
  error?: string | null
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
  // 任务业务类型（general / security-scan / performance-test 等，后端透传）
  type?: string
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
  /**
   * 审核结论（2026-11-17 三元化）：
   *   passed            门禁达标 + 无 blocker + major 密度 ≤3%
   *   passed_with_notes 门禁达标 + 无 blocker + 密度 ≤6%：已交付，但附改进建议
   *   failed            未通过（门禁未达标 / 有 blocker / 密度过高）
   *   inconclusive      有效评审不足，按审核不可用放行
   */
  reviewVerdict?: 'passed' | 'passed_with_notes' | 'failed' | 'inconclusive' | 'veto' | null
  reviewSummary?: string | null  // 结论摘要（含密度与 blocker 数）
  reviewNotes?: ReviewNote[] | null  // 改进建议（并集去重后的 issues 摘要，最多 30 条；列表接口不返回，仅详情返回）
  reviewNoteCount?: number | null  // 改进建议条数（列表接口用，避免返回完整 notes 拖慢列表）
  reviewAttempts?: number | null  // 审核轮数（1 = 一轮通过）
  reviewStats?: string | null  // 并集统计文本（blocker/major/minor + 密度）
  // 后端返回的原始字段（任务列表/详情直接透传，组件已在读取）
  result?: string | null
  error?: string | null
  /** 失败诊断（后端在任务失败时下发，前端据此渲染可操作提示） */
  failure?: TaskFailure | null
  userId?: string
  agentId?: string
  /**
   * 会话归属（2026-11-25 · 对话改造第三步）
   *
   * null 表示未归属会话（改造前的老任务都是 null）。
   * 会话只做分组，不改变任务的执行方式。
   */
  sessionId?: string | null
  /** 会话内序号（1 起，用于确定产物先后） */
  sessionSeq?: number | null
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  // 成本统计字段（数据库 tasks 表映射）
  manualHours?: number | null
  actualCost?: number | null
  estimatedCost?: number | null
  savedCost?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  modelName?: string | null
}

/** 审核改进建议（任务详情页逐条展示，2026-11-17） */
export interface ReviewNote {
  severity: 'blocker' | 'major' | 'minor' | string
  category: string
  caseId?: string
  description: string
  suggestion?: string
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
  /** 失败诊断（后端 lib/failure-diagnosis.js 产出，前端据此渲染可操作提示） */
  failure?: TaskFailure
}

/** 任务失败诊断：把技术错误翻译成用户能行动的信息 */
export interface TaskFailure {
  category: 'balance' | 'rate_limit' | 'auth' | 'model_not_found' | 'context_overflow'
    | 'network' | 'busy' | 'tool_not_called' | 'quality_gate' | 'unknown'
  title: string
  detail: string
  actions: string[]
  retryable: boolean
  raw: string
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
  type?: 'user' | 'agent' | 'system' | 'progress' | 'interaction' | 'result' | 'error' | 'user_decision' | 'change_plan'
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
  // 输出物版本标签（多轮迭代生成时展示 v1/v2）
  versionLabel?: string
  // 本轮对话的执行模式（2026-11-20）：
  //   question 问答不改交付物 / regenerate 全量重写 / surgical 定点修改
  //   / append 追加 / refine 全局修订
  intentMode?: 'question' | 'regenerate' | 'surgical' | 'append' | 'refine'
  intentLabel?: string
  intentNote?: string
  // 所属阶段名称（性能/安全等工作流事件消息）
  stage?: string
  // 变更计划（2026-11-25 · 对话改造第一步）：
  // type='change_plan' 时携带，用户勾选确认后才真正执行
  plan?: {
    summary: string
    mode: 'surgical' | 'append' | 'refine'
    scale: 'small' | 'medium' | 'large'
    items: Array<{
      type: 'modify' | 'add' | 'remove' | 'global'
      caseIds?: string[]
      count?: number | null
      reason?: string
    }>
  }
  planId?: string
  /** 计划对应的原始用户指令（确认执行时要一起带给后端） */
  message?: string
}

// API 响应
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  /** 业务错误码（如 INTENT_CONFIRM_REQUIRED），前端按码分流交互 */
  code?: string
  /** 服务端给的补充说明（如「意图不明确，请选择任务类型」） */
  message?: string
  /** 完整响应体：需要用户做选择的场景要把结构化数据带出来 */
  details?: any
}

/** 意图确认候选（任务提交时识别不准，让用户三选一） */
export interface IntentCandidate {
  agentId: string
  agentName: string
  desc: string
  score: number
  hits: string[]
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
