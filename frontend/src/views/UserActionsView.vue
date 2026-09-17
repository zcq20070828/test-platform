<template>
  <div class="user-actions-view" v-loading="loading">
    <!-- 顶部：返回 + 筛选栏 -->
    <el-card shadow="hover">
      <div class="toolbar">
        <el-button @click="goBack" :icon="ArrowLeft">返回统计概览</el-button>
        <span class="page-title">👣 用户行为明细</span>
        <div class="filters">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 260px"
            @change="onFilterChange"
          />
          <el-select v-model="actionFilter" placeholder="行为类型" clearable style="width: 160px" @change="onFilterChange">
            <el-option v-for="a in ACTION_OPTIONS" :key="a.value" :label="a.label" :value="a.value" />
          </el-select>
          <el-select v-model="userFilter" placeholder="用户" clearable filterable style="width: 160px" @change="onFilterChange">
            <el-option v-for="u in userOptions" :key="u.value" :label="u.label" :value="u.value" />
          </el-select>
          <el-button type="primary" :icon="Refresh" @click="loadAll">刷新</el-button>
        </div>
      </div>
    </el-card>

    <el-row :gutter="20" style="margin-top: 20px">
      <!-- 左侧：行为统计概览 -->
      <el-col :span="14">
        <el-card shadow="hover">
          <template #header>
            <span>📊 用户行为统计概览</span>
          </template>
          <el-row :gutter="16" class="stat-numbers">
            <el-col :span="8">
              <div class="stat-item">
                <div class="stat-value">{{ statsData.total ?? 0 }}</div>
                <div class="stat-label">总行为次数</div>
              </div>
            </el-col>
            <el-col :span="8">
              <div class="stat-item">
                <div class="stat-value">{{ statsData.loginCount ?? 0 }}</div>
                <div class="stat-label">登录次数</div>
              </div>
            </el-col>
            <el-col :span="8">
              <div class="stat-item">
                <div class="stat-value">{{ (statsData.byUser || []).length }}</div>
                <div class="stat-label">活跃用户数</div>
              </div>
            </el-col>
          </el-row>

          <el-divider content-position="left">按行为类型分布</el-divider>
          <div v-if="(statsData.byAction || []).length === 0" class="empty-hint">暂无数据</div>
          <div v-for="item in statsData.byAction || []" :key="item.action" class="bar-row">
            <span class="bar-label">{{ actionLabel(item.action) }}</span>
            <el-progress
              :percentage="barPercent(item.count)"
              :stroke-width="14"
              :show-text="false"
              class="bar-progress"
            />
            <span class="bar-count">{{ item.count }}</span>
          </div>

          <el-divider content-position="left">按资源类型分布</el-divider>
          <div v-if="(statsData.byResource || []).length === 0" class="empty-hint">暂无数据</div>
          <el-tag
            v-for="item in statsData.byResource || []"
            :key="item.resource_type || 'null'"
            class="resource-tag"
            type="info"
          >
            {{ item.resource_type || '(未指定)' }}: {{ item.count }}
          </el-tag>
        </el-card>
      </el-col>

      <!-- 右侧：使用时长 TOP10 -->
      <el-col :span="10">
        <el-card shadow="hover">
          <template #header>
            <span>⏱️ 使用时长 TOP10 用户</span>
          </template>
          <el-table :data="(statsData.userUsage || []).slice(0, 10)" stripe size="small">
            <el-table-column type="index" label="#" width="45" />
            <el-table-column label="用户" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">{{ row.display_name || row.user_id || "(匿名)" }}</template>
            </el-table-column>
            <el-table-column prop="action_count" label="行为数" width="80" sortable />
            <el-table-column label="使用时长" width="120">
              <template #default="{ row }">
                {{ formatDuration(row.duration_seconds) }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <!-- 底部：行为明细列表 -->
    <el-card shadow="hover" style="margin-top: 20px">
      <template #header>
        <span>📋 行为明细列表</span>
      </template>
      <el-table :data="actionList" stripe size="small">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="用户" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.display_name || row.user_id || '(匿名)' }}
          </template>
        </el-table-column>
        <el-table-column label="行为" width="130">
          <template #default="{ row }">
            <el-tag size="small">{{ actionLabel(row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="resource_type" label="资源类型" width="110">
          <template #default="{ row }">
            {{ row.resource_type || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="resource_id" label="资源ID" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.resource_id || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="元数据" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="meta-text">{{ row.metadata ? JSON.stringify(row.metadata) : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时长" width="100">
          <template #default="{ row }">
            <span v-if="row.duration_ms != null && row.duration_ms > 0" :class="durationClass(row.duration_ms)">
              {{ formatDuration(row.duration_ms) }}
            </span>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="ip_address" label="IP" width="130" show-overflow-tooltip />
        <el-table-column prop="created_at" label="时间" width="170">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadList"
          @size-change="onSizeChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import { userActionApi } from '@/api'

const router = useRouter()
const loading = ref(false)
const statsData = ref<any>({})
const actionList = ref<any[]>([])
const dateRange = ref<[string, string] | null>(null)
const actionFilter = ref('')
const userFilter = ref('')
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)

// action 类型预设值
const ACTION_OPTIONS = [
  { value: 'login', label: '登录' },
  { value: 'logout', label: '登出' },
  { value: 'task_create', label: '创建任务' },
  { value: 'task_complete', label: '完成任务' },
  { value: 'kb_upload', label: '知识库上传' },
  { value: 'evaluation_run', label: '运行评估' },
  { value: 'defect_create', label: '创建缺陷' },
  { value: 'page_view', label: '页面访问' },
  { value: 'page_leave', label: '页面离开' },
  { value: 'workflow_run', label: '运行工作流' },
]

const actionLabelMap: Record<string, string> = Object.fromEntries(
  ACTION_OPTIONS.map(o => [o.value, o.label])
)
const actionLabel = (a: string) => actionLabelMap[a] || a || '-'

// 用户下拉选项（来自统计 byUser）
const userOptions = computed<{value:string,label:string}[]>(() =>
  (statsData.value.byUser || []).map((u: any) => ({ value: u.user_id, label: u.display_name || u.user_id })).filter((u: any) => u.value)
)

const maxActionCount = computed(() => {
  const list = statsData.value.byAction || []
  return list.length ? Math.max(...list.map((i: any) => Number(i.count) || 0)) : 0
})
const barPercent = (count: number) =>
  maxActionCount.value ? Math.round((Number(count) / maxActionCount.value) * 100) : 0

const buildParams = () => {
  const [start, end] = dateRange.value || ['', '']
  return {
    startDate: start || undefined,
    endDate: end ? `${end} 23:59:59` : undefined,
    action: actionFilter.value || undefined,
    userId: userFilter.value || undefined
  }
}

const loadStats = async () => {
  const params = buildParams()
  const res = await userActionApi.stats({ startDate: params.startDate, endDate: params.endDate, userId: params.userId })
  if (res.success) {
    statsData.value = (res.data as any)?.data || res.data || {}
  } else {
    ElMessage.warning(res.error || '加载行为统计失败（需要管理员权限）')
  }
}

const loadList = async () => {
  const params = buildParams()
  const res = await userActionApi.list({ ...params, page: currentPage.value, size: pageSize.value })
  if (res.success) {
    const d = (res.data as any)?.data || res.data || {}
    actionList.value = d.items || []
    total.value = d.total || 0
  } else {
    ElMessage.error(res.error || '加载行为明细失败')
  }
}

const loadAll = async () => {
  loading.value = true
  try {
    await Promise.all([loadStats(), loadList()])
  } finally {
    loading.value = false
  }
}

const onFilterChange = () => {
  currentPage.value = 1
  loadAll()
}

const onSizeChange = () => {
  currentPage.value = 1
  loadList()
}

const goBack = () => router.push('/stats')

const formatTime = (t: string) => {
  if (!t) return '-'
  try { return new Date(t).toLocaleString('zh-CN', { hour12: false }) } catch { return t }
}

const formatDuration = (ms: number) => {
  const totalSec = Math.round((Number(ms) || 0) / 1000)
  if (totalSec <= 0) return '-'
  if (totalSec < 60) return `${totalSec}秒`
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}分${totalSec % 60}秒`
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  return `${h}小时${m}分`
}

const durationClass = (ms: number) => {
  const sec = (Number(ms) || 0) / 1000
  if (sec >= 60) return 'duration-long'
  if (sec >= 10) return 'duration-mid'
  return 'duration-short'
}

onMounted(loadAll)
</script>

<style scoped>
.user-actions-view {
  padding: 20px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.page-title {
  font-size: 16px;
  font-weight: 600;
}
.filters {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  flex-wrap: wrap;
}
.stat-numbers {
  margin-bottom: 8px;
}
.stat-item {
  text-align: center;
  padding: 8px 0;
}
.stat-value {
  font-size: 26px;
  font-weight: 700;
  color: #409eff;
}
.stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.bar-label {
  width: 90px;
  font-size: 13px;
  text-align: right;
  flex-shrink: 0;
}
.bar-progress {
  flex: 1;
}
.bar-count {
  width: 50px;
  font-size: 13px;
  color: #606266;
}
.resource-tag {
  margin: 0 8px 8px 0;
}
.empty-hint {
  color: #909399;
  font-size: 13px;
  padding: 8px 0;
}
.meta-text {
  font-size: 12px;
  color: #909399;
}
.muted { color: #c0c4cc; }
.duration-short { color: #909399; }
.duration-mid { color: #E6A23C; font-weight: 500; }
.duration-long { color: #67C23A; font-weight: 600; }
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
