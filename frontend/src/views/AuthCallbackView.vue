<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { ssoApi } from '@/api/sso'
import { ElMessage } from 'element-plus'

const router = useRouter()
const route = useRoute()
const mainStore = useMainStore()
const error = ref('')

onMounted(async () => {
  const code = route.query.code as string
  const state = route.query.state as string
  const errorParam = route.query.error as string

  if (errorParam) {
    error.value = (route.query.error_description as string) || '认证失败'
    return
  }

  if (!code || !state) {
    error.value = '缺少认证参数'
    return
  }

  try {
    const redirectUri = `${window.location.origin}/auth/callback`
    const result = await ssoApi.callback(code, state, redirectUri)

    if (!result) {
      error.value = '认证回调处理失败'
      return
    }

    mainStore.setUser({
      id: result.user.id,
      name: result.user.name,
      role: result.user.role as any,
      token: result.token,
      authSource: 'keycloak'
    })

    // 存储 refresh token
    localStorage.setItem('refreshToken', result.refreshToken)

    ElMessage.success('登录成功')
    router.push('/')
  } catch (e: any) {
    error.value = e.message || '认证失败，请重试'
  }
})
</script>

<template>
  <div class="auth-callback-page">
    <div v-if="!error" class="loading">
      <el-icon class="is-loading" :size="48"><Loading /></el-icon>
      <p>正在完成统一认证...</p>
    </div>
    <div v-else class="error">
      <el-icon :size="48" color="var(--el-color-danger)"><CircleCloseFilled /></el-icon>
      <p class="error-text">{{ error }}</p>
      <el-button type="primary" @click="$router.push('/login')">返回登录</el-button>
    </div>
  </div>
</template>

<style scoped>
.auth-callback-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}

.loading,
.error {
  text-align: center;
  color: var(--text);
}

.loading p,
.error p {
  margin-top: 16px;
  font-size: 16px;
}

.error-text {
  color: var(--el-color-danger);
  margin-bottom: 24px;
}
</style>
