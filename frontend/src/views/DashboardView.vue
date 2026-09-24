<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatCard from '@/components/StatCard.vue'
import DashboardChatPanel from '@/components/DashboardChatPanel.vue'
import type { AttachmentFile, ChatMessage } from '@/types'
import { getAuthHeaders, request, taskApi } from '@/api'

const store = useMainStore()
const router = useRouter()
// ===== 智能体下拉列表配置 =====
// 排除:test-master(主控)、ai-quality-reviewer-1/2/3(审核智能体)、ai-evaluation-agent(AI评估,改由「智能评估」菜单承载)、test-script-generator(改由自动化测试tab承载)、compatibility-coordinator(改由兼容性测试菜单承载)
const EXCLUDED_AGENTS = ['test-master', 'ai-quality-reviewer-1', 'ai-quality-reviewer-2', 'ai-quality-reviewer-3', 'security-sentinel', 'performance-tester', 'test-script-generator', 'compatibility-coordinator', 'ai-evaluation-agent']

// 智能体中文名称映射
const AGENT_NAME_MAP: Record<string, string> = {
  'test-requirement-analyzer': '需求分析',
  'test-case-generator': '测试用例生成',
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
// 【方案A】watch 监听 autoChatMode flag 变化（同 tab 内 SSE task_completed 触发）
// task_completed 在 main.ts 里写 localStorage，watchEffect 感知不到（same-tab），
// 所以用 watch(() => store.tasks) 检测已完成任务来触发
const autoChatModeChecked = ref(false)
watch(() => store.tasks, (newTasks) => {
  if (autoChatModeChecked.value) return
  const autoChatModeRaw = localStorage.getItem('__autoChatMode')
  if (!autoChatModeRaw) return
  try {
    const autoData = JSON.parse(autoChatModeRaw)
    // 检查该任务是否已在 store.tasks 中且已完成
    const matchedTask = newTasks.find((t: any) => t.id === autoData.taskId && (t.status === 'completed' || t.status === 'failed'))
    if (matchedTask) {
      autoChatModeChecked.value = true
      localStorage.removeItem('__autoChatMode')
      enterChatMode(autoData, true)
    }
  } catch (_) {}
}, { immediate: true })

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

// 进入多轮对话续写模式（点选历史任务卡片触发）
// enterChatMode: 兼容 task 对象（历史任务弹窗）和 {taskId,agentId,taskName} 对象（localStorage autoChatMode）
// autoEnter=true 表示由 task_completed 自动触发，不清空已有消息（保留任务输出）
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
        content: `✅ 任务 ${taskId} 完成\n\n${taskOutput}`,
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

// 使用 store 的 stats,如果为空则用静态计算
const stats = computed(() => {
  // 如果有实时统计数据,优先使用
  if (store.stats) {
    return [
      { icon: '🤖', value: store.stats.agents?.total ?? 0, label: 'Agent总数' },
      { icon: '⚡', value: store.stats.tasks?.running ?? 0, label: '执行中' },
      { icon: '📋', value: store.stats.tasks?.total ?? 0, label: '任务总数' },
      { icon: '✅', value: store.stats.tasks?.completed ?? 0, label: '已完成' },
      { icon: '📚', value: store.stats.knowledge?.docs ?? 0, label: '知识库文档' },
      { icon: '⏱️', value: store.stats.system?.uptime ? formatUptime(store.stats.system.uptime) : '-', label: '运行时长' }
    ]
  }
  // 回退到 store 计算属性
  return [
    { icon: '🤖', value: store.agentCount, label: 'Agent总数' },
    { icon: '⚡', value: store.runningCount, label: '执行中' },
    { icon: '📋', value: store.taskCount, label: '任务总数' },
    { icon: '✅', value: store.completedCount, label: '已完成' },
    { icon: '📚', value: store.knowledgeDocs.length, label: '知识库文档' },
    { icon: '⏱️', value: store.avgTaskTime || '-', label: '平均耗时' }
  ]
})

// 格式化运行时长
function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}小时${mins}分`
  }
  return `${mins}分钟`
}




// 读取附件内容的辅助函数(读取文件真实内容而非仅传文件名)
const TEXT_EXTS = ['.md', '.txt', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.properties', '.cfg', '.ini', '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.sql', '.sh', '.bat', '.ps1']

async function readAttachmentContent(file: AttachmentFile): Promise<string | null> {
  if (!file.dataUrl) {
    return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`
  }

  // 超大文件(>10MB)跳过内容读取,避免消息过大
  if (file.size > 10 * 1024 * 1024) {
    return `[附件: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) - 文件过大,已跳过内容读取]`
  }

  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()

  // 1. 文本文件:直接解码 base64 获取文本内容 (仅限纯文本格式)
  if (TEXT_EXTS.includes(ext)) {
    try {
      const base64 = file.dataUrl.split(',').pop() || ''
      const binaryStr = atob(base64)
      // 关键修复:atob 返回 Latin-1 二进制字符串(每个字符码点=UTF-8字节值)
      // 必须转回 UTF-8,否则中文会双重编码变成乱码(å¥1⁄2ç...)
      const decoded = new TextDecoder('utf-8').decode(
        Uint8Array.from(binaryStr, c => c.charCodeAt(0))
      )
      // 内容过长时截断
      const MAX_TEXT = 50000
      const truncated = decoded.length > MAX_TEXT ? decoded.substring(0, MAX_TEXT) + '\n\n... (内容过长,已截断,完整文件在后端路径)' : decoded
      return `=== ${file.name} (${(file.size / 1024).toFixed(1)}KB) ===\n\n\`\`\`\n${truncated}\n\`\`\``
    } catch (e) {
      console.warn('[Dashboard] 文本解码失败:', file.name, e)
    }
  }

  // 2. Word 文档:通过后端 API 解析
  if (['.docx', '.doc'].includes(ext)) {
    try {
      const base64 = file.dataUrl.split(',').pop() || ''
      const res = await request<{ success: boolean; text?: string }>('/api/parse/word', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, base64 })
      })
      if (res.success && res.data?.success && res.data?.text) {
        return `=== ${file.name} (已解析) ===\n\n${res.data.text}\n\n--- 文档解析完成 ---`
      }
      // 解析返回但内容为空
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析结果为空]`
    } catch (e) {
      console.warn('[Dashboard] Word 解析失败:', file.name, e)
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析失败: ${e}]`
    }
  }

  // 2.5 办公表格/文档(.xlsx/.xls/.pdf/.pptx/.ppt):走后端通用 /api/parse 解析
  //     与 test-script-generator 系统提示词承诺的 `=== 测试用例文档内容 ===` 标记保持一致,
  //     确保上传的 Excel/PDF 用例能被真正解析进输入,而非仅传文件名与大小占位。
  if (['.xlsx', '.xls', '.pdf', '.pptx', '.ppt'].includes(ext)) {
    try {
      const base64 = file.dataUrl.split(',').pop() || ''
      const res = await request<{ success: boolean; text?: string }>('/api/parse', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, base64 })
      })
      if (res.success && res.data?.success && res.data?.text) {
        const truncated = res.data.text.length > 50000
          ? res.data.text.substring(0, 50000) + '\n\n... (内容过长,已截断,完整文件在后端路径)'
          : res.data.text
        return `=== 测试用例文档内容 ===\n\n--- 文档 1: ${file.name} ---\n${truncated}`
      }
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析结果为空]`
    } catch (e) {
      console.warn('[Dashboard] 文档解析失败:', file.name, e)
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析失败: ${e}]`
    }
  }

  // 3. 图片:仅引用文件名(无法提取测试文本内容)
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) {
    return `[图片附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`
  }

  // 4. 其他类型:仅显示文件名
  return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`
}


// 发送任务(发送给当前选中的智能体)
// 发送任务(发送给当前选中的智能体)
// files: 附件列表（可选）
// inputOverride: 来自子组件的当前输入值（用于解决 v-model 与 emit 的时序问题）
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
    const chatFiles: { name: string; content: string }[] = []
    if (files && files.length > 0) {
      const names = files.map(f => `[附件: ${f.name} (${(f.size / 1024).toFixed(1)}KB)]`)
      chatDisplay = chatDisplay ? chatDisplay + '\n\n' + names.join('\n') : names.join('\n')
      for (const file of files) {
        const content = await readAttachmentContent(file)
        if (content !== null) chatFiles.push({ name: file.name, content })
      }
    }
    if (!taskInputValue.trim() && chatFiles.length === 0) return
    store.messages.push({ id: Date.now().toString(), role: 'user', type: 'user', content: chatDisplay, timestamp: new Date().toISOString() })
    taskInput.value = ''
    try {
      const res = await taskApi.sendChat(taskId, taskInputValue, chatFiles)
      if (!res.success) ElMessage.error(res.error || '对话发送失败')
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

  const targetAgentId = selectedAgentId.value
  console.log('[Dashboard] Target agent:', targetAgentId)

  // ========== 预检查 1: 检查输入与智能体是否匹配 ==========
  // 如果用户输入的指令关键词与所选智能体的能力不匹配,提示用户
  const agentKeywords = AGENT_KEYWORDS[targetAgentId]
  if (agentKeywords && taskInputValue.trim()) {
    const inputText = taskInputValue.trim().toLowerCase()
    const hasMatch = agentKeywords.keywords.some(kw => inputText.includes(kw.toLowerCase()))
    if (!hasMatch) {
      // 未匹配到任何关键词
      const agentName = getAgentChineseName({ id: targetAgentId })
      // 找出可能更合适的智能体
      const suggestedAgent = findBestMatchingAgent(inputText, targetAgentId)
      const suggestion = suggestedAgent
        ? `\n\n您可能想选择:[${suggestedAgent.name}] (适用于${suggestedAgent.description})`
        : ''

      try {
        await ElMessageBox.confirm(
          `您选择的智能体是 [${agentName}],主要用于${agentKeywords.description}。\n\n您的输入:\n"${taskInputValue.substring(0, 100)}${taskInputValue.length > 100 ? '...' : ''}"\n\n未检测到与该智能体相关的关键词。${suggestion}\n\n请确认:\n• 是:继续提交给 [${agentName}]\n• 否:取消提交,请检查智能体选择`,
          '输入与智能体不匹配',
          {
            confirmButtonText: '仍然提交',
            cancelButtonText: '取消',
            type: 'warning',
            distinguishCancelAndClose: true,
            dangerouslyUseHTMLString: false
          }
        )
        // 用户选择"仍然提交",继续流程
      } catch {
        // 用户取消
        console.log('[Dashboard] 用户取消提交 - 输入与智能体不匹配')
        return
      }
    }
  }

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
  let filesToSubmit: { name: string; content: string }[] = []

  if (files && files.length > 0) {
    const fileNames = files.map(f => `[附件: ${f.name} (${(f.size / 1024).toFixed(1)}KB)]`)
    displayMessage = displayMessage
      ? displayMessage + '\n\n' + fileNames.join('\n')
      : fileNames.join('\n')

    // 统一走 readAttachmentContent：文本文件直接解码、docx 走后端 /api/parse/word 解析
    for (const file of files) {
      const content = await readAttachmentContent(file)
      if (content === null) {
        console.warn('[Dashboard] 跳过无 dataUrl 的文件:', file.name)
        continue
      }
      filesToSubmit.push({ name: file.name, content })
    }
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
          await store.createTask(targetAgentId, fullMessage, filesToSubmit, { source: 'step', type: targetAgentId })
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
      const task = await store.createTask(targetAgentId, fullMessage, filesToSubmit, { source: 'step', type: targetAgentId })
      if (task === null) {
        // 创建失败（可能原因：未登录 / 401 / 后端错误）
        ElMessage.error('任务创建失败，请确认已登录且会话未过期')
        // 从消息列表移除刚才添加的用户消息
        const idx = store.messages.findIndex(m => m.id === userMessage.id)
        if (idx !== -1) store.messages.splice(idx, 1)
      }
    } catch (err: any) {
      // 处理后端返回的 409 冲突错误
      if (err.code === 'TASK_CONFLICT') {
        ElMessage.warning({
          message: err.message || '同一用户同一时间只能执行一个任务',
          duration: 5000
        })
        // 从消息列表移除刚才添加的用户消息
        const idx = store.messages.findIndex(m => m.id === userMessage.id)
        if (idx !== -1) store.messages.splice(idx, 1)
      } else {
        ElMessage.error('创建任务失败：' + (err.message || err))
      }
    }
    taskInput.value = ''
  }
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

  // 【方案A】任务完成后自动进入对话模式：检查 localStorage 中的 autoChatMode 标记
  // 由 main.ts task_completed handler 写入，view 读取后自动跳入 chatMode
  const autoChatModeRaw = localStorage.getItem('__autoChatMode')
  if (autoChatModeRaw) {
    try {
      const autoData = JSON.parse(autoChatModeRaw)
      // 5分钟内有效，防止刷新页面后遗留标记仍然触发
      if (Date.now() - (autoData.timestamp || 0) < 5 * 60 * 1000) {
        enterChatMode(autoData, true)
      }
    } catch (_) {}
    localStorage.removeItem('__autoChatMode')
  }

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
    <!-- 统计卡片 -->
    <div class="stats-grid" data-testid="stats-grid">
      <StatCard
        v-for="(stat, index) in stats"
        :key="index"
        :icon="stat.icon"
        :value="stat.value"
        :label="stat.label"
      />
    </div>

    <!-- 智能体选择器 -->
    <div class="agent-selector" :class="{ 'has-running-task': hasRunningTask }">
      <span class="selector-label">智能体:</span>
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
            <span class="agent-icon">{{ agent.icon || '🤖' }}</span>
            <span class="agent-name">{{ getAgentChineseName(agent) }}</span>
            <span class="agent-desc">{{ agent.description || agent.desc || '' }}</span>
          </div>
        </el-option>
      </el-select>
      <!-- 任务执行时显示提示 -->
      <span v-if="hasRunningTask" class="running-hint">
        <el-tag type="warning" effect="plain" size="small">
          ⚡ 任务执行中,请等待完成后切换
        </el-tag>
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
        v-model="taskInput"
        :current-agent="selectedAgent"
        :messages="store.messages"
        :is-loading="store.isLoading"
        :chat-mode="chatMode"
        @send="handleSendTask"
        @clear="store.clearMessages()"
        @start-chat="enterChatMode"
        @exit-chat="exitChatMode"
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

.stats-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  flex-shrink: 0;
}

/* 智能体选择器样式 */
.agent-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  position: relative;
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
  .stats-grid {
    grid-template-columns: repeat(3, 1fr);
  }

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