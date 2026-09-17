<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useMainStore } from '@/stores/main'
import { adminApi } from '@/api/index'
import { ElMessage, ElMessageBox } from 'element-plus'

// Store
const mainStore = useMainStore()

// 权限
const isAdmin = computed(() => mainStore.isAdmin)

// 任务超时设置
const taskTimeoutMinutes = ref(30)
const taskCleanupThreshold = ref(10)
const configDescription = ref({
  task_timeout_minutes: '',
  task_cleanup_threshold: '',
})

// 长时间任务列表
const longRunningTasks = ref<any[]>([])
const loadingTasks = ref(false)
const loadingConfig = ref(false)
const savingConfig = ref(false)
const cleaning = ref(false)

// 成本配置
const hourlySalary = ref(62.5)
const manualConfigForm = ref<Record<string, number>>({
  'requirement-analysis': 120,
  'test-case-generation': 15,
  'api-test': 30,
  'ui-test': 45,
  'report-generation': 60,
  'default': 30
})
const savingCost = ref(false)
const loadingCost = ref(false)
const refreshingToken = ref(false)

const taskTypeLabel = (key: string): string => {
  const labels: Record<string, string> = {
    'requirement-analysis': '需求分析',
    'test-case-generation': '用例生成',
    'api-test': '接口测试',
    'ui-test': 'UI 测试',
    'report-generation': '报告生成',
    'default': '默认（其他类型）'
  }
  return labels[key] || key
}

async function loadCostConfig() {
  loadingCost.value = true
  try {
    const cfg = await adminApi.getCostConfig()
    if (cfg) {
      hourlySalary.value = cfg.hourlySalary
      // 保留前端声明的所有 key，避免后端缺 key
      manualConfigForm.value = {
        'requirement-analysis': cfg.manualConfig['requirement-analysis'] ?? 120,
        'test-case-generation': cfg.manualConfig['test-case-generation'] ?? 15,
        'api-test': cfg.manualConfig['api-test'] ?? 30,
        'ui-test': cfg.manualConfig['ui-test'] ?? 45,
        'report-generation': cfg.manualConfig['report-generation'] ?? 60,
        'default': cfg.manualConfig['default'] ?? 30
      }
    }
  } catch (e: any) {
    ElMessage.error('加载成本配置失败：' + (e.message || e))
  } finally {
    loadingCost.value = false
  }
}

async function saveCostConfig() {
  savingCost.value = true
  try {
    const ok = await adminApi.updateCostConfig({
      hourlySalary: hourlySalary.value,
      manualConfig: manualConfigForm.value
    })
    if (ok) {
      ElMessage.success('成本配置已保存，下次聚合生效')
    } else {
      ElMessage.error('保存失败')
    }
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e.message || e))
  } finally {
    savingCost.value = false
  }
}

function resetCostConfig() {
  // 恢复默认成本配置（前端硬编码默认值，点击「保存成本配置」后提交后端）
  hourlySalary.value = 93.77
  manualConfigForm.value = {
    'requirement-analysis': 120,
    'test-case-generation': 15,
    'api-test': 30,
    'ui-test': 45,
    'report-generation': 60,
    'default': 30
  }
  ElMessage.info('已恢复默认成本配置，点击「保存成本配置」生效')
}

// 加载配置
async function loadConfig() {
  loadingConfig.value = true
  try {
    const config = await adminApi.getSystemConfig()
    if (config) {
      taskTimeoutMinutes.value = parseInt(config['task_timeout_minutes']?.value || '30')
      taskCleanupThreshold.value = parseInt(config['task_cleanup_threshold']?.value || '10')
      configDescription.value = {
        task_timeout_minutes: config['task_timeout_minutes']?.description || '',
        task_cleanup_threshold: config['task_cleanup_threshold']?.description || '',
      }
    }
  } catch (e: any) {
    ElMessage.error('加载系统配置失败：' + e.message)
  } finally {
    loadingConfig.value = false
  }
}

// 加载长时间任务列表
async function loadLongRunningTasks() {
  loadingTasks.value = true
  try {
    longRunningTasks.value = await adminApi.getLongRunningTasks(taskCleanupThreshold.value)
  } catch (e: any) {
    ElMessage.error('加载任务列表失败：' + e.message)
  } finally {
    loadingTasks.value = false
  }
}

// 保存超时阈值配置
async function saveConfig() {
  savingConfig.value = true
  try {
    const ok = await adminApi.updateSystemConfig({
      task_timeout_minutes: String(taskTimeoutMinutes.value),
      task_cleanup_threshold: String(taskCleanupThreshold.value),
    })
    if (ok) {
      ElMessage.success('配置已保存')
      await loadLongRunningTasks()
    } else {
      ElMessage.error('保存失败')
    }
  } catch (e: any) {
    ElMessage.error('保存失败：' + e.message)
  } finally {
    savingConfig.value = false
  }
}

// 执行清理
async function doCleanup() {
  const confirm = await ElMessageBox.confirm(
    `确定要终止并清除所有运行超过 ${taskCleanupThreshold.value} 分钟的任务/工作流吗？\n\n这些条目将被标记为「失败」并从队列中移除。已产生的交付物不会丢失。`,
    '确认终止并清除超时条目',
    {
      confirmButtonText: '确认终止并清除',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).catch(() => false)

  if (!confirm) return

  cleaning.value = true
  try {
    const result = await adminApi.cleanupTimeoutTasks()
    if (result.success) {
      ElMessage.success(result.message)
      await loadLongRunningTasks()
    } else {
      ElMessage.error(result.message || result.error || '操作失败')
    }
  } catch (e: any) {
    ElMessage.error('清理失败：' + (e?.message || e?.error || '未知错误'))
  } finally {
    cleaning.value = false
  }
}

// 工作流 mode → 中文标签
function modeLabel(mode: string): string {
  const labels: Record<string, string> = {
    'general': '普通任务',
    'evaluation-task': '评估任务',
    'evaluation-full': '全面评估',
    'auto-with-review': '审核流水线',
    'auto-native': '自动流水线',
    'interactive': '交互式',
    'features': '特性测试',
    'workflow': '测试流水线',
  }
  return labels[mode] || mode
}

// 格式化时间
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
}

onMounted(async () => {
  if (!isAdmin) {
    ElMessage.warning('只有管理员可以访问系统设置')
    return
  }
  await loadConfig()
  await loadLongRunningTasks()
  await loadCostConfig()
})
</script>

<template>
  <div class="settings-view" v-if="isAdmin">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2>⚙️ 系统设置</h2>
    </div>

    <!-- 任务超时管理 -->
    <el-card class="settings-card">
      <template #header>
        <div class="card-header">
          <span>⏱️ 任务超时管理</span>
        </div>
      </template>

      <!-- 说明 -->
      <el-alert
        title="说明"
        type="info"
        :closable="false"
        style="margin-bottom: 20px"
      >
        <template #default>
          系统会自动监控任务运行时间。当任务持续超过「自动清理阈值」指定的时间，管理员可一键终止并清除这些任务（状态置为失败 + 从队列移除），避免资源被僵尸任务占用。
        </template>
      </el-alert>

      <!-- 配置表单 -->
      <el-form label-width="160" style="max-width: 600px">
        <el-form-item label="自动清理阈值">
          <el-input-number
            v-model="taskCleanupThreshold"
            :min="1"
            :max="1440"
            style="width: 200px"
          />
          <span style="margin-left: 12px; color: var(--text-secondary)">分钟</span>
          <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
            {{ configDescription.task_cleanup_threshold || '超过此时间未完成的任务，管理员可一键终止并从队列清除' }}
          </div>
        </el-form-item>

        <el-form-item label="任务超时时间">
          <el-input-number
            v-model="taskTimeoutMinutes"
            :min="1"
            :max="1440"
            style="width: 200px"
          />
          <span style="margin-left: 12px; color: var(--text-secondary)">分钟</span>
          <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
            {{ configDescription.task_timeout_minutes || '任务超过此时间将视为超时' }}
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="savingConfig" @click="saveConfig">
            保存设置
          </el-button>
          <el-button :loading="loadingTasks" @click="loadLongRunningTasks">
            刷新列表
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 超时任务列表 + 清理 -->
    <el-card class="settings-card" style="margin-top: 16px">
      <template #header>
        <div class="card-header">
          <span>🔴 超时任务列表</span>
          <span style="font-size: 13px; color: var(--text-secondary); font-weight: normal">
            （超过 {{ taskCleanupThreshold }} 分钟未完成的任务）
          </span>
        </div>
      </template>

      <!-- 清理按钮 -->
      <div style="margin-bottom: 16px">
        <el-button
          type="danger"
          :loading="cleaning"
          :disabled="longRunningTasks.length === 0"
          @click="doCleanup"
        >
          🚨 终止并清除超时任务
        </el-button>
        <span v-if="longRunningTasks.length > 0" style="margin-left: 12px; color: var(--text-secondary)">
          共 {{ longRunningTasks.length }} 个任务待终止清除
        </span>
        <span v-else style="margin-left: 12px; color: #67c23a">
          ✓ 当前没有超时任务
        </span>
      </div>

      <!-- 任务表格 -->
      <el-table
        :data="longRunningTasks"
        stripe
        v-loading="loadingTasks"
        :empty-text="longRunningTasks.length === 0 && !loadingTasks ? '🎉 当前没有超时任务' : '加载中...'"
        style="width: 100%"
      >
        <el-table-column label="任务ID" min-width="200">
          <template #default="{ row }">
            <span style="font-family: monospace; font-size: 12px; color: var(--text-secondary)">
              {{ row.id }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="160">
          <template #default="{ row }">
            <template v-if="row.source === 'workflow'">
              <el-tag size="small" type="danger">流水线</el-tag>
              <span style="margin-left:4px;font-size:12px">{{ modeLabel(row.type) }}</span>
            </template>
            <template v-else>
              <el-tag size="small" :type="row.type === 'evaluation-full' ? 'warning' : 'info'">
                {{ modeLabel(row.type) }}
              </el-tag>
            </template>
          </template>
        </el-table-column>
        <el-table-column prop="agent_id" label="智能体" width="160" />
        <el-table-column prop="user_id" label="用户" width="180">
          <template #default="{ row }">
            <span style="font-size: 12px; color: var(--text-secondary)">
              {{ row.user_id }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="持续时间" width="140">
          <template #default="{ row }">
            <span style="color: #f56c6c; font-weight: 600">
              {{ formatDuration(row.minutes_running) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="最后更新时间" width="170">
          <template #default="{ row }">
            {{ new Date(row.updated_at).toLocaleString('zh-CN') }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 成本配置 -->
    <el-card class="settings-card" style="margin-top: 16px">
      <template #header>
        <div class="card-header">
          <span>💰 成本配置（影响提效统计中的预估/实际/节省成本）</span>
        </div>
      </template>

      <el-alert
        title="说明"
        type="info"
        :closable="false"
        style="margin-bottom: 20px"
      >
        <template #default>
          <p style="margin: 0 0 8px"><strong>小时工资单价</strong>：用于计算「人工预估成本」和「实际自动化成本」（成本 = 耗时 × 单价）。默认 62.5 元/小时（来自 500 元/人日 × 8 小时）。</p>
          <p style="margin: 0"><strong>人工预估耗时</strong>：按任务类型配置「如果由人工完成所需时间」，用于衡量自动化节省的时间成本。</p>
        </template>
      </el-alert>

      <el-form label-width="160" style="max-width: 720px">
        <el-form-item label="小时工资单价">
          <el-input-number
            v-model="hourlySalary"
            :min="0"
            :max="10000"
            :step="0.5"
            :precision="2"
            style="width: 200px"
          />
          <span style="margin-left: 12px; color: var(--text-secondary)">元/小时</span>
          <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
            修改后内存缓存立即生效，下次定时聚合将按新价格重算今日数据。
          </div>
        </el-form-item>

        <!-- 人工预估耗时配置已移除 - 现由智能体自动评估工作量 -->
        <!--
        <el-form-item label="人工预估耗时（按任务类型）">
          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%">
            <el-row v-for="(minutes, type) in manualConfigForm" :key="type" :gutter="12" align="middle">
              <el-col :span="6">
                <span style="color: var(--text-color-primary); font-weight: 500">{{ taskTypeLabel(type) }}</span>
              </el-col>
              <el-col :span="10">
                <el-input-number
                  v-model="manualConfigForm[type]"
                  :min="0"
                  :max="1440"
                  :step="5"
                  style="width: 100%"
                />
              </el-col>
              <el-col :span="4">
                <span style="color: var(--text-secondary)">分钟/任务</span>
              </el-col>
            </el-row>
          </div>
        </el-form-item>
        -->

        <el-form-item>
          <el-button type="primary" :loading="savingCost" @click="saveCostConfig">
            保存成本配置
          </el-button>
          <el-button @click="resetCostConfig" plain>
            恢复默认值
          </el-button>
          <el-button @click="loadCostConfig" plain :loading="loadingCost">
            刷新
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>

  <!-- 无权限提示 -->
  <div v-else class="no-access">
    <div style="text-align: center; padding: 60px">
      <div style="font-size: 48px; margin-bottom: 16px">🔒</div>
      <h3>无权访问</h3>
      <p style="color: var(--text-secondary)">系统设置仅对管理员开放</p>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 24px;
  max-width: 1200px;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h2 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}

.settings-card {
  margin-bottom: 0;
}

.card-header {
  font-size: 15px;
  font-weight: 600;
}

.no-access {
  padding: 40px;
}
</style>
