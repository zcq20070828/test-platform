<script setup lang="ts">
/**
 * 输出物卡片（2026-11-25 重构）
 *
 * 为什么要抽这个组件
 *
 *   同一张「输出物卡片」原来在三个地方各写了一份：
 *     - components/UnifiedChatPanel.vue   5 个按钮
 *     - components/DashboardChatPanel.vue 4 个按钮
 *     - views/TasksView.vue               2 个按钮
 *   它们连"什么时候显示按钮"的判据都不一致，结果同一个 bug 修了两处漏一处：
 *   「预览/用作输入/复制」都写 `v-if="artifact.content"`，而后端产出的
 *   artifacts 只有 downloadUrl、没有 content —— 这三个按钮在部分界面从来没
 *   显示过，用户报"交付物少了按钮"报了两次。
 *
 *   抽成组件后，判据只有一份（这里的 hasContent / canPreview），
 *   各调用方只决定「显示哪几个按钮」，不再各自复写条件。
 *
 * 设计约束
 *
 *   1. 按钮可用性完全由 props 控制（show 数组），不在调用方写 v-if。
 *      调用方想隐藏某个按钮就传不同的 show，判据仍在本组件内。
 *   2. 取内容统一走 resolveContent：有 content 直接用，否则走 downloadUrl
 *      且带认证头——这是「后端不给 content」场景能正常工作的关键。
 *   3. 二进制格式（docx/xlsx/pdf）不提供预览与复制，只给下载：
 *      按文本读会得到乱码，与其给个坏体验不如明说。
 *   4. 预览用一个轻量弹窗内联在本组件里，不再让每个调用方各维护一套
 *      previewVisible / previewRenderedContent 状态。
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import MsIcon from '@/components/MsIcon.vue'
import { Marked } from 'marked'
import hljs from 'highlight.js'
import { sanitizeHtml, renderMarkdownSafe, escapeHtml } from '@/utils/safe-html'
import { formatClock } from '@/utils/time'

export type ArtifactAction = 'preview' | 'copy' | 'useAsInput' | 'edit' | 'download'

const props = withDefaults(defineProps<{
  artifact: any
  /** 显示哪些按钮（顺序按此数组）。默认全给，调用方按需裁剪 */
  show?: ArtifactAction[]
  /** 是否显示文件大小（列表页空间紧时关掉） */
  showSize?: boolean
}>(), {
  show: () => ['preview', 'copy', 'useAsInput', 'edit', 'download'],
  showSize: true,
})

const emit = defineEmits<{
  /** 用作输入：由调用方决定填到哪个输入框 */
  (e: 'use-as-input', artifact: any): void
  /** 编辑：由调用方决定跳哪里/怎么编辑 */
  (e: 'edit', artifact: any): void
}>()

// ---------------- 类型与图标 ----------------

const BIN_EXTS = ['.docx', '.xlsx', '.pdf', '.zip', '.doc', '.xls', '.ppt', '.pptx']

const fname = computed(() => String(props.artifact?.name || '').toLowerCase())
const isBinary = computed(() => BIN_EXTS.some((ext) => fname.value.endsWith(ext)))

/**
 * 展示类型：后端一律标 type:'file'，按扩展名细化才能区分报告/表格
 * 图标与文字标签必须同源，否则会出现「显示报告字样却用文件夹图标」
 */
const kind = computed(() => {
  const n = fname.value
  if (/\.(xlsx?|csv)$/.test(n)) return 'sheet'
  if (/\.(md|docx?|pdf)$/.test(n)) return 'report'
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(n)) return 'image'
  if (/\.(py|js|ts|java|sh|go|rb|php|json|ya?ml|xml)$/.test(n)) return 'code'
  return 'file'
})

const kindLabel = computed(() => ({
  sheet: '表格', report: '报告', image: '图片', code: '代码', file: '文件',
} as Record<string, string>)[kind.value] || '文件')

const kindIcon = computed(() => ({
  sheet: 'table_chart', report: 'analytics', image: 'image', code: 'edit', file: 'folder_open',
} as Record<string, string>)[kind.value] || 'folder_open')

// ---------------- 可用性判据（唯一一份） ----------------

/** 是否有可取的内容：有 content 或 downloadUrl 都算 */
const hasContent = computed(() => {
  const a = props.artifact
  return !!(a && (a.content || a.downloadUrl))
})

/** 能否预览/复制：必须有内容、且不是二进制 */
const canPreview = computed(() => hasContent.value && !isBinary.value)

function visible(action: ArtifactAction): boolean {
  if (!props.show.includes(action)) return false
  if (action === 'preview' || action === 'copy') return canPreview.value
  if (action === 'useAsInput') return hasContent.value
  // edit / download 始终可用：即使 content 缺失，下载仍可走 downloadUrl
  return true
}

// ---------------- 取内容 ----------------

/**
 * 统一取文本内容
 * 后端产出的 artifacts 只有 downloadUrl，必须带认证头去取，
 * 否则 401——这是三个界面都踩过的坑。
 */
async function resolveContent(): Promise<string> {
  const a = props.artifact
  if (a?.content) return String(a.content)
  if (!a?.downloadUrl) return ''
  const token = localStorage.getItem('token')
  const res = await fetch(a.downloadUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`读取失败（HTTP ${res.status}）`)
  return await res.text()
}

// ---------------- 预览 ----------------

const previewVisible = ref(false)
const previewHtml = ref('')

const previewMarked = new Marked({ breaks: true, gfm: true })
previewMarked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang || ''
      let highlighted: string
      try {
        highlighted = (language && hljs.getLanguage(language))
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value
      } catch {
        highlighted = escapeHtml(text)
      }
      return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">${escapeHtml(language || 'code')}</span></div><pre class="code-block-pre"><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`
    },
  },
})

async function onPreview() {
  try {
    const content = await resolveContent()
    previewHtml.value = content
      ? renderMarkdownSafe(content, previewMarked)
      : '<p style="color:#999;text-align:center;">无预览内容</p>'
    previewVisible.value = true
  } catch (e: any) {
    ElMessage.error(`预览失败：${e?.message || e}`)
  }
}

// ---------------- 复制 ----------------

async function onCopy() {
  if (isBinary.value) {
    ElMessage.info('Word/Excel 文件不支持复制内容，请下载后打开查看')
    return
  }
  try {
    const content = await resolveContent()
    if (!content) {
      ElMessage.warning('该输出物没有可复制的内容')
      return
    }
    await navigator.clipboard.writeText(content)
    ElMessage.success('已复制到剪贴板')
  } catch (e: any) {
    ElMessage.error(`复制失败：${e?.message || e}`)
  }
}

// ---------------- 用作输入 ----------------

async function onUseAsInput() {
  try {
    // 由调用方决定填哪个输入框，但内容在这里取好传出去——
    // 调用方不必再各写一遍 fetch + 认证头
    const content = await resolveContent()
    if (!content) {
      ElMessage.warning('该输出物没有可用的内容')
      return
    }
    emit('use-as-input', { ...props.artifact, content })
  } catch (e: any) {
    ElMessage.error(`读取输出物失败：${e?.message || e}`)
  }
}

// ---------------- 下载 ----------------

async function onDownload() {
  const a = props.artifact
  try {
    let blob: Blob
    if (a.content) {
      blob = new Blob([a.content], { type: a.contentType || 'text/plain;charset=utf-8' })
    } else if (a.downloadUrl) {
      const token = localStorage.getItem('token')
      const res = await fetch(a.downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        ElMessage.error(`下载失败：${errText || `HTTP ${res.status}`}`)
        return
      }
      blob = await res.blob()
    } else {
      ElMessage.warning('该输出物没有可下载的内容')
      return
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = a.name || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    ElMessage.error(`下载失败：${e?.message || e}`)
  }
}

function onEdit() {
  emit('edit', props.artifact)
}

function sizeText(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`
}

defineExpose({ hasContent, canPreview, resolveContent })
</script>

<template>
  <div class="artifact-card">
    <div class="artifact-icon">
      <MsIcon :name="kindIcon" />
    </div>
    <div class="artifact-info">
      <div class="artifact-name">{{ artifact.name }}</div>
      <div class="artifact-meta">
        <span class="artifact-type">{{ kindLabel }}</span>
        <span v-if="showSize && artifact.size" class="artifact-size">{{ sizeText(artifact.size) }}</span>
        <span v-if="artifact.createdAt" class="artifact-time">{{ formatClock(artifact.createdAt) }}</span>
      </div>
    </div>
    <div class="artifact-actions">
      <el-button v-if="visible('preview')" text size="small" @click="onPreview">
        <MsIcon name="visibility" /> 预览
      </el-button>
      <el-button v-if="visible('copy')" text size="small" @click="onCopy">
        <MsIcon name="content_copy" /> 复制
      </el-button>
      <el-button v-if="visible('useAsInput')" text size="small" type="success" @click="onUseAsInput">
        <MsIcon name="arrow_forward" /> 用作输入
      </el-button>
      <el-button v-if="visible('edit')" text size="small" type="warning" @click="onEdit">
        <MsIcon name="edit" /> 编辑
      </el-button>
      <el-button v-if="visible('download')" text size="small" type="primary" @click="onDownload">
        <MsIcon name="download" /> 下载
      </el-button>
    </div>

    <el-dialog
      v-model="previewVisible"
      :title="artifact.name || '预览'"
      width="70%"
      top="6vh"
      destroy-on-close
    >
      <div class="artifact-preview" v-html="sanitizeHtml(previewHtml)" />
    </el-dialog>
  </div>
</template>

<style scoped>
.artifact-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
}
.artifact-icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  color: var(--el-color-primary);
}
.artifact-info { flex: 1 1 auto; min-width: 0; }
.artifact-name {
  font-size: 14px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-meta {
  display: flex;
  gap: 10px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.artifact-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.artifact-preview {
  max-height: 66vh;
  overflow: auto;
  line-height: 1.7;
}
.artifact-preview :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.artifact-preview :deep(th),
.artifact-preview :deep(td) {
  border: 1px solid var(--el-border-color);
  padding: 6px 8px;
  font-size: 13px;
}
</style>
