"""
验证码处理辅助模块。

支持三种模式：
1. manual  — 手动输入（headed 模式）
2. mock    — 固定验证码值（仅限测试/预发布环境）
3. ocr     — ddddocr 自动识别（仅适用于简单验证码）
"""

import logging
from pathlib import Path
from typing import Optional
from playwright.sync_api import Page

from config import CFG

logger = logging.getLogger(__name__)


def handle_captcha(page: Page, text: Optional[str] = None) -> str:
    """
    处理登录页验证码，返回实际填入的值（或空字符串表示需人工输入）。

    Args:
        page: Playwright Page 对象
        text: 手动指定的验证码值（覆盖配置模式）

    Returns:
        str: 填入的验证码值
    """
    mode = CFG.get("captcha", {}).get("mode", "manual") if text is None else "manual"
    captcha_input = page.locator(
        "input[name='captcha'], input[name='verifyCode'], "
        "input[name='verificationCode'], input[placeholder*='验证码'], "
        "input[placeholder*='captcha']"
    ).first

    if not captcha_input.is_visible():
        logger.warning("未找到验证码输入框，跳过验证码处理")
        return ""

    # 模式 1：显式传入验证码
    if text is not None:
        captcha_input.fill(text)
        logger.info(f"[CAPTCHA] 手动填入: {text}")
        return text

    # 模式 2：Mock
    if mode == "mock":
        mock_code = CFG.get("captcha", {}).get("mock_code", "0000")
        captcha_input.fill(mock_code)
        logger.info(f"[CAPTCHA] Mock 模式，填入: {mock_code}")
        return mock_code

    # 模式 3：OCR
    if mode == "ocr":
        return _ocr_and_fill(page, captcha_input)

    # 模式 4：Manual — 在 headed 模式下由人工处理
    logger.info("[CAPTCHA] Manual 模式，等待人工输入...")
    page.wait_for_timeout(1000)  # 给用户一点时间看到验证码
    return ""


def _ocr_and_fill(page: Page, captcha_input) -> str:
    """使用 OCR 识别并填写验证码"""
    try:
        import ddddocr
        ocr = ddddocr.DdddOcr(show_ad=False)
    except ImportError:
        logger.warning("ddddocr 未安装，请执行: pip install ddddocr")
        return ""

    try:
        captcha_img = page.locator(
            "img[alt*='验证码'], img.captcha-img, "
            ".captcha img, img[src*='captcha']"
        ).first
        img_bytes = captcha_img.screenshot()
        result = ocr.classification(img_bytes)
        logger.info(f"[OCR] 识别结果: '{result}'")

        if result:
            captcha_input.fill(result)
            return result
    except Exception as e:
        logger.error(f"[OCR] 识别失败: {e}")

    return ""


def refresh_captcha(page: Page) -> bool:
    """点击刷新验证码按钮"""
    refresh_btn = page.locator(
        "button:has-text('刷新'), button:has-text('换一张'), "
        ".captcha-refresh, img[alt*='刷新']"
    ).first

    if refresh_btn.is_visible():
        refresh_btn.click()
        page.wait_for_timeout(500)
        logger.info("[CAPTCHA] 已刷新验证码")
        return True

    logger.warning("[CAPTCHA] 未找到刷新按钮")
    return False
