// 上传状态管理

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { knowledgeApi, parseApi } from '@/api'

export interface UploadFile {
  id: string
  name: string
  size: number
  type: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  content?: string
  isImage?: boolean
  description?: string
}

export const useUploadStore = defineStore('upload', () => {
  // 状态
  const files = ref<UploadFile[]>([])
  const rawFiles = ref<Map<string, File>>(new Map())
  const isUploading = ref(false)
  const maxFileSize = 10 * 1024 * 1024 // 10MB

  // 支持的文件类型
  const supportedTypes = {
    document: ['.md', '.txt', '.json', '.log', '.xml', '.csv'],
    word: ['.docx', '.doc'],
    image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
  }

  // 计算属性
  const hasFiles = computed(() => files.value.length > 0)
  const uploadProgress = computed(() => {
    if (files.value.length === 0) return 0
    const total = files.value.reduce((sum, f) => sum + f.progress, 0)
    return Math.round(total / files.value.length)
  })

  // 添加文件
  function addFiles(newFiles: FileList | File[]) {
    const fileArray = Array.from(newFiles)
    for (const file of fileArray) {
      // 检查是否已存在
      if (files.value.some(f => f.name === file.name && f.size === file.size)) {
        continue
      }

      // 检查文件大小
      if (file.size > maxFileSize) {
        console.warn(`文件 ${file.name} 超过大小限制`)
        continue
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const uploadFile: UploadFile = {
        id,
        name: file.name,
        size: file.size,
        type: file.type || getFileType(file.name),
        status: 'pending',
        progress: 0,
        isImage: isImageFile(file.name)
      }

      files.value.push(uploadFile)
      rawFiles.value.set(id, file)
    }
  }

  // 移除文件
  function removeFile(fileId: string) {
    const index = files.value.findIndex(f => f.id === fileId)
    if (index !== -1) {
      files.value.splice(index, 1)
      rawFiles.value.delete(fileId)
    }
  }

  // 清空文件列表
  function clearFiles() {
    files.value = []
    rawFiles.value.clear()
  }

  // 获取文件类型
  function getFileType(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    if (supportedTypes.document.includes(`.${ext}`)) return 'document'
    if (supportedTypes.word.includes(`.${ext}`)) return 'word'
    if (supportedTypes.image.includes(`.${ext}`)) return 'image'
    return 'unknown'
  }

  // 判断是否为图片
  function isImageFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    return supportedTypes.image.includes(`.${ext}`)
  }

  // 上传单个文件
  async function uploadFile(fileId: string, kbType: string = 'general'): Promise<boolean> {
    const file = files.value.find(f => f.id === fileId)
    const rawFile = rawFiles.value.get(fileId)
    if (!file || !rawFile) return false

    file.status = 'uploading'

    try {
      // 1. 先解析文件内容（用于前端预览）
      let content = ''
      if (file.isImage || file.type.startsWith('image/')) {
        const result = await parseImage(rawFile)
        content = result.description || ''
      } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        const result = await parseWord(rawFile)
        content = result.content || ''
      } else {
        content = await readAsText(rawFile)
      }

      file.content = content
      file.progress = 50 // 解析完成50%

      // 2. 真正上传到后端知识库
      const res = await knowledgeApi.upload(rawFile, kbType)
      if (!res.success) {
        throw new Error(`上传失败: ${res.error}`)
      }
      console.log('[upload] 上传成功:', res.data)

      file.progress = 100
      file.status = 'success'
      return true
    } catch (error) {
      console.error(`上传文件 ${file.name} 失败:`, error)
      file.status = 'error'
      file.progress = 0
      return false
    }
  }

  // 解析图片
  async function parseImage(file: File): Promise<{ description: string }> {
    const result = await parseApi.parseImage(file)
    return result || { description: '' }
  }

  // 解析 Word
  async function parseWord(file: File): Promise<{ content: string }> {
    const result = await parseApi.parseWord(file)
    return result || { content: '' }
  }

  // 读取文件为文本
  function readAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  // 批量上传
  async function uploadAll(kbType: string = 'general') {
    isUploading.value = true

    for (const file of files.value) {
      if (file.status === 'pending') {
        await uploadFile(file.id, kbType)
      }
    }

    isUploading.value = false
  }

  // 格式化文件大小
  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // 🔒 重置 upload store 状态（用户隔离用）
  function reset() {
    files.value.length = 0
    rawFiles.value.clear()
    isUploading.value = false
  }

  return {
    // 状态
    files,
    isUploading,
    maxFileSize,
    supportedTypes,

    // 计算属性
    hasFiles,
    uploadProgress,

    // 方法
    addFiles,
    removeFile,
    clearFiles,
    getFileType,
    isImageFile,
    uploadFile,
    uploadAll,
    formatSize,
    reset
  }
})
