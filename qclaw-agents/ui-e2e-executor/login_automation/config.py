"""
配置管理模块。

优先级（从高到低）：
1. 环境变量（CAPTCHA_MODE, LOGIN_URL, TEST_USERNAME ...）
2. config.local.yaml（如果有）
3. config.yaml（默认值）

使用方式：
    from config import CFG
    url = CFG["login_url"]
    username = CFG["accounts"]["normal"]["username"]
"""

import os
import yaml
from pathlib import Path

_CONFIG_FILE = Path(__file__).parent / "config.yaml"
_LOCAL_CONFIG_FILE = Path(__file__).parent / "config.local.yaml"


def _load_defaults() -> dict:
    with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _load_local_overrides(defaults: dict) -> dict:
    if _LOCAL_CONFIG_FILE.exists():
        with open(_LOCAL_CONFIG_FILE, "r", encoding="utf-8") as f:
            local = yaml.safe_load(f) or {}
            return _deep_merge(defaults, local)
    return defaults


def _deep_merge(base: dict, override: dict) -> dict:
    """递归合并字典，override 中的值覆盖 base"""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _apply_env_overrides(cfg: dict) -> dict:
    """通过环境变量覆盖配置"""
    mapping = {
        "LOGIN_URL": ("login_url",),
        "HOME_URL": ("home_url",),
        "CAPTCHA_MODE": ("captcha", "mode"),
        "CAPTCHA_MOCK_CODE": ("captcha", "mock_code"),
        "TEST_USERNAME": ("accounts", "normal", "username"),
        "TEST_EMAIL": ("accounts", "normal", "email"),
        "TEST_PASSWORD": ("accounts", "normal", "password"),
        "HEADLESS": ("browser", "headless"),
        "BROWSER_TIMEOUT": ("browser", "default_timeout"),
    }
    for env_key, keys in mapping.items():
        value = os.environ.get(env_key)
        if value is None:
            continue
        # 布尔值转换
        if value.lower() in ("true", "1", "yes"):
            value = True
        elif value.lower() in ("false", "0", "no"):
            value = False
        # 数字转换
        elif value.isdigit():
            value = int(value)
        # 设置嵌套键
        target = cfg
        for k in keys[:-1]:
            if k not in target:
                target[k] = {}
            target = target[k]
        target[keys[-1]] = value
    return cfg


# ---- 全局配置对象 ----
defaults = _load_defaults()
merged = _load_local_overrides(defaults)
CFG = _apply_env_overrides(merged)


def get(key: str, default=None):
    """点号分隔键快速访问，如 get("accounts.normal.username")"""
    keys = key.split(".")
    value = CFG
    for k in keys:
        if isinstance(value, dict):
            value = value.get(k)
            if value is None:
                return default
        else:
            return default
    return value


def is_ready() -> bool:
    """检查必需配置是否已填充"""
    url = CFG.get("login_url", "")
    username = CFG.get("accounts", {}).get("normal", {}).get("username", "")
    password = CFG.get("accounts", {}).get("normal", {}).get("password", "")
    # 如果包含占位符，视为未配置
    placeholders = ["your-app.com", "your-app"]
    return not any(p in url for p in placeholders) and bool(username) and bool(password) and "placeholder" not in username
