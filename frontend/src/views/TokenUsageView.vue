<template>
  <div class="token-usage-view">
    <el-page-header @back="goBack" content="Token 使用明细" style="margin-bottom: 20px" />

    <!-- 筛选栏 -->
    <el-card shadow="never" style="margin-bottom: 16px">
      <el-form inline>
        <el-form-item label="日期范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="-"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            style="width: 260px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData" :loading="loading">查询</el-button>
          <el-button @click="dateRange = null; loadData()">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 汇总卡片 -->
    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-item">
            <div class="stat-value">{{ Number(stats.total_input || 0).toLocaleString() }}</div>
            <div class="stat-label">Input Tokens</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-item">
            <div class="stat-value">{{ Number(stats.total_output || 0).toLocaleString() }}</div>
            <div class="stat-label">Output Tokens</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-item">
            <div class="stat-value">{{ Number(stats.total_tokens || 0).toLocaleString() }}</div>
            <div class="stat-label">总 Tokens</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-item">
            <div class="stat-value">{{ Number(stats.total_calls || 0).toLocaleString() }}</div>
            <div class="stat-label">API 调用次数</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 提示 -->
    <el-alert v-if="Number(stats.total_calls || 0) === 0" type="info" :closable="false" style="margin-bottom:16px">
      暂无 Token 消耗记录。智能体调用时会自动记录 Token 消耗（需等待下次调用完成后生效）。
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { request } from '@/api'

const router = useRouter()
const loading = ref(false)
const stats = ref<any>({})
const dateRange = ref<[string, string] | null>(null)

const goBack = () => router.push('/stats')

const loadData = async () => {
  loading.value = true
  try {
    const [start, end] = dateRange.value || ['', '']
    const params = new URLSearchParams()
    if (start) params.set('startDate', start)
    if (end) params.set('endDate', end)
    const qs = params.toString()
    const res = await request<any>(`/api/token-stats${qs ? '?' + qs : ''}`)
    stats.value = res.data || {}
  } catch (e: any) {
    ElMessage.error('加载 Token 统计失败: ' + (e.message || ''))
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.token-usage-view { padding: 20px; background: var(--el-bg-color-page); min-height: 100vh; }
.stat-item { text-align: center; }
.stat-value { font-size: 24px; font-weight: bold; color: var(--el-text-color-primary); margin-bottom: 8px; }
.stat-label { font-size: 14px; color: var(--el-text-color-secondary); }
</style>
