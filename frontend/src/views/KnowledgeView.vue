<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useMainStore } from '@/stores/main'
import { knowledgeApi, fsApi, gitApi, credentialsApi } from '@/api/index'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import SemanticSearch from '@/components/SemanticSearch.vue'
import type { KnowledgeDoc } from '@/types'

const store = useKnowledgeStore()
const mainStore = useMainStore()
const currentUser = computed(() => mainStore.user)
const isAdmin = computed(() => currentUser.value?.role === 'admin')

// “学习知识”：触发后端逐智能体学习当前用户可见的知识库文档
async function handleLearn() {
  if (store.learnState.active) return
  try {
    const jobId = await store.startLearn()
    if (!jobId) {
      ElMessage.error('学习启动失败，请稍后重试')
    }
  } catch (e: any) {
    ElMessage.error('学习启动失败：' + (e?.message || e))
  }
}

// 学习完成/失败提示
watch(
  () => store.learnState.status,
  (s) => {
    if (s === 'done') {
      ElMessage.success(`知识学习完成，共 ${store.learnState.total} 篇文档已注入智能体，可开始任务`)
    } else if (s === 'error') {
      ElMessage.error('知识学习失败：' + (store.learnState.error || '未知错误'))
    }
  }
)

// ==================== 文档查看 ====================
const searchInput = ref('')
const currentDoc = ref<KnowledgeDoc | null>(null)
const docDialogVisible = ref(false)
const hitContent = ref('')   // 搜索命中的 chunk 内容（来自搜索结果）
const isLoadingContent = ref(false)

async function handleSearch() {
  if (searchInput.value.trim()) {
    await store.search(searchInput.value, store.currentKbType === 'all' ? undefined : store.currentKbType)
  } else {
    store.clearSearch()
  }
}

async function viewDocument(doc: KnowledgeDoc, hitContentText?: string) {
  currentDoc.value = doc
  hitContent.value = hitContentText || ''
  docDialogVisible.value = true
  // 若 content 为空（从文档列表进入时），尝试读取文件内容
  if (!doc.content) {
    isLoadingContent.value = true
    try {
      const res = await fsApi.readFile(doc.path)
      if (res?.success && res.data?.content) {
        currentDoc.value = { ...doc, content: res.data.content }
      }
    } catch (e) {
      // 忽略读取失败
    } finally {
      isLoadingContent.value = false
    }
  }
}

async function handleVectorize(doc: KnowledgeDoc) {
  const success = await store.vectorizeDocument(doc.path)
  if (success) ElMessage.success('向量化成功')
  else ElMessage.error('向量化失败')
}

// ==================== 上传对话框 ====================
const uploadDialogVisible = ref(false)
const activeUploadTab = ref('local')

// 目标知识库选择
const targetKbType = ref('general')

// --- 本地文件 ---
// 类型：el-upload 的 UploadFile 对象
const localFiles = ref<any[]>([])
const localUploading = ref(false)
const localUploadRef = ref<any>(null)  // el-upload ref，用于清空文件列表

// 本地目录树
const localTreeRef = ref<any>(null)
const localTreeVisible = ref(false)
const localSelectedPaths = ref<string[]>([])
const localTreeLoadingMap = ref<Record<string, boolean>>({})

const localTreeProps = {
  label: 'name',
  children: 'children',
  isLeaf: (data: any) => data.type === 'file',
}

// 懒加载本地目录树节点
async function loadLocalTreeChildren(node: any, resolve: (children: any[]) => void) {
  const path = node.level === 0 ? '' : node.data.path
  localTreeLoadingMap.value[path] = true
  try {
    const data = await fsApi.browse(path)
    const children = (data?.items || []).map((item: any) => ({
      ...item,
      path: item.path,
      name: item.name,
      type: item.type,
      size: item.size,
      children: item.type === 'folder' ? [] : undefined,
      isLeaf: item.type === 'file',
    }))
    resolve(children)
  } catch (e: any) {
    ElMessage.error(`加载失败: ${e.message}`)
    resolve([])
  } finally {
    localTreeLoadingMap.value[path] = false
  }
}

// 初始化本地目录树
async function initLocalTree() {
  localTreeVisible.value = true
  await nextTick()
  if (localTreeRef.value) {
    localTreeRef.value.setCheckedKeys([])
    localSelectedPaths.value = []
  }
}

// 树勾选变化处理
function localHandleCheck(_data: any, checked: any) {
  const allCheckedNodes = localTreeRef.value?.getCheckedNodes() || []
  const filePathSet = new Set<string>()
  const dirPathSet = new Set<string>()
  
  function collect(nodes: any[]) {
    for (const n of nodes) {
      if (n.type === 'file') {
        filePathSet.add(n.path)
      } else {
        dirPathSet.add(n.path)
        if (n.children && n.children.length > 0) {
          collect(n.children)
        }
      }
    }
  }
  collect(allCheckedNodes)
  localSelectedPaths.value = [...Array.from(filePathSet), ...Array.from(dirPathSet)]
}

// 上传文件大小限制:单文件不超过 50MB(与后端 multer limits 一致)
const MAX_FILE_SIZE = 50 * 1024 * 1024

function handleLocalFileChange(uploadFile: any, uploadFileList: any[]) {
  // el-upload 传的是 UploadFile 对象，真正 File 在 .raw 里
  const raw = uploadFile?.raw
  if (raw && raw.size > MAX_FILE_SIZE) {
    ElMessage.error(`文件 ${raw.name || uploadFile.name} 超过 50MB 限制，已移除`)
    // 从列表中移除超限文件
    localFiles.value = uploadFileList.filter((f: any) => f.uid !== uploadFile.uid)
    return false
  }
  localFiles.value = uploadFileList
  return false
}

function handleLocalRemove(uploadFile: any) {
  localFiles.value = localFiles.value.filter(f => f.uid !== uploadFile.uid)
}

async function submitLocalFiles() {
  // 优先使用树形选择的路径
  if (localSelectedPaths.value.length > 0) {
    localUploading.value = true
    try {
      const res = await knowledgeApi.importFromPaths(localSelectedPaths.value, targetKbType.value)
      if (res) {
        ElMessage.success(`成功导入 ${localSelectedPaths.value.length} 个文件/目录`)
        uploadDialogVisible.value = false
        localSelectedPaths.value = []
        localTreeVisible.value = false
        store.loadDocuments()
      }
    } catch (e: any) {
      ElMessage.error(`导入失败: ${e.message}`)
    } finally {
      localUploading.value = false
    }
    return
  }
  
  // 否则使用直接选择的文件
  if (localFiles.value.length === 0) {
    ElMessage.warning('请先选择文件或勾选目录中的文件')
    return
  }
  localUploading.value = true
  let success = 0, fail = 0
  for (const uploadFile of localFiles.value) {
    try {
      // el-upload 的 UploadFile 对象，真正的 File 在 .raw 里
      const file = uploadFile.raw || uploadFile
      console.log('[上传] 准备上传:', file.name, file.size, 'bytes')
      console.log('[上传] targetKbType=', targetKbType.value)
      const res = await knowledgeApi.upload(file, targetKbType.value)
      console.log('[上传] 结果:', res)
      if (res.success) success++
      else {
        fail++
        ElMessage.error(`上传失败: ${file.name} — ${res.error || '未知错误'}`)
      }
    } catch (e: any) {
      fail++
      console.error('[上传] 异常:', e)
      const fileName = localFiles.value.find(f => true)?.name || '文件'
      ElMessage.error(`上传异常: ${fileName} — ${String(e)}`)
    }
  }
  localUploading.value = false
  if (fail === 0) {
    ElMessage.success(`成功上传 ${success} 个文件`)
    uploadDialogVisible.value = false
    localFiles.value = []
    localUploadRef.value?.clearFiles()  // 清空 el-upload 组件内部文件列表
    store.loadDocuments()
  } else {
    ElMessage.warning(`上传完成：${success} 成功，${fail} 失败`)
    // 部分失败时不清空，让用户可以重试失败的文件
  }
}

// --- NAS / 本地目录浏览（树形展开+勾选模式） ---
const nasTreeRef = ref<any>(null)
const nasRootPath = ref<string>('')
const nasSelectedPaths = ref<string[]>([])
const nasUploading = ref(false)
const nasTreeLoadingMap = ref<Record<string, boolean>>({})

// 树节点配置
const nasTreeProps = {
  label: 'name',
  children: 'children',
  isLeaf: (data: any) => data.type === 'file',
}

// 懒加载树节点
async function loadNasTreeChildren(node: any, resolve: (children: any[]) => void) {
  const path = node.level === 0 ? nasRootPath.value : node.data.path
  nasTreeLoadingMap.value[path] = true
  try {
    const data = await fsApi.browse(path)
    const children = (data?.items || []).map((item: any) => ({
      ...item,
      path: item.path,
      name: item.name,
      type: item.type,
      size: item.size,
      children: item.type === 'folder' ? [] : undefined,
      isLeaf: item.type === 'file',
    }))
    resolve(children)
  } catch (e: any) {
    ElMessage.error(`加载失败: ${e.message}`)
    resolve([])
  } finally {
    nasTreeLoadingMap.value[path] = false
  }
}

// 初始化 NAS 树根节点
async function initNasTree() {
  if (!nasRootPath.value) {
    try {
      const data = await fsApi.browse()
      nasRootPath.value = data?.path || ''
      // 触发树组件重新加载根节点
      nextTick(() => {
        const tree = nasTreeRef.value
        if (tree) {
          // 强制重新加载
          tree.root?.childNodes?.forEach((child: any) => tree.remove(child))
          tree.load(nasRootPath.value)
        }
      })
    } catch {
      nasRootPath.value = ''
    }
  }
}

// 监听选项卡切换，初始化对应树
watch(activeUploadTab, (tab) => {
  if (tab === 'nas') {
    initNasTree()
  } else if (tab === 'git' && gitCloned.value) {
    nextTick(() => initGitTree())
  }
})

// 树勾选变化处理
function nasHandleCheck(_data: any, checked: any) {
  const allCheckedNodes = nasTreeRef.value?.getCheckedNodes() || []
  // 收集所有勾选的文件路径
  const filePathSet = new Set<string>()
  const dirPathSet = new Set<string>()
  
  function collect(nodes: any[]) {
    for (const n of nodes) {
      if (n.type === 'file') {
        filePathSet.add(n.path)
      } else {
        dirPathSet.add(n.path)
        if (n.children && n.children.length > 0) {
          collect(n.children)
        }
      }
    }
  }
  collect(allCheckedNodes)
  
  // 合并文件和目录路径
  nasSelectedPaths.value = [...Array.from(filePathSet), ...Array.from(dirPathSet)]
}

// 提交 NAS 文件导入
async function submitNasFiles() {
  // 如果未选择任何文件/目录，默认上传整个根目录
  const pathsToImport = nasSelectedPaths.value.length > 0 
    ? nasSelectedPaths.value 
    : [nasRootPath.value]
  
  nasUploading.value = true
  try {
    const res = await knowledgeApi.importFromPaths(pathsToImport, targetKbType.value)
    if (res) {
      if (res.errors && res.errors.length > 0) {
        ElMessage.warning(`导入完成：${res.imported} 成功，${res.errors.length} 失败`)
      } else {
        const msg = nasSelectedPaths.value.length > 0 
          ? `成功导入 ${res.imported} 个文件（已选择）` 
          : `成功导入 ${res.imported} 个文件（默认全选）`
        ElMessage.success(msg)
      }
      uploadDialogVisible.value = false
      nasTreeRef.value?.setCheckedKeys([])
      nasSelectedPaths.value = []
      store.loadDocuments()
    }
  } catch (e: any) {
    ElMessage.error(`导入失败: ${e.message}`)
  } finally {
    nasUploading.value = false
  }
}

// --- Git 导入（树形展开+勾选模式）---
const gitFormRef = ref<FormInstance>()
const gitForm = ref({ url: '', branch: 'main', relPath: '', localPath: '' })
const gitCloned = ref(false)
const gitClonePath = ref('')
const gitTreeRef = ref<any>(null)
const gitTreeLoadingMap = ref<Record<string, boolean>>({})
const gitSelectedPaths = ref<string[]>([])
const gitUploading = ref(false)

// 树节点配置
const gitTreeProps = {
  label: 'name',
  children: 'children',
  isLeaf: (data: any) => data.type === 'file',
}

// 懒加载 Git 树节点
async function loadGitTreeChildren(node: any, resolve: (children: any[]) => void) {
  const path = node.level === 0 ? gitClonePath.value : node.data.path
  gitTreeLoadingMap.value[path] = true
  try {
    const data = await gitApi.listFiles(path, '')
    const children = (data?.files || []).map((item: any) => ({
      ...item,
      path: item.path,
      name: item.name,
      type: item.type,
      size: item.size,
      children: item.type === 'folder' ? [] : undefined,
      isLeaf: item.type === 'file',
    }))
    resolve(children)
  } catch (e: any) {
    ElMessage.error(`加载失败: ${e.message}`)
    resolve([])
  } finally {
    gitTreeLoadingMap.value[path] = false
  }
}

// 初始化 Git 树
function initGitTree() {
  gitTreeRef.value?.setCheckedKeys([])
  gitSelectedPaths.value = []
}

// 树勾选变化处理
function gitHandleCheck(_data: any, checked: any) {
  const allCheckedNodes = gitTreeRef.value?.getCheckedNodes() || []
  const filePathSet = new Set<string>()
  const dirPathSet = new Set<string>()
  
  function collect(nodes: any[]) {
    for (const n of nodes) {
      if (n.type === 'file') {
        filePathSet.add(n.path)
      } else {
        dirPathSet.add(n.path)
        if (n.children && n.children.length > 0) {
          collect(n.children)
        }
      }
    }
  }
  collect(allCheckedNodes)
  
  gitSelectedPaths.value = [...Array.from(filePathSet), ...Array.from(dirPathSet)]
}

const gitRules: FormRules = {
  url: [{ required: true, message: '请输入仓库URL', trigger: 'blur' }]
}

async function handleGitClone() {
  if (!gitFormRef.value) return
  await gitFormRef.value.validate(async (valid) => {
    if (!valid) return
    gitUploading.value = true
    try {
      // 使用用户指定的本地路径，或自动生成
      let clonePath = gitForm.value.localPath?.trim()
      if (!clonePath) {
        const repoName = gitForm.value.url.replace(/\.git$/, '').split('/').pop() || 'repo'
        clonePath = `~/.qclaw/git-clones/${repoName}`
      }
      const result = await gitApi.clone(gitForm.value.url, gitForm.value.branch, clonePath)
      if (result) {
        gitCloned.value = true
        gitClonePath.value = clonePath
        ElMessage.success('仓库克隆成功')
        // 延迟初始化树，等待 DOM 更新
        setTimeout(() => initGitTree(), 100)
      }
    } catch (e: any) {
      ElMessage.error(`克隆失败: ${e.message}`)
    } finally {
      gitUploading.value = false
    }
  })
}

// 选择 Git 本地路径
async function selectGitLocalPath() {
  try {
    const data = await fsApi.browse()
    if (data?.path) {
      gitForm.value.localPath = data.path
    }
  } catch (e: any) {
    ElMessage.error(`选择目录失败: ${e.message}`)
  }
}

// 提交 Git 文件导入
async function submitGitFiles() {
  // 如果未选择任何文件/目录，默认上传整个克隆的仓库
  const pathsToImport = gitSelectedPaths.value.length > 0 
    ? gitSelectedPaths.value 
    : [gitClonePath.value]
  
  gitUploading.value = true
  try {
    const res = await knowledgeApi.importFromPaths(pathsToImport, targetKbType.value)
    if (res) {
      if (res.errors && res.errors.length > 0) {
        ElMessage.warning(`导入完成：${res.imported} 成功，${res.errors.length} 失败`)
      } else {
        const msg = gitSelectedPaths.value.length > 0 
          ? `成功导入 ${res.imported} 个文件（已选择）` 
          : `成功导入 ${res.imported} 个文件（默认全选）`
        ElMessage.success(msg)
      }
      gitTreeRef.value?.setCheckedKeys([])
      gitSelectedPaths.value = []
      store.loadDocuments()
    }
  } catch (e: any) {
    ElMessage.error(`导入失败: ${e.message}`)
  } finally {
    gitUploading.value = false
  }
}

// --- 网络链接 ---
const webForm = ref({ url: '', name: '', type: 'webpage' })
const webUploading = ref(false)

// --- 凭证管理 ---
const savedCred = ref<{ git: any | null; nas: any | null }>({ git: null, nas: null })
const credSaving = ref(false)
const credVerifying = ref(false)
const gitVerifyResult = ref<{ success: boolean; message: string; detail?: string } | null>(null)
const nasVerifyResult = ref<{ success: boolean; message: string } | null>(null)
const gitCredForm = ref({ type: 'https' as 'https' | 'ssh', token: '', privateKey: '', keyPath: '' })
const nasCredForm = ref({ host: '', share: '', username: '', password: '', workgroup: '' })

async function loadSavedCredentials() {
  try {
    const cred = await credentialsApi.get()
    if (cred) {
      savedCred.value = cred
      if (cred.nas) {
        nasCredForm.value = { host: cred.nas.host || '', share: cred.nas.share || '', username: cred.nas.username || '', password: '', workgroup: cred.nas.workgroup || '' }
      }
      if (cred.git) {
        gitCredForm.value.type = cred.git.type || 'https'
        gitCredForm.value.token = cred.git.token || ''
        gitCredForm.value.keyPath = cred.git.keyPath || ''
      }
    }
  } catch (e: any) {
    console.warn('loadSavedCredentials failed:', e.message)
  }
}

async function saveGitCredential() {
  credSaving.value = true
  gitVerifyResult.value = null
  try {
    const data: any = { type: gitCredForm.value.type }
    if (gitCredForm.value.type === 'https') {
      data.token = gitCredForm.value.token
    } else {
      data.privateKey = gitCredForm.value.privateKey
      data.keyPath = gitCredForm.value.keyPath
    }
    const result = await credentialsApi.saveGit(data)
    if (result) {
      savedCred.value.git = result.git || { type: gitCredForm.value.type, hasKey: !!gitCredForm.value.privateKey }
      ElMessage.success('Git 凭证已保存')
    }
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e.message}`)
  } finally {
    credSaving.value = false
  }
}

async function verifyGitCredential() {
  credVerifying.value = true
  gitVerifyResult.value = null
  try {
    const data: any = { type: gitCredForm.value.type }
    if (gitCredForm.value.type === 'https') {
      data.token = gitCredForm.value.token
    } else {
      data.privateKey = gitCredForm.value.privateKey
      data.keyPath = gitCredForm.value.keyPath
    }
    gitVerifyResult.value = await credentialsApi.verifyGit(data)
    if (!gitVerifyResult.value!.success) ElMessage.warning(gitVerifyResult.value!.message)
  } catch (e: any) {
    gitVerifyResult.value = { success: false, message: `验证失败: ${e.message}` }
  } finally {
    credVerifying.value = false
  }
}

async function saveNasCredential() {
  credSaving.value = true
  nasVerifyResult.value = null
  try {
    const result = await credentialsApi.saveNas({
      type: 'smb',
      host: nasCredForm.value.host,
      share: nasCredForm.value.share,
      username: nasCredForm.value.username,
      password: nasCredForm.value.password,
      workgroup: nasCredForm.value.workgroup
    })
    if (result) {
      savedCred.value.nas = result.nas || { type: 'smb', host: nasCredForm.value.host, share: nasCredForm.value.share }
      ElMessage.success('NAS 凭证已保存')
    }
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e.message}`)
  } finally {
    credSaving.value = false
  }
}

async function verifyNasCredential() {
  credVerifying.value = true
  nasVerifyResult.value = null
  try {
    nasVerifyResult.value = await credentialsApi.verifyNas({
      type: 'smb',
      host: nasCredForm.value.host,
      share: nasCredForm.value.share,
      username: nasCredForm.value.username,
      password: nasCredForm.value.password,
      workgroup: nasCredForm.value.workgroup
    })
    if (!nasVerifyResult.value!.success) ElMessage.warning(nasVerifyResult.value!.message)
  } catch (e: any) {
    nasVerifyResult.value = { success: false, message: `验证失败: ${e.message}` }
  } finally {
    credVerifying.value = false
  }
}

async function removeCredential(type: 'git' | 'nas') {
  try {
    await ElMessageBox.confirm(`确定要删除${type === 'git' ? 'Git' : 'NAS'}凭证吗？`, '删除确认', { type: 'warning' })
  } catch { return }
  const ok = await credentialsApi.remove(type)
  if (ok) {
    if (type === 'git') { savedCred.value.git = null; gitCredForm.value = { type: 'https', token: '', privateKey: '', keyPath: '' }; gitVerifyResult.value = null }
    else { savedCred.value.nas = null; nasCredForm.value = { host: '', share: '', username: '', password: '', workgroup: '' }; nasVerifyResult.value = null }
    ElMessage.success('已删除')
  }
}

async function submitWebLink() {
  if (!webForm.value.url.trim()) {
    ElMessage.warning('请输入链接地址')
    return
  }
  webUploading.value = true
  try {
    // 网络链接需要后端抓取，暂时显示"功能开发中"
    ElMessage.info('网络链接抓取功能正在开发中，请先使用本地文件上传')
    webUploading.value = false
    return
  } catch (e: any) {
    ElMessage.error(`抓取失败: ${e.message}`)
  } finally {
    webUploading.value = false
  }
}

// --- 打开上传对话框 ---
function openUploadDialog() {
  activeUploadTab.value = 'local'
  targetKbType.value = 'general'
  localFiles.value = []
  nasSelectedPaths.value = []
  gitCloned.value = false
  gitClonePath.value = ''
  gitSelectedPaths.value = []
  webForm.value = { url: '', name: '', type: 'webpage' }
  uploadDialogVisible.value = true
  // 加载凭证
  loadSavedCredentials()
  // 如果当前是 NAS tab，初始化树
  if (activeUploadTab.value === 'nas') {
    initNasTree()
  }
}

// ==================== 批量删除 ====================
const selectedDocs = ref<KnowledgeDoc[]>([])

function handleSelectionChange(selection: KnowledgeDoc[]) {
  selectedDocs.value = selection
}

async function handleBatchDelete() {
  if (selectedDocs.value.length === 0) {
    ElMessage.warning('请先勾选要删除的文档')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedDocs.value.length} 个文档吗？删除后不可恢复。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const docs = selectedDocs.value.map(d => ({
    kbType: d.kbType || 'general',
    path: d.path || d.id?.replace(/^[^/]+\//, '') || d.name
  }))
  try {
    const result = await knowledgeApi.batchDelete(docs)
    if (result) {
      const { total, deleted } = result
      const failed = total - deleted
      if (failed === 0) {
        ElMessage.success(`已删除 ${deleted} 个文档`)
      } else {
        ElMessage.warning(`删除完成：${deleted} 成功，${failed} 失败`)
      }
      selectedDocs.value = []
      store.loadDocuments()
    }
  } catch (e: any) {
    ElMessage.error(`删除失败: ${e.message}`)
  }
}

// ==================== 删除文档 ====================
async function handleDeleteDoc(doc: KnowledgeDoc) {
  try {
    await ElMessageBox.confirm(
      `确定要删除「${doc.name}」吗？删除后不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }
  try {
    const docPath = doc.path || doc.id.replace(/^[^/]+\//, '')
    const kbType = doc.kbType || 'general'
    const success = await knowledgeApi.deleteDoc(kbType, docPath)
    if (success) {
      ElMessage.success(`已删除「${doc.name}」`)
      store.loadDocuments()
    } else {
      ElMessage.error('删除失败')
    }
  } catch (e: any) {
    ElMessage.error(`删除失败: ${e.message}`)
  }
}

// ==================== 解析（向量化）操作 ====================
const parseLoading = ref(false)
const parseProgress = ref('')
const parseSelectedLoading = ref(false)
const parseSelectedProgress = ref('')

async function handleBatchParse() {
  await ElMessageBox.confirm(
    '将对知识库中所有文档执行向量化解析，可能需要较长时间。是否继续？',
    '批量解析文档',
    { type: 'warning' }
  )
  parseLoading.value = true
  parseProgress.value = '正在解析中...'
  try {
    const kbType = store.currentKbType === 'all' ? undefined : store.currentKbType
    const res = await knowledgeApi.batchVectorize(kbType)
    if (res?.success) {
      ElMessage.success(`解析完成：${res.data?.processed || 0} 个文档，${res.data?.totalChunks || 0} 个知识块`)
    } else {
      ElMessage.error('解析失败')
    }
  } catch (e: any) {
    ElMessage.error(`解析失败: ${e.message}`)
  } finally {
    parseLoading.value = false
    parseProgress.value = ''
    store.loadDocuments()
  }
}

async function handleBatchParseSelected() {
  if (selectedDocs.value.length === 0) {
    ElMessage.warning('请先勾选要解析的文档')
    return
  }
  await ElMessageBox.confirm(
    `将对选中的 ${selectedDocs.value.length} 个文档执行向量化解析。是否继续？`,
    '批量解析选中文档',
    { type: 'warning' }
  )
  parseSelectedLoading.value = true
  parseSelectedProgress.value = `正在解析 ${selectedDocs.value.length} 个文档...`
  try {
    const docIds = selectedDocs.value.map(d => d.id)
    const res = await knowledgeApi.batchVectorize(undefined, docIds)
    if (res?.success) {
      ElMessage.success(`解析完成：${res.data?.processed || 0} 个文档，${res.data?.totalChunks || 0} 个知识块`)
    } else {
      ElMessage.error('解析失败')
    }
  } catch (e: any) {
    ElMessage.error(`解析失败: ${e.message}`)
  } finally {
    parseSelectedLoading.value = false
    parseSelectedProgress.value = ''
    store.loadDocuments()
  }
}

async function handleSingleParse(doc: KnowledgeDoc) {
  try {
    const success = await knowledgeApi.vectorize(doc.id)
    if (success) ElMessage.success(`${doc.name} 解析成功`)
    else ElMessage.error(`${doc.name} 解析失败`)
    store.loadDocuments()
  } catch (e: any) {
    ElMessage.error(`解析失败: ${e.message}`)
  }
}

// ==================== 工具函数 ====================
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    md: 'Document', txt: 'Document', pdf: 'Document',
    docx: 'Document', doc: 'Document', xlsx: 'Document',
    json: 'Document', csv: 'Document',
    folder: 'Folder'
  }
  return iconMap[ext || ''] || 'Document'
}

onMounted(() => { store.loadDocuments(); loadTemplates() })

// ==================== 交付件模板 ====================
const templates = ref<any[]>([])
const templatesLoading = ref(false)
const templatesExpanded = ref(false)

async function loadTemplates() {
  templatesLoading.value = true
  try {
    const res = await knowledgeApi.getDeliverableTemplates()
    templates.value = res.templates || []
  } catch (e) {
    console.error('加载模板失败', e)
  } finally {
    templatesLoading.value = false
  }
}

function downloadTemplate(format: string, templateName: string) {
  knowledgeApi.downloadTemplate(format, templateName)
}

// Agent 显示映射
const agentLabelMap: Record<string, string> = {
  'test-requirement-analyzer': '需求分析',
  'defect-analyzer': '缺陷分析',
  'test-data-generator / data-masking': '测试数据',
  'data-masking': '数据脱敏',
  'api-executor': '执行记录',
  'test-master': '测试总控',
  'ai-quality-reviewer-1/2/3': '质量审核',
}
function agentLabel(agent: string) {
  return agentLabelMap[agent] || agent || ''
}
</script>

<template>
  <div class="knowledge-view" data-testid="knowledge-page">
    <SemanticSearch @view-document="viewDocument" />

    <!-- 知识库类型标签 -->
    <div class="kb-tabs">
      <el-radio-group v-model="store.currentKbType" @change="store.setKbType">
        <el-radio-button
          v-for="kb of store.kbTypes"
          :key="kb.value"
          :value="kb.value"
        >
          <el-icon><component :is="kb.icon" /></el-icon>
          {{ kb.label }} ({{ kb.value === 'all' ? store.stats.total : store.stats[kb.value === 'project-test' ? 'projectTest' : kb.value === 'project-biz' ? 'projectBiz' : 'general'] || 0 }})
        </el-radio-button>
      </el-radio-group>
    </div>

    <!-- 统计卡片 + 操作按钮 -->
    <el-row :gutter="16" class="stats-row">
      <el-col :span="5">
        <el-card class="stat-card">
          <div class="stat-value">{{ store.stats.total }}</div>
          <div class="stat-label">文档总数</div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card class="stat-card">
          <div class="stat-value">{{ store.stats.general }}</div>
          <div class="stat-label">通用测试</div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card class="stat-card">
          <div class="stat-value">{{ store.stats.projectTest }}</div>
          <div class="stat-label">项目测试</div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card class="stat-card">
          <div class="stat-value">{{ store.stats.projectBiz }}</div>
          <div class="stat-label">项目业务</div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card class="stat-card-action" @click="openUploadDialog">
          <el-icon :size="28"><Upload /></el-icon>
          <div class="stat-label">导入文档</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 交付件模板 -->
    <el-card class="templates-card" shadow="never">
      <template #header>
        <div class="templates-header">
          <div class="templates-title">
            <el-icon><FolderOpened /></el-icon>
            <span>交付件模板</span>
            <el-tag type="info" size="small">{{ templates.length }}</el-tag>
          </div>
          <el-button size="small" text @click="templatesExpanded = !templatesExpanded">
            {{ templatesExpanded ? '收起' : '展开' }}
            <el-icon><ArrowUp v-if="templatesExpanded" /><ArrowDown v-else /></el-icon>
          </el-button>
        </div>
      </template>

      <!-- 加载状态 -->
      <div v-if="templatesLoading" class="templates-loading">
        <el-icon class="is-loading"><Loading /></el-icon> 加载中...
      </div>

      <!-- 模板列表 -->
      <div v-else-if="templates.length > 0">
        <!-- 收起时：横向滚动一行 -->
        <div v-if="!templatesExpanded" class="templates-compact">
          <div
            v-for="t in templates.slice(0, 8)"
            :key="t.name"
            class="template-chip"
          >
            <span class="template-chip-name">{{ t.name }}</span>
            <span class="template-chip-formats">{{ t.formats.join('/') }}</span>
          </div>
          <el-tag v-if="templates.length > 8" type="info" size="small">+{{ templates.length - 8 }} 更多</el-tag>
        </div>

        <!-- 展开时：网格卡片 -->
        <div v-else class="templates-grid">
          <div
            v-for="t in templates"
            :key="t.name"
            class="template-card"
          >
            <div class="template-card-name">{{ t.name }}</div>
            <div v-if="t.desc" class="template-card-desc">{{ t.desc }}</div>
            <div class="template-card-agent">
              <el-tag v-if="t.agent" size="small" type="success">{{ agentLabel(t.agent) }}</el-tag>
            </div>
            <div class="template-card-formats">
              <el-button
                v-for="fmt in t.formats"
                :key="fmt"
                size="small"
                :type="fmt === 'md' ? 'primary' : fmt === 'docx' ? '' : 'warning'"
                plain
                @click="downloadTemplate(fmt, t.name)"
              >
                <el-icon><Download /></el-icon>
                {{ fmt.toUpperCase() }}
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <el-empty v-else description="未找到交付件模板" :image-size="60" />
    </el-card>

    <!-- 操作栏 -->
    <div class="action-bar">
      <el-button type="danger" :disabled="selectedDocs.length === 0" @click="handleBatchDelete">
        <el-icon><Delete /></el-icon>
        批量删除{{ selectedDocs.length > 0 ? ` (${selectedDocs.length})` : '' }}
      </el-button>
      <el-button type="success" :disabled="selectedDocs.length === 0" :loading="parseSelectedLoading" @click="handleBatchParseSelected">
        <el-icon><MagicStick /></el-icon>
        批量解析{{ selectedDocs.length > 0 ? ` (${selectedDocs.length})` : '' }}
      </el-button>
      <el-button v-if="false" type="success" :loading="parseLoading" @click="handleBatchParse">
        <el-icon><MagicStick /></el-icon>
        {{ parseLoading ? parseProgress : '批量解析（向量化）' }}
      </el-button>
      <el-button type="primary" :loading="store.learnState.active && store.learnState.status === 'pending'" :disabled="store.learnState.active" @click="handleLearn">
        <el-icon><Reading /></el-icon>
        {{ store.learnState.active ? '学习中…' : '学习知识' }}
      </el-button>
      <span v-if="store.learnState.active" class="parse-hint">
        正在学习：{{ store.learnState.current || '准备中' }}（{{ store.learnState.done }}/{{ store.learnState.total }}）
      </span>
      <span v-else-if="store.learnState.lastLearnedAt" class="parse-hint">
        上次学习：{{ new Date(store.learnState.lastLearnedAt).toLocaleString() }}
      </span>
    </div>

    <!-- 搜索结果 -->
    <div v-if="store.searchResults.length > 0" class="search-results">
      <h3>搜索结果 ({{ store.searchResults.length }})</h3>
      <el-table :data="store.searchResults" stripe>
        <el-table-column prop="name" label="文档名称" min-width="200">
          <template #default="{ row }">
            <el-icon><component :is="getFileIcon(row.name)" /></el-icon>
            {{ row.name }}
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="120" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDocument(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 文档列表 -->
    <div v-else class="document-list">
      <el-table :data="store.filteredDocuments" stripe v-loading="store.isLoading" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="name" label="文档名称" min-width="250">
          <template #default="{ row }">
            <div class="doc-name">
              <el-icon><component :is="getFileIcon(row.name)" /></el-icon>
              <span>{{ row.name }}</span>
              <el-tag v-if="row.vectorized" type="success" size="small">已解析</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="kbType" label="知识库" width="120">
          <template #default="{ row }">
            <el-tag>{{ row.kbType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="size" label="大小" width="100">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDocument(row)">查看</el-button>
            <el-button link type="warning" @click="handleSingleParse(row)">
              {{ row.vectorized ? '重新解析' : '解析' }}
            </el-button>
            <el-button link type="danger" @click="handleDeleteDoc(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 文档详情对话框 -->
    <el-dialog v-model="docDialogVisible" :title="currentDoc?.name" width="60%">
      <div v-if="currentDoc" class="doc-detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="文件名">{{ currentDoc.name }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ currentDoc.kbType }}</el-descriptions-item>
          <el-descriptions-item label="大小">{{ formatSize(currentDoc.size) }}</el-descriptions-item>
          <el-descriptions-item label="解析状态">
            <el-tag :type="currentDoc.vectorized ? 'success' : 'info'">
              {{ currentDoc.vectorized ? '已解析' : '未解析' }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="currentDoc.content" class="doc-content">
          <h4>内容预览</h4>
          <div class="content-preview">
            <pre>{{ currentDoc.content.length > 10000 ? currentDoc.content.slice(0, 10000) + '\n\n... (内容过长，已截断)' : currentDoc.content }}</pre>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- ==================== 导入文档对话框 ==================== -->
    <el-dialog v-model="uploadDialogVisible" title="导入文档到知识库" width="720px" :close-on-click-modal="false">
      <!-- 目标知识库 -->
      <div class="upload-target">
        <span class="target-label">目标知识库：</span>
        <el-radio-group v-model="targetKbType">
          <el-radio-button label="general">通用测试</el-radio-button>
          <el-radio-button label="project-test">项目测试</el-radio-button>
          <el-radio-button label="project-biz">项目业务</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 5个来源Tab -->
      <el-tabs v-model="activeUploadTab" class="upload-tabs">
        <!-- 1. 本地文件 -->
        <el-tab-pane label="本地文件" name="local">
          <p class="tab-hint">方式1：直接选择多个文件上传。方式2：浏览本地目录，勾选特定文件。</p>
          
          <!-- 方式1：直接选择文件 -->
          <el-upload
            ref="localUploadRef"
            drag
            multiple
            :auto-upload="false"
            :on-change="handleLocalFileChange"
            :on-remove="handleLocalRemove"
            accept=".md,.txt,.pdf,.docx,.doc,.xlsx,.xls,.json,.csv,.png,.jpg,.jpeg,.gif,.bmp,.webp"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽文件到此处，或<em>点击选择文件</em></div>
            <template #tip>
              <div class="el-upload__tip">
                支持 .md .txt .pdf .docx .xlsx .json .csv .png .jpg .gif
              </div>
            </template>
          </el-upload>
          <div v-if="localFiles.length > 0" class="upload-summary">
            已选择 {{ localFiles.length }} 个文件
          </div>
          
          <!-- 方式2：浏览本地目录 -->
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px dashed #dcdfe6;">
            <el-button @click="initLocalTree" style="margin-bottom: 12px;">
              <el-icon><FolderOpened /></el-icon>
              浏览本地目录
            </el-button>
            <div v-if="localTreeVisible" class="local-tree-container" style="border:1px solid #dcdfe6; border-radius:4px; padding:8px; min-height:300px; max-height:400px; overflow:auto">
              <el-tree
                ref="localTreeRef"
                lazy
                :load="loadLocalTreeChildren"
                :props="localTreeProps"
                show-checkbox
                node-key="path"
                :default-expanded-keys="[]"
                @check="localHandleCheck"
              />
            </div>
            <div v-if="localSelectedPaths.length > 0" class="upload-summary" style="margin-top: 8px;">
              已勾选 {{ localSelectedPaths.length }} 个文件/目录
            </div>
          </div>
          
          <div class="upload-actions">
            <el-button type="primary" :loading="localUploading" @click="submitLocalFiles">
              上传到知识库
            </el-button>
          </div>
        </el-tab-pane>

        <!-- 2. NAS仓库（树形展开+勾选） -->
        <el-tab-pane label="NAS仓库" name="nas">
          <div class="nas-toolbar" style="display:flex; gap:8px; margin-bottom:12px">
            <el-input v-model="nasRootPath" size="small" placeholder="根路径（留空使用默认）" style="flex:1" @keyup.enter="initNasTree()">
              <template #prepend>根路径</template>
              <template #append>
                <el-button @click="initNasTree()">加载</el-button>
              </template>
            </el-input>
            <el-button size="small" @click="nasTreeRef?.setCheckedKeys?.([]); nasSelectedPaths = []">清空选择</el-button>
          </div>
          <div class="nas-tree-container" style="border:1px solid #dcdfe6; border-radius:4px; padding:8px; min-height:300px; max-height:400px; overflow:auto">
            <el-tree
              ref="nasTreeRef"
              lazy
              :load="loadNasTreeChildren"
              :props="nasTreeProps"
              show-checkbox
              node-key="path"
              @check="nasHandleCheck"
              :indent="20"
              style="font-size:14px"
            >
              <template #default="{ data }">
                <span class="nas-tree-node">
                  <el-icon style="margin-right:4px">
                    <component :is="data.type === 'folder' ? 'FolderOpened' : getFileIcon(data.name)" />
                  </el-icon>
                  <span>{{ data.name }}</span>
                  <span v-if="data.type === 'file'" style="color:#909399; font-size:12px; margin-left:8px">
                    {{ formatSize(data.size) }}
                  </span>
                  <el-tag v-if="data.type === 'folder'" size="small" type="info" style="margin-left:6px">目录</el-tag>
                </span>
              </template>
            </el-tree>
          </div>
          <p class="tab-hint">
            展开目录查看子文件和子目录，勾选需要导入的文件/目录。<br/>
            勾选目录将导入该目录下所有文档（含子目录）。
          </p>
          <div class="upload-actions" style="margin-top:12px">
            <el-button type="primary" :loading="nasUploading" @click="submitNasFiles" :disabled="nasSelectedPaths.length === 0">
              导入选中项（{{ nasSelectedPaths.length }} 个路径）
            </el-button>
          </div>
        </el-tab-pane>

        <!-- 3. Git 仓库 -->
        <el-tab-pane label="Git 仓库" name="git">
          <div v-if="!gitCloned">
            <el-form ref="gitFormRef" :model="gitForm" :rules="gitRules" label-width="90px">
              <el-form-item label="仓库URL" prop="url">
                <el-input v-model="gitForm.url" placeholder="https://github.com/xxx/yyy.git" />
              </el-form-item>
              <el-form-item label="分支">
                <el-input v-model="gitForm.branch" placeholder="main" />
              </el-form-item>
              <el-form-item label="本地路径">
                <el-input v-model="gitForm.localPath" placeholder="留空则自动创建（~/.qclaw/git-clones/xxx）">
                  <template #append>
                    <el-button @click="selectGitLocalPath">选择目录</el-button>
                  </template>
                </el-input>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="gitUploading" @click="handleGitClone">
                  克隆仓库
                </el-button>
              </el-form-item>
            </el-form>
          </div>
          <div v-else>
            <el-alert type="success" :closable="false" style="margin-bottom:12px">
              仓库已克隆到 {{ gitClonePath }}
            </el-alert>
            <div class="git-tree-container" style="border:1px solid #dcdfe6; border-radius:4px; padding:8px; min-height:300px; max-height:400px; overflow:auto">
              <el-tree
                ref="gitTreeRef"
                lazy
                :load="loadGitTreeChildren"
                :props="gitTreeProps"
                show-checkbox
                node-key="path"
                @check="gitHandleCheck"
                :indent="20"
                style="font-size:14px"
              >
                <template #default="{ data }">
                  <span class="git-tree-node">
                    <el-icon style="margin-right:4px">
                      <component :is="data.type === 'folder' ? 'FolderOpened' : getFileIcon(data.name)" />
                    </el-icon>
                    <span>{{ data.name }}</span>
                    <span v-if="data.type === 'file'" style="color:#909399; font-size:12px; margin-left:8px">
                      {{ formatSize(data.size) }}
                    </span>
                    <el-tag v-if="data.type === 'folder'" size="small" type="info" style="margin-left:6px">目录</el-tag>
                  </span>
                </template>
              </el-tree>
            </div>
            <p class="tab-hint">
              展开目录查看子文件和子目录，勾选需要导入的文件/目录。<br/>
              勾选目录将导入该目录下所有文档（含子目录）。
            </p>
            <div class="upload-actions" style="margin-top:12px">
              <el-button type="primary" :loading="gitUploading" :disabled="gitSelectedPaths.length === 0" @click="submitGitFiles">
                导入选中项（{{ gitSelectedPaths.length }} 个路径）
              </el-button>
              <el-button @click="gitCloned = false; gitTreeRef?.setCheckedKeys?.([]); gitSelectedPaths = []">重新克隆</el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- 4. 网络链接（已暂时屏蔽） -->
        <!--
        <el-tab-pane label="网络链接" name="web">
          <p class="tab-hint">输入网页URL或在线文档链接，系统将自动抓取内容并导入知识库。</p>
          <el-form :model="webForm" label-width="80px">
            <el-form-item label="链接类型">
              <el-radio-group v-model="webForm.type">
                <el-radio-button value="webpage">网页</el-radio-button>
                <el-radio-button value="clouddoc">云文档</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="链接地址">
              <el-input v-model="webForm.url" :placeholder="webForm.type === 'webpage' ? 'https://example.com/article' : '腾讯文档/飞书文档/语雀等链接'" />
            </el-form-item>
            <el-form-item label="文档名称">
              <el-input v-model="webForm.name" placeholder="可选，留空将自动从页面提取" />
            </el-form-item>
          </el-form>
          <div class="upload-actions">
            <el-button type="primary" :loading="webUploading" @click="submitWebLink">
              抓取并导入
            </el-button>
          </div>
        </el-tab-pane>
        -->

        <!-- 5. 云文档（已暂时屏蔽） -->
        <!--
        <el-tab-pane label="云文档" name="cloud">
          <p class="tab-hint">支持导入腾讯文档、飞书文档、语雀等在线文档。</p>
          <el-form :model="webForm" label-width="80px">
            <el-form-item label="文档链接">
              <el-input v-model="webForm.url" placeholder="粘贴云文档分享链接" />
            </el-form-item>
            <el-form-item label="文档名称">
              <el-input v-model="webForm.name" placeholder="可选" />
            </el-form-item>
          </el-form>
          <div class="upload-actions">
            <el-button type="primary" :loading="webUploading" @click="submitWebLink">
              导入云文档
            </el-button>
          </div>
        </el-tab-pane>
        -->

        <!-- 6. 账号配置 -->
        <el-tab-pane label="账号配置" name="credentials">
          <p class="tab-hint">配置 Git 和 NAS 凭证，用于访问私有仓库和共享存储。</p>
          <el-tabs tab-position="left" style="height:420px">
            <!-- Git 凭证 -->
            <el-tab-pane label="Git">
              <div style="padding:16px">
                <el-alert v-if="savedCred.git" type="success" :closable="false" show-icon style="margin-bottom:16px">
                  已保存 Git 凭证：{{ savedCred.git.type === 'https' ? 'HTTPS Token' : 'SSH Key' }}
                  <span v-if="savedCred.git.token">（Token: {{ savedCred.git.token }}）</span>
                  <span v-if="savedCred.git.hasKey">（已配置 SSH Key）</span>
                </el-alert>
                <el-form :model="gitCredForm" label-width="100px" style="max-width:500px">
                  <el-form-item label="认证方式">
                    <el-radio-group v-model="gitCredForm.type">
                      <el-radio value="https">HTTPS Token</el-radio>
                      <el-radio value="ssh">SSH Key</el-radio>
                    </el-radio-group>
                  </el-form-item>
                  <template v-if="gitCredForm.type === 'https'">
                    <el-form-item label="Personal Access Token">
                      <el-input v-model="gitCredForm.token" type="password" placeholder="ghp_xxxx 或 glpat-xxxx" show-password />
                    </el-form-item>
                  </template>
                  <template v-else>
                    <el-form-item label="私钥内容">
                      <el-input v-model="gitCredForm.privateKey" type="textarea" :rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----" />
                    </el-form-item>
                    <el-form-item label="Key 路径">
                      <el-input v-model="gitCredForm.keyPath" placeholder="~/.ssh/id_rsa（优先使用）" />
                    </el-form-item>
                  </template>
                  <el-form-item>
                    <el-button type="primary" :loading="credSaving" @click="saveGitCredential">
                      保存 Git 凭证
                    </el-button>
                    <el-button :loading="credVerifying" @click="verifyGitCredential">
                      验证连接
                    </el-button>
                    <el-button v-if="savedCred.git" type="danger" plain @click="removeCredential('git')">
                      删除凭证
                    </el-button>
                  </el-form-item>
                  <el-form-item v-if="gitVerifyResult">
                    <el-alert :type="gitVerifyResult.success ? 'success' : 'error'" :closable="false">
                      {{ gitVerifyResult.message }}
                      <div v-if="gitVerifyResult.detail" style="font-size:11px;margin-top:4px">{{ gitVerifyResult.detail }}</div>
                    </el-alert>
                  </el-form-item>
                </el-form>
              </div>
            </el-tab-pane>

            <!-- NAS 凭证 -->
            <el-tab-pane label="NAS / SMB">
              <div style="padding:16px">
                <el-alert v-if="savedCred.nas" type="success" :closable="false" show-icon style="margin-bottom:16px">
                  已保存 NAS 凭证：{{ savedCred.nas.host }}/{{ savedCred.nas.share }}
                  <span v-if="savedCred.nas.username">{{ savedCred.nas.username }}</span>
                </el-alert>
                <el-form :model="nasCredForm" label-width="100px" style="max-width:500px">
                  <el-form-item label="SMB 主机">
                    <el-input v-model="nasCredForm.host" placeholder="192.168.1.100 或 NAS主机名" />
                  </el-form-item>
                  <el-form-item label="共享名称">
                    <el-input v-model="nasCredForm.share" placeholder="share 或 Documents" />
                  </el-form-item>
                  <el-form-item label="用户名">
                    <el-input v-model="nasCredForm.username" placeholder="NAS 登录用户名" />
                  </el-form-item>
                  <el-form-item label="密码">
                    <el-input v-model="nasCredForm.password" type="password" placeholder="NAS 登录密码" show-password />
                  </el-form-item>
                  <el-form-item label="工作组">
                    <el-input v-model="nasCredForm.workgroup" placeholder="WORKGROUP（可选）" />
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" :loading="credSaving" @click="saveNasCredential">
                      保存 NAS 凭证
                    </el-button>
                    <el-button :loading="credVerifying" @click="verifyNasCredential">
                      验证连接
                    </el-button>
                    <el-button v-if="savedCred.nas" type="danger" plain @click="removeCredential('nas')">
                      删除凭证
                    </el-button>
                  </el-form-item>
                  <el-form-item v-if="nasVerifyResult">
                    <el-alert :type="nasVerifyResult.success ? 'success' : 'error'" :closable="false">
                      {{ nasVerifyResult.message }}
                    </el-alert>
                  </el-form-item>
                </el-form>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </div>
</template>

<style scoped>
.knowledge-view {
  padding: 24px;
}

.kb-tabs {
  margin-bottom: 20px;
}

.stats-row {
  margin-bottom: 16px;
}

.stat-card {
  text-align: center;
}

.stat-card-action {
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.stat-card-action:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.stat-card-action .el-icon {
  color: var(--el-color-primary);
}

.stat-value {
  font-size: 28px;
  font-weight: bold;
  color: var(--el-color-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.action-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.parse-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.doc-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.doc-detail {
  padding: 16px 0;
}

.doc-content {
  margin-top: 20px;
}

.doc-content .content-preview {
  max-height: 500px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}

.doc-content pre {
  background: var(--el-fill-color-light);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* 上传对话框 */
.upload-target {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.target-label {
  font-weight: 600;
  white-space: nowrap;
}

.upload-tabs {
  margin-top: 8px;
}

.tab-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
}

.upload-summary {
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-color-primary);
}

.upload-actions {
  margin-top: 16px;
  text-align: right;
}

/* NAS 浏览 */
.nas-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.nas-path {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  font-family: monospace;
}

.dir-name {
  cursor: pointer;
  color: var(--el-color-primary);
}

/* 交付件模板 */
.templates-card {
  margin: 16px 0;
  border: 1px solid var(--el-border-color-lighter);
}

.templates-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.templates-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.templates-loading {
  text-align: center;
  padding: 20px;
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.templates-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.template-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 16px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  cursor: default;
}

.template-chip-name {
  color: var(--el-text-color-primary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-chip-formats {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.template-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  background: var(--el-fill-color-light);
  transition: all 0.2s;
}

.template-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.template-card-name {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-card-desc {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-card-agent {
  margin-bottom: 8px;
  min-height: 22px;
}

.template-card-formats {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
