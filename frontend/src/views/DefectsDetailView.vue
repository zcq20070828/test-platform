<template>
  <div class="defects-view">
    <el-page-header @back="goBack" content="缺陷明细" style="margin-bottom: 20px" />

    <!-- 筛选栏 -->
    <el-card shadow="never" style="margin-bottom: 16px">
      <el-form inline>
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable placeholder="全部" style="width:120px">
            <el-option label="待处理" value="open" />
            <el-option label="已修复" value="fixed" />
            <el-option label="已关闭" value="closed" />
            <el-option label="重新打开" value="reopened" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重程度">
          <el-select v-model="filters.severity" clearable placeholder="全部" style="width:120px">
            <el-option label="轻微" value="minor" />
            <el-option label="中等" value="medium" />
            <el-option label="严重" value="high" />
            <el-option label="致命" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item label="发现来源">
          <el-select v-model="filters.foundBy" clearable placeholder="全部" style="width:120px">
            <el-option label="AI" value="ai" />
            <el-option label="人工" value="human" />
            <el-option label="自动化" value="auto" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="-"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            style="width:260px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList(1)">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
        <el-form-item style="margin-left:auto">
          <el-button type="primary" @click="showCreate = true">+ 登记缺陷</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 统计卡片 -->
    <el-row :gutter="12" style="margin-bottom:16px">
      <el-col :span="4" v-for="s in statCards" :key="s.label">
        <el-card shadow="hover" class="stat-card" :class="s.type">
          <div class="stat-item">
            <div class="stat-value">{{ s.count }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 缺陷列表 -->
    <el-card shadow="never">
      <el-table :data="list" stripe v-loading="loading" @row-click="openDetail">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="severity" label="严重程度" width="100">
          <template #default="{ row }">
            <el-tag :type="severityType(row.severity)" size="small">{{ row.severity }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="defectType" label="缺陷类型" width="110" />
        <el-table-column prop="module" label="模块" width="120" show-overflow-tooltip />
        <el-table-column prop="foundBy" label="发现来源" width="90" />
        <el-table-column prop="priority" label="优先级" width="70" />
        <el-table-column prop="createdAt" label="创建时间" width="160">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="editDefect(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click.stop="deleteDefect(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top:16px; text-align:right">
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadList"
        />
      </div>
    </el-card>

    <!-- 详情/编辑弹窗 -->
    <el-dialog v-model="detailVisible" :title="editingDefect ? '编辑缺陷' : '缺陷详情'" width="640px">
      <el-form v-if="detailForm" label-width="100px">
        <el-form-item label="标题"><el-input v-model="detailForm.title" :readonly="!editingDefect" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="detailForm.description" type="textarea" :rows="3" :readonly="!editingDefect" /></el-form-item>
        <el-form-item label="严重程度">
          <el-select v-model="detailForm.severity" :disabled="!editingDefect">
            <el-option label="轻微" value="minor" /><el-option label="中等" value="medium" />
            <el-option label="严重" value="high" /><el-option label="致命" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="detailForm.status" :disabled="!editingDefect">
            <el-option label="待处理" value="open" /><el-option label="已修复" value="fixed" />
            <el-option label="已关闭" value="closed" /><el-option label="重新打开" value="reopened" />
          </el-select>
        </el-form-item>
        <el-form-item label="缺陷类型"><el-input v-model="detailForm.defectType" :readonly="!editingDefect" /></el-form-item>
        <el-form-item label="模块"><el-input v-model="detailForm.module" :readonly="!editingDefect" /></el-form-item>
        <el-form-item label="优先级"><el-input v-model="detailForm.priority" :readonly="!editingDefect" /></el-form-item>
        <el-form-item label="分配给"><el-input v-model="detailForm.assigneeId" :readonly="!editingDefect" /></el-form-item>
        <el-form-item label="关联任务"><el-input v-model="detailForm.taskId" :readonly="!editingDefect" /></el-form-item>
      </el-form>
      <template #footer v-if="editingDefect">
        <el-button @click="detailVisible = false">取消</el-button>
        <el-button type="primary" @click="saveDefect">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新建缺陷弹窗 -->
    <el-dialog v-model="showCreate" title="登记缺陷" width="540px">
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="标题" required><el-input v-model="createForm.title" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="createForm.description" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="严重程度">
          <el-select v-model="createForm.severity">
            <el-option label="轻微" value="minor" /><el-option label="中等" value="medium" />
            <el-option label="严重" value="high" /><el-option label="致命" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item label="缺陷类型"><el-input v-model="createForm.defectType" /></el-form-item>
        <el-form-item label="模块"><el-input v-model="createForm.module" /></el-form-item>
        <el-form-item label="关联任务ID"><el-input v-model="createForm.taskId" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const dateRange = ref<[string, string] | null>(null)
const filters = ref({ status: '', severity: '', foundBy: '' })
const statsData = ref<any>({})

const detailVisible = ref(false)
const editingDefect = ref(false)
const detailForm = ref<any>(null)
const showCreate = ref(false)
const createForm = ref({ title: '', description: '', severity: 'medium', defectType: '', module: '', taskId: '' })

const statCards = [
  { label: '全部', count: statsData.value.total || 0, type: '' },
  { label: '待处理', count: 0, type: 'info' },
  { label: '已修复', count: 0, type: 'success' },
  { label: '已关闭', count: 0, type: 'warning' },
]

const goBack = () => router.push('/stats')

const severityType = (s: string) => ({ critical: 'danger', high: 'danger', medium: 'warning', minor: 'info' }[s] || 'info')
const statusType = (s: string) => ({ open: 'danger', fixed: 'success', closed: 'info', reopened: 'warning' }[s] || 'info')
const statusLabel = (s: string) => ({ open: '待处理', fixed: '已修复', closed: '已关闭', reopened: '重新打开' }[s] || s)

const formatTime = (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-'

const buildParams = () => {
  const p: any = { page: currentPage.value, size: pageSize.value }
  if (filters.value.status) p.status = filters.value.status
  if (filters.value.severity) p.severity = filters.value.severity
  if (filters.value.foundBy) p.foundBy = filters.value.foundBy
  if (dateRange.value) { p.startDate = dateRange.value[0]; p.endDate = dateRange.value[1] }
  return p
}

const loadStats = async () => {
  try {
    const params = new URLSearchParams()
    if (dateRange.value) { params.set('startDate', dateRange.value[0]); params.set('endDate', dateRange.value[1]) }
    const qs = params.toString()
    const res = await request<any>(`/api/defects/stats${qs ? '?' + qs : ''}`)
    statsData.value = res.data || {}
    const byStatus: any = {}
    ;(statsData.value.byStatus || []).forEach((s: any) => { byStatus[s.status] = s.count })
    statCards[0]!.count = statsData.value.total || 0
    statCards[1]!.count = byStatus.open || 0
    statCards[2]!.count = byStatus.fixed || 0
    statCards[3]!.count = byStatus.closed || 0
  } catch {}
}

const loadList = async (page = 1) => {
  currentPage.value = page
  loading.value = true
  try {
    const params = buildParams()
    const qs = new URLSearchParams(params as any).toString()
    const res = await request<any>(`/api/defects?${qs}`)
    list.value = res.data?.items || []
    total.value = res.data?.total || 0
  } catch (e: any) {
    ElMessage.error('加载缺陷列表失败: ' + (e.message || ''))
  } finally {
    loading.value = false
  }
}

const resetFilters = () => { filters.value = { status: '', severity: '', foundBy: '' }; dateRange.value = null; loadList(1); loadStats() }

const openDetail = (row: any) => { detailForm.value = { ...row }; editingDefect.value = false; detailVisible.value = true }
const editDefect = (row: any) => { detailForm.value = { ...row }; editingDefect.value = true; detailVisible.value = true }
const saveDefect = async () => {
  try {
    await request(`/api/defects/${detailForm.value.id}`, { method: 'PUT', body: JSON.stringify(detailForm.value) })
    ElMessage.success('保存成功')
    detailVisible.value = false
    loadList(currentPage.value)
    loadStats()
  } catch (e: any) { ElMessage.error('保存失败: ' + (e.message || '')) }
}
const submitCreate = async () => {
  if (!createForm.value.title) { ElMessage.warning('标题不能为空'); return }
  try {
    await request('/api/defects', { method: 'POST', body: JSON.stringify(createForm.value) })
    ElMessage.success('创建成功')
    showCreate.value = false
    createForm.value = { title: '', description: '', severity: 'medium', defectType: '', module: '', taskId: '' }
    loadList(1)
    loadStats()
  } catch (e: any) { ElMessage.error('创建失败: ' + (e.message || '')) }
}
const deleteDefect = async (row: any) => {
  await ElMessageBox.confirm(`确定删除缺陷「${row.title}」？`, '确认删除', { type: 'warning' })
  try {
    await request(`/api/defects/${row.id}`, { method: 'DELETE' })
    ElMessage.success('已删除')
    loadList(currentPage.value)
    loadStats()
  } catch (e: any) { ElMessage.error('删除失败: ' + (e.message || '')) }
}

onMounted(() => { loadStats(); loadList(1) })
</script>

<style scoped>
.defects-view { padding: 20px; background: var(--el-bg-color-page); min-height: 100vh; }
.stat-card .stat-item { text-align: center; }
.stat-card .stat-value { font-size: 24px; font-weight: bold; }
.stat-card .stat-label { font-size: 13px; color: var(--el-text-color-secondary); margin-top: 4px; }
</style>
