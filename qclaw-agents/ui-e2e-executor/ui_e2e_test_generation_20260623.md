# 任务产物：UI自动化测试脚本 & E2E测试场景生成

## 任务目标
基于《用户登录功能测试用例 V2.1》和《用户登录功能测试需求分析 V1.1》，生成可执行的UI自动化测试脚本和E2E测试场景文档。

## 输出文件

### 1. UI自动化测试脚本
- **路径**: `/Users/zhaochengqing/.qclaw/workspace/test-master/ui_automation_login.py`
- **技术栈**: Playwright for Python + pytest + Page Object Model
- **代码量**: ~48KB，约900行

### 2. E2E测试场景文档
- **路径**: `/Users/zhaochengqing/.qclaw/workspace/test-master/e2e_test_scenarios.md`
- **场景数**: 7个完整业务流程

## 关键设计决策

### UI自动化脚本
- **Page Object Model**: 实现 `LoginPage` 类，封装5种登录方式（账号密码/手机验证码/扫码/生物识别/第三方OAuth）的所有操作
- **数据驱动**: 测试数据通过 `TEST_ACCOUNTS` 和 `TEST_PHONES` 常量集中管理
- **pytest markers**: 使用 `@pytest.mark.slow`、`@pytest.mark.manual`、`@pytest.mark.security`、`@pytest.mark.mobile` 标记分类
- **覆盖范围**:
  - TC-LOGIN-001~015: 账号密码登录（15个用例，全部自动化）
  - TC-LOGIN-016~025: 手机验证码登录（10个用例，含1个slow标记）
  - TC-LOGIN-033~047: 扫码登录（15个用例，需WebSocket Mock配合）
  - TC-LOGIN-048~058: 生物识别登录（11个用例，移动端标记）
  - TC-SECURITY-001~006: 安全测试（6个核心用例，SQL注入/XSS/暴力破解）

### E2E测试场景
- **7个场景**，覆盖P0和P1优先级:
  1. 账号密码登录→登出→重新登录 (P0, 自动化可行性:高)
  2. 手机验证码登录→验证码错误→重新获取→登录成功 (P0, 中)
  3. 扫码登录完整流程 (P0, 低)
  4. 生物识别登录→失败降级 (P0, 低)
  5. 暴力破解防护流程 (P0, 中)
  6. OAuth第三方登录流程 (P1, 中)
  7. 会话超时重新登录 (P1, 高)
- 每个场景包含：前置条件、详细步骤、预期结果、验证要点、异常分支
- 包含Mock策略建议和环境要求

## 注意事项
- `BASE_URL` 和 `data-testid` 选择器需替换为实际项目值
- 扫码和生物识别场景需Mock WebSocket事件和生物识别API
- 安全测试（暴力破解）需在隔离环境执行
- 建议CI配置: `pytest ui_automation_login.py -v -m "not slow and not manual"`
