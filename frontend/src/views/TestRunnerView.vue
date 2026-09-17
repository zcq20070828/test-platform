<template>
  <div class="test-runner-view">
    <!-- 头部 -->
    <div class="view-header">
      <div>
        <h2 class="view-title">自动化测试</h2>
        <p class="view-subtitle">自动化测试执行与结果分析</p>
      </div>
    </div>

    <el-row :gutter="16">
      <!-- 左侧:配置面板 -->
      <el-col :span="14">
        <el-card class="config-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Setting /></el-icon> 测试配置</span>
              <el-button size="small" text @click="resetConfig">
                <el-icon><Refresh /></el-icon> 重置
              </el-button>
            </div>
          </template>

          <el-form :model="config" label-width="90" size="default">
            <el-form-item label="测试脚本">
              <div style="display:flex;align-items:center;gap:8px;width:100%">
                <el-input v-model="config.testPath" placeholder="/path/to/tests" clearable style="flex:1" />
                <el-button title="浏览目录" style="flex-shrink:0" @click="dirInputRef?.click()">
                  <el-icon><FolderOpened /></el-icon>
                </el-button>
                <input ref="dirInputRef" type="file" webkitdirectory style="display:none" @change="handleBrowseDir" />
                <el-button title="浏览文件" style="flex-shrink:0" @click="fileInputRef?.click()">
                  <el-icon><Document /></el-icon>
                </el-button>
                <input ref="fileInputRef" type="file" multiple style="display:none" @change="handleBrowseFile" />
              </div>
              <div class="form-tip">支持输入路径或点击浏览</div>
            </el-form-item>

            <el-form-item label="执行智能体">
              <el-select v-model="config.executorAgent" placeholder="选择执行智能体" style="width:100%;text-align:right">
                <el-option label="UI/E2E测试 (ui-e2e-executor)" value="ui-e2e-executor" />
                <el-option label="接口测试 (api-executor)" value="api-executor" />
              </el-select>
              <div class="form-tip">选择执行测试脚本的智能体,将调用对应 Skill 执行测试</div>
            </el-form-item>

            <el-form-item label="测试框架">
              <el-select v-model="config.framework" placeholder="自动检测" clearable style="width:100%">
                <el-option label="自动检测" value="" />
                <el-option label="Jest (JavaScript/TypeScript)" value="jest" />
                <el-option label="Pytest (Python)" value="pytest" />
                <el-option label="Playwright (E2E)" value="playwright" />
                <el-option label="Vitest" value="vitest" />
                <el-option label="Mocha" value="mocha" />
              </el-select>
            </el-form-item>

            <el-divider content-position="left">执行选项</el-divider>

            <el-form-item label="并发数">
              <el-slider
                v-model="config.workers"
                :min="1"
                :max="16"
                :step="1"
                show-stops
                style="width:100%"
              />
              <div class="form-tip">{{ config.workers }} 个并行 worker</div>
            </el-form-item>

            <el-form-item label="超时(ms)">
              <el-input-number
                v-model="config.timeout"
                :min="5000"
                :max="300000"
                :step="5000"
                style="width:100%"
              />
            </el-form-item>

            <el-form-item label="重试次数">
              <el-input-number
                v-model="config.retries"
                :min="0"
                :max="5"
                :step="1"
                style="width:100%"
              />
            </el-form-item>

            <el-form-item>
              <el-checkbox v-model="config.coverage">生成覆盖率报告</el-checkbox>
              <el-checkbox v-model="config.verbose">详细输出 (verbose)</el-checkbox>
              <el-checkbox v-model="config.debug">调试模式</el-checkbox>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" :loading="running" @click="runTests">
                <el-icon><VideoPlay /></el-icon>
                {{ running ? '执行中...' : '运行测试' }}
              </el-button>
              <el-button v-if="running" type="danger" @click="stopTests">
                停止
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <!-- 右侧:结果面板 -->
      <el-col :span="10" style="display:flex; flex-direction:column; gap:12px">
        <!-- 统计卡片 -->
        <el-row :gutter="12" class="stats-row">
          <el-col :span="8">
            <div class="stat-card passed">
              <div class="stat-num">{{ results.total - results.failed - results.skipped }}</div>
              <div class="stat-label">通过</div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="stat-card failed">
              <div class="stat-num">{{ results.failed }}</div>
              <div class="stat-label">失败</div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="stat-card skipped">
              <div class="stat-num">{{ results.skipped }}</div>
              <div class="stat-label">跳过</div>
            </div>
          </el-col>
        </el-row>

        <!-- 进度条 -->
        <el-card v-if="running || results.total > 0" class="progress-card" shadow="never">
          <div class="progress-info">
            <span>执行进度</span>
            <span v-if="results.total > 0">{{ results.passed }}/{{ results.total }}</span>
            <span v-else class="progress-phase">{{ testPhaseText }}</span>
          </div>
          <el-progress
            :percentage="results.total > 0 ? Math.round((results.passed + results.failed) / results.total * 100) : 100"
            :indeterminate="running && results.total === 0"
            :duration="3"
            :color="progressColor"
            :status="results.total > 0 && results.failed > 0 ? 'exception' : (results.total > 0 ? 'success' : undefined)"
            :stroke-width="10"
          />
        </el-card>

        <!-- 实时日志 -->
        <el-card class="log-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Monitor /></el-icon> 执行日志</span>
              <el-button size="small" text @click="clearLog">
                <el-icon><Delete /></el-icon> 清空
              </el-button>
            </div>
          </template>

          <div v-if="logs.length === 0" class="log-empty">
            <el-icon :size="32" color="#c0c4cc"><Document /></el-icon>
            <p>暂无日志,点击「运行测试」开始执行</p>
          </div>

          <div v-else ref="logContainerRef" class="log-container">
            <div
              v-for="(log, i) in logs"
              :key="i"
              class="log-line"
              :class="`log-${log.type}`"
            >
              <span class="log-time">{{ log.time }}</span>
              <span class="log-msg">{{ log.msg }}</span>
            </div>
          </div>
        </el-card>

        <!-- 失败用例 -->
        <el-card v-if="results.failures && results.failures.length > 0" class="failures-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><WarningFilled /></el-icon> 失败用例 ({{ results.failures.length }})</span>
            </div>
          </template>
          <el-collapse>
            <el-collapse-item
              v-for="(f, i) in results.failures"
              :key="i"
              :title="f.name"
              :name="i"
            >
              <div class="failure-detail">
                <div v-if="f.message" class="failure-msg">{{ f.message }}</div>
                <div v-if="f.stack" class="failure-stack">{{ f.stack }}</div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </el-card>

        <!-- 覆盖率报告 -->
        <el-card v-if="config.coverage || (results.extra && (results.extra.scriptCoverage || results.extra.systemCoverageAvailable !== undefined || results.extra.coverage))" class="coverage-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><DataLine /></el-icon> 覆盖率报告</span>
              <el-tag v-if="results.extra && results.extra.systemCoverageAvailable" type="success" size="small">系统覆盖率可用</el-tag>
              <el-tag v-else-if="results.extra" type="info" size="small">仅脚本覆盖率</el-tag>
              <el-tag v-else type="info" size="small">等待数据...</el-tag>
            </div>
          </template>
          <div v-if="results.extra && results.extra.scriptCoverage" class="coverage-block">
            <div class="coverage-row">
              <span class="coverage-label">已执行脚本：</span>
              <span class="coverage-value">{{ results.extra.scriptCoverage.covered }} / {{ results.extra.scriptCoverage.total }}</span>
            </div>
            <div v-if="results.extra.scriptCoverage.executed && results.extra.scriptCoverage.executed.length > 0" class="coverage-files">
              <el-collapse>
                <el-collapse-item title="执行文件列表" name="files">
                  <ul class="file-list">
                    <li v-for="(file, i) in results.extra.scriptCoverage.executed" :key="i">
                      <el-icon><Document /></el-icon> {{ file }}
                    </li>
                  </ul>
                </el-collapse-item>
              </el-collapse>
            </div>
          </div>
          <div v-if="results.extra && results.extra.coverage" class="coverage-block">
            <pre class="coverage-raw">{{ results.extra.coverage }}</pre>
          </div>
          <div v-if="results.extra && results.extra.coverageNote" class="coverage-note">
            <el-alert :title="results.extra.coverageNote" type="warning" :closable="false" />
          </div>
          <div v-if="results.extra && !results.extra.systemCoverageAvailable && results.extra.scriptCoverage" class="coverage-note">
            <el-alert
              title="系统覆盖率需要项目配置(如 playwright.config.ts 中设置 coverage reporter)"
              type="info"
              :closable="false"
            />
          </div>
        </el-card>

        <!-- 详细输出 (verbose) -->
        <el-card v-if="config.verbose || results.rawOutput || results.extra?.verboseOutput" class="verbose-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Tickets /></el-icon> 详细输出 (verbose)</span>
              <div>
                <el-button size="small" text @click="copyRawOutput">
                  <el-icon><CopyDocument /></el-icon> 复制
                </el-button>
                <el-button size="small" text @click="downloadRawOutput">
                  <el-icon><Download /></el-icon> 下载
                </el-button>
              </div>
            </div>
          </template>
          <div class="verbose-meta">
            <el-tag size="small">工具: {{ results.tool || 'auto' }}</el-tag>
            <el-tag size="small" :type="results.exitCode === 0 ? 'success' : 'danger'">退出码: {{ results.exitCode }}</el-tag>
            <el-tag size="small">总长度: {{ (results.rawOutput || '').length }} chars</el-tag>
          </div>
          <pre v-if="results.rawOutput" class="raw-output">{{ results.rawOutput }}</pre>
          <el-empty
            v-else
            description="智能体未返回原始输出(未调用测试 skill 或脚本未实际运行)"
            :image-size="60"
            style="padding:12px 0"
          />
        </el-card>

        <!-- 调试信息 (debug) -->
        <el-card v-if="config.debug || results.extra?.debug" class="debug-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Setting /></el-icon> 调试信息</span>
            </div>
          </template>
          <div class="debug-info">
            <div class="debug-row">
              <span class="debug-label">框架：</span>
              <span class="debug-value">{{ results.tool || 'auto' }}</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">退出码：</span>
              <span class="debug-value" :class="{'debug-error': results.exitCode !== 0}">{{ results.exitCode }}</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">调试说明：</span>
              <span class="debug-value">{{ results.extra?.note || '调试模式已启用' }}</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">环境变量：</span>
              <span class="debug-value debug-env">
                DEBUG=pw:api, headless=false
              </span>
            </div>
            <div v-if="results.testcases.length > 0" class="debug-row">
              <span class="debug-label">用例列表({{ results.testcases.length }})：</span>
            </div>
            <div v-if="results.testcases.length > 0" class="debug-testcases">
              <el-collapse>
                <el-collapse-item
                  v-for="(tc, i) in results.testcases"
                  :key="i"
                  :name="`tc-${i}`"
                  :title="`${tc.status === 'passed' ? '✓' : tc.status === 'failed' ? '✗' : '○'} ${tc.name || '(unnamed)'}`"
                >
                  <div class="tc-detail">
                    <div>状态：<el-tag :type="tc.status === 'passed' ? 'success' : (tc.status === 'failed' ? 'danger' : 'info')" size="small">{{ tc.status }}</el-tag></div>
                    <div v-if="tc.duration">耗时：{{ tc.duration }}ms</div>
                    <div v-if="tc.classname">类名：{{ tc.classname }}</div>
                    <div v-if="tc.error" class="debug-error">错误：{{ tc.error }}</div>
                    <div v-if="tc.stack" class="tc-stack"><pre>{{ tc.stack }}</pre></div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>
            <div class="debug-row">
              <span class="debug-label">原始输出：</span>
            </div>
            <pre class="raw-output">{{ results.rawOutput || '(无原始输出)' }}</pre>
          </div>
        </el-card>

      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, testFrameworkApi, taskApi, getAuthHeaders } from '@/api'
import { useMainStore } from '@/stores/main'

const store = useMainStore()
const currentTaskId = ref<string>('')
const logContainerRef = ref<HTMLElement | null>(null)

// 框架列表(仅显示安装状态)
const frameworks = ref([
  { name: 'jest',      label: 'Jest',      installed: false },
  { name: 'pytest',   label: 'Pytest',    installed: false },
  { name: 'playwright',label: 'Playwright',installed: false },
  { name: 'vitest',   label: 'Vitest',    installed: false },
])

// 页面加载时检查框架安装状态
onMounted(async () => {
  for (const fw of frameworks.value) {
    try {
      const res = await fetch(`/api/test-framework/install/job?framework=${fw.name}`, {
        headers: { ...getAuthHeaders() }
      })
      const job = await res.json()
      const jobData = job?.data
      if (jobData && jobData.status === 'done') {
        fw.installed = true
      }
    } catch (e) {
      console.error('[TestRunner] check status error:', e)
    }
  }
})

// 文件浏览 ref
const fileInputRef  = ref<HTMLInputElement | null>(null)
const dirInputRef  = ref<HTMLInputElement | null>(null)

// 浏览目录(webkitdirectory):取目录路径
function handleBrowseDir(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return
  const first = input.files[0] as any
  // webkitRelativePath 格式: "子目录名/文件名",取第一层目录
  const dir = first.webkitRelativePath
    ? '/' + first.webkitRelativePath.split('/').slice(0, -1).join('/')
    : first.path || ''
  config.testPath = dir
  input.value = ''
}

// 浏览文件(普通多选):多文件用换行分隔
function handleBrowseFile(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return
  const paths = Array.from(input.files).map((f: any) => f.path || f.name)
  config.testPath = paths.length === 1 ? paths[0] : paths.join('\n')
  input.value = ''
}

// 配置
const config = reactive({
  testPath:      '',
  executorAgent: '',
  framework:     '',
  workers:       4,
  timeout:       30000,
  retries:       0,
  coverage:      false,
  verbose:       false,
  debug:         false,
})

function resetConfig() {
  config.testPath      = ''
  config.executorAgent = ''
  config.framework     = ''
  config.workers       = 4
  config.timeout       = 30000
  config.retries    = 0
  config.coverage  = false
  config.verbose   = false
  config.debug     = false
}

async function checkFramework(name: string) {
  const fw = frameworks.value.find(f => f.name === name)
  if (!fw) return
  try {
    const res = await request<any>(`/api/test-framework/check?framework=${name}`)
    const inner = (res?.data as any)?.data ?? (res?.data as any) ?? {}
    fw.installed = res?.success === true && inner?.installed === true
  } catch {
    console.error(`检测 ${fw?.label} 失败`)
  }
}

// 运行状态
const running = ref(false)
const logs    = ref<{time: string; type: string; msg: string}[]>([])
// V3: 测试执行阶段跟踪(用于不确定进度条的文字提示)
const testPhase = ref<'submitting' | 'analyzing' | 'executing' | 'parsing' | 'done'>('submitting')
const testPhaseText = computed(() => {
  switch (testPhase.value) {
    case 'submitting': return '提交任务中...'
    case 'analyzing':  return '智能体分析中...'
    case 'executing':  return '测试执行中...'
    case 'parsing':    return '解析结果中...'
    case 'done':       return '完成'
    default:           return '执行中...'
  }
})

const results = reactive({
  total:    0,
  passed:   0,
  failed:   0,
  skipped:   0,
  duration: 0,
  failures: [] as {name: string; message: string; stack?: string}[],
  // === 高级选项结果数据(coverage/verbose/debug)===
  extra:       null as any,     // 完整的 UTRM.extra 对象
  rawOutput:   '' as string,    // verbose/debug 模式的原始输出(stdout+stderr)
  exitCode:    0 as number,
  testcases:   [] as any[],     // 所有用例详情
  tool:        '' as string,    // playwright / pytest / newman / selenium / cypress / restassured
})

const progressColor = computed(() => {
  if (results.failed > 0) return '#f56c6c'
  if (results.passed === results.total && results.total > 0) return '#67c23a'
  return '#409eff'
})

function addLog(type: string, msg: string) {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`
  logs.value.push({ time, type, msg })
  nextTick(() => {
    if (logContainerRef.value) {
      logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
    }
  })
}

function clearLog() {
  logs.value = []
}

async function runTests() {
  if (!config.testPath.trim()) {
    ElMessage.warning('请填写测试路径')
    return
  }

  // 初始化结果
  results.total = results.passed = results.failed = results.skipped = results.duration = 0
  results.failures = []
  results.extra       = null
  results.rawOutput   = ''
  results.exitCode    = 0
  results.testcases   = []
  results.tool        = ''
  testPhase.value = 'submitting'
  clearLog()
  running.value = true
  addLog('info', `开始经智能体执行测试: ${config.testPath}`)

  const isApi = ['newman', 'restassured', 'pytest'].includes((config.framework || '').toLowerCase())
  const agent = config.executorAgent || (isApi ? 'api-executor' : 'ui-e2e-executor')

  // 任务指令:明确要求智能体通过工具调用真实运行测试 skill
  const taskInput = `执行${isApi ? '接口(API)' : 'UI/E2E'}测试:
- 测试脚本/集合路径:${config.testPath}
- 测试框架:${config.framework || '自动检测'}
- 执行选项:并发workers=${config.workers},超时=${config.timeout}ms,重试retries=${config.retries},覆盖率coverage=${config.coverage},详细verbose=${config.verbose},调试debug=${config.debug}
请使用对应的测试执行 skill(调用 ui_test_tool_invoker 或 api_test_tool_invoker 工具)真实运行测试,并返回 UTRM 标准结果。`

  try {
    const task = await store.createTask(agent, taskInput)
    if (!task) {
      addLog('error', '任务创建失败(可能已有任务在执行)')
      ElMessage.error('任务创建失败,请确认没有其它任务正在执行')
      running.value = false
      return
    }
    currentTaskId.value = task.id
    testPhase.value = 'analyzing'
    addLog('info', `已提交任务 ${task.id} 给智能体 ${agent},等待执行与工具调用...`)
  } catch (e: any) {
    const msg = e?.message || e?.error || '未知错误'
    addLog('error', `提交失败: ${msg}`)
    ElMessage.error(`提交失败: ${msg}`)
    running.value = false
  }
}

// 智能体真正调用 skill 并回传结构化结果(UTRM)时,填充到测试运行器
watch(() => store.realtimeSkillResult, (data: any) => {
  if (!data || data.taskId !== currentTaskId.value) return
  const utrm = data.result
  if (!utrm) return
  testPhase.value = 'parsing'
  const s = utrm.summary || {}
  results.total    = s.total    || 0
  results.passed   = s.passed   || 0
  results.failed   = s.failed   || 0
  results.skipped  = s.skipped  || 0
  results.duration = s.duration || 0
  results.failures = (utrm.testcases || []).filter((tc: any) => tc.status === 'failed')
  // === 高级选项原始数据(供覆盖率/详细输出/调试面板使用) ===
  results.extra     = utrm.extra || null
  results.rawOutput = utrm.raw || utrm.rawOutput || ''
  results.exitCode  = utrm.exitCode ?? 0
  results.testcases = utrm.testcases || []
  results.tool      = utrm.tool || ''
  addLog('success', `智能体调用 ${data.skillId} 完成!通过: ${results.passed}  失败: ${results.failed}  跳过: ${results.skipped}  耗时: ${results.duration}ms`)
  if (utrm.extra?.note) addLog('info', `执行备注: ${utrm.extra.note}`)
  if (results.failed === 0 && results.total > 0) {
    ElMessage.success(`✅ 全部通过!共 ${results.total} 个用例`)
  } else if (results.failed > 0) {
    ElMessage.error(`❌ ${results.failed} 个用例失败,请查看详情`)
  }
  testPhase.value = 'done'
}, { deep: true })

// V3: 跟踪任务状态,更新执行阶段(智能体开始运行测试时进入 'executing')
watch(() => {
  const t = store.tasks.find((x: any) => x.id === (currentTaskId.value || ''))
  return t?.status
}, (st) => {
  if (st === 'running' && testPhase.value === 'analyzing') {
    testPhase.value = 'executing'
  }
})

// 任务结束(完成/失败/取消)时收尾
watch(() => {
  const t = store.tasks.find((x: any) => x.id === (currentTaskId.value || ''))
  return t?.status
}, (st) => {
  if (st && ['completed', 'failed', 'cancelled', 'error'].includes(st)) {
    if (running.value) {
      running.value = false
      addLog('info', `任务结束(状态: ${st})`)
    }
  }
})

function stopTests() {
  if (currentTaskId.value) {
    taskApi.cancel(currentTaskId.value)
      .then(() => addLog('warn', `已请求取消任务 ${currentTaskId.value}`))
      .catch(() => {})
  }
  running.value = false
  addLog('warn', '用户中止执行')
  ElMessage.warning('测试已停止')
}

// 复制原始输出到剪贴板
async function copyRawOutput() {
  if (!results.rawOutput) {
    ElMessage.warning('暂无原始输出')
    return
  }
  try {
    await navigator.clipboard.writeText(results.rawOutput)
    ElMessage.success('已复制原始输出到剪贴板')
  } catch {
    ElMessage.error('复制失败,请手动选择')
  }
}

// 下载原始输出为文本文件
function downloadRawOutput() {
  const content = results.rawOutput || ''
  if (!content) {
    ElMessage.warning('暂无原始输出')
    return
  }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  a.href = url
  a.download = `test-output-${results.tool || 'unknown'}-${ts}.log`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 启动时自动检测已安装框架
async function checkInstalledFrameworks() {
  for (const fw of frameworks.value) {
    try {
      const res = await request<any>(`/api/test-framework/check?framework=${fw.name}`)
      // 双层包装兼容:res.data.data.installed 优先,fallback 到 res.data.installed(install/job 接口用)
      const inner = (res?.data as any)?.data ?? (res?.data as any) ?? {}
      fw.installed = res?.success === true && inner?.installed === true
    } catch { /* ignore */ }
  }
}

checkInstalledFrameworks()
</script>

<style scoped>
.test-runner-view {
  padding: 20px;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.view-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
}

.view-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.framework-row {
  margin-bottom: 16px;
}

.fw-card {
  margin-bottom: 12px;
}

.fw-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fw-name {
  font-weight: 500;
  flex: 1;
}

/* 安装日志面板 */
.install-progress {
  margin-top: 10px;
}

.install-log-panel {
  margin-top: 10px;
  background: #1e1e1e;
  border-radius: 6px;
  padding: 10px 12px;
  max-height: 180px;
  overflow-y: auto;
}

.install-log-content {
  margin: 0;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #a8d8a8;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 测试脚本行布局 */
.test-script-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.browse-btn {
  flex-shrink: 0;
  white-space: nowrap;
}

/* 隐藏原生文件选择器 */
.hidden-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.config-card {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}

.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.stats-row {
  margin-bottom: 12px;
}

.stat-card {
  text-align: center;
  padding: 16px 8px;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
}

.stat-card.passed  { background: linear-gradient(135deg, #67c23a, #85ce61); }
.stat-card.failed  { background: linear-gradient(135deg, #f56c6c, #f78989); }
.stat-card.skipped { background: linear-gradient(135deg, #909399, #a6a9ad); }

.stat-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 12px;
  opacity: 0.9;
}

.progress-card {
  margin-bottom: 12px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}

.progress-phase {
  color: var(--el-color-primary);
  font-weight: 500;
  animation: phase-pulse 1.5s ease-in-out infinite;
}

@keyframes phase-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.log-card {
  margin-bottom: 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 120px;
}

.log-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.log-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.log-container {
  flex: 1;
  overflow-y: auto;
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  background: #1e1e1e;
  border-radius: 6px;
  padding: 8px;
}

.log-line {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  line-height: 1.5;
}

.log-time  { color: #888; flex-shrink: 0; }
.log-info  .log-msg { color: #e0e0e0; }
.log-success .log-msg { color: #67c23a; }
.log-error  .log-msg { color: #f56c6c; }
.log-warn   .log-msg { color: #e6a23c; }

.failure-detail {
  font-size: 13px;
}

.failure-msg {
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.failure-stack {
  font-family: monospace;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  padding: 8px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* === 覆盖率/详细输出/调试信息卡片 样式 === */
.coverage-card,
.verbose-card,
.debug-card {
  margin-bottom: 12px;
}

.coverage-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
}

.coverage-label {
  color: var(--el-text-color-secondary);
}

.coverage-value {
  font-weight: 600;
  color: var(--el-color-primary);
}

.coverage-files {
  margin-top: 8px;
  font-family: monospace;
  font-size: 12px;
}

.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 240px;
  overflow-y: auto;
}

.file-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  color: var(--el-text-color-regular);
}

.file-list li:hover {
  background: var(--el-fill-color-light);
}

.coverage-note {
  margin-top: 8px;
}

.coverage-raw {
  font-family: monospace;
  font-size: 11px;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 8px;
  border-radius: 4px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.verbose-meta {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.raw-output {
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: 11px;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 10px;
  border-radius: 6px;
  max-height: 400px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  line-height: 1.5;
}

.debug-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.debug-row {
  display: flex;
  gap: 8px;
  padding: 4px 0;
}

.debug-label {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-weight: 500;
  min-width: 80px;
}

.debug-value {
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.debug-env {
  font-family: monospace;
  font-size: 12px;
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 3px;
}

.debug-error {
  color: var(--el-color-danger);
}

.debug-testcases {
  margin-top: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.tc-detail {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tc-stack pre {
  font-family: monospace;
  font-size: 11px;
  background: var(--el-fill-color-light);
  padding: 8px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 4px 0 0 0;
  max-height: 200px;
  overflow: auto;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.card-header > :first-child {
  flex: 1;
}

.card-header > div:last-child {
  display: flex;
  gap: 4px;
}

.card-header > div:not(:last-child) {
  display: flex;
  gap: 6px;
}
</style>
