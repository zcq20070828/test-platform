<script setup lang="ts">
import { useMainStore } from '@/stores/main'
import AgentCard from '@/components/AgentCard.vue'
import { onMounted } from 'vue'

const store = useMainStore()

onMounted(() => {
  store.loadAgents()
})
</script>

<template>
  <div class="agents-view" data-testid="agents-page">
    <h2>智能体列表</h2>
    <el-row :gutter="16">
      <el-col
        v-for="agent in store.agents"
        :key="agent.id"
        :xs="24"
        :sm="12"
        :md="8"
        :lg="6"
      >
        <AgentCard :agent="agent" @click="store.setCurrentAgent(agent)" />
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.agents-view {
  padding: 24px;
}

h2 {
  margin-bottom: 24px;
}
</style>
