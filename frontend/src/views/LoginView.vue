<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { ElMessage } from 'element-plus'
import { authApi } from '@/api/index'
import { ssoApi } from '@/api/sso'

const router = useRouter()
const mainStore = useMainStore()

// 登录表单
const loginForm = ref({
  username: '',
  password: ''
})

// 表单验证
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

// 登录状态
const isLoading = ref(false)

// 密码可见性切换
const showPassword = ref(false)
const ssoEnabled = ref(false)
const ssoLoading = ref(false)

// 加载 SSO 配置
onMounted(async () => {
  const config = await ssoApi.getConfig()
  ssoEnabled.value = config?.enabled ?? false

  // 如果已登录，直接跳转
  if (mainStore.isLoggedIn) {
    router.push('/')
  }
  
  // 强制清空表单（防止浏览器自动填充）
  loginForm.value.username = ''
  loginForm.value.password = ''
})

// SSO 统一认证登录
async function handleSsoLogin() {
  ssoLoading.value = true
  try {
    const result = await ssoApi.getLoginUrl()
    if (result?.loginUrl) {
      window.location.href = result.loginUrl
    } else {
      ElMessage.error('获取统一认证登录地址失败')
    }
  } catch {
    ElMessage.error('统一认证服务不可用')
  } finally {
    ssoLoading.value = false
  }
}

// 执行登录
async function handleLogin() {
  if (!loginForm.value.username || !loginForm.value.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }

  isLoading.value = true

  try {
    // 调用真实登录API
    const result = await authApi.login(loginForm.value.username, loginForm.value.password)
    
    // 兼容两种返回格式：
    // - 正确格式: {token, user}
    // - 错误格式: {success, data: {token, user}}
    let token: string | undefined
    let user: any | undefined
    let refreshToken: string | undefined
    if (result && typeof result === 'object') {
      if ('success' in result && result.success && (result as any).data) {
        // 返回的是完整响应对象 {success, data}
        console.warn('[LoginView] authApi.login 返回了完整响应对象，已兼容处理')
        const r = result as any
        token = r.data?.token || r.token
        user = r.data?.user || r.user
        refreshToken = r.data?.refreshToken || r.refreshToken
      } else if ('token' in result && 'user' in result) {
        // 正确格式 {token, user}
        token = result.token
        user = result.user
        refreshToken = (result as any).refreshToken
      }
    }
    
    if (!token || !user) {
      // 优先显示后端返回的具体错误
      const backendError = (result as any).error
      ElMessage.error(backendError || '登录失败，请重试')
      return
    }
    
    // 保存用户信息到store
    mainStore.setUser({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      token: token,
      refreshToken: refreshToken
    })
    
    ElMessage.success('登录成功')
    router.push('/')
  } catch (error: any) {
    // 网络异常等未到达后端的情况
    ElMessage.error('网络异常，请检查网络后重试')
  } finally {
    isLoading.value = false
  }
}

// 跳转到主页面
function goHome() {
  router.push('/')
}


</script>

<template>
  <div class="login-page" data-testid="login-page">
    <div class="login-background">
      <div class="glow glow-1" />
      <div class="glow glow-2" />
    </div>

    <div class="login-container">
      <!-- Logo 区域 -->
      <div class="login-header">
        <div class="logo">🧪</div>
        <h1 class="title">测试中台</h1>
        <p class="subtitle">AI 智能测试平台</p>
      </div>

      <!-- 登录表单 -->
      <el-form
        ref="formRef"
        :model="loginForm"
        :rules="rules"
        class="login-form"
        @submit.prevent="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="loginForm.username"
            placeholder="用户名"
            :prefix-icon="'User'"
            size="large"
            autocomplete="username"
          />
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="loginForm.password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="密码"
            :prefix-icon="'Lock'"
            size="large"
            autocomplete="new-password"
            @keyup.enter="handleLogin"
          >
            <template #suffix>
              <el-icon
                class="password-toggle"
                role="button"
                tabindex="0"
                aria-label="切换密码可见性"
                @click="showPassword = !showPassword"
                @keyup.enter="showPassword = !showPassword"
              >
                <component :is="showPassword ? 'View' : 'Hide'" />
              </el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="isLoading"
            class="login-btn"
            native-type="submit"
          >
            {{ isLoading ? '登录中...' : '登 录' }}
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 统一认证登录（当 SSO 启用时显示） -->
      <div v-if="ssoEnabled" class="sso-login">
        <el-divider>或</el-divider>
        <el-button
          size="large"
          class="sso-btn"
          @click="handleSsoLogin"
          :loading="ssoLoading"
        >
          <el-icon><Connection /></el-icon>
          统一身份认证登录
        </el-button>
      </div>

      <!-- 注册链接 -->
      <div class="register-link">
        还没有账号？<router-link to="/register">立即注册</router-link>
      </div>

      <!-- 返回首页 -->
      <div class="login-footer">
        <el-button link @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回首页
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  position: relative;
  overflow: hidden;
}

.login-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.3;
}

.glow-1 {
  width: 400px;
  height: 400px;
  background: var(--glow-primary);
  top: 10%;
  left: 20%;
}

.glow-2 {
  width: 300px;
  height: 300px;
  background: var(--glow-secondary);
  bottom: 20%;
  right: 15%;
}

.login-container {
  position: relative;
  width: 400px;
  padding: 48px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  backdrop-filter: blur(20px);
  box-shadow: var(--shadow-pop);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo {
  font-size: 48px;
  margin-bottom: 16px;
}

.title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 8px;
}

.subtitle {
  font-size: 14px;
  color: var(--text-secondary);
}

.login-form {
  margin-bottom: 24px;
}

.login-btn {
  width: 100%;
  height: 44px;
  font-size: 16px;
  background: var(--primary);
  border: none;
}

.login-btn:hover {
  background: var(--primary-light);
}

.login-footer {
  text-align: center;
  margin-top: 24px;
}

.register-link {
  text-align: center;
  margin-top: 16px;
  font-size: 14px;
  color: var(--text-secondary);
}

.register-link a {
  color: var(--primary);
  text-decoration: none;
  font-weight: bold;
}

.register-link a:hover {
  text-decoration: underline;
}

.sso-login {
  margin-top: 8px;
}

.sso-btn {
  width: 100%;
  height: 44px;
  font-size: 15px;
  border: 1px solid var(--primary);
  color: var(--primary);
  background: transparent;
}

.sso-btn:hover {
  background: var(--primary);
  color: #fff;
}

.login-footer .el-button {
  color: var(--text-secondary);
}

.login-footer .el-button:hover {
  color: var(--text);
}
</style>
