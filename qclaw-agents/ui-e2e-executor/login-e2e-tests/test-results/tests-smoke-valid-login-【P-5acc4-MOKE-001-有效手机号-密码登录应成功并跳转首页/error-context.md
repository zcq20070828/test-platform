# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/smoke/valid-login.spec.ts >> 【P0】有效登录 - 冒烟测试 >> TC-SMOKE-001: 有效手机号+密码登录应成功并跳转首页
- Location: tests/smoke/valid-login.spec.ts:38:7

# Error details

```
TypeError: url.pathname is not a function
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - heading "用户登录" [level=1] [ref=e4]
  - generic [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]: 用户名
      - textbox "用户名" [ref=e8]:
        - /placeholder: 请输入用户名
        - text: "13800138000"
    - generic [ref=e9]:
      - generic [ref=e10]: 密码
      - textbox "密码" [ref=e11]:
        - /placeholder: 请输入密码
        - text: Test@123
    - button "登录中..." [disabled] [ref=e12]
```

# Test source

```ts
  1   | /**
  2   |  * valid-login.spec.ts - 有效登录冒烟测试
  3   |  * 
  4   |  * 测试级别: P0
  5   |  * 覆盖模块: M-001 用户名/密码登录
  6   |  * 
  7   |  * 测试场景：
  8   |  * 1. 有效账号密码登录 → 登录成功 → 跳转首页
  9   |  * 2. 记住我功能 → 关闭浏览器 → 重新打开 → 自动登录
  10  |  */
  11  | 
  12  | import { test, expect, Page, request } from '@playwright/test';
  13  | import { LoginPage } from '../../page-objects/LoginPage';
  14  | import { HomePage } from '../../page-objects/HomePage';
  15  | import { TEST_USERS, URLS, EXPECTED_POST_LOGIN_PATHS } from '../../utils/constants';
  16  | 
  17  | /**
  18  |  * Test Fixture: 创建已登录页面上下文
  19  |  */
  20  | test.describe.configure({ mode: 'serial' });
  21  | 
  22  | test.describe('【P0】有效登录 - 冒烟测试', () => {
  23  | 
  24  |   let loginPage: LoginPage;
  25  |   let homePage: HomePage;
  26  | 
  27  |   test.beforeEach(async ({ page }) => {
  28  |     loginPage = new LoginPage(page, URLS.BASE);
  29  |     homePage = new HomePage(page);
  30  |     
  31  |     // 导航到登录页
  32  |     await loginPage.navigate();
  33  |   });
  34  | 
  35  |   // ============================================================
  36  |   // TC-SMOKE-001: 有效手机号+密码登录
  37  |   // ============================================================
  38  |   test('TC-SMOKE-001: 有效手机号+密码登录应成功并跳转首页', async ({ page }) => {
  39  |     const loginPage = new LoginPage(page, URLS.BASE);
  40  |     const homePage = new HomePage(page);
  41  | 
  42  |     // Step 1: 输入有效手机号
  43  |     await loginPage.enterAccount(TEST_USERS.phone);
  44  | 
  45  |     // Step 2: 输入正确密码
  46  |     await loginPage.enterPassword(TEST_USERS.password);
  47  | 
  48  |     // Step 3: 点击登录按钮
  49  |     await loginPage.clickLoginButton();
  50  | 
  51  |     // Step 4: 等待登录成功跳转
  52  |     await page.waitForURL(url => {
> 53  |       const pathname = url.pathname();
      |                            ^ TypeError: url.pathname is not a function
  54  |       return EXPECTED_POST_LOGIN_PATHS.some(p => pathname.includes(p.replace('/', '')));
  55  |     }, { timeout: 15000 });
  56  | 
  57  |     // Step 5: 验证登录成功
  58  |     await homePage.verifyLoggedIn();
  59  | 
  60  |     // 额外验证：检查用户菜单可见
  61  |     await expect(homePage.userMenu).toBeVisible();
  62  | 
  63  |     // 额外验证：检查欢迎消息或用户信息
  64  |     const welcomeOrName = await Promise.all([
  65  |       homePage.welcomeMessage.isVisible().catch(() => false),
  66  |       homePage.userName.isVisible().catch(() => false),
  67  |     ]);
  68  |     expect(welcomeOrName.some(Boolean)).toBeTruthy();
  69  |   });
  70  | 
  71  |   // ============================================================
  72  |   // TC-SMOKE-002: 有效邮箱+密码登录
  73  |   // ============================================================
  74  |   test('TC-SMOKE-002: 有效邮箱+密码登录应成功并跳转首页', async ({ page }) => {
  75  |     const loginPage = new LoginPage(page, URLS.BASE);
  76  |     const homePage = new HomePage(page);
  77  | 
  78  |     // Step 1: 输入有效邮箱
  79  |     await loginPage.enterAccount(TEST_USERS.email);
  80  | 
  81  |     // Step 2: 输入正确密码
  82  |     await loginPage.enterPassword(TEST_USERS.password);
  83  | 
  84  |     // Step 3: 点击登录按钮
  85  |     await loginPage.clickLoginButton();
  86  | 
  87  |     // Step 4: 等待登录成功
  88  |     await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });
  89  | 
  90  |     // Step 5: 验证登录成功
  91  |     await homePage.verifyLoggedIn();
  92  |   });
  93  | 
  94  |   // ============================================================
  95  |   // TC-SMOKE-003: 记住我功能 - Session持久化
  96  |   // ============================================================
  97  |   test('TC-SMOKE-003: 勾选"记住我"后登录应保持会话', async ({ page, context }) => {
  98  |     const loginPage = new LoginPage(page, URLS.BASE);
  99  |     const homePage = new HomePage(page);
  100 | 
  101 |     // Step 1: 输入账号密码
  102 |     await loginPage.enterAccount(TEST_USERS.phone);
  103 |     await loginPage.enterPassword(TEST_USERS.password);
  104 | 
  105 |     // Step 2: 勾选"记住我"
  106 |     await loginPage.toggleRememberMe(true);
  107 | 
  108 |     // Step 3: 登录
  109 |     await loginPage.clickLoginButton();
  110 | 
  111 |     // Step 4: 等待登录成功
  112 |     await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });
  113 |     await homePage.verifyLoggedIn();
  114 | 
  115 |     // Step 5: 获取Session Cookie
  116 |     const loginCookie = await homePage.getLoginCookie();
  117 |     expect(loginCookie).toBeTruthy();
  118 | 
  119 |     // Step 6: 检查Remember Cookie
  120 |     const isRemembered = await homePage.isRememberedLogin();
  121 |     expect(isRemembered).toBeTruthy();
  122 | 
  123 |     // Step 7: 关闭浏览器（通过新建上下文模拟）
  124 |     // 注意：实际测试中可能需要持久化cookie到文件
  125 |     // 此处简化处理
  126 |   });
  127 | 
  128 |   // ============================================================
  129 |   // TC-SMOKE-004: 键盘快捷登录
  130 |   // ============================================================
  131 |   test('TC-SMOKE-004: Tab+Enter键盘快捷登录应成功', async ({ page }) => {
  132 |     const loginPage = new LoginPage(page, URLS.BASE);
  133 |     const homePage = new HomePage(page);
  134 | 
  135 |     // Step 1: 执行快捷登录序列
  136 |     await loginPage.quickLoginSequence({
  137 |       account: TEST_USERS.phone,
  138 |       password: TEST_USERS.password,
  139 |     });
  140 | 
  141 |     // Step 2: 等待登录成功
  142 |     await page.waitForURL(url => !url.pathname().includes('/login'), { timeout: 15000 });
  143 |     await homePage.verifyLoggedIn();
  144 |   });
  145 | 
  146 |   // ============================================================
  147 |   // TC-SMOKE-005: 登录后后退按钮行为
  148 |   // ============================================================
  149 |   test('TC-SMOKE-005: 登录成功后后退按钮不应返回登录页', async ({ page }) => {
  150 |     const loginPage = new LoginPage(page, URLS.BASE);
  151 |     const homePage = new HomePage(page);
  152 | 
  153 |     // Step 1: 登录成功
```