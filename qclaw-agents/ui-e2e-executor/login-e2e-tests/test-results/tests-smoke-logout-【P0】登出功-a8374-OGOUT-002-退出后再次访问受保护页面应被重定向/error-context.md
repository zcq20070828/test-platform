# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/smoke/logout.spec.ts >> 【P0】登出功能 - 冒烟测试 >> TC-SMOKE-LOGOUT-002: 退出后再次访问受保护页面应被重定向
- Location: tests/smoke/logout.spec.ts:58:7

# Error details

```
Error: page.goto: Target page, context or browser has been closed
Call log:
  - navigating to "http://localhost:3000/mock-login.html", waiting until "networkidle"

```

```
Error: write EPIPE
```