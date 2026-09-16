"""
P0 兼容性测试 — 主流浏览器 + 移动端。

覆盖用例：
  COMP-001, COMP-002, COMP-003, COMP-007, COMP-008

标记：@pytest.mark.p0 @pytest.mark.compatibility
"""

import pytest
from playwright.sync_api import expect

from utils.browser_helper import get_user_agent, get_viewport

pytestmark = [pytest.mark.p0, pytest.mark.compatibility]


class TestBrowserCompatibility:
    """P0 浏览器兼容性 — 基本登录流程"""

    @pytest.mark.skip_browser("firefox")
    def test_chrome_login(self, page, login_url, valid_user):
        """
        COMP-001 — Chrome 最新版登录
        Playwright 默认即 Chromium，此用例确保 Chromium 浏览器下正常
        """
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(login_url)
        page.wait_for_load_state("networkidle")
        assert page.title(), "页面标题不应为空"
        assert page.locator("input[type='password']").is_visible(), "Chrome 下密码框可见"

    @pytest.mark.skip_browser("chromium")
    @pytest.mark.skip_browser("webkit")
    def test_firefox_login(self, page, login_url, valid_user):
        """
        COMP-002 — Firefox 最新版登录
        """
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(login_url)
        page.wait_for_load_state("networkidle")
        assert page.locator("input[name='username'], input[type='text']").first.is_visible()
        assert page.locator("button[type='submit'], button:has-text('登录')").first.is_visible()

    @pytest.mark.skip_browser("chromium")
    @pytest.mark.skip_browser("firefox")
    def test_safari_login(self, page, login_url, valid_user):
        """
        COMP-003 — Safari 最新版登录
        """
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(login_url)
        page.wait_for_load_state("networkidle")
        assert page.locator("input[type='password']").is_visible()
        assert page.locator("button[type='submit'], button:has-text('登录')").first.is_visible()

    def test_safari_ios_login(self, page, login_url, valid_user):
        """
        COMP-007 — Safari iOS 版登录（模拟移动端 UA 和视口）
        """
        context = page.context
        context.set_extra_http_headers({"User-Agent": get_user_agent("safari_ios")})
        page.set_viewport_size(get_viewport("phone_medium"))

        page.goto(login_url)
        page.wait_for_load_state("networkidle")
        assert page.locator("input[type='password']").is_visible(), "iOS Safari 密码框不可见"

        # 验证移动端键盘适配：输入框获得焦点时应无布局异常
        username_input = page.locator("input[type='text'], input[name='username']").first
        username_input.click()
        page.wait_for_timeout(500)
        is_visible = username_input.is_visible()
        assert is_visible, "iOS Safari 点击输入框后输入框被键盘遮挡"

    def test_chrome_android_login(self, page, login_url, valid_user):
        """
        COMP-008 — Chrome Android 版登录
        """
        context = page.context
        context.set_extra_http_headers({"User-Agent": get_user_agent("chrome_android")})
        page.set_viewport_size(get_viewport("phone_medium"))

        page.goto(login_url)
        page.wait_for_load_state("networkidle")
        assert page.locator("input[name='username'], input[type='text']").first.is_visible(), \
            "Android Chrome 用户名输入框不可见"
        assert page.locator("input[type='password']").first.is_visible(), \
            "Android Chrome 密码框不可见"
        assert page.locator("button[type='submit'], button:has-text('登录')").first.is_visible(), \
            "Android Chrome 登录按钮不可见"
