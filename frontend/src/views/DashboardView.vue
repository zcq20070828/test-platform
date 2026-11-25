<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { ElMessage, ElMessageBox } from 'element-plus'
// 【平台瘦身 2026-10-14】StatCard 随顶部统计卡片移除（组件文件保留，当前无其他引用方）
import DashboardChatPanel from '@/components/DashboardChatPanel.vue'
import IntentConfirmDialog from '@/components/IntentConfirmDialog.vue'
import type { AttachmentFile, ChatMessage } from '@/types'
import { getAuthHeaders, request, taskApi } from '@/api'
import MsIcon from '@/components/MsIcon.vue'
import { getAgentIcon } from '@/utils/agentIcons'
import { toAttachmentPayloads, describeAttachments, type AttachmentPayload } from '@/utils/attachment'

const store = useMainStore()
const router = useRouter()
// ===== 智能体下拉列表配置 =====
// 排除:test-master(主控)、ai-quality-reviewer-1/2/3(审核智能体)、ai-evaluation-agent(AI评估,改由「智能评估」菜单承载)、test-script-generator(改由自动化测试tab承载)、compatibility-coordinator(改由兼容性测试菜单承载)
const EXCLUDED_AGENTS = ['test-master', 'ai-quality-reviewer-1', 'ai-quality-reviewer-2', 'ai-quality-reviewer-3', 'security-sentinel', 'performance-tester', 'test-script-generator', 'compatibility-coordinator', 'ai-evaluation-agent']

// 智能体中文名称映射
const AGENT_NAME_MAP: Record<string, string> = {
  'test-requirement-analyzer': '需求分析',
  'test-case-generator': '测试用例生成',
  'ai-app-tester': 'AI应用测试',
  'test-data-generator': '测试数据生成',
  'defect-analyzer': '缺陷分析',
  'api-executor': '接口测试',
  'ui-e2e-executor': 'UI/E2E测试',
  'test-reporter': '测试报告',
  'data-masking': '数据脱敏',
  'test-scheme-generator': '测试方案生成',
  'security-sentinel': '安全测试',
  'performance-tester': '性能测试'
}

// 智能体关键词映射 - 用于检查用户输入与所选智能体是否匹配
// 每种智能体列出该场景下用户输入应包含的关键词
const AGENT_KEYWORDS: Record<string, { keywords: string[]; description: string }> = {
  'test-requirement-analyzer': {
    keywords: ['需求', '分析', 'requirement', '业务', '功能', '用户故事', '验收', '调研', '梳理', '拆解'],
    description: '分析需求、梳理业务、拆解验收标准'
  },
  'test-case-generator': {
    keywords: ['用例', '测试用例', 'test case', 'case', '场景', '测试场景', '用例集', '用例设计', '边界', '等价类'],
    description: '生成测试用例、设计测试场景'
  },
  'ai-app-tester': {
    // 只列「AI 应用特有」的词，避免把普通用例需求也抢过来——
    // 匹配逻辑是取命中数最多的智能体，「用例」不该算作 AI 应用的信号
    keywords: ['ai应用', 'ai测试', 'ai助手', '大模型', 'llm', 'rag', '知识库问答', '智能体', '幻觉', '提示注入', '越狱', 'gpt', 'deepseek'],
    description: '测试 AI 应用：幻觉、提示注入、输出一致性、RAG 召回、工具调用合规'
  },
  'test-data-generator': {
    keywords: ['数据', '测试数据', 'test data', '数据集', '造数', '生成数据', '造数据', '数据准备', '数据生成'],
    description: '准备测试数据、构造测试数据集'
  },
  'defect-analyzer': {
    keywords: ['缺陷', 'bug', 'defect', '问题', '分析', '报告', '复现', '定位', '排查', '根因'],
    description: '分析缺陷、定位 bug、生成缺陷报告'
  },
  'api-executor': {
    keywords: ['接口', 'API', 'api', '接口测试', '接口自动化', '接口用例', 'http', 'restful', '调接口', '联调'],
    description: '执行接口测试、接口自动化'
  },
  'ui-e2e-executor': {
    keywords: ['UI', 'E2E', '页面', '前端', '界面', 'e2e', 'UI测试', '端到端', 'Web', '点击', '浏览器'],
    description: '执行 UI/E2E 测试、页面自动化'
  },
  'test-reporter': {
    keywords: ['报告', '测试报告', 'report', '汇总', '总结', '报告生成', '输出报告', '结果报告', '统计', '缺陷报告'],
    description: '生成测试报告、汇总测试结果'
  },
  'data-masking': {
    keywords: ['脱敏', '脱敏处理', 'mask', '数据脱敏', '敏感', '加密', '匿名', '水印', '个人信息', '隐私'],
    description: '处理数据脱敏、保护敏感信息'
  },
  'test-scheme-generator': {
    keywords: ['方案', '测试方案', '策略', '计划', '测试策略', '方案设计', '测试计划', '设计', '规划', '架构'],
    description: '设计测试方案、制定测试策略'
  },
  'security-sentinel': {
    keywords: ['安全', '漏洞', '扫描', '渗透', 'xss', 'sql', '注入', 'owasp', '安全测试', '安全扫描'],
    description: '执行漏洞扫描、渗透测试、OWASP Top 10 检测'
  },
  'performance-tester': {
    keywords: ['性能', '压测', '负载', '并发', 'tps', '响应时间', 'rt', 'jmeter', 'k6', 'locust', '性能测试'],
    description: '执行性能压测、负载测试、瓶颈分析、TPS/RT 评估'
  }
}

// 获取智能体中文名称
function getAgentChineseName(agent: any): string {
  if (!agent) return ''
  return AGENT_NAME_MAP[agent.id] || agent.name || agent.id
}

// 查找与输入文本最匹配的智能体(返回包含最多匹配关键词的智能体)
function findBestMatchingAgent(inputText: string, excludeAgentId: string) {
  const lowerInput = inputText.toLowerCase()
  let best: { id: string; name: string; description: string; matchCount: number } | null = null

  for (const [agentId, config] of Object.entries(AGENT_KEYWORDS)) {
    if (agentId === excludeAgentId) continue
    const matchCount = config.keywords.filter(kw => lowerInput.includes(kw.toLowerCase())).length
    if (matchCount > 0 && (!best || matchCount > best.matchCount)) {
      best = {
        id: agentId,
        name: AGENT_NAME_MAP[agentId] || agentId,
        description: config.description,
        matchCount
      }
    }
  }

  return best
}

// 可选智能体列表(排除主控和审核)
const availableAgents = computed(() => {
  return store.agents.filter((a: any) => !EXCLUDED_AGENTS.includes(a.id))
})

// 当前选中的智能体(从 localStorage 恢复,保持页面切换前的选择)
const selectedAgentId = ref<string>(
  localStorage.getItem('selectedAgentId') || 'test-requirement-analyzer'
)

// ── 意图确认（2026-11-20）──
// 后端判断「这次要做什么」不清楚时不创建任务，返回 3 个候选；
// 这里保存待确认的输入，用户选定后再提交。
const intentDialogVisible = ref(false)
const intentSubmitting = ref(false)
const pendingIntent = ref<{
  input: string
  files: any[] | undefined
  agentId: string
  reason: string
  candidates: any[]
} | null>(null)
// 上一次问答的 askId：用户连续追问时带上它，模型才能接上上下文
const lastAskId = ref<string | null>(null)

// 当前选中的智能体对象
const selectedAgent = computed(() => {
  return store.agents.find((a: any) => a.id === selectedAgentId.value) || null
})

// 是否有任务正在执行(用于控制智能体选择器禁用状态)
const hasRunningTask = computed(() => {
  // 优先使用 store 中的运行中任务数量
  if (store.runningCount > 0) return true
  // 备用:检查 currentRunningTaskId
  return !!currentRunningTaskId.value
})

// 监听选中智能体变化,自动保存/恢复消息

watch(selectedAgentId, async (newAgentId) => {
  // 保存到 localStorage,保持页面切换前的选择
  localStorage.setItem('selectedAgentId', newAgentId)
  // 更新 currentAgent(自动保存当前消息到 messagesByAgent,恢复新智能体的消息)
  const agent = store.agents.find((a: any) => a.id === newAgentId)
  if (agent) {
    store.setCurrentAgent(agent)
  }
  // 加载新智能体的历史(仅补充,不覆盖已恢复的消息)
  if (newAgentId) {
    await store.loadConversationHistory(newAgentId, 50)
    // 【串台修复-草案A】切换智能体时，重新加载该智能体自己的最近任务结果
    // （只过滤本智能体，不再把安全/性能等其它智能体任务混进当前对话流）
    await store.loadRecentTaskResults(5, newAgentId)
  }
})

// 当前任务输入
const taskInput = ref('')

// 当前运行的任务ID
const currentRunningTaskId = ref<string | null>(null)

// 多轮对话续写模式：{ taskId, taskName } | null
const chatMode = ref<{ taskId: string; taskName: string } | null>(null)

// 聊天面板引用：变更计划确认后需要回调 markPlanDone 解除 loading（2026-11-25）
const chatPanelRef = ref<any>(null)

// 进入多轮对话续写模式（点选历史任务卡片触发）
// enterChatMode: 进入指定任务的对话续写模式（手动点历史任务卡片触发，@start-chat 调用）
// autoEnter 保留为兼容参数：true 表示不清空已有消息（保留任务输出），默认 false
async function enterChatMode(task: any, autoEnter = false) {
  const taskId = task.id || task.taskId
  const agentId = task.agent || task.agentId
  const taskName = task.type || task.agent || task.agentId || task.taskName || '历史任务'
  chatMode.value = { taskId, taskName }
  // 同步智能体下拉锁定到该历史任务的 agent（对话模式不可切换智能体）
  selectedAgentId.value = agentId
  try { localStorage.setItem('selectedAgentId', agentId || '') } catch (_) {}
  // 自动进入（任务刚完成）不清空消息，保留任务输出；手动选历史任务才清空并恢复 chat_history
  if (!autoEnter) {
    store.clearMessages()
  }
  try {
    const history = task.chat_history ? JSON.parse(task.chat_history) : []
    if (Array.isArray(history)) {
      history.forEach((h: any, i: number) => {
        store.messages.push({
          id: `hist-${i}`,
          role: h.role === 'user' ? 'user' : 'assistant',
          type: h.role === 'user' ? 'user' : 'agent',
          content: h.content || '',
          timestamp: h.timestamp || new Date().toISOString(),
          versionLabel: h.versionLabel || ''
        })
      })
    }
  } catch (_) { /* 历史解析失败忽略 */ }

  // 【修复】手动继续对话时，把该任务自身的生成结果（历史信息核心）也加载进面板。
  // 否则单轮任务 chat_history 为空，面板会一片空白，用户看不到历史任务的产出内容。
  const taskOutput = task.output || (typeof task.result === 'string' ? task.result : (task.result ? JSON.stringify(task.result) : ''))
  if (taskOutput) {
    const msgId = `loaded-task-${taskId}`
    if (!store.messages.find((m: any) => m.id === msgId)) {
      store.messages.push({
        id: msgId,
        role: 'assistant',
        type: 'agent',
        content: `任务 ${taskId} 完成\n\n${taskOutput}`,
        timestamp: task.completedAt || task.updatedAt || task.createdAt || new Date().toISOString(),
        agentId,
        agentName: task.agentName || agentId,
        artifacts: (Array.isArray(task.artifacts) && task.artifacts.length) ? task.artifacts : undefined
      })
    }
    // 异步补全交付物卡片（md/docx/xlsx）：任务列表不含 artifacts，按需拉详情接口
    if (!(Array.isArray(task.artifacts) && task.artifacts.length)) {
      try {
        const detail = await taskApi.getById(taskId)
        if (detail && Array.isArray(detail.artifacts) && detail.artifacts.length) {
          const m = store.messages.find((x: any) => x.id === msgId)
          if (m) m.artifacts = detail.artifacts
        }
      } catch (_) { /* 详情拉取失败忽略，退化为纯文本 */ }
    }
  }
  ElMessage.success(`已进入「${chatMode.value.taskName}」的对话模式，可继续补充需求或修改交付物`)
}

// 退出对话模式
function exitChatMode() {
  chatMode.value = null
  store.clearMessages()
}

// 定期检查执行状态,确保与后端同步(防止 SSE 事件丢失导致状态不一致)
let taskCheckInterval: ReturnType<typeof setInterval> | null = null

// 检查当前是否有运行中的任务
async function checkRunningTask() {
  try {
    // 直接从后端获取执行状态（使用统一认证头）
    const resp = await request<{ hasExecutingTask: boolean; taskId?: string }>('/api/auth/executing-task')
    console.log(`[checkRunningTask] resp=${JSON.stringify(resp.data)}`)
    if (resp.success && resp.data) {
      if (resp.data.hasExecutingTask) {
        currentRunningTaskId.value = resp.data.taskId ?? null
      } else {
        currentRunningTaskId.value = null
        // 如果检测到没有运行中任务,刷新任务列表以确保状态一致
        await store.loadTasks()
      }
    } else if (resp.error?.includes('401') || resp.error?.includes('未授权')) {
      console.warn('[Dashboard] 执行状态检查未授权（token 可能已过期）')
      currentRunningTaskId.value = null
    }
  } catch (error) {
    console.warn('[Dashboard] 检查运行状态失败:', error)
  }
}

// 监听任务列表变化,自动跟踪运行中的任务
watch(() => store.tasks, (newTasks) => {
  const myId = store.user?.id
  // [ISOLATION] 严格按当前用户过滤，避免看到他人在跑的任务导致误禁用
  const runningTask = newTasks.find((t: any) => t.status === 'running' && (!myId || t.userId === myId))
  if (runningTask) {
    console.log(`[watch tasks] set currentRunningTaskId=${runningTask.id} userId=${runningTask.userId} myId=${myId}`)
    currentRunningTaskId.value = runningTask.id
  } else {
    currentRunningTaskId.value = null
  }
}, { deep: true })

// 【平台瘦身 2026-10-14】顶部统计卡片移除后，stats computed 与 formatUptime 已无使用场景，一并删除。






/**
 * 判断这次提交应该「问」还是「做」
 *
 * 与后端 detectActionKind 保持同一套判断（有疑问句式 + 无明确产出动作）。
 * 前端先判一次是为了**不让用户白等**：如果判成提问却先建了任务，
 * 用户要等几十秒才发现系统在生成 14 万字，而他只想问一句话。
 *
 * 保守起见只在「明显是提问」时返回 true：
 *   - 带附件 → 一律走生成（用户传材料基本是要产出东西）
 *   - 含明确产出动作（生成/设计/分析/执行/写一份…）→ 走生成
 *   - 只有疑问句式且无产出动作 → 提问
 *
 * 实测漏判过两类，已补：
 *   「这个需求该怎么测才好」——「怎么测」不在原正则里，被当成生成任务
 *   「有什么遗漏吗」        —— 只有句尾「吗」没有疑问词，被当成生成任务
 */
function shouldAskInsteadOfGenerate(text: string, hasFiles = false): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  if (hasFiles) return false
  const isQuestion = /[?？]\s*$/.test(t)
    // 「吗/呢」结尾几乎必是提问（「有什么遗漏吗」「这样对吗」）
    || /[吗呢]\s*[?？]?\s*$/.test(t)
    || /为什么|为啥|怎么没|怎么回事|什么原因|是不是|是否|能否|可否|如何|怎么(样|做|办|测|写|选|判|改)|哪里|哪儿|有没有|有什么|有哪些|解释|对不对|行不行/.test(t)
  const hasAction = /生成|产出|输出|写一?份|做一?份|设计|创建|新建|补充|整理|汇总|分析|执行|跑一?遍|测一?下|重写|改成|改为/.test(t)
  return isQuestion && !hasAction
}

/**
 * 以「提问」方式提交
 *
 * 走 /api/ask：不创建任务、不落交付物、不占串行锁。
 * 问答的实时进度与最终回答都通过 SSE 的 chat_message / agent_stream_* 回来，
 * 消息面板无需特殊处理即可显示。
 */
async function submitAsQuestion(text: string, files?: AttachmentFile[]) {
  const displayMessage = files && files.length > 0
    ? text + '\n\n' + describeAttachments(files)
    : text
  store.messages.push({
    id: Date.now().toString(),
    role: 'user',
    type: 'user',
    content: displayMessage,
    timestamp: new Date().toISOString(),
  })
  taskInput.value = ''
  store.isLoading = true
  try {
    const res = await taskApi.ask(text, {
      // 优先用用户当前选中的智能体；没选就让后端按问题内容自动判断
      agent: selectedAgentId.value || undefined,
      attachments: files && files.length ? toAttachmentPayloads(files) : undefined,
      continueAskId: lastAskId.value || undefined,
    })
    if (!res.success) {
      ElMessage.error(res.error || '提问失败')
      return
    }
    lastAskId.value = res.askId || null
  } catch (e: any) {
    ElMessage.error('提问失败：' + (e?.message || e))
  } finally {
    store.isLoading = false
  }
}

/**
 * 找「可以继续修改」的上一份任务
 *
 * 判据：同属一个用户、已产出交付物（result 有实质内容）、状态不是失败。
 * 优先当前选中智能体最近的一份；没有就退到「任意智能体最近一份」——
 * 用户说「继续优化」时心里的对象是上一次看到的交付物，不一定是当前下拉里选的智能体。
 *
 * 不取正在运行的任务：它还没产出，拿去对话没有可改的对象。
 */
function findContinuableTask(): any | null {
  const usable = (store.tasks || []).filter((t: any) => {
    if (!t) return false
    if (String(t.id || '').startsWith('loaded-task-')) return false
    if (t.status === 'running' || t.status === 'pending') return false
    const result = String(t.result || '')
    return result.length > 200
  })
  if (!usable.length) return null
  const sameAgent = usable.find((t: any) => (t.agentId || t.agent) === selectedAgentId.value)
  return sameAgent || usable[0]
}

/**
 * 进入指定任务的对话模式，并把这条指令直接发出去
 *
 * 用户点「好，在原任务里继续修改」后，不该再让他手动点一次发送——
 * 他已经表达完意图了。这里复用 enterChatMode + taskApi.sendChat，
 * 与手动进入对话后的发送走同一条链路（历史上限、版本号、质量复检都在后端）。
 */
async function enterChatModeAndSend(task: any, message: string) {
  await enterChatMode(task, false)
  const taskId = task.id || task.taskId
  // 面板上要有这条用户消息，否则用户看不到自己刚发的内容
  store.messages.push({
    id: Date.now().toString(),
    role: 'user',
    type: 'user',
    content: message,
    timestamp: new Date().toISOString(),
  })
  taskInput.value = ''
  try {
    const res = await taskApi.sendChat(taskId, message, [])
    if (!res.success) ElMessage.error(res.error || '对话发送失败')
  } catch (e: any) {
    ElMessage.error('对话发送失败：' + (e?.message || e))
  }
}

// 发送任务(发送给当前选中的智能体)
// files: 附件列表（可选）
// inputOverride: 来自子组件的当前输入值（用于解决 v-model 与 emit 的时序问题）
/**
 * 执行已确认的变更计划（2026-11-25 · 对话改造第一步）
 *
 * 用户勾选清单后走这里：把 planId + 裁剪过的 plan + 原指令一起发给后端。
 * 后端校验 planId 归属，然后把勾选项转成执行意图，仍然调用同一个智能体
 * （spawnAgentSession）干活——这里只是多了一次「确认」，不改变执行者。
 */
async function handlePlanConfirm(payload: { planId: string; plan: any; message: string }) {
  const chatPanel = chatPanelRef.value as any
  const taskId = chatMode.value?.taskId
  if (!taskId) {
    ElMessage.warning('当前不在对话模式，无法执行变更计划')
    chatPanel?.markPlanDone?.(payload.planId)
    return
  }
  try {
    const res = await taskApi.sendChat(taskId, payload.message, [], {
      planId: payload.planId,
      confirmedPlan: payload.plan,
    })
    if (!res.success) {
      const err = String(res.error || '')
      // 计划过期（服务重启）时明确告诉用户重发，不要让他反复点
      if (err.includes('计划已过期') || (res as any).code === 'PLAN_EXPIRED') {
        ElMessage.warning('变更计划已过期，请重新发送指令')
      } else {
        ElMessage.error(err || '执行变更计划失败')
      }
    } else {
      ElMessage.success(`已按 ${payload.plan?.items?.length || 0} 项变更开始执行`)
    }
  } catch (e: any) {
    ElMessage.error('执行变更计划失败：' + (e?.message || e))
  } finally {
    chatPanel?.markPlanDone?.(payload.planId)
  }
}

async function handleSendTask(files?: AttachmentFile[], inputOverride?: string) {
  // 使用 inputOverride（如果提供），否则使用 taskInput（兼容旧调用方式）
  const taskInputValue = inputOverride ?? taskInput.value
  
  // ========== 预检查 0: 是否已登录 ==========
  if (!store.token) {
    ElMessage.error('请先登录后再提交任务')
    return
  }

  // ========== 多轮对话续写模式（继续对话历史任务）==========
  if (chatMode.value) {
    const taskId = chatMode.value.taskId
    let chatDisplay = taskInputValue
    // 附件只传 base64，解析交给后端统一处理（保留表格结构）
    const chatFiles: AttachmentPayload[] = []
    if (files && files.length > 0) {
      const names = describeAttachments(files)
      chatDisplay = chatDisplay ? chatDisplay + '\n\n' + names : names
      chatFiles.push(...toAttachmentPayloads(files))
    }
    if (!taskInputValue.trim() && chatFiles.length === 0) return
    store.messages.push({ id: Date.now().toString(), role: 'user', type: 'user', content: chatDisplay, timestamp: new Date().toISOString() })
    taskInput.value = ''
    try {
      const res = await taskApi.sendChat(taskId, taskInputValue, chatFiles)
      if (!res.success) ElMessage.error(res.error || '对话发送失败')
      // 后端可能只返回变更计划而不执行——那种情况下会通过 SSE 推来
      // chat_message(type=change_plan) 卡片，用户确认后才真正执行。
      // 接口本身无法预知（要不要规划在异步里判定），所以这里不做提示，
      // 由卡片自己表达「打算改这些、请确认」。
    } catch (e: any) { ElMessage.error('对话发送失败：' + (e?.message || e)) }
    return
  }

  

console.log('[Dashboard] handleSendTask called', {
    taskInput: taskInputValue,
    filesCount: files?.length || 0,
    selectedAgentId: selectedAgentId.value,
    currentRunningTaskId: currentRunningTaskId.value
  })

  if (!taskInputValue.trim() && (!files || files.length === 0)) {
    console.log('[Dashboard] Early return: empty input')
    return
  }

  // ========== 提问分流（2026-11-20）==========
  //
  // 用户在提交框里问「这个需求该怎么测」时，不该创建任务跑一次完整生成：
  // 那会产出一个任务记录 + 一份交付物 + 三审，白等十几分钟，还污染任务列表。
  // 判成纯提问就改走轻量问答通道（/api/ask，不建任务、不落交付物）。
  //
  // 判断条件是「有疑问句式且没有明确的产出动作」，与后端 detectActionKind 一致：
  //   「这个需求该怎么测」→ 问       「帮我生成登录功能的用例」→ 产出
  //   「为什么没覆盖到？」→ 问        「为什么没覆盖，重新生成」→ 产出（有动作）
  if (shouldAskInsteadOfGenerate(taskInputValue, !!(files && files.length))) {
    await submitAsQuestion(taskInputValue, files)
    return
  }

  // 「在上一份交付物上继续改」的指令分流（2026-11-17 起，2026-11-23 重做）
  //
  // 实测两次踩坑：
  //   - 「重新生成刚才那份需求的用例」（13 字）直接提交 → 新任务里没有需求原文，
  //     模型只能回「需求缺失」，白跑 3.5 分钟；
  //   - 「…从审核结果看，该用例还有优化空间，继续优化」（192 字）→ 用户想针对
  //     上一份交付物做优化，结果新建任务从需求重跑了一遍，耗时更长，
  //     且本来满意的部分可能被改坏。
  //
  // 原实现只弹一个「要不要新建」的提示，用户点了「去对话修改」还得自己去历史里
  // 找那个任务——路径太长，实测用户会直接点「仍要新建」。
  // 现在识别到改稿指令时**直接送他进上一份任务的对话模式并把这句发过去**。
  // 续做/改稿指令识别
  //
  // 2026-11-23 二次修正：靠穷举动词永远补不完。实测连续漏了两次：
  //   「…还有优化空间，继续优化」（词表没有「继续优化」）
  //   「优化完要输出交付物」（词表有「优化一下」，但没有「优化完」）
  // 现在改为**模式识别**：出现改稿动词就认为是「对已有产出的动作」。
  //
  // 误判防护：像「优化登录接口性能，关注 TPS 和响应时间，需要压测报告」这种
  // 明显是新需求描述。用长度做粗筛——改稿指令通常很短（它只描述"改什么"），
  // 完整需求描述通常较长（它要描述"做什么"）。判错也只是弹一次确认框，
  // 用户可以直接选「我要新建任务」，不会造成事实错误。
  const REVISE_VERB = /优化|改进|完善|修订|调整|改一下|改改|再改|重写|改写|润色|补充|精简|细化/
  const REVISE_REF = /刚才|刚刚|上面|之前|上次|上一个|前一个|那份|这份|重新生成|再生成|再来一次|重做|重跑|继续|接着|在此基础上|基于上面|基于刚才|针对上面|针对这份/
  const trimmedInput = taskInputValue.trim()
  const isRevisionInstruction = REVISE_REF.test(trimmedInput)
    || (REVISE_VERB.test(trimmedInput) && trimmedInput.length <= 80)
  if (isRevisionInstruction && (!files || files.length === 0)) {
    const prevTask = findContinuableTask()
    if (prevTask) {
      let goToChat = false
      try {
        await ElMessageBox.confirm(
          `这看起来是要在上一份交付物上继续修改：\n"${taskInputValue.trim().slice(0, 120)}${taskInputValue.trim().length > 120 ? '…' : ''}"\n\n` +
          `将切换到任务 ${String(prevTask.id).slice(0, 8)} 的对话模式继续。\n` +
          '对话模式会带上完整需求原文、已有交付物和审核意见，只改该改的地方，耗时更短也不容易改坏。',
          '检测到这是「继续修改」指令',
          {
            confirmButtonText: '好，在原任务里继续修改',
            cancelButtonText: '我要新建任务',
            type: 'warning',
            distinguishCancelAndClose: true,
          },
        )
        goToChat = true
      } catch {
        // cancel = 明确选「新建任务」；close = 关弹窗
        // 两种情况都按「新建任务」走，但「继续优化」类指令新建时必须注入上下文（后端已处理）
        goToChat = false
      }
      if (goToChat) {
        await enterChatModeAndSend(prevTask, taskInputValue)
        return
      }
    } else {
      ElMessage.info('没找到可继续修改的历史任务，将作为新任务提交')
    }
  }

  const targetAgentId = selectedAgentId.value
  console.log('[Dashboard] 下拉框偏好:', targetAgentId, '（实际执行哪个由输入内容决定）')

  // 注：这里原本有一个「输入与下拉框智能体不匹配」的确认弹窗，2026-11-23 移除。
  // 现在提交走 intentDriven——由输入内容决定执行哪个智能体，下拉框只是弱偏好，
  // 「下拉框跟输入不匹配」不再是问题。再弹一次只会白打扰用户，
  // 还会让人误以为「必须先选对下拉框」（这正是之前意图识别形同虚设的原因之一）。

  // ========== 预检查 2:查询后端确认是否有正在执行的任务 ==========
  try {
    const executingRes = await request<{ hasExecutingTask: boolean; taskId?: string }>('/api/auth/executing-task')
    if (executingRes.success && executingRes.data?.hasExecutingTask) {
      ElMessage.warning({
        message: `您有一个任务正在执行中(${executingRes.data.taskId?.substring(0, 8)}...),请等待完成后再发起新任务`,
        duration: 5000
      })
      return
    }
  } catch (e) {
    console.warn('[Dashboard] 检查执行状态失败:', e)
    // 继续尝试创建任务
  }

  // 构建显示消息和附件内容
  let displayMessage = taskInputValue
  // 附件只传 base64，解析交给后端统一处理（保留表格结构、按 token 预算裁剪）
  let filesToSubmit: AttachmentPayload[] = []

  if (files && files.length > 0) {
    const names = describeAttachments(files)
    displayMessage = displayMessage ? displayMessage + '\n\n' + names : names
    filesToSubmit = toAttachmentPayloads(files)
  }

  const fullMessage = taskInputValue

  // 检查是否有任务正在执行
  if (currentRunningTaskId.value) {
    // 有任务正在执行：发送消息到该任务
    try {
      const res = await request<{ error?: string }>(`/api/tasks/${currentRunningTaskId.value}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: fullMessage })
      })

      if (res.success) {
        // 将用户消息添加到消息列表（显示用消息，不含文件解析内容）
        const userMessage: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          type: 'user',
          content: displayMessage,
          timestamp: new Date().toISOString()
        }
        store.messages.push(userMessage)
        taskInput.value = ''
        ElMessage.success('消息已发送给智能体')
      } else {
        if (res.error?.includes('404') || res.error?.includes('任务未在运行中')) {
          // 任务已不存在或已结束，清除 stale ID 并回退创建新任务
          currentRunningTaskId.value = null
          ElMessage.warning('原任务已结束，已为您创建新任务')
          const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            type: 'user',
            content: displayMessage,
            timestamp: new Date().toISOString()
          }
          store.messages.push(userMessage)
          await store.createTask(targetAgentId, fullMessage, filesToSubmit, { source: 'step', intentDriven: true, type: targetAgentId })
          taskInput.value = ''
        } else {
          ElMessage.error(res.error || '发送消息失败')
        }
      }
    } catch (error) {
      ElMessage.error('发送消息失败：' + error)
    }
  } else {
    // 没有任务在执行：创建新任务，同时将用户消息添加到消息列表
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      type: 'user',
      content: displayMessage,
      timestamp: new Date().toISOString()
    }
    store.messages.push(userMessage)
    
    // 创建任务并处理可能的冲突错误（发送完整消息含文件内容）
    console.log('[Dashboard] Creating task with:', {
      targetAgentId,
      fullMessageLength: fullMessage.length,
      fullMessagePreview: fullMessage.substring(0, 100)
    })
    try {
      // intentDriven：由输入框内容决定执行哪个智能体，下拉框只是弱偏好。
      // 之前传 { type: targetAgentId } 是把 agentId 当任务类型传，等于绕开意图识别。
      const task = await store.createTask(targetAgentId, fullMessage, filesToSubmit, { source: 'step', intentDriven: true, type: targetAgentId })
      if (task === null) {
        // 创建失败（可能原因：网络异常 / 会话已过期）
        ElMessage.error('任务创建失败：网络异常或会话已过期，请重试')
        // 从消息列表移除刚才添加的用户消息
        const idx = store.messages.findIndex(m => m.id === userMessage.id)
        if (idx !== -1) store.messages.splice(idx, 1)
      }
    } catch (err: any) {
      // 意图不明确：后端没有创建任务，而是返回 3 个候选让用户定夺。
      // 保留用户消息在列表里（确认后直接重新提交，不用重新输入），弹出选择框。
      if (err.code === 'INTENT_CONFIRM_REQUIRED') {
        pendingIntent.value = {
          input: fullMessage,
          files: filesToSubmit,
          agentId: targetAgentId,
          reason: err.message,
          candidates: err.candidates || [],
        }
        intentDialogVisible.value = true
        return
      }
      // 处理后端返回的 409 冲突错误 / 其它创建失败(展示真实后端错误)
      if (err.code === 'TASK_CONFLICT') {
        ElMessage.warning({
          message: err.message || '同一用户同一时间只能执行一个任务',
          duration: 5000
        })
      } else {
        ElMessage.error('任务创建失败：' + (err?.message || '请稍后重试'))
      }
      // 从消息列表移除刚才添加的用户消息
      const idx = store.messages.findIndex(m => m.id === userMessage.id)
      if (idx !== -1) store.messages.splice(idx, 1)
    }
    taskInput.value = ''
  }
}

/**
 * 用户在意图确认弹窗里选定了任务类型 → 按选定类型重新提交
 *
 * 用户输入与附件原样复用，不重新解析；提交成功后把弹窗里选的智能体
 * 也设置成当前选中项，避免下一次提交又被问一遍同样的问题。
 */
async function onIntentConfirmed(agentId: string) {
  const pending = pendingIntent.value
  if (!pending) return
  intentSubmitting.value = true
  try {
    selectedAgentId.value = agentId
    const task = await store.createTask(agentId, pending.input, pending.files, { source: 'step', type: agentId })
    if (task) {
      intentDialogVisible.value = false
      pendingIntent.value = null
      ElMessage.success(`已按「${AGENT_NAME_MAP[agentId] || agentId}」开始执行`)
    }
  } catch (err: any) {
    if (err.code === 'TASK_CONFLICT') {
      ElMessage.warning({ message: err.message || '同一用户同一时间只能执行一个任务', duration: 5000 })
    } else {
      ElMessage.error('任务创建失败：' + (err?.message || '请稍后重试'))
    }
  } finally {
    intentSubmitting.value = false
  }
}

function onIntentCancelled() {
  pendingIntent.value = null
  // 取消时把用户消息也清掉，保持面板与实际状态一致
  const idx = store.messages.length - 1
  if (idx >= 0 && store.messages[idx]?.role === 'user') store.messages.splice(idx, 1)
}


// 加载数据
onMounted(async () => {
  // SSE 连接已移至 App.vue 全局管理

  // 启动定期检查(每 3 秒检查一次,防止 SSE 事件丢失导致状态不一致)
  taskCheckInterval = setInterval(checkRunningTask, 3000)

  // 检查登录状态
  if (!store.isLoggedIn) {
    console.warn('[Dashboard] 用户未登录,跳转登录页')
    await router.push('/login')
    return
  }

  // 加载基础数据
  try {
    await Promise.all([
      store.loadAgents(),
      store.loadTasks(),
      store.loadKnowledgeDocs()
    ])
  } catch (error) {
    console.error('[Dashboard] 加载数据失败:', error)
    // 如果是 401 错误,跳转登录页
    if (error instanceof Error && error.message.includes('401')) {
      ElMessage.error('登录已过期,请重新登录')
      store.logout()
      await router.push('/login')
      return
    }
  }

  // 设置当前选中的智能体
  const agent = store.agents.find((a: any) => a.id === selectedAgentId.value)
  if (agent) {
    store.setCurrentAgent(agent)
  } else if (store.agents.length > 0) {
    store.setCurrentAgent(store.agents[0] ?? null)
  }

  // 加载选中智能体的历史会话消息显示在对话面板中
  await store.loadConversationHistory(selectedAgentId.value, 50)

  // 加载最近已完成任务的完整结果到 messages（刷新页面后恢复历史）
  // 【串台修复-草案A】只加载当前选中智能体的最近任务，避免混进其它智能体(如安全测试)的交付物
  await store.loadRecentTaskResults(5, selectedAgentId.value)

  // 检查当前是否有运行中的任务
  const runningTask = store.tasks.find((t: any) => t.status === 'running')
  if (runningTask) {
    currentRunningTaskId.value = runningTask.id
    console.log(`[Dashboard] Found running task: ${runningTask.id}`)
  }
})

// SSE 连接已移至 App.vue 全局管理

// 清理定时器
onUnmounted(() => {
  if (taskCheckInterval) {
    clearInterval(taskCheckInterval)
    taskCheckInterval = null
  }
})
</script>

<template>
  <div class="dashboard" data-testid="dashboard-page">
    <!-- 【平台瘦身 2026-10-14】顶部统计卡片（Agent总数/执行中/任务总数/已完成/知识库文档/运行时长）已移除。
         恢复方法：见 git 历史 494ef6b 之前的 DashboardView.vue（stats-grid 模板 + stats computed + StatCard）。 -->

    <!-- 智能体选择器 -->
    <div class="agent-selector pto-card pto-card--dense" :class="{ 'has-running-task': hasRunningTask }">
      <div class="pto-icon-tile pto-icon-tile--sm pto-icon-tile--indigo">
        <span class="material-symbols-outlined" style="font-size:16px">smart_toy</span>
      </div>
      <span class="selector-label">智能体</span>
      <el-select
        v-model="selectedAgentId"
        placeholder="请选择"
        class="agent-select"
        filterable
        :disabled="hasRunningTask || !!chatMode"
      >
        <el-option
          v-for="agent in availableAgents"
          :key="agent.id"
          :label="getAgentChineseName(agent) + ' (' + agent.id + ')'"
          :value="agent.id"
        >
          <div class="agent-option">
            <span class="agent-icon"><MsIcon :name="getAgentIcon(agent.id) || 'smart_toy'" :size="18" /></span>
            <span class="agent-name">{{ getAgentChineseName(agent) }}</span>
            <span class="agent-desc">{{ agent.description || agent.desc || '' }}</span>
          </div>
        </el-option>
      </el-select>
      <!-- 任务执行时显示提示 -->
      <span v-if="hasRunningTask" class="running-hint">
        <span class="pto-badge pto-badge--running">任务执行中</span>
      </span>
    </div>

    <!-- AI评估智能体提示 -->
    <div v-if="selectedAgentId === 'ai-evaluation-agent'" class="evaluation-hint">
      <el-alert type="info" :closable="false" show-icon>
        <template #title>
          使用 AI评估智能体 需要提供以下数据
        </template>
        <template #default>
          <div class="hint-content">
            <p>请提供以下信息之一:</p>
            <ul>
              <li><strong>智能体ID</strong> - 要评估的智能体标识</li>
              <li><strong>任务ID</strong> - 该智能体执行过的任务ID</li>
              <li><strong>任务输出内容</strong> - 智能体生成的输出文本</li>
            </ul>
            <p class="hint-note">评估将基于三层五级模型:能力层(30%) / 质量层(40%) / 业务价值层(30%)</p>
          </div>
        </template>
      </el-alert>
    </div>

    <!-- 任务对话区 -->
    <div class="chat-section" data-testid="chat-section">
      <!-- 任务执行提示 -->
      <div v-if="currentRunningTaskId" class="task-interaction-hint">
        <el-alert type="info" :closable="false" show-icon>
          <template #title>
            智能体正在执行任务
            <code>{{ currentRunningTaskId }}</code>
            ,您可以通过下方输入框发送消息与智能体实时交互
          </template>
        </el-alert>
      </div>

      <DashboardChatPanel
        ref="chatPanelRef"
        v-model="taskInput"
        :current-agent="selectedAgent"
        :messages="store.messages"
        :is-loading="store.isLoading"
        :chat-mode="chatMode"
        @send="handleSendTask"
        @clear="store.clearMessages()"
        @start-chat="enterChatMode"
        @exit-chat="exitChatMode"
        @plan-confirm="handlePlanConfirm"
      />

      <!-- 意图不明确时让用户三选一，而不是替用户猜一个智能体跑十几分钟 -->
      <IntentConfirmDialog
        v-model:visible="intentDialogVisible"
        :reason="pendingIntent?.reason || ''"
        :candidates="pendingIntent?.candidates || []"
        :loading="intentSubmitting"
        @confirm="onIntentConfirmed"
        @cancel="onIntentCancelled"
      />
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  min-height: calc(100vh - 84px);
  overflow-y: auto;
}

/* 【平台瘦身 2026-10-14】顶部统计卡片样式（stats-grid）已随模板一并移除 */

/* 智能体选择器样式 */
.agent-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: none;
  position: relative;
}
.agent-selector:hover {
  transform: none;
  box-shadow: var(--shadow-level-2);
  border-color: var(--border-strong);
}

/* 任务执行时禁用智能体选择器 */
.agent-selector.has-running-task::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  z-index: 1;
  pointer-events: none;
}

.selector-label {
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.agent-select {
  flex: 1;
  max-width: 400px;
}

.agent-select:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.running-hint {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.agent-select {
  flex: 1;
  max-width: 500px;
}

.agent-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-option .agent-icon {
  font-size: 20px;
}

.agent-option .agent-name {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.agent-option .agent-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-left: auto;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-section {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 500px;
  overflow: hidden;
}

.evaluation-hint {
  margin-top: 8px;
}

.evaluation-hint .hint-content {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.6;
}

.evaluation-hint .hint-content ul {
  margin: 8px 0;
  padding-left: 20px;
}

.evaluation-hint .hint-content li {
  margin: 4px 0;
}

.evaluation-hint .hint-note {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--el-color-info-light-9);
  border-radius: 4px;
  color: var(--el-text-color-secondary);
}


.agent-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-icon-large {
  font-size: 24px;
}

.agent-details {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.agent-name-large {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.agent-desc-small {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 1200px) {
  .agent-selector {
    flex-direction: column;
    align-items: flex-start;
  }

  .agent-select {
    max-width: 100%;
    width: 100%;
  }
}
</style>