<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useMainStore } from '@/stores/main'
import { securityApi, performanceTestApi, request } from '@/api'
import DashboardChatPanel from '@/components/DashboardChatPanel.vue'
import type { AttachmentFile } from '@/types'

const props = defineProps<{ domain: 'security' | 'performance' }>()

const ICON = computed(() => (props.domain === 'security' ? '🔒' : '⚡'))
const LABEL = computed(() => (props.domain === 'security' ? '安全测试' : '性能测试'))
const isSecurity = computed(() => props.domain === 'security')

const STAGES: Record<'security' | 'performance', string[]> = {
  security: ['方案生成', '用例生成', '漏洞扫描', '手工渗透', '报告生成'],
  performance: ['需求分析', '方案制定', '场景设计', '脚本实现', '执行压测', '瓶颈分析', '报告生成'],
}
const stages = computed(() => STAGES[props.domain])

interface Entry {
  key: string
  name: string
  desc: string
  stageIdx: number | undefined
  isFull: boolean
}
const entries = computed<Entry[]>(() => {
  const list: Entry[] = stages.value.map((name, idx) => ({
    key: `stage-${idx}`,
    name: `${ICON.value} ${LABEL.value}·${name}`,
    desc: `执行第 ${idx + 1} 阶段：${name}`,
    stageIdx: idx,
    isFull: false,
  }))
  list.push({
    key: 'full',
    name: `${ICON.value} ${LABEL.value}·完整工作流`,
    desc: `自动串联全部 ${stages.value.length} 个阶段`,
    stageIdx: undefined,
    isFull: true,
  })
  return list
})

const selectedKey = ref<string>('')
const selected = computed<Entry | null>(() => entries.value.find((e) => e.key === selectedKey.value) || null)

const target = ref('')
const description = ref('')
const scanType = ref('full')
const files = ref<AttachmentFile[]>([])
const submitting = ref(false)

// ── 实时显示：复用 store SSE messages（与 Dashboard 同源）──────────────
const mainStore = useMainStore()

// 当前工作流 ID（执行后设置）
const currentWorkflowId = ref('')

// 合并主 store 的 messages（安全测试 security-* 前缀进这里）+
// workflowMessages（性能测试 uuid 进这里），按 workflowId 精确过滤，去重
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

// 当前 agent（用于面板头显示图标/名称）
const currentAgent = computed(() => {
  const id = isSecurity.value ? 'security-sentinel' : 'performance-tester'
  return (mainStore.agents || []).find((a: any) => a.id === id) || null
})

// 执行成功后：设置 workflowId，本页内嵌的 DashboardChatPanel 实时显示输出与交付物
const onExecute = (wfId: string) => {
  currentWorkflowId.value = wfId
  ElMessage.info({ message: '⏳ 已开始执行，实时输出（含交付物）显示在下方面板', duration: 6000 })
}

const SCAN_TYPES = [
  { value: 'full', label: '全量检测' },
  { value: 'xss', label: 'XSS 跨站脚本' },
  { value: 'sql', label: 'SQL 注入' },
  { value: 'os', label: '系统命令注入' },
  { value: 'network', label: '网络层' },
  { value: 'business', label: '业务逻辑' },
]

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
      console.warn('[DomainTest] Word 解析失败:', file.name, e)
      return `[附件: ${file.name} (${(file.size / 1024).toFixed(1)}KB) - 解析失败: ${e}]`
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
      ElMessage.warning(`完整${LABEL.value}请输入目标地址，或选择单个阶段执行`)
      submitting.value = false
      return
    }
    const finalTarget = rawTarget || 'uploaded-docs'
    const result = isSecurity.value
      ? await securityApi.startWorkflow(finalTarget, scanType.value, desc, e.stageIdx)
      : await performanceTestApi.startWorkflow(finalTarget, desc, e.stageIdx)
    if (result) {
      // 后端单阶段返回 taskId、完整工作流返回 workflowId/testId，统一兜底
      const wfId = result.workflowId || result.testId || result.taskId
      if (wfId) { onExecute(wfId) }

      ElMessage.success(
        e.isFull
          ? `${ICON.value} ${LABEL.value}工作流已启动（${stages.value.length}阶段自动串联）\n${stages.value.join(' → ')}`
          : `${ICON.value} ${LABEL.value}·第${(e.stageIdx as number) + 1}步「${stages.value[e.stageIdx as number]}」已提交，请等待结果返回...`
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
  <div class="de-panel mac-card">
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
        <el-form-item :label="isSecurity ? '扫描目标地址 (URL)' : '被测目标地址 (URL)'">
          <el-input
            v-model="target"
            placeholder="https://example.com  （完整工作流必填；单阶段可留空或上传文档）"
          />
        </el-form-item>
        <el-form-item v-if="isSecurity" label="扫描类型">
          <el-select v-model="scanType" style="width: 100%">
            <el-option v-for="s in SCAN_TYPES" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="需求描述 / 备注">
          <el-input
            v-model="description"
            type="textarea"
            :rows="4"
            placeholder="描述测试需求，例如：对登录接口做 XSS 与 SQL 注入检测"
          />
        </el-form-item>
        <el-form-item label="补充材料（可选）">
          <el-upload :auto-upload="false" :on-change="onFileChange" multiple :show-file-list="true">
            <el-button>选择文件</el-button>
          </el-upload>
        </el-form-item>
        <div class="de-actions">
          <el-button type="primary" :loading="submitting" @click="run">
            执行{{ selected.isFull ? '工作流' : '该阶段' }}
          </el-button>
          <el-button @click="selectedKey = ''">取消选择</el-button>
        </div>
      </template>
      <div v-else class="de-empty-inline">
        <div class="de-empty-icon">{{ ICON }}</div>
        <p>请选择执行方式，然后填写目标地址与需求描述</p>
      </div>
    </el-form>

    <!-- ── 实时输出区：复用 DashboardChatPanel（与分步测试同源）── -->
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
  </div>
</template>

<style scoped>
.de-panel {
  padding: 20px;
}
.de-panel-head {
  margin: 8px 0 14px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}
.de-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
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

/* ── 实时输出区（复用 DashboardChatPanel）─────────────── */
.workflow-chat {
  width: 100%;
  margin-top: 16px;
  height: 480px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 10px;
  overflow: hidden;
  background: var(--el-bg-color, #fff);
}
.workflow-chat :deep(.dashboard-chat-panel) {
  border-radius: 0;
}
.workflow-chat :deep(.panel-header) {
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
}
</style>
