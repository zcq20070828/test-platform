#!/usr/bin/env python3
"""139邮箱登录测试脚本 - 修正版"""
import asyncio
import os
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        try:
            await page.goto('https://mail.10086.cn/', wait_until='domcontentloaded', timeout=30000)
            print(f'Page loaded: {page.url}')
            await page.wait_for_timeout(5000)
            
            # 切换到"账号密码"标签 - 使用JS点击
            switched = await page.evaluate('''() => {
                const el = document.getElementById('accountLogin');
                if (el) { el.click(); return 'accountLogin'; }
                const el2 = document.getElementById('Account');
                if (el2) { el2.click(); return 'Account'; }
                return null;
            }''')
            if switched:
                print(f'Switched to 账号密码 via #{switched}')
                await page.wait_for_timeout(2000)
            else:
                print('WARNING: Could not find account password tab')
            
            await page.screenshot(path='/tmp/139mail_v2_step1.png', full_page=True)
            print('Screenshot 1 saved')
            
            # 填写账号 - 使用实际ID
            account_input = page.locator('#txtUser')
            pwd_input = page.locator('#txtPass')
            
            if await account_input.count() > 0:
                await account_input.fill('13410661953')
                print('Account filled')
            
            if await pwd_input.count() > 0:
                await pwd_input.fill(os.environ.get('TEST_USER_PASSWORD', ''))
                print('Password filled')
            
            # 点击同意复选框
            agree_cb = page.locator('#cbAgree, [id*="agree"], [class*="check"]').first
            if await agree_cb.count() > 0:
                await agree_cb.click()
                print('Agreement checkbox clicked')
                await page.wait_for_timeout(500)
            
            await page.screenshot(path='/tmp/139mail_v2_step2.png', full_page=True)
            
            # 点击登录按钮
            login_btn = page.locator('#btnLogin, button:has-text("登"), .loginBtn, [id*="login"]:not([id*="Log"])').first
            if await login_btn.count() > 0:
                await login_btn.click()
                print('Login clicked')
            else:
                # 尝试通过文本找
                btn = page.get_by_text('登 录')
                if await btn.count() > 0:
                    await btn.first.click()
                    print('Login clicked (by text)')
            
            # 等待跳转或验证码
            print('Waiting for response...')
            await page.wait_for_timeout(15000)
            
            final_url = page.url()
            print(f'Final URL: {final_url}')
            
            await page.screenshot(path='/tmp/139mail_v2_step3.png', full_page=True)
            print('Done - screenshot saved')
            
        except Exception as e:
            print(f'Error: {e}')
            try:
                await page.screenshot(path='/tmp/139mail_v2_error.png')
            except:
                pass
        finally:
            await browser.close()

asyncio.run(main())
