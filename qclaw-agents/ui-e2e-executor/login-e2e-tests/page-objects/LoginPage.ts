/**
 * LoginPage - 登录页面对象模型 (Page Object Model)
 * 
 * 职责：封装登录页面的所有元素定位器和交互方法
 * 设计原则：
 *   - 每个方法只做一件事
 *   - 定位器优先使用 role/name/id，避免脆弱的CSS/XPath
 *   - 所有方法返回 this 支持链式调用
 *   - 方法名使用业务语言而非技术语言
 * 
 * 页面结构：
 *   - 账号输入区（手机号/邮箱/用户名）
 *   - 密码输入区
 *   - 验证码输入区
 *   - 登录按钮
 *   - 第三方登录区
 *   - 辅助链接区（忘记密码/注册）
 *   - 错误提示区
 *   - 加载状态区
 */

import { type Page, type Locator, type Frame, expect } from '@playwright/test';
import { ERROR_MESSAGES, REGEX_PATTERNS } from '../utils/constants';

/**
 * 登录方式枚举
 */
export enum LoginMethod {
  PASSWORD = 'password',           // 账号+密码登录
  SMS_CODE = 'sms_code',          // 手机号+短信验证码
  EMAIL_CODE = 'email_code',      // 邮箱+邮件验证码
}

/**
 * 登录表单数据
 */
export interface LoginCredentials {
  account?: string;
  phone?: string;
  email?: string;
  password?: string;
  smsCode?: string;
  emailCode?: string;
  rememberMe?: boolean;
}

/**
 * 错误提示类型
 */
export enum ErrorType {
  ACCOUNT_REQUIRED = 'account_required',
  PASSWORD_REQUIRED = 'password_required',
  SMS_CODE_REQUIRED = 'sms_code_required',
  ACCOUNT_NOT_EXIST = 'account_not_exist',
  WRONG_PASSWORD = 'wrong_password',
  WRONG_SMS_CODE = 'wrong_sms_code',
  ACCOUNT_LOCKED = 'account_locked',
  NETWORK_ERROR = 'network_error',
  RATE_LIMITED = 'rate_limited',
  SESSION_EXPIRED = 'session_expired',
}

export class LoginPage {
  // === 基础配置 ===
  readonly page: Page;
  readonly baseURL: string;

  // === 主容器 ===
  readonly container: Locator;
  readonly form: Locator;

  // === 账号输入区 ===
  readonly accountInput: Locator;
  readonly phoneInput: Locator;
  readonly emailInput: Locator;
  readonly accountInputError: Locator;

  // === 密码输入区 ===
  readonly passwordInput: Locator;
  readonly showPasswordToggle: Locator;
  readonly passwordInputError: Locator;

  // === 验证码输入区 ===
  readonly smsCodeInput: Locator;
  readonly smsCodeInputError: Locator;
  readonly getSmsCodeButton: Locator;
  readonly smsCodeCountdown: Locator;

  // === 登录按钮 ===
  readonly loginButton: Locator;
  readonly loginButtonLoading: Locator;

  // === 表单选项 ===
  readonly rememberMeCheckbox: Locator;
  readonly rememberMeLabel: Locator;

  // === 第三方登录 ===
  readonly wechatLoginButton: Locator;
  readonly googleLoginButton: Locator;
  readonly appleLoginButton: Locator;

  // === 辅助链接 ===
  readonly forgotPasswordLink: Locator;
  readonly registerLink: Locator;
  readonly backToLoginLink: Locator;

  // === 切换登录方式 ===
  readonly switchToPasswordLogin: Locator;
  readonly switchToSmsLogin: Locator;
  readonly switchToEmailLogin: Locator;

  // === 错误和提示 ===
  readonly globalErrorMessage: Locator;
  readonly successMessage: Locator;
  readonly toastMessage: Locator;

  // === 页面状态 ===
  readonly loadingOverlay: Locator;
  readonly pageSpinner: Locator;

  // === Logo和品牌 ===
  readonly logo: Locator;
  readonly pageTitle: Locator;
  readonly pageSubtitle: Locator;

  // === 图形验证码（防暴力破解） ===
  readonly captchaInput: Locator;
  readonly captchaImage: Locator;
  readonly captchaRefreshButton: Locator;

  constructor(page: Page, baseURL?: string) {
    this.page = page;
    this.baseURL = baseURL || '';

    // === 主容器 ===
    this.container = page.locator('[data-testid="login-container"], .login-container, #login');
    this.form = page.locator('form[action*="login"], .login-form, [data-testid="login-form"]');

    // === 账号输入区 ===
    // 通用账号输入（支持手机号/邮箱/用户名自动识别）
    this.accountInput = page.locator(
      '[data-testid="account-input"], input[name="account"], input[name="username"], ' +
      '#account, #username, input[placeholder*="账号"], input[placeholder*="手机号"]'
    );
    this.phoneInput = page.locator(
      '[data-testid="phone-input"], input[name="phone"], input[type="tel"], ' +
      '#phone, input[placeholder*="手机号"][placeholder*="请"]'
    );
    this.emailInput = page.locator(
      '[data-testid="email-input"], input[name="email"], input[type="email"], ' +
      '#email, input[placeholder*="邮箱"]'
    );
    this.accountInputError = page.locator(
      '[data-testid="account-error"], .account-error, #account-error, ' +
      '[data-testid="phone-error"], .phone-error'
    );

    // === 密码输入区 ===
    this.passwordInput = page.locator(
      '[data-testid="password-input"], input[name="password"], input[type="password"], ' +
      '#password, input[id*="password"]'
    );
    this.showPasswordToggle = page.locator(
      '[data-testid="show-password"], .show-password, [aria-label*="显示密码"], ' +
      '.password-toggle, .toggle-password'
    );
    this.passwordInputError = page.locator(
      '[data-testid="password-error"], .password-error, #password-error'
    );

    // === 验证码输入区 ===
    this.smsCodeInput = page.locator(
      '[data-testid="sms-code-input"], input[name="smsCode"], input[name="code"], ' +
      '#smsCode, input[placeholder*="验证码"]'
    );
    this.smsCodeInputError = page.locator(
      '[data-testid="sms-code-error"], .sms-code-error'
    );
    this.getSmsCodeButton = page.locator(
      '[data-testid="get-sms-code"], button:has-text("获取验证码"), ' +
      'button:has-text("发送验证码"), .get-code-btn, [data-action="send-sms"]'
    );
    this.smsCodeCountdown = page.locator(
      '[data-testid="sms-countdown"], .countdown, .sms-countdown, ' +
      'button:has-text("重新发送")'
    );

    // === 登录按钮 ===
    this.loginButton = page.locator(
      '[data-testid="login-button"], button[type="submit"], ' +
      'button:has-text("登录"), .login-btn, .btn-login, [data-action="login"]'
    );
    this.loginButtonLoading = page.locator(
      '.login-btn.loading, button.loading, [data-state="loading"]'
    );

    // === 表单选项 ===
    this.rememberMeCheckbox = page.locator(
      '[data-testid="remember-me"], input[name="rememberMe"], ' +
      'input[type="checkbox"][id*="remember"], .remember-me input'
    );
    this.rememberMeLabel = page.locator(
      'label:has-text("记住"), .remember-me label, [for*="remember"]'
    );

    // === 第三方登录 ===
    this.wechatLoginButton = page.locator(
      '[data-testid="wechat-login"], .wechat-login, button:has-text("微信登录"), ' +
      '[data-action="wechat-login"]'
    );
    this.googleLoginButton = page.locator(
      '[data-testid="google-login"], .google-login, button:has-text("Google"), ' +
      '[data-action="google-login"]'
    );
    this.appleLoginButton = page.locator(
      '[data-testid="apple-login"], .apple-login, button:has-text("Apple"), ' +
      '[data-action="apple-login"]'
    );

    // === 辅助链接 ===
    this.forgotPasswordLink = page.locator(
      'a:has-text("忘记密码"), a:has-text("找回密码"), ' +
      '[data-testid="forgot-password"], .forgot-password a'
    );
    this.registerLink = page.locator(
      'a:has-text("注册"), a:has-text("免费注册"), ' +
      '[data-testid="register-link"], .register-link a'
    );
    this.backToLoginLink = page.locator(
      'a:has-text("返回登录"), .back-to-login a'
    );

    // === 切换登录方式 ===
    this.switchToPasswordLogin = page.locator(
      '[data-testid="switch-password"], button:has-text("密码登录")'
    );
    this.switchToSmsLogin = page.locator(
      '[data-testid="switch-sms"], button:has-text("验证码登录"), ' +
      'button:has-text("短信登录")'
    );
    this.switchToEmailLogin = page.locator(
      '[data-testid="switch-email"], button:has-text("邮箱登录")'
    );

    // === 错误和提示 ===
    this.globalErrorMessage = page.locator(
      '[data-testid="global-error"], .global-error, .form-error, ' +
      '.error-message, [role="alert"]:has-text("错误"), [role="alert"]:has-text("失败")'
    );
    this.successMessage = page.locator(
      '[data-testid="success-message"], .success-message, [role="status"]:has-text("成功")'
    );
    this.toastMessage = page.locator(
      '.toast, .alert, .notification, [role="alert"]'
    );

    // === 页面状态 ===
    this.loadingOverlay = page.locator(
      '.loading-overlay, .page-loading, [data-testid="loading"]'
    );
    this.pageSpinner = page.locator(
      '.spinner, .page-spinner, .loading-spinner'
    );

    // === Logo和品牌 ===
    this.logo = page.locator(
      '[data-testid="logo"], .logo img, .logo, a.logo, header .logo'
    );
    this.pageTitle = page.locator(
      'h1, .page-title, [data-testid="page-title"]'
    );
    this.pageSubtitle = page.locator(
      '.page-subtitle, [data-testid="page-subtitle"], p.subtitle'
    );

    // === 图形验证码 ===
    this.captchaInput = page.locator(
      '[data-testid="captcha-input"], input[name="captcha"], input[id*="captcha"]'
    );
    this.captchaImage = page.locator(
      '[data-testid="captcha-image"], .captcha-image, img[id*="captcha"]'
    );
    this.captchaRefreshButton = page.locator(
      '[data-testid="captcha-refresh"], .captcha-refresh, button:has-text("刷新验证码")'
    );
  }

  // ============================================================
  // 页面导航
  // ============================================================

  /**
   * 导航到登录页面
   */
  async navigate(path: string = '/mock-login.html'): Promise<void> {
    const url = this.baseURL ? `${this.baseURL}${path}` : path;
    await this.page.goto(url, { waitUntil: 'networkidle' });
    await this.waitForPageReady();
  }

  /**
   * 等待页面加载完成
   */
  async waitForPageReady(): Promise<void> {
    // 等待加载遮罩消失
    await this.page.waitForSelector('.loading-overlay, .page-loading', {
      state: 'hidden',
      timeout: 10000,
    }).catch(() => {});

    // 等待表单可见
    await this.form.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * 刷新页面
   */
  async refresh(): Promise<void> {
    await this.page.reload({ waitUntil: 'networkidle' });
    await this.waitForPageReady();
  }

  // ============================================================
  // 账号输入
  // ============================================================

  /**
   * 输入账号（自动识别手机号/邮箱）
   */
  async enterAccount(account: string): Promise<this> {
    await this.accountInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.accountInput.fill(account);
    return this;
  }

  /**
   * 输入手机号
   */
  async enterPhone(phone: string): Promise<this> {
    await this.phoneInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.phoneInput.fill(phone);
    return this;
  }

  /**
   * 输入邮箱
   */
  async enterEmail(email: string): Promise<this> {
    await this.emailInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.emailInput.fill(email);
    return this;
  }

  /**
   * 清空账号输入
   */
  async clearAccount(): Promise<this> {
    await this.accountInput.clear();
    return this;
  }

  // ============================================================
  // 密码输入
  // ============================================================

  /**
   * 输入密码
   */
  async enterPassword(password: string): Promise<this> {
    await this.passwordInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.passwordInput.fill(password);
    return this;
  }

  /**
   * 清空密码输入
   */
  async clearPassword(): Promise<this> {
    await this.passwordInput.clear();
    return this;
  }

  /**
   * 切换密码可见性
   */
  async togglePasswordVisibility(): Promise<this> {
    await this.showPasswordToggle.waitFor({ state: 'visible', timeout: 5000 });
    await this.showPasswordToggle.click();
    return this;
  }

  /**
   * 检查密码是否可见（明文显示）
   */
  async isPasswordVisible(): Promise<boolean> {
    const inputType = await this.passwordInput.getAttribute('type');
    return inputType === 'text';
  }

  // ============================================================
  // 验证码操作
  // ============================================================

  /**
   * 输入短信验证码
   */
  async enterSmsCode(code: string): Promise<this> {
    await this.smsCodeInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.smsCodeInput.fill(code);
    return this;
  }

  /**
   * 点击获取短信验证码
   */
  async clickGetSmsCode(): Promise<this> {
    await this.getSmsCodeButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.getSmsCodeButton.click();
    return this;
  }

  /**
   * 等待验证码倒计时完成
   * @param timeoutSeconds 倒计时总秒数
   */
  async waitForSmsCountdownComplete(timeoutSeconds: number = 60): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      const countdownText = await this.smsCodeCountdown.textContent().catch(() => null);
      if (!countdownText || !/\d/.test(countdownText)) {
        return; // 倒计时已完成
      }
      await this.page.waitForTimeout(1000);
    }
    throw new Error('短信验证码倒计时超时');
  }

  /**
   * 刷新图形验证码
   */
  async refreshCaptcha(): Promise<this> {
    await this.captchaRefreshButton.click();
    return this;
  }

  /**
   * 输入图形验证码
   */
  async enterCaptcha(captcha: string): Promise<this> {
    await this.captchaInput.fill(captcha);
    return this;
  }

  // ============================================================
  // 登录方式切换
  // ============================================================

  /**
   * 切换到密码登录
   */
  async switchToPasswordLogin(): Promise<this> {
    await this.switchToPasswordLogin.click();
    await this.page.waitForTimeout(300);
    return this;
  }

  /**
   * 切换到短信验证码登录
   */
  async switchToSmsLogin(): Promise<this> {
    await this.switchToSmsLogin.click();
    await this.page.waitForTimeout(300);
    return this;
  }

  /**
   * 切换到邮箱验证码登录
   */
  async switchToEmailLogin(): Promise<this> {
    await this.switchToEmailLogin.click();
    await this.page.waitForTimeout(300);
    return this;
  }

  // ============================================================
  // 表单选项
  // ============================================================

  /**
   * 勾选/取消勾选"记住我"
   */
  async toggleRememberMe(checked: boolean = true): Promise<this> {
    const isChecked = await this.rememberMeCheckbox.isChecked();
    if (isChecked !== checked) {
      await this.rememberMeLabel.click();
    }
    return this;
  }

  /**
   * 检查"记住我"是否选中
   */
  async isRememberMeChecked(): Promise<boolean> {
    return this.rememberMeCheckbox.isChecked();
  }

  // ============================================================
  // 登录操作
  // ============================================================

  /**
   * 点击登录按钮
   */
  async clickLoginButton(): Promise<this> {
    await this.loginButton.click();
    return this;
  }

  /**
   * 执行密码登录
   */
  async loginWithPassword(credentials: LoginCredentials): Promise<this> {
    await this.switchToPasswordLogin().catch(() => {}); // 如果已是密码登录则跳过
    await this.enterAccount(credentials.account || credentials.phone || credentials.email || '');
    await this.enterPassword(credentials.password || '');
    if (credentials.rememberMe) {
      await this.toggleRememberMe(true);
    }
    await this.clickLoginButton();
    return this;
  }

  /**
   * 执行短信验证码登录
   */
  async loginWithSmsCode(phone: string, code: string): Promise<this> {
    await this.switchToSmsLogin().catch(() => {});
    await this.enterPhone(phone);
    await this.clickGetSmsCode();
    await this.enterSmsCode(code);
    await this.clickLoginButton();
    return this;
  }

  /**
   * 执行邮箱验证码登录
   */
  async loginWithEmailCode(email: string, code: string): Promise<this> {
    await this.switchToEmailLogin().catch(() => {});
    await this.enterEmail(email);
    await this.enterSmsCode(code); // 复用短信验证码输入框
    await this.clickLoginButton();
    return this;
  }

  // ============================================================
  // 第三方登录
  // ============================================================

  /**
   * 点击微信登录（触发授权弹窗）
   */
  async clickWechatLogin(): Promise<Frame | null> {
    await this.wechatLoginButton.click();
    // 等待微信授权弹窗
    try {
      const popup = this.page.waitForEvent('popup', { timeout: 10000 });
      return await popup;
    } catch {
      return null;
    }
  }

  /**
   * 点击Google登录
   */
  async clickGoogleLogin(): Promise<void> {
    await this.googleLoginButton.click();
  }

  /**
   * 点击Apple登录
   */
  async clickAppleLogin(): Promise<void> {
    await this.appleLoginButton.click();
  }

  // ============================================================
  // 辅助链接
  // ============================================================

  /**
   * 点击"忘记密码"链接
   */
  async clickForgotPassword(): Promise<void> {
    await this.forgotPasswordLink.click();
  }

  /**
   * 点击"注册"链接
   */
  async clickRegister(): Promise<void> {
    await this.registerLink.click();
  }

  // ============================================================
  // 状态检查
  // ============================================================

  /**
   * 检查登录按钮是否可见
   */
  async isLoginButtonVisible(): Promise<boolean> {
    return this.loginButton.isVisible();
  }

  /**
   * 检查登录按钮是否可用（未被禁用）
   */
  async isLoginButtonEnabled(): Promise<boolean> {
    const isDisabled = await this.loginButton.getAttribute('disabled');
    const isLoading = await this.loginButtonLoading.isVisible().catch(() => false);
    return !isDisabled && !isLoading;
  }

  /**
   * 检查是否有加载状态
   */
  async isLoading(): Promise<boolean> {
    const hasOverlay = await this.loadingOverlay.isVisible().catch(() => false);
    const hasSpinner = await this.pageSpinner.isVisible().catch(() => false);
    const hasButtonLoading = await this.loginButtonLoading.isVisible().catch(() => false);
    return hasOverlay || hasSpinner || hasButtonLoading;
  }

  /**
   * 等待加载完成
   */
  async waitForLoadingComplete(timeout: number = 30000): Promise<void> {
    await this.page.waitForFunction(() => {
      const loadingElements = document.querySelectorAll(
        '.loading-overlay, .page-loading, .spinner, button.loading'
      );
      return Array.from(loadingElements).every(el => {
        const style = window.getComputedStyle(el);
        return style.display === 'none' || style.visibility === 'hidden' || !el.isConnected;
      });
    }, { timeout });
  }

  // ============================================================
  // 错误提示验证
  // ============================================================

  /**
   * 获取全局错误消息文本
   */
  async getGlobalErrorMessage(): Promise<string | null> {
    if (await this.globalErrorMessage.isVisible()) {
      return this.globalErrorMessage.textContent();
    }
    return null;
  }

  /**
   * 获取账号输入框错误
   */
  async getAccountError(): Promise<string | null> {
    if (await this.accountInputError.isVisible()) {
      return this.accountInputError.textContent();
    }
    return null;
  }

  /**
   * 获取密码输入框错误
   */
  async getPasswordError(): Promise<string | null> {
    if (await this.passwordInputError.isVisible()) {
      return this.passwordInputError.textContent();
    }
    return null;
  }

  /**
   * 获取验证码输入框错误
   */
  async getSmsCodeError(): Promise<string | null> {
    if (await this.smsCodeInputError.isVisible()) {
      return this.smsCodeInputError.textContent();
    }
    return null;
  }

  /**
   * 验证错误提示是否显示（期望值）
   */
  async expectErrorType(errorType: ErrorType): Promise<void> {
    const errorMap: Record<ErrorType, string> = {
      [ErrorType.ACCOUNT_REQUIRED]: ERROR_MESSAGES.ACCOUNT_REQUIRED,
      [ErrorType.PASSWORD_REQUIRED]: ERROR_MESSAGES.PASSWORD_REQUIRED,
      [ErrorType.SMS_CODE_REQUIRED]: ERROR_MESSAGES.SMS_CODE_REQUIRED,
      [ErrorType.ACCOUNT_NOT_EXIST]: ERROR_MESSAGES.ACCOUNT_NOT_EXIST,
      [ErrorType.WRONG_PASSWORD]: ERROR_MESSAGES.WRONG_PASSWORD,
      [ErrorType.WRONG_SMS_CODE]: ERROR_MESSAGES.WRONG_SMS_CODE,
      [ErrorType.ACCOUNT_LOCKED]: ERROR_MESSAGES.ACCOUNT_LOCKED,
      [ErrorType.NETWORK_ERROR]: ERROR_MESSAGES.NETWORK_ERROR,
      [ErrorType.RATE_LIMITED]: ERROR_MESSAGES.RATE_LIMITED,
      [ErrorType.SESSION_EXPIRED]: ERROR_MESSAGES.SESSION_EXPIRED,
    };

    const expectedText = errorMap[errorType];
    await expect(this.globalErrorMessage).toContainText(expectedText);
  }

  // ============================================================
  // Toast 消息验证
  // ============================================================

  /**
   * 获取Toast消息
   */
  async getToastMessage(): Promise<string | null> {
    if (await this.toastMessage.isVisible()) {
      return this.toastMessage.textContent();
    }
    return null;
  }

  /**
   * 等待Toast消息出现
   */
  async waitForToast(timeout: number = 5000): Promise<string> {
    await this.toastMessage.waitFor({ state: 'visible', timeout });
    const text = await this.toastMessage.textContent();
    await this.toastMessage.waitFor({ state: 'hidden', timeout: 5000 });
    return text || '';
  }

  // ============================================================
  // 响应式布局测试
  // ============================================================

  /**
   * 验证页面元素在当前视口中的可见性
   */
  async verifyLayoutResponsiveness(): Promise<{
    logoVisible: boolean;
    formVisible: boolean;
    loginButtonVisible: boolean;
  }> {
    return {
      logoVisible: await this.logo.isVisible(),
      formVisible: await this.form.isVisible(),
      loginButtonVisible: await this.loginButton.isVisible(),
    };
  }

  /**
   * 检查表单是否溢出视口
   */
  async isFormOverflowingViewport(): Promise<boolean> {
    const formBounds = await this.form.boundingBox();
    const viewportBounds = this.page.viewportSize();
    
    if (!formBounds || !viewportBounds) return false;
    
    return (
      formBounds.x + formBounds.width > viewportBounds.width ||
      formBounds.y + formBounds.height > viewportBounds.height
    );
  }

  // ============================================================
  // 键盘操作
  // ============================================================

  /**
   * 模拟Tab键导航
   */
  async pressTab(): Promise<void> {
    await this.page.keyboard.press('Tab');
  }

  /**
   * 模拟Enter键提交
   */
  async pressEnter(): Promise<void> {
    await this.page.keyboard.press('Enter');
  }

  /**
   * 快捷登录：Tab + 输入
   */
  async quickLoginSequence(credentials: LoginCredentials): Promise<void> {
    if (credentials.account || credentials.phone || credentials.email) {
      await this.accountInput.focus();
      await this.page.keyboard.type(credentials.account || credentials.phone || credentials.email || '');
    }
    await this.pressTab();
    if (credentials.password) {
      await this.page.keyboard.type(credentials.password);
    }
    await this.pressEnter();
  }
}
