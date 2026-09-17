<script setup lang="ts">
import { ref } from 'vue'
import { InfoFilled, ArrowRight } from '@element-plus/icons-vue'
import type { Agent } from '@/types'
import { agentApi } from '@/api'

defineProps<{
  agent: Agent
}>()

const emit = defineEmits<{
  click: []
}>()

const KB_LABELS: Record<string, string> = {
  general: '通用',
  'project-test': '测试项目',
  'project-biz': '业务项目'
}

const KB_COLORS: Record<string, string> = {
  general: '',
  'project-test': 'success',
  'project-biz': 'warning'
}

function kbLabel(kb: string): string {
  return KB_LABELS[kb] || kb
}

function kbTypeColor(kb: string): string {
  return KB_COLORS[kb] || 'info'
}

// 简介详情：拉取单个 Agent 详情（含 skills / soulIntro）
const detail = ref<Agent | null>(null)
const detailLoading = ref(false)
const detailLoaded = ref(false)

async function fetchDetail(agentId: string) {
  if (detailLoading.value || detailLoaded.value) return
  detailLoading.value = true
  try {
    const data = await agentApi.getById(agentId)
    if (data) {
      detail.value = data
      detailLoaded.value = true
    }
  } catch (e) {
    console.warn('[AgentCard] 加载详情失败', e)
  } finally {
    detailLoading.value = false
  }
}

// 简介弹层显示控制
const popoverVisible = ref(false)

async function onPopoverShow(agentId: string) {
  popoverVisible.value = true
  if (!detailLoaded.value) {
    await fetchDetail(agentId)
  }
}

function onPopoverHide() {
  popoverVisible.value = false
}

// 详情数据（优先用 detail，否则用 prop）
const intro = () => detail.value?.description || detail.value?.soulIntro || ''
const skills = () => detail.value?.skills || []
const capabilities = () => detail.value?.capabilities || []
</script>

<template>
  <el-card class="agent-card" shadow="hover" @click="emit('click')">
    <div class="agent-header">
      <span class="agent-icon">{{ agent.icon }}</span>
      <span class="agent-name">{{ agent.name }}</span>
    </div>
    <div class="agent-desc">{{ agent.desc }}</div>
    <div class="agent-capabilities">
      <el-tag
        v-for="(cap, index) in agent.capabilities?.slice(0, 3)"
        :key="index"
        size="small"
        type="info"
      >
        {{ cap }}
      </el-tag>
      <el-tag v-if="agent.capabilities?.length > 3" size="small" type="info">
        +{{ agent.capabilities.length - 3 }}
      </el-tag>
    </div>

    <!-- 简介 hint 区域 -->
    <div class="agent-intro-hint">
      <el-popover
        placement="bottom-start"
        :width="380"
        trigger="hover"
        :show-after="200"
        :hide-after="100"
        popper-class="agent-intro-popover"
        @show="onPopoverShow(agent.id)"
        @hide="onPopoverHide"
      >
        <template #reference>
          <div class="intro-hint-row">
            <el-icon class="intro-icon"><InfoFilled /></el-icon>
            <span class="intro-label">简介</span>
            <el-icon class="arrow-icon"><ArrowRight /></el-icon>
          </div>
        </template>

        <div class="intro-popover-content" v-loading="detailLoading && !detailLoaded">
          <!-- 标题区 -->
          <div class="intro-header">
            <span class="intro-emoji">{{ agent.icon }}</span>
            <div class="intro-title">
              <div class="intro-name">{{ agent.name }}</div>
              <div class="intro-id">{{ agent.id }}</div>
            </div>
          </div>

          <!-- 简介文字 -->
          <div v-if="intro()" class="intro-section">
            <div class="intro-section-title">📋 简介</div>
            <div class="intro-text">{{ intro() }}</div>
          </div>

          <!-- 功能 -->
          <div v-if="capabilities().length" class="intro-section">
            <div class="intro-section-title">⚙️ 功能</div>
            <div class="intro-tags">
              <el-tag
                v-for="(cap, idx) in capabilities()"
                :key="idx"
                size="small"
                type="info"
                effect="plain"
              >{{ cap }}</el-tag>
            </div>
          </div>

          <!-- Skills -->
          <div v-if="skills().length" class="intro-section">
            <div class="intro-section-title">
              🧩 Skill
              <span class="skill-count">{{ skills().length }} 个</span>
            </div>
            <div class="intro-tags">
              <el-tag
                v-for="(sk, idx) in skills()"
                :key="idx"
                size="small"
                effect="plain"
                class="skill-tag"
              >{{ sk }}</el-tag>
            </div>
          </div>

          <!-- 知识库 -->
          <div v-if="agent.knowledgeBases?.length" class="intro-section">
            <div class="intro-section-title">📚 知识库</div>
            <div class="intro-tags">
              <el-tag
                v-for="(kb, idx) in agent.knowledgeBases"
                :key="idx"
                size="small"
                :type="kbTypeColor(kb) as any"
                effect="plain"
              >{{ kbLabel(kb) }}</el-tag>
            </div>
          </div>

          <div v-if="!detailLoaded && !detailLoading" class="intro-empty">
            暂无详细信息
          </div>
        </div>
      </el-popover>
    </div>

    <div v-if="agent.knowledgeBases?.length" class="agent-kbs">
      <span class="kb-label">📚</span>
      <el-tag
        v-for="kb in agent.knowledgeBases"
        :key="kb"
        size="small"
        :type="kbTypeColor(kb)"
      >{{ kbLabel(kb) }}</el-tag>
    </div>
  </el-card>
</template>

<style scoped>
.agent-card {
  cursor: pointer;
  transition: all 0.3s ease;
  margin-bottom: 16px;
}

.agent-card:hover {
  transform: translateY(-4px);
  border-color: var(--el-color-primary);
}

.agent-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.agent-icon {
  font-size: 24px;
}

.agent-name {
  font-size: 16px;
  font-weight: 600;
}

.agent-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.agent-capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* 简介 hint 行 */
.agent-intro-hint {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.intro-hint-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.intro-hint-row:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.intro-icon {
  font-size: 14px;
}

.intro-label {
  flex: 1;
  font-weight: 500;
}

.arrow-icon {
  font-size: 12px;
  opacity: 0.6;
  transition: transform 0.2s;
}

.intro-hint-row:hover .arrow-icon {
  transform: translateX(2px);
  opacity: 1;
}

.agent-kbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.kb-label {
  font-size: 12px;
}
</style>

<style>
/* 全局样式：弹层内容（避免 scoped 限制） */
.agent-intro-popover {
  padding: 0 !important;
}

.agent-intro-popover .el-popper__arrow {
  display: none;
}

.intro-popover-content {
  padding: 16px;
  max-height: 480px;
  overflow-y: auto;
}

.intro-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.intro-emoji {
  font-size: 28px;
}

.intro-title {
  flex: 1;
  min-width: 0;
}

.intro-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.3;
}

.intro-id {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-family: 'SF Mono', Consolas, Monaco, monospace;
  margin-top: 2px;
}

.intro-section {
  margin-bottom: 14px;
}

.intro-section:last-child {
  margin-bottom: 0;
}

.intro-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-count {
  font-size: 11px;
  font-weight: normal;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  padding: 1px 6px;
  border-radius: 8px;
}

.intro-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  word-break: break-word;
}

.intro-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.skill-tag {
  font-family: 'SF Mono', Consolas, Monaco, monospace;
  font-size: 11px !important;
}

.intro-empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  padding: 20px 0;
}
</style>
