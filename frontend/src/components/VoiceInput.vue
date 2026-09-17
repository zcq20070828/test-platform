<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

const emit = defineEmits<{
  result: [text: string]
  error: [message: string]
}>()

// 录音状态
const isRecording = ref(false)
const recordingTime = ref(0)
let recognition: any = null
let timer: ReturnType<typeof setInterval> | null = null

// 浏览器支持检测
const isSupported = ref(false)

if (typeof window !== 'undefined') {
  const Win = window as any
  if ('SpeechRecognition' in Win || 'webkitSpeechRecognition' in Win) {
    isSupported.value = true
    const SpeechRecognitionCtor = Win.SpeechRecognition || Win.webkitSpeechRecognition
    recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'zh-CN'

    recognition.onresult = (event: any) => {
      const results = event.results
      const lastResult = results[results.length - 1]
      if (!lastResult) return
      const transcript = lastResult[0]?.transcript

      if (lastResult.isFinal && transcript) {
        emit('result', transcript)
      }
    }

    recognition.onerror = (event: any) => {
      console.error('语音识别错误:', event.error)
      stopRecording()
      emit('error', `语音识别错误: ${event.error}`)
    }

    recognition.onend = () => {
      if (isRecording.value) {
        try {
          recognition?.start()
        } catch {
          stopRecording()
        }
      }
    }
  }
}

// 开始录音
function startRecording() {
  if (!recognition) {
    ElMessage.warning('当前浏览器不支持语音识别')
    return
  }

  try {
    recognition.start()
    isRecording.value = true
    recordingTime.value = 0

    timer = setInterval(() => {
      recordingTime.value++
    }, 1000)

    ElMessage.success('开始语音输入...')
  } catch (error) {
    console.error('启动语音识别失败:', error)
    ElMessage.error('启动语音识别失败')
  }
}

// 停止录音
function stopRecording() {
  if (!recognition) return

  try {
    recognition.stop()
  } catch {
    // 忽略停止时的错误
  }

  isRecording.value = false

  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// 切换录音状态
function toggleRecording() {
  if (isRecording.value) {
    stopRecording()
  } else {
    startRecording()
  }
}

// 格式化时间
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

onUnmounted(() => {
  if (isRecording.value) {
    stopRecording()
  }
  if (timer) {
    clearInterval(timer)
  }
})
</script>

<template>
  <div class="voice-input">
    <el-tooltip
      :content="isRecording ? '停止录音' : '语音输入'"
      placement="top"
    >
      <el-button
        :type="isRecording ? 'danger' : 'default'"
        :circle="true"
        :disabled="!isSupported"
        @click="toggleRecording"
      >
        <template #icon>
          <el-icon v-if="!isRecording">
            <Microphone />
          </el-icon>
          <el-icon v-else class="recording-icon">
            <Microphone />
          </el-icon>
        </template>
      </el-button>
    </el-tooltip>

    <!-- 录音状态指示 -->
    <div v-if="isRecording" class="recording-indicator">
      <span class="dot" />
      <span class="time">{{ formatTime(recordingTime) }}</span>
    </div>
  </div>
</template>

<style scoped>
.voice-input {
  display: flex;
  align-items: center;
  gap: 8px;
}

.recording-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.dot {
  width: 8px;
  height: 8px;
  background: var(--el-color-danger);
  border-radius: 50%;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.recording-icon {
  animation: bounce 0.5s ease infinite;
}

@keyframes bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.time {
  font-family: 'Monaco', 'Menlo', monospace;
  min-width: 36px;
}
</style>
