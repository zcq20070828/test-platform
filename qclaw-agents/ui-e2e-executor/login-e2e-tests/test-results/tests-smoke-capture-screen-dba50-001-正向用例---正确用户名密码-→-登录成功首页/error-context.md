# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/smoke/capture-screenshots.spec.ts >> 截图记录 - 测试场景证据 >> SC-001: 正向用例 - 正确用户名密码 → 登录成功首页
- Location: tests/smoke/capture-screenshots.spec.ts:23:7

# Error details

```
Error: Channel closed
```

```
Error: page.waitForURL: Test ended.
=========================== logs ===========================
waiting for navigation to "**/mock-home.html" until "load"
============================================================
```

```
Error: browserContext.close: Target page, context or browser has been closed
```