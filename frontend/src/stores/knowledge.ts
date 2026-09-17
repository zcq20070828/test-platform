// 知识库状态管理

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { KnowledgeDoc } from '@/types'
import { knowledgeApi } from '@/api'

export const useKnowledgeStore = defineStore('knowledge', () => {
  // 状态
  const documents = ref<KnowledgeDoc[]>([])
  const currentKbType = ref<string>('all')
  const searchQuery = ref('')
  const searchResults = ref<KnowledgeDoc[]>([])
  const isLoading = ref(false)
  const uploadProgress = ref(0)

  // “学习知识”任务状态（由后端逐智能体学习，SSE 推送进度）
  const learnState = ref<{
    active: boolean
    jobId: string | null
    done: number
    total: number
    current: string
    agentId: string
    status: string
    error: string | null
    lastLearnedAt: string | null
  }>({
    active: false,
    jobId: null,
    done: 0,
    total: 0,
    current: '',
    agentId: '',
    status: '',
    error: null,
    lastLearnedAt: null
  })

  // 知识库类型
  const kbTypes = [
    { value: 'all', label: '全部', icon: 'Folder' },
    { value: 'general', label: '通用测试', icon: 'Document' },
    { value: 'project-test', label: '项目测试', icon: 'Files' },
    { value: 'project-biz', label: '项目业务', icon: 'Briefcase' }
  ]

  // 计算属性：按类型过滤
  const filteredDocuments = computed(() => {
    if (currentKbType.value === 'all') {
      return documents.value
    }
    return documents.value.filter(doc => doc.kbType === currentKbType.value)
  })

  // 计算属性：统计
  const stats = computed(() => ({
    total: documents.value.length,
    general: documents.value.filter(d => d.kbType === 'general').length,
    projectTest: documents.value.filter(d => d.kbType === 'project-test').length,
    projectBiz: documents.value.filter(d => d.kbType === 'project-biz').length,
    vectorized: documents.value.filter(d => d.vectorized).length
  }))

  // 加载文档列表
  async function loadDocuments(kbType?: string) {
    isLoading.value = true
    try {
      documents.value = await knowledgeApi.getDocs(kbType)
    } catch (error) {
      console.error('加载知识库失败:', error)
    } finally {
      isLoading.value = false
    }
  }

  // 语义搜索
  // 语义搜索 / 关键词搜索
  async function search(query: string, kbType?: string, mode: 'semantic' | 'keyword' = 'semantic') {
    if (!query.trim()) {
      searchResults.value = []
      return
    }

    isLoading.value = true
    try {
      searchResults.value = await knowledgeApi.search(query, kbType, mode)
    } catch (error) {
      console.error('搜索失败:', error)
      searchResults.value = []
    } finally {
      isLoading.value = false
    }
  }

  // 向量化文档
  async function vectorizeDocument(docPath: string) {
    const success = await knowledgeApi.vectorize(docPath)
    if (success) {
      // 更新文档状态
      const doc = documents.value.find(d => d.path === docPath)
      if (doc) {
        doc.vectorized = true
      }
    }
    return success
  }

  // 设置当前知识库类型
  function setKbType(type: string) {
    currentKbType.value = type
  }

  // 清空搜索
  function clearSearch() {
    searchQuery.value = ''
    searchResults.value = []
  }

  // ========== “学习知识”相关 ==========
  // 触发后端逐智能体学习当前用户可见的知识库文档
  async function startLearn() {
    const r = await knowledgeApi.learn()
    if (r && r.jobId) {
      learnState.value = {
        active: true,
        jobId: r.jobId,
        done: 0,
        total: 0,
        current: '',
        agentId: '',
        status: 'pending',
        error: null,
        lastLearnedAt: null
      }
      return r.jobId
    }
    return null
  }

  // SSE 进度回调：更新学习进度
  function updateLearnProgress(d: any) {
    if (learnState.value.jobId && learnState.value.jobId === d.jobId) {
      learnState.value.done = d.done
      learnState.value.total = d.total
      learnState.value.current = d.current || ''
      learnState.value.agentId = d.agentId || ''
      learnState.value.status = d.status || 'running'
    }
  }

  // SSE 完成回调
  function finishLearn(d: any) {
    if (learnState.value.jobId && learnState.value.jobId === d.jobId) {
      learnState.value.active = false
      learnState.value.status = d.status || 'done'
      learnState.value.total = d.total || learnState.value.total
      learnState.value.error = d.error || null

      learnState.value.lastLearnedAt = new Date().toISOString()
    }
  }

  function resetLearnState() {
    learnState.value = {
      active: false,
      jobId: null,
      done: 0,
      total: 0,
      current: '',
      agentId: '',
      status: '',
      error: null,
      lastLearnedAt: null
    }
  }

  // 🔒 重置知识库 store 所有状态（用户隔离用）
  function reset() {
    documents.value = []
    currentKbType.value = 'all'
    searchQuery.value = ''
    searchResults.value = []
    isLoading.value = false
    uploadProgress.value = 0
    resetLearnState()
  }

  return {
    // 状态
    documents,
    currentKbType,
    searchQuery,
    searchResults,
    isLoading,
    uploadProgress,
    kbTypes,

    // 计算属性
    filteredDocuments,
    stats,

    // 方法
    loadDocuments,
    search,
    vectorizeDocument,
    setKbType,
    clearSearch,
    learnState,
    startLearn,
    updateLearnProgress,
    finishLearn,
    resetLearnState,
    reset
  }
})
