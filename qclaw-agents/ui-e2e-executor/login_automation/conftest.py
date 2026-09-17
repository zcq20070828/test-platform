"""
Pytest 全局 Fixture — P0 优先级登录测试框架。

依赖：pytest, playwright, config.py
使用前请先在 config.yaml / config.local.yaml 中配置 LOGIN_URL 和测试账号。
"""

import pytest
import time
import logging
from pathlib import Path
from typing import Dict
from playwright.sync_api import Page, Browser, BrowserContext, Playwright, expect

from config import CFG, is_ready

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---- 目录准备 ----
SCREENSHOT_DIR = Path(__file__).parent / "screenshots"
REPORT_DIR = Path(__file__).parent / "reports"
SCREENSHOT_DIR.mkdir(exist_ok=True)
REPORT_DIR.mkdir(exist_ok=True)


# ---- CLI 选项 ----
def pytest_addoption(parser):
    parser.addoption(
        "--env",
        action="store",
        default="local",
        help="测试环境名称: local / dev / staging / prod",
    )


def pytest_configure(config):
    """注册自定义标记"""
    markers = [
        "p0: P0 冒烟测试（阻塞级）",
        "p1: P1 核心功能测试",
        "p2: P2 常规功能测试",
        "functional: 功能测试",
        "ui: UI 测试",
        "security: 安全测试",
        "compatibility: 兼容性测试",
        "performance: 性能测试",
        "usability: 易用性测试",
    ]
    for marker, desc in markers:
        config.addinivalue_line("markers", marker)


# ---- 全局 Fixture ----
@pytest.fixture(scope="session")
def env(request):
    """返回测试环境名称"""
    return request.config.getoption("--env")


@pytest.fixture(scope="session")
def config():
    """返回全局配置"""
    if not is_ready():
        logger.warning(
            "⚠  配置未填充！请先配置 config.local.yaml 或设置环境变量。\n"
            "   执行测试将使用占位值，大多数用例会跳过。"
        )
    return CFG


@pytest.fixture(scope="session")
def browser_context_args(config):
    """浏览器上下文参数"""
    return {
        "viewport": config.get("browser", {}).get("viewport", {"width": 1280, "height": 800}),
        "ignore_https_errors": True,
    }


@pytest.fixture(scope="function")
def page(browser: Browser, browser_context_args) -> Page:
    """每个测试用例创建独立上下文（隔离性最好）"""
    context = browser.new_context(**browser_context_args)
    context.set_default_timeout(
        CFG.get("browser", {}).get("default_timeout", 15000)
    )
    page = context.new_page()
    page.route("**/*.{png,jpg,jpeg,gif,svg,ico}", lambda route: route.abort())
    yield page
    page.close()
    context.close()


# ---- 自定义 Fixture ----
@pytest.fixture
def login_url(config) -> str:
    """返回登录页面 URL"""
    return config.get("login_url", "https://your-app.com/login")


@pytest.fixture
def home_url(config) -> str:
    """返回登录成功跳转 URL"""
    return config.get("home_url", "https://your-app.com/dashboard")


@pytest.fixture
def valid_user(config) -> Dict[str, str]:
    """返回有效测试账号"""
    return config.get("accounts", {}).get("normal", {
        "username": "test_user",
        "email": "test@example.com",
        "password": "Test@Pass123",
    })


@pytest.fixture
def locked_user(config) -> Dict[str, str]:
    return config.get("accounts", {}).get("locked", {})


@pytest.fixture
def captcha_mode(config) -> str:
    return config.get("captcha", {}).get("mode", "manual")


# ---- 登录操作辅助函数 ----
def do_login(page: Page, login_url: str, username: str, password: str, captcha: str = None):
    """
    在登录页执行登录操作，返回是否成功提交（不含跳转判断）。

    注意：
    - 如果 CAPTCHA_MODE == 'manual'，会自动暂停等待人工输入验证码
    - 如果 CAPTCHA_MODE == 'mock'，使用配置的 mock_code 填入
    """
    page.goto(login_url)
    page.wait_for_load_state("networkidle")

    # 填写用户名
    username_input = page.locator("input[name='username'], input[name='email'], input[type='text']").first
    username_input.fill(username)

    # 填写密码
    password_input = page.locator("input[type='password']").first
    password_input.fill(password)

    # 验证码处理
    mode = CFG.get("captcha", {}).get("mode", "manual")
    if captcha:
        _fill_captcha(page, captcha)
    elif mode == "mock":
        _fill_captcha(page, CFG.get("captcha", {}).get("mock_code", "0000"))
    elif mode == "ocr":
        captcha_text = _ocr_captcha(page)
        _fill_captcha(page, captcha_text)
    # mode == "manual": 人工输入，交给用户

    # 点击登录
    submit_btn = page.locator("button[type='submit'], button:has-text('登录'), input[type='submit']").first
    submit_btn.click()


def _fill_captcha(page: Page, text: str):
    """填写验证码"""
    captcha_input = page.locator(
        "input[name='captcha'], input[name='verifyCode'], input[placeholder*='验证码']"
    ).first
    if captcha_input.is_visible():
        captcha_input.fill(text)


def _ocr_captcha(page: Page) -> str:
    """
    OCR 识别验证码（需安装 ddddocr 或 Tesseract）。
    生产环境中不推荐用于复杂验证码。
    """
    try:
        import ddddocr
        ocr = ddddocr.DdddOcr()
        captcha_img = page.locator("img[alt*='验证码'], img.captcha-img").first
        img_bytes = captcha_img.screenshot()
        result = ocr.classification(img_bytes)
        logger.info(f"[OCR] 识别验证码: {result}")
        return result
    except ImportError:
        logger.warning("[OCR] ddddocr 未安装，回退到 manual 模式")
        return ""


# ---- 失败截图 Hook ----
@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when == "call" and report.failed:
        page = item.funcargs.get("page")
        if page:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            filepath = SCREENSHOT_DIR / f"{item.name}_{timestamp}.png"
            page.screenshot(path=str(filepath))
            logger.error(f"❌ {item.name} 失败，截图已保存: {filepath}")
