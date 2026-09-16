# 登录功能自动化测试执行方案

## 概述

基于《用户登录功能测试用例文档》(v1.0) 生成的 Playwright + Python 自动化测试框架。

- **测试框架：** Pytest + Playwright（支持 Chromium / Firefox / WebKit）
- **P0 用例数量：** 43 条
- **覆盖模块：** 功能测试 / UI 测试 / 安全测试 / 兼容性测试 / 性能测试 / 易用性测试

## 目录结构

```
login_automation/
├── README.md                    # 本文件
├── requirements.txt             # Python 依赖
├── conftest.py                  # Pytest 全局 Fixture（浏览器上下文、API 客户端）
├── config.py                    # 配置管理（从环境变量读取，支持 .env）
├── config.yaml                  # 测试环境配置模板（需填充实际值）
├── test_data_preparation.md     # 测试数据准备清单
├── utils/
│   ├── __init__.py
│   ├── captcha_helper.py        # 验证码处理（OCR / 手动 / Mock 模式）
│   ├── session_helper.py        # Cookie/Token 检查工具
│   └── browser_helper.py        # 浏览器窗口尺寸预设、UA 预设
├── tests/
│   ├── __init__.py
│   ├── conftest.py              # 模块级 Fixture
│   ├── test_login_functional.py # 功能测试（F-001 ~ F-046）
│   ├── test_login_ui.py         # UI 测试（UI-001 ~ UI-019）
│   ├── test_login_security.py   # 安全测试（SEC-001 ~ SEC-033）
│   ├── test_login_compatibility.py # 兼容性测试（COMP-001 ~ COMP-015）
│   ├── test_login_performance.py   # 性能测试（PERF-001 ~ PERF-014）
│   └── test_login_usability.py  # 易用性测试（US-001 ~ US-020）
├── reports/                     # 测试报告输出目录（gitignore）
└── screenshots/                 # 失败截图输出目录（gitignore）
```

## 快速开始

### 1. 安装依赖

```bash
cd login_automation
pip install -r requirements.txt
playwright install chromium  # 安装浏览器
playwright install firefox   # 可选
playwright install webkit    # 可选
```

### 2. 配置环境

复制 `config.yaml`，填入实际值：

```bash
cp config.yaml config.local.yaml
# 编辑 config.local.yaml，填入 LOGIN_URL、测试账号信息等
```

或者通过环境变量覆盖：

```bash
export LOGIN_URL="https://your-app.com/login"
export TEST_USERNAME="testuser01"
export TEST_PASSWORD="Test@Pass123"
export TEST_EMAIL="testuser01@example.com"
export CAPTCHA_MODE="manual"  # manual / mock / ocr
```

### 3. 运行测试

**运行全部 P0 用例：**

```bash
pytest tests/ -m p0 -v --headed
```

**运行特定模块：**

```bash
# 功能测试
pytest tests/test_login_functional.py -m p0 -v

# 安全测试
pytest tests/test_login_security.py -m p0 -v

# UI 测试（无头模式）
pytest tests/test_login_ui.py -m p0 -v --headless
```

**生成 HTML 报告：**

```bash
pytest tests/ -m p0 --html=reports/report.html --self-contained-html
```

**并行执行（加快速度）：**

```bash
pytest tests/ -m p0 -n 4
```

**失败自动重试：**

```bash
pytest tests/ -m p0 --reruns 2 --reruns-delay 5
```

### 4. 标记说明

| 标记 | 对应优先级 | 用例数 |
|------|-----------|--------|
| `p0` | 冒烟/阻塞 | 43 |
| `p1` | 核心功能 | 69 |
| `p2` | 常规功能 | 34 |
| `functional` | 功能测试 | 43 |
| `ui` | UI 测试 | 19 |
| `security` | 安全测试 | 33 |
| `compatibility` | 兼容性测试 | 17 |
| `performance` | 性能测试 | 14 |
| `usability` | 易用性测试 | 20 |

## 验证码处理策略

当前框架支持三种验证码处理模式（通过 `CAPTCHA_MODE` 配置）：

1. **manual（手动模式，推荐）**：启动 headed 浏览器，人工输入验证码，`pytest --headed` 运行
2. **mock（Mock 模式）**：在测试环境中通过 API 或配置跳过验证码校验（联调环境专用）
3. **ocr（OCR 模式）**：使用 ddddocr/Tesseract 自动识别简单验证码（不推荐用于复杂验证码）

## 环境要求

- Python 3.10+
- Playwright 1.51+
- macOS / Linux / Windows 均可
- 若测试 HTTPS 站点，确保证书可信任

## 注意事项

1. **首次运行必须填充 `config.local.yaml`**，否则测试将跳过或使用默认占位值
2. 图形验证码是自动化测试的主要障碍，建议在生产环境使用 manual 模式，在测试/预发布环境使用 mock 模式
3. 安全测试中的注入用例不会对数据库产生实际影响（PreparedStatement 防御），测试仅验证响应
4. 性能测试（PERF-006 ~ PERF-012）需要 JMeter 或 Locust 辅助，本框架仅提供基础响应时间监测
