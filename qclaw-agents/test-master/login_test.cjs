const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://mail.10086.cn/', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Page loaded:', page.url());
    
    // 等待登录表单出现
    await page.waitForSelector('input[type="text"], input[name="account"], #account, .login-input', { timeout: 10000 }).catch(() => console.log('Waiting for form...'));
    
    // 截图看当前状态
    await page.screenshot({ path: '/tmp/139mail_step1.png', fullPage: true });
    console.log('Screenshot saved to /tmp/139mail_step1.png');
    
    // 尝试找到所有input
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(el => ({
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        className: el.className
      }));
    });
    console.log('Inputs found:', JSON.stringify(inputs, null, 2));
    
    // 填写账号密码 - 尝试多种选择器
    const accountInput = await page.locator('input[type="text"], input[placeholder*="手机"], input[placeholder*="账号"]').first();
    const pwdInput = await page.locator('input[type="password"]').first();
    
    if (await accountInput.count() > 0) {
      await accountInput.fill('13410661953');
      console.log('Account filled');
    }
    if (await pwdInput.count() > 0) {
      await pwdInput.fill('I2ss56tb@');
      console.log('Password filled');
    }
    
    // 点击协议复选框/同意按钮
    const agreeBtn = await page.locator('.agree-checkbox, [class*="agree"], [id*="agree"], em[class*="read"]').first();
    if (await agreeBtn.count() > 0) {
      await agreeBtn.click();
      console.log('Agreement clicked');
    }
    
    await page.screenshot({ path: '/tmp/139mail_step2.png', fullPage: true });
    
    // 点击登录
    const loginBtn = await page.locator('button:has-text("登"), button:has-text("登录"), [class*="login"] button, #loginBtn').first();
    if (await loginBtn.count() > 0) {
      await loginBtn.click();
      console.log('Login clicked');
    }
    
    // 等待跳转
    await page.waitForTimeout(15000);
    
    const finalUrl = page.url();
    console.log('Final URL:', finalUrl);
    
    await page.screenshot({ path: '/tmp/139mail_step3.png', fullPage: true });
    console.log('Final screenshot saved');
    
  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: '/tmp/139mail_error.png' }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
