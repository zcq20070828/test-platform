<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Monitor } from '@element-plus/icons-vue'
import { useMainStore } from '@/stores/main'
import { performanceTestApi } from '@/api'
import DashboardChatPanel from '@/components/DashboardChatPanel.vue'
import type { AttachmentFile } from '@/types'

// ⚡ 性能测试「测试执行」tab —— 两栏格局（左：执行方式+用户输入；右：实时输出）
// 逻辑沿用 DomainTestExecutor 的性能分支，下拉保持 7 阶段 + 完整工作流。

const ICON = '⚡'
const LABEL = '性能测试'

const STAGES: string[] = [
  '需求分析', '方案制定', '场景设计', '脚本实现', '执行压测', '瓶颈分析', '报告生成',
]

interface Entry {
  key: string
  name: string
  desc: string
  stageIdx: number | undefined
  isFull: boolean
}
const entries = computed<Entry[]>(() => {
  const list: Entry[] = STAGES.map((name, idx) => ({
    key: `stage-${idx}`,
    name: `${ICON} ${LABEL}·${name}`,
    desc: `执行第 ${idx + 1} 阶段：${name}`,
    stageIdx: idx,
    isFull: false,
  }))
  list.push({
    key: 'full',
    name: `${ICON} ${LABEL}·完整工作流`,
    desc: `自动串联全部 ${STAGES.length} 个阶段`,
    stageIdx: undefined,
    isFull: true,
  })
  return list
})

const selectedKey = ref<string>('')
const selected = computed<Entry | null>(() => entries.value.find((e) => e.key === selectedKey.value) || null)

const target = ref('')
const description = ref('')
const files = ref<AttachmentFile[]>([])
const submitting = ref(false)

const mainStore = useMainStore()
const currentWorkflowId = ref('')
const PERF_WF_HISTORY_KEY = 'perf_executor_current_wf'

// 从历史消息中找出最近一次性能测试工作流 ID（perf-wf- / perf-single-）
function findLatestPerfWorkflowId(): string {
  const all = [...(mainStore.workflowMessages || []), ...(mainStore.messages || [])]
  const perfIds: string[] = []
  for (const m of all) {
    const wid = (m as any).workflowId as string | undefined
    if (wid && (wid.startsWith('perf-wf-') || wid.startsWith('perf-single-'))) {
      if (!perfIds.includes(wid)) perfIds.push(wid)
    }
  }
  return perfIds[perfIds.length - 1] || ''
}

// 组件挂载时恢复上次选中的性能工作流，使实时面板回显历史信息
onMounted(() => {
  const saved = localStorage.getItem(PERF_WF_HISTORY_KEY) || ''
  const live = findLatestPerfWorkflowId()
  const wid = live || saved
  if (wid) currentWorkflowId.value = wid
})

// 合并主 store 的 messages + workflowMessages，按 workflowId 精确过滤、去重
const workflowEvents = computed(() => {
  const wid = currentWorkflowId.value
  if (!wid) return []
  const all = [...(mainStore.messages || []), ...(mainStore.workflowMessages || [])]
  const seen = new Set<string>()
  const result: any[] = []
  for (const m of all) {
    const mm = m as any
    const key = mm.id || `${mm.content}|${mm.timestamp}|${mm.agentId || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    if (mm.workflowId === wid) result.push(mm)
  }
  return result
})

const currentAgent = computed(() =>
  (mainStore.agents || []).find((a: any) => a.id === 'performance-tester') || null
)

function onExecute(wfId: string) {
  currentWorkflowId.value = wfId
  localStorage.setItem(PERF_WF_HISTORY_KEY, wfId)
  ElMessage.info({ message: '⏳ 已开始执行，实时处理过程（含交付物）显示在下方面板', duration: 6000 })
}

function resetOutput() {
  currentWorkflowId.value = ''
}

function extractUrl(text: string): string {
  const m = text.match(/(https?:\/\/[^\s一-龥]+)/)
  return m ? m[1] : ''
}

const TEXT_EXTS = ['.txt', '.md', '.json', '.csv', '.log', '.yaml', '.yml', '.xml', '.html', '.js', '.ts', '.py', '.java', '.go', '.sql']
async function readAttachmentContent(file: AttachmentFile): Promise<string> {
  if (!file.dataUrl) return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`
  if (file.size > 10 * 1024 * 1024) return `[附件: ${file.name} - 文件过大, 已跳过内容读取]`
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()
  if (TEXT_EXTS.includes(ext)) {
    try {
      const base64 = file.dataUrl.split(',').pop() || ''
      const binaryStr = atob(base64)
      const decoded = new TextDecoder('utf-8').decode(Uint8Array.from(binaryStr, (c) => c.charCodeAt(0)))
      const MAX = 50000
      const truncated = decoded.length > MAX ? decoded.substring(0, MAX) + '\n... (内容过长已截断)' : decoded
      return `=== ${file.name} ===\n\n\`\`\`\n${truncated}\n\`\`\``
    } catch {
      return `[附件: ${file.name}]`
    }
  }
  return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`
}

async function onFileChange(_file: any, fileList: any) {
  files.value = []
  for (const uf of fileList || []) {
    const raw = uf.raw as File
    if (!raw) continue
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(raw)
    })
    files.value.push({ name: raw.name, size: raw.size, type: raw.type, dataUrl })
  }
}

async function run() {
  if (!selected.value) {
    ElMessage.warning('请选择要执行的阶段或工作流')
    return
  }
  const e = selected.value
  submitting.value = true
  try {
    let rawTarget = target.value.trim()
    let desc = description.value.trim()
    if (files.value.length) {
      const contents: string[] = []
      for (const f of files.value) contents.push(await readAttachmentContent(f))
      desc = contents.join('\n\n---\n\n') + '\n\n用户需求：' + desc
      if (!rawTarget) rawTarget = extractUrl(desc)
    } else if (!rawTarget) {
      rawTarget = extractUrl(desc) || (desc.split(/[\s,，]+/)[0] || '')
    }
    if (e.isFull && !rawTarget.startsWith('http')) {
      ElMessage.warning(`完整${LABEL}请输入目标地址，或选择单个阶段执行`)
      submitting.value = false
      return
    }
    const finalTarget = rawTarget || 'uploaded-docs'
    const result = await performanceTestApi.startWorkflow(finalTarget, desc, e.stageIdx)
    if (result) {
      const wfId = result.workflowId || result.testId || result.taskId
      if (wfId) onExecute(wfId)
      ElMessage.success(
        e.isFull
          ? `${ICON} ${LABEL}工作流已启动（${STAGES.length}阶段自动串联）\n${STAGES.join(' → ')}`
          : `${ICON} ${LABEL}·第${(e.stageIdx as number) + 1}步「${STAGES[e.stageIdx as number]}」已提交，请等待结果返回...`
      )
      target.value = ''
      description.value = ''
      files.value = []
    }
  } catch (err: any) {
    ElMessage.error('发起失败：' + (err?.message || String(err)))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="perf-executor">
    <el-row :gutter="16">
      <!-- 左栏：执行方式 + 用户输入区域 -->
      <el-col :span="10">
        <el-card class="config-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span>⚡ 性能测试执行配置</span>
            </div>
          </template>

          <el-form label-position="top">
            <el-form-item label="执行方式">
              <el-select
                v-model="selectedKey"
                placeholder="请选择执行方式（单阶段或完整工作流）"
                style="width: 100%"
                size="large"
              >
                <el-option v-for="e in entries" :key="e.key" :value="e.key" :label="e.name">
                  <div class="de-opt">
                    <span class="de-opt-name">{{ e.name }}</span>
                    <span class="de-opt-tag">
                      {{ e.isFull ? '工作流' : `阶段 ${(e.stageIdx as number) + 1}` }}
                    </span>
                  </div>
                </el-option>
              </el-select>
            </el-form-item>

            <template v-if="selected">
              <div class="de-panel-head">{{ selected.name }}</div>
              <el-form-item label="被测目标地址 (URL)">
                <el-input
                  v-model="target"
                  placeholder="https://example.com  （完整工作流必填；单阶段可留空或上传文档）"
                />
              </el-form-item>
              <el-form-item label="任务描述">
                <el-input
                  v-model="description"
                  type="textarea"
                  :rows="4"
                  placeholder="描述测试需求，例如：对订单接口做 500 并发压力测试，关注响应时间与错误率"
                />
              </el-form-item>
              <div class="de-actions">
                <el-button type="primary" :loading="submitting" @click="run">
                  执行{{ selected.isFull ? '工作流' : '该阶段' }}
                </el-button>
              </div>
              <el-form-item label="补充材料（可选）">
                <el-upload :auto-upload="false" :on-change="onFileChange" multiple :show-file-list="true">
                  <el-button>选择文件</el-button>
                </el-upload>
              </el-form-item>
            </template>

            <div v-else class="de-empty-inline">
              <div class="de-empty-icon">{{ ICON }}</div>
              <p>请选择执行方式，然后填写目标地址与任务描述</p>
            </div>
          </el-form>
        </el-card>
      </el-col>

      <!-- 右栏：处理过程信息实时输出区域 -->
      <el-col :span="14">
        <el-card class="output-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span>📡 处理过程信息（实时输出）</span>
              <el-button v-if="currentWorkflowId" size="small" text @click="resetOutput">重置</el-button>
            </div>
          </template>

          <div v-if="currentWorkflowId" class="workflow-chat">
            <DashboardChatPanel
              model-value=""
              :messages="workflowEvents"
              :readonly="true"
              :is-loading="submitting"
              :current-agent="currentAgent"
              empty-text="⏳ 等待阶段开始…"
            />
          </div>
          <div v-else class="output-empty">
            <el-icon :size="32" color="#c0c4cc"><Monitor /></el-icon>
            <p>执行后在此实时显示处理过程与交付物</p>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.perf-executor {
  padding: 4px 0;
}

.config-card {
  height: 100%;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
}

.de-panel-head {
  margin: 8px 0 14px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.de-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: -10px; /* 抵消 el-form-item 底部间距, 贴紧任务描述框右下角 */
  margin-bottom: 14px;
}

.de-opt {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.de-opt-name {
  font-size: 14px;
  color: var(--text-primary);
}
.de-opt-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(0, 122, 255, 0.1);
  color: var(--primary);
  flex-shrink: 0;
}

.de-empty-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  gap: 8px;
  padding: 40px 0 20px;
  font-size: 13px;
}
.de-empty-icon {
  font-size: 36px;
}

/* 右栏实时输出 */
.output-card {
  height: 100%;
}
.output-card :deep(.el-card__body) {
  height: 560px;
  padding: 0;
}
.workflow-chat {
  width: 100%;
  height: 100%;
  border-radius: 0;
  overflow: hidden;
  background: var(--el-bg-color, #fff);
}
.workflow-chat :deep(.dashboard-chat-panel) {
  border-radius: 0;
  height: 100%;
}
.output-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #909399;
  font-size: 13px;
}
</style>
