<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Document, Promotion, InfoFilled, CircleClose } from '@element-plus/icons-vue'
import { useMainStore } from '@/stores/main'
import { request } from '@/api'
import DashboardChatPanel from '@/components/DashboardChatPanel.vue'
import type { AttachmentFile } from '@/types'

// 📜 测试脚本生成「测试执行」tab —— 两栏格局（左：脚本类型+用户输入；右：实时输出）
// 结构与「安全/性能测试」的 DomainTestExecutor、「兼容性测试」的 CompatTestExecutor 对齐：
// 下拉选择脚本类型、聊天式输入区、右栏「处理过程信息」（含三格式交付物）。
// 执行通道复用分步测试的通用 Agent 通道 store.createTask(agentId='test-script-generator')，零后端改动。
// test-script-generator 已在 AGENT_DELIVERABLE_FORMATS 配置 docx/xlsx，任务完成自动产出 md+docx+xlsx 三格式交付物。

const AGENT_ID = 'test-script-generator'
const LABEL = '测试脚本生成'
const ICON = '📜'

// 脚本类型（用于下拉与注入前缀；底层均为 test-script-generator 一个智能体）
const SCRIPT_TYPES: { key: string; label: string; desc: string }[] = [
  { key: 'api', label: '接口测试脚本', desc: '生成接口/API 自动化测试脚本（newman、pytest、requests 等）' },
  { key: 'ui', label: 'UI/E2E 测试脚本', desc: '生成 UI/端到端自动化测试脚本（Playwright、Cypress 等）' },
]

interface Entry {
  key: string
  name: string
  desc: string
  scriptType: string | undefined
  label: string
  isFull: boolean
}
const entries = computed<Entry[]>(() => {
  const list: Entry[] = SCRIPT_TYPES.map((t) => ({
    key: `type-${t.key}`,
    name: `${ICON} ${LABEL}·${t.label}`,
    desc: t.desc,
    scriptType: t.label,
    label: t.label,
    isFull: false,
  }))
  list.push({
    key: 'full',
    name: `${ICON} ${LABEL}·完整流程`,
    desc: '不指定类型，由智能体根据需求自动判断并生成（接口/UI/E2E 等）',
    scriptType: undefined,
    label: '完整流程',
    isFull: true,
  })
  return list
})

const selectedKey = ref<string>('full')
const selected = computed<Entry | null>(() => entries.value.find((e) => e.key === selectedKey.value) || null)

const input = ref('')
const files = ref<AttachmentFile[]>([])
const submitting = ref(false)

const mainStore = useMainStore()
const currentTaskId = ref('')
const TASK_HISTORY_KEY = 'script_executor_current_task'

// 从历史消息中找出最近一次脚本生成任务 ID（按 taskId 或 agentId 兜底）
function findLatestTaskId(): string {
  const msgs = (mainStore.messages || []) as any[]
  const ids: string[] = []
  for (const m of msgs) {
    if (m.agentId === AGENT_ID && m.taskId && !ids.includes(m.taskId)) ids.push(m.taskId)
  }
  return ids[ids.length - 1] || ''
}

// 组件挂载时恢复上次任务，使实时面板回显历史信息
onMounted(() => {
  const saved = localStorage.getItem(TASK_HISTORY_KEY) || ''
  const live = findLatestTaskId()
  const tid = live || saved
  if (tid) currentTaskId.value = tid
})

// 合并主 store 的 messages，按 taskId 精确过滤（兜底 agentId），去重
const workflowEvents = computed(() => {
  const tid = currentTaskId.value
  const all = [...(mainStore.messages || []), ...(mainStore.workflowMessages || [])] as any[]
  const seen = new Set<string>()
  const result: any[] = []
  for (const m of all) {
    const key = m.id || `${m.content}|${m.timestamp}|${m.agentId || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!tid) {
      if (m.agentId === AGENT_ID) result.push(m)
    } else if (m.taskId === tid || m.workflowId === tid || m.agentId === AGENT_ID) {
      result.push(m)
    }
  }
  return result
})

const currentAgent = computed(() =>
  (mainStore.agents || []).find((a: any) => a.id === AGENT_ID) || null
)

function onTaskCreated(taskId: string) {
  currentTaskId.value = taskId
  localStorage.setItem(TASK_HISTORY_KEY, taskId)
  ElMessage.info({ message: '⏳ 已开始执行，实时处理过程（含交付物）显示在下方面板', duration: 6000 })
}

function resetOutput() {
  currentTaskId.value = ''
}

function extractUrl(text: string): string {
  const m = text.match(/(https?:\/\/[^\s一-龥]+)/)
  return m ? m[1] : ''
}

const TEXT_EXTS = ['.txt', '.md', '.json', '.csv', '.log', '.yaml', '.yml', '.xml', '.html', '.js', '.ts', '.py', '.java', '.go', '.sql']
async function readAttachmentContent(file: AttachmentFile): Promise<string | null> {
  if (!file.dataUrl) return null
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
  // Word 文档:通过后端 /api/parse/word 解析(与 DashboardView.readAttachmentContent 统一)
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
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析结果为空]`
    } catch (e) {
      console.warn('[TestScript] Word 解析失败:', file.name, e)
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析失败: ${e}]`
    }
  }
  // 办公表格/文档(.xlsx/.xls/.pdf/.pptx/.ppt):走后端通用 /api/parse 解析
  // (与 DashboardView.readAttachmentContent 及 test-script-generator 系统提示词承诺的 `=== 测试用例文档内容 ===` 标记保持一致)
  if (['.xlsx', '.xls', '.pdf', '.pptx', '.ppt'].includes(ext)) {
    try {
      const base64 = file.dataUrl.split(',').pop() || ''
      const res = await request<{ success: boolean; text?: string }>('/api/parse', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, base64 })
      })
      if (res.success && res.data?.success && res.data?.text) {
        const MAX = 50000
        const truncated = res.data.text.length > MAX ? res.data.text.substring(0, MAX) + '\n... (内容过长已截断)' : res.data.text
        return `=== 测试用例文档内容 ===\n\n--- 文档 1: ${file.name} ---\n${truncated}`
      }
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析结果为空]`
    } catch (e) {
      console.warn('[TestScript] 文档解析失败:', file.name, e)
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析失败: ${e}]`
    }
  }
  return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`
}

const fileInput = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)
const MAX_FILE_SIZE = 10 * 1024 * 1024

function checkFileSize(file: File): boolean {
  if (file.size > MAX_FILE_SIZE) {
    ElMessage.error(`文件 ${file.name} 超过 10MB 限制，已跳过`)
    return false
  }
  return true
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

async function addFiles(list: FileList | File[]) {
  for (const raw of Array.from(list)) {
    if (!checkFileSize(raw)) continue
    const dataUrl = await readAsDataUrl(raw)
    files.value.push({ name: raw.name, size: raw.size, type: raw.type, dataUrl })
  }
}

function handleFileSelect() {
  fileInput.value?.click()
}

function handleFileChange(e: Event) {
  const list = (e.target as HTMLInputElement).files
  if (list) addFiles(list)
  ;(e.target as HTMLInputElement).value = ''
}

function handleDragOver() { isDragOver.value = true }
function handleDragLeave() { isDragOver.value = false }

function handleDrop(e: DragEvent) {
  isDragOver.value = false
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files)
}

function removeAttachment(index: number) {
  files.value.splice(index, 1)
}

async function run() {
  const e = selected.value
  if (!e) {
    ElMessage.warning('请选择脚本类型')
    return
  }
  const text = input.value.trim()
  if (!text && files.value.length === 0) {
    ElMessage.warning('请描述测试脚本生成需求，或上传补充材料（如接口文档、用例）')
    return
  }
  submitting.value = true
  try {
    // 脚本类型作为前缀注入需求（智能体会据此聚焦生成对应类型脚本）
    const typeHint = e.isFull ? '【脚本类型：根据需求自动判断（接口/UI/E2E 等）】' : `【脚本类型：${e.scriptType}】`
    let desc = `${typeHint}\n${text}`
    const filesToSubmit: { name: string; content: string }[] = []
    if (files.value.length) {
      const contents: string[] = []
      for (const f of files.value) {
        const c = await readAttachmentContent(f)
        if (c) {
          contents.push(c)
          filesToSubmit.push({ name: f.name, content: c })
        }
      }
      if (contents.length) desc += '\n\n---\n\n' + contents.join('\n\n---\n\n')
    }
    // 复用分步测试通用 Agent 通道，与分步测试中选中 test-script-generator 完全等价
    const task: any = await mainStore.createTask(AGENT_ID, desc, filesToSubmit, { source: 'step', type: AGENT_ID })
    if (task && task.id) {
      onTaskCreated(task.id)
      ElMessage.success(`${ICON} ${LABEL}任务已提交（${e.isFull ? '完整流程' : e.label}），请等待结果返回...`)
      input.value = ''
      files.value = []
    } else if (task === null) {
      ElMessage.error('任务创建失败，请确认已登录且会话未过期')
    }
  } catch (err: any) {
    if (err?.code === 'TASK_CONFLICT') {
      ElMessage.warning(err.message || '同一用户同一时间只能执行一个任务')
    } else {
      ElMessage.error('发起失败：' + (err?.message || String(err)))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="domain-executor">
    <el-row :gutter="16">
      <!-- 左栏：脚本类型 + 用户输入区域 -->
      <el-col :span="10">
        <el-card class="config-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span class="header-icon">{{ ICON }}</span>
              <div class="header-text">
                <div class="header-title">{{ LABEL }}执行配置</div>
                <div class="header-sub">选择脚本类型、填写需求，可上传接口文档/用例作为生成输入</div>
              </div>
            </div>
          </template>

          <el-form label-position="top">
            <el-form-item label="脚本类型">
              <el-select
                v-model="selectedKey"
                placeholder="请选择脚本类型（单类型或完整流程）"
                style="width: 100%"
                size="large"
              >
                <el-option v-for="e in entries" :key="e.key" :value="e.key" :label="e.name">
                  <div class="de-opt">
                    <span class="de-opt-name">{{ e.name }}</span>
                    <span class="de-opt-tag">
                      {{ e.isFull ? '完整流程' : e.label }}
                    </span>
                  </div>
                </el-option>
              </el-select>
              <div v-if="selected" class="stage-hint">
                <span class="stage-hint-badge">
                  {{ selected.isFull ? '完整流程' : selected.label }}
                </span>
                <span class="stage-hint-text">{{ selected.desc }}</span>
              </div>
            </el-form-item>

            <template v-if="selected">
              <div class="input-section">
                <!-- 附件预览条（与分步测试一致） -->
                <div v-if="files.length > 0" class="attachments-preview">
                  <div v-for="(file, index) in files" :key="file.name + index" class="attachment-item">
                    <img
                      v-if="file.type?.startsWith('image/') && file.dataUrl"
                      :src="file.dataUrl"
                      class="attachment-image"
                    />
                    <div v-else class="attachment-file">
                      <el-icon><Document /></el-icon>
                      <div class="file-info">
                        <span class="file-name">{{ file.name }}</span>
                        <span class="file-size">{{ (file.size / 1024).toFixed(1) }}KB</span>
                      </div>
                    </div>
                    <el-button class="remove-attachment" text size="small" @click="removeAttachment(index)">
                      <el-icon><CircleClose /></el-icon>
                    </el-button>
                  </div>
                </div>

                <!-- 聊天式输入框（对齐分步测试 DashboardChatPanel 输入区） -->
                <div
                  class="input-box"
                  :class="{ 'drag-over': isDragOver }"
                  @dragover.prevent="handleDragOver"
                  @dragleave.prevent="handleDragLeave"
                  @drop.prevent="handleDrop"
                >
                  <div class="input-toolbar">
                    <el-button text title="上传补充材料" @click="handleFileSelect">
                      <el-icon><Document /></el-icon>
                    </el-button>
                    <input ref="fileInput" type="file" multiple style="display: none" @change="handleFileChange" />
                    <span class="toolbar-note">补充材料（可选，Word 文档将自动解析正文）</span>
                  </div>
                  <el-input
                    v-model="input"
                    type="textarea"
                    :rows="5"
                    resize="none"
                    placeholder="描述测试脚本生成需求（如：根据以下接口文档生成 pytest 接口自动化测试脚本；或将这份测试用例转为 Playwright E2E 脚本。可指定脚本类型或留空走完整流程）（Enter 执行，Shift+Enter 换行）"
                    @keydown.enter.exact.prevent="run"
                    @keydown.shift.enter.prevent="input += '\n'"
                  />
                  <div class="input-actions">
                    <el-button
                      type="primary"
                      :loading="submitting"
                      :disabled="!input.trim() && files.length === 0"
                      @click="run"
                    >
                      <el-icon v-if="!submitting"><Promotion /></el-icon>
                      {{ selected.isFull ? `执行${LABEL}完整流程` : `生成${selected.label}` }}
                    </el-button>
                  </div>
                </div>

                <div class="input-hint">
                  <el-icon><InfoFilled /></el-icon>
                  <span>支持拖拽文件到输入框上传（docx、md、txt、json、py、js 等，单文件 ≤ 10MB）</span>
                </div>
              </div>
            </template>

            <div v-else class="de-empty-inline">
              <div class="de-empty-icon">{{ ICON }}</div>
              <p>请选择脚本类型，然后在输入框描述测试脚本生成需求</p>
            </div>
          </el-form>
        </el-card>
      </el-col>

      <!-- 右栏：处理过程信息实时输出区域 -->
      <el-col :span="14">
        <el-card class="output-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span class="header-icon header-icon--live">📡</span>
              <div class="header-text">
                <div class="header-title">处理过程信息</div>
                <div class="header-sub">
                  <span v-if="currentTaskId" class="live-dot"></span>
                  {{ currentTaskId ? '实时输出中' : '实时输出' }}
                </div>
              </div>
              <el-button v-if="currentTaskId" size="small" text class="reset-btn" @click="resetOutput">重置</el-button>
            </div>
          </template>

          <div v-if="currentTaskId" class="workflow-chat">
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
            <div class="output-empty-glow">
              <el-icon :size="40" color="#a0b4d8"><Document /></el-icon>
            </div>
            <p class="output-empty-title">执行后在此实时显示处理过程与交付物</p>
            <p class="output-empty-sub">支持实时流式输出 · 阶段进度 · 三格式交付物下载</p>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.domain-executor {
  padding: 4px 0;
}

/* ── 卡片整体 ─────────────────────────────── */
.config-card,
.output-card {
  height: 100%;
  border-radius: 12px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.04);
}
.config-card :deep(.el-card__header),
.output-card :deep(.el-card__header) {
  padding: 14px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
  background: linear-gradient(180deg, #fafbfd 0%, #ffffff 100%);
}
.config-card {
  display: flex;
  flex-direction: column;
}
.config-card :deep(.el-card__body) {
  padding: 20px 20px 24px;
  /* 弹性布局：让 input-section 撑满剩余高度，与右栏输出框底端对齐 */
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.config-card :deep(.el-form) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.output-card :deep(.el-card__body) {
  height: 560px;
  padding: 0;
}

/* ── 卡片头部 ─────────────────────────────── */
.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.header-icon {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.12) 0%, rgba(0, 180, 255, 0.10) 100%);
  border: 1px solid rgba(0, 122, 255, 0.15);
}
.header-icon--live {
  background: linear-gradient(135deg, rgba(103, 194, 58, 0.12) 0%, rgba(0, 200, 120, 0.10) 100%);
  border-color: rgba(103, 194, 58, 0.25);
}
.header-text {
  flex: 1;
  min-width: 0;
}
.header-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
}
.header-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-secondary, #909399);
  display: flex;
  align-items: center;
  gap: 6px;
}
.reset-btn {
  flex-shrink: 0;
}

/* ── 脚本类型：下拉与提示 ─────────────────── */
.stage-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(0, 122, 255, 0.05);
  border: 1px dashed rgba(0, 122, 255, 0.25);
  font-size: 12.5px;
  color: var(--text-secondary, #606266);
  line-height: 1.5;
}
.stage-hint-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary, #007aff);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
}
.stage-hint-text {
  min-width: 0;
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

/* ── 任务输入区（对齐分步测试 DashboardChatPanel 输入样式）── */
/* input-section 撑满卡片体剩余高度，使底部 hint 与右栏输出框底端对齐 */
.input-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.attachments-preview { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.attachment-item { position: relative; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; padding: 4px; max-width: 180px; }
.attachment-image { max-width: 100%; max-height: 80px; border-radius: 4px; display: block; }
.attachment-file { display: flex; align-items: center; gap: 6px; padding: 6px 8px; font-size: 12px; min-width: 120px; }
.attachment-file .file-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.attachment-file .file-name { font-size: 12px; color: var(--el-text-color-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
.attachment-file .file-size { font-size: 11px; color: var(--el-text-color-secondary); }
.remove-attachment { position: absolute; top: -8px; right: -8px; padding: 0; margin: 0; }

.input-box {
  border: 2px dashed transparent;
  border-radius: 8px;
  padding: 12px;
  background: var(--el-bg-color-page, #f5f7fa);
  transition: all 0.3s;
  /* 随 input-section 高度等比撑满，按钮与输入框底部随之下移 */
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.input-box :deep(.el-textarea) {
  flex: 1;
  display: flex;
  min-height: 0;
}
.input-box :deep(.el-textarea__inner) {
  flex: 1;
  min-height: 130px;
  height: 100%;
}
.input-box.drag-over {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.input-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.input-toolbar .el-button { padding: 4px 6px; }
.toolbar-note {
  font-size: 11.5px;
  color: var(--el-text-color-placeholder, #a8abb2);
}
.input-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
.input-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--el-text-color-placeholder, #c0c4cc);
}

/* ── 左栏空态 ─────────────────────────────── */
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

/* ── 右栏 ─────────────────────────────────── */
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
  gap: 12px;
  color: #909399;
  font-size: 13px;
}
.output-empty-glow {
  width: 84px;
  height: 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 24px;
  background: radial-gradient(circle at 30% 30%, rgba(0, 122, 255, 0.10) 0%, rgba(0, 122, 255, 0.03) 70%);
  border: 1px solid rgba(0, 122, 255, 0.10);
}
.output-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #606266);
}
.output-empty-sub {
  margin: 0;
  font-size: 12px;
  color: #c0c4cc;
}
.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #67c23a;
  box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.2);
  animation: live-pulse 1.6s ease-in-out infinite;
}
@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
</style>
