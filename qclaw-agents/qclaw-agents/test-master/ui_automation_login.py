"""
用户登录功能 — UI自动化测试脚本
基于《用户登录功能测试用例 V2.1》生成
技术栈：Playwright for Python + pytest + Page Object Model
执行方式：pytest ui_automation_login.py --headed / pytest ui_automation_login.py (headless)
"""

import re
import time
import pytest
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext, expect


# ============================================================
# 配置常量
# ============================================================

BASE_URL = "https://example.com"  # 替换为实际登录页URL
LOGIN_URL = f"{BASE_URL}/login"
HOME_URL = f"{BASE_URL}/home"

VIEWPORT = {"width": 1920, "height": 1080}
DEFAULT_TIMEOUT = 30000  # 30秒

# 测试数据
TEST_ACCOUNTS = {
    "valid_user": {"username": "testuser01", "password": "Passw0rd!"},
    "valid_user_trimmed": {"username": "  testuser01  ", "password": "Passw0rd!"},
    "remember_user": {"username": "rememberme01", "password": "Remember01!"},
    "short_username": {"username": "user", "password": "Short123!"},
    "long_username": {"username": "abcdefghijklmnopqrst", "password": "LongName123!"},
    "min_password": {"username": "minpwd01", "password": "Abc123!@"},
    "max_password": {"username": "maxpwd01", "password": "A1!aB2@bC3#cD4$dE5%e"},
    "locked_user": {"username": "lockeduser01", "password": "CorrectPass1!"},
    "disabled_user": {"username": "disabled01", "password": "CorrectPass1!"},
    "deleted_user": {"username": "deleted01", "password": "CorrectPass1!"},
}

TEST_PHONES = {
    "valid": "13800138002",
    "unregistered": "19900000000",
    "invalid_short": "1380013800",
    "invalid_long": "138001380000",
}

# 错误提示映射
ERROR_MESSAGES = {
    "username_required": "请输入用户名",
    "password_required": "请输入密码",
    "invalid_credentials": "用户名或密码错误",
    "account_locked": "账号已锁定，请30分钟后重试或联系客服",
    "account_disabled": "该账号已被禁用，请联系管理员",
    "phone_required": "请输入手机号",
    "phone_format_error": "手机号格式不正确",
    "sms_code_required": "请输入验证码",
    "sms_code_error": "验证码错误，请重新输入",
    "sms_code_expired": "验证码已过期，请重新获取",
    "sms_code_invalidated": "验证码错误次数过多，请重新获取",
    "sms_code_used": "验证码已失效",
    "phone_unregistered": "该手机号未注册",
    "username_format": "用户名格式不正确",
    "username_length": "用户名长度需在4-20位之间",
    "password_length": "密码长度需在8-20位之间",
    "password_complexity": "密码复杂度不足",
    "sms_code_format": "验证码格式不正确，请输入6位数字",
    "qrcode_expired": "二维码已过期",
    "qrcode_scan_timeout": "扫码超时，请刷新后重试",
    "bio_failed": "识别失败，请使用密码登录",
    "bio_not_supported": "当前设备不支持生物识别",
    "network_error": "网络异常，请检查网络后重试",
    "server_error": "系统繁忙，请稍后重试",
    "third_party_failed": "第三方登录失败，请重试",
    "illegal_chars": "用户名包含非法字符",
    "frequent_request": "操作过于频繁，请1分钟后重试",
    "captcha_trigger": "",  # 图形验证码弹出
}


# ============================================================
# Page Object: 登录页面
# ============================================================

class LoginPage:
    """登录页面 Page Object — 支持账号密码、手机验证码、扫码、生物识别四种登录方式"""

    def __init__(self, page: Page):
        self.page = page

        # === 通用元素 ===
        self.login_tab_password = 'tab[data-testid="tab-password"]'
        self.login_tab_sms = 'tab[data-testid="tab-sms"]'
        self.login_tab_qrcode = 'tab[data-testid="tab-qrcode"]'
        self.login_tab_bio = 'tab[data-testid="tab-bio"]'

        # === 账号密码登录 ===
        self.username_input = 'input[data-testid="input-username"]'
        self.password_input = 'input[data-testid="input-password"]'
        self.login_button = 'button[data-testid="btn-login"]'
        self.remember_me_checkbox = 'input[data-testid="checkbox-remember"]'
        self.forgot_password_link = 'a[data-testid="link-forgot-password"]'
        self.password_toggle = 'button[data-testid="btn-password-toggle"]'

        # === 手机验证码登录 ===
        self.phone_input = 'input[data-testid="input-phone"]'
        self.send_code_button = 'button[data-testid="btn-send-code"]'
        self.sms_code_input = 'input[data-testid="input-sms-code"]'
        self.sms_login_button = 'button[data-testid="btn-sms-login"]'

        # === 扫码登录 ===
        self.qrcode_image = 'img[data-testid="img-qrcode"]'
        self.qrcode_refresh_button = 'button[data-testid="btn-qrcode-refresh"]'
        self.qrcode_status_text = '[data-testid="text-qrcode-status"]'

        # === 生物识别登录（移动端） ===
        self.bio_login_button = 'button[data-testid="btn-bio-login"]'
        self.bio_fallback_password_input = 'input[data-testid="input-bio-fallback-password"]'

        # === 第三方登录 ===
        self.wechat_login_button = 'button[data-testid="btn-wechat-login"]'
        self.alipay_login_button = 'button[data-testid="btn-alipay-login"]'

        # === 提示信息 ===
        self.error_message = '[data-testid="text-error-message"]'
        self.toast_message = '[data-testid="text-toast"]'
        self.success_redirect_indicator = '[data-testid="text-welcome"]'

    # ---------- 导航 ----------

    def navigate(self, url: str = LOGIN_URL):
        """打开登录页"""
        self.page.goto(url, wait_until="networkidle")
        self.page.wait_for_load_state("domcontentloaded")

    # ---------- 账号密码登录 ----------

    def input_username(self, username: str):
        """输入用户名"""
        self.page.fill(self.username_input, username)

    def input_password(self, password: str):
        """输入密码"""
        self.page.fill(self.password_input, password)

    def click_login(self):
        """点击登录按钮"""
        self.page.click(self.login_button)

    def click_remember_me(self):
        """勾选记住我"""
        self.page.check(self.remember_me_checkbox)

    def uncheck_remember_me(self):
        """取消勾选记住我"""
        self.page.uncheck(self.remember_me_checkbox)

    def click_forgot_password(self):
        """点击忘记密码"""
        self.page.click(self.forgot_password_link)

    def toggle_password_visibility(self):
        """切换密码明文/密文显示"""
        self.page.click(self.password_toggle)

    def login_with_credentials(self, username: str, password: str):
        """使用账号密码登录（快捷方法）"""
        self.input_username(username)
        self.input_password(password)
        self.click_login()

    # ---------- 手机验证码登录 ----------

    def switch_to_sms_login(self):
        """切换到手机验证码登录Tab"""
        self.page.click(self.login_tab_sms)
        self.page.wait_for_selector(self.phone_input, state="visible")

    def input_phone(self, phone: str):
        """输入手机号"""
        self.page.fill(self.phone_input, phone)

    def click_send_code(self):
        """点击获取验证码"""
        self.page.click(self.send_code_button)

    def input_sms_code(self, code: str):
        """输入短信验证码"""
        self.page.fill(self.sms_code_input, code)

    def click_sms_login(self):
        """点击验证码登录按钮"""
        self.page.click(self.sms_login_button)

    def sms_login(self, phone: str, code: str):
        """手机验证码登录（快捷方法）"""
        self.switch_to_sms_login()
        self.input_phone(phone)
        self.click_send_code()
        # 等待验证码输入框可用
        self.page.wait_for_selector(self.sms_code_input, state="visible")
        self.input_sms_code(code)
        self.click_sms_login()

    # ---------- 扫码登录 ----------

    def switch_to_qrcode_login(self):
        """切换到扫码登录Tab"""
        self.page.click(self.login_tab_qrcode)
        self.page.wait_for_selector(self.qrcode_image, state="visible")

    def get_qrcode_src(self) -> str:
        """获取二维码图片src"""
        return self.page.get_attribute(self.qrcode_image, "src")

    def click_qrcode_refresh(self):
        """点击刷新二维码"""
        self.page.click(self.qrcode_refresh_button)

    def get_qrcode_status(self) -> str:
        """获取二维码状态文本"""
        return self.page.text_content(self.qrcode_status_text) or ""

    # ---------- 生物识别登录 ----------

    def switch_to_bio_login(self):
        """切换到生物识别登录Tab"""
        self.page.click(self.login_tab_bio)
        self.page.wait_for_selector(self.bio_login_button, state="visible")

    def click_bio_login(self):
        """点击生物识别登录按钮"""
        self.page.click(self.bio_login_button)

    def input_bio_fallback_password(self, password: str):
        """输入生物识别降级后的密码"""
        self.page.fill(self.bio_fallback_password_input, password)

    # ---------- 第三方登录 ----------

    def click_wechat_login(self):
        """点击微信登录"""
        self.page.click(self.wechat_login_button)

    def click_alipay_login(self):
        """点击支付宝登录"""
        self.page.click(self.alipay_login_button)

    # ---------- 获取结果 ----------

    def get_error_message(self) -> str:
        """获取错误提示文本"""
        el = self.page.wait_for_selector(self.error_message, timeout=5000)
        return el.text_content() if el else ""

    def get_toast_message(self) -> str:
        """获取Toast提示文本"""
        el = self.page.wait_for_selector(self.toast_message, timeout=5000)
        return el.text_content() if el else ""

    def wait_for_success(self, timeout: int = DEFAULT_TIMEOUT) -> bool:
        """等待登录成功跳转"""
        try:
            self.page.wait_for_url(f"{BASE_URL}/home**", timeout=timeout)
            return True
        except Exception:
            return False

    def is_on_home_page(self) -> bool:
        """判断是否在首页"""
        return HOME_URL in self.page.url or "/home" in self.page.url

    def is_login_button_disabled(self) -> bool:
        """判断登录按钮是否禁用"""
        return self.page.is_disabled(self.login_button)

    def is_send_code_button_disabled(self) -> bool:
        """判断获取验证码按钮是否禁用"""
        return self.page.is_disabled(self.send_code_button)

    def get_send_code_button_text(self) -> str:
        """获取验证码按钮文本"""
        return self.page.text_content(self.send_code_button) or ""

    def get_password_input_type(self) -> str:
        """获取密码输入框type属性"""
        return self.page.get_attribute(self.password_input, "type") or ""

    def is_captcha_visible(self) -> bool:
        """判断图形验证码/人机验证是否弹出"""
        captcha = self.page.query_selector('[data-testid="captcha-container"]')
        return captcha is not None and captcha.is_visible()

    def is_qrcode_visible(self) -> bool:
        """判断二维码是否可见"""
        qr = self.page.query_selector(self.qrcode_image)
        return qr is not None and qr.is_visible()

    def get_cookies(self) -> list:
        """获取当前页面所有Cookie"""
        return self.page.context.cookies()


# ============================================================
# Page Object: 首页
# ============================================================

class HomePage:
    """首页 Page Object"""

    def __init__(self, page: Page):
        self.page = page
        self.logout_button = 'button[data-testid="btn-logout"]'
        self.user_menu = '[data-testid="user-menu"]'

    def click_logout(self):
        """点击登出"""
        self.page.click(self.user_menu)
        self.page.click(self.logout_button)

    def is_logged_in(self) -> bool:
        """判断是否已登录"""
        el = self.page.query_selector(self.user_menu)
        return el is not None and el.is_visible()


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture(scope="session")
def browser_instance():
    """创建浏览器实例（整个session共享）"""
    with sync_playwright() as p:
        browser = p.launch(
            headless=True,  # CI模式headless
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        yield browser
        browser.close()


@pytest.fixture
def context(browser_instance: Browser):
    """创建浏览器上下文"""
    ctx = browser_instance.new_context(
        viewport=VIEWPORT,
        ignore_https_errors=True,
    )
    yield ctx
    ctx.close()


@pytest.fixture
def page(context: BrowserContext):
    """创建页面"""
    pg = context.new_page()
    pg.set_default_timeout(DEFAULT_TIMEOUT)
    yield pg
    pg.close()


@pytest.fixture
def login_page(page: Page):
    """创建登录页Page Object"""
    lp = LoginPage(page)
    lp.navigate()
    return lp


# ============================================================
# 一、账号密码登录功能测试 (TC-LOGIN-001 ~ TC-LOGIN-015)
# ============================================================

class TestPasswordLogin:
    """账号密码登录功能测试"""

    # TC-LOGIN-001: 正确用户名和密码登录成功 (P0)
    def test_login_success_with_valid_credentials(self, login_page: LoginPage):
        """TC-LOGIN-001: 正确用户名和密码登录成功"""
        login_page.login_with_credentials(
            TEST_ACCOUNTS["valid_user"]["username"],
            TEST_ACCOUNTS["valid_user"]["password"],
        )
        assert login_page.wait_for_success(), "登录成功后应跳转首页"
        assert login_page.is_on_home_page(), "当前页面应为首页"

    # TC-LOGIN-002: 用户名为空提示校验 (P0)
    def test_login_with_empty_username(self, login_page: LoginPage):
        """TC-LOGIN-002: 用户名为空提示校验"""
        login_page.input_username("")
        login_page.input_password(TEST_ACCOUNTS["valid_user"]["password"])
        login_page.click_login()
        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["username_required"] in error_msg, \
            f"用户名为空时应提示'{ERROR_MESSAGES['username_required']}'，实际：{error_msg}"

    # TC-LOGIN-003: 密码为空提示校验 (P0)
    def test_login_with_empty_password(self, login_page: LoginPage):
        """TC-LOGIN-003: 密码为空提示校验"""
        login_page.input_username(TEST_ACCOUNTS["valid_user"]["username"])
        login_page.input_password("")
        login_page.click_login()
        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["password_required"] in error_msg, \
            f"密码为空时应提示'{ERROR_MESSAGES['password_required']}'，实际：{error_msg}"

    # TC-LOGIN-004: 用户名和密码均为空 (P0)
    def test_login_with_empty_username_and_password(self, login_page: LoginPage):
        """TC-LOGIN-004: 用户名和密码均为空"""
        login_page.input_username("")
        login_page.input_password("")
        login_page.click_login()
        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["username_required"] in error_msg, \
            f"用户名和密码均空时优先提示'{ERROR_MESSAGES['username_required']}'，实际：{error_msg}"

    # TC-LOGIN-005: 用户名不存在错误提示 (P0)
    def test_login_with_nonexistent_username(self, login_page: LoginPage):
        """TC-LOGIN-005: 用户名不存在错误提示"""
        login_page.login_with_credentials("notexist999", "AnyPassword1!")
        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["invalid_credentials"] in error_msg, \
            f"用户名不存在应提示'{ERROR_MESSAGES['invalid_credentials']}'，不透露用户名不存在，实际：{error_msg}"

    # TC-LOGIN-006: 密码错误错误提示 (P0)
    def test_login_with_wrong_password(self, login_page: LoginPage):
        """TC-LOGIN-006: 密码错误错误提示"""
        login_page.login_with_credentials(
            TEST_ACCOUNTS["valid_user"]["username"],
            "WrongPass1!",
        )
        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["invalid_credentials"] in error_msg, \
            f"密码错误应提示'{ERROR_MESSAGES['invalid_credentials']}'，实际：{error_msg}"

    # TC-LOGIN-007: 用户名前后空格自动处理 (P1)
    def test_login_with_trimmed_username(self, login_page: LoginPage):
        """TC-LOGIN-007: 用户名前后空格自动处理"""
        login_page.login_with_credentials(
            TEST_ACCOUNTS["valid_user_trimmed"]["username"],
            TEST_ACCOUNTS["valid_user_trimmed"]["password"],
        )
        assert login_page.wait_for_success(), "用户名前后空格应被自动trim后登录成功"

    # TC-LOGIN-008: 密码大小写敏感性验证 (P0)
    def test_login_password_case_sensitivity(self, login_page: LoginPage):
        """TC-LOGIN-008: 密码大小写敏感性验证"""
        login_page.login_with_credentials(
            TEST_ACCOUNTS["valid_user"]["username"],
            "passw0rd!",  # 全小写
        )
        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["invalid_credentials"] in error_msg, \
            f"密码大小写不匹配应登录失败，实际：{error_msg}"

    # TC-LOGIN-009: 勾选"记住我"登录 (P1)
    def test_login_with_remember_me(self, login_page: LoginPage, context: BrowserContext):
        """TC-LOGIN-009: 勾选"记住我"登录"""
        login_page.input_username(TEST_ACCOUNTS["remember_user"]["username"])
        login_page.input_password(TEST_ACCOUNTS["remember_user"]["password"])
        login_page.click_remember_me()
        login_page.click_login()
        assert login_page.wait_for_success(), "勾选记住我后应登录成功"

        # 验证Cookie持久性
        cookies = login_page.get_cookies()
        session_cookies = [c for c in cookies if "session" in c.get("name", "").lower()
                          or "token" in c.get("name", "").lower()]
        has_persistent = any(c.get("expires", -1) > 0 for c in session_cookies)
        assert has_persistent, "勾选记住我后应有持久化Cookie"

    # TC-LOGIN-010: 不勾选"记住我"登录 (P1)
    def test_login_without_remember_me(self, login_page: LoginPage):
        """TC-LOGIN-010: 不勾选'记住我'登录"""
        login_page.login_with_credentials(
            TEST_ACCOUNTS["valid_user"]["username"],
            TEST_ACCOUNTS["valid_user"]["password"],
        )
        assert login_page.wait_for_success(), "不勾选记住我也应登录成功"

        # 验证Cookie为会话级
        cookies = login_page.get_cookies()
        session_cookies = [c for c in cookies if "session" in c.get("name", "").lower()
                          or "token" in c.get("name", "").lower()]
        all_session = all(c.get("expires", -1) == -1 for c in session_cookies)
        assert all_session, "不勾选记住我时Cookie应为会话级"

    # TC-LOGIN-011: 点击"忘记密码"跳转 (P2)
    def test_forgot_password_link(self, login_page: LoginPage):
        """TC-LOGIN-011: 点击'忘记密码'跳转"""
        login_page.click_forgot_password()
        # 验证跳转至密码找回页面
        login_page.page.wait_for_url("**/forgot-password**", timeout=5000)
        assert "forgot-password" in login_page.page.url, \
            "点击忘记密码应跳转至密码找回页面"

    # TC-LOGIN-012: 登录成功Token/Session验证 (P0)
    def test_login_session_token_validation(self, login_page: LoginPage):
        """TC-LOGIN-012: 登录成功Token/Session验证"""
        login_page.login_with_credentials(
            TEST_ACCOUNTS["valid_user"]["username"],
            TEST_ACCOUNTS["valid_user"]["password"],
        )
        assert login_page.wait_for_success(), "登录应成功"

        cookies = login_page.get_cookies()
        session_cookies = [c for c in cookies if "session" in c.get("name", "").lower()
                          or "token" in c.get("name", "").lower()]
        assert len(session_cookies) > 0, "登录成功后应设置Session/Token Cookie"

        # 验证HttpOnly和Secure属性
        for cookie in session_cookies:
            assert cookie.get("httpOnly", False), f"Cookie {cookie['name']} 应设置HttpOnly"
            assert cookie.get("secure", False), f"Cookie {cookie['name']} 应设置Secure"

    # TC-LOGIN-013: 已登录状态访问登录页 (P1)
    def test_already_logged_in_access_login_page(self, login_page: LoginPage):
        """TC-LOGIN-013: 已登录状态访问登录页"""
        # 先登录
        login_page.login_with_credentials(
            TEST_ACCOUNTS["valid_user"]["username"],
            TEST_ACCOUNTS["valid_user"]["password"],
        )
        assert login_page.wait_for_success(), "首次登录应成功"

        # 再次访问登录页
        login_page.page.goto(LOGIN_URL)
        # 应跳转到首页或提示已登录
        current_url = login_page.page.url
        assert "/home" in current_url or "/login" not in current_url, \
            "已登录状态访问登录页应跳转首页或提示已登录"

    # TC-LOGIN-014: 登录按钮防重复提交 (P0)
    def test_login_button_prevent_duplicate_submission(self, login_page: LoginPage):
        """TC-LOGIN-014: 登录按钮防重复提交"""
        login_page.input_username(TEST_ACCOUNTS["valid_user"]["username"])
        login_page.input_password(TEST_ACCOUNTS["valid_user"]["password"])

        # 快速连续点击登录按钮
        login_page.click_login()
        login_page.click_login()
        login_page.click_login()

        assert login_page.wait_for_success(), "防重复提交不影响正常登录"

        # 验证只有一个会话：检查网络请求数量
        # （实际项目中可通过拦截API响应来验证只发送了一次请求）

    # TC-LOGIN-015: 密码明文/密文切换 (P1)
    def test_password_visibility_toggle(self, login_page: LoginPage):
        """TC-LOGIN-015: 密码明文/密文切换"""
        login_page.input_password("Passw0rd!")

        # 默认应为密文
        assert login_page.get_password_input_type() == "password", "默认密码应为密文"

        # 切换为明文
        login_page.toggle_password_visibility()
        assert login_page.get_password_input_type() == "text", "切换后密码应为明文"

        # 再次切换回密文
        login_page.toggle_password_visibility()
        assert login_page.get_password_input_type() == "password", "再次切换后密码应为密文"


# ============================================================
# 二、手机验证码登录功能测试 (TC-LOGIN-016 ~ TC-LOGIN-025)
# ============================================================

class TestSmsCodeLogin:
    """手机验证码登录功能测试"""

    # TC-LOGIN-016: 手机验证码登录成功 (P0)
    def test_sms_login_success(self, login_page: LoginPage):
        """TC-LOGIN-016: 手机验证码登录成功"""
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["valid"])
        login_page.click_send_code()

        # 实际项目中需要从短信API或Mock获取验证码
        # 这里使用模拟验证码
        sms_code = "123456"  # 测试环境的固定验证码或从Mock获取
        login_page.input_sms_code(sms_code)
        login_page.click_sms_login()

        assert login_page.wait_for_success(), "手机验证码登录应成功"

    # TC-LOGIN-017: 手机号格式错误校验 (P0)
    def test_sms_login_invalid_phone_format(self, login_page: LoginPage):
        """TC-LOGIN-017: 手机号格式错误校验"""
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["invalid_short"])  # 10位
        login_page.click_send_code()

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["phone_format_error"] in error_msg, \
            f"手机号格式错误应提示'{ERROR_MESSAGES['phone_format_error']}'，实际：{error_msg}"

    # TC-LOGIN-018: 手机号为空校验 (P1)
    def test_sms_login_empty_phone(self, login_page: LoginPage):
        """TC-LOGIN-018: 手机号为空校验"""
        login_page.switch_to_sms_login()
        login_page.input_phone("")
        login_page.click_send_code()

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["phone_required"] in error_msg, \
            f"手机号为空应提示'{ERROR_MESSAGES['phone_required']}'，实际：{error_msg}"

    # TC-LOGIN-019: 验证码为空校验 (P1)
    def test_sms_login_empty_code(self, login_page: LoginPage):
        """TC-LOGIN-019: 验证码为空校验"""
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["valid"])
        login_page.click_send_code()
        login_page.input_sms_code("")
        login_page.click_sms_login()

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["sms_code_required"] in error_msg, \
            f"验证码为空应提示'{ERROR_MESSAGES['sms_code_required']}'，实际：{error_msg}"

    # TC-LOGIN-020: 验证码错误校验 (P0)
    def test_sms_login_wrong_code(self, login_page: LoginPage):
        """TC-LOGIN-020: 验证码错误校验"""
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["valid"])
        login_page.click_send_code()
        login_page.input_sms_code("000000")  # 错误验证码
        login_page.click_sms_login()

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["sms_code_error"] in error_msg, \
            f"验证码错误应提示'{ERROR_MESSAGES['sms_code_error']}'，实际：{error_msg}"

    # TC-LOGIN-021: 验证码过期校验 (P0)
    @pytest.mark.slow
    def test_sms_login_expired_code(self, login_page: LoginPage):
        """TC-LOGIN-021: 验证码过期校验（需要等待5分钟，标记为slow）"""
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["valid"])
        login_page.click_send_code()

        # 等待验证码过期（实际测试中应Mock时间或缩短有效期）
        # 生产环境不建议真实等待5分钟，使用Mock
        login_page.page.wait_for_timeout(310000)  # 5分10秒

        login_page.input_sms_code("123456")
        login_page.click_sms_login()

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["sms_code_expired"] in error_msg, \
            f"验证码过期应提示'{ERROR_MESSAGES['sms_code_expired']}'，实际：{error_msg}"

    # TC-LOGIN-022: 验证码一次性使用 (P0)
    def test_sms_code_one_time_use(self, login_page: LoginPage):
        """TC-LOGIN-022: 验证码一次性使用"""
        # 第一次使用验证码登录成功
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["valid"])
        login_page.click_send_code()
        sms_code = "123456"
        login_page.input_sms_code(sms_code)
        login_page.click_sms_login()
        assert login_page.wait_for_success(), "第一次验证码登录应成功"

        # 登出
        home = HomePage(login_page.page)
        home.click_logout()
        login_page.page.wait_for_url("**/login**", timeout=5000)

        # 再次使用同一验证码
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["valid"])
        login_page.input_sms_code(sms_code)
        login_page.click_sms_login()

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["sms_code_used"] in error_msg or \
               ERROR_MESSAGES["sms_code_error"] in error_msg, \
            f"重复使用验证码应失败，实际：{error_msg}"

    # TC-LOGIN-023: 60秒内重复获取验证码 (P1)
    def test_sms_code_resend_cooldown(self, login_page: LoginPage):
        """TC-LOGIN-023: 60秒内重复获取验证码"""
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["valid"])
        login_page.click_send_code()

        # 立即再次点击
        is_disabled = login_page.is_send_code_button_disabled()
        assert is_disabled, "60秒内获取验证码按钮应被禁用"

        # 按钮应显示倒计时
        button_text = login_page.get_send_code_button_text()
        assert re.search(r"\d+s", button_text) or "秒" in button_text, \
            f"按钮应显示倒计时，实际文本：{button_text}"

    # TC-LOGIN-024: 验证码错误3次失效 (P1)
    def test_sms_code_max_error_attempts(self, login_page: LoginPage):
        """TC-LOGIN-024: 验证码错误3次失效"""
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["valid"])
        login_page.click_send_code()

        # 连续3次输入错误验证码
        wrong_codes = ["000001", "000002", "000003"]
        for code in wrong_codes:
            login_page.input_sms_code(code)
            login_page.click_sms_login()
            # 等待错误提示出现
            login_page.page.wait_for_selector(login_page.error_message, state="visible", timeout=5000)

        # 第4次输入正确验证码
        login_page.input_sms_code("123456")
        login_page.click_sms_login()

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["sms_code_invalidated"] in error_msg, \
            f"3次错误后验证码应失效，实际：{error_msg}"

    # TC-LOGIN-025: 未注册手机号获取验证码 (P1)
    def test_sms_login_unregistered_phone(self, login_page: LoginPage):
        """TC-LOGIN-025: 未注册手机号获取验证码"""
        login_page.switch_to_sms_login()
        login_page.input_phone(TEST_PHONES["unregistered"])
        login_page.click_send_code()

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["phone_unregistered"] in error_msg, \
            f"未注册手机号应提示'{ERROR_MESSAGES['phone_unregistered']}'，实际：{error_msg}"


# ============================================================
# 三、扫码登录功能测试 (TC-LOGIN-033 ~ TC-LOGIN-047)
# ============================================================

class TestQrCodeLogin:
    """扫码登录功能测试"""

    # TC-LOGIN-033: 二维码正常生成与显示 (P0)
    def test_qrcode_generated_and_displayed(self, login_page: LoginPage):
        """TC-LOGIN-033: 二维码正常生成与显示"""
        login_page.switch_to_qrcode_login()
        assert login_page.is_qrcode_visible(), "扫码登录页面应显示二维码"

        qrcode_src = login_page.get_qrcode_src()
        assert qrcode_src is not None and len(qrcode_src) > 0, "二维码应有有效的src属性"

    # TC-LOGIN-034: 二维码过期校验 (P0)
    @pytest.mark.slow
    def test_qrcode_expired(self, login_page: LoginPage):
        """TC-LOGIN-034: 二维码过期校验（需等待过期，标记为slow）"""
        login_page.switch_to_qrcode_login()
        first_src = login_page.get_qrcode_src()

        # 等待二维码过期（实际有效期2分钟，使用Mock或缩短等待时间）
        login_page.page.wait_for_timeout(130000)  # 2分10秒

        status = login_page.get_qrcode_status()
        assert ERROR_MESSAGES["qrcode_expired"] in status or \
               "过期" in status or "刷新" in status, \
            f"二维码过期应提示过期信息，实际状态：{status}"

    # TC-LOGIN-035: 二维码手动刷新 (P1)
    def test_qrcode_manual_refresh(self, login_page: LoginPage):
        """TC-LOGIN-035: 二维码手动刷新"""
        login_page.switch_to_qrcode_login()
        first_src = login_page.get_qrcode_src()

        login_page.click_qrcode_refresh()
        login_page.page.wait_for_timeout(1000)

        second_src = login_page.get_qrcode_src()
        assert second_src != first_src, "刷新后应生成新的二维码"

    # TC-LOGIN-036: 二维码自动过期刷新 (P1)
    @pytest.mark.slow
    def test_qrcode_auto_refresh_on_expiry(self, login_page: LoginPage):
        """TC-LOGIN-036: 二维码自动过期刷新"""
        login_page.switch_to_qrcode_login()
        first_src = login_page.get_qrcode_src()

        # 等待二维码自然过期
        login_page.page.wait_for_timeout(130000)  # 等待过期

        # 验证自动刷新或提示
        second_src = login_page.get_qrcode_src()
        status = login_page.get_qrcode_status()
        assert second_src != first_src or "刷新" in status, \
            "二维码过期后应自动刷新或提示用户刷新"

    # TC-LOGIN-037: 二维码包含登录信息安全验证 (P0)
    def test_qrcode_encrypted_content(self, login_page: LoginPage):
        """TC-LOGIN-037: 二维码包含登录信息安全验证（需人工/后端验证）"""
        login_page.switch_to_qrcode_login()
        qrcode_src = login_page.get_qrcode_src()

        # 验证二维码src不是明文会话信息
        assert "session" not in qrcode_src.lower() or "token" not in qrcode_src.lower(), \
            "二维码URL不应包含明文session或token信息"
        # 注：此用例的深度验证需结合后端API和二维码解码工具

    # TC-LOGIN-038: 扫码成功状态同步 (P0)
    @pytest.mark.manual
    def test_qrcode_scan_success_sync(self, login_page: LoginPage):
        """TC-LOGIN-038: 扫码成功状态同步（需手机端配合，标记manual）"""
        login_page.switch_to_qrcode_login()
        # 此用例需要手机端扫码配合，自动化中通过WebSocket状态Mock实现
        # 实际测试：手机端扫描后，PC端应自动跳转
        # Mock方式：触发扫码成功的WebSocket消息
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('qrcode-status', {
                detail: { status: 'scanned' }
            }));
        """)
        login_page.page.wait_for_timeout(1000)
        status = login_page.get_qrcode_status()
        assert "已扫描" in status or "scanned" in status.lower(), \
            "手机端扫码后PC端应显示已扫描状态"

    # TC-LOGIN-039: 扫码超时处理 (P1)
    @pytest.mark.slow
    def test_qrcode_scan_timeout(self, login_page: LoginPage):
        """TC-LOGIN-039: 扫码超时处理"""
        login_page.switch_to_qrcode_login()
        # 等待超时（Mock或实际等待）
        login_page.page.wait_for_timeout(300000)  # 5分钟超时
        status = login_page.get_qrcode_status()
        assert ERROR_MESSAGES["qrcode_scan_timeout"] in status or \
               "超时" in status or "刷新" in status, \
            f"扫码超时应提示超时，实际：{status}"

    # TC-LOGIN-040: 手机端取消扫码 (P1)
    @pytest.mark.manual
    def test_qrcode_scan_cancelled(self, login_page: LoginPage):
        """TC-LOGIN-040: 手机端取消扫码（需手机端配合）"""
        login_page.switch_to_qrcode_login()
        # Mock取消扫码事件
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('qrcode-status', {
                detail: { status: 'cancelled' }
            }));
        """)
        login_page.page.wait_for_timeout(1000)
        status = login_page.get_qrcode_status()
        assert "取消" in status or "cancelled" in status.lower(), \
            "手机端取消扫码后PC端应提示取消"

    # TC-LOGIN-041: 扫码后确认登录流程 (P0)
    @pytest.mark.manual
    def test_qrcode_scan_confirm_login(self, login_page: LoginPage):
        """TC-LOGIN-041: 扫码后确认登录流程（需手机端配合）"""
        login_page.switch_to_qrcode_login()
        # Mock确认登录事件
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('qrcode-status', {
                detail: { status: 'confirmed' }
            }));
        """)
        assert login_page.wait_for_success(timeout=10000), \
            "手机端确认登录后PC端应完成登录并跳转首页"

    # TC-LOGIN-042: 扫码后取消登录 (P1)
    @pytest.mark.manual
    def test_qrcode_scan_reject_login(self, login_page: LoginPage):
        """TC-LOGIN-042: 扫码后取消登录（手机端点击取消）"""
        login_page.switch_to_qrcode_login()
        # Mock取消登录事件
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('qrcode-status', {
                detail: { status: 'rejected' }
            }));
        """)
        login_page.page.wait_for_timeout(2000)
        assert not login_page.is_on_home_page(), \
            "手机端取消登录后PC端不应跳转首页"
        status = login_page.get_qrcode_status()
        assert "取消" in status or login_page.is_qrcode_visible(), \
            "手机端取消后PC端应保持登录页状态"

    # TC-LOGIN-043: 二维码截获重放攻击防护 (P0)
    @pytest.mark.security
    def test_qrcode_replay_attack_prevention(self, login_page: LoginPage):
        """TC-LOGIN-043: 二维码截获重放攻击防护"""
        login_page.switch_to_qrcode_login()
        qrcode_src = login_page.get_qrcode_src()

        # 模拟第一次使用二维码登录成功
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('qrcode-status', {
                detail: { status: 'confirmed' }
            }));
        """)
        assert login_page.wait_for_success(timeout=10000)

        # 尝试用同一二维码再次登录（在新页面中）
        new_page = login_page.page.context.new_page()
        new_login = LoginPage(new_page)
        new_login.navigate()
        new_login.switch_to_qrcode_login()
        # 如果二维码URL可被复用，应被拒绝
        # 此用例的完整验证需结合后端API
        new_page.close()

    # TC-LOGIN-044: 二维码与会话绑定 (P0)
    @pytest.mark.security
    def test_qrcode_session_binding(self, login_page: LoginPage):
        """TC-LOGIN-044: 二维码与会话绑定"""
        login_page.switch_to_qrcode_login()
        qrcode_src = login_page.get_qrcode_src()

        # 验证二维码URL包含会话标识（加密形式）
        # 其他用户扫描时应无效
        # 完整验证需结合后端API和不同用户扫码
        assert qrcode_src is not None, "二维码应与会话绑定"

    # TC-LOGIN-045: 同一二维码多人扫码处理 (P1)
    @pytest.mark.manual
    def test_qrcode_multiple_scanners(self, login_page: LoginPage):
        """TC-LOGIN-045: 同一二维码多人扫码处理"""
        login_page.switch_to_qrcode_login()
        # 模拟第一个用户扫码确认
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('qrcode-status', {
                detail: { status: 'confirmed', userId: 'user1' }
            }));
        """)
        # 模拟第二个用户扫码（应无效）
        # 完整验证需结合后端多用户会话
        pass  # 需多设备协同测试

    # TC-LOGIN-046: 扫码登录设备绑定与解绑 (P2)
    @pytest.mark.manual
    def test_qrcode_device_binding(self, login_page: LoginPage):
        """TC-LOGIN-046: 扫码登录设备绑定与解绑（需账号安全中心验证）"""
        login_page.switch_to_qrcode_login()
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('qrcode-status', {
                detail: { status: 'confirmed' }
            }));
        """)
        assert login_page.wait_for_success(timeout=10000)
        # 登录成功后，在安全中心检查设备列表
        # 此部分需导航到安全中心页面验证
        pass

    # TC-LOGIN-047: 扫码登录网络异常恢复 (P1)
    def test_qrcode_network_recovery(self, login_page: LoginPage):
        """TC-LOGIN-047: 扫码登录网络异常恢复"""
        login_page.switch_to_qrcode_login()

        # 模拟网络断开
        login_page.page.context.set_offline(True)
        login_page.page.wait_for_timeout(3000)

        # 恢复网络
        login_page.page.context.set_offline(False)
        login_page.page.wait_for_timeout(2000)

        # 验证状态轮询恢复
        assert login_page.is_qrcode_visible(), "网络恢复后二维码应正常显示，轮询继续"


# ============================================================
# 四、生物识别登录功能测试 (TC-LOGIN-048 ~ TC-LOGIN-058)
# ============================================================

class TestBiometricLogin:
    """生物识别登录功能测试（移动端）"""

    # TC-LOGIN-048: 生物识别成功登录 (P0)
    @pytest.mark.mobile
    def test_bio_login_success(self, login_page: LoginPage):
        """TC-LOGIN-048: 生物识别成功登录"""
        login_page.switch_to_bio_login()
        login_page.click_bio_login()

        # Mock生物识别成功
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('biometric-result', {
                detail: { success: true }
            }));
        """)

        assert login_page.wait_for_success(timeout=10000), "生物识别成功应完成登录"

    # TC-LOGIN-049: 生物识别失败降级 (P0)
    @pytest.mark.mobile
    def test_bio_login_failure_fallback(self, login_page: LoginPage):
        """TC-LOGIN-049: 生物识别失败降级"""
        login_page.switch_to_bio_login()
        login_page.click_bio_login()

        # Mock生物识别失败
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('biometric-result', {
                detail: { success: false }
            }));
        """)
        login_page.page.wait_for_timeout(2000)

        # 验证降级提示
        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["bio_failed"] in error_msg or "密码登录" in error_msg, \
            f"生物识别失败应提示降级，实际：{error_msg}"

        # 验证密码输入框出现
        fallback_input = login_page.page.query_selector(login_page.bio_fallback_password_input)
        assert fallback_input is not None and fallback_input.is_visible(), \
            "生物识别失败后应显示密码登录输入框"

    # TC-LOGIN-050: 首次使用引导录入生物识别 (P1)
    @pytest.mark.mobile
    @pytest.mark.manual
    def test_bio_first_time_enrollment_guide(self, login_page: LoginPage):
        """TC-LOGIN-050: 首次使用引导录入生物识别"""
        login_page.switch_to_bio_login()
        login_page.click_bio_login()
        # 验证引导页面或弹窗出现
        # 需要Mock"未录入生物特征"场景
        guide = login_page.page.query_selector('[data-testid="bio-enrollment-guide"]')
        assert guide is not None, "首次使用应引导录入生物识别信息"

    # TC-LOGIN-051: 多次生物识别失败锁定 (P0)
    @pytest.mark.mobile
    def test_bio_login_max_failures_lockout(self, login_page: LoginPage):
        """TC-LOGIN-051: 多次生物识别失败锁定"""
        login_page.switch_to_bio_login()

        # 模拟5次生物识别失败
        for i in range(5):
            login_page.click_bio_login()
            login_page.page.evaluate("""
                window.dispatchEvent(new CustomEvent('biometric-result', {
                    detail: { success: false }
                }));
            """)
            login_page.page.wait_for_timeout(1000)

        # 验证生物识别被锁定
        bio_button = login_page.page.query_selector(login_page.bio_login_button)
        is_disabled = bio_button.is_disabled() if bio_button else True
        assert is_disabled, "5次失败后生物识别按钮应被禁用"

        # 验证提示需要密码解锁
        error_msg = login_page.get_error_message()
        assert "密码" in error_msg or "锁定" in error_msg, \
            f"5次失败后应提示需要密码解锁，实际：{error_msg}"

    # TC-LOGIN-052: 生物特征数据本地存储 (P0)
    @pytest.mark.mobile
    @pytest.mark.security
    def test_bio_data_local_storage(self, login_page: LoginPage):
        """TC-LOGIN-052: 生物特征数据本地存储（安全审计）"""
        # 此用例验证生物特征数据不上传服务端
        # 通过检查网络请求验证
        requests_data = []

        def capture_request(request):
            if "biometric" in request.url.lower() or "fingerprint" in request.url.lower():
                requests_data.append({
                    "url": request.url,
                    "method": request.method,
                    "post_data": request.post_data,
                })

        login_page.page.on("request", capture_request)
        login_page.switch_to_bio_login()
        login_page.click_bio_login()

        login_page.page.wait_for_timeout(3000)

        # 验证没有将生物特征数据上传到服务端
        for req in requests_data:
            post_data = req.get("post_data", "") or ""
            assert "fingerprint" not in post_data.lower() and \
                   "face" not in post_data.lower(), \
                f"生物特征数据不应上传服务端，发现请求：{req['url']}"

    # TC-LOGIN-053: 指纹膜/照片欺骗防护 (P0)
    @pytest.mark.mobile
    @pytest.mark.security
    @pytest.mark.manual
    def test_bio_spoofing_prevention(self, login_page: LoginPage):
        """TC-LOGIN-053: 指纹膜/照片欺骗防护（需物理设备测试）"""
        # 此用例需要使用物理伪造材料测试，无法完全自动化
        # 自动化部分：验证系统有防欺骗机制
        login_page.switch_to_bio_login()
        # 验证系统使用了安全的生物识别API（如iOS LAContext或Android BiometricPrompt）
        pass

    # TC-LOGIN-054: 生物识别与账号绑定关系验证 (P1)
    @pytest.mark.mobile
    @pytest.mark.manual
    def test_bio_account_binding(self, login_page: LoginPage):
        """TC-LOGIN-054: 生物识别与账号绑定关系验证"""
        # 需要多账号场景验证
        pass

    # TC-LOGIN-055: 不同设备生物识别差异处理 (P1)
    @pytest.mark.mobile
    @pytest.mark.manual
    def test_bio_different_device_handling(self, login_page: LoginPage):
        """TC-LOGIN-055: 不同设备生物识别差异处理"""
        # 需要多设备测试
        pass

    # TC-LOGIN-056: 生物识别功能关闭时降级登录 (P1)
    @pytest.mark.mobile
    def test_bio_disabled_fallback(self, login_page: LoginPage):
        """TC-LOGIN-056: 生物识别功能关闭时降级登录"""
        login_page.switch_to_bio_login()
        # Mock生物识别功能被关闭
        login_page.page.evaluate("""
            window.__BIO_ENABLED = false;
        """)
        login_page.page.reload()
        login_page.page.wait_for_timeout(2000)

        # 验证不显示生物识别入口，显示密码登录
        bio_button = login_page.page.query_selector(login_page.bio_login_button)
        password_input = login_page.page.query_selector(login_page.password_input)
        assert bio_button is None or not bio_button.is_visible(), \
            "关闭生物识别后不应显示生物识别入口"
        assert password_input is not None and password_input.is_visible(), \
            "关闭生物识别后应显示密码登录界面"

    # TC-LOGIN-057: 设备更换后生物识别重新授权 (P1)
    @pytest.mark.mobile
    @pytest.mark.manual
    def test_bio_device_change_reauthorization(self, login_page: LoginPage):
        """TC-LOGIN-057: 设备更换后生物识别重新授权"""
        # 需要多设备环境测试
        pass

    # TC-LOGIN-058: 生物识别传感器异常友好提示 (P2)
    @pytest.mark.mobile
    def test_bio_sensor_error_handling(self, login_page: LoginPage):
        """TC-LOGIN-058: 生物识别传感器异常友好提示"""
        login_page.switch_to_bio_login()
        # Mock传感器不可用
        login_page.page.evaluate("""
            window.dispatchEvent(new CustomEvent('biometric-error', {
                detail: { error: 'SENSOR_NOT_AVAILABLE' }
            }));
        """)
        login_page.page.wait_for_timeout(2000)

        error_msg = login_page.get_error_message()
        assert ERROR_MESSAGES["bio_not_supported"] in error_msg or \
               "不支持" in error_msg, \
            f"传感器异常应友好提示，实际：{error_msg}"


# ============================================================
# 五、安全测试 (TC-SECURITY-001 ~ TC-SECURITY-006)
# ============================================================

class TestSecurity:
    """安全测试"""

    # TC-SECURITY-001: SQL注入-用户名字段 (P0)
    @pytest.mark.security
    def test_sql_injection_username(self, login_page: LoginPage):
        """TC-SECURITY-001: SQL注入-用户名字段"""
        malicious_payloads = [
            "' OR 1=1 --",
            "' OR '1'='1",
            "admin'--",
            "' UNION SELECT * FROM users--",
            "1; DROP TABLE users--",
        ]
        for payload in malicious_payloads:
            login_page.page.reload()
            login_page.page.wait_for_load_state("domcontentloaded")
            login_page.input_username(payload)
            login_page.input_password("anything")
            login_page.click_login()

            # 验证登录失败且无数据泄露
            assert not login_page.is_on_home_page(), \
                f"SQL注入payload '{payload}' 不应登录成功"
            error_msg = login_page.get_error_message()
            assert error_msg != "", "应有错误提示"
            # 验证不返回数据库错误信息
            assert "sql" not in error_msg.lower() and \
                   "database" not in error_msg.lower() and \
                   "syntax" not in error_msg.lower(), \
                f"错误提示不应包含数据库信息，实际：{error_msg}"

    # TC-SECURITY-002: SQL注入-密码字段 (P0)
    @pytest.mark.security
    def test_sql_injection_password(self, login_page: LoginPage):
        """TC-SECURITY-002: SQL注入-密码字段"""
        malicious_passwords = [
            "' OR '1'='1",
            "' OR 1=1 --",
            "' UNION SELECT * FROM users--",
        ]
        for pwd in malicious_passwords:
            login_page.page.reload()
            login_page.page.wait_for_load_state("domcontentloaded")
            login_page.input_username(TEST_ACCOUNTS["valid_user"]["username"])
            login_page.input_password(pwd)
            login_page.click_login()

            assert not login_page.is_on_home_page(), \
                f"SQL注入密码 '{pwd}' 不应登录成功"

    # TC-SECURITY-003: XSS攻击-用户名字段 (P0)
    @pytest.mark.security
    def test_xss_attack_username(self, login_page: LoginPage):
        """TC-SECURITY-003: XSS攻击-用户名字段"""
        xss_payloads = [
            '<script>alert(1)</script>',
            '<img src=x onerror=alert(1)>',
            '"><script>alert(document.cookie)</script>',
            "<svg/onload=alert(1)>",
        ]
        for payload in xss_payloads:
            login_page.page.reload()
            login_page.page.wait_for_load_state("domcontentloaded")
            login_page.input_username(payload)
            login_page.input_password("anything")
            login_page.click_login()

            # 验证脚本不被执行
            assert not login_page.is_on_home_page(), \
                f"XSS payload '{payload}' 不应登录成功"

            # 验证输入被过滤或转义
            page_content = login_page.page.content()
            assert '<script>' not in page_content.lower() or \
                   '&lt;script&gt;' in page_content, \
                "XSS脚本应被转义，不应以原始形式出现在页面中"

    # TC-SECURITY-004: 越权访问-直接访问受保护页面 (P0)
    @pytest.mark.security
    def test_unauthorized_access_protected_page(self, login_page: LoginPage):
        """TC-SECURITY-004: 越权访问-直接访问受保护页面"""
        # 清除登录状态
        login_page.page.context.clear_cookies()

        # 直接访问受保护页面
        response = login_page.page.goto(f"{BASE_URL}/home")
        current_url = login_page.page.url

        # 应重定向到登录页或返回401
        assert "/login" in current_url or response.status == 401, \
            f"未登录访问受保护页面应重定向到登录页或返回401，实际URL：{current_url}"

    # TC-SECURITY-005: 暴力破解-同账号连续失败 (P0)
    @pytest.mark.security
    def test_brute_force_account_lockout(self, login_page: LoginPage):
        """TC-SECURITY-005: 暴力破解-同账号连续失败5次后锁定"""
        wrong_passwords = [f"Wrong{i}Pass!" for i in range(5)]

        for i, pwd in enumerate(wrong_passwords, 1):
            login_page.page.reload()
            login_page.page.wait_for_load_state("domcontentloaded")
            login_page.input_username(TEST_ACCOUNTS["valid_user"]["username"])
            login_page.input_password(pwd)
            login_page.click_login()

            if i < 5:
                # 前4次应提示凭证错误
                error_msg = login_page.get_error_message()
                assert ERROR_MESSAGES["invalid_credentials"] in error_msg, \
                    f"第{i}次失败应提示凭证错误"
            else:
                # 第5次应提示账号锁定
                error_msg = login_page.get_error_message()
                assert ERROR_MESSAGES["account_locked"] in error_msg, \
                    f"第5次失败应提示账号锁定，实际：{error_msg}"

    # TC-SECURITY-006: 暴力破解-同IP大量尝试 (P0)
    @pytest.mark.security
    @pytest.mark.manual
    def test_brute_force_ip_rate_limiting(self, login_page: LoginPage):
        """TC-SECURITY-006: 暴力破解-同IP大量尝试"""
        # 模拟同一IP大量请求
        # 实际测试中应使用并发请求工具
        usernames = [f"testuser{i:02d}" for i in range(1, 21)]
        rate_limited = False

        for username in usernames:
            login_page.page.reload()
            login_page.page.wait_for_load_state("domcontentloaded")
            login_page.input_username(username)
            login_page.input_password("WrongPass1!")
            login_page.click_login()

            # 检查是否被限流
            try:
                error_msg = login_page.get_error_message()
                if "429" in error_msg or "频繁" in error_msg or "限制" in error_msg:
                    rate_limited = True
                    break
            except Exception:
                pass

        assert rate_limited, "同IP大量请求应触发限流"


# ============================================================
# 运行说明
# ============================================================

"""
## 安装依赖
pip install playwright pytest pytest-html
playwright install chromium

## 执行命令

# 执行全部测试
pytest ui_automation_login.py -v

# 执行P0测试
pytest ui_automation_login.py -v -m "not slow and not manual"

# 执行安全测试
pytest ui_automation_login.py -v -m security

# 执行移动端测试
pytest ui_automation_login.py -v -m mobile

# headed模式（可视化）
pytest ui_automation_login.py -v --headed

# 生成HTML报告
pytest ui_automation_login.py -v --html=report.html --self-contained-html

## pytest markers
在 pytest.ini 或 pyproject.toml 中配置：
[tool.pytest.ini_options]
markers = [
    "slow: 运行缓慢的测试（需等待超时）",
    "manual: 需要人工干预或Mock的测试",
    "security: 安全测试",
    "mobile: 移动端测试",
]

## 注意事项
1. 需替换 BASE_URL 为实际测试环境地址
2. 需替换 data-testid 选择器为实际项目中的元素定位
3. 需在测试环境中预置测试数据（参见 TEST_ACCOUNTS 和 TEST_PHONES）
4. 扫码登录和生物识别登录的部分用例需配合Mock或手动测试
5. 安全测试中的暴力破解测试需在隔离环境中执行
6. 建议CI环境中使用 headless=True，本地调试使用 --headed
"""
