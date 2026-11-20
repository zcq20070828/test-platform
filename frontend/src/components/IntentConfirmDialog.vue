<script setup lang="ts">
/**
 * 意图确认弹窗（2026-11-20）
 *
 * 用户要求：「无法根据用户输入准确识别意图的时候就提供 3 个最有可能的选项给让用户选择」
 *
 * 为什么不让后端直接猜：
 *   关键词识别在「看看这个接口有没有问题」这类句子上必然含糊——
 *   是接口测试还是缺陷分析？只有用户知道。以前静默派给某个智能体，
 *   用户要等十几分钟看到产出才发现派错了。
 *
 * 交互约定：
 *   - 只给 3 个候选，不多给。选项太多等于把选择负担还给用户；
 *   - 分数只用于排序，**不展示**给用户（用户不关心 2.4 vs 0.8，只关心做什么）；
 *   - 命中词展示出来，让用户能判断「它为什么这么猜」，可纠正自己的表述；
 *   - 「就按这个来」= 选中项直接提交；用户改选后提交同理。
 */
import { ref, watch, computed } from 'vue'
import MsIcon from '@/components/MsIcon.vue'
import type { IntentCandidate } from '@/types'

const props = defineProps<{
  visible: boolean
  /** 后端给出的识别说明（为什么需要确认） */
  reason?: string
  candidates: IntentCandidate[]
  /** 提交中（避免重复点） */
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm', agentId: string): void
  (e: 'cancel'): void
}>()

const selected = ref('')

// 弹窗打开时默认选中后端首选（排第一的那个），用户直接回车即可
watch(
  () => props.visible,
  (v) => {
    if (v) selected.value = props.candidates[0]?.agentId || ''
  },
)

const options = computed(() => (props.candidates || []).slice(0, 3))

function labelOf(c: IntentCandidate): string {
  return c.agentName || c.agentId
}

function onConfirm() {
  if (!selected.value || props.loading) return
  emit('confirm', selected.value)
}

function onCancel() {
  emit('update:visible', false)
  emit('cancel')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="请确认这次要做什么"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
    @close="onCancel"
  >
    <div class="intent-hint">
      <MsIcon name="help" :size="16" />
      <span>{{ reason || '没能从描述里确定要执行哪类测试任务' }}，请选择最接近的一项：</span>
    </div>

    <el-radio-group v-model="selected" class="intent-options">
      <label
        v-for="c in options"
        :key="c.agentId"
        class="intent-option"
        :class="{ 'is-active': selected === c.agentId }"
      >
        <el-radio :value="c.agentId" class="intent-radio">
          <div class="intent-option-body">
            <div class="intent-option-title">{{ labelOf(c) }}</div>
            <div v-if="c.desc" class="intent-option-desc">{{ c.desc }}</div>
            <div v-if="c.hits && c.hits.length" class="intent-option-hits">
              依据：命中「{{ c.hits.join('、') }}」
            </div>
          </div>
        </el-radio>
      </label>
    </el-radio-group>

    <template #footer>
      <el-button @click="onCancel">取消</el-button>
      <el-button type="primary" :loading="loading" :disabled="!selected" @click="onConfirm">
        就用这个，开始执行
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.intent-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
}
.intent-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.intent-option {
  display: block;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}
.intent-option:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}
.intent-option.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.intent-radio {
  width: 100%;
  height: auto;
  margin-right: 0;
}
.intent-radio :deep(.el-radio__label) {
  width: 100%;
  white-space: normal;
  line-height: 1.5;
}
.intent-option-body {
  padding-left: 2px;
}
.intent-option-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.intent-option-desc {
  font-size: 12px;
  color: var(--el-text-color-regular);
  margin-top: 2px;
}
.intent-option-hits {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
</style>
