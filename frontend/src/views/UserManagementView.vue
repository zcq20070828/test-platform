<template>
  <div class="user-management">
    <div class="page-header">
      <h2>👥 用户管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon><Plus /></el-icon>
        创建用户
      </el-button>
    </div>

    <!-- 用户列表 -->
    <el-card>
      <el-table :data="users" stripe style="width: 100%">
        <el-table-column prop="username" label="用户名" width="150" />
        <el-table-column prop="name" label="姓名" width="150" />
        <el-table-column prop="role" label="角色" width="120">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'info'">
              {{ row.role === 'admin' ? '管理员' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">
            {{ new Date(row.createdAt).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="handleEdit(row)">
              编辑
            </el-button>
            <el-button
              size="small"
              type="danger"
              @click="handleDelete(row)"
              :disabled="row.id === currentUser?.id"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建/编辑用户对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      :title="isEditing ? '编辑用户' : '创建用户'"
      width="500px"
      @close="resetForm"
    >
      <el-form
        ref="userFormRef"
        :model="userForm"
        :rules="userRules"
        label-width="80px"
      >
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="userForm.username"
            :disabled="isEditing"
            placeholder="请输入用户名"
          />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="userForm.password"
            type="password"
            show-password
            :placeholder="isEditing ? '不修改请留空' : '8-16位，含大小写字母、数字、特殊字符'"
          />
        </el-form-item>

        <el-form-item label="姓名" prop="name">
          <el-input
            v-model="userForm.name"
            placeholder="请输入姓名（可选）"
          />
        </el-form-item>

        <el-form-item label="角色" prop="role">
          <el-select v-model="userForm.role" placeholder="请选择角色">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="loading" @click="handleSubmit">
          {{ isEditing ? '更新' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useMainStore } from '@/stores/main'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { userApi } from '@/api'

const mainStore = useMainStore()
const currentUser = computed(() => mainStore.user)

// 使用共享 API 层（userApi）

const users = ref<any[]>([])
const loading = ref(false)
const showCreateDialog = ref(false)
const error = ref('')

// 添加调试信息
console.log('[UserManagementView] 组件初始化')
const isEditing = ref(false)
const editingUserId = ref('')

const userFormRef = ref<FormInstance>()
const userForm = reactive({
  username: '',
  password: '',
  name: '',
  role: 'user'
})

// 密码强度校验：8-16位，须含大小写字母、数字、特殊字符
const validatePassword = (rule: any, value: string, callback: Function) => {
  if (!value && isEditing.value) {
    callback() // 编辑时密码可留空
    return
  }
  if (!value) {
    callback(new Error('请输入密码'))
    return
  }
  if (value.length < 8 || value.length > 16) {
    callback(new Error('密码长度须在8-16位之间'))
    return
  }
  if (!/[a-z]/.test(value)) {
    callback(new Error('密码须包含小写字母'))
    return
  }
  if (!/[A-Z]/.test(value)) {
    callback(new Error('密码须包含大写字母'))
    return
  }
  if (!/[0-9]/.test(value)) {
    callback(new Error('密码须包含数字'))
    return
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(value)) {
    callback(new Error('密码须包含特殊字符'))
    return
  }
  callback()
}

const userRules = computed<FormRules>(() => ({
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' }
  ],
  password: [
    { required: !isEditing.value, validator: validatePassword, trigger: 'blur' }
  ],
  role: [
    { required: true, message: '请选择角色', trigger: 'change' }
  ]
}))

// 加载用户列表
async function loadUsers() {
  console.log('[UserManagementView] 开始加载用户列表')
  loading.value = true
  error.value = ''
  try {
    const data = await userApi.list()
    console.log('[UserManagementView] 用户数据:', data)
    users.value = data || []
  } catch (err: any) {
    console.error('[UserManagementView] 加载失败:', err)
    error.value = err.message || '加载用户列表失败'
    ElMessage.error(error.value)
  } finally {
    loading.value = false
  }
}

// 处理创建/编辑提交
async function handleSubmit() {
  if (!userFormRef.value) return

  await userFormRef.value.validate(async (valid) => {
    if (!valid) return

    loading.value = true
    try {
      if (isEditing.value) {
        // 更新用户
        const data: any = {
          name: userForm.name,
          role: userForm.role
        }
        if (userForm.password) {
          data.password = userForm.password
        }

        const updateRes = await userApi.update(editingUserId.value, data)
        if (!updateRes.success) {
          ElMessage.error('更新失败：' + (updateRes.error || '用户名可能已存在'))
          loading.value = false
          return
        }
        ElMessage.success('用户更新成功')
      } else {
        // 创建用户
        const createRes = await userApi.create({
            username: userForm.username,
            password: userForm.password,
            name: userForm.name,
            role: userForm.role
          })
        if (!createRes.success) {
          ElMessage.error('创建失败：' + (createRes.error || '用户名可能已存在'))
          loading.value = false
          return
        }
        ElMessage.success('用户创建成功')
      }

      showCreateDialog.value = false
      resetForm()
      loadUsers()
    } catch (err: any) {
      // 网络异常等
      ElMessage.error('操作失败：' + (err.message || '网络异常'))
    } finally {
      loading.value = false
    }
  })
}

// 处理编辑
function handleEdit(user: any) {
  isEditing.value = true
  editingUserId.value = user.id
  userForm.username = user.username
  userForm.password = ''
  userForm.name = user.name
  userForm.role = user.role
  showCreateDialog.value = true
}

// 处理删除
async function handleDelete(user: any) {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户 "${user.name || user.username}" 吗？`,
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    const delRes = await userApi.delete(user.id)
    if (!delRes.success) {
      ElMessage.error('删除失败：' + (delRes.error || '无法删除该用户'))
      return
    }
    ElMessage.success('用户删除成功')
    loadUsers()
  } catch (err: any) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败：' + (err.message || '网络异常'))
    }
  }
}

// 重置表单
function resetForm() {
  isEditing.value = false
  editingUserId.value = ''
  userForm.username = ''
  userForm.password = ''
  userForm.name = ''
  userForm.role = 'user'
  userFormRef.value?.resetFields()
}

onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
.user-management {
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  color: var(--text);
}
</style>
