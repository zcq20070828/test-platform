<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useFileStore, type FileItem } from '@/stores/file'
import { ElMessage, ElMessageBox } from 'element-plus'

const store = useFileStore()

// 初始化
onMounted(() => {
  store.init()
})

// 双击进入目录
function handleDblClick(file: FileItem) {
  if (file.isDirectory) {
    store.enterDirectory(file.path)
  }
}

// 格式化时间
function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 选择文件
function handleSelect(file: FileItem) {
  store.toggleSelect(file.path)
}

// 上传选中文件
async function handleUpload() {
  if (store.selectedFiles.length === 0) {
    ElMessage.warning('请先选择文件')
    return
  }

  await ElMessageBox.confirm(
    `确定要将 ${store.selectedFiles.length} 个文件上传到知识库吗？`,
    '确认上传',
    { confirmButtonText: '确定', cancelButtonText: '取消', type: 'info' }
  )

  const success = await store.uploadToKnowledge(store.selectedFiles)
  if (success) {
    ElMessage.success('上传成功')
    store.clearSelection()
  } else {
    ElMessage.error('上传失败，请重试')
  }
}
</script>

<template>
  <div class="file-browser">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="left">
        <el-button size="small" @click="store.goBack()" :disabled="!store.hasParent">
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <el-button size="small" @click="store.refresh()">
          <el-icon><Refresh /></el-icon>
        </el-button>
        <el-button size="small" @click="store.selectAll()">全选</el-button>
        <el-button size="small" @click="store.clearSelection()" :disabled="store.selectedFiles.length === 0">
          取消
        </el-button>
      </div>
      <div class="right">
        <el-button
          size="small"
          type="primary"
          :disabled="store.selectedFiles.length === 0"
          @click="handleUpload"
        >
          <el-icon><Upload /></el-icon>
          上传知识库
        </el-button>
      </div>
    </div>

    <!-- 路径导航 -->
    <div class="path-bar">
      <span class="path-label">当前位置：</span>
      <el-breadcrumb separator="/">
        <el-breadcrumb-item>
          <span class="root-path" @click="store.enterDirectory(store.rootPath)">
            ~
          </span>
        </el-breadcrumb-item>
        <el-breadcrumb-item
          v-for="(part, index) in store.currentPath.split('/').filter(p => p && p !== 'Users' && p !== 'zhaochengqing')"
          :key="index"
        >
          {{ part }}
        </el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <!-- 文件列表 -->
    <el-table
      :data="store.files"
      stripe
      v-loading="store.isLoading"
      @row-dblclick="handleDblClick"
      :row-class-name="({ row }: { row: FileItem }) => store.selectedFiles.includes(row.path) ? 'selected-row' : ''"
      style="width: 100%"
    >
      <el-table-column width="40">
        <template #header>
          <el-checkbox
            :model-value="store.files.length > 0 && store.selectedFiles.length === store.files.length"
            :indeterminate="store.selectedFiles.length > 0 && store.selectedFiles.length < store.files.length"
            @change="store.selectedFiles.length === store.files.length ? store.clearSelection() : store.selectAll()"
          />
        </template>
        <template #default="{ row }">
          <el-checkbox
            :model-value="store.selectedFiles.includes(row.path)"
            @change="handleSelect(row)"
          />
        </template>
      </el-table-column>

      <el-table-column label="名称" min-width="300">
        <template #default="{ row }">
          <div class="file-name-cell" @dblclick="handleDblClick(row)">
            <el-icon class="file-icon" :class="{ 'is-folder': row.isDirectory }">
              <component :is="store.getFileIcon(row)" />
            </el-icon>
            <span class="file-name">{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="大小" width="100">
        <template #default="{ row }">
          {{ row.isDirectory ? '-' : store.formatSize(row.size) }}
        </template>
      </el-table-column>

      <el-table-column label="修改时间" width="160">
        <template #default="{ row }">
          {{ formatTime(row.modifiedTime) }}
        </template>
      </el-table-column>

      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.isDirectory"
            link
            type="primary"
            @click="store.enterDirectory(row.path)"
          >
            进入
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 状态栏 -->
    <div class="status-bar">
      <span>{{ store.files.length }} 个项目</span>
      <span v-if="store.selectedFiles.length > 0">，已选择 {{ store.selectedFiles.length }} 个</span>
    </div>
  </div>
</template>

<style scoped>
.file-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-light);
}

.toolbar .left,
.toolbar .right {
  display: flex;
  gap: 8px;
}

.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.path-label {
  color: var(--el-text-color-placeholder);
}

.root-path {
  cursor: pointer;
  color: var(--el-color-primary);
}

.root-path:hover {
  text-decoration: underline;
}

.status-bar {
  padding: 8px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-border-color-light);
}

.file-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.file-icon {
  font-size: 18px;
  color: var(--el-color-primary);
}

.file-icon.is-folder {
  color: var(--el-color-warning);
}

.file-name {
  font-size: 13px;
}

.file-name:hover {
  color: var(--el-color-primary);
}
</style>

<style>
.selected-row {
  background-color: var(--el-color-primary-light-9) !important;
}
</style>
