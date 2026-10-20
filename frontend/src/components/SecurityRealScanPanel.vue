<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { securityApi } from '@/api'

/**
 * 深度扫描面板 —— 真实开源扫描器入口
 * 与「测试执行」（LLM 编排）互补：这里跑的是 semgrep/trivy/bandit/nikto/nmap 等真实工具，
 * 产出可复现、带 CVE/CWE/file:line 的证据。
 */

interface ScannerInfo {
  id: string
  name: string
  category: string
  kind: 'source' | 'url' | 'host' | string
  description: string
  homepage?: string
  license?: string
  available: boolean
  version?: string | null
  installHint?: string | null
}

interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  tool: string
  category: string
  title: string
  description?: string
  location?: string
  evidence?: string
  remediation?: string
  cve?: string | null
  cwe?: string | null
  cvss?: number | null
}

const scanners = ref<ScannerInfo[]>([])
const loadingTools = ref(false)
const running = ref(false)
const mode = ref<'source' | 'url'>('source')
const target = ref('')
const selectedTools = ref<string[]>([])
const result = ref<{
  reportId: number
  findings: Finding[]
  summary: { total: number; severityDist: Record<string, number>; byTool: Record<string, number>; byCategory: Record<string, number>; score: number }
  tools: { tool: string; ok: boolean; findings: number; durationMs: number; error?: string | null; timedOut?: boolean }[]
} | null>(null)

const available = computed(() => scanners.value.filter(s => s.available))
const unavailable = computed(() => scanners.value.filter(s => !s.available))

const candidates = computed(() =>
  scanners.value.filter(s => s.available && (mode.value === 'source' ? s.kind === 'source' : s.kind === 'url' || s.kind === 'host'))
)

const sevOrder: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 }
const sevLabel: Record<string, string> = { critical: '严重', high: '高危', medium: '中危', low: '低危', info: '信息' }
const sevType: Record<string, string> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'info', info: 'info' }

function sevTag(s: string) { return (sevType[s] || 'info') as any }

async function loadScanners(refresh = false) {
  loadingTools.value = true
  try {
    const list = await securityApi.getScanners(refresh)
    scanners.value = (list || []) as ScannerInfo[]
    // 默认全选当前模式下可用的工具
    const usable = scanners.value.filter(s => s.available && (mode.value === 'source' ? s.kind === 'source' : s.kind === 'url' || s.kind === 'host'))
    selectedTools.value = usable.map(s => s.id)
  } catch (e: any) {
    ElMessage.error(`读取扫描器状态失败：${e?.message || e}`)
  } finally {
    loadingTools.value = false
  }
}

function onModeChange() {
  selectedTools.value = candidates.value.map(s => s.id)
  result.value = null
}

async function runScan() {
  if (running.value) return
  const t = target.value.trim()
  if (mode.value === 'url' && !/^https?:\/\//i.test(t)) {
    ElMessage.warning('URL 模式请填写 http(s) 地址')
    return
  }
  if (!selectedTools.value.length) {
    ElMessage.warning('请至少选择一个工具')
    return
  }
  running.value = true
  result.value = null
  try {
    const data = await securityApi.runRealScan({
      mode: mode.value,
      target: t,
      tools: selectedTools.value,
      testDomain: 'web',
    })
    if (!data) {
      ElMessage.error('扫描失败，请查看后端日志')
      return
    }
    result.value = data
    const total = data.summary?.total ?? 0
    ElMessage.success(`扫描完成：${total} 条发现，已生成报告 #${data.reportId}`)
  } catch (e: any) {
    ElMessage.error(`扫描失败：${e?.message || e}`)
  } finally {
    running.value = false
  }
}

const sortedFindings = computed(() => {
  const list = [...(result.value?.findings || [])]
  return list.sort((a, b) => (sevOrder[b.severity] || 0) - (sevOrder[a.severity] || 0))
})

onMounted(() => loadScanners())
</script>

<template>
  <div class="real-scan">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="深度扫描 = 真实开源工具"
      description="semgrep（SAST）、trivy（依赖漏洞/密钥）、bandit（Python SAST）、nikto/nmap（DAST）。产出带 CVE/CWE 与 file:line 的可复现证据，结果直接落库为安全报告。"
      class="mb12"
    />

    <!-- 工具状态 -->
    <el-card shadow="never" class="mb12">
      <template #header>
        <div class="card-head">
          <span>扫描器状态 <el-tag size="small" type="success">{{ available.length }} 可用</el-tag>
            <el-tag v-if="unavailable.length" size="small" type="info" style="margin-left:6px">{{ unavailable.length }} 未安装</el-tag>
          </span>
          <el-button size="small" :loading="loadingTools" @click="loadScanners(true)">重新探测</el-button>
        </div>
      </template>
      <div v-loading="loadingTools" class="tool-grid">
        <div v-for="s in scanners" :key="s.id" class="tool-card" :class="{ 'tool-card--off': !s.available }">
          <div class="tool-name">
            <el-tag size="small" :type="s.available ? 'success' : 'info'">{{ s.available ? '可用' : '未安装' }}</el-tag>
            <strong>{{ s.name }}</strong>
            <el-tag size="small" effect="plain">{{ s.category.toUpperCase() }}</el-tag>
          </div>
          <div class="tool-desc">{{ s.description }}</div>
          <div class="tool-meta">
            <span v-if="s.version">{{ s.version }}</span>
            <span v-if="!s.available" class="tool-hint">安装：{{ s.installHint }}</span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 执行表单 -->
    <el-card shadow="never" class="mb12">
      <template #header><span>发起扫描</span></template>
      <el-form label-width="92px" @submit.prevent>
        <el-form-item label="扫描模式">
          <el-radio-group v-model="mode" @change="onModeChange">
            <el-radio-button value="source">源码/依赖（SAST+SCA）</el-radio-button>
            <el-radio-button value="url">Web 目标（DAST）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="mode === 'url' ? '目标 URL' : '源码路径'">
          <el-input
            v-model="target"
            :placeholder="mode === 'url' ? 'https://example.com' : '留空默认扫描整个项目；也可填项目内目录'"
            clearable
          />
        </el-form-item>
        <el-form-item label="使用工具">
          <el-checkbox-group v-model="selectedTools">
            <el-checkbox v-for="s in candidates" :key="s.id" :value="s.id">{{ s.name }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="running" :disabled="!candidates.length" @click="runScan">
            {{ running ? '扫描中…' : '开始深度扫描' }}
          </el-button>
          <span class="hint">源码扫描通常 20–60 秒；DAST 受目标响应速度影响</span>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 结果 -->
    <el-card v-if="result" shadow="never">
      <template #header>
        <div class="card-head">
          <span>
            扫描结果
            <el-tag size="small" type="danger" style="margin-left:8px">共 {{ result.summary.total }} 条</el-tag>
            <el-tag size="small" style="margin-left:6px">评分 {{ result.summary.score }}</el-tag>
            <el-tag size="small" type="success" style="margin-left:6px">报告 #{{ result.reportId }}</el-tag>
          </span>
        </div>
      </template>

      <div class="summary-row">
        <div v-for="s in ['critical','high','medium','low','info']" :key="s" class="summary-item">
          <span class="summary-label">{{ sevLabel[s] }}</span>
          <span class="summary-count" :class="`sev--${s}`">{{ result.summary.severityDist?.[s] || 0 }}</span>
        </div>
        <div class="summary-tools">
          <el-tag v-for="(n, tool) in result.summary.byTool" :key="tool" size="small" effect="plain" style="margin-right:6px">
            {{ tool }}: {{ n }}
          </el-tag>
        </div>
      </div>

      <el-table :data="sortedFindings" size="small" stripe max-height="520">
        <el-table-column prop="severity" label="严重" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="sevTag(row.severity)">{{ sevLabel[row.severity] || row.severity }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="tool" label="工具" width="100" />
        <el-table-column prop="category" label="类型" width="90" />
        <el-table-column prop="title" label="问题" min-width="240" show-overflow-tooltip />
        <el-table-column prop="location" label="位置" min-width="200" show-overflow-tooltip />
        <el-table-column prop="cve" label="CVE" width="150">
          <template #default="{ row }">
            <code v-if="row.cve" class="text-mono">{{ row.cve }}</code>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="cwe" label="CWE" width="100">
          <template #default="{ row }">
            <code v-if="row.cwe" class="text-mono">{{ row.cwe }}</code>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.mb12 { margin-bottom: 12px; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.tool-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.tool-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; }
.tool-card--off { opacity: 0.62; background: var(--el-fill-color-lighter); }
.tool-name { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.tool-desc { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.5; }
.tool-meta { margin-top: 6px; font-size: 12px; color: var(--el-text-color-placeholder); display: flex; flex-direction: column; gap: 2px; }
.tool-hint { color: var(--el-color-warning); }
.summary-row { display: flex; align-items: center; gap: 18px; margin-bottom: 12px; flex-wrap: wrap; }
.summary-item { display: flex; align-items: baseline; gap: 6px; }
.summary-label { font-size: 12px; color: var(--el-text-color-secondary); }
.summary-count { font-size: 20px; font-weight: 600; }
.sev--critical { color: #c45656; }
.sev--high { color: #e6a23c; }
.sev--medium { color: #d4a017; }
.sev--low { color: #409eff; }
.sev--info { color: #909399; }
.summary-tools { margin-left: auto; }
.text-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.text-muted { color: var(--el-text-color-placeholder); }
.hint { margin-left: 12px; font-size: 12px; color: var(--el-text-color-placeholder); }
</style>
