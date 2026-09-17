<template>
  <div class="profile-container">
    <el-card class="profile-card">
      <template #header>
        <div class="card-header">
          <span class="title">👤 个人信息</span>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        size="large"
      >
        <el-form-item label="用户名">
          <el-input
            :model-value="form.username"
            disabled
            prefix-icon="User"
          />
        </el-form-item>

        <el-form-item label="姓名" prop="name" required>
          <el-input
            v-model="form.name"
            placeholder="请输入姓名"
            prefix-icon="Edit"
          />
        </el-form-item>

        <el-form-item label="当前角色">
          <el-tag :type="form.role === 'admin' ? 'danger' : 'info'" disable-transitions>
            {{ form.role === 'admin' ? '管理员' : '普通用户' }}
          </el-tag>
          <span class="form-tip">角色不可自助修改</span>
        </el-form-item>

        <el-form-item label="新密码" prop="password">
          <div class="password-wrapper">
            <el-input
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="留空则不修改密码"
            />
            <el-icon
              class="password-toggle"
              :class="{ 'is-active': form.password }"
              @click="showPassword = !showPassword"
            >
              <component :is="showPassword ? 'View' : 'Hide'" />
            </el-icon>
          </div>
        </el-form-item>

        <el-form-item label="确认密码" prop="passwordConfirm">
          <div class="password-wrapper">
            <el-input
              v-model="form.passwordConfirm"
              :type="showConfirmPassword ? 'text' : 'password'"
              placeholder="再次输入新密码"
              @keyup.enter="handleSave"
            />
            <el-icon
              class="password-toggle"
              :class="{ 'is-active': form.passwordConfirm }"
              @click="showConfirmPassword = !showConfirmPassword"
            >
              <component :is="showConfirmPassword ? 'View' : 'Hide'" />
            </el-icon>
          </div>
        </el-form-item>

        <el-form-item>
          <div class="action-row">
            <el-button type="primary" :loading="saving" @click="handleSave">
              保存
            </el-button>
            <el-button @click="loadCurrent">重置</el-button>
            <el-button @click="handleClose">关闭</el-button>
          </div>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { View, Hide } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useMainStore } from '@/stores/main'
import { userApi } from '@/api'

const router = useRouter()
const mainStore = useMainStore()
const formRef = ref<FormInstance>()
const saving = ref(false)
const showPassword = ref(false)
const showConfirmPassword = ref(false)

const form = reactive({
  id: '',
  username: '',
  name: '',
  role: 'user',
  password: '',
  passwordConfirm: '',
})

const validatePasswordConfirm = (_: unknown, value: string, callback: (err?: Error) => void) => {
  if (form.password && value !== form.password) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const rules: FormRules = {
  name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { min: 2, max: 20, message: '姓名长度为2-20个字符', trigger: 'blur' }
  ],
  password: [
    {
      validator: (_: unknown, value: string, callback: (err?: Error) => void) => {
        if (value && value.length < 6) {
          callback(new Error('密码长度至少 6 位'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
  passwordConfirm: [{ validator: validatePasswordConfirm, trigger: 'blur' }],
}

function loadCurrent() {
  const u = mainStore.user
  if (!u) {
    router.push('/login')
    return
  }
  form.id = (u as any).id || ''
  form.username = (u as any).username || ''
  form.name = (u as any).name || ''
  form.role = (u as any).role || 'user'
  form.password = ''
  form.passwordConfirm = ''
}

async function handleSave() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const data: Record<string, any> = { name: form.name }
    if (form.password) data.password = form.password

    const res = await userApi.update(form.id, data)
    if (res?.success) {
      ElMessage.success('个人信息已更新')
      // 同步 store 里的姓名
      if (mainStore.user) {
        ;(mainStore.user as any).name = form.name
      }
      form.password = ''
      form.passwordConfirm = ''
    } else {
      ElMessage.error(res?.error || '更新失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '更新失败')
  } finally {
    saving.value = false
  }
}

function handleClose() {
  // 如果有上一级路由则返回，否则回首页
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

onMounted(loadCurrent)
</script>

<style scoped>
.profile-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 24px;
  background: linear-gradient(135deg, #F5F5F7 0%, #EAF2FE 100%);
}

.profile-card {
  width: 560px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.profile-card :deep(.el-form-item) {
  margin-bottom: 18px;
}

.profile-card :deep(.el-card__body) {
  padding: 20px 28px 28px;
}

.card-header {
  text-align: center;
}

.title {
  font-size: 24px;
  font-weight: bold;
  color: #0B1B32;
}

.form-tip {
  margin-left: 12px;
  color: #909399;
  font-size: 12px;
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

/* 按钮一行三个 */
.action-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
