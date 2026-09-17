<template>
  <div class="tools-page">
    <div class="page-header">
      <h1>🛠️ 工具管理</h1>
      <p class="subtitle">自动化测试 & 安全测试工具安装</p>
    </div>

    <!-- 平台选择 -->
    <div class="platform-selector">
      <span class="label">您的操作系统：</span>
      <el-radio-group v-model="selectedPlatform" @change="clearSelection">
        <el-radio-button value="mac">macOS</el-radio-button>
        <el-radio-button value="linux">Linux</el-radio-button>
        <el-radio-button value="windows">Windows</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 自动化测试工具 -->
    <div class="tool-section">
      <div class="section-header">
        <h2>📊 自动化测试</h2>
        <el-checkbox v-model="selectAll.automation" @change="toggleSelectAll('automation')">
          全选
        </el-checkbox>
      </div>
      <div class="tool-grid">
        <div
          v-for="tool in automationTools"
          :key="tool.id"
          class="tool-card"
          :class="{ selected: selectedTools.includes(tool.id) }"
          @click="toggleTool(tool.id)"
        >
          <el-checkbox :model-value="selectedTools.includes(tool.id)" @click.stop />
          <div class="tool-info">
            <div class="tool-name">{{ tool.name }}</div>
            <div class="tool-desc">{{ tool.desc }}</div>
          </div>
          <el-button
            size="small"
            text
            @click.stop="showInstallCommand(tool)"
          >
            查看安装命令
          </el-button>
        </div>
      </div>
    </div>

    <!-- 安全测试工具 -->
    <div class="tool-section">
      <div class="section-header">
        <h2>🔐 安全测试</h2>
        <el-checkbox v-model="selectAll.security" @change="toggleSelectAll('security')">
          全选
        </el-checkbox>
      </div>
      <div class="tool-grid">
        <div
          v-for="tool in securityTools"
          :key="tool.id"
          class="tool-card"
          :class="{ selected: selectedTools.includes(tool.id) }"
          @click="toggleTool(tool.id)"
        >
          <el-checkbox :model-value="selectedTools.includes(tool.id)" @click.stop />
          <div class="tool-info">
            <div class="tool-name">{{ tool.name }}</div>
            <div class="tool-desc">{{ tool.desc }}</div>
          </div>
          <el-button
            size="small"
            text
            @click.stop="showInstallCommand(tool)"
          >
            查看安装命令
          </el-button>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="action-bar" v-if="selectedTools.length > 0">
      <div class="selected-count">
        已选择 {{ selectedTools.length }} 个工具
      </div>
      <el-button type="primary" @click="downloadInstallScript" :loading="generating">
        📥 下载安装脚本
      </el-button>
      <el-button @click="copyInstallCommands">
        📋 复制安装命令
      </el-button>
    </div>

    <!-- 安装命令弹窗 -->
    <el-dialog v-model="commandDialogVisible" :title="currentTool?.name + ' 安装命令'" width="500">
      <div class="command-dialog">
        <div class="platform-tabs">
          <el-radio-group v-model="dialogPlatform" size="small">
            <el-radio-button value="mac">macOS</el-radio-button>
            <el-radio-button value="linux">Linux</el-radio-button>
            <el-radio-button value="windows">Windows</el-radio-button>
          </el-radio-group>
        </div>
        <div class="command-box">
          <code>{{ currentTool?.installCommands[dialogPlatform] }}</code>
        </div>
        <div class="dialog-actions">
          <el-button type="primary" @click="copyCommand">复制命令</el-button>
          <el-button @click="commandDialogVisible = false">关闭</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { toolsApi } from '@/api'

const selectedPlatform = ref<'mac' | 'linux' | 'windows'>('mac')
const allTools = ref<any[]>([])
const selectedTools = ref<string[]>([])
const selectAll = ref({ automation: false, security: false })
const generating = ref(false)

const commandDialogVisible = ref(false)
const currentTool = ref<any>(null)
const dialogPlatform = ref<'mac' | 'linux' | 'windows'>('mac')

const automationTools = computed(() => allTools.value.filter(t => t.category === 'automation'))
const securityTools = computed(() => allTools.value.filter(t => t.category === 'security'))

async function loadTools() {
  const tools = await toolsApi.list()
  allTools.value = tools
}

function toggleTool(toolId: string) {
  const idx = selectedTools.value.indexOf(toolId)
  if (idx >= 0) {
    selectedTools.value.splice(idx, 1)
  } else {
    selectedTools.value.push(toolId)
  }
  updateSelectAll()
}

function toggleSelectAll(category: 'automation' | 'security') {
  const tools = category === 'automation' ? automationTools.value : securityTools.value
  const toolIds = tools.map(t => t.id)
  
  if (selectAll.value[category]) {
    // 全选：添加该分类所有工具
    for (const id of toolIds) {
      if (!selectedTools.value.includes(id)) {
        selectedTools.value.push(id)
      }
    }
  } else {
    // 取消全选：移除该分类所有工具
    selectedTools.value = selectedTools.value.filter(id => !toolIds.includes(id))
  }
}

function updateSelectAll() {
  selectAll.value.automation = automationTools.value.every(t => selectedTools.value.includes(t.id))
  selectAll.value.security = securityTools.value.every(t => selectedTools.value.includes(t.id))
}

function clearSelection() {
  // 切换平台时清空选择（可选）
}

function showInstallCommand(tool: any) {
  currentTool.value = tool
  dialogPlatform.value = selectedPlatform.value
  commandDialogVisible.value = true
}

function copyCommand() {
  if (!currentTool.value) return
  const cmd = currentTool.value.installCommands[dialogPlatform.value]
  navigator.clipboard.writeText(cmd)
  ElMessage.success('已复制到剪贴板')
}

async function downloadInstallScript() {
  if (selectedTools.value.length === 0) {
    ElMessage.warning('请选择要安装的工具')
    return
  }
  
  generating.value = true
  try {
    const result = await toolsApi.generateInstallScript(selectedTools.value, selectedPlatform.value)
    if (!result) {
      ElMessage.error('生成脚本失败')
      return
    }
    
    if (result.failedTools.length > 0) {
      ElMessage.warning(`部分工具无安装命令: ${result.failedTools.join(', ')}`)
    }
    
    // 触发下载
    const blob = new Blob([result.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    a.click()
    URL.revokeObjectURL(url)
    
    ElMessage.success(`已下载 ${result.filename}，请在本地终端执行`)
  } catch (e: any) {
    ElMessage.error(`生成失败: ${e.message}`)
  } finally {
    generating.value = false
  }
}

async function copyInstallCommands() {
  if (selectedTools.value.length === 0) {
    ElMessage.warning('请选择要安装的工具')
    return
  }
  
  const commands: string[] = []
  for (const toolId of selectedTools.value) {
    const tool = allTools.value.find(t => t.id === toolId)
    if (tool) {
      const cmd = tool.installCommands[selectedPlatform.value]
      if (cmd) {
        commands.push(`# ${tool.name}`)
        commands.push(cmd)
        commands.push('')
      }
    }
  }
  
  if (commands.length === 0) {
    ElMessage.warning('所选工具在该平台无安装命令')
    return
  }
  
  navigator.clipboard.writeText(commands.join('\n'))
  ElMessage.success(`已复制 ${selectedTools.value.length} 个工具的安装命令`)
}

onMounted(loadTools)
</script>

<style scoped>
.tools-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.subtitle {
  color: #909399;
  font-size: 14px;
  margin: 0;
}

.platform-selector {
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.platform-selector .label {
  color: #606266;
  font-size: 14px;
}

.tool-section {
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.tool-card {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.tool-card:hover {
  border-color: #409eff;
  background: #ecf5ff;
}

.tool-card.selected {
  border-color: #409eff;
  background: #ecf5ff;
}

.tool-info {
  flex: 1;
}

.tool-name {
  font-weight: 600;
  font-size: 15px;
  color: #303133;
  margin-bottom: 4px;
}

.tool-desc {
  font-size: 13px;
  color: #909399;
}

.action-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.selected-count {
  color: #606266;
  font-size: 14px;
}

.command-dialog {
  padding: 8px 0;
}

.platform-tabs {
  margin-bottom: 16px;
}

.command-box {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.command-box code {
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  font-size: 13px;
  color: #303133;
  word-break: break-all;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
