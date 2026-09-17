<template>
  <div class="admin-tools-view">
    <!-- 头部 -->
    <div class="view-header">
      <div>
        <h2 class="view-title">🔧 工具管理</h2>
        <p class="view-subtitle">自动化测试 · 安全测试 · 一键预装</p>
      </div>
      <div class="header-actions">
        <el-button @click="loadStatus" :icon="Refresh" circle :loading="loading" />
      </div>
    </div>

    <!-- 统计概览 -->
    <el-row :gutter="12" class="stat-cards">
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-icon">🛡️</div>
          <div class="stat-info">
            <div class="stat-value">{{ securityTools.length }}</div>
            <div class="stat-label">安全工具</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-icon">⚡</div>
          <div class="stat-info">
            <div class="stat-value">{{ automationTools.length }}</div>
            <div class="stat-label">自动化工具</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card stat-card--success">
          <div class="stat-icon">✅</div>
          <div class="stat-info">
            <div class="stat-value">{{ installedCount }}</div>
            <div class="stat-label">已安装</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card" :class="{ 'stat-card--danger': notInstalledCount > 0 }">
          <div class="stat-icon">⬇️</div>
          <div class="stat-info">
            <div class="stat-value">{{ notInstalledCount }}</div>
            <div class="stat-label">待安装</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 一键安装按钮 -->
    <div class="install-all-section">
      <div class="install-all-card">
        <div class="install-all-info">
          <div class="install-all-icon">🚀</div>
          <div class="install-all-text">
            <h3>一键预装全部工具</h3>
            <p>自动安装 {{ notInstalledCount }} 个未安装工具，已安装的自动跳过</p>
          </div>
        </div>
        <div class="install-all-actions">
          <el-button
            type="primary"
            size="large"
            :loading="installing"
            :disabled="notInstalledCount === 0"
            @click="handleInstallAll"
          >
            {{ installing ? '安装中...' : `🚀 一键安装 (${notInstalledCount})` }}
          </el-button>
          <el-button size="large" @click="handleInstallSecurity" :disabled="installing">
            🛡️ 仅安全工具
          </el-button>
          <el-button size="large" @click="handleInstallAutomation" :disabled="installing">
            ⚡ 仅自动化工具
          </el-button>
        </div>
      </div>
    </div>

    <!-- 安装进度弹窗 -->
    <el-dialog
      v-model="progressDialogVisible"
      title="📦 工具安装进度"
      width="680px"
      :close-on-click-modal="false"
      :show-close="!installing"
    >
      <div class="progress-content">
        <div class="progress-header">
          <el-progress
            :percentage="installProgress"
            :status="installProgress >= 100 ? 'success' : ''"
            :stroke-width="14"
          />
          <span class="progress-text">
            {{ installProgress }}% ({{ completedCount }}/{{ totalCount }})
          </span>
        </div>

        <!-- 当前安装中 -->
        <div v-if="currentTool" class="current-tool">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在安装: <strong>{{ currentTool }}</strong></span>
        </div>

        <!-- 日志列表 -->
        <div class="log-list">
          <div
            v-for="(log, idx) in installLogs"
            :key="idx"
            class="log-item"
            :class="`log-${log.level}`"
          >
            <span class="log-time">{{ formatTime(log.time) }}</span>
            <span class="log-message">{{ log.message }}</span>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button v-if="!installing" type="primary" @click="progressDialogVisible = false">
          完成
        </el-button>
        <el-button v-if="!installing && installLogs.some(l => !l.success)" type="warning" @click="loadStatus">
          刷新状态
        </el-button>
      </template>
    </el-dialog>

    <!-- 安全测试工具 -->
    <div class="tools-section">
      <h3 class="section-title">🛡️ 安全测试工具</h3>
      <div class="tools-grid">
        <div
          v-for="tool in securityTools"
          :key="tool.id"
          class="tool-card"
          :class="{ 'tool-card--installed': tool.installed }"
        >
          <div class="tool-icon">{{ getToolEmoji(tool.id) }}</div>
          <div class="tool-info">
            <div class="tool-name">{{ tool.name || tool.id }}</div>
            <div class="tool-desc">{{ tool.desc }}</div>
            <div v-if="tool.version" class="tool-version">v{{ tool.version }}</div>
          </div>
          <div class="tool-status">
            <el-tag v-if="tool.installed" type="success" size="small">✅ 已安装</el-tag>
            <el-tag v-else type="info" size="small">⬇️ 未安装</el-tag>
          </div>
          <div class="tool-action">
            <el-button
              v-if="!tool.installed"
              type="primary"
              size="small"
              :loading="installingTool === tool.id"
              @click="handleInstallOne(tool)"
            >
              安装
            </el-button>
            <el-button
              v-else
              type="warning"
              size="small"
              :loading="installingTool === tool.id"
              @click="handleUpgradeOne(tool)"
            >
              升级
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 自动化测试工具 -->
    <div class="tools-section">
      <h3 class="section-title">⚡ 自动化测试工具</h3>
      <div class="tools-grid">
        <div
          v-for="tool in automationTools"
          :key="tool.id"
          class="tool-card"
          :class="{ 'tool-card--installed': tool.installed }"
        >
          <div class="tool-icon">{{ getToolEmoji(tool.id) }}</div>
          <div class="tool-info">
            <div class="tool-name">{{ tool.name || tool.id }}</div>
            <div class="tool-desc">{{ tool.desc }}</div>
            <div v-if="tool.version" class="tool-version">v{{ tool.version }}</div>
          </div>
          <div class="tool-status">
            <el-tag v-if="tool.installed" type="success" size="small">✅ 已安装</el-tag>
            <el-tag v-else type="info" size="small">⬇️ 未安装</el-tag>
          </div>
          <div class="tool-action">
            <el-button
              v-if="!tool.installed"
              type="primary"
              size="small"
              :loading="installingTool === tool.id"
              @click="handleInstallOne(tool)"
            >
              安装
            </el-button>
            <el-button
              v-else
              type="warning"
              size="small"
              :loading="installingTool === tool.id"
              @click="handleUpgradeOne(tool)"
            >
              升级
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Loading } from '@element-plus/icons-vue'
import { toolsApi } from '@/api'

// 状态
const loading = ref(false)
const toolsMap = ref<Record<string, any>>({})
let eventSource: EventSource | null = null

// 安装相关
const installing = ref(false)
const installingTool = ref<string | null>(null)
const progressDialogVisible = ref(false)
const installProgress = ref(0)
const installLogs = ref<Array<{time: number; level: string; message: string; success?: boolean}>>([])
const completedCount = ref(0)
const totalCount = ref(0)
const currentTool = ref('')
let currentInstallId = ''

// 工具列表
const allTools = computed(() => Object.values(toolsMap.value))
const securityTools = computed(() => allTools.value.filter((t: any) => t.category === 'security'))
const automationTools = computed(() => allTools.value.filter((t: any) => t.category === 'automation'))
const installedCount = computed(() => allTools.value.filter((t: any) => t.installed).length)
const notInstalledCount = computed(() => allTools.value.filter((t: any) => !t.installed).length)

// 工具 emoji
const toolEmojis: Record<string, string> = {
  nmap: '🗺️', sqlmap: '💉', nikto: '🔍', wpscan: '🌐', subfinder: '🔎',
  amass: '🌍', gobuster: '📂', dirb: '🕵️', whois: '📋', dig: '🌐',
  nslookup: '🔤', host: '🖥️', curl: '📡',
  playwright: '🎭', jest: '🃏', pytest: '🐍', k6: '⚡', jmeter: '⚙️', postmancli: '📮',
}
function getToolEmoji(id: string): string {
  return toolEmojis[id] || '🔧'
}

// 时间格式化
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

// SSE 监听
function connectSSE(installId?: string) {
  const tok = localStorage.getItem('token') || ''
  if (!tok) return

  eventSource?.close()
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(tok)}`)

  eventSource.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data)
      const id = ev.data?.installId

      if (ev.type === 'tool_install_progress' && id === currentInstallId) {
        const { toolName, message, progress } = ev.data
        currentTool.value = toolName || ''
        installLogs.value.push({ time: Date.now(), level: 'info', message })
        if (typeof progress === 'number' && progress > installProgress.value) {
          installProgress.value = progress
        }
      }

      if (ev.type === 'tool_install_done' && id === currentInstallId) {
        const { tool, toolName, success, version, skipped, error } = ev.data
        completedCount.value++
        installProgress.value = Math.round((completedCount.value / totalCount.value) * 100)
        currentTool.value = ''

        const msg = success
          ? (skipped ? `✅ ${toolName || tool} 已安装${version ? ` (v${version})` : ''}，跳过` : `✅ ${toolName || tool} 安装成功${version ? ` (v${version})` : ''}`)
          : `❌ ${toolName || tool} 安装失败: ${error}`
        installLogs.value.push({ time: Date.now(), level: success ? 'success' : 'error', message: msg, success })
      }

      if (ev.type === 'tool_install_all_done' && id === currentInstallId) {
        installing.value = false
        installingTool.value = null
        installProgress.value = 100
        installLogs.value.push({ time: Date.now(), level: 'success', message: `🎉 全部安装完成！共 ${ev.data.total} 个工具` })
        ElMessage.success('工具安装全部完成！')
        loadStatus()
      }
    } catch {}
  }

  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
  }
}

// 加载状态
async function loadStatus() {
  loading.value = true
  try {
    const res = await fetch('/api/tools/status', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    })
    const j = await res.json()
    if (j.success) {
      toolsMap.value = j.data
    }
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e?.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

// 一键全装
async function handleInstallAll() {
  await doInstallAll('all')
}

// 仅安全工具
async function handleInstallSecurity() {
  await doInstallAll('security')
}

// 仅自动化工具
async function handleInstallAutomation() {
  await doInstallAll('automation')
}

async function doInstallAll(category: string) {
  try {
    await ElMessageBox.confirm(
      category === 'all'
        ? `将安装全部未安装的工具（约 ${notInstalledCount.value} 个），是否继续？`
        : category === 'security'
        ? `将安装 ${securityTools.value.filter((t: any) => !t.installed).length} 个安全测试工具，是否继续？`
        : `将安装 ${automationTools.value.filter((t: any) => !t.installed).length} 个自动化测试工具，是否继续？`,
      '确认安装', { confirmButtonText: '开始安装', cancelButtonText: '取消', type: 'info' }
    )
  } catch { return }

  const tok = localStorage.getItem('token') || ''
  if (!tok) { ElMessage.error('请先登录'); return }

  try {
    const r = await fetch('/api/tools/install-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ category }),
    })
    const j = await r.json()
    if (!j.success || !j.data) {
      ElMessage.error('启动失败: ' + (j.error || '未知错误'))
      return
    }

    currentInstallId = j.data.installId
    totalCount.value = j.data.total
    completedCount.value = 0
    installProgress.value = 0
    installLogs.value = [{ time: Date.now(), level: 'info', message: `🚀 开始安装 ${totalCount.value} 个工具...` }]
    installing.value = true
    progressDialogVisible.value = true
    connectSSE(currentInstallId)

  } catch (e: any) {
    ElMessage.error('请求失败: ' + (e?.message || '网络错误'))
  }
}

// 安装单个
async function handleInstallOne(tool: any) {
  installingTool.value = tool.id
  const tok = localStorage.getItem('token') || ''
  try {
    const data = await toolsApi.install(tool.id, 'install')
    if (data) {
      ElMessage.success(`✅ ${tool.name} 安装已启动`)
      await loadStatus()
    }
  } catch (e: any) {
    ElMessage.error('安装失败: ' + (e?.message || '网络错误'))
  } finally {
    installingTool.value = null
  }
}

// 升级单个
async function handleUpgradeOne(tool: any) {
  installingTool.value = tool.id
  const tok = localStorage.getItem('token') || ''
  try {
    const data = await toolsApi.install(tool.id, 'upgrade')
    if (data) {
      ElMessage.success(`✅ ${tool.name} 升级已启动`)
      await loadStatus()
    }
  } catch (e: any) {
    ElMessage.error('升级失败: ' + (e?.message || '网络错误'))
  } finally {
    installingTool.value = null
  }
}

onMounted(() => {
  loadStatus()
})

onUnmounted(() => {
  eventSource?.close()
})
</script>

<style scoped>
.admin-tools-view {
  padding: 20px;
  max-width: 1100px;
  margin: 0 auto;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.view-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.view-subtitle {
  margin: 4px 0 0;
  color: #888;
  font-size: 13px;
}

.stat-cards {
  margin-bottom: 20px;
}

.stat-card {
  background: white;
  border-radius: 10px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}

.stat-card--success .stat-value { color: #67c23a; }
.stat-card--danger .stat-value { color: #f56c6c; }

.stat-icon { font-size: 28px; }

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #333;
}

.stat-label {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.install-all-section {
  margin-bottom: 24px;
}

.install-all-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 20px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.install-all-icon { font-size: 40px; margin-right: 16px; }

.install-all-text h3 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
}

.install-all-text p {
  margin: 0;
  font-size: 13px;
  opacity: 0.85;
}

.install-all-actions {
  display: flex;
  gap: 8px;
}

.install-all-actions .el-button {
  background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.4);
  color: white;
}

.install-all-actions .el-button--primary {
  background: white;
  border-color: white;
  color: #667eea;
  font-weight: 600;
}

.tools-section {
  margin-bottom: 28px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid #f0f0f0;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.tool-card {
  background: white;
  border-radius: 8px;
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  border: 2px solid transparent;
  transition: all 0.2s;
}

.tool-card--installed {
  border-color: #e1f3d8;
  background: #fafff0;
}

.tool-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.tool-icon { font-size: 28px; flex-shrink: 0; }

.tool-info { flex: 1; min-width: 0; }

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.tool-desc {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-version {
  font-size: 11px;
  color: #67c23a;
  margin-top: 2px;
}

.tool-status { flex-shrink: 0; }

.tool-action { flex-shrink: 0; }

/* 进度弹窗 */
.progress-content {
  min-height: 200px;
}

.progress-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.progress-header .el-progress {
  flex: 1;
}

.progress-text {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
}

.current-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #409eff;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #ecf5ff;
  border-radius: 6px;
}

.log-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
}

.log-item {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  border-bottom: 1px solid #f9f9f9;
}

.log-item:last-child { border-bottom: none; }

.log-time {
  color: #999;
  flex-shrink: 0;
  font-family: monospace;
}

.log-message { color: #333; }

.log-success .log-message { color: #67c23a; }
.log-error .log-message { color: #f56c6c; }
.log-info .log-message { color: #666; }
</style>
