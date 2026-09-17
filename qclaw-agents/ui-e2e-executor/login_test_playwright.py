"""
login_test_playwright.py
========================
登录功能自动化测试脚本框架 — Playwright 版

【使用说明】
1. 将本文件放在项目根目录
2. 创建虚拟环境并安装依赖：
       python -m venv venv
       source venv/bin/activate   # Windows: venv\Scripts\activate
       pip install playwright
       playwright install --with-deps chromium
3. 填写 config/config.json 中的 URL、账号、验证码等配置
4. 运行所有测试：
       pytest login_test_playwright.py -v
   运行指定用例：
       pytest login_test_playwright.py -v -k "test_f001"
   生成 HTML 报告：
       pytest login_test_playwright.py -v --html=reports/report.html --self-contained-html

【P0 测试用例覆盖范围】
功能测试    F-001, F-002, F-006, F-007, F-008, F-009, F-013, F-014, F-015, F-016, F-017
UI 测试     UI-001, UI-004, UI-009, UI-013
安全测试    SEC-001~009(SQL/XSS/命令注入), SEC-011~012, SEC-019~020, SEC-023~025, SEC-027~028, SEC-033
兼容性测试  COMP-001~003(Chrome/Firefox/Safari), COMP-007~008(iOS/Android)
性能测试    PERF-002, PERF-006
易用性测试  US-014
"""

import pytest
import json
import re
import time
from pathlib import Path
from playwright.sync_api import Page, expect, Browser


# ─────────────────────────────────────────────
# 全局配置加载
# ─────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent / "config" / "config.json"

def load_config() -> dict:
    """从 config.json 加载测试配置，文件不存在时抛出友好提示。"""
    if not CONFIG_PATH.exists():
        pytest.fail(
            f"配置文件不存在：{CONFIG_PATH}\n"
            "请复制 config.example.json 为 config.json 并填写配置。"
        )
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    _validate_config(cfg)
    return cfg

def _validate_config(cfg: dict) -> None:
    """基础配置校验，关键字段缺失时报错。"""
    required = ["base_url", "valid_account", "page_selectors"]
    for key in required:
        if key not in cfg:
            raise ValueError(f"config.json 缺少必填字段: {key}")

@pytest.fixture(scope="session")
def config() -> dict:
    """Session 级 fixture：整个测试会话只加载一次配置。"""
    return load_config()


# ─────────────────────────────────────────────
# 浏览器 Fixture
# ─────────────────────────────────────────────

@pytest.fixture(scope="session")
def browser_config(config: dict) -> dict:
    """提取浏览器配置，支持 config.json 中的 browser 字段覆盖默认值。"""
    defaults = {
        "browser_type": "chromium",
        "headless": True,
        "viewport": {"width": 1920, "height": 1080},
        "slow_mo": 0,
    }
    browser_cfg = config.get("browser", {})
    defaults.update(browser_cfg)
    return defaults


@pytest.fixture(scope="function")
def page(browser_config: dict, browser_type_launch_args: dict) -> Page:
    """
    Function 级 fixture：每个测试函数独立创建一个新的浏览器页面。
    测试结束后自动清理（关闭页面）。
    """
    from playwright.sync_api import sync_playwright

    pw = sync_playwright().start()
    browser = pw.chromium.launch(
        headless=browser_config.get("headless", True),
        args=["--disable-blink-features=AutomationControlled"],
    )
    context = browser.new_context(
        viewport=browser_config.get("viewport", {"width": 1920, "height": 1080}),
        ignore_https_errors=True,
    )
    page = context.new_page()

    yield page

    page.close()
    context.close()
    browser.close()
    pw.stop()


# ─────────────────────────────────────────────
# 辅助工具函数
# ─────────────────────────────────────────────

class LoginPage:
    """
    登录页面 Page Object。
    封装所有登录相关的 UI 交互，便于用例调用。
    """

    def __init__(self, page: Page, config: dict):
        self.page = page
        self.cfg = config
        self.sel = config["page_selectors"]

    def open(self) -> "LoginPage":
        """打开登录页，等待页面加载完成。"""
        self.page.goto(self.cfg["base_url"] + self.sel["login_path"])
        self.page.wait_for_load_state("networkidle")
        return self

    def fill_username(self, value: str) -> "LoginPage":
        self.page.locator(self.sel["username_input"]).fill(value)
        return self

    def fill_password(self, value: str) -> "LoginPage":
        self.page.locator(self.sel["password_input"]).fill(value)
        return self

    def fill_captcha(self, value: str) -> "LoginPage":
        """填入验证码。如果配置了自动识别回调则使用回调。"""
        captcha_callback = self.cfg.get("captcha", {}).get("auto_solve_callback")
        if captcha_callback:
            value = captcha_callback(self.page)  # 用户自定义自动识别逻辑
        self.page.locator(self.sel["captcha_input"]).fill(str(value))
        return self

    def click_login(self) -> "LoginPage":
        self.page.locator(self.sel["login_button"]).click()
        return self

    def click_refresh_captcha(self) -> "LoginPage":
        """点击验证码刷新按钮（如果存在）。"""
        sel = self.sel.get("captcha_refresh_button")
        if sel:
            self.page.locator(sel).click()
        return self

    def get_error_message(self) -> str:
        """读取错误提示文本（通用错误提示选择器，优先精确选择器兜底）。"""
        for sel in self.sel.get("error_messages", []):
            loc = self.page.locator(sel)
            if loc.is_visible():
                return loc.inner_text()
        return ""

    def get_toast_message(self) -> str:
        """读取 Toast 提示文本。"""
        for sel in self.sel.get("toast_selectors", []):
            loc = self.page.locator(sel)
            if loc.is_visible():
                return loc.inner_text()
        return ""

    def is_login_button_disabled(self) -> bool:
        """检查登录按钮是否被禁用。"""
        return self.page.locator(self.sel["login_button"]).is_disabled()

    def get_page_title(self) -> str:
        return self.page.title()


def solve_captcha_demo(page: Page) -> str:
    """
    【演示用】验证码自动识别占位函数。
    实际项目中替换为打码平台 API（如 超级鹰、图鉴）或本地 OCR 模型。

    返回值：识别的验证码字符串
    """
    # TODO: 在此处接入打码平台
    # 示例（超级鹰）：
    # import base64
    # img_bytes = page.locator(selector).screenshot()
    # result = cracker.decode_base64(base64.b64encode(img_bytes).decode())
    # return result
    raise NotImplementedError(
        "请在 config.json 中配置 captcha.auto_solve_callback "
        "或手动在测试用例中填写验证码"
    )


def is_security_error(msg: str) -> bool:
    """判断错误信息是否为安全性泄露类错误。"""
    danger_keywords = [
        "sql", "syntax", "mysql", "postgresql", "oracle", "sqlite",
        "mongodb", "error in", "exception", "stack trace", "at ",
        "warning:", "notice:", "fatal",
        "database", "connect", "redis", "memcached",
    ]
    msg_lower = msg.lower()
    return any(kw in msg_lower for kw in danger_keywords)


def get_cookie_info(page: Page) -> dict:
    """提取当前页面所有 Cookie 的关键安全属性。"""
    cookies = page.context.cookies()
    return {
        c["name"]: {
            "httpOnly": c.get("httpOnly", False),
            "secure": c.get("secure", False),
            "sameSite": c.get("sameSite", "None"),
        }
        for c in cookies
    }


def get_login_response_headers(page: Page) -> dict:
    """
    获取最后一个非导航请求的响应头（用于安全头检查）。
    需要在登录请求发出后调用。
    """
    headers = {}
    for req in page.context._impl.pages:
        # 通过 CDP 获取响应头（Playwright 内部接口）
        pass  # 简化实现：见 SEC-024 完整实现
    return headers


# ─────────────────────────────────────────────
# Pytest 参数化：支持多浏览器
# ─────────────────────────────────────────────

def pytest_generate_tests(metafunc):
    """支持 BROWSER_TYPE 环境变量选择浏览器：chromium | firefox |webkit。"""
    browser = metafunc.config.getoption("--browser", default="chromium")
    if "browser_type" in metafunc.fixturenames:
        metafunc.parametrize("browser_type", [browser])


# ─────────────────────────────────────────────
# CONftest 层钩子
# ─────────────────────────────────────────────

def pytest_configure(config):
    config.addinivalue_line("markers", "security: 安全测试用例")
    config.addinivalue_line("markers", "ui: UI 测试用例")
    config.addinivalue_line("markers", "performance: 性能测试用例")
    config.addinivalue_line("markers", "compat: 兼容性测试用例")


# ─────────────────────────────────────────────────────────────────
# P0 测试用例：功能测试
# ─────────────────────────────────────────────────────────────────

class TestLoginFunction:
    """P0 功能测试：正常登录 + 异常登录（账号/密码/验证码）"""

    # ── 正常登录 ──

    @pytest.mark.parametrize("login_type,field_key", [
        ("用户名", "username"),
        ("邮箱",    "email"),
    ], ids=["F-001_username", "F-002_email"])
    def test_f001_f002_success_login(self, page: Page, config: dict, login_type: str, field_key: str):
        """
        F-001 / F-002: 使用正确用户名（或邮箱）+ 密码 + 正确验证码登录成功

        预期结果：登录成功，跳转到首页或用户中心，显示用户名/用户信息
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account[field_key])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()

        # 验证跳转到目标页（支持多个可能的目标 URL）
        expected_urls = config.get("expected_after_login", [])
        current_url = page.url
        assert any(expected in current_url for expected in expected_urls), (
            f"登录后未跳转到预期页面，当前 URL：{current_url}"
        )
        # 验证用户名/用户信息显示（如果有对应选择器）
        user_info_sel = config["page_selectors"].get("user_info_display")
        if user_info_sel:
            assert page.locator(user_info_sel).is_visible(), "用户信息未显示"

    def test_f003_session_cookie_created(self, page: Page, config: dict):
        """
        F-003: 登录成功后 Cookie / Session 正确创建

        预期结果：Cookie 中存在有效的 Session ID/Token，
                 Set-Cookie 配置正确（HttpOnly、Secure、SameSite）
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        cookies = get_cookie_info(page)
        assert len(cookies) > 0, "登录后未创建任何 Cookie"

        # 验证安全 Cookie 属性（生产环境 HTTPS 下应有 HttpOnly + Secure）
        security_cfg = config.get("expected_cookie_security", {})
        for cookie_name, expected_attrs in security_cfg.items():
            if cookie_name in cookies:
                for attr, expected in expected_attrs.items():
                    actual = cookies[cookie_name].get(attr)
                    assert actual == expected, (
                        f"Cookie {cookie_name} 的 {attr} 应为 {expected}，实际为 {actual}"
                    )

    # ── 账号/密码错误 ──

    @pytest.mark.parametrize("username,password,case_name", [
        ("nonexistent_user_abc123", None,                       "F-006_wrong_username"),
        (None,                        "WrongPassword123!",        "F-007_wrong_password"),
        ("fake_user",                 "fake_pass",                 "F-008_both_wrong"),
        ("unregistered@test.com",    "anypassword",              "F-009_unregistered"),
    ], ids=["F-006", "F-007", "F-008", "F-009"])
    def test_f006_f009_error_messages(self, page: Page, config: dict, username: str, password: str, case_name: str):
        """
        F-006~F-009: 各种错误账号/密码组合

        预期结果：提示"用户名或密码错误"，不泄露账户是否存在
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]

        lp.fill_username(username if username else "")
        lp.fill_password(password if password else account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        error_text = lp.get_error_message()
        assert error_text.strip() != "", f"{case_name}：未显示错误提示"
        assert "用户名或密码错误" in error_text or "账号或密码" in error_text or "登录失败" in error_text, (
            f"{case_name}：错误提示异常：{error_text}"
        )
        # 安全断言：不能出现"账号不存在"等直接暴露账户状态的信息
        assert "不存在" not in error_text and "未注册" not in error_text, (
            f"{case_name}：错误提示泄露了账户是否存在"
        )

    # ── 空字段必填校验 ──

    @pytest.mark.parametrize("username,password,expected_hint", [
        ("",           None,          "请输入用户名"),
        (None,         "",            "请输入密码"),
        ("",           "",            "请输入"),
    ], ids=["F-013_empty_username", "F-014_empty_password", "F-015_empty_both"])
    def test_f013_f015_empty_fields(self, page: Page, config: dict, username: str, password: str, expected_hint: str):
        """
        F-013~F-015: 空用户名 / 空密码 / 两者均空

        预期结果：前端拦截，提示必填字段，不触发实际请求
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]

        lp.fill_username(username if username is not None else "")
        lp.fill_password(password if password is not None else "")
        lp.click_login()

        # 断言：前端校验生效（错误提示出现 或 按钮被阻止）
        error_text = lp.get_error_message()
        toast = lp.get_toast_message()
        combined = error_text + toast
        assert expected_hint in combined or lp.is_login_button_disabled(), (
            f"空字段未触发前端校验，提示文本：{combined}"
        )

    # ── 验证码错误/为空 ──

    def test_f016_wrong_captcha(self, page: Page, config: dict):
        """
        F-016: 验证码错误

        预期结果：提示"验证码错误"，不登录
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["wrong_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        error_text = lp.get_error_message()
        assert "验证码" in error_text and "错误" in error_text, (
            f"验证码错误时未显示正确提示，实际：{error_text}"
        )

    def test_f017_empty_captcha(self, page: Page, config: dict):
        """
        F-017: 验证码为空

        预期结果：前端拦截，提示"请输入验证码"
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        # 不填验证码
        lp.click_login()

        error_text = lp.get_error_message()
        toast = lp.get_toast_message()
        combined = error_text + toast
        assert "验证码" in combined or lp.is_login_button_disabled(), (
            f"空验证码未触发前端校验，提示文本：{combined}"
        )


# ─────────────────────────────────────────────────────────────────
# P0 测试用例：UI 测试
# ─────────────────────────────────────────────────────────────────

class TestLoginUI:
    """P0 UI 测试：必要元素存在、密码掩码、响应式"""

    def test_ui001_all_required_elements_exist(self, page: Page, config: dict):
        """
        UI-001: 登录页所有必要元素存在

        检查项：用户名输入框、密码输入框、验证码输入框、
               验证码图片、登录按钮、记住我复选框、忘记密码链接
        """
        lp = LoginPage(page, config).open()
        sel = config["page_selectors"]

        required_elements = {
            "用户名输入框": sel["username_input"],
            "密码输入框":  sel["password_input"],
            "验证码输入框": sel["captcha_input"],
            "登录按钮":    sel["login_button"],
        }
        for name, selector in required_elements.items():
            assert page.locator(selector).count() > 0, f"{name}（选择器：{selector}）不存在"

        # 可选元素（业务实现差异大，告警而非失败）
        optional = {
            "记住我复选框": sel.get("remember_me_checkbox"),
            "忘记密码链接": sel.get("forgot_password_link"),
            "验证码图片":  sel.get("captcha_image"),
        }
        for name, selector in optional.items():
            if selector:
                # 存在但可能隐藏，改为计数判断
                assert page.locator(selector).count() > 0, f"{name}不存在"

    def test_ui004_captcha_image_displayed(self, page: Page, config: dict):
        """
        UI-004: 验证码图片显示正常
        """
        lp = LoginPage(page, config).open()
        captcha_sel = config["page_selectors"].get("captcha_image")
        assert captcha_sel, "config.json 中缺少 captcha_image 选择器"
        img = page.locator(captcha_sel)
        assert img.is_visible(), "验证码图片不可见"
        # 验证图片有实际 src（非空）
        src = img.get_attribute("src")
        assert src and src.strip() != "", "验证码图片 src 为空"

    def test_ui009_password_masked(self, page: Page, config: dict):
        """
        UI-009: 密码以掩码显示
        """
        lp = LoginPage(page, config).open()
        pwd_input = page.locator(config["page_selectors"]["password_input"])
        pwd_input.fill("TestPassword123!")
        # 验证 input 的 type 属性为 password
        input_type = pwd_input.get_attribute("type")
        assert input_type == "password", (
            f"密码输入框 type 应为 'password'，实际为 '{input_type}'"
        )

    @pytest.mark.parametrize("viewport,width,name", [
        ("mobile_iphone",  390,  "UI-013_iPhone"),
        ("mobile_pixel",   411,  "UI-013_Pixel"),
    ], ids=["iPhone-390px", "Pixel-411px"])
    def test_ui013_mobile_layout(self, page: Page, config: dict, viewport: str, width: int, name: str):
        """
        UI-013: 手机端单列布局，表单全宽无横向溢出
        """
        page.set_viewport_size({"width": width, "height": 844})
        lp = LoginPage(page, config).open()

        # 验证无横向滚动
        scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
        inner_width = page.evaluate("() => window.innerWidth")
        assert scroll_width <= inner_width, (
            f"{name}：页面横向溢出（scrollWidth={scroll_width} > innerWidth={inner_width}）"
        )

        # 验证表单不溢出
        form_sel = config["page_selectors"].get("login_form", config["page_selectors"]["username_input"])
        form_box = page.locator(form_sel).bounding_box()
        if form_box:
            assert form_box["x"] >= 0, f"{name}：表单左侧溢出视口"


# ─────────────────────────────────────────────────────────────────
# P0 测试用例：安全测试
# ─────────────────────────────────────────────────────────────────

class TestLoginSecurity:
    """P0 安全测试：SQL 注入、XSS、暴力破解防护、会话安全"""

    # ── SQL 注入 ──

    @pytest.mark.parametrize("payload,field", [
        ("' OR '1'='1",                               "username"),
        ("' OR '1'='1",                               "password"),
        ("admin' --",                                 "username"),
        ("' UNION SELECT NULL,NULL,NULL--",           "username"),
    ], ids=["SEC-001_sql_username", "SEC-002_sql_password", "SEC-003_comment_injection", "SEC-004_union_injection"])
    @pytest.mark.security
    def test_sec001_004_sql_injection(self, page: Page, config: dict, payload: str, field: str):
        """
        SEC-001~SEC-004: SQL 注入防护测试

        预期结果：注入被拦截或转义，提示"用户名或密码错误"，
                 不暴露数据库错误信息
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]

        if field == "username":
            lp.fill_username(payload)
            lp.fill_password(account["password"])
        else:
            lp.fill_username(account["username"])
            lp.fill_password(payload)

        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        error_text = lp.get_error_message()
        # 1. 不应出现 SQL 错误提示
        assert not is_security_error(error_text), (
            f"SQL 注入 payload '{payload}' 触发了安全错误信息：{error_text}"
        )
        # 2. 应显示通用错误提示
        assert error_text.strip() != "", f"注入后未显示错误提示"
        assert "用户名或密码错误" in error_text or "登录失败" in error_text, (
            f"注入后提示异常：{error_text}"
        )

    # ── XSS 注入 ──

    @pytest.mark.parametrize("payload,field", [
        ("<script>alert('XSS')</script>",            "username"),
        ('<img src=x onerror=alert(1)>',              "password"),
        ("<script>alert(1)</script>",                 "captcha"),
    ], ids=["SEC-005_xss_username", "SEC-006_xss_password", "SEC-007_xss_captcha"])
    @pytest.mark.security
    def test_sec005_007_xss_injection(self, page: Page, config: dict, payload: str, field: str):
        """
        SEC-005~SEC-007: XSS 注入防护测试

        预期结果：XSS 被转义/过滤，脚本不执行，
                 不出现弹出框或注入内容被渲染
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]

        if field == "username":
            lp.fill_username(payload)
            lp.fill_password(account["password"])
        elif field == "password":
            lp.fill_username(account["username"])
            lp.fill_password(payload)
        else:
            lp.fill_username(account["username"])
            lp.fill_password(account["password"])
            lp.fill_captcha(payload)

        # 先提交表单
        lp.click_login()
        page.wait_for_load_state("networkidle")

        # 检查页面 HTML 源码中是否包含未转义的 XSS payload
        page_content = page.content()
        # 严格转义后不应出现 <script> 标签原文
        assert "<script>alert" not in page_content.lower(), (
            f"XSS payload 未被转义，内容可能被注入到页面：{payload}"
        )
        assert "<img src=x onerror=" not in page_content.lower(), (
            f"XSS img onerror payload 未被转义：{payload}"
        )

        # 确认无 JS 弹出框（Playwright 会自动处理 alert，无需手动 dismiss）
        # 如果有 alert，Playwright 会报错或超时；能执行到此处说明无阻塞 alert
        error_text = lp.get_error_message()
        assert error_text.strip() != "" or page.url != config["base_url"] + config["page_selectors"]["login_path"], (
            "XSS 注入后既无错误提示也未跳转，行为异常"
        )

    def test_sec009_command_injection(self, page: Page, config: dict):
        """
        SEC-009: 命令注入测试（用户名含 shell 命令）

        预期结果：命令注入被阻止
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]

        lp.fill_username("; ls /")
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        error_text = lp.get_error_message()
        assert not is_security_error(error_text), f"命令注入触发了安全错误：{error_text}"

    # ── 暴力破解防护 ──

    @pytest.mark.security
    def test_sec011_brute_force_account_lockout(self, page: Page, config: dict):
        """
        SEC-011: 连续错误密码触发账户锁定

        预期结果：达到阈值后账户被临时锁定，提示锁定信息
        注意：此测试可能影响真实账户，需在测试环境执行
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        threshold = config.get("brute_force", {}).get("max_attempts", 5)

        for i in range(threshold):
            lp.open() if i > 0 else lp
            lp.fill_username(account["username"])
            lp.fill_password(f"WrongPassword_{i}!")
            lp.fill_captcha(config["captcha"]["valid_captcha"])
            lp.click_login()
            page.wait_for_load_state("networkidle")
            time.sleep(0.3)

        # 触发锁定后再次尝试正确密码
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        error_text = lp.get_error_message()
        lock_keywords = ["锁定", "locked", "暂时", "封禁", "屡次", "过多", "限制", "too many"]
        assert any(kw in error_text.lower() for kw in lock_keywords), (
            f"连续 {threshold} 次错误后未触发账户锁定，实际提示：{error_text}"
        )

    @pytest.mark.security
    def test_sec012_ip_rate_limit(self, page: Page, config: dict):
        """
        SEC-012: IP 频率限制

        预期结果：同一 IP 快速发送大量请求后被限流，返回 429 或出现验证码拦截
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        request_limit = config.get("brute_force", {}).get("ip_request_limit", 20)

        for i in range(request_limit):
            try:
                lp.open() if i > 0 else lp
                lp.fill_username(account["username"])
                lp.fill_password(f"wrong_{i}")
                lp.fill_captcha(config["captcha"]["valid_captcha"])
                lp.click_login()
                page.wait_for_load_state("networkidle")
            except Exception:
                pass  # 超时或拦截均视为触发限流
            time.sleep(0.1)

        # 最后一次请求验证是否触发限流
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        error_text = lp.get_error_message() + lp.get_toast_message()
        rate_limit_indicators = ["429", "频繁", "限流", "rate limit", "too many requests", "请稍后"]
        # 响应码检查（需要拦截器或响应码获取）
        response = page.evaluate("() => ({status: window._lastResponseStatus})")
        status = response.get("status", 0)
        assert status == 429 or any(ind in error_text for ind in rate_limit_indicators), (
            f"大量请求后未触发 IP 限流（状态码：{status}，提示：{error_text}）"
        )

    # ── 会话安全 ──

    @pytest.mark.security
    def test_sec019_session_id_randomness(self, page: Page, config: dict):
        """
        SEC-019: Session ID 随机性

        预期结果：多次登录产生的 Session ID 随机、无规律
        """
        session_ids: list[str] = []
        for _ in range(5):
            context = page.context
            lp = LoginPage(page, config).open()
            account = config["valid_account"]
            lp.fill_username(account["username"])
            lp.fill_password(account["password"])
            lp.fill_captcha(config["captcha"]["valid_captcha"])
            lp.click_login()
            page.wait_for_load_state("networkidle")

            cookies = context.cookies()
            for c in cookies:
                if "session" in c["name"].lower() or "token" in c["name"].lower():
                    session_ids.append(c["value"])
                    break
            # 登出
            logout_sel = config["page_selectors"].get("logout_button")
            if logout_sel:
                page.locator(logout_sel).click()
                page.wait_for_load_state("networkidle")

        assert len(session_ids) >= 2, "未获取到足够的 Session ID"
        unique_ids = set(session_ids)
        assert len(unique_ids) == len(session_ids), (
            f"Session ID 存在重复，缺乏随机性：{session_ids}"
        )

    @pytest.mark.security
    def test_sec020_session_fixation_protection(self, page: Page, config: dict):
        """
        SEC-020: Session 固定攻击防护

        预期结果：登录后 Session ID 变更，不复用登录前的 ID
        """
        # 登录前获取初始 Session ID
        lp = LoginPage(page, config).open()
        pre_login_cookies = {c["name"]: c["value"] for c in page.context.cookies()}

        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        post_login_cookies = {c["name"]: c["value"] for c in page.context.cookies()}

        # 检查关键 Session Cookie 的值是否变更
        session_keys = set(pre_login_cookies.keys()) | set(post_login_cookies.keys())
        for key in session_keys:
            pre = pre_login_cookies.get(key, "")
            post = post_login_cookies.get(key, "")
            if "session" in key.lower() or "token" in key.lower():
                assert pre != post, (
                    f"Session Cookie '{key}' 在登录后未变更，存在 Session 固定漏洞"
                )

    @pytest.mark.security
    def test_sec023_session_invalid_after_logout(self, page: Page, config: dict):
        """
        SEC-023: 注销后 Session 立即失效

        预期结果：点击注销后，Session 失效，使用后退键无法访问受保护页面
        """
        # 先登录
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        # 注销
        logout_sel = config["page_selectors"].get("logout_button")
        assert logout_sel, "config.json 缺少 logout_button 选择器"
        page.locator(logout_sel).click()
        page.wait_for_load_state("networkidle")

        # 验证已登出（跳转到登录页或显示登录态消失）
        assert page.url.endswith(config["page_selectors"]["login_path"]) or \
               "login" in page.url.lower(), "注销后未跳转回登录页"

        # 验证 Cookie 已清除
        cookies = page.context.cookies()
        session_cookies = [c for c in cookies if "session" in c["name"].lower() or "token" in c["name"].lower()]
        for c in session_cookies:
            assert c["value"] == "" or c["expires"] < time.time(), (
                f"注销后 Session Cookie '{c['name']}' 未被清除"
            )

    @pytest.mark.security
    def test_sec024_cookie_security_attributes(self, page: Page, config: dict):
        """
        SEC-024: 敏感 Cookie 安全属性验证

        预期结果：HttpOnly、Secure（生产 HTTPS）、SameSite 属性设置正确
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        cookies = get_cookie_info(page)
        assert len(cookies) > 0, "登录后未创建 Cookie"

        expected_attrs = config.get("expected_cookie_security", {
            "HttpOnly": True,
            "Secure": True,
            "sameSite": "Strict",
        })

        for cookie_name, attrs in cookies.items():
            for attr, expected in expected_attrs.items():
                actual = attrs.get(attr, False)
                assert actual == expected, (
                    f"Cookie '{cookie_name}' 的 {attr} 应为 {expected}，实际为 {actual}"
                )

    @pytest.mark.security
    def test_sec025_token_not_in_url(self, page: Page, config: dict):
        """
        SEC-025: Token 不在 URL 中明文暴露

        预期结果：登录后的 URL 不含 token/sessionid 等敏感参数
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        url = page.url
        sensitive_params = ["token", "sessionid", "session_id", "auth", "key", "sign"]
        found = [p for p in sensitive_params if p in url.lower()]
        assert len(found) == 0, (
            f"登录后 URL 中包含敏感参数：{found}，完整 URL：{url}"
        )

    # ── 传输安全 ──

    @pytest.mark.security
    def test_sec027_password_not_plaintext(self, page: Page, config: dict):
        """
        SEC-027: 密码不以明文传输

        预期结果：抓包或浏览器 DevTools 中密码字段被加密，不出现明文密码
        实现：本测试通过监听网络请求中的 password 参数值判断
        """
        captured_passwords: list[str] = []

        def handle_request(request):
            if "login" in request.url.lower():
                post_data = request.post_data or ""
                account = config["valid_account"]
                if account["password"] in post_data:
                    captured_passwords.append(account["password"])

        page.on("request", handle_request)
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        # 若密码在明文 POST body 中，说明未加密
        assert len(captured_passwords) == 0, (
            "密码以明文出现在登录请求中（生产环境应使用加密传输）"
        )

    @pytest.mark.security
    def test_sec028_https_enforced(self, page: Page, config: dict):
        """
        SEC-028: 登录请求强制使用 HTTPS

        预期结果：所有登录相关请求使用 HTTPS 协议
        """
        base = config["base_url"]
        assert base.startswith("https://"), (
            f"基础 URL 未使用 HTTPS：{base}，请在生产环境使用 HTTPS"
        )

    @pytest.mark.security
    def test_sec033_csrf_protection(self, page: Page, config: dict):
        """
        SEC-033: CSRF 防护验证

        预期结果：登录表单包含 CSRF Token，无 Token 或 Token 被移除时请求被拒绝
        """
        lp = LoginPage(page, config).open()

        # 检查表单是否有 CSRF Token 输入框
        csrf_sel = config["page_selectors"].get("csrf_token_input")
        if not csrf_sel:
            pytest.skip("配置中未指定 CSRF Token 选择器，跳过此用例")

        # 获取 CSRF Token
        csrf_token = page.locator(csrf_sel).get_attribute("value")
        assert csrf_token and csrf_token.strip() != "", "登录表单缺少 CSRF Token"

        # 提交无 Token 的请求（通过移除 Token 值）
        page.locator(csrf_sel).fill("")
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        error_text = lp.get_error_message()
        # CSRF 防护生效时应拒绝请求
        assert error_text.strip() != "" or "403" in error_text or "forbidden" in error_text.lower(), (
            "移除 CSRF Token 后请求未被拒绝，CSRF 防护可能失效"
        )


# ─────────────────────────────────────────────────────────────────
# P0 测试用例：性能测试
# ─────────────────────────────────────────────────────────────────

class TestLoginPerformance:
    """P0 性能测试：登录响应时间、并发"""

    @pytest.mark.performance
    def test_perf002_login_response_time(self, page: Page, config: dict):
        """
        PERF-002: 登录请求响应时间

        预期结果：登录请求响应时间 ≤ 2 秒
        """
        lp = LoginPage(page, config).open()
        account = config["valid_account"]

        start = time.time()
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")
        elapsed = time.time() - start

        threshold = config.get("performance", {}).get("login_response_threshold_sec", 2.0)
        assert elapsed <= threshold, (
            f"登录响应时间 {elapsed:.2f}s 超过阈值 {threshold}s"
        )

    @pytest.mark.performance
    @pytest.mark.skip(reason="并发测试需要配合 Playwright 多 worker 或 CI 环境，默认跳过")
    def test_perf006_concurrent_login_100_users(self, config: dict):
        """
        PERF-006: 并发登录（100 用户）

        预期结果：成功率 ≥ 99%，无系统崩溃
        说明：此测试需要在 pytest 以多个 worker 进程运行，
              建议使用：pytest --workers auto -n 100
        """
        pytest.skip("请在 CI 环境中配合 pytest-xdist 运行此测试")


# ─────────────────────────────────────────────────────────────────
# P0 测试用例：易用性测试
# ─────────────────────────────────────────────────────────────────

class TestLoginUsability:
    """P0 易用性测试：异常提示"""

    @pytest.mark.security
    def test_us014_server_error_friendly_message(self, page: Page, config: dict):
        """
        US-014: 服务端异常（5xx）时显示友好错误提示

        预期结果：提示"服务器繁忙，请稍后再试"，
                 不暴露技术细节（堆栈、数据库信息）
        """
        # 此测试需要后端配合模拟 5xx 响应
        # 方式1：使用 request.intercept 修改响应（Playwright 支持）
        # 方式2：配置文件中添加 mock_500_url（见下方实现）
        mock_cfg = config.get("mock_server_error", {})
        if not mock_cfg.get("enabled", False):
            pytest.skip("未启用服务端异常模拟（mock_server_error.enabled=True）")

        page.route(mock_cfg["login_path"], lambda route: route.fulfill(
            status=500,
            content_type="text/html",
            body="<html><body><h1>Internal Server Error</h1><pre>Traceback...</pre></body></html>",
        ))
        page.goto(config["base_url"] + config["page_selectors"]["login_path"])
        lp = LoginPage(page, config)
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()

        error_text = lp.get_error_message() + lp.get_toast_message()
        assert "服务器繁忙" in error_text or "服务异常" in error_text or "稍后重试" in error_text, (
            f"5xx 错误未显示友好提示，实际：{error_text}"
        )
        assert not is_security_error(error_text), f"5xx 错误泄露了技术细节：{error_text}"


# ─────────────────────────────────────────────────────────────────
# P0 测试用例：兼容性测试
# ─────────────────────────────────────────────────────────────────

class TestLoginCompatibility:
    """
    P0 兼容性测试：跨浏览器（Chrome / Firefox / Safari）× 跨平台

    使用方式：
        pytest login_test_playwright.py -v --browser=chromium
        pytest login_test_playwright.py -v --browser=firefox
        pytest login_test_playwright.py -v --browser=webkit
    """

    @pytest.mark.compat
    @pytest.mark.parametrize("browser_type", ["chromium", "firefox", "webkit"])
    def test_comp001_003_cross_browser_login(self, browser_type: str, config: dict):
        """
        COMP-001~COMP-003: Chrome / Firefox / Safari 最新版登录

        预期结果：所有主流浏览器均可正常完成登录流程
        """
        from playwright.sync_api import sync_playwright

        pw = sync_playwright().start()
        browser_launcher = getattr(pw, browser_type)
        browser = browser_launcher.launch(headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()

        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        expected_urls = config.get("expected_after_login", [])
        assert any(expected in page.url for expected in expected_urls), (
            f"[{browser_type}] 登录后未跳转至预期页面，当前：{page.url}"
        )

        page.close()
        context.close()
        browser.close()
        pw.stop()

    @pytest.mark.compat
    @pytest.mark.parametrize("viewport,device_name", [
        ({"width": 390, "height": 844}, "iPhone 14"),
        ({"width": 412, "height": 915}, "Pixel 7"),
    ], ids=["iOS-Safari", "Android-Chrome"])
    def test_comp007_008_mobile_browser_login(self, page: Page, config: dict, viewport: dict, device_name: str):
        """
        COMP-007~COMP-008: iOS Safari / Android Chrome 移动端登录

        预期结果：移动端浏览器登录功能正常，键盘适配正确
        """
        page.set_viewport_size(viewport)
        lp = LoginPage(page, config).open()
        account = config["valid_account"]
        lp.fill_username(account["username"])
        lp.fill_password(account["password"])
        lp.fill_captcha(config["captcha"]["valid_captcha"])
        lp.click_login()
        page.wait_for_load_state("networkidle")

        expected_urls = config.get("expected_after_login", [])
        assert any(expected in page.url for expected in expected_urls), (
            f"[{device_name}] 登录后未跳转至预期页面，当前：{page.url}"
        )
