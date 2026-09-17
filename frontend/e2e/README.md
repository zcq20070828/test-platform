# 测试中台 E2E 测试文档

## 测试概述

本测试套件使用 Playwright 进行端到端（E2E）测试，覆盖测试中台的核心功能和用户场景。

## 测试范围

### 1. 认证流程测试 (`app.spec.ts`)
- ✅ 登录页面显示和验证
- ✅ 空表单验证
- ✅ 无效凭据错误处理
- ✅ 注册页面显示和验证
- ✅ 未登录用户重定向

### 2. 仪表盘测试 (`app.spec.ts`)
- ✅ 欢迎信息和统计数据展示
- ✅ 统计数据正确性验证
- ✅ 导航菜单功能

### 3. 智能体管理测试 (`app.spec.ts`)
- ✅ 智能体列表显示
- ✅ 智能体卡片信息展示
- ✅ 智能体搜索功能

### 4. 知识库管理测试 (`app.spec.ts`)
- ✅ 知识库列表显示
- ✅ 文档搜索功能
- ✅ 上传按钮显示

### 5. 任务管理测试 (`app.spec.ts`)
- ✅ 任务列表显示
- ✅ 刷新功能
- ✅ 状态筛选

### 6. 工作流功能测试 (`app.spec.ts`)
- ✅ 工作流概览显示
- ✅ 阶段卡片展示
- ✅ 标签页切换
- ✅ 聊天面板显示

### 7. 核心业务流程测试 (`critical-journeys.spec.ts`)
- ✅ 完整用户旅程（注册 -> 登录 -> 使用 -> 退出）
- ✅ 创建并执行测试任务
- ✅ 知识库搜索功能
- ✅ 智能体对话交互
- ✅ 仪表盘数据实时更新
- ✅ 表单验证功能
- ✅ 路由导航功能
- ✅ 数据加载状态

### 8. API 集成测试 (`api-integration.spec.ts`)
- ✅ 认证 API 测试
- ✅ 智能体 API 测试
- ✅ 任务 API 测试
- ✅ 知识库 API 测试
- ✅ 统计 API 测试
- ✅ SSE 实时事件测试
- ✅ 数据一致性验证
- ✅ 错误处理测试

### 9. 非功能性测试
- ✅ 响应式布局测试（移动端、平板端）
- ✅ 无障碍性测试
- ✅ 性能测试（页面加载时间）
- ✅ 边界情况测试
- ✅ 错误处理测试

## 运行测试

### 前置条件

1. 确保后端服务运行在 `http://localhost:3888`
2. 确保前端服务运行在 `http://localhost:5173`（测试会自动启动）
3. 安装 Playwright 浏览器：
   ```bash
   npx playwright install chromium
   ```

### 运行所有测试

```bash
npm run test:e2e
```

### 运行特定测试文件

```bash
npx playwright test e2e/app.spec.ts
npx playwright test e2e/critical-journeys.spec.ts
npx playwright test e2e/api-integration.spec.ts
```

### 运行特定测试用例

```bash
npx playwright test -g "登录"
npx playwright test -g "智能体列表"
```

### 调试模式

```bash
# UI 模式（推荐）
npm run test:e2e:ui

# 调试模式（逐步执行）
npm run test:e2e:debug

# 有头模式（看到浏览器）
npm run test:e2e:headed
```

### 查看测试报告

```bash
npm run test:report
```

## 测试配置

### playwright.config.ts

- **测试目录**: `./e2e`
- **超时时间**: 60 秒
- **重试次数**: CI 环境下 2 次
- **并发数**: 本地 4 个，CI 1 个
- **浏览器**: Chromium
- **自动启动**: 开发服务器

### 测试账号

测试使用环境变量配置测试账号：

```bash
TEST_USER_EMAIL=admin@test.com
TEST_USER_PASSWORD=admin123
```

## Page Object Model

测试使用 Page Object Model 模式，所有页面对象定义在 `e2e/pages/index.ts`：

- `LoginPage` - 登录页面
- `RegisterPage` - 注册页面
- `DashboardPage` - 仪表盘页面
- `AgentsPage` - 智能体列表页面
- `KnowledgePage` - 知识库页面
- `TasksPage` - 任务列表页面
- `WorkflowPage` - 工作流页面
- `UserManagementPage` - 用户管理页面

## 测试数据管理

- 测试 Fixtures 定义在 `e2e/fixtures/index.ts`
- `testUser` fixture 自动生成唯一的测试用户
- `authenticatedPage` fixture 自动处理登录认证

## 最佳实践

### 1. 使用稳定的选择器

```typescript
// ✅ 好：使用角色和名称
page.getByRole('button', { name: '登录' })

// ✅ 好：使用标签
page.getByLabel('邮箱')

// ✅ 好：使用 data-testid
page.getByTestId('submit-button')

// ❌ 避免：使用 CSS 类
page.locator('.btn-primary')
```

### 2. 等待策略

```typescript
// ✅ 好：等待特定条件
await expect(element).toBeVisible()
await page.waitForLoadState('networkidle')

// ❌ 避免：固定超时
await page.waitForTimeout(3000)
```

### 3. 独立测试

每个测试应该是独立的，不依赖其他测试的结果：

```typescript
test('独立的测试', async ({ authenticatedPage }) => {
  // 测试自己的数据
  // 清理自己的状态
})
```

## 故障排查

### 测试失败

1. 查看错误截图：`test-results/` 目录
2. 查看测试追踪：`playwright-report/`
3. 使用调试模式运行：`npm run test:e2e:debug`

### 常见问题

1. **超时错误**
   - 增加超时时间
   - 检查网络连接
   - 检查后端服务状态

2. **选择器找不到元素**
   - 使用 `--headed` 模式查看页面
   - 检查元素是否真的存在
   - 使用更稳定的选择器

3. **认证失败**
   - 检查测试账号是否正确
   - 检查后端认证服务

## 持续集成

在 CI 环境中：

```yaml
- name: Run E2E tests
  run: npm run test:e2e
  env:
    CI: true
```

## 测试覆盖率目标

- 核心用户流程：100%
- 主要功能页面：> 80%
- API 集成：> 70%
- 边界情况：> 60%
