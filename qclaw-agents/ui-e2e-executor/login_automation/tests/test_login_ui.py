"""
P0 UI 测试 — 界面元素可见性检查。

覆盖用例：
  UI-001, UI-004, UI-009, UI-013

标记：@pytest.mark.p0 @pytest.mark.ui
"""

import pytest
from playwright.sync_api import Page, expect

pytestmark = [pytest.mark.p0, pytest.mark.ui]


class TestLoginPageElements:
    """P0 界面元素存在性检查"""

    def test_all_required_elements_present(self, login_page):
        """
        UI-001 — 登录页所有必要元素存在
        """
        page = login_page

        # 检查用户名输入框
        username_input = page.locator(
            "input[name='username'], input[name='email'], "
            "input[type='text'], input[placeholder*='用户名'], "
            "input[placeholder*='邮箱'], input[placeholder*='账号']"
        ).first
        expect(username_input).to_be_visible()
        expect(username_input).to_be_enabled()

        # 检查密码输入框
        password_input = page.locator("input[type='password']").first
        expect(password_input).to_be_visible()
        expect(password_input).to_be_enabled()

        # 检查登录按钮
        login_button = page.locator(
            "button[type='submit'], button:has-text('登录'), "
            "input[type='submit'], button:has-text('Sign in')"
        ).first
        expect(login_button).to_be_visible()
        expect(login_button).to_be_enabled()

        # 检查"记住我"复选框
        remember_me = page.locator(
            "input[type='checkbox'], label:has-text('记住我'), "
            "label:has-text('Remember'), span:has-text('记住我')"
        ).first
        expect(remember_me).to_be_visible()

        # 检查"忘记密码"链接
        forgot_link = page.locator(
            "a:has-text('忘记密码'), a:has-text('Forgot'), "
            "button:has-text('忘记密码')"
        ).first
        expect(forgot_link).to_be_visible()

    def test_captcha_image_displayed(self, login_page):
        """
        UI-004 — 验证码图片正常显示，刷新按钮存在
        """
        page = login_page

        # 检查验证码图片
        captcha_img = page.locator(
            "img[alt*='验证码'], img.captcha-img, "
            "img[src*='captcha'], img[src*='verify'], "
            "img[alt*='captcha']"
        ).first
        expect(captcha_img).to_be_visible()

        # 验证图片已加载（naturalWidth > 0）
        is_loaded = captcha_img.evaluate("el => el.naturalWidth > 0 && el.complete")
        assert is_loaded, "验证码图片未成功加载"

        # 检查刷新按钮
        refresh_btn = page.locator(
            "button:has-text('刷新'), button:has-text('换一张'), "
            "img[alt*='刷新'], .captcha-refresh"
        ).first
        expect(refresh_btn).to_be_visible()

    def test_password_masked(self, login_page):
        """
        UI-009 — 密码输入框掩码显示
        """
        page = login_page
        password_input = page.locator("input[type='password']").first
        expect(password_input).to_be_visible()

        # 输入密码并检查输入框类型
        password_input.fill("MySecretPass123")
        input_type = password_input.get_attribute("type")
        assert input_type == "password", f"输入框 type 应为 'password', 实际为 '{input_type}'"

        # 检查显示类型（应为 dots 或 asterisks）
        # 验证输入值不会被明文显示
        displayed_value = password_input.input_value()
        assert displayed_value == "MySecretPass123", "密码值应在 DOM 中但被掩码显示"

    def test_mobile_responsive_layout(self, page, login_url):
        """
        UI-013 — 手机端单列布局，无横向滚动
        """
        # 使用小屏视口
        page.set_viewport_size({"width": 375, "height": 812})  # iPhone X
        page.goto(login_url)
        page.wait_for_load_state("networkidle")

        # 验证：表单元素全宽显示
        form = page.locator("form").first
        form_box = form.bounding_box()
        assert form_box is not None, "未找到表单元素"

        viewport_width = page.viewport_size["width"]
        # 表单应占屏幕宽度的大部分（> 70%）
        form_width_ratio = form_box["width"] / viewport_width
        assert form_width_ratio > 0.7, f"手机端表单宽度占比应为 > 70%，实际: {form_width_ratio:.0%}"

        # 验证：无横向滚动条
        has_hscroll = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert not has_hscroll, "手机端存在横向滚动条"

        # 验证：元素垂直排列（单列）
        username_input = page.locator("input[type='text'], input[name='username']").first
        password_input = page.locator("input[type='password']").first

        username_box = username_input.bounding_box()
        password_box = password_input.bounding_box()
        assert username_box and password_box, "输入框元素未找到"

        # 检查垂直排列：密码框的顶部应大致等于用户名框的底部（或在其下方）
        padding_tolerance = 5
        assert password_box["y"] > username_box["y"] + username_box["height"] - padding_tolerance, \
            "手机端表单元素应按垂直方向排列（单列布局）"
