<template>
  <div class="stats-view">
    <el-page-header @back="goBack" content="统计数据" style="margin-bottom: 20px" />

    <!-- 今日概览 -->
    <el-card class="overview-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>📊 今日概览</span>
          <div style="display:flex;gap:8px;align-items:center">
            <el-button text @click="refreshStats" :loading="loading">
              <el-icon><Refresh /></el-icon>
            </el-button>
            <el-button type="primary" link size="small" @click="router.push('/tasks')">查看任务明细 →</el-button>
          </div>
        </div>
      </template>
      <el-row :gutter="20">
        <el-col :span="4">
          <div class="stat-item" @click="router.push('/tasks')" style="cursor:pointer">
            <div class="stat-value">{{ todayStats.total_tasks || 0 }}</div>
            <div class="stat-label">任务总数</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item success">
            <div class="stat-value">{{ todayStats.completed_tasks || 0 }}</div>
            <div class="stat-label">成功任务</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item">
            <div class="stat-value">{{ todayStats.active_users || 0 }}</div>
            <div class="stat-label">活跃用户</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item primary">
            <div class="stat-value">{{ formatHours(efficiencySummary.saved_hours) }}</div>
            <div class="stat-label">今日节省</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item">
            <div class="stat-value">{{ todayStats.evaluation_count || efficiencySummary.evaluation_count || 0 }}</div>
            <div class="stat-label">评估次数</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item" :class="qualityPassRate >= 60 ? 'success' : qualityPassRate >= 40 ? 'warning' : 'danger'">
            <div class="stat-value">{{ qualityPassRate }}%</div>
            <div class="stat-label">质量达标率</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item">
            <div class="stat-value">{{ efficiencySummary.deliverable_count || 0 }}</div>
            <div class="stat-label">交付物数</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 累计统计 -->
    <el-card class="overview-card" shadow="hover" style="margin-top: 20px">
      <template #header>
        <div class="card-header">
          <span>📈 累计统计</span>
          <el-button type="primary" link size="small" @click="router.push('/tasks')">查看任务明细 →</el-button>
        </div>
      </template>
      <el-row :gutter="20">
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-value">{{ overallStats.total_tasks || 0 }}</div>
            <div class="stat-label">总任务数</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item success">
            <div class="stat-value">{{ overallStats.total_completed || 0 }}</div>
            <div class="stat-label">成功任务</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item warning">
            <div class="stat-value">{{ overallStats.total_users || 0 }}</div>
            <div class="stat-label">总用户数</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item primary">
            <div class="stat-value">{{ formatHours(overallStats.total_saved_hours) }}</div>
            <div class="stat-label">累计节省</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item" style="cursor:pointer" @click="router.push('/tasks')">
            <div class="stat-value">{{ overallStats.total_completed || 0 }}</div>
            <div class="stat-label">已完成任务(可点)</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 提效统计（本月） -->
    <el-card class="efficiency-card" shadow="hover" style="margin-top: 20px">
      <template #header>
        <div class="card-header">
          <span>💰 本月提效统计</span>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="-"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 260px"
            @change="loadEfficiency"
          />
        </div>
      </template>

      <el-row :gutter="30">
        <el-col :span="8">
          <div class="efficiency-section">
            <div class="section-header">
              <h3>⏱️ 时间节省</h3>
              <el-button type="primary" link size="small" @click="goTasksWithFilter({ sortBy: 'duration' })">查看明细 →</el-button>
            </div>
            <div class="efficiency-data">
              <div class="data-row">
                <span class="label">预估工时:</span>
                <span class="value">{{ formatHours(efficiencySummary.manual_hours) }}</span>
              </div>
              <div class="data-row">
                <span class="label">耗时:</span>
                <span class="value">{{ formatHours(efficiencySummary.auto_hours) }}</span>
              </div>
              <div class="data-row highlight">
                <span class="label">节省时间:</span>
                <span class="value">{{ formatHours(efficiencySummary.saved_hours) }} ({{ formatPercent(efficiencySummary.avg_efficiency_rate) }})</span>
              </div>
              <div class="data-row">
                <span class="label">折合人日:</span>
                <span class="value">{{ formatPersonDays(efficiencySummary.saved_hours) }}</span>
              </div>
            </div>
          </div>
        </el-col>

        <el-col :span="8">
          <div class="efficiency-section">
            <div class="section-header">
              <h3>💵 成本节省</h3>
              <el-button type="primary" link size="small" @click="goTasksWithFilter({ sortBy: 'cost' })">查看明细 →</el-button>
            </div>
            <div class="efficiency-data">
              <div class="data-row">
                <span class="label">预估成本:</span>
                <span class="value">¥{{ formatMoney(efficiencySummary.estimated_cost) }}</span>
              </div>
              <div class="data-row">
                <span class="label">实际成本:</span>
                <span class="value">¥{{ formatMoney(efficiencySummary.actual_cost) }}</span>
              </div>
              <div class="data-row highlight">
                <span class="label">节省成本:</span>
                <span class="value success">¥{{ formatMoney(efficiencySummary.saved_cost) }}</span>
              </div>
            </div>
          </div>
        </el-col>

        <el-col :span="8">
          <div class="efficiency-section">
            <div class="section-header">
              <h3>🎯 质量评估</h3>
              <el-button type="primary" link size="small" @click="router.push('/stats/quality')">查看明细 →</el-button>
            </div>
            <div class="efficiency-data">
              <div class="data-row">
                <span class="label">评估次数:</span>
                <span class="value">{{ efficiencySummary.evaluation_count || 0 }}</span>
              </div>
              <div class="data-row">
                <span class="label">质量达标:</span>
                <span class="value">{{ efficiencySummary.quality_pass_count || 0 }} 次</span>
              </div>
              <div class="data-row highlight">
                <span class="label">达标率:</span>
                <span class="value" :class="qualityPassRate >= 60 ? 'success' : qualityPassRate >= 40 ? 'warning' : 'danger'">
                  {{ qualityPassRate }}%
                </span>
              </div>
              <div class="data-row">
                <span class="label">综合均分:</span>
                <span class="value">{{ Number(efficiencySummary.avg_overall_score || 0).toFixed(1) }}</span>
              </div>
              <div class="data-row">
                <span class="label">质量层均分:</span>
                <span class="value">{{ Number(efficiencySummary.avg_quality_score || 0).toFixed(1) }}</span>
              </div>
              <div class="data-row">
                <span class="label">交付物总数:</span>
                <span class="value">{{ efficiencySummary.deliverable_count || 0 }}</span>
              </div>
              <div class="data-row">
                <span class="label">交付物均分:</span>
                <span class="value" :class="Number(efficiencySummary.avg_deliverable_score) >= 6 ? 'success' : Number(efficiencySummary.avg_deliverable_score) >= 4 ? 'warning' : 'danger'">
                  {{ Number(efficiencySummary.avg_deliverable_score || 0).toFixed(1) }}/10
                </span>
              </div>
              <!-- 交付物审核统计 -->
              <template v-if="efficiencySummary.review_stats">
                <div class="data-row divider">
                  <span class="label">审核任务数:</span>
                  <span class="value">{{ efficiencySummary.review_stats.reviewed_task_count || 0 }}</span>
                </div>
                <div class="data-row">
                  <span class="label">审核平均分:</span>
                  <span class="value" :class="(efficiencySummary.review_stats.avg_review_score || 0) >= 70 ? 'success' : (efficiencySummary.review_stats.avg_review_score || 0) >= 60 ? 'warning' : 'danger'">
                    {{ efficiencySummary.review_stats.avg_review_score || 0 }}
                  </span>
                </div>
                <div class="data-row">
                  <span class="label">审核通过:</span>
                  <span class="value">{{ efficiencySummary.review_stats.passed_review_count || 0 }}/{{ efficiencySummary.review_stats.total_review_count || 0 }}</span>
                </div>
                <div class="data-row" v-if="efficiencySummary.review_stats.reviewer_breakdown?.length">
                  <span class="label">各审核员均分:</span>
                  <div class="reviewer-scores">
                    <span v-for="r in efficiencySummary.review_stats.reviewer_breakdown" :key="r.name" class="reviewer-tag">
                      {{ r.name }}: {{ r.avg_score }}
                    </span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 趋势图表 -->
    <el-card shadow="hover" style="margin-top: 20px">
      <template #header>
        <div class="card-header">
          <span>📉 效率 &amp; 质量趋势</span>
          <el-radio-group v-model="trendDays" @change="loadTrend">
            <el-radio-button :value="7">近7天</el-radio-button>
            <el-radio-button :value="14">近14天</el-radio-button>
            <el-radio-button :value="30">近30天</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <div ref="trendChartRef" style="height: 380px"></div>
    </el-card>

    <!-- 智能体排名 -->
    <el-card shadow="hover" style="margin-top: 20px">
      <template #header>
        <div class="card-header">
          <span>🏆 智能体排名（本月）</span>
        </div>
      </template>
      <el-table :data="agentRanking" stripe>
        <el-table-column type="index" label="排名" width="60" />
        <el-table-column prop="agent_name" label="智能体" min-width="140" />
        <el-table-column prop="total_tasks" label="任务数" width="90" sortable />
        <el-table-column label="成功率" width="100" sortable :sort-by="(row: any) => Number(row.success_rate)">
          <template #default="{ row }">
            <el-tag :type="row.success_rate >= 95 ? 'success' : row.success_rate >= 80 ? '' : 'danger'" size="small">
              {{ row.success_rate }}%
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="综合评分" width="100" sortable :sort-by="(row: any) => Number(row.avg_score || 0)">
          <template #default="{ row }">
            <el-tag v-if="row.avg_score > 0" :type="row.avg_score >= 60 ? 'success' : row.avg_score >= 40 ? 'warning' : 'danger'" size="small">
              {{ Number(row.avg_score).toFixed(1) }}
            </el-tag>
            <span v-else class="text-gray">-</span>
          </template>
        </el-table-column>
        <el-table-column label="能力层均分" width="110" sortable :sort-by="(row: any) => Number(row.avg_capability_score || 0)">
          <template #default="{ row }">
            <span v-if="row.avg_capability_score > 0">{{ Number(row.avg_capability_score).toFixed(1) }}</span>
            <span v-else class="text-gray">-</span>
          </template>
        </el-table-column>
        <el-table-column label="质量层均分" width="110" sortable :sort-by="(row: any) => Number(row.avg_quality_score || 0)">
          <template #default="{ row }">
            <span v-if="row.avg_quality_score > 0">{{ Number(row.avg_quality_score).toFixed(1) }}</span>
            <span v-else class="text-gray">-</span>
          </template>
        </el-table-column>
        <el-table-column label="业务层均分" width="110" sortable :sort-by="(row: any) => Number(row.avg_business_score || 0)">
          <template #default="{ row }">
            <span v-if="row.avg_business_score > 0">{{ Number(row.avg_business_score).toFixed(1) }}</span>
            <span v-else class="text-gray">-</span>
          </template>
        </el-table-column>
        <el-table-column label="交付物数" width="90" sortable :sort-by="(row: any) => Number(row.deliverable_count || 0)">
          <template #default="{ row }">
            <span>{{ row.deliverable_count || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="交付物均分" width="100" sortable :sort-by="(row: any) => Number(row.avg_deliverable_score || 0)">
          <template #default="{ row }">
            <span v-if="Number(row.avg_deliverable_score) > 0" :class="Number(row.avg_deliverable_score) >= 6 ? 'text-success' : Number(row.avg_deliverable_score) >= 4 ? 'text-warning' : 'text-danger'">
              {{ Number(row.avg_deliverable_score).toFixed(1) }}/10
            </span>
            <span v-else class="text-gray">-</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 用户行为统计（仅管理员） -->
    <el-card v-if="isAdminUser" shadow="hover" style="margin-top: 20px">
      <template #header>
        <div class="card-header">
          <span>👣 用户行为统计</span>
          <div>
            <el-button size="small" type="primary" @click="router.push('/stats/user-actions')">查看完整行为明细 →</el-button>
          </div>
        </div>
      </template>
      <el-row :gutter="16">
        <el-col :span="5">
          <div class="stat-item" style="cursor:pointer" @click="router.push('/stats/user-actions')">
            <div class="stat-value">{{ userActionStats.total ?? 0 }}</div>
            <div class="stat-label">总行为次数</div>
          </div>
        </el-col>
        <el-col :span="5">
          <div class="stat-item">
            <div class="stat-value">{{ userActionStats.loginCount ?? 0 }}</div>
            <div class="stat-label">登录次数</div>
          </div>
        </el-col>
        <el-col :span="5">
          <div class="stat-item">
            <div class="stat-value">{{ totalUsageHours }}</div>
            <div class="stat-label">累计使用时长</div>
          </div>
        </el-col>
        <el-col :span="5">
          <div class="stat-item">
            <div class="stat-value">{{ (userActionStats.byUser || []).length }}</div>
            <div class="stat-label">活跃用户数</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item">
            <div class="stat-value" style="font-size:20px">{{ topAction }}</div>
            <div class="stat-label">最频繁行为</div>
          </div>
        </el-col>
      </el-row>
      <div v-if="(userActionStats.byAction || []).length" style="margin-top: 12px">
        <el-tag
          v-for="item in (userActionStats.byAction || []).slice(0, 10)"
          :key="item.action"
          size="small"
          type="info"
          style="margin-right: 8px; margin-bottom: 6px"
        >
          {{ item.action }}: {{ item.count }}
        </el-tag>
      </div>
      <div v-else class="text-gray" style="margin-top: 12px; font-size: 13px">暂无用户行为记录</div>
    </el-card>

    <!-- 缺陷统计 -->
    <el-card shadow="hover" style="margin-top: 20px">
      <template #header>
        <div class="card-header">
          <span>🐛 缺陷统计</span>
          <el-button type="primary" link size="small" @click="router.push('/stats/defects')">查看缺陷明细 →</el-button>
        </div>
      </template>
      <el-row :gutter="16">
        <el-col :span="4">
          <div class="stat-item">
            <div class="stat-value">{{ defectsStats.total ?? 0 }}</div>
            <div class="stat-label">缺陷总数</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item danger">
            <div class="stat-value">{{ defectsOpenCount }}</div>
            <div class="stat-label">待处理</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item success">
            <div class="stat-value">{{ defectsFixedCount }}</div>
            <div class="stat-label">已修复</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item">
            <div class="stat-value">{{ defectsClosedCount }}</div>
            <div class="stat-label">已关闭</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-item danger">
            <div class="stat-value">{{ defectsHighSeverityCount }}</div>
            <div class="stat-label">严重/致命</div>
          </div>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import { request, userActionApi } from '@/api'
import { useMainStore } from '@/stores/main'

const router = useRouter()
const mainStore = useMainStore()
const isAdminUser = computed(() => mainStore.isAdmin)
const loading = ref(false)

// 用户行为统计（仅管理员加载）
const userActionStats = ref<any>({})
const topAction = computed(() => {
  const first = (userActionStats.value.byAction || [])[0]
  return first ? first.action : '-'
})

// 累计使用时长（秒→小时，取所有用户最大时长之和作为参考）
const totalUsageHours = computed(() => {
  const usage = userActionStats.value.userUsage || []
  if (!usage.length) return '0h'
  const totalSec = usage.reduce((sum: number, u: any) => sum + (u.duration_seconds || 0), 0)
  const h = totalSec / 3600
  return h < 1 ? `${Math.round(totalSec / 60)}m` : `${h.toFixed(1)}h`
})

// 缺陷统计
const defectsStats = ref<any>({})
const defectsByStatus = computed(() => defectsStats.value.byStatus || [])
const defectsBySeverity = computed(() => defectsStats.value.bySeverity || [])
const defectsOpenCount = computed(() => {
  return (defectsStats.value.byStatus || []).find((s: any) => s.status === 'open')?.count || 0
})
const defectsFixedCount = computed(() => {
  return (defectsStats.value.byStatus || []).find((s: any) => s.status === 'fixed')?.count || 0
})
const defectsClosedCount = computed(() => {
  return (defectsStats.value.byStatus || []).find((s: any) => s.status === 'closed')?.count || 0
})
const defectsHighSeverityCount = computed(() => {
  return (defectsStats.value.bySeverity || [])
    .filter((s: any) => s.severity === 'high' || s.severity === 'critical')
    .reduce((sum: number, s: any) => sum + (s.count || 0), 0)
})

const loadDefectsStats = async () => {
  try {
    const res = await request<any>('/api/defects/stats')
    defectsStats.value = res.data || {}
  } catch (e) {
    console.error('加载缺陷统计失败:', e)
  }
}

const loadUserActionStats = async () => {
  if (!isAdminUser.value) return
  try {
    const res = await userActionApi.stats()
    if (res.success) {
      // 兼容两层包装 {success, data: {success, data: {...}}} 和单层 {success, data: {...}}
      const raw = (res.data as any)
      userActionStats.value = raw?.data ?? raw ?? {}
    }
  } catch (e) {
    console.error('加载用户行为统计失败:', e)
  }
}

// 统计数据
const todayStats = ref<any>({})
const overallStats = ref<any>({})
const efficiencySummary = ref<any>({})

// 质量达标率（直接从 summary 取，已由后端计算好）
const qualityPassRate = computed(() => {
  const s = efficiencySummary.value
  return Number(s?.quality_pass_rate || 0)
})
const agentRanking = ref<any[]>([])
const trendData = ref<any[]>([])

// 筛选条件
const dateRange = ref<[string, string] | null>(null)
const trendDays = ref(7)

// 图表引用
const trendChartRef = ref<HTMLElement>()
let trendChart: echarts.ECharts | null = null

// 返回上一页
const goBack = () => {
  router.push('/')
}

// 跳转到任务明细页（带筛选参数）
const goTasksWithFilter = (opts: { sortBy?: string } = {}) => {
  const query: any = {}
  if (opts.sortBy) query.sortBy = opts.sortBy
  router.push({ path: '/tasks', query })
}

// 刷新统计
const refreshStats = async () => {
  loading.value = true
  try {
    await Promise.all([
      loadTodayStats(),
      loadTrend(),
      loadEfficiency(),
      loadAgentRanking(),
      loadUserActionStats(),
      loadDefectsStats()
    ])
  } finally {
    loading.value = false
  }
}

// 加载今日统计
const loadTodayStats = async () => {
  try {
    const res = await request<{ today: any; overall: any }>('/api/stats/today')
    if (res.data) {
      todayStats.value = res.data.today || {}
      overallStats.value = res.data.overall || {}
    }
  } catch (e) {
    console.error('加载今日统计失败:', e)
  }
}

// 加载趋势数据
const loadTrend = async () => {
  const endpoint = `/api/stats/trend?days=${trendDays.value}`
  console.log('[loadTrend] 请求:', endpoint)
  try {
    const res = await request<any[]>(endpoint)
    console.log('[loadTrend] 响应:', JSON.stringify(res).slice(0, 200))
    if (res.data) {
      console.log('[loadTrend] 数据有效,条数:', Array.isArray(res.data) ? res.data.length : '非数组')
      trendData.value = res.data
      await nextTick()
      renderTrendChart()
    } else {
      console.error('[loadTrend] res.data 为空:', res)
      ElMessage.error('加载趋势数据失败: 无数据')
    }
  } catch (e: any) {
    console.error('[loadTrend] 异常:', e, e?.message, e?.stack)
    if (e?.message?.includes('仅管理员可见')) {
      ElMessage.warning('趋势数据仅管理员可见')
    } else {
      ElMessage.error('加载趋势数据失败')
    }
  }
}

// 加载提效统计
const loadEfficiency = async () => {
  try {
    let start = ''
    let end = ''
    
    if (dateRange.value) {
      start = dateRange.value[0]
      end = dateRange.value[1]
    } else {
      // 默认本月
      const now = new Date()
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      end = now.toISOString().slice(0, 10)
    }
    
    const res = await request<{ summary: any }>(`/api/stats/efficiency?startDate=${start}&endDate=${end}`)
    if (res.data) {
      efficiencySummary.value = res.data.summary || {}
    }
  } catch (e: any) {
    if (e?.message?.includes('仅管理员可见')) {
      ElMessage.warning('提效统计仅管理员可见')
    } else {
      ElMessage.error('加载提效统计失败')
    }
  }
}

// 加载智能体排名
const loadAgentRanking = async () => {
  try {
    const now = new Date()
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const end = now.toISOString().slice(0, 10)
    
    const res = await request<{ ranking: any[] }>(`/api/stats/agents?startDate=${start}&endDate=${end}&limit=10`)
    if (res.data) {
      agentRanking.value = res.data.ranking || []
    }
  } catch (e: any) {
    if (e?.message?.includes('仅管理员可见')) {
      ElMessage.warning('智能体统计仅管理员可见')
    } else {
      ElMessage.error('加载智能体排名失败')
    }
  }
}

// 渲染趋势图表
const renderTrendChart = () => {
  if (!trendChartRef.value) return

  if (!trendChart) {
    trendChart = echarts.init(trendChartRef.value)
  }

  const dates = trendData.value.map(d => d.date)
  const tasks = trendData.value.map(d => d.total_tasks)
  const savedHours = trendData.value.map(d => Number(d.saved_hours) || 0)
  // 质量趋势（统一为百分比 scale，左轴复用）
  const successRate = trendData.value.map(d => Number(d.success_rate) || 0)
  const qualityPassRate = trendData.value.map(d => Number(d.quality_pass_rate) || 0)
  // 评分归一化到 0-100
  const overallScore = trendData.value.map(d => Number(d.avg_overall_score) * 10 || 0)
  const deliverableScore = trendData.value.map(d => Number(d.avg_deliverable_score) * 10 || 0)  // 0-10 → 0-100 归一化显示

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: any[]) => {
        const date = params[0]?.axisValue || ''
        const rows = params.map(p => {
          let val = p.value
          let unit = ''
          if (p.seriesName === '任务数') { unit = ' 个' }
          else if (p.seriesName === '节省小时') { unit = ' h' }
          else { unit = '%' }
          return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${p.seriesName}</span><span style="font-weight:bold">${val}${unit}</span></div>`
        }).join('')
        return `<div style="font-weight:bold;margin-bottom:4px">${date.slice(0,10)}</div>${rows}`
      }
    },
    legend: {
      data: ['任务数', '节省小时', '任务成功率', '质量达标率', '综合评分×10', '交付物均分×10'],
      top: 10,
      left: 'center',
      textStyle: { fontSize: 12 }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
    xAxis: { type: 'category', data: dates },
    yAxis: [
      {
        type: 'value', name: '任务数/小时', position: 'left',
        axisLabel: { formatter: (v: number) => v > 100 ? `${(v/1000).toFixed(0)}k` : v }
      },
      {
        type: 'value', name: '比率(%)', position: 'right',
        min: 0, max: 100,
        splitLine: { show: true, lineStyle: { type: 'dashed', opacity: 0.3 } }
      }
    ],
    series: [
      {
        name: '任务数', type: 'bar', data: tasks,
        itemStyle: { color: '#409EFF' }
      },
      {
        name: '节省小时', type: 'bar', data: savedHours,
        itemStyle: { color: '#67C23A' }
      },
      {
        name: '任务成功率', type: 'line', yAxisIndex: 1,
        data: successRate,
        smooth: true,
        itemStyle: { color: '#E6A23C' },
        lineStyle: { width: 2 }
      },
      {
        name: '质量达标率', type: 'line', yAxisIndex: 1,
        data: qualityPassRate,
        smooth: true,
        itemStyle: { color: '#F56C6C' },
        lineStyle: { width: 2, type: 'dashed' }
      },
      {
        name: '综合评分×10', type: 'line', yAxisIndex: 1,
        data: overallScore,
        smooth: true,
        itemStyle: { color: '#9B59B6' },
        lineStyle: { width: 2 }
      },
      {
        name: '交付物均分×10', type: 'line', yAxisIndex: 1,
        data: deliverableScore,
        smooth: true,
        itemStyle: { color: '#00BCD4' },
        lineStyle: { width: 2, type: 'dotted' }
      }
    ]
  }

  trendChart.setOption(option)
}

// 格式化函数
const formatHours = (hours: number | string) => {
  const h = Number(hours) || 0
  if (h < 1) return `${(h * 60).toFixed(0)}分钟`
  return `${h.toFixed(1)}小时`
}

const formatPercent = (rate: number | string) => {
  const r = Number(rate) || 0
  return `${r.toFixed(1)}%`
}

const formatMoney = (money: number | string) => {
  const m = Number(money) || 0
  return m.toFixed(2)
}

const formatPersonDays = (hours: number | string) => {
  const h = Number(hours) || 0
  return `${(h / 8).toFixed(1)}人日`
}

onMounted(() => {
  refreshStats()
})
</script>

<style scoped>
.stats-view {
  padding: 20px;
  background: var(--el-bg-color-page);
  min-height: calc(100vh - 60px);
}

.overview-card,
.efficiency-card {
  background: linear-gradient(135deg, #f5f7fa 0%, #fff 100%);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-item {
  text-align: center;
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
}

.stat-item .stat-value {
  font-size: 32px;
  font-weight: bold;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.stat-item.success .stat-value {
  color: var(--el-color-success);
}

.stat-item.warning .stat-value {
  color: var(--el-color-warning);
}

.stat-item.danger .stat-value {
  color: var(--el-color-danger);
}

.stat-item.primary .stat-value {
  color: var(--el-color-primary);
}

.stat-label {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.text-gray {
  color: var(--el-text-color-placeholder);
}

.efficiency-section {
  padding: 20px;
}

.efficiency-section h3 {
  margin-bottom: 20px;
  color: var(--el-text-color-primary);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-header h3 {
  margin-bottom: 0;
}

.efficiency-data {
  background: var(--el-bg-color);
  padding: 20px;
  border-radius: 8px;
}

.data-row {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.data-row:last-child {
  border-bottom: none;
}

.data-row .label {
  color: var(--el-text-color-regular);
}

.data-row .value {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.data-row.highlight {
  background: var(--el-color-primary-light-9);
  margin: 10px -20px;
  padding: 12px 20px;
  border-radius: 4px;
}

.data-row.highlight .value {
  color: var(--el-color-primary);
  font-size: 18px;
}

.data-row.highlight .value.success {
  color: var(--el-color-success);
}
.data-row.divider {
  border-top: 1px dashed var(--el-border-color);
  margin-top: 8px;
  padding-top: 8px;
}
.reviewer-scores {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}
.reviewer-tag {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
