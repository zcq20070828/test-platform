<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useKnowledgeStore } from '@/stores/knowledge'
import { ElMessage } from 'element-plus'
import type { KnowledgeDoc } from '@/types'

const emit = defineEmits<{
  (e: 'view-document', doc: KnowledgeDoc): void
}>()

const store = useKnowledgeStore()

// 搜索模式
const searchMode = ref<'keyword' | 'semantic'>('semantic')

// 搜索历史
const searchHistory = ref<string[]>([])
const MAX_HISTORY = 10

// 高级筛选
const showAdvanced = ref(false)
const filters = ref({
  type: '' as '' | 'general' | 'project-test' | 'project-biz',
  dateRange: [] as string[],
  minSize: null as number | null,
  maxSize: null as number | null,
  vectorized: null as boolean | null
})

// 搜索输入
const searchInput = ref('')
const showHistory = ref(false)

// 搜索建议（从历史中匹配）
const suggestions = computed(() => {
  if (!searchInput.value) return []
  const kw = searchInput.value.toLowerCase()
  return searchHistory.value.filter(h => h.toLowerCase().includes(kw)).slice(0, 5)
})

// 执行搜索
async function handleSearch() {
  const query = searchInput.value.trim()
  if (!query) {
    ElMessage.warning('请输入搜索关键词')
    return
  }

  // 保存搜索历史
  if (!searchHistory.value.includes(query)) {
    searchHistory.value.unshift(query)
    if (searchHistory.value.length > MAX_HISTORY) {
      searchHistory.value.pop()
    }
  }

  // 执行搜索
  await store.search(query, filters.value.type || undefined, searchMode.value)

  // 如果是语义搜索且有向量结果，显示相似度
  if (searchMode.value === 'semantic') {
    ElMessage.success(`找到 ${store.searchResults.length} 条相关结果`)
  }
}

// 选择建议
function selectSuggestion(suggestion: string) {
  searchInput.value = suggestion
  handleSearch()
}

// 清除历史
function clearHistory() {
  searchHistory.value = []
  ElMessage.success('搜索历史已清除')
}

// 切换搜索模式
watch(searchMode, () => {
  store.clearSearch()
})

// 重置筛选
function resetFilters() {
  filters.value = {
    type: '',
    dateRange: [],
    minSize: null,
    maxSize: null,
    vectorized: null
  }
}

// 查看文档
function viewDocument(doc: KnowledgeDoc) {
  emit('view-document', doc)
}

// 获取相似度颜色
function getScoreColor(score: number): string {
  if (score >= 0.8) return 'success'
  if (score >= 0.5) return 'warning'
  return 'info'
}

// 格式化相似度
function formatScore(score: number): string {
  return (score * 100).toFixed(0) + '%'
}

// 高亮关键词
function highlightText(text: string, keyword: string): string {
  if (!keyword) return text
  const regex = new RegExp(`(${keyword})`, 'gi')
  return text.replace(regex, '<mark>$1</mark>')
}
</script>

<template>
  <div class="semantic-search">
    <!-- 搜索区域 -->
    <div class="search-box">
      <div class="search-main">
        <el-input
          v-model="searchInput"
          :placeholder="searchMode === 'semantic' ? '输入自然语言描述，如：如何进行性能测试？' : '输入关键词搜索...'"
          size="large"
          clearable
          @keyup.enter="handleSearch"
          @focus="showHistory = true"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
          <template #append>
            <el-button type="primary" @click="handleSearch">搜索</el-button>
          </template>
        </el-input>
      </div>

      <!-- 搜索模式切换 -->
      <div class="search-mode">
        <el-radio-group v-model="searchMode" size="small">
          <el-radio-button value="semantic">语义搜索</el-radio-button>
          <el-radio-button value="keyword">关键词搜索</el-radio-button>
        </el-radio-group>
        <el-button
          :type="showAdvanced ? 'primary' : 'default'"
          size="small"
          @click="showAdvanced = !showAdvanced"
        >
          高级筛选
        </el-button>
      </div>

      <!-- 搜索建议/历史 -->
      <div v-if="suggestions.length > 0 && !searchInput" class="search-suggestions">
        <div class="suggestion-header">
          <span>搜索历史</span>
          <el-button link type="danger" size="small" @click="clearHistory">清除</el-button>
        </div>
        <div class="suggestion-list">
          <el-tag
            v-for="(item, index) in searchHistory.slice(0, 5)"
            :key="index"
            class="suggestion-tag"
            @click="selectSuggestion(item)"
          >
            {{ item }}
          </el-tag>
        </div>
      </div>
    </div>

    <!-- 高级筛选面板 -->
    <el-collapse-transition>
      <div v-show="showAdvanced" class="advanced-filters">
        <el-form :model="filters" label-width="80px" inline>
          <el-form-item label="知识库">
            <el-select v-model="filters.type" placeholder="全部" clearable style="width: 140px">
              <el-option label="通用测试" value="general" />
              <el-option label="项目测试" value="project-test" />
              <el-option label="项目业务" value="project-biz" />
            </el-select>
          </el-form-item>
          <el-form-item label="向量化">
            <el-select v-model="filters.vectorized" placeholder="全部" clearable style="width: 120px">
              <el-option label="已向量化" :value="true" />
              <el-option label="未向量化" :value="false" />
            </el-select>
          </el-form-item>
          <el-form-item label="最小大小">
            <el-input-number v-model="filters.minSize" :min="0" placeholder="KB" style="width: 120px" />
          </el-form-item>
          <el-form-item label="最大大小">
            <el-input-number v-model="filters.maxSize" :min="0" placeholder="KB" style="width: 120px" />
          </el-form-item>
          <el-form-item>
            <el-button @click="resetFilters">重置</el-button>
          </el-form-item>
        </el-form>
      </div>
    </el-collapse-transition>

    <!-- 搜索结果 -->
    <div v-if="store.searchResults.length > 0" class="search-results">
      <div class="results-header">
        <span class="results-count">找到 {{ store.searchResults.length }} 条结果</span>
        <el-button size="small" @click="store.clearSearch">清除结果</el-button>
      </div>

      <div class="results-list">
        <div
          v-for="(result, index) in store.searchResults"
          :key="index"
          class="result-item"
        >
          <div class="result-header">
            <div class="result-title">
              <el-icon><Document /></el-icon>
              <span>{{ result.name }}</span>
              <el-tag size="small" type="info">{{ result.kbType }}</el-tag>
            </div>
            <!-- 相似度评分（仅语义搜索显示） -->
            <el-tag
              v-if="searchMode === 'semantic' && result.score !== undefined"
              :type="getScoreColor(result.score)"
              effect="dark"
              size="small"
            >
              相似度: {{ formatScore(result.score) }}
            </el-tag>
          </div>

          <p class="result-preview">
            <span v-html="highlightText(result.content?.slice(0, 200) || '', searchInput)"></span>...
          </p>

          <div class="result-actions">
            <el-button link type="primary" @click="viewDocument(result)">查看详情</el-button>
            <el-tag v-if="result.vectorized" type="success" size="small">已向量化</el-tag>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <el-empty
      v-else-if="searchInput && !store.isLoading"
      description="未找到相关文档，请尝试其他关键词"
    />
  </div>
</template>

<style scoped>
.semantic-search {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.search-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-main {
  width: 100%;
}

.search-mode {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.search-suggestions {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.suggestion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.suggestion-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.suggestion-tag {
  cursor: pointer;
}

.suggestion-tag:hover {
  opacity: 0.8;
}

.advanced-filters {
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.results-count {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.result-item {
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  transition: all 0.2s;
}

.result-item:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-fill-color-lighter);
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}

.result-preview {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  margin: 0 0 8px 0;
}

.result-preview :deep(mark) {
  background: var(--el-color-warning-light-5);
  padding: 0 2px;
  border-radius: 2px;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
