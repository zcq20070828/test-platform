<template>
  <div class="api-key-settings-view">
    <div class="apikey-header">
      <div>
        <h2 class="apikey-title"><MsIcon name="key" :size="22" /> API KEY 配置</h2>
        <p class="apikey-subtitle">
          在这里管理你自己的大模型 API Key。平台调用大模型时优先使用你标记为「默认」的那一个；
          没有配置时才会使用平台统一提供的 Key。选择服务商即可，接口地址由平台按服务商自动确定，无需手填。
        </p>
      </div>
      <div class="header-actions">
        <el-button @click="load" circle :loading="loading">
          <MsIcon name="refresh" :size="16" />
        </el-button>
        <el-button type="primary" @click="openCreate">
          <MsIcon name="add" /> 新增 API Key
        </el-button>
      </div>
    </div>

    <!-- 当前生效的 Key 概览 -->
    <el-alert
      v-if="!loading && keys.length === 0"
      :type="platformKeyAvailable ? 'info' : 'warning'"
      :closable="false"
      show-icon
      class="status-alert"
    >
      <template #title>
        还没有配置自己的 API Key
      </template>
      <div class="alert-body">
        <template v-if="platformKeyAvailable">
          当前使用<strong>平台统一 Key</strong>{{ platformKeyHint ? `（${platformKeyHint}）` : '' }}。
          如需使用自己的额度，点击右上角「新增 API Key」，添加后会自动设为默认。
        </template>
        <template v-else>
          <span>平台未提供统一 Key，<strong>必须先添加一个 API Key 才能执行任务</strong>。</span>
        </template>
      </div>
    </el-alert>

    <el-alert
      v-else-if="!loading && keys.length > 0 && !hasDefault"
      type="warning"
      :closable="false"
      show-icon
      class="status-alert"
      title="有 Key 但没有指定默认"
    >
      <div class="alert-body">
        请在列表里点「设为默认」，否则平台会{{ platformKeyAvailable ? '继续使用平台统一 Key' : '无法调用模型' }}。
      </div>
    </el-alert>

    <!-- Key 列表 -->
    <el-card v-loading="loading" shadow="never" class="list-card">
      <el-table :data="keys" stripe style="width: 100%" empty-text="暂无 API Key">
        <el-table-column prop="name" label="名称" min-width="160">
          <template #default="{ row }">
            <div class="name-cell">
              <span class="key-name">{{ row.name }}</span>
              <el-tag v-if="row.isDefault" type="success" size="small" effect="light">默认</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="服务商 / 模型" min-width="200">
          <template #default="{ row }">
            <div class="provider-cell">
              <span class="provider-name">{{ providerLabel(row.provider) }}</span>
              <span class="provider-model">{{ row.model || providerModel(row.provider) || '未指定' }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="Key" width="170">
          <template #default="{ row }">
            <code class="key-hint">{{ row.keyHint || '****' }}</code>
          </template>
        </el-table-column>

        <el-table-column label="最近验证" width="170">
          <template #default="{ row }">
            <span v-if="row.lastVerifiedAt" class="verified-at">{{ formatDateTime(row.lastVerifiedAt) }}</span>
            <span v-else class="never-verified">未验证</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text :loading="verifyingId === row.id" @click="handleVerify(row)">
              验证
            </el-button>
            <el-button
              size="small"
              text
              type="primary"
              :disabled="row.isDefault"
              @click="handleSetDefault(row)"
            >
              设为默认
            </el-button>
            <el-button size="small" text @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <div class="security-note">
      <MsIcon name="lock" :size="14" />
      <span>
        Key 以 AES-256-GCM 加密保存，保存后无法再次查看明文（列表只显示末 4 位）；
        更换 Key 需要重新录入。平台不会把你的 Key 用于其他用户的任何任务。
      </span>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑 API Key' : '新增 API Key'"
      width="520px"
      @closed="onDialogClosed"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="88px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="自定义名称，例如：我的主力 Key / 测试专用 / 团队共享" maxlength="100" show-word-limit />
        </el-form-item>

        <el-form-item label="服务商" prop="provider">
          <el-select v-model="form.provider" filterable style="width: 100%" @change="onProviderChange">
            <el-option-group
              v-for="g in providerGroups"
              :key="g.name"
              :label="g.name"
            >
              <el-option
                v-for="p in g.items"
                :key="p.value"
                :label="p.label"
                :value="p.value"
              />
            </el-option-group>
          </el-select>
          <div class="field-hint">
            接口地址由服务商自动确定，无需手填 URL。
          </div>
        </el-form-item>

        <!-- 模型改为下拉选择（2026-11-20）：手填模型名是最容易出错的一步。
             实测用户把 DeepSeek 的模型填成 deepseek-v4.1-flash → 服务商直接 400。
             候选列表随「服务商」联动，并且优先用该 Key 向服务商实时拉取（最准）。 -->
        <el-form-item label="模型" prop="model">
          <el-select
            :key="`model-${form.provider}-${modelOptions.length}`"
            :model-value="form.model"
            filterable
            clearable
            :reserve-keyword="false"
            :loading="modelsLoading"
            :placeholder="modelsPlaceholder"
            style="width: 100%"
            @update:model-value="onModelChange"
            @visible-change="onModelDropdown"
          >
            <el-option
              v-for="m in modelOptions"
              :key="m.id"
              :label="m.id"
              :value="m.id"
            />
          </el-select>
          <div class="field-hint">
            <template v-if="currentProvider?.requiresModel">
              <span class="required-hint">该服务商必须指定模型</span>——{{ currentProvider.modelHint }}
            </template>
            <template v-else-if="providerModel(form.provider)">
              留空则使用 {{ providerModel(form.provider) }}。
            </template>
            <template v-else>可留空，将使用该服务商的首选模型。</template>
            <template v-if="modelsSource === 'account'">
              <br><span class="models-source ok">已按你的账号列出可用的 {{ modelOptions.length }} 个模型。</span>
            </template>
            <template v-else-if="modelsSource === 'builtin' && modelsNote">
              <br><span class="models-source warn">{{ modelsNote }}</span>
            </template>
            <span class="models-refresh" v-if="!modelsLoading" @click="loadProviderModels(true)">刷新清单</span>
            <span class="models-refresh" v-else>加载中…</span>
          </div>
        </el-form-item>

        <el-form-item label="API Key" prop="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="editingId ? '留空表示不修改这把 Key（只改名称）' : '粘贴你的 API Key'"
            autocomplete="new-password"
          />
          <div class="field-hint">
            <template v-if="editingId">
              出于安全考虑不回显已保存的 Key。留空则保持原 Key 不变。
            </template>
            <template v-else>
              保存后只能看到末 4 位，无法再次查看明文。
            </template>
          </div>
        </el-form-item>

      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { userApiKeyApi } from '@/api/index'
import type { UserApiKey } from '@/api/index'
import { formatDateTime } from '@/utils/time'
import MsIcon from '@/components/MsIcon.vue'

defineProps<{ embedded?: boolean }>()

const keys = ref<UserApiKey[]>([])
const hasDefault = ref(false)
const platformKeyAvailable = ref(false)
const platformKeyHint = ref('')
const loading = ref(false)
const saving = ref(false)
const verifyingId = ref('')

const dialogVisible = ref(false)
const editingId = ref('')
const formRef = ref<FormInstance>()

const form = reactive({
  name: '',
  provider: 'deepseek',
  apiKey: '',
  model: '',
})

interface ProviderOption {
  value: string
  group: string
  label: string
  model: string
  modelHint: string
  requiresModel: boolean
  /** 内置候选模型（后端下发），Key 拉取到真实清单后会替换 */
  models?: string[]
}

interface ModelOption {
  id: string
  name: string
  contextWindow: number | null
}

// 服务商清单由后端返回（两边各硬编码一份会悄悄发错地址）
// 初始清单留空占位，真实清单由后端下发（不要在本地写死某家的模型名：
// 用户可能是阿里/Kimi 的 Key，写死 deepseek-v4-pro 会让人误以为是默认值）
const providers = ref<ProviderOption[]>([
  { value: 'deepseek', group: '国内', label: 'DeepSeek', model: '', modelHint: '', requiresModel: false },
])

// 「国内 / 国外 / 其他」分组，避免二十多个选项平铺成一长串
const providerGroups = computed(() => {
  const order = ['国内', '国外', '其他']
  const map = new Map<string, ProviderOption[]>()
  for (const p of providers.value) {
    const g = p.group || '其他'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(p)
  }
  return order.filter((g) => map.has(g)).map((g) => ({ name: g, items: map.get(g)! }))
})

const currentProvider = computed(() => providers.value.find((p) => p.value === form.provider) || null)

// ── 模型下拉候选（随服务商联动，优先用 Key 实时拉取）──────────────────────
const modelOptions = ref<ModelOption[]>([])
const modelsLoading = ref(false)
const modelsSource = ref<'account' | 'builtin' | ''>('')
const modelsNote = ref('')
// 已拉过清单的服务商，避免每次开弹窗都请求
const modelsLoadedFor = ref('')

const modelsPlaceholder = computed(() => {
  if (modelsLoading.value) return '正在获取该服务商的模型…'
  if (currentProvider.value?.requiresModel) return '必选，请选择模型'
  return providerModel(form.provider) ? `留空使用 ${providerModel(form.provider)}` : '可留空'
})

/** 拉取当前服务商的模型清单 */
async function loadProviderModels(force = false) {
  const provider = form.provider
  if (!provider) return
  if (modelsLoading.value) return
  if (!force && modelsLoadedFor.value === provider && modelOptions.value.length) return

  modelsLoading.value = true
  try {
    // 编辑时用已保存的 Key（能拿到该账号真实可用清单）；新增时用已填的 Key
    const res = await userApiKeyApi.listModels({
      provider,
      keyId: editingId.value || undefined,
      apiKey: !editingId.value && form.apiKey.trim().length >= 16 ? form.apiKey.trim() : undefined,
    })
    // 关键：本轮请求期间用户可能已经换了服务商，过期结果必须丢弃，
    // 否则会把上一家的模型填进当前下拉（选中值也会被覆盖成空）
    if (form.provider !== provider) return

    const next = (res && res.models.length)
      ? res.models
      : (currentProvider.value?.models || []).map((id) => ({ id, name: '', contextWindow: null }))

    if (next.length) {
      // 关键：把「当前已选中的模型」保留在候选里。
      // 否则清单里没有这条时，el-select 找不到匹配项，
      // 选中值会显示成 placeholder（实测编辑时模型值为 glm-4-air，
      // 打开弹窗却显示「留空使用 …」）。
      const current = String(form.model || '').trim()
      const merged = current && !next.some((m) => m.id === current)
        ? [{ id: current, name: '', contextWindow: null }, ...next]
        : next
      modelOptions.value = merged
      modelsSource.value = res && res.models.length ? res.source : 'builtin'
      modelsNote.value = (res && res.note) || ''
      modelsLoadedFor.value = provider
    }
  } finally {
    modelsLoading.value = false
  }
}

/** 打开下拉时才拉取，避免无谓请求 */
function onModelDropdown(visible: boolean) {
  if (visible) loadProviderModels(false)
}

/**
 * 模型选择兜底
 *
 * Element Plus 2.14 的 filterable 下拉在「输入筛选」状态下，
 * 某些交互会让选中值不落到 v-model（实测点了没写入，输入框仍为空）。
 * 这里从 change 事件再确认一次，保证值一定写进去。
 */
function onModelChange(val: any) {
  const v = typeof val === 'string' ? val : (val && val.id) || ''
  if (v && form.model !== v) form.model = v
}

/**
 * 服务商变化 → 重建模型候选
 *
 * ⚠ 这里**绝对不要**清空 `form.model`。
 * watch 回调是异步（pre flush）执行的：openEdit 里
 *   formInitializing = true → 赋值 provider/model → formInitializing = false
 * 全是同步代码，watch 回调要等这次同步执行结束才跑，那时
 * formInitializing 已经是 false 了。所以在 watch 里清 model 会把
 * 刚回填的值抹掉 —— 这正是「编辑 glm-4-air 却显示留空使用 …」的根因
 * （排查了很久，因为它看起来像 el-select 回显问题）。
 *
 * 清空逻辑改由用户的真实操作触发：模板上 el-select 的 @change
 * 直接调 onProviderChange（用户手动换服务商时才会走到）。
 */
watch(() => form.provider, (next, prev) => {
  if (next === prev) return
  modelsLoadedFor.value = ''
  modelsSource.value = ''
  modelsNote.value = ''
  const seed = providers.value.find((p) => p.value === next)?.models || []
  modelOptions.value = seed.map((id) => ({ id, name: '', contextWindow: null }))
  if (seed.length) modelsSource.value = 'builtin'
  if (dialogVisible.value) {
    loadProviderModels(false)
    formRef.value?.validateField('model').catch(() => {})
  }
})

/**
 * 用户手动切换服务商
 *
 * 只有真人操作才需要清空模型：不同服务商的模型名不通用，
 * 留着上一家的名字会直接 400「不支持的模型名」。
 * 编辑回填不经过这里（回填是代码赋值，不触发 @change）。
 */
function onProviderChange() {
  form.model = ''
}

function providerLabel(value: string): string {
  return providers.value.find((p) => p.value === value)?.label || value || 'DeepSeek'
}

function providerModel(value: string): string {
  return providers.value.find((p) => p.value === value)?.model || ''
}

const rules = computed<FormRules>(() => ({
  name: [{ required: true, message: '请填写名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择服务商', trigger: 'change' }],
  // 始终挂一个 validator：动态把规则置空会让「必填」在切换服务商后仍不生效
  model: [{
    trigger: 'blur',
    validator: (_rule: any, value: string, cb: (e?: Error) => void) => {
      const need = providers.value.find((p) => p.value === form.provider)?.requiresModel
      if (need && !String(value || '').trim()) {
        cb(new Error('该服务商必须填写模型'))
        return
      }
      cb()
    },
  }],
  apiKey: editingId.value
    // 编辑时允许留空（表示不换 Key）
    ? []
    : [
        { required: true, message: '请填写 API Key', trigger: 'blur' },
        { min: 16, message: 'API Key 至少 16 位', trigger: 'blur' },
      ],
}))

async function load() {
  loading.value = true
  try {
    const res = await userApiKeyApi.list()
    if (!res) {
      keys.value = []
      return
    }
    keys.value = res.keys
    hasDefault.value = res.hasDefault
    platformKeyAvailable.value = res.platformKeyAvailable
    platformKeyHint.value = res.platformKeyHint
    if (res.providers && res.providers.length) {
      providers.value = res.providers as ProviderOption[]
    }
  } finally {
    loading.value = false
  }
}

/**
 * 弹窗关闭后的清理
 *
 * ⚠ 这里**不能**清空表单字段。
 * el-dialog 的 @closed 在关闭动画结束后才触发（实测约 300~700ms）。
 * 如果用户关闭后马上点「编辑」打开另一条，closed 会延迟到新弹窗
 * **打开之后**才触发 —— 那时再 resetForm 就会把刚回填的 model 抹掉。
 * 实测症状：编辑 glm-4-air 却显示「留空使用 glm-4-plus」。
 *
 * 表单复位统一放到 openCreate / openEdit 开头（打开前清），
 * 关闭时只清校验态与瞬时 UI 状态。
 */
function onDialogClosed() {
  formRef.value?.clearValidate()
  modelsLoading.value = false
}

/** 表单复位（只在打开弹窗前调用，绝不由 @closed 触发） */
function resetForm() {
  editingId.value = ''
  form.name = ''
  form.provider = 'deepseek'
  form.apiKey = ''
  form.model = ''
  formRef.value?.clearValidate()
}

function openCreate() {
  resetForm()
  // 先用内置候选垫着（同步），下拉立刻可用
  const seed = providers.value.find((p) => p.value === form.provider)?.models || []
  modelOptions.value = seed.map((id) => ({ id, name: '', contextWindow: null }))
  modelsSource.value = seed.length ? 'builtin' : ''
  modelsLoadedFor.value = ''
  dialogVisible.value = true
  // 用户填完 Key 后可点「刷新清单」按账号拉取
  loadProviderModels(false)
}

function openEdit(row: UserApiKey) {
  resetForm()
  editingId.value = row.id
  form.name = row.name
  form.provider = row.provider || 'deepseek'
  form.model = row.model || ''
  // 先用内置候选 + 当前值垫上，避免异步回来前显示成空
  const seed = providers.value.find((p) => p.value === form.provider)?.models || []
  const seeded = row.model && !seed.includes(row.model) ? [row.model, ...seed] : seed
  modelOptions.value = seeded.map((id) => ({ id, name: '', contextWindow: null }))
  modelsSource.value = seeded.length ? 'builtin' : ''
  modelsLoadedFor.value = ''
  dialogVisible.value = true
  // 不在这里异步拉清单：返回时机不确定，会把上面 seed 好的候选替换掉，
  // 导致已选中的模型找不到匹配项而显示成 placeholder。
  // 用户想按账号拉真实清单时点「刷新清单」即可。
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    // 提交名称、服务商与 Key；接口地址与模型由服务商自动决定，不需要用户填
    const payload = {
      name: form.name.trim(),
      provider: form.provider,
      model: form.model.trim(),
    }
    const res = editingId.value
      ? await userApiKeyApi.update(editingId.value, {
          ...payload,
          // 留空 = 不改 Key
          apiKey: form.apiKey.trim() || undefined,
        })
      : await userApiKeyApi.create({ ...payload, apiKey: form.apiKey.trim() })

    if (res.ok) {
      ElMessage.success(res.message)
      dialogVisible.value = false
      await load()
    } else {
      ElMessage.error(res.message)
    }
  } finally {
    saving.value = false
  }
}

async function handleSetDefault(row: UserApiKey) {
  const res = await userApiKeyApi.setDefault(row.id)
  if (res.ok) {
    ElMessage.success(res.message)
    await load()
  } else {
    ElMessage.error(res.message)
  }
}

async function handleVerify(row: UserApiKey) {
  verifyingId.value = row.id
  try {
    const res = await userApiKeyApi.verify(row.id)
    if (res.ok) ElMessage.success(res.message)
    else ElMessage.error(res.message)
    await load()
  } finally {
    verifyingId.value = ''
  }
}

async function handleDelete(row: UserApiKey) {
  try {
    await ElMessageBox.confirm(
      row.isDefault
        ? `确定删除「${row.name}」吗？它是当前默认 Key，删除后会自动把最早的一条设为默认；如果没有其他 Key，平台将回退到统一提供的 Key。`
        : `确定删除「${row.name}」吗？删除后无法恢复，需要重新录入 Key。`,
      '删除 API Key',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const res = await userApiKeyApi.remove(row.id)
  if (res.ok) {
    ElMessage.success(res.message)
    await load()
  } else {
    ElMessage.error(res.message)
  }
}

onMounted(load)
</script>

<style scoped>
.api-key-settings-view {
  padding: 24px;
  max-width: 1280px;
}

/* 类名刻意不用 .page-header / .view-header：
   外层 AdminDashboardView 有 :deep(.page-header){display:none} 去掉内嵌页头，
   撞名会把本页的标题和右上角「新增」按钮一起隐藏掉（实测按钮点不到）。 */
.apikey-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.apikey-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.apikey-subtitle {
  margin: 0;
  max-width: 720px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.status-alert {
  margin-bottom: 14px;
}

.alert-body {
  font-size: 13px;
  line-height: 1.7;
}

.list-card {
  border-radius: 10px;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.key-name {
  font-weight: 500;
}

.key-hint {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}

.verified-at {
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.never-verified {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.model-option-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.model-option-meta {
  float: right;
  margin-left: 12px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.models-source.ok { color: var(--el-color-success); }
.models-source.warn { color: var(--el-color-warning); }

.models-refresh {
  margin-left: 10px;
  color: var(--el-color-primary);
  cursor: pointer;
  text-decoration: underline;
}

.provider-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.provider-name {
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.provider-model {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.required-hint {
  color: var(--el-color-warning);
}

.security-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.field-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
