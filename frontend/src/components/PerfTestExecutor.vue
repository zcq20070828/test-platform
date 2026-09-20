<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Monitor, Document, Promotion, InfoFilled, CircleClose } from '@element-plus/icons-vue'
import { useMainStore } from '@/stores/main'
import { performanceTestApi, request } from '@/api'
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

const input = ref('')
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
      console.warn('[PerfTest] Word 解析失败:', file.name, e)
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
  if (!selected.value) {
    ElMessage.warning('请选择要执行的阶段或工作流')
    return
  }
  const e = selected.value
  submitting.value = true
  try {
    const text = input.value.trim()
    // URL 直接写在输入内容里，执行时自动提取（无 URL 时单阶段回退 uploaded-docs，完整工作流会被下方校验拦截）
    const rawTarget = extractUrl(text)
    let desc = text
    if (files.value.length) {
      const contents: string[] = []
      for (const f of files.value) contents.push(await readAttachmentContent(f))
      desc = contents.join('\n\n---\n\n') + '\n\n用户需求：' + desc
    }
    if (e.isFull && !rawTarget.startsWith('http')) {
      ElMessage.warning(`完整${LABEL}请在输入内容中包含被测地址（http/https 链接），或选择单个阶段执行`)
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
      input.value = ''
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
              <span class="header-icon">⚡</span>
              <div class="header-text">
                <div class="header-title">性能测试执行配置</div>
                <div class="header-sub">选择阶段、填写需求，可上传技术方案文档作为分析输入</div>
              </div>
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
              <div v-if="selected" class="stage-hint">
                <span class="stage-hint-badge">
                  {{ selected.isFull ? '全流程' : `Step ${(selected.stageIdx as number) + 1}/7` }}
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
                    placeholder="描述测试需求（被测地址直接写在内容中，如：对 https://api.example.com/orders 做 500 并发压力测试，关注响应时间与错误率。完整工作流必须包含 URL；单阶段可留空或上传文档）（Enter 执行，Shift+Enter 换行）"
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
                      {{ selected.isFull ? '执行完整工作流' : `执行第 ${(selected.stageIdx as number) + 1} 阶段「${STAGES[selected.stageIdx as number]}」` }}
                    </el-button>
                  </div>
                </div>

                <div class="input-hint">
                  <el-icon><InfoFilled /></el-icon>
                  <span>支持拖拽文件到输入框上传（docx、md、txt、json 等，单文件 ≤ 10MB）</span>
                </div>
              </div>
            </template>

            <div v-else class="de-empty-inline">
              <div class="de-empty-icon">{{ ICON }}</div>
              <p>请选择执行方式，然后在输入框描述测试需求</p>
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
                  <span v-if="currentWorkflowId" class="live-dot"></span>
                  {{ currentWorkflowId ? '实时输出中' : '实时输出' }}
                </div>
              </div>
              <el-button v-if="currentWorkflowId" size="small" text class="reset-btn" @click="resetOutput">重置</el-button>
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
            <div class="output-empty-glow">
              <el-icon :size="40" color="#a0b4d8"><Monitor /></el-icon>
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
.perf-executor {
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
.config-card :deep(.el-card__body) {
  padding: 20px 20px 24px;
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

/* ── 执行方式：下拉与阶段提示 ─────────────── */
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
