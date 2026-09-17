# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/smoke/login-core-scenarios.spec.ts >> 登录模块核心UI/E2E测试 >> TC-LOGIN-001: 正确用户名+正确密码应登录成功并跳转首页
- Location: tests/smoke/login-core-scenarios.spec.ts:70:7

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