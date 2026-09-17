"""
浏览器预设辅助函数。
"""

from typing import Dict, List

# ---- 常见设备视口 ----
VIEWPORTS = {
    "pc_1920": {"width": 1920, "height": 1080},
    "pc_1440": {"width": 1440, "height": 900},
    "pc_1280": {"width": 1280, "height": 800},
    "tablet_horizontal": {"width": 1024, "height": 768},
    "tablet_vertical": {"width": 768, "height": 1024},
    "phone_large": {"width": 428, "height": 926},    # iPhone 14 Pro Max
    "phone_medium": {"width": 390, "height": 844},    # iPhone 14 Pro
    "phone_small": {"width": 320, "height": 568},     # iPhone SE
    "ultrawide_2k": {"width": 2560, "height": 1440},
    "ultrawide_4k": {"width": 3840, "height": 2160},
}


# ---- 常见 User-Agent ----
USER_AGENTS = {
    "chrome_mac": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "firefox_mac": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    "safari_mac": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "edge_mac": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "chrome_win": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "safari_ios": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
    "chrome_android": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36",
    "ie11_win": "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko",
}


def get_viewport(name: str) -> Dict[str, int]:
    """按名称获取视口尺寸"""
    return VIEWPORTS.get(name, VIEWPORTS["pc_1280"])


def get_user_agent(name: str) -> str:
    """按名称获取 User-Agent"""
    return USER_AGENTS.get(name, USER_AGENTS["chrome_mac"])


def viewport_list() -> List[str]:
    """返回所有可用的视口名称"""
    return list(VIEWPORTS.keys())
