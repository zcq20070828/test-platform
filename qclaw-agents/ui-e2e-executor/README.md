# 登录功能自动化测试框架

> 基于 **Python + Playwright** 的 Web 登录功能 E2E 测试脚本框架。
> 覆盖 P0 优先级测试用例（43 条），开箱即用。

---

## 📁 目录结构

```
ui-e2e-executor/
├── README.md                   ← 本文件
├── login_test_playwright.py    ← 测试脚本（所有用例）
├── config.json                 ← 配置文件（请根据实际应用填写）
├── requirements.txt            ← Python 依赖
└── reports/                    ← 测试报告输出目录（自动创建）
```

---

## ⚡ 快速开始

### 1. 安装依赖

```bash
# 创建虚拟环境（推荐）
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 安装 Playwright 浏览器驱动
playwright install --with-deps chromium
# 若需支持 Firefox/WebKit：
# playwright install firefox webkit
```

### 2. 配置测试环境

```bash
# 复制配置文件
cp config.json config.json.bak     # 备份默认配置

# 用文本编辑器填写实际应用的配置
# 必填项：base_url、valid_account、page_selectors
vim config.json
```

**关键配置说明：**

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `base_url` | 被测系统地址 | `https://staging.example.com` |
| `valid_account` | 测试账号（有效） | `{"username":"...", "password":"..."}` |
| `page_selectors` | 登录页元素选择器 | 见下方「选择器配置」章节 |
| `captcha.valid_captcha` | 可用的验证码值 | `ABCD1234` |
| `expected_after_login` | 登录成功后的 URL 关键词 | `["/home", "/dashboard"]` |

### 3. 运行测试

```bash
# 运行所有 P0 用例（详细输出）
pytest login_test_playwright.py -v

# 运行特定用例（模糊匹配）
pytest login_test_playwright.py -v -k "test_f001"

# 运行特定测试类
pytest login_test_playwright.py -v -k "TestLoginFunction"

# 使用 Firefox 浏览器
pytest login_test_playwright.py -v --browser=firefox

# 生成 HTML 报告（需安装 pytest-html）
pip install pytest-html
pytest login_test_playwright.py -v --html=reports/report.html --self-contained-html
```

---

## 📋 覆盖的 P0 测试用例

### 功能测试（11 条）

| 用例编号 | 描述 | 测试方法 |
|----------|------|----------|
| F-001 | 正确用户名+密码+验证码登录成功 | `test_f001_f002_success_login` |
| F-002 | 正确邮箱+密码+验证码登录成功 | `test_f001_f002_success_login` |
| F-003 | 登录后 Cookie/Session 正确创建 | `test_f003_session_cookie_created` |
| F-006 | 用户名错误，密码正确 | `test_f006_f009_error_messages` |
| F-007 | 用户名正确，密码错误 | `test_f006_f009_error_messages` |
| F-008 | 用户名和密码均错误 | `test_f006_f009_error_messages` |
| F-009 | 未注册账号登录 | `test_f006_f009_error_messages` |
| F-013 | 空用户名登录 | `test_f013_f015_empty_fields` |
| F-014 | 空密码登录 | `test_f013_f015_empty_fields` |
| F-015 | 用户名和密码均空 | `test_f013_f015_empty_fields` |
| F-016 | 验证码错误 | `test_f016_wrong_captcha` |
| F-017 | 验证码为空 | `test_f017_empty_captcha` |

### UI 测试（4 条）

| 用例编号 | 描述 | 测试方法 |
|----------|------|----------|
| UI-001 | 所有必要元素存在 | `test_ui001_all_required_elements_exist` |
| UI-004 | 验证码图片显示正常 | `test_ui004_captcha_image_displayed` |
| UI-009 | 密码掩码显示 | `test_ui009_password_masked` |
| UI-013 | 手机端单列布局 | `test_ui013_mobile_layout` |

### 安全测试（17 条）

| 用例编号 | 描述 | 测试方法 |
|----------|------|----------|
| SEC-001 | SQL 注入（用户名） | `test_sec001_004_sql_injection` |
| SEC-002 | SQL 注入（密码） | `test_sec001_004_sql_injection` |
| SEC-003 | SQL 注释注入 | `test_sec001_004_sql_injection` |
| SEC-004 | SQL UNION 注入 | `test_sec001_004_sql_injection` |
| SEC-005 | XSS 注入（用户名） | `test_sec005_007_xss_injection` |
| SEC-006 | XSS 注入（密码） | `test_sec005_007_xss_injection` |
| SEC-007 | XSS 注入（验证码） | `test_sec005_007_xss_injection` |
| SEC-009 | 命令注入 | `test_sec009_command_injection` |
| SEC-011 | 暴力破解—账户锁定 | `test_sec011_brute_force_account_lockout` |
| SEC-012 | 暴力破解—IP 频率限制 | `test_sec012_ip_rate_limit` |
| SEC-019 | Session ID 随机性 | `test_sec019_session_id_randomness` |
| SEC-020 | Session 固定攻击防护 | `test_sec020_session_fixation_protection` |
| SEC-023 | 注销后 Session 失效 | `test_sec023_session_invalid_after_logout` |
| SEC-024 | Cookie 安全属性 | `test_sec024_cookie_security_attributes` |
| SEC-025 | Token 不在 URL 中 | `test_sec025_token_not_in_url` |
| SEC-027 | 密码非明文传输 | `test_sec027_password_not_plaintext` |
| SEC-028 | HTTPS 强制 | `test_sec028_https_enforced` |
| SEC-033 | CSRF 防护 | `test_sec033_csrf_protection` |

### 兼容性测试（5 条）

| 用例编号 | 描述 | 测试方法 |
|----------|------|----------|
| COMP-001 | Chrome 最新版 | `test_comp001_003_cross_browser_login` |
| COMP-002 | Firefox 最新版 | `test_comp001_003_cross_browser_login` |
| COMP-003 | Safari 最新版 | `test_comp001_003_cross_browser_login` |
| COMP-007 | iOS Safari | `test_comp007_008_mobile_browser_login` |
| COMP-008 | Android Chrome | `test_comp007_008_mobile_browser_login` |

### 性能测试（2 条）

| 用例编号 | 描述 | 测试方法 |
|----------|------|----------|
| PERF-002 | 登录响应时间 ≤ 2s | `test_perf002_login_response_time` |
| PERF-006 | 并发 100 用户登录 | `test_perf006_concurrent_login_100_users`（默认跳过）|

### 易用性测试（1 条）

| 用例编号 | 描述 | 测试方法 |
|----------|------|----------|
| US-014 | 5xx 友好错误提示 | `test_us014_server_error_friendly_message` |

---

## 🔧 选择器配置

`config.json` 中的 `page_selectors` 是最关键的配置项，需要根据实际登录页 HTML 填写。

### 常见选择器示例

```json
{
  "page_selectors": {
    "username_input":    "#username, input[name='username'], [data-testid='username-input']",
    "password_input":     "#password, input[name='password'], [type='password']",
    "captcha_input":     "#captcha-code, input[name='captcha']",
    "login_button":      "button[type='submit'], .login-btn, #login-submit",
    "captcha_image":     "#captcha-img, img.captcha",
    "captcha_refresh_button": "#captcha-refresh",
    "error_messages":    [".error-msg", ".field-error", ".form-error"],
    "logout_button":     ".logout-btn, a[href='/logout']"
  }
}
```

### 如何快速获取选择器

1. **Chrome DevTools**：右键点击元素 → Copy → Copy selector
2. **Playwright Inspector**：`playwright codegen https://your-app.example.com/login`
3. **XPath 支持**：所有选择器均支持 XPath 语法（如 `//button[contains(text(),'登录')]`）

---

## 🧩 扩展指南

### 添加新的测试用例

在 `login_test_playwright.py` 对应测试类中新增方法：

```python
class TestLoginFunction:
    def test_f999_new_case(self, page: Page, config: dict):
        lp = LoginPage(page, config).open()
        # ... 测试逻辑
        assert condition, "断言失败时的提示"
```

### 接入验证码自动识别

编辑 `config.json`，设置 `captcha.auto_solve_callback`：

```python
# captcha_solver.py
def solve_captcha(page):
    # 调用打码平台 API 或本地 OCR
    import base64
    img = page.locator("#captcha-img").screenshot()
    return my_ocr_api.decode(base64.b64encode(img).decode())
```

```json
{
  "captcha": {
    "auto_solve_callback": "captcha_solver.solve_captcha"
  }
}
```

### 添加 P1/P2 用例

参考 P0 用例的写法，在 `test_f*.py` 中添加对应测试方法，并用 `@pytest.mark.parametrize` 参数化：

```python
@pytest.mark.parametrize("input_value,expected", [
    ("  user@example.com  ", "登录成功"),  # F-011: 前后空格
    ("USER@EXAMPLE.COM",    "登录成功"),  # F-010: 大小写邮箱
], ids=["F-011_trim_spaces", "F-010_case_insensitive_email"])
def test_f010_f011_edge_cases(self, page, config, input_value, expected):
    ...
```

### CI/CD 集成

**GitHub Actions 示例（`.github/workflows/login-test.yml`）：**

```yaml
name: Login E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          playwright install --with-deps chromium

      - name: Run tests
        env:
          BASE_URL: ${{ secrets.TEST_BASE_URL }}
          TEST_USERNAME: ${{ secrets.TEST_USERNAME }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
        run: |
          pytest login_test_playwright.py -v \
            --browser=chromium \
            --html=reports/report.html \
            --self-contained-html

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-report
          path: reports/report.html
```

---

## ⚠️ 注意事项

1. **环境隔离**：安全测试（暴力破解、账户锁定）应在测试/预发环境执行，避免影响真实用户
2. **验证码处理**：如需在 CI 中自动处理验证码，建议接入打码平台（超级鹰/图鉴）或部署本地 OCR 模型
3. **敏感信息**：不要将包含真实账号密码的 `config.json` 提交到代码仓库，建议使用环境变量
4. **测试顺序**：`--randomly` 插件（`pip install pytest-randomly`）可以打乱测试顺序，发现测试间依赖
5. **并发执行**：`pytest-xdist -n auto` 可并行运行测试，但注意部分用例（如暴力破解防护）不适合并发

---

## 📚 相关文档

- 测试用例设计文档：`/Users/zhaochengqing/.qclaw/workspace/test-master/login_test_cases.md`
- Playwright 官方文档：https://playwright.dev/python/
- pytest 文档：https://docs.pytest.org/

---

*本框架由 AI 辅助生成，建议根据实际业务需求补充 P1/P2 用例。*
