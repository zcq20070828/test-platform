"""
Session / Cookie / Token 检查辅助函数。
"""

from typing import List, Dict, Optional
from playwright.sync_api import Page


def get_cookies_dict(page: Page) -> Dict[str, str]:
    """获取当前页面的 Cookies 并转为字典"""
    cookies = page.context.cookies()
    return {c["name"]: c["value"] for c in cookies}


def get_cookies_detail(page: Page) -> List[Dict]:
    """获取当前页面完整的 Cookie 信息"""
    return page.context.cookies()


def check_cookie_attributes(cookies: List[Dict], name: str) -> Dict[str, bool]:
    """
    检查指定 Cookie 的安全属性。

    返回:
        {"has_httponly": bool, "has_secure": bool, "has_samesite": bool}
    """
    result = {"has_httponly": False, "has_secure": False, "has_samesite": False}
    for c in cookies:
        if c["name"] == name:
            result["has_httponly"] = c.get("httpOnly", False)
            result["has_secure"] = c.get("secure", False)
            result["has_samesite"] = bool(c.get("sameSite"))
            break
    return result


def get_session_id(page: Page) -> Optional[str]:
    """获取 Session ID（从 Cookie 中查找 sessionid / jsessionid / token 等）"""
    session_keys = ["sessionid", "jsessionid", "sid", "token", "access_token"]
    cookies = get_cookies_dict(page)
    for key in session_keys:
        if key in cookies:
            return cookies[key]
    return None


def capture_local_storage(page: Page) -> Dict[str, str]:
    """捕获 localStorage 内容（可能包含 Token 等敏感信息）"""
    return page.evaluate("JSON.stringify(window.localStorage)") or {}


def check_response_header(page: Page, url_pattern: str, header_key: str) -> Optional[str]:
    """
    检查指定请求的响应头（需在请求前绑定监听器）。
    使用方式见 test_login_security.py 中的 SEC-024。
    """
    result = {"value": None}

    def handler(response):
        if url_pattern in response.url and header_key.lower() in {k.lower() for k in response.headers}:
            result["value"] = response.headers[header_key]

    page.on("response", handler)
    return result
