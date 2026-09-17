<script setup lang="ts">
import { ref, computed } from 'vue'
import { useUploadStore, type UploadFile } from '@/stores/upload'
import { ElMessage } from 'element-plus'

const uploadStore = useUploadStore()

// 文件 input ref
const fileInput = ref<HTMLInputElement | null>(null)

// 触发文件选择
function triggerFileSelect() {
  fileInput.value?.click()
}

// 处理文件选择
function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    uploadStore.addFiles(target.files)
  }
  // 清空 input 以允许重复选择同一文件
  target.value = ''
}

// 拖拽状态
const isDragging = ref(false)

// 知识库类型选择
const selectedKbType = ref<string>('general')

// 处理拖拽进入
function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

// 处理拖拽离开
function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
}

// 处理拖拽放下
function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false

  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    uploadStore.addFiles(e.dataTransfer.files)
  }
}

// 移除文件
function removeFile(file: UploadFile) {
  uploadStore.removeFile(file.id)
}

// 上传文件
async function uploadFiles() {
  if (uploadStore.files.length === 0) {
    ElMessage.warning('请先选择文件')
    return
  }
  await uploadStore.uploadAll(selectedKbType.value)
}

// 获取状态图标
function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    pending: 'Upload',
    uploading: 'Loading',
    success: 'CircleCheck',
    error: 'CircleClose'
  }
  return icons[status] || 'Upload'
}

// 获取状态颜色
function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: 'info',
    uploading: 'warning',
    success: 'success',
    error: 'danger'
  }
  return colors[status] || 'info'
}

// 进度条状态
function getProgressStatus(status: string): string {
  if (status === 'error') return 'exception'
  if (status === 'success') return 'success'
  return ''
}

// 获取文件图标
function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, string> = {
    md: 'Document',
    txt: 'Document',
    json: 'Document',
    csv: 'Document',
    pdf: 'Document',
    docx: 'Document',
    png: 'Picture',
    jpg: 'Picture',
    jpeg: 'Picture',
    gif: 'Picture'
  }
  return iconMap[ext] || 'Document'
}

// 是否可以上传
const canUpload = computed(() => {
  return uploadStore.files.some(f => f.status === 'pending')
})
</script>

<template>
  <div class="upload-container">
    <!-- 隐藏的文件 input -->
    <input
      ref="fileInput"
      type="file"
      multiple
      accept=".md,.txt,.json,.log,.xml,.csv,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp,.bmp"
      style="display: none"
      @change="handleFileSelect"
    />

    <!-- 拖拽上传区 -->
    <div
      :class="['drop-zone', { dragging: isDragging }]"
      @click="triggerFileSelect"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover.prevent
      @drop="handleDrop"
    >
      <el-icon class="drop-icon"><Upload /></el-icon>
      <div class="drop-text">
        拖拽文件到此处，或<em>点击选择</em>
      </div>
      <div class="drop-hint">
        支持 .md, .txt, .json, .docx, .png, .jpg 等格式，单文件不超过 10MB
      </div>
    </div>

    <!-- 文件列表 -->
    <div v-if="uploadStore.files.length > 0" class="file-list">
      <div class="file-list-header">
        <span>已选择 {{ uploadStore.files.length }} 个文件</span>
        <el-button link type="primary" @click="uploadStore.clearFiles()">
          清空
        </el-button>
      </div>

      <div
        v-for="file in uploadStore.files"
        :key="file.id"
        class="file-item"
      >
        <div class="file-icon">
          <el-icon>
            <component :is="getFileIcon(file.name)" />
          </el-icon>
        </div>

        <div class="file-info">
          <div class="file-name">{{ file.name }}</div>
          <div class="file-meta">
            <span>{{ uploadStore.formatSize(file.size) }}</span>
            <span v-if="file.description"> · {{ file.description }}</span>
          </div>
          <el-progress
            v-if="file.status === 'uploading'"
            :percentage="file.progress"
            :status="getProgressStatus(file.status)"
            :stroke-width="4"
          />
        </div>

        <div class="file-status">
          <el-tag :type="getStatusColor(file.status)" size="small">
            {{ file.status === 'uploading' ? '上传中' : file.status === 'success' ? '完成' : file.status === 'error' ? '失败' : '等待' }}
          </el-tag>
          <el-button
            link
            type="danger"
            @click="removeFile(file)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 知识库类型选择 -->
      <div class="kb-type-select" style="margin-bottom: 12px;">
        <span style="margin-right: 8px; font-size: 14px; color: var(--el-text-color-regular);">上传到：</span>
        <el-radio-group v-model="selectedKbType" size="small">
          <el-radio-button value="general">通用知识库</el-radio-button>
          <el-radio-button value="project-test">测试项目库</el-radio-button>
          <el-radio-button value="project-biz">业务项目库</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 上传按钮 -->
      <div class="upload-actions">
        <el-button
          type="primary"
          :loading="uploadStore.isUploading"
          :disabled="!canUpload"
          @click="uploadFiles"
        >
          上传到知识库
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-container {
  padding: 16px;
}

.drop-zone {
  border: 2px dashed var(--el-border-color);
  border-radius: 8px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s;
  background: var(--el-fill-color-lighter);
}

.drop-zone:hover,
.drop-zone.dragging {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.drop-icon {
  font-size: 48px;
  color: var(--el-text-color-placeholder);
  margin-bottom: 16px;
}

.drop-zone:hover .drop-icon,
.drop-zone.dragging .drop-icon {
  color: var(--el-color-primary);
}

.drop-text {
  font-size: 14px;
  color: var(--el-text-color-regular);
  margin-bottom: 8px;
}

.drop-text em {
  color: var(--el-color-primary);
  font-style: normal;
}

.drop-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.file-list {
  margin-top: 20px;
}

.file-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  margin-bottom: 8px;
}

.file-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color);
  border-radius: 8px;
  font-size: 20px;
  color: var(--el-color-primary);
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.file-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.upload-actions {
  margin-top: 16px;
  text-align: right;
}
</style>
