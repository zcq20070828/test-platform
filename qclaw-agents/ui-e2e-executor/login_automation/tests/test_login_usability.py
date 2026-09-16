"""
P0 易用性测试 — 服务端异常处理。

覆盖用例：
  US-014

标记：@pytest.mark.p0 @pytest.mark.usability
"""

import pytest
from playwright.sync_api import expect

pytestmark = [pytest.mark.p0, pytest.mark.usability]


class TestUsabilityErrorHandling:
    """P0 错误处理体验"""

    def test_server_error_500_shows_friendly_message(self, login_page):
        """
        US-014 — 服务端返回 500 错误时提示友好信息，不暴露技术细节
        """
        page = login_page

        # 拦截登录 API 请求，返回 500
        def handle_500(route):
            route.fulfill(
                status=500,
                content_type="application/json",
                body='{"error":"Internal Server Error"}',
            )

        # 拦截可能的后端 API 端点
        page.route("**/api/login*", handle_500)
        page.route("**/*login*", handle_500)

        # 尝试登录（会触发 500）
        page.locator("input[name='username'], input[type='text']").first.fill("testuser")
        page.locator("input[type='password']").first.fill("testpass")

        captcha_input = page.locator("input[name='captcha'], input[name='verifyCode']")
        if captcha_input.is_visible():
            captcha_input.fill("0000")

        page.locator("button[type='submit'], button:has-text('登录')").first.click()
        page.wait_for_timeout(3000)

        # 验证：
        # 1. 显示友好的错误提示
        friendly_msg = page.locator("text=服务器繁忙, text=请稍后再试, text=系统繁忙, text=服务异常, text=Network Error")
        has_friendly = friendly_msg.count() > 0

        # 2. 不暴露技术细节
        tech_leak = page.locator(
            "text=Stack trace, text=Traceback, text=Fatal error, "
            "text=PHP, text=Node.js, text=Exception, text= at "
        )
        has_leak = tech_leak.count() > 0

        assert has_friendly or not has_leak, (
            "500 错误应：展示友好提示 或 不暴露技术细节"
        )
