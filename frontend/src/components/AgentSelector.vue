<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMainStore } from '@/stores/main'
import type { Agent } from '@/types'

const store = useMainStore()

// 搜索关键词
const searchKeyword = ref('')

// 过滤后的智能体
const filteredAgents = computed(() => {
  if (!searchKeyword.value) return store.agents
  const kw = searchKeyword.value.toLowerCase()
  return store.agents.filter(a =>
    a.name.toLowerCase().includes(kw) ||
    a.desc.toLowerCase().includes(kw) ||
    a.capabilities?.some(c => c.toLowerCase().includes(kw))
  )
})

// 按能力分组
const groupedAgents = computed(() => {
  const groups: Record<string, Agent[]> = {}

  filteredAgents.value.forEach(agent => {
    const category = getAgentCategory(agent)
    if (!groups[category]) groups[category] = []
    groups[category].push(agent)
  })

  return groups
})

// 分类判断
function getAgentCategory(agent: Agent): string {
  if (agent.id === 'test-master') return '主控'
  if (agent.id.includes('reviewer')) return '审核'
  if (agent.id.includes('executor') || agent.id.includes('-e2e') || agent.id.includes('api-executor')) return '执行'
  return '生成'
}

// 选择智能体
function selectAgent(agent: Agent) {
  store.setCurrentAgent(agent)
}

// 获取能力标签颜色
function getCapabilityColor(cap: string): string {
  const colors: Record<string, string> = {
    '需求分析': 'primary',
    '用例生成': 'success',
    '数据生成': 'warning',
    '测试执行': 'danger',
    '缺陷分析': 'info',
    '报告生成': '',
    'AI审核': 'warning'
  }
  return colors[cap] || ''
}

// 图标映射
function getAgentIcon(agent: Agent): string {
  if (agent.icon) return agent.icon
  const icons: Record<string, string> = {
    'test-master': '🧭',
    'test-requirement-analyzer': '📝',
    'test-scheme-generator': '📋',
    'test-case-generator': '✅',
    'test-data-generator': '📊',
    'api-executor': '🔌',
    'ui-e2e-executor': '🖥️',
    'defect-analyzer': '🐛',
    'test-reporter': '📄',
    'data-masking': '🔒',
    'ai-quality-reviewer-1': '🔍',
    'ai-quality-reviewer-2': '🛡️',
    'ai-quality-reviewer-3': '📐'
  }
  return icons[agent.id] || '🤖'
}
</script>

<template>
  <div class="agent-selector">
    <!-- 搜索框 -->
    <el-input
      v-model="searchKeyword"
      placeholder="搜索智能体..."
      clearable
      size="default"
      class="search-input"
    >
      <template #prefix>
        <el-icon><Search /></el-icon>
      </template>
    </el-input>

    <!-- 当前选中提示 -->
    <div v-if="store.currentAgent" class="current-agent">
      <span class="label">当前:</span>
      <el-tag type="primary" effect="dark" size="large">
        {{ getAgentIcon(store.currentAgent) }} {{ store.currentAgent.name }}
      </el-tag>
    </div>

    <!-- 分组卡片 -->
    <div class="agent-groups">
      <div
        v-for="(agents, category) in groupedAgents"
        :key="category"
        class="agent-group"
      >
        <h4 class="group-title">{{ category }}</h4>
        <div class="agent-cards">
          <div
            v-for="agent in agents"
            :key="agent.id"
            class="agent-card"
            :class="{ active: store.currentAgent?.id === agent.id }"
            @click="selectAgent(agent)"
          >
            <div class="card-header">
              <span class="agent-icon">{{ getAgentIcon(agent) }}</span>
              <span class="agent-name">{{ agent.name }}</span>
            </div>
            <p class="agent-desc">{{ agent.desc }}</p>
            <div v-if="agent.capabilities?.length" class="agent-capabilities">
              <el-tag
                v-for="cap in agent.capabilities.slice(0, 3)"
                :key="cap"
                :type="getCapabilityColor(cap)"
                size="small"
                effect="plain"
                class="cap-tag"
              >
                {{ cap }}
              </el-tag>
              <span v-if="agent.capabilities.length > 3" class="more">
                +{{ agent.capabilities.length - 3 }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <el-empty
      v-if="filteredAgents.length === 0"
      description="未找到匹配的智能体"
      :image-size="80"
    />
  </div>
</template>

<style scoped>
.agent-selector {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.search-input {
  width: 100%;
}

.current-agent {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.current-agent .label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.agent-groups {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.agent-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  padding-left: 4px;
  border-left: 3px solid var(--el-color-primary);
  padding-left: 10px;
}

.agent-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.agent-card {
  padding: 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.25s ease;
  background: var(--el-bg-color);
}

.agent-card:hover {
  border-color: var(--el-color-primary-light-3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.agent-card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-7);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.agent-icon {
  font-size: 24px;
  line-height: 1;
}

.agent-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.agent-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  margin: 0 0 10px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.agent-capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.cap-tag {
  font-size: 11px;
}

.more {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
  .agent-cards {
    grid-template-columns: 1fr;
  }
}
</style>
