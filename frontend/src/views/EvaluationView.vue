<template>
  <div class="evaluation-view">
    <!-- 头部 -->
    <div class="view-header">
      <div>
        <h2 class="view-title">📊 智能评估</h2>
        <p class="view-subtitle">三层五级评估 · 能力层 / 质量层 / 业务价值层</p>
      </div>
      <div class="header-actions">
        <el-button @click="loadAgents">
          <el-icon><Refresh /></el-icon> 刷新智能体
        </el-button>
      </div>
    </div>

    <el-row :gutter="16">
      <!-- ============================================================
           左侧：评估配置面板 (40%)
      ============================================================ -->
      <el-col :span="10">
        <!-- 智能体选择 -->
        <el-card class="config-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Cpu /></el-icon> 评估对象</span>
            </div>
          </template>

          <el-form :model="config" label-width="80" size="default">
            <el-form-item label="智能体">
              <el-select
                v-model="config.agentIds"
                multiple
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择要评估的智能体（与任务ID二选一）"
                style="width:100%"
                @change="onAgentChange"
              >
                <el-option-group label="需求分析类">
                  <el-option
                    v-for="a in agentsByType.requirement"
                    :key="a.id"
                    :label="a.name"
                    :value="a.id"
                  >
                    <span>{{ a.icon || '🤖' }} {{ a.name }}</span>
                  </el-option>
                </el-option-group>
                <el-option-group label="执行类">
                  <el-option
                    v-for="a in agentsByType.executor"
                    :key="a.id"
                    :label="a.name"
                    :value="a.id"
                  >
                    <span>{{ a.icon || '🤖' }} {{ a.name }}</span>
                  </el-option>
                </el-option-group>
                <el-option-group label="报告类">
                  <el-option
                    v-for="a in agentsByType.reporter"
                    :key="a.id"
                    :label="a.name"
                    :value="a.id"
                  >
                    <span>{{ a.icon || '🤖' }} {{ a.name }}</span>
                  </el-option>
                </el-option-group>
                <el-option-group label="审核与评估类">
                  <el-option
                    v-for="a in agentsByType.reviewer"
                    :key="a.id"
                    :label="a.name"
                    :value="a.id"
                  >
                    <span>{{ a.icon || '🤖' }} {{ a.name }}</span>
                  </el-option>
                </el-option-group>
              </el-select>
              <div class="form-tip">可多选，评估智能体的近期输出；与任务ID二选一</div>
            </el-form-item>

            <el-form-item label="评估周期">
              <el-radio-group v-model="config.period" size="default">
                <el-radio-button value="now">立即评估</el-radio-button>
                <el-radio-button value="daily">每日评估</el-radio-button>
                <el-radio-button value="weekly">每周评估</el-radio-button>
                <el-radio-button value="monthly">每月评估</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <el-form-item label="评估范围">
              <el-checkbox-group v-model="config.scope">
                <el-checkbox value="capability">能力层（30%）</el-checkbox>
                <el-checkbox value="quality">质量层（40%）</el-checkbox>
                <el-checkbox value="business">业务价值层（30%）</el-checkbox>
              </el-checkbox-group>
              <div class="form-tip">默认全部勾选，评估完整三层</div>
            </el-form-item>

            <el-form-item label="算法">
              <el-radio-group v-model="config.algorithm" size="small">
                <el-radio-button value="rule">规则评估</el-radio-button>
                <el-radio-button value="llm">LLM深度评估</el-radio-button>
                <el-radio-button value="both">两者都跑</el-radio-button>
              </el-radio-group>
              <div class="form-tip">
                规则评估快但打分相；LLM慢（ 30s/智能体）但能给出具体理由和改进建议
              </div>
            </el-form-item>

            <el-form-item label="任务ID">
              <el-input
                v-model="config.taskId"
                placeholder="输入具体任务ID（与智能体二选一；只填任务ID=横评所有执行过该任务的智能体）"
                clearable
              />
              <div class="form-tip">
                <el-icon style="vertical-align: middle; margin-right: 2px;"><InfoFilled /></el-icon>
                三种场景：①智能体+任务ID→多智能体 × 同任务横评；②仅智能体→各智能体近期输出综合评估；③仅任务ID→横评所有执行过该任务的智能体
              </div>
            </el-form-item>
          </el-form>

          <div class="action-buttons">
            <el-button
              type="primary"
              :loading="evaluating"
              :disabled="(config.agentIds.length === 0 && !config.taskId) || config.scope.length === 0"
              @click="startEvaluation"
            >
              <el-icon v-if="!evaluating"><VideoPlay /></el-icon>
              {{ evaluating ? '评估中...' : '开始评估' }}
            </el-button>
            <el-button
              v-if="config.period !== 'now'"
              type="default"
              @click="setupCron"
            >
              <el-icon><Clock /></el-icon> 设置定时评估
            </el-button>
          </div>
        </el-card>

        <!-- 评估进度 -->
        <el-card v-if="evaluating || (progress.total ?? 0) > 0" class="progress-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span><el-icon><Loading /></el-icon> 评估进度</span>
            </div>
          </template>
          <el-progress
            :percentage="progressPercentage"
            :status="progress.status"
            :stroke-width="10"
          />
          <div class="progress-text">
            正在评估: {{ progress.current || '—' }}
            <span v-if="progress.done !== undefined"> ({{ progress.done }}/{{ progress.total }})</span>
          </div>
          <div v-if="currentAgentReport" class="live-score">
            当前得分: <strong>{{ currentAgentReport.overall?.score ?? '—' }}</strong>
            <el-tag
              :type="gradeType(currentAgentReport.overall?.grade)"
              size="small"
              style="margin-left:8px"
            >
              {{ currentAgentReport.overall?.grade || '—' }}
            </el-tag>
          </div>
        </el-card>

        <!-- 快速统计 -->
        <el-card v-if="latestReports.length > 0" class="stats-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><DataLine /></el-icon> 本次评估概览</span>
            </div>
          </template>
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-value">{{ latestReports.length }}</div>
              <div class="stat-label">已评估</div>
            </div>
            <div class="stat-item">
              <div class="stat-value" :class="avgScoreClass">
                {{ avgScore }}
              </div>
              <div class="stat-label">平均分</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">
                <el-tag :type="bestGradeType" size="small">{{ bestGrade }}</el-tag>
              </div>
              <div class="stat-label">最高等级</div>
            </div>
            <div class="stat-item">
              <div class="stat-value" :style="{ color: worstScoreColor }">
                {{ worstScore }}
              </div>
              <div class="stat-label">最低分</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- ============================================================
           右侧：评估结果面板 (60%)
      ============================================================ -->
      <el-col :span="14">
        <el-card class="results-card">
          <el-tabs v-model="activeTab" class="results-tabs">
            <!-- Tab1: 最新评估 -->
            <el-tab-pane label="📈 最新评估" name="latest">
              <div v-if="currentReport" class="report-detail">
                <!-- 报告操作栏 -->
                <div class="report-actions">
                  <el-button type="primary" :icon="Download" @click="downloadCurrentReport"
                    :disabled="!currentReportMd && !currentEvalTaskId">
                    📥 下载完整报告
                  </el-button>
                  <span class="report-actions-hint">含全部智能体的综合评估文档(.md)</span>
                </div>

                <!-- 总体评分 -->
                <div class="overall-score-section">
                  <!-- 两者都跑模式：显示对比 -->
                  <template v-if="currentReport._mode === 'llm' && currentReport._ruleResult">
                    <div class="score-compare">
                      <div class="score-circle" :class="`grade-${currentReport.overall?.grade?.toLowerCase()}`">
                        <div class="score-number">{{ currentReport.overall?.score ?? '—' }}</div>
                        <div class="score-grade">
                          <el-tag :type="gradeType(currentReport.overall?.grade)" size="large">
                            {{ currentReport.overall?.grade || '—' }}
                          </el-tag>
                        </div>
                        <div class="score-label">LLM 评估</div>
                      </div>
                      <div class="score-vs">VS</div>
                      <div class="score-circle" :class="`grade-${currentReport._ruleResult.overall?.grade?.toLowerCase()}`">
                        <div class="score-number">{{ currentReport._ruleResult.overall?.score ?? '—' }}</div>
                        <div class="score-grade">
                          <el-tag :type="gradeType(currentReport._ruleResult.overall?.grade)" size="large">
                            {{ currentReport._ruleResult.overall?.grade || '—' }}
                          </el-tag>
                        </div>
                        <div class="score-label">规则评估</div>
                      </div>
                    </div>
                  </template>
                  <!-- 单一模式：只显示当前结果 -->
                  <template v-else>
                    <div class="score-circle" :class="`grade-${currentReport.overall?.grade?.toLowerCase()}`">
                      <div class="score-number">{{ currentReport.overall?.score ?? '—' }}</div>
                      <div class="score-grade">
                        <el-tag :type="gradeType(currentReport.overall?.grade)" size="large">
                          {{ currentReport.overall?.grade || '—' }}
                        </el-tag>
                      </div>
                      <div class="score-label">{{ currentReport._mode === 'llm' ? 'LLM 评估' : '规则评估' }}</div>
                    </div>
                  </template>

                  <div class="layer-scores">
                    <div
                      v-for="layer in layerSummary"
                      :key="layer.key"
                      class="layer-bar-item"
                    >
                      <div class="layer-bar-header">
                        <span class="layer-name">{{ layer.name }}</span>
                        <span class="layer-score">{{ layer.score }}分</span>
                      </div>
                      <el-progress
                        :percentage="layer.score"
                        :stroke-width="8"
                        :status="layer.status"
                        :show-text="false"
                      />
                      <div class="layer-weight">权重 {{ layer.weight }}</div>
                    </div>
                  </div>
                </div>

                <!-- 分层详情 -->
                <el-collapse v-model="expandedLayers" class="layer-collapse">
                  <el-collapse-item
                    v-for="layer in layerDetailItems"
                    :key="layer.key"
                    :title="layer.title"
                    :name="layer.key"
                  >
                    <el-table :data="layer.metrics" size="small" border stripe>
                      <el-table-column prop="name" label="指标" min-width="140" />
                      <el-table-column prop="score" label="得分" width="80" align="center">
                        <template #default="{ row }">
                          <span :style="{ color: scoreColor(row.score) }">
                            {{ row.score }}
                          </span>
                        </template>
                      </el-table-column>
                      <el-table-column label="趋势" width="80" align="center">
                        <template #default="{ row }">
                          <span v-if="getTrend(row.key)" :class="`trend-${getTrend(row.key)}`">
                            {{ trendIcon(getTrend(row.key)) }}
                            {{ getTrend(row.key) === 'up' ? '↑' : getTrend(row.key) === 'down' ? '↓' : '→' }}
                          </span>
                          <span v-else>—</span>
                        </template>
                      </el-table-column>
                      <el-table-column label="权重" width="70" align="center" prop="weight">
                        <template #default="{ row }">
                          {{ Math.round(row.weight * 100) }}%
                        </template>
                      </el-table-column>
                    </el-table>
                  </el-collapse-item>
                </el-collapse>

                <!-- 改进建议 -->
                <div v-if="currentReport.recommendations?.length > 0" class="recommendations">
                  <div class="section-title">
                    <el-icon><WarnTriangleFilled /></el-icon> 改进建议
                  </div>
                  <ul class="recommendation-list">
                    <li v-for="(rec, i) in currentReport.recommendations" :key="i">
                      {{ rec }}
                    </li>
                  </ul>
                </div>
              </div>

              <el-empty v-else description="暂无评估数据，请先发起评估" />
            </el-tab-pane>

            <!-- Tab2: 历史趋势 -->
            <el-tab-pane label="📉 历史趋势" name="trend">
              <div v-if="trendData.length > 0" class="trend-chart">
                <div class="trend-agent-select">
                  <el-select
                    v-model="trendAgentId"
                    placeholder="选择智能体"
                    style="width:200px"
                    @change="loadTrend"
                  >
                    <el-option
                      v-for="a in availableAgents"
                      :key="a.id"
                      :label="`${a.icon || '🤖'} ${a.name}`"
                      :value="a.id"
                    />
                  </el-select>
                  <el-select
                    v-model="trendMetric"
                    placeholder="选择指标"
                    style="width:160px;margin-left:8px"
                    @change="loadTrend"
                  >
                    <el-option label="综合评分" value="overall" />
                    <el-option label="能力层" value="capability" />
                    <el-option label="质量层" value="quality" />
                    <el-option label="业务价值层" value="business" />
                  </el-select>
                </div>

                <!-- SVG 简易折线图 -->
                <div class="svg-chart-container">
                  <svg :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="trend-svg">
                    <!-- 网格线 -->
                    <line
                      v-for="y in [0, 25, 50, 75, 100]"
                      :key="y"
                      :x1="padding"
                      :y1="yToPixel(y)"
                      :x2="chartWidth - padding"
                      :y2="yToPixel(y)"
                      stroke="#e4e7ed"
                      stroke-width="1"
                    />
                    <text
                      v-for="y in [0, 25, 50, 75, 100]"
                      :key="`label-${y}`"
                      :x="padding - 8"
                      :y="yToPixel(y) + 4"
                      text-anchor="end"
                      font-size="11"
                      fill="#909399"
                    >{{ y }}</text>

                    <!-- 折线 -->
                    <polyline
                      :points="linePoints"
                      fill="none"
                      stroke="#409eff"
                      stroke-width="2.5"
                      stroke-linejoin="round"
                      stroke-linecap="round"
                    />

                    <!-- 数据点 -->
                    <circle
                      v-for="(pt, i) in chartPoints"
                      :key="i"
                      :cx="pt.x"
                      :cy="pt.y"
                      r="4"
                      fill="#409eff"
                      @mouseenter="showTooltip(pt, $event)"
                      @mouseleave="hideTooltip"
                    />

                    <!-- X轴标签：数据点多时间隔显示，避免拥挤 -->
                    <text
                      v-for="(pt, i) in visibleChartPoints"
                      :key="`xlabel-${pt.index}`"
                      :x="pt.x"
                      :y="chartHeight - 4"
                      text-anchor="middle"
                      font-size="10"
                      fill="#909399"
                      transform="rotate(-30, pt.x, chartHeight - 4)"
                    >{{ pt.label }}</text>
                  </svg>

                  <!-- Tooltip -->
                  <div
                    v-if="tooltip.visible"
                    class="chart-tooltip"
                    :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
                  >
                    {{ tooltip.text }}
                  </div>
                </div>

                <div class="trend-summary" v-if="trendStats">
                  <span>趋势: {{ trendStats.trendText }}</span>
                  <span>均值: {{ trendStats.avg }}</span>
                  <span>最高: {{ trendStats.max }}</span>
                  <span>最低: {{ trendStats.min }}</span>
                </div>
              </div>
              <el-empty v-else description="暂无趋势数据" />
            </el-tab-pane>

            <!-- Tab3: 评估报告 -->
            <el-tab-pane label="📋 评估报告" name="reports">
              <div class="reports-toolbar">
                <el-select
                  v-model="reportAgentFilter"
                  placeholder="筛选智能体"
                  clearable
                  style="width:180px"
                  @change="loadReports"
                >
                  <el-option
                    v-for="a in availableAgents"
                    :key="a.id"
                    :label="`${a.icon || '🤖'} ${a.name}`"
                    :value="a.id"
                  />
                </el-select>
                <el-button size="small" @click="loadReports">
                  <el-icon><Refresh /></el-icon> 刷新
                </el-button>
              </div>

              <el-table
                v-if="reportList.length > 0"
                :data="reportList"
                size="small"
                stripe
                border
                class="report-table"
                @row-click="viewReport"
              >
                <el-table-column prop="timestamp" label="时间" min-width="160">
                  <template #default="{ row }">
                    {{ formatTime(row.timestamp) }}
                  </template>
                </el-table-column>
                <el-table-column prop="agentId" label="智能体" min-width="140">
                  <template #default="{ row }">
                    {{ agentNameMap[row.agentId] || row.agentId }}
                  </template>
                </el-table-column>
                <el-table-column prop="taskType" label="任务类型" width="130" />
                <el-table-column label="评分" width="70" align="center">
                  <template #default="{ row }">
                    <span :style="{ color: scoreColor(row.overall?.score) }">
                      <strong>{{ row.overall?.score ?? '—' }}</strong>
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="等级" width="70" align="center">
                  <template #default="{ row }">
                    <el-tag :type="gradeType(row.overall?.grade)" size="small">
                      {{ row.overall?.grade || '—' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="150" align="center">
                  <template #default="{ row }">
                    <el-button size="small" text type="primary" @click.stop="viewReport(row)">
                      查看
                    </el-button>
                    <el-button size="small" text type="success" @click.stop="downloadReport(row)">
                      下载
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>

              <el-pagination
                v-if="reportTotal > pageSize"
                :total="reportTotal"
                :page-size="pageSize"
                :current-page="currentPage"
                layout="prev, pager, next"
                @current-change="loadReports"
                style="margin-top:12px;justify-content:center"
              />

              <el-empty v-else-if="reportList.length === 0" description="暂无评估报告" />
            </el-tab-pane>
          </el-tabs>
        </el-card>

        <!-- 所有最新报告摘要列表 -->
        <el-card v-if="latestReports.length > 1" class="all-reports-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Document /></el-icon> 本次评估结果 ({{ latestReports.length }} 个智能体)</span>
            </div>
          </template>
          <el-table :data="latestReports" size="small" border stripe>
            <el-table-column prop="agentId" label="智能体" min-width="140">
              <template #default="{ row }">
                {{ agentNameMap[row.agentId] || row.agentId }}
              </template>
            </el-table-column>
            <el-table-column label="综合评分" width="90" align="center">
              <template #default="{ row }">
                <span :style="{ color: scoreColor(row.overall?.score) }">
                  <strong>{{ row.overall?.score ?? '—' }}</strong>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="等级" width="70" align="center">
              <template #default="{ row }">
                <el-tag :type="gradeType(row.overall?.grade)" size="small">
                  {{ row.overall?.grade || '—' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="评估模式" width="100" align="center">
              <template #default="{ row }">
                <el-tag v-if="row._ruleResult" type="warning" size="small">双重</el-tag>
                <el-tag v-else-if="row._mode === 'llm'" type="success" size="small">LLM</el-tag>
                <el-tag v-else type="info" size="small">规则</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="能力层" width="80" align="center">
              <template #default="{ row }">
                <span :style="{ color: scoreColor(row.layers?.capability?.score) }">
                  {{ row.layers?.capability?.score ?? '—' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="质量层" width="80" align="center">
              <template #default="{ row }">
                <span :style="{ color: scoreColor(row.layers?.quality?.score) }">
                  {{ row.layers?.quality?.score ?? '—' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="业务层" width="80" align="center">
              <template #default="{ row }">
                <span :style="{ color: scoreColor(row.layers?.business?.score) }">
                  {{ row.layers?.business?.score ?? '—' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="selectReport(row)">
                  详情
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <!-- 报告详情弹窗 -->
    <el-dialog
      v-model="reportDialogVisible"
      title="评估报告详情"
      width="720px"
      destroy-on-close
    >
      <div v-if="dialogReport">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="智能体">{{ agentNameMap[dialogReport.agentId] || dialogReport.agentId }}</el-descriptions-item>
          <el-descriptions-item label="任务类型">{{ dialogReport.taskType }}</el-descriptions-item>
          <el-descriptions-item label="评估时间">{{ formatTime(dialogReport.timestamp) }}</el-descriptions-item>
          <el-descriptions-item label="综合评分">
            <span :style="{ color: scoreColor(dialogReport.overall?.score) }">
              <strong>{{ dialogReport.overall?.score }}</strong>
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="等级">
            <el-tag :type="gradeType(dialogReport.overall?.grade)">
              {{ dialogReport.overall?.grade }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="下次评估">
            {{ dialogReport.nextEvaluationAt ? formatTime(dialogReport.nextEvaluationAt) : '—' }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider />

        <div v-for="layer in layerDetailItems" :key="`dlg-${layer.key}`" style="margin-bottom:16px">
          <h4>{{ layer.title }} (得分: {{ dialogReport.layers?.[layer.key]?.score ?? '—' }})</h4>
          <el-table :data="dialogReport.layers?.[layer.key]?.metrics || []" size="small" border>
            <el-table-column prop="name" label="指标" />
            <el-table-column prop="score" label="得分" width="80" align="center">
              <template #default="{ row }">
                <span :style="{ color: scoreColor(row.score) }">{{ row.score }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="dialogReport.recommendations?.length > 0" style="margin-top:12px">
          <h4>改进建议</h4>
          <ul>
            <li v-for="(rec, i) in dialogReport.recommendations" :key="i">{{ rec }}</li>
          </ul>
        </div>
      </div>
    </el-dialog>

    <!-- Toast / 通知（由 ElMessage 统一处理，移除无效组件引用） -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  Cpu, VideoPlay, Refresh, Clock, Loading,
  DataLine, WarnTriangleFilled, Document, Setting, Download
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

// ─── 状态 ───────────────────────────────────────────────────────
const agents = ref<any[]>([])
const agentsByType = ref<{ requirement: any[], executor: any[], reporter: any[], reviewer: any[] }>({
  requirement: [], executor: [], reporter: [], reviewer: []
})
const agentNameMap = ref<Record<string, string>>({})

const config = ref({
  agentIds: [] as string[],
  period: 'now',
  scope: ['capability', 'quality', 'business'] as string[],
  taskId: '',
  algorithm: 'rule'  // 'rule' = 规则评估(快) / 'llm' = LLM深度评估(慢但准) / 'both' = 两者都跑
})

const evaluating = ref(false)
const progress = ref<{ done?: number; total?: number; current?: string; status?: string }>({})
const latestReports = ref<any[]>([])
const currentAgentReport = ref<any>(null)
const evaluationSummary = ref<{
  totalAgents?: number; totalTasks?: number; avgOverall?: number;
  gradeDist?: Record<string, number>; evaluatedAt?: string;
} | null>(null)

const activeTab = ref('latest')
const currentReport = ref<any>(null)
const currentReportMd = ref('')      // 评估接口返回的完整报告 Markdown(用于一键下载)
const currentEvalTaskId = ref('')    // 当前评估任务ID(刷新后可据此重新下载)
const expandedLayers = ref(['capability', 'quality', 'business'])

// 趋势
const trendData = ref<any[]>([])
const trendAgentId = ref('')
const trendMetric = ref('overall')
const tooltip = ref({ visible: false, x: 0, y: 0, text: '' })

// 报告列表
const reportList = ref<any[]>([])
const reportAgentFilter = ref('')
const reportTotal = ref(0)
const currentPage = ref(1)
const pageSize = 20

// 报告弹窗
const reportDialogVisible = ref(false)
const dialogReport = ref<any>(null)

// Toast
const msg = ref({ visible: false, type: 'info' as any, text: '' })

// ─── 计算属性 ───────────────────────────────────────────────────
const availableAgents = computed(() => {
  const all = [
    ...agentsByType.value.requirement,
    ...agentsByType.value.executor,
    ...agentsByType.value.reporter,
    ...agentsByType.value.reviewer
  ]
  return all.filter((a: any) => a.id !== 'ai-evaluation-agent')
})

const progressPercentage = computed(() => {
  if (!progress.value.total || progress.value.total === 0) return 0
  return Math.round(((progress.value.done || 0) / progress.value.total) * 100)
})

const avgScore = computed(() => {
  if (latestReports.value.length === 0) return '—'
  const sum = latestReports.value.reduce((s: number, r: any) => s + (r.overall?.score || 0), 0)
  return Math.round(sum / latestReports.value.length)
})

const avgScoreClass = computed(() => {
  const s = avgScore.value
  if (s === '—') return ''
  if (s >= 90) return 'score-s'
  if (s >= 80) return 'score-a'
  if (s >= 70) return 'score-b'
  if (s >= 60) return 'score-c'
  return 'score-d'
})

const bestGrade = computed(() => {
  const grades = latestReports.value.map((r: any) => r.overall?.grade).filter(Boolean)
  const order = ['S', 'A', 'B', 'C', 'D']
  for (const g of order) {
    if (grades.includes(g)) return g
  }
  return '—'
})

const bestGradeType = computed(() => gradeType(bestGrade.value))

const worstScore = computed(() => {
  if (latestReports.value.length === 0) return '—'
  const scores = latestReports.value.map((r: any) => r.overall?.score || 0)
  return Math.min(...scores)
})

const worstScoreColor = computed(() => {
  const s = worstScore.value
  if (s === '—') return ''
  return scoreColor(s)
})

const layerSummary = computed(() => {
  if (!currentReport.value?.layers) return []
  const layers = currentReport.value.layers
  return [
    { key: 'capability', name: '能力层', score: layers.capability?.score || 0, weight: '30%', status: layerStatus(layers.capability?.score) },
    { key: 'quality', name: '质量层', score: layers.quality?.score || 0, weight: '40%', status: layerStatus(layers.quality?.score) },
    { key: 'business', name: '业务价值层', score: layers.business?.score || 0, weight: '30%', status: layerStatus(layers.business?.score) },
  ]
})

const layerDetailItems = computed(() => {
  if (!currentReport.value?.layers) return []
  const layers = currentReport.value.layers
  return [
    { key: 'capability', title: '🧠 能力层', metrics: layers.capability?.metrics || [] },
    { key: 'quality', title: '✅ 质量层', metrics: layers.quality?.metrics || [] },
    { key: 'business', title: '💼 业务价值层', metrics: layers.business?.metrics || [] },
  ]
})

const trendStats = computed(() => {
  if (trendData.value.length === 0) return null
  const scores = trendData.value.map((d: any) => d.score)
  const avg = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length)
  const max = Math.max(...scores)
  const min = Math.min(...scores)
  const first = scores[0]
  const last = scores[scores.length - 1]
  let trendText = '稳定'
  if (last > first + 5) trendText = '📈 上升'
  else if (last < first - 5) trendText = '📉 下降'
  return { avg, max, min, trendText }
})

// ─── 图表 ───────────────────────────────────────────────────────
const chartWidth = 560
const chartHeight = 220
const padding = 45

const chartPoints = computed(() => {
  if (!trendData.value || trendData.value.length === 0) return []
  const count = trendData.value.length
  const usableWidth = chartWidth - padding * 2
  const step = usableWidth / Math.max(count - 1, 1)
  return trendData.value.map((d: any, i: number) => ({
    x: padding + i * step,
    y: yToPixel(d.score),
    score: d.score,
    label: formatDateShort(d.timestamp),
    raw: d
  }))
})

const linePoints = computed(() =>
  chartPoints.value.map((pt: any) => `${pt.x},${pt.y}`).join(' ')
)

// 可见的X轴标签点（数据点多时间隔显示，避免拥挤）
const visibleChartPoints = computed(() => {
  const total = chartPoints.value.length
  if (total === 0) return []
  return chartPoints.value
    .map((pt: any, i: number) => ({ ...pt, index: i }))
    .filter((pt: any, i: number) => {
      if (total <= 8) return true
      if (total <= 16) return i % 2 === 0
      if (total <= 32) return i % 4 === 0
      return i % 6 === 0
    })
})

function yToPixel(value: number) {
  return chartHeight - padding - ((value / 100) * (chartHeight - padding * 2))
}

// ─── 方法 ───────────────────────────────────────────────────────
async function loadAgents() {
  try {
    const token = localStorage.getItem('token')
    const headers: any = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    
    const res = await fetch('/api/agents', { headers })
    if (!res.ok) {
      ElMessage.error(`加载智能体列表失败 (${res.status})`)
      return
    }
    const data = await res.json()
    const list: any[] = Array.isArray(data) ? data : (data.agents || [])
    agents.value = list

    const map: Record<string, string> = {}
    list.forEach((a: any) => { map[a.id] = a.name || a.id })

    const typeMap = { requirement: [] as any[], executor: [] as any[], reporter: [] as any[], reviewer: [] as any[] }
    list.forEach((a: any) => {
      map[a.id] = a.name || a.id
      // 需求分析类
      if (['test-requirement-analyzer'].includes(a.id)) typeMap.requirement.push(a)
      // 执行类
      else if (['test-case-generator', 'test-data-generator', 'api-executor', 'ui-e2e-executor', 'defect-analyzer', 'test-script-generator', 'test-master'].includes(a.id)) typeMap.executor.push(a)
      // 报告类
      else if (['test-reporter', 'report-generator'].includes(a.id)) typeMap.reporter.push(a)
      // 审核与评估类
      else if (['ai-quality-reviewer-1', 'ai-quality-reviewer-2', 'ai-quality-reviewer-3', 'ai-evaluation-agent'].includes(a.id)) typeMap.reviewer.push(a)
      // 其他归入执行类
      else if (a.id && !a.id.startsWith('ai-quality-reviewer')) typeMap.executor.push(a)
    })
    agentsByType.value = typeMap
    agentNameMap.value = map
  } catch (e) {
    console.error('loadAgents error', e)
  }
}

function onAgentChange() {
  // 选中的智能体变了，清空当前报告
  currentReport.value = null
  latestReports.value = []
}

async function startEvaluation() {
  // 验证：智能体和任务ID二选一
  if (config.value.agentIds.length === 0 && !config.value.taskId) {
    showMsg('请选择智能体或输入任务ID（二选一）', 'warning')
    return
  }
  if (config.value.scope.length === 0) {
    showMsg('请至少选择一项评估范围', 'warning')
    return
  }

  evaluating.value = true
  progress.value = { done: 0, total: config.value.agentIds.length || 1, current: '', status: '' }
  latestReports.value = []
  currentReport.value = null

  const token = localStorage.getItem('token')
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  try {
    const algo = config.value.algorithm

    // ── LLM 深度评估分支（统—接口 /api/evaluation/llm）──────
    if (algo === 'llm' || algo === 'both') {
      const llmBody: any = {}
      if (config.value.taskId) llmBody.taskId = config.value.taskId
      if (config.value.agentIds.length > 0) llmBody.agentIds = config.value.agentIds
      // 场景一:只填任务ID→后端自动推所有执行过该任务的智能体

      showMsg(algo === 'both' ? '启动 LLM 深度评估...' : '启动 LLM 深度评估(可能需 30s+/智能体)', 'info')

      const llmRes = await fetch('/api/evaluation/llm', {
        method: 'POST',
        headers,
        body: JSON.stringify(llmBody)
      })
      if (!llmRes.ok) {
        const err = await llmRes.json().catch(() => ({ message: '请求失败' }))
        throw new Error(err.message || `HTTP ${llmRes.status}`)
      }
      const llmResult = await llmRes.json()
      // 统一格式: { data: { mode, total, done, results: [{agentId,taskId,status,result}], reportMd } }
      if (llmResult.data?.reportMd) {
        currentReportMd.value = llmResult.data.reportMd
        currentEvalTaskId.value = ''
      }
      const llmReports = (llmResult.data?.results || []).filter((r: any) => r.status === 'done' && r.result)
        .map((r: any) => ({
          ...r.result,
          _agentId: r.agentId,
          _taskId: r.taskId,
          _mode: 'llm',
        }))

      if (algo === 'both') {
        // 两者都跑:LLM 结果合併进 latestReports,并设主报告为第一个
        if (llmReports.length > 0) {
          latestReports.value = llmReports
          currentReport.value = llmReports[0]
          currentAgentReport.value = llmReports[0]
        }
      } else {
        // 仅 LLM
        latestReports.value = llmReports
        if (llmReports.length > 0) {
          currentReport.value = llmReports[0]
          currentAgentReport.value = llmReports[0]
        }
      }

      if (algo === 'llm') {
        progress.value.status = 'success'
        showMsg(`LLM 评估完成: ${llmReports.length} 份报告`, 'success')
        evaluating.value = false
        return
      }
      // both 模式继续跑规则评估
    }

    // ── 规则评估分支（/api/evaluation/run）─────────────────
    const body: any = {
      scope: config.value.scope
    }
    if (config.value.taskId) {
      body.taskId = config.value.taskId
    } else {
      body.agentIds = config.value.agentIds
    }

    const res = await fetch('/api/evaluation/run', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '请求失败' }))
      throw new Error(err.message || `HTTP ${res.status}`)
    }

    const result = await res.json()
    currentReportMd.value = result.reportMd || ''
    currentEvalTaskId.value = result.evalTaskId || ''
    const reports = result.data?.agentReports || result.reports || (result.report ? [result.report] : [])
    const summary = result.data?.summary || result.summary || null
    // 给规则评估结果添加 _mode 标记
    const ruleReports = reports.map((r: any) => ({ ...r, _mode: 'rule' }))
    const merged = algo === 'both' ? [...latestReports.value] : []
    if (Array.isArray(ruleReports) && ruleReports.length > 0) {
      for (const r of ruleReports) {
        // both 模式下，如果已有 LLM 结果，合并到同一智能体下
        const existingIdx = merged.findIndex(m => m._agentId === r.agentId)
        if (existingIdx >= 0) {
          // 已有 LLM 结果，添加规则评估结果
          merged[existingIdx]._ruleResult = r
        } else {
          merged.push(r)
        }
      }
      latestReports.value = merged
      currentReport.value = merged[0]
      currentAgentReport.value = merged[0]
      if (summary) evaluationSummary.value = summary
    } else if (result.report) {
      const ruleReport = { ...result.report, _mode: 'rule' }
      merged.push(ruleReport)
      latestReports.value = merged
      currentReport.value = merged[0]
      currentAgentReport.value = merged[0]
    }

    progress.value.status = 'success'
    showMsg(algo === 'both' ? '规则 + LLM 双重评估完成！' : '规则评估完成！', 'success')
  } catch (e: any) {
    progress.value.status = 'exception'
    showMsg(`评估失败: ${e.message}`, 'error')
  } finally {
    evaluating.value = false
  }
}

async function setupCron() {
  showMsg('定时评估设置功能开发中（将调用 cron skill）', 'info')
}

function selectReport(report: any) {
  dialogReport.value = report
  reportDialogVisible.value = true
}

// 趋势
async function loadTrend() {
  if (!trendAgentId.value) return
  try {
    const token = localStorage.getItem('token')
    const headers: any = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`/api/evaluation/trend?agentId=${trendAgentId.value}&metric=${trendMetric.value}`, { headers })
    if (!res.ok) { ElMessage.error(`加载趋势数据失败 (${res.status})`); return }
    const json = await res.json()
    // 后端返回 { success, data: [...] }，需取出内层 data 数组
    trendData.value = (json.data && Array.isArray(json.data)) ? json.data : []
  } catch (e) {
    console.error('loadTrend error', e)
  }
}

// 报告列表
async function loadReports() {
  const params = new URLSearchParams()
  if (reportAgentFilter.value) params.set('agentId', reportAgentFilter.value)
  params.set('limit', String(pageSize))
  if (currentPage.value > 1) params.set('offset', String((currentPage.value - 1) * pageSize))

  try {
    const token = localStorage.getItem('token')
    const headers: any = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`/api/evaluation/reports?${params}`, { headers })
    if (!res.ok) { ElMessage.error(`加载报告列表失败 (${res.status})`); return }
    const json = await res.json()
    // 后端返回 { success, data: [...] }，需取出内层 data 数组
    const arr = (json.data && Array.isArray(json.data)) ? json.data : (Array.isArray(json) ? json : [])
    reportList.value = arr
    reportTotal.value = json.total || arr.length
  } catch (e) {
    console.error('loadReports error', e)
  }
}

// V3: 下载评估报告（Markdown）
async function downloadReport(row: any) {
  try {
    const token = localStorage.getItem('token')
    const url = `/api/evaluation/report/${encodeURIComponent(row.agentId)}/${encodeURIComponent(row.timestamp)}/export`
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const safeId = (row.agentId || 'agent').replace(/[^a-z0-9]/gi, '-')
    const safeTs = (row.timestamp || '').replace(/[^0-9]/g, '').slice(0, 14) || Date.now()
    a.download = `evaluation-${safeId}-${safeTs}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
    showMsg('报告下载成功', 'success')
  } catch (e: any) {
    showMsg(`下载失败: ${e.message}`, 'error')
  }
}

/** 下载主视图当前评估的完整报告(优先用接口返回的 Markdown,刷新后回退到按任务ID下载) */
async function downloadCurrentReport() {
  try {
    const token = localStorage.getItem('token')
    let md = currentReportMd.value || ''
    // 内存中无报告(如刷新后)→ 按 evalTaskId 从后端拉取
    if (!md && currentEvalTaskId.value) {
      const res = await fetch(`/api/evaluation/download/${encodeURIComponent(currentEvalTaskId.value)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      md = await res.text()
    }
    if (!md || md.length < 50) throw new Error('报告内容为空')
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeTs = new Date().toISOString().slice(0, 10)
    const safeId = (currentEvalTaskId.value || 'report').slice(0, 8)
    a.href = url
    a.download = `evaluation-report-${safeId}-${safeTs}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showMsg('报告下载成功', 'success')
  } catch (e: any) {
    showMsg(`下载失败: ${e.message}`, 'error')
  }
}

async function viewReport(row: any) {
  // 从 API 获取完整报告
  try {
    const token = localStorage.getItem('token')
    const headers: any = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`/api/evaluation/report/${row.agentId}/${encodeURIComponent(row.timestamp)}`, { headers })
    if (!res.ok) { ElMessage.error(`加载报告详情失败 (${res.status})`); return }
    const data = await res.json()
    if (data.success && data.data) {
      dialogReport.value = data.data
    } else {
      // 回退到列表数据
      const found = latestReports.value.find((r: any) => r.timestamp === row.timestamp && r.agentId === row.agentId)
      dialogReport.value = found || row
    }
  } catch (e) {
    const found = latestReports.value.find((r: any) => r.timestamp === row.timestamp && r.agentId === row.agentId)
    dialogReport.value = found || row
  }
  reportDialogVisible.value = true
}

// 工具函数
function gradeType(grade: string | undefined) {
  const map: Record<string, string> = {
    S: 'warning', A: 'success', B: 'primary', C: 'warning', D: 'danger'
  }
  return map[grade || ''] || 'info'
}

function scoreColor(score: number | undefined) {
  if (score === undefined || score === null) return '#909399'
  if (score >= 90) return '#FFD700'
  if (score >= 80) return '#67C23A'
  if (score >= 70) return '#409EFF'
  if (score >= 60) return '#E6A23C'
  return '#F56C6C'
}

function layerStatus(score: number | undefined) {
  if (score === undefined) return undefined
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'exception'
}

function getTrend(key: string) {
  if (!currentReport.value?.trends) return null
  const trend = currentReport.value.trends.find((t: any) => t.metric === key || t.metric.includes(key))
  return trend?.trend || null
}

function trendIcon(trend: string | null) {
  if (trend === 'up') return '📈'
  if (trend === 'down') return '📉'
  return '➡️'
}

function formatTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function formatDateShort(iso: string) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return iso.slice(5, 10)
  }
}

function showMsg(text: string, type: any = 'info') {
  ElMessage({ message: text, type })
}

function showTooltip(pt: any, event: MouseEvent) {
  tooltip.value = {
    visible: true,
    x: event.offsetX + 10,
    y: event.offsetY - 30,
    text: `${pt.label}: ${pt.score}分`
  }
}

function hideTooltip() {
  tooltip.value.visible = false
}

// ─── SSE ────────────────────────────────────────────────────────
let eventSource: EventSource | null = null

function connectSSE() {
  const token = localStorage.getItem('token')
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token || '')}`)
  eventSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      // sseBroadcast 格式: { type, data: {...} }
      const evType = msg.type
      const payload = msg.data || msg
      if (evType === 'evaluation_started') {
        progress.value.current = payload.agentId || '评估中'
      } else if (evType === 'evaluation_progress') {
        progress.value.done   = payload.done
        progress.value.total  = payload.total
        progress.value.current = payload.message || payload.agentId || ''
      } else if (evType === 'evaluation_completed') {
        evaluating.value = false
        progress.value.status = 'success'
        showMsg('评估完成', 'success')
      } else if (evType === 'evaluation_failed') {
        evaluating.value = false
        progress.value.status = 'exception'
        showMsg(`评估失败: ${payload.error || payload.message || '未知错误'}`, 'error')
      }
    } catch { /* ignore */ }
  }
  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
  }
}

// ─── 生命周期 ───────────────────────────────────────────────────
onMounted(async () => {
  await loadAgents()
  connectSSE()
  // 默认选中全部可用智能体
  config.value.agentIds = availableAgents.value.map((a: any) => a.id)
  // V3: 打开页面自动加载趋势与报告列表（之前需手动交互才加载，导致三区域常为空）
  if (!trendAgentId.value && availableAgents.value.length > 0) {
    trendAgentId.value = availableAgents.value[0].id
  }
  if (trendAgentId.value) await loadTrend()
  await loadReports()
})

onUnmounted(() => {
  eventSource?.close()
})
</script>

<style scoped>
.evaluation-view {
  padding: 20px;
  min-height: 100vh;
  background: #f5f7fa;
}

/* 主视图报告操作栏 */
.report-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 8px;
}
.report-actions-hint {
  font-size: 12px;
  color: #909399;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.view-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: #303133;
}

.view-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.config-card,
.results-card,
.progress-card,
.stats-card,
.all-reports-card {
  margin-bottom: 16px;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}

.action-buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.progress-text {
  margin-top: 8px;
  font-size: 13px;
  color: #606266;
  text-align: center;
}

.live-score {
  margin-top: 6px;
  font-size: 13px;
  color: #606266;
  text-align: center;
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-item {
  text-align: center;
  padding: 8px 4px;
  border-radius: 6px;
  background: #f5f7fa;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
}

.stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.score-s { color: #FFD700; }
.score-a { color: #67C23A; }
.score-b { color: #409EFF; }
.score-c { color: #E6A23C; }
.score-d { color: #F56C6C; }

/* 报告详情 */
.overall-score-section {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 20px;
}

.score-circle {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 4px solid currentColor;
  flex-shrink: 0;
}

.score-circle.grade-s { color: #FFD700; background: #fffbe6; }
.score-circle.grade-a { color: #67C23A; background: #f0f9eb; }
.score-circle.grade-b { color: #409EFF; background: #ecf5ff; }
.score-circle.grade-c { color: #E6A23C; background: #fdf6ec; }
.score-circle.grade-d { color: #F56C6C; background: #fef0f0; }

.score-number {
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
  color: inherit;
}

.score-grade {
  margin-top: 4px;
}

.score-label {
  font-size: 11px;
  color: #909399;
  margin-top: 4px;
}

/* 两者都跑对比样式 */
.score-compare {
  display: flex;
  align-items: center;
  gap: 16px;
}

.score-vs {
  font-size: 14px;
  font-weight: 600;
  color: #909399;
  padding: 4px 12px;
  background: #f5f7fa;
  border-radius: 12px;
}

.layer-scores {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.layer-bar-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.layer-bar-header {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.layer-name {
  color: #606266;
}

.layer-score {
  color: #303133;
  font-weight: 600;
}

.layer-weight {
  font-size: 11px;
  color: #c0c4cc;
}

/* Collapse */
.layer-collapse {
  margin-bottom: 16px;
}

/* 建议 */
.recommendations {
  margin-top: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.recommendation-list {
  margin: 0;
  padding-left: 20px;
  color: #606266;
  font-size: 13px;
  line-height: 1.8;
}

/* 趋势图 */
.trend-chart {
  padding: 8px 0;
}

.trend-agent-select {
  display: flex;
  margin-bottom: 16px;
}

.svg-chart-container {
  position: relative;
}

.trend-svg {
  width: 100%;
  height: auto;
  background: #fafafa;
  border-radius: 8px;
  border: 1px solid #ebeef5;
}

.chart-tooltip {
  position: absolute;
  background: rgba(48, 49, 51, 0.9);
  color: #fff;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 10;
}

.trend-summary {
  display: flex;
  gap: 24px;
  font-size: 13px;
  color: #606266;
  margin-top: 12px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}

.trend-up { color: #67C23A; }
.trend-down { color: #F56C6C; }
.trend-stable { color: #909399; }

/* 报告列表 */
.reports-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.report-table {
  cursor: pointer;
}
</style>
