"""
tests/conftest.py — 测试模块级 Fixture
"""

import pytest
import logging

logger = logging.getLogger(__name__)


@pytest.fixture
def login_page(page, login_url):
    """
    导航到登录页并等待加载完成。
    每个测试用例调用此 fixture 获取已加载好的登录页。
    """
    page.goto(login_url, wait_until="networkidle")
    return page
