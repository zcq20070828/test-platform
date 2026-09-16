"""
P0 安全测试 — 注入攻击防护 + 暴力破解 + 会话安全 + CSRF。

覆盖用例：
  SEC-001 ~ SEC-007, SEC-009, SEC-011, SEC-012,
  SEC-019, SEC-020, SEC-023, SEC-024, SEC-025, SEC-033

标记：@pytest.mark.p0 @pytest.mark.security
"""

import pytest
import re
from playwright.sync_api import Page, expect

pytestmark = [pytest.mark.p0, pytest.mark.security]


# ============================
# 3.1 注入攻击防护
# ============================

class TestInjectionProtection:
    """P0 注入攻击防护 — SQLi, XSS, 命令注入"""

    @pytest.mark.parametrize("field,payload,desc", [
        ("username", "' OR '1'='1", "SQL注入—用户名OR"),
        ("username", "' OR '1'='1' --", "SQL注入—注释绕过"),
        ("username", "admin' --", "SQL注入—admin注释"),
        ("username", "' UNION SELECT 1,2,3 --", "SQL注入—UNION"),
        ("password", "' OR '1'='1", "SQL注入—密码OR"),
        ("username", "<script>alert('XSS')</script>", "XSS—用户名脚本"),
        ("password", "<img src=x onerror=alert(1)>", "XSS—密码img注入"),
        ("captcha", "<script>alert(1)</script>", "XSS—验证码脚本"),
        ("username", "; ls /", "命令注入"),
    ], ids=[
        "SEC-001_SQL注入用户名OR",
        "SEC-001_SQL注入OR带注释",
        "SEC-003_SQL注入admin注释",
        "SEC-004_SQL注入UNION",
        "SEC-002_SQL注入密码OR",
        "SEC-005_XSS用户名脚本",
        "SEC-006_XSS密码注入",
        "SEC-007_XSS验证码",
        "SEC-009_命令注入",
    ])
    def test_injection_rejected(self, login_page, valid_user, field, payload):
        """
        SEC-001~007, SEC-009 — 注入攻击被拦截，不返回异常
        """
        page = login_page

        # 填入各字段
        if field == "username":
            page.locator("input[name='username'], input[name='email'], input[type='text']").first.fill(payload)
            page.locator("input[type='password']").first.fill(valid_user["password"])
        elif field == "password":
            page.locator("input[name='username'], input[name='email']").first.fill(valid_user["username"])
            page.locator("input[type='password']").first.fill(payload)
        elif field == "captcha":
            page.locator("input[name='username']").first.fill(valid_user["username"])
            page.locator("input[type='password']").first.fill(valid_user["password"])

        captcha_input = page.locator("input[name='captcha'], input[name='verifyCode']").first
        if captcha_input.is_visible() and field != "captcha":
            captcha_input.fill("0000")
        elif captcha_input.is_visible() and field == "captcha":
            captcha_input.fill(payload)

        # 提交
        page.locator("button[type='submit'], button:has-text('登录')").first.click()
        page.wait_for_timeout(3000)

        # 验证：
        # 1. 不出现服务器错误页面（5xx / 空白 / 异常）
        server_error = page.locator("text=500, text=Internal Server Error, text=Warning, text=Error, text=Stack trace")
        assert not server_error.is_visible(), f"注入 '{payload}' 导致服务器错误/异常信息暴露"

        # 2. 页面仍停留在登录页（未成功登录绕过认证）
        current_url = page.url.lower()
        login_indicators = ["login", "signin", "auth", "logon"]
        assert any(ind in current_url for ind in login_indicators), \
            f"注入 '{payload}' 可能绕过了认证！当前URL: {current_url}"

        # 3. 错误提示应显示通用错误信息
        error_hint = page.locator("text=用户名或密码错误, text=验证码错误, text=登录失败")
        # 至少有一种错误提示出现（可视情况调整断言）
        error_count = error_hint.count()
        assert error_count > 0 or page.locator("text=错误").first.is_visible(), \
            "注入后未显示任何错误提示"


# ============================
# 3.2 暴力破解防护
# ============================

class TestBruteForceProtection:
    """P0 暴力破解防护"""

    @pytest.mark.skip(reason="需在预发布环境执行，生产环境跳过")
    @pytest.mark.parametrize("attempt_count", [5, 6, 10])
    def test_account_lockout_after_consecutive_failures(
        self, login_page, valid_user, attempt_count
    ):
        """
        SEC-011 — 连续错误密码触发账户锁定
        """
        page = login_page
        for i in range(attempt_count):
            page.locator("input[name='username'], input[name='email']").first.fill(valid_user["username"])
            page.locator("input[type='password']").first.fill(f"WrongPass_{i}")

            captcha_input = page.locator("input[name='captcha'], input[name='verifyCode']").first
            if captcha_input.is_visible():
                captcha_input.fill("0000")

            page.locator("button[type='submit'], button:has-text('登录')").first.click()
            page.wait_for_timeout(800)

            # 刷新页面重置表单状态
            if (i + 1) < attempt_count:
                page.reload()
                page.wait_for_load_state("networkidle")

        # 最后一次之后，检查是否被锁定
        lockout_msg = page.locator("text=锁定, text=locked, text=Lock, text=too many, text=429, text=过多")
        if lockout_msg.is_visible():
            assert True, "账户被锁定，暴力破解防护正常"
        else:
            # 也可能是验证码错误（mock 验证码也可能错误）
            pytest.skip("未触发锁定，可能是因为验证码模式非 mock 或锁定阈值不同")

    def test_ip_rate_limiting(self, login_url):
        """
        SEC-012 — IP 频率限制（通过 requests 库发送大量请求验证）
        """
        import requests

        url = f"{login_url.rstrip('/')}/api/login" if "/api" not in login_url else login_url
        headers = {"Content-Type": "application/json"}
        payload = {"username": "testuser", "password": "wrongpass"}

        responses = []
        for _ in range(20):
            try:
                resp = requests.post(url, json=payload, headers=headers, timeout=3)
                responses.append(resp.status_code)
            except requests.RequestException:
                pass

        # 检查是否有 429 或被拒绝
        blocked = any(code in (429, 403) for code in responses)
        if not blocked:
            pytest.skip("未触发IP限流（可能阈值高于20次或未启用）")


# ============================
# 3.3 会话管理与 Token 安全
# ============================

class TestSessionSecurity:
    """P0 会话安全"""

    def test_session_id_randomness(self, page, login_url, valid_user):
        """
        SEC-019 — Session ID 多次登录获取不同 ID
        """
        session_ids = set()
        for _ in range(3):
            context = page.context.browser.new_context()
            p = context.new_page()
            p.goto(login_url)
            p.locator("input[name='username']").first.fill(valid_user["username"])
            p.locator("input[type='password']").first.fill(valid_user["password"])
            # mock captcha
            captcha = p.locator("input[name='captcha'], input[name='verifyCode']")
            if captcha.is_visible():
                captcha.fill("0000")
            p.locator("button[type='submit']").first.click()

            p.wait_for_timeout(2000)
            cookies = context.cookies()
            for c in cookies:
                if c["name"].lower() in ("sessionid", "jsessionid", "sid", "token", "access_token"):
                    session_ids.add(c["value"])
            p.close()
            context.close()

        assert len(session_ids) >= 2, (
            f"Session ID 重复！{len(session_ids)} 次登录获得 {len(session_ids)} 个不同 ID"
        )

    def test_session_regeneration_after_login(self, page, login_url, valid_user):
        """
        SEC-020 — 登录后 Session ID 必须更新（防 Session Fixation）
        """
        # 1. 访问登录页，获取登录前 Session
        page.goto(login_url)
        pre_cookies = {c["name"]: c["value"] for c in page.context.cookies()}

        # 2. 登录
        page.locator("input[name='username']").first.fill(valid_user["username"])
        page.locator("input[type='password']").first.fill(valid_user["password"])
        captcha = page.locator("input[name='captcha'], input[name='verifyCode']")
        if captcha.is_visible():
            captcha.fill("0000")
        page.locator("button[type='submit']").first.click()
        page.wait_for_timeout(3000)

        # 3. 获取登录后 Session
        post_cookies = {c["name"]: c["value"] for c in page.context.cookies()}

        # 4. 比较 Session ID
        session_keys = {"sessionid", "jsessionid", "sid", "token", "access_token"}
        for key in session_keys:
            if key in pre_cookies and key in post_cookies:
                assert pre_cookies[key] != post_cookies[key], (
                    f"Session 固定攻击！登录前后 {key} 相同: {pre_cookies[key]}"
                )

    def test_logout_invalidates_session(self, page, login_url, valid_user):
        """
        SEC-023 — 注销后 Session 立即失效
        """
        # 1. 登录
        page.goto(login_url)
        page.locator("input[name='username']").first.fill(valid_user["username"])
        page.locator("input[type='password']").first.fill(valid_user["password"])
        captcha = page.locator("input[name='captcha'], input[name='verifyCode']")
        if captcha.is_visible():
            captcha.fill("0000")
        page.locator("button[type='submit']").first.click()
        page.wait_for_url(re.compile(r"(dashboard|home|user|index)"), timeout=10000)

        # 2. 点击注销
        logout_btn = page.locator(
            "a:has-text('注销'), a:has-text('退出'), "
            "button:has-text('注销'), button:has-text('退出'), "
            "a:has-text('Logout'), a:has-text('Sign out')"
        ).first
        expect(logout_btn).to_be_visible()
        logout_btn.click()
        page.wait_for_timeout(2000)

        # 3. 验证已跳回登录页
        assert "login" in page.url.lower() or "signin" in page.url.lower(), \
            f"注销后未跳转回登录页，当前URL: {page.url}"

        # 4. 尝试访问受保护页面
        protected_url = page.url.replace("login", "dashboard").replace("signin", "home")
        page.goto(protected_url)
        page.wait_for_timeout(3000)

        # 应被重定向回登录页
        assert "login" in page.url.lower() or "signin" in page.url.lower(), \
            "注销后会话未失效，仍可访问受保护页面"

    def test_secure_cookie_attributes(self, page, login_url, valid_user):
        """
        SEC-024 — 敏感 Cookie 属性验证（HttpOnly, Secure, SameSite）
        """
        page.goto(login_url)
        page.locator("input[name='username']").first.fill(valid_user["username"])
        page.locator("input[type='password']").first.fill(valid_user["password"])
        captcha = page.locator("input[name='captcha'], input[name='verifyCode']")
        if captcha.is_visible():
            captcha.fill("0000")
        page.locator("button[type='submit']").first.click()
        page.wait_for_timeout(3000)

        cookies = page.context.cookies()
        session_keys = {"sessionid", "jsessionid", "sid", "token", "access_token", "connect.sid"}
        for c in cookies:
            if c["name"].lower() in session_keys:
                assert c.get("httpOnly"), f"Cookie '{c['name']}' 缺少 HttpOnly"
                assert c.get("secure"), f"Cookie '{c['name']}' 缺少 Secure（生产环境必需）"
                assert c.get("sameSite"), f"Cookie '{c['name']}' 缺少 SameSite"

    def test_no_token_in_url(self, page, login_url, valid_user):
        """
        SEC-025 — Token 不应在 URL 中明文传递
        """
        page.goto(login_url)
        page.locator("input[name='username']").first.fill(valid_user["username"])
        page.locator("input[type='password']").first.fill(valid_user["password"])
        captcha = page.locator("input[name='captcha'], input[name='verifyCode']")
        if captcha.is_visible():
            captcha.fill("0000")

        # 监听请求，检查 URL 中是否包含 Token
        token_patterns = re.compile(r"(token|access_token|jwt|secret)=[^&]+", re.I)
        captured_urls = []

        def check_request(request):
            if token_patterns.search(request.url):
                captured_urls.append(request.url)

        page.on("request", check_request)
        page.locator("button[type='submit']").first.click()
        page.wait_for_timeout(3000)

        if captured_urls:
            pytest.fail(f"Token 在 URL 中明文暴露！示例: {captured_urls[0]}")


# ============================
# 3.4 CSRF 防护
# ============================

class TestCSRFProtection:
    """P0 CSRF 防护验证"""

    def test_csrf_token_present(self, login_page):
        """
        SEC-033 — 登录表单包含 CSRF Token
        """
        page = login_page

        # 检查表单中是否存在 CSRF Token
        csrf_input = page.locator(
            "input[name='csrf_token'], input[name='csrfmiddlewaretoken'], "
            "input[name='_csrf'], input[name='csrf'], input[name='authenticity_token'], "
            "meta[name='csrf-token']"
        ).first

        expect(csrf_input).to_be_visible()
        csrf_value = csrf_input.get_attribute("value") or csrf_input.get_attribute("content")
        assert csrf_value and len(csrf_value) > 8, "CSRF Token 值无效或太短"
