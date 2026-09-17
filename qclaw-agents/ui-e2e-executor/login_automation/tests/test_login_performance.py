"""
P0 性能测试 — 登录响应时间基线。

覆盖用例：
  PERF-002, PERF-006

标记：@pytest.mark.p0 @pytest.mark.performance
"""

import time
import pytest
from playwright.sync_api import expect

pytestmark = [pytest.mark.p0, pytest.mark.performance]


class TestLoginPerformance:
    """P0 性能基线"""

    @pytest.mark.flaky(reruns=1)
    def test_login_response_time(self, login_page, login_url, valid_user):
        """
        PERF-002 — 登录请求响应时间 ≤ 2 秒
        """
        page = login_page
        page.locator("input[name='username'], input[name='email']").first.fill(valid_user["username"])
        page.locator("input[type='password']").first.fill(valid_user["password"])

        captcha_input = page.locator("input[name='captcha'], input[name='verifyCode']")
        if captcha_input.is_visible():
            captcha_input.fill("0000")

        # 记录请求开始时间并监听导航
        start_time = time.time()
        with page.expect_navigation(timeout=15000) as nav_info:
            page.locator("button[type='submit'], button:has-text('登录')").first.click()

        elapsed = time.time() - start_time

        # 获取响应状态码
        response = nav_info.value
        status = response.status if response else "unknown"

        # 断言：响应时间 ≤ 2 秒
        assert elapsed <= 2.0, (
            f"登录请求响应时间 {elapsed:.2f}s 超过 2.0s 阈值（状态码: {status}）"
        )

    @pytest.mark.skip(reason="并发测试需使用 JMeter / Locust 等专用工具，本框架仅记录单次响应时间")
    def test_concurrent_login_100_users(self):
        """
        PERF-006 — 并发登录（100用户）。
        此用例为占位，实际并发测试请使用专用压测工具。
        """
        pass
