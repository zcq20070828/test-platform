/**
 * HomePage - 登录成功后的首页对象模型
 * 
 * 职责：封装登录成功后的首页元素和验证方法
 */

import { type Page, type Locator, expect } from '@playwright/test';

export class HomePage {
  readonly page: Page;

  // === 头部导航栏 ===
  readonly header: Locator;
  readonly logo: Locator;
  readonly userAvatar: Locator;
  readonly userMenu: Locator;
  readonly userName: Locator;

  // === 用户菜单 ===
  readonly profileLink: Locator;
  readonly settingsLink: Locator;
  readonly logoutButton: Locator;
  readonly logoutConfirmButton: Locator;

  // === 退出登录 ===
  readonly logoutMenuItem: Locator;
  readonly logoutConfirmModal: Locator;
  readonly logoutCancelButton: Locator;

  // === 页面内容 ===
  readonly welcomeMessage: Locator;
  readonly pageContent: Locator;
  readonly dashboardContent: Locator;

  // === 状态 ===
  readonly isLoggedIn: Locator;
  readonly sessionIndicator: Locator;

  constructor(page: Page) {
    this.page = page;

    // === 头部导航栏 ===
    this.header = page.locator('header, nav, .navbar, .header');
    this.logo = page.locator('header .logo, nav .logo, [data-testid="logo"]');
    this.userAvatar = page.locator(
      '[data-testid="user-avatar"], .user-avatar, header .avatar, img[alt*="avatar"]'
    );
    this.userMenu = page.locator(
      '[data-testid="user-menu"], .user-menu, header .user-menu, header .dropdown'
    );
    this.userName = page.locator(
      '[data-testid="user-name"], .user-name, header .username, header .nickname'
    );

    // === 用户菜单项 ===
    this.profileLink = page.locator(
      'a:has-text("个人中心"), a:has-text("我的资料"), [data-testid="profile-link"]'
    );
    this.settingsLink = page.locator(
      'a:has-text("设置"), [data-testid="settings-link"], .settings a'
    );
    this.logoutButton = page.locator(
      'button:has-text("退出"), button:has-text("登出"), ' +
      'a:has-text("退出登录"), [data-testid="logout-button"], .logout button'
    );
    this.logoutMenuItem = page.locator(
      '[data-testid="logout-menu-item"], .logout-menu-item, ' +
      '.dropdown-menu a:has-text("退出")'
    );

    // === 退出确认弹窗 ===
    this.logoutConfirmModal = page.locator(
      '[data-testid="logout-confirm-modal"], .logout-confirm-modal, ' +
      '.modal:has-text("确认退出"), .confirm-modal'
    );
    this.logoutConfirmButton = page.locator(
      '[data-testid="logout-confirm"], .logout-confirm, button:has-text("确认退出"), ' +
      'button:has-text("确定退出")'
    );
    this.logoutCancelButton = page.locator(
      '.logout-confirm-modal button:has-text("取消"), ' +
      'button:has-text("取消退出"), .confirm-modal button:has-text("取消")'
    );

    // === 页面内容 ===
    this.welcomeMessage = page.locator(
      '[data-testid="welcome-message"], .welcome, h1:has-text("欢迎")'
    );
    this.pageContent = page.locator('main, .main-content, .page-content, [role="main"]');
    this.dashboardContent = page.locator(
      '.dashboard, .home-content, [data-testid="dashboard"]'
    );

    // === 状态指示器 ===
    this.isLoggedIn = page.locator(
      '[data-testid="login-status"]:has-text("已登录"), ' +
      '.login-status:has-text("已登录"), header .logged-in'
    );
    this.sessionIndicator = page.locator(
      '[data-testid="session-indicator"], .session-info'
    );
  }

  // ============================================================
  // 页面导航和状态
  // ============================================================

  /**
   * 验证用户已登录（核心断言）
   */
  async verifyLoggedIn(): Promise<void> {
    // 检查URL是否已跳转
    await expect(this.page).not.toHaveURL(/\/login/);
    
    // 检查用户菜单是否可见
    await expect(this.userMenu).toBeVisible({ timeout: 10000 });
    
    // 检查session indicator
    const sessionVisible = await this.isLoggedIn.isVisible().catch(() => false);
    if (!sessionVisible) {
      // 如果没有session indicator，至少检查userAvatar
      await expect(this.userAvatar).toBeVisible();
    }
  }

  /**
   * 验证用户已退出
   */
  async verifyLoggedOut(): Promise<void> {
    // 检查是否跳转回登录页
    await expect(this.page).toHaveURL(/\/login/);
  }

  /**
   * 等待页面加载完成
   */
  async waitForPageReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    await expect(this.pageContent).toBeVisible({ timeout: 10000 });
  }

  /**
   * 获取当前登录用户名
   */
  async getLoggedInUsername(): Promise<string | null> {
    if (await this.userName.isVisible()) {
      return this.userName.textContent();
    }
    if (await this.userAvatar.isVisible()) {
      // 如果用户名不可见，尝试hover显示
      await this.userMenu.hover();
      await this.page.waitForTimeout(300);
      return this.userName.textContent();
    }
    return null;
  }

  // ============================================================
  // 用户菜单操作
  // ============================================================

  /**
   * 点击用户菜单
   */
  async openUserMenu(): Promise<this> {
    await this.userMenu.click();
    await this.page.waitForTimeout(200);
    return this;
  }

  /**
   * 悬停用户菜单（显示下拉）
   */
  async hoverUserMenu(): Promise<this> {
    await this.userMenu.hover();
    await this.page.waitForTimeout(300);
    return this;
  }

  /**
   * 点击个人中心
   */
  async clickProfile(): Promise<void> {
    await this.openUserMenu();
    await this.profileLink.click();
  }

  /**
   * 点击设置
   */
  async clickSettings(): Promise<void> {
    await this.openUserMenu();
    await this.settingsLink.click();
  }

  // ============================================================
  // 退出登录
  // ============================================================

  /**
   * 执行退出登录（带确认）
   */
  async logout(confirm: boolean = true): Promise<void> {
    // 打开用户菜单
    await this.openUserMenu();
    
    // 点击退出
    await this.logoutMenuItem.click();
    
    // 等待确认弹窗
    if (await this.logoutConfirmModal.isVisible({ timeout: 3000 }).catch(() => false)) {
      if (confirm) {
        await this.logoutConfirmButton.click();
      } else {
        await this.logoutCancelButton.click();
      }
    }
    
    // 等待退出完成
    await this.page.waitForURL(/\/login/, { timeout: 10000 });
    await this.verifyLoggedOut();
  }

  /**
   * 直接退出（无确认弹窗）
   */
  async logoutDirect(): Promise<void> {
    await this.openUserMenu();
    await this.logoutMenuItem.click();
    await this.page.waitForURL(/\/login/, { timeout: 10000 });
  }

  /**
   * 取消退出登录
   */
  async cancelLogout(): Promise<void> {
    await this.openUserMenu();
    await this.logoutMenuItem.click();
    
    if (await this.logoutConfirmModal.isVisible()) {
      await this.logoutCancelButton.click();
    }
    
    // 确认仍在首页
    await expect(this.page).not.toHaveURL(/\/login/);
  }

  // ============================================================
  // Cookie和Session验证
  // ============================================================

  /**
   * 获取登录Session Cookie
   */
  async getLoginCookie(): Promise<string | null> {
    const cookies = await this.page.context().cookies();
    const sessionCookie = cookies.find(c => 
      c.name.includes('session') || 
      c.name.includes('token') || 
      c.name.includes('auth')
    );
    return sessionCookie?.value || null;
  }

  /**
   * 检查是否记住了登录状态
   */
  async isRememberedLogin(): Promise<boolean> {
    const cookies = await this.page.context().cookies();
    const rememberCookie = cookies.find(c => 
      c.name.includes('remember') || 
      c.name.includes('persistent')
    );
    return !!rememberCookie;
  }

  /**
   * 清除登录Cookie
   */
  async clearLoginCookies(): Promise<void> {
    await this.page.context().clearCookies();
  }

  // ============================================================
  // 验证欢迎消息
  // ============================================================

  /**
   * 验证欢迎消息包含用户名
   */
  async verifyWelcomeMessage(username: string): Promise<void> {
    await expect(this.welcomeMessage).toContainText(username);
  }

  /**
   * 获取欢迎消息文本
   */
  async getWelcomeMessage(): Promise<string | null> {
    if (await this.welcomeMessage.isVisible()) {
      return this.welcomeMessage.textContent();
    }
    return null;
  }
}
