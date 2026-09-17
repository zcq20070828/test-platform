# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/smoke/logout.spec.ts >> 【P0】登出功能 - 冒烟测试 >> TC-SMOKE-LOGOUT-001: 点击退出应成功登出并跳转登录页
- Location: tests/smoke/logout.spec.ts:40:7

# Error details

```
TypeError: this.switchToPasswordLogin is not a function
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
    - generic [ref=e9]:
      - generic [ref=e10]: 密码
      - textbox "密码" [ref=e11]:
        - /placeholder: 请输入密码
    - button "登 录" [ref=e12] [cursor=pointer]
```

# Test source

```ts
  423 |    * 等待验证码倒计时完成
  424 |    * @param timeoutSeconds 倒计时总秒数
  425 |    */
  426 |   async waitForSmsCountdownComplete(timeoutSeconds: number = 60): Promise<void> {
  427 |     const startTime = Date.now();
  428 |     while (Date.now() - startTime < timeoutSeconds * 1000) {
  429 |       const countdownText = await this.smsCodeCountdown.textContent().catch(() => null);
  430 |       if (!countdownText || !/\d/.test(countdownText)) {
  431 |         return; // 倒计时已完成
  432 |       }
  433 |       await this.page.waitForTimeout(1000);
  434 |     }
  435 |     throw new Error('短信验证码倒计时超时');
  436 |   }
  437 | 
  438 |   /**
  439 |    * 刷新图形验证码
  440 |    */
  441 |   async refreshCaptcha(): Promise<this> {
  442 |     await this.captchaRefreshButton.click();
  443 |     return this;
  444 |   }
  445 | 
  446 |   /**
  447 |    * 输入图形验证码
  448 |    */
  449 |   async enterCaptcha(captcha: string): Promise<this> {
  450 |     await this.captchaInput.fill(captcha);
  451 |     return this;
  452 |   }
  453 | 
  454 |   // ============================================================
  455 |   // 登录方式切换
  456 |   // ============================================================
  457 | 
  458 |   /**
  459 |    * 切换到密码登录
  460 |    */
  461 |   async switchToPasswordLogin(): Promise<this> {
  462 |     await this.switchToPasswordLogin.click();
  463 |     await this.page.waitForTimeout(300);
  464 |     return this;
  465 |   }
  466 | 
  467 |   /**
  468 |    * 切换到短信验证码登录
  469 |    */
  470 |   async switchToSmsLogin(): Promise<this> {
  471 |     await this.switchToSmsLogin.click();
  472 |     await this.page.waitForTimeout(300);
  473 |     return this;
  474 |   }
  475 | 
  476 |   /**
  477 |    * 切换到邮箱验证码登录
  478 |    */
  479 |   async switchToEmailLogin(): Promise<this> {
  480 |     await this.switchToEmailLogin.click();
  481 |     await this.page.waitForTimeout(300);
  482 |     return this;
  483 |   }
  484 | 
  485 |   // ============================================================
  486 |   // 表单选项
  487 |   // ============================================================
  488 | 
  489 |   /**
  490 |    * 勾选/取消勾选"记住我"
  491 |    */
  492 |   async toggleRememberMe(checked: boolean = true): Promise<this> {
  493 |     const isChecked = await this.rememberMeCheckbox.isChecked();
  494 |     if (isChecked !== checked) {
  495 |       await this.rememberMeLabel.click();
  496 |     }
  497 |     return this;
  498 |   }
  499 | 
  500 |   /**
  501 |    * 检查"记住我"是否选中
  502 |    */
  503 |   async isRememberMeChecked(): Promise<boolean> {
  504 |     return this.rememberMeCheckbox.isChecked();
  505 |   }
  506 | 
  507 |   // ============================================================
  508 |   // 登录操作
  509 |   // ============================================================
  510 | 
  511 |   /**
  512 |    * 点击登录按钮
  513 |    */
  514 |   async clickLoginButton(): Promise<this> {
  515 |     await this.loginButton.click();
  516 |     return this;
  517 |   }
  518 | 
  519 |   /**
  520 |    * 执行密码登录
  521 |    */
  522 |   async loginWithPassword(credentials: LoginCredentials): Promise<this> {
> 523 |     await this.switchToPasswordLogin().catch(() => {}); // 如果已是密码登录则跳过
      |                ^ TypeError: this.switchToPasswordLogin is not a function
  524 |     await this.enterAccount(credentials.account || credentials.phone || credentials.email || '');
  525 |     await this.enterPassword(credentials.password || '');
  526 |     if (credentials.rememberMe) {
  527 |       await this.toggleRememberMe(true);
  528 |     }
  529 |     await this.clickLoginButton();
  530 |     return this;
  531 |   }
  532 | 
  533 |   /**
  534 |    * 执行短信验证码登录
  535 |    */
  536 |   async loginWithSmsCode(phone: string, code: string): Promise<this> {
  537 |     await this.switchToSmsLogin().catch(() => {});
  538 |     await this.enterPhone(phone);
  539 |     await this.clickGetSmsCode();
  540 |     await this.enterSmsCode(code);
  541 |     await this.clickLoginButton();
  542 |     return this;
  543 |   }
  544 | 
  545 |   /**
  546 |    * 执行邮箱验证码登录
  547 |    */
  548 |   async loginWithEmailCode(email: string, code: string): Promise<this> {
  549 |     await this.switchToEmailLogin().catch(() => {});
  550 |     await this.enterEmail(email);
  551 |     await this.enterSmsCode(code); // 复用短信验证码输入框
  552 |     await this.clickLoginButton();
  553 |     return this;
  554 |   }
  555 | 
  556 |   // ============================================================
  557 |   // 第三方登录
  558 |   // ============================================================
  559 | 
  560 |   /**
  561 |    * 点击微信登录（触发授权弹窗）
  562 |    */
  563 |   async clickWechatLogin(): Promise<Frame | null> {
  564 |     await this.wechatLoginButton.click();
  565 |     // 等待微信授权弹窗
  566 |     try {
  567 |       const popup = this.page.waitForEvent('popup', { timeout: 10000 });
  568 |       return await popup;
  569 |     } catch {
  570 |       return null;
  571 |     }
  572 |   }
  573 | 
  574 |   /**
  575 |    * 点击Google登录
  576 |    */
  577 |   async clickGoogleLogin(): Promise<void> {
  578 |     await this.googleLoginButton.click();
  579 |   }
  580 | 
  581 |   /**
  582 |    * 点击Apple登录
  583 |    */
  584 |   async clickAppleLogin(): Promise<void> {
  585 |     await this.appleLoginButton.click();
  586 |   }
  587 | 
  588 |   // ============================================================
  589 |   // 辅助链接
  590 |   // ============================================================
  591 | 
  592 |   /**
  593 |    * 点击"忘记密码"链接
  594 |    */
  595 |   async clickForgotPassword(): Promise<void> {
  596 |     await this.forgotPasswordLink.click();
  597 |   }
  598 | 
  599 |   /**
  600 |    * 点击"注册"链接
  601 |    */
  602 |   async clickRegister(): Promise<void> {
  603 |     await this.registerLink.click();
  604 |   }
  605 | 
  606 |   // ============================================================
  607 |   // 状态检查
  608 |   // ============================================================
  609 | 
  610 |   /**
  611 |    * 检查登录按钮是否可见
  612 |    */
  613 |   async isLoginButtonVisible(): Promise<boolean> {
  614 |     return this.loginButton.isVisible();
  615 |   }
  616 | 
  617 |   /**
  618 |    * 检查登录按钮是否可用（未被禁用）
  619 |    */
  620 |   async isLoginButtonEnabled(): Promise<boolean> {
  621 |     const isDisabled = await this.loginButton.getAttribute('disabled');
  622 |     const isLoading = await this.loginButtonLoading.isVisible().catch(() => false);
  623 |     return !isDisabled && !isLoading;
```