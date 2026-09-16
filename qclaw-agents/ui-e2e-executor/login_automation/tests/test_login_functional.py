"""
P0 功能测试 — 正常登录 + 异常登录 + 忘记密码。

覆盖用例：
  F-001 ~ F-009, F-013 ~ F-017, F-041 ~ F-042

标记：@pytest.mark.p0 @pytest.mark.functional
"""

import pytest
import re
from playwright.sync_api import Page, expect

pytestmark = [pytest.mark.p0, pytest.mark.functional]


# ============================
# 1.1 正常登录流程
# ============================

class TestNormalLogin:
    """P0 正常登录场景"""

    @pytest.mark.parametrize("credential_key,label", [
        ("username", "用户名"),
        ("email", "邮箱"),
    ])
    def test_valid_login(self, login_page, login_url, valid_user, captcha_mode, credential_key, label):
        """
        F-001 / F-002 — 使用正确用户名/邮箱 + 密码登录成功
        """
        page = login_page

        # 1-2. 输入凭据
        username_input = page.locator("input[name='username'], input[name='email'], input[type='text']").first
        password_input = page.locator("input[type='password']").first

        username_input.fill(valid_user[credential_key])
        password_input.fill(valid_user["password"])

        # 3. 验证码（manual 模式下需人工输入，测试会暂停等待）
        if captcha_mode == "mock":
            captcha_input = page.locator("input[name='captcha'], input[name='verifyCode']").first
            if captcha_input.is_visible():
                captcha_input.fill("0000")

        # 4. 点击登录
        submit_btn = page.locator("button[type='submit'], button:has-text('登录')").first
        submit_btn.click()

        # 验证：跳转到首页或用户中心
        page.wait_for_url(re.compile(r"(dashboard|home|user|index)"), timeout=10000)

    def test_session_cookie_created(self, page, login_url, valid_user):
        """
        F-003 — 登录成功后 Cookie/Session 正确创建
        """
        # 登录
        page.goto(login_url)
        page.locator("input[name='username'], input[name='email']").first.fill(valid_user["username"])
        page.locator("input[type='password']").first.fill(valid_user["password"])
        page.locator("button[type='submit'], button:has-text('登录')").first.click()
        page.wait_for_url(re.compile(r"(dashboard|home|user|index)"), timeout=10000)

        # 检查 Cookie
        cookies = page.context.cookies()
        cookie_names = {c["name"].lower() for c in cookies}
        session_keys = {"sessionid", "jsessionid", "sid", "token", "access_token", "connect.sid"}
        assert cookie_names & session_keys, f"未找到 Session/Token Cookie。现有 Cookie: {cookie_names}"

        # 检查安全属性
        for c in cookies:
            if c["name"].lower() in session_keys:
                assert c.get("httpOnly", False), f"Cookie {c['name']} 缺少 HttpOnly 属性"
                assert c.get("secure", False), f"Cookie {c['name']} 缺少 Secure 属性"
                assert c.get("sameSite") in ("Lax", "Strict"), f"Cookie {c['name']} 缺少 SameSite 属性"


# ============================
# 1.2 异常登录 — 凭据错误
# ============================

class TestInvalidCredentials:
    """P0 凭据无效场景"""

    @pytest.mark.parametrize("scenario", [
        ("wrong_user_correct_pass", "不存在的用户名", "Test@Pass123"),
        ("correct_user_wrong_pass", "testuser01", "WrongPass@999"),
        ("both_wrong", "wrong_user", "WrongPass@999"),
        ("unregistered_email", "unregistered@example.com", "AnyPass123"),
    ], ids=["F-006_用户名错误", "F-007_密码错误", "F-008_都错误", "F-009_未注册"])
    def test_invalid_login_shows_generic_error(self, login_page, scenario, valid_user, captcha_mode):
        """
        F-006/F-007/F-008/F-009 — 无效凭据应提示通用错误信息，不泄漏账号是否存在
        """
        page = login_page
        _, username, password = scenario

        # 对于 F-009，用正确的已注册用户名但标记为未注册场景
        if scenario[0] == "unregistered_email":
            username = "unregistered@example.com"
            password = "AnyPass123"
        elif scenario[0] == "wrong_user_correct_pass":
            username = "nonexistent_user_abc123"
            password = valid_user["password"]
        elif scenario[0] == "correct_user_wrong_pass":
            username = valid_user["username"]
            password = "DefinitelyWrong@999"

        # 填入凭据
        page.locator("input[name='username'], input[name='email'], input[type='text']").first.fill(username)
        page.locator("input[type='password']").first.fill(password)
        if captcha_mode == "mock":
            captcha_input = page.locator("input[name='captcha'], input[name='verifyCode']").first
            if captcha_input.is_visible():
                captcha_input.fill("0000")

        page.locator("button[type='submit'], button:has-text('登录')").first.click()

        # 验证：显示通用错误信息，不暴露"账号不存在"或"密码错误"
        page.wait_for_timeout(2000)
        error_msg = page.locator(
            ".error-message, .alert-danger, .alert-error, "
            "[role='alert'], .el-message--error, .ant-message-error, "
            "text=错误, text=失败"
        ).first
        expect(error_msg).to_be_visible(timeout=8000)
        error_text = error_msg.text_content().lower()

        # 通用错误信息不应包含"不存在"等账号泄漏信息
        leak_phrases = ["账号不存在", "账户不存在", "用户不存在", "未注册", "not found", "doesn't exist"]
        for phrase in leak_phrases:
            assert phrase not in error_text, (
                f"错误信息泄漏了账号状态：'{phrase}' 出现在 '{error_text}' 中"
            )


# ============================
# 1.2 异常登录 — 空字段
# ============================

class TestEmptyFields:
    """P0 空字段校验"""

    @pytest.mark.parametrize("empty_case", [
        ("empty_username", "", "SomePass123", "用户名"),
        ("empty_password", "testuser01", "", "密码"),
        ("both_empty", "", "", "必填"),
    ], ids=["F-013_空用户名", "F-014_空密码", "F-015_都为空"])
    def test_empty_fields_shows_prompt(self, login_page, empty_case, captcha_mode):
        """
        F-013/F-014/F-015 — 空字段应触发前端拦截
        """
        page = login_page
        _, username, password, prompt_keyword = empty_case

        page.locator("input[name='username'], input[name='email'], input[type='text']").first.fill(username)
        page.locator("input[type='password']").first.fill(password)
        if captcha_mode == "mock" and username and password:
            captcha_input = page.locator("input[name='captcha'], input[name='verifyCode']").first
            if captcha_input.is_visible():
                captcha_input.fill("0000")

        page.locator("button[type='submit'], button:has-text('登录')").first.click()
        page.wait_for_timeout(1500)

        # 验证：前端提示必填
        error_hint = page.locator(
            ".error-message, .el-form-item__error, .ant-form-item-explain-error, "
            "[role='alert'], text=请输入, text=不能为空, text=必填"
        ).first
        expect(error_hint).to_be_visible(timeout=5000)
        hint_text = error_hint.text_content()
        assert prompt_keyword in hint_text, f"错误提示应包含'{prompt_keyword}'，实际: {hint_text}"


# ============================
# 1.3 异常登录 — 验证码
# ============================

class TestCaptcha:
    """P0 验证码校验"""

    def test_wrong_captcha(self, login_page, valid_user):
        """
        F-016 — 验证码错误
        """
        page = login_page
        page.locator("input[name='username'], input[name='email']").first.fill(valid_user["username"])
        page.locator("input[type='password']").first.fill(valid_user["password"])
        captcha_input = page.locator("input[name='captcha'], input[name='verifyCode']").first
        if captcha_input.is_visible():
            captcha_input.fill("WRONG")  # 故意填错

        page.locator("button[type='submit'], button:has-text('登录')").first.click()
        page.wait_for_timeout(2000)

        error = page.locator("text=验证码, text=captcha").first
        expect(error).to_be_visible(timeout=5000)

    def test_empty_captcha(self, login_page, valid_user):
        """
        F-017 — 验证码为空
        """
        page = login_page
        page.locator("input[name='username'], input[name='email']").first.fill(valid_user["username"])
        page.locator("input[type='password']").first.fill(valid_user["password"])
        # 不填写验证码

        page.locator("button[type='submit'], button:has-text('登录')").first.click()
        page.wait_for_timeout(1500)

        error = page.locator("text=验证码, text=请输入").first
        expect(error).to_be_visible(timeout=5000)


# ============================
# 1.7 忘记密码流程
# ============================

class TestForgotPassword:
    """P0 忘记密码场景"""

    def test_send_reset_email(self, page, login_url, valid_user):
        """
        F-041 — 正常发送密码重置邮件
        """
        page.goto(login_url)
        # 点击"忘记密码"
        forgot_link = page.locator("a:has-text('忘记密码'), a:has-text('Forgot'), button:has-text('忘记密码')").first
        forgot_link.click()
        page.wait_for_url(re.compile(r"forgot|reset|password"), timeout=8000)

        # 输入已注册邮箱
        email_input = page.locator("input[type='email'], input[name='email']").first
        email_input.fill(valid_user["email"])

        # 点击发送
        send_btn = page.locator("button[type='submit'], button:has-text('发送'), button:has-text('提交')").first
        send_btn.click()

        # 验证：收到成功提示
        success = page.locator("text=发送成功, text=邮件已发送, text=Check your email").first
        expect(success).to_be_visible(timeout=8000)

    def test_send_reset_to_unregistered_email(self, page, login_url):
        """
        F-042 — 发送重置邮件至未注册邮箱（防邮箱枚举）
        """
        page.goto(login_url)
        forgot_link = page.locator("a:has-text('忘记密码'), a:has-text('Forgot'), button:has-text('忘记密码')").first
        forgot_link.click()
        page.wait_for_url(re.compile(r"forgot|reset|password"), timeout=8000)

        email_input = page.locator("input[type='email'], input[name='email']").first
        email_input.fill("never_registered_12345@example.com")

        send_btn = page.locator("button[type='submit'], button:has-text('发送'), button:has-text('提交')").first
        send_btn.click()
        page.wait_for_timeout(2000)

        # 验证：不应泄漏邮箱是否注册（应统一提示"邮件已发送"）
        msg = page.locator("text=邮件已发送, text=发送成功, text=check your email").first
        expect(msg).to_be_visible(timeout=8000)

        # 不应出现"未注册"字样
        leak = page.locator("text=未注册, text=不存在, text=not found")
        assert not leak.is_visible(), "不应泄漏邮箱未注册信息"
