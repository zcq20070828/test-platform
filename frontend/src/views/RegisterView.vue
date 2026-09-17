<template>
  <div class="register-container" data-testid="register-page">
    <el-card class="register-card">
      <template #header>
        <div class="card-header">
          <span class="title">🧪 测试中台 - 用户注册</span>
        </div>
      </template>
      
      <el-form
        ref="registerFormRef"
        :model="registerForm"
        :rules="registerRules"
        label-width="100px"
        size="large"
      >
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="registerForm.username"
            placeholder="请输入用户名"
            prefix-icon="User"
          />
        </el-form-item>
        
        <el-form-item label="密码" prop="password">
          <div class="password-wrapper">
            <el-input
              v-model="registerForm.password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="8-16位，须包含大小写字母、数字和特殊字符"
            />
            <el-icon
              class="password-toggle"
              :class="{ 'is-active': registerForm.password }"
              @click="showPassword = !showPassword"
            >
              <component :is="showPassword ? 'View' : 'Hide'" />
            </el-icon>
          </div>
        </el-form-item>

        <el-form-item label="确认密码" prop="confirmPassword">
          <div class="password-wrapper">
            <el-input
              v-model="registerForm.confirmPassword"
              :type="showConfirmPassword ? 'text' : 'password'"
              placeholder="请再次输入密码"
              @keyup.enter="handleRegister"
            />
            <el-icon
              class="password-toggle"
              :class="{ 'is-active': registerForm.confirmPassword }"
              @click="showConfirmPassword = !showConfirmPassword"
            >
              <component :is="showConfirmPassword ? 'View' : 'Hide'" />
            </el-icon>
          </div>
        </el-form-item>
        
        <el-form-item label="姓名" prop="name" required>
          <el-input
            v-model="registerForm.name"
            placeholder="请输入姓名"
            prefix-icon="Edit"
          />
        </el-form-item>
        
        <el-form-item>
          <el-button
            type="primary"
            style="width: 100%"
            :loading="loading"
            @click="handleRegister"
          >
            注册
          </el-button>
        </el-form-item>
      </el-form>
      
      <div class="login-link">
        已有账号？<router-link to="/login">立即登录</router-link>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { View, Hide } from '@element-plus/icons-vue'
import { authApi } from '@/api/index'

const router = useRouter()
const registerFormRef = ref<FormInstance>()
const loading = ref(false)
const showPassword = ref(false)
const showConfirmPassword = ref(false)

const registerForm = reactive({
  username: '',
  password: '',
  confirmPassword: '',
  name: ''
})

const validateConfirmPassword = (rule: any, value: string, callback: Function) => {
  if (value === '') {
    callback(new Error('请再次输入密码'))
  } else if (value !== registerForm.password) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const registerRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度为3-20个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 16, message: '密码长度为8-16位', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: Function) => {
        if (!value) { callback(); return }
        const checks: string[] = []
        if (!/[a-z]/.test(value)) checks.push('小写字母')
        if (!/[A-Z]/.test(value)) checks.push('大写字母')
        if (!/\d/.test(value)) checks.push('数字')
        if (!/[^a-zA-Z\d]/.test(value)) checks.push('特殊字符')
        if (checks.length > 0) {
          callback(new Error(`密码还缺少：${checks.join('、')}`))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' }
  ],
  name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { min: 2, max: 20, message: '姓名长度为2-20个字符', trigger: 'blur' }
  ]
}

async function handleRegister() {
  if (!registerFormRef.value) return
  
  await registerFormRef.value.validate(async (valid) => {
    if (!valid) return
    
    loading.value = true
    try {
      const result = await authApi.register(
        registerForm.username,
        registerForm.password,
        registerForm.name
      )
      
      if (!result) {
        // 优先显示后端返回的具体错误（如"用户名已存在"）
        const backendError = (result as any).error
        ElMessage.error(backendError || '注册失败，请重试')
        return
      }
      
      ElMessage.success('注册成功！即将跳转到登录页...')
      setTimeout(() => {
        router.push('/login')
      }, 1500)
    } catch (error: any) {
      ElMessage.error('网络异常，请检查网络后重试')
    } finally {
      loading.value = false
    }
  })
}
</script>

<style scoped>
.register-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: linear-gradient(135deg, #B8C4D8 0%, #0B1B32 100%);
}

.register-card {
  width: 500px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.card-header {
  text-align: center;
}

.title {
  font-size: 24px;
  font-weight: bold;
  color: #0B1B32;
}

.login-link {
  text-align: center;
  margin-top: 16px;
  font-size: 14px;
}

.login-link a {
  color: #0B1B32;
  text-decoration: none;
  font-weight: bold;
}

.login-link a:hover {
  text-decoration: underline;
}

.password-toggle {
  cursor: pointer;
  color: #c0c4cc;
  font-size: 18px;
  transition: color 0.2s;
  flex-shrink: 0;
}
.password-toggle.is-active {
  color: #409eff;
}
.password-toggle:hover {
  color: #409eff;
}

/* 密码框 + 眼睛按钮：眼睛在输入框紧外右 */
.password-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.password-wrapper .el-input {
  flex: 1;
  min-width: 0;
}
</style>
