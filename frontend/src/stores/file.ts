// 本地文件浏览状态管理

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fsApi, knowledgeApi } from '@/api'

export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedTime: string
  extension: string
}

export const useFileStore = defineStore('file', () => {
  // 状态
  const currentPath = ref('')
  const files = ref<FileItem[]>([])
  const selectedFiles = ref<string[]>([])
  const isLoading = ref(false)
  const history = ref<string[]>([])

  // 根目录：由后端 /api/fs/browse 返回的 HOME 决定，不在前端硬编码开发机路径
  const rootPath = ref('')

  // 计算属性
  const currentDir = computed(() => {
    return currentPath.value || rootPath.value
  })

  const hasParent = computed(() => {
    return currentPath.value.length > rootPath.value.length
  })

  // 初始化
  async function init() {
    // 先向后端要默认目录（服务端 HOME），避免泄漏/写死某台机器的用户名
    try {
      const root = await fsApi.browse()
      if (root?.path) rootPath.value = root.path
    } catch { /* 后端不可用时保持空根目录，由调用方提示 */ }
    currentPath.value = rootPath.value
    await loadDirectory(currentPath.value)
  }

  // 加载目录内容
  async function loadDirectory(path: string) {
    isLoading.value = true

    try {
      const data = await fsApi.browse(path)
      if (data) {
        const items = data.items || []
        files.value = items.map((item: any) => ({
          name: item.name,
          path: item.path,
          isDirectory: item.type === 'folder',
          size: item.size || 0,
          modifiedTime: item.modified || new Date().toISOString(),
          extension: item.name.includes('.') ? item.name.split('.').pop() : ''
        }))
        currentPath.value = path

        if (history.value[history.value.length - 1] !== path) {
          history.value.push(path)
        }
      } else {
        files.value = []
      }
    } catch (error) {
      console.error('加载目录失败:', error)
      files.value = []
    } finally {
      isLoading.value = false
    }
  }
  async function enterDirectory(path: string) {
    await loadDirectory(path)
  }

  // 返回上级目录（此前只计算了父路径却没有真正跳转，功能是坏的）
  async function goBack() {
    if (!hasParent.value) return
    const idx = currentPath.value.lastIndexOf('/')
    const parentPath = idx > 0 ? currentPath.value.slice(0, idx) : rootPath.value
    await loadDirectory(parentPath || rootPath.value)
  }

  // 返回历史
  async function goHistory(index: number) {
    if (index >= 0 && index < history.value.length) {
      const targetPath = history.value[index]
      if (targetPath) {
        await loadDirectory(targetPath)
      }
    }
  }

  // 刷新当前目录
  async function refresh() {
    await loadDirectory(currentPath.value)
  }

  // 选择文件
  function toggleSelect(path: string) {
    const index = selectedFiles.value.indexOf(path)
    if (index === -1) {
      selectedFiles.value.push(path)
    } else {
      selectedFiles.value.splice(index, 1)
    }
  }

  // 全选
  function selectAll() {
    selectedFiles.value = files.value.map(f => f.path)
  }

  // 取消全选
  function clearSelection() {
    selectedFiles.value = []
  }

  // 上传到知识库：文件已在服务端，直接走 /api/kb/import（此前伪造 File 对象必然失败）
  async function uploadToKnowledge(paths: string[]): Promise<boolean> {
    try {
      if (!paths.length) return false
      const result = await knowledgeApi.importFromPaths(paths, 'general')
      if (!result) return false
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        console.warn('[FileStore] 部分文件导入失败:', result.errors)
      }
      return result.imported > 0
    } catch {
      return false
    }
  }

  // 格式化文件大小
  function formatSize(bytes: number): string {
    if (bytes === 0) return '-'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // 获取文件图标
  function getFileIcon(file: FileItem): string {
    if (file.isDirectory) return 'Folder'
    const extIconMap: Record<string, string> = {
      md: 'Document',
      txt: 'Document',
      pdf: 'Document',
      docx: 'Document',
      xlsx: 'Document',
      json: 'Document',
      csv: 'Document',
      png: 'Picture',
      jpg: 'Picture',
      jpeg: 'Picture',
      gif: 'Picture',
      zip: 'FolderOpened',
      tar: 'FolderOpened'
    }
    return extIconMap[file.extension] || 'Document'
  }

  // 🔒 重置 file store 状态（用户隔离用）
  function reset() {
    currentPath.value = '/'
    files.value = []
    selectedFiles.value = []
    isLoading.value = false
    history.value = []
    rootPath.value = ''
  }

  return {
    // 状态
    currentPath,
    files,
    selectedFiles,
    isLoading,
    history,
    rootPath,

    // 计算属性
    currentDir,
    hasParent,

    // 方法
    init,
    loadDirectory,
    enterDirectory,
    goBack,
    goHistory,
    refresh,
    toggleSelect,
    selectAll,
    clearSelection,
    uploadToKnowledge,
    formatSize,
    getFileIcon,
    reset
  }
})
