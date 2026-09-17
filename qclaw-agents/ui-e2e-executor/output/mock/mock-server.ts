/**
 * Mock 注册后端服务
 *
 * 用于 UI 表单校验测试时提供可控的 API 响应。
 * 启动: npx tsx mock/mock-server.ts
 *
 * 特性:
 *   - 正常/错误验证码模拟
 *   - 手机号格式校验
 *   - 限频规则模拟
 *   - 60秒倒计时按钮状态模拟
 */

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// ---- 内存状态 ----
const smsStore = new Map<string, { code: string; sentAt: number; count: number }>();
const userStore = new Map<string, { registered: boolean; activated: boolean }>();

// 预置已注册用户
userStore.set('13900139001', { registered: true, activated: true });
userStore.set('registered@example.com', { registered: true, activated: true });
userStore.set('inactive@example.com', { registered: true, activated: false });

// ---- 工具函数 ----
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- 1. 发送短信验证码 ----
app.post('/api/v1/register/send-sms', async (req, res) => {
  const { phone } = req.body;

  // 手机号为空
  if (!phone || typeof phone !== 'string') {
    return res.status(200).json({ code: 400, message: '手机号不能为空' });
  }

  // 格式校验
  const phoneClean = phone.replace(/[\s-]/g, '');
  if (!/^1\d{10}$/.test(phoneClean) && !/^\+86\d{11}$/.test(phoneClean)) {
    return res.status(200).json({ code: '40001', message: '手机号格式不正确' });
  }

  // 已注册
  if (userStore.get(phoneClean)?.registered) {
    return res.status(200).json({ code: '40008', message: '该手机号已被注册' });
  }

  // 限频检查: 1小时内超过5次
  const record = smsStore.get(phoneClean);
  if (record && record.count >= 5) {
    return res.status(200).json({ code: 429, message: '该手机号获取验证码次数超限' });
  }

  // 60秒内重复
  if (record && Date.now() - record.sentAt < 60_000) {
    return res.status(200).json({ code: 429, message: '请求过于频繁，请60秒后再试' });
  }

  // 正常发送
  const code = String(Math.floor(100000 + Math.random() * 900000));
  smsStore.set(phoneClean, { code, sentAt: Date.now(), count: (record?.count ?? 0) + 1 });

  console.log(`[SMS] ${phoneClean} → 验证码: ${code} （当前第${smsStore.get(phoneClean)!.count}次）`);
  return res.json({ code: 200, message: '验证码已发送', debug_code: code });
});

// ---- 2. 手机号注册 ----
app.post('/api/v1/register/phone', async (req, res) => {
  const { phone, smsCode } = req.body;

  if (!phone || !smsCode) {
    return res.status(200).json({ code: 400, message: '手机号和验证码不能为空' });
  }

  // 查找验证码
  const record = smsStore.get(phone.replace(/[\s-]/g, ''));
  if (!record) {
    return res.status(200).json({ code: '40003', message: '验证码错误' });
  }

  // 检查过期（5分钟）
  if (Date.now() - record.sentAt > 5 * 60_000) {
    return res.status(200).json({ code: '40004', message: '验证码已过期，请重新获取' });
  }

  // 校验验证码
  if (record.code !== smsCode) {
    return res.status(200).json({ code: '40003', message: '验证码错误' });
  }

  // 注册成功
  const phoneClean = phone.replace(/[\s-]/g, '');
  userStore.set(phoneClean, { registered: true, activated: true });
  return res.json({
    code: 200,
    message: '注册成功',
    data: { userId: `user_${Date.now()}`, token: 'mock_jwt_token_' + Date.now() },
  });
});

// ---- 3. 邮箱注册 ----
app.post('/api/v1/register/email', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(200).json({ code: 400, message: '邮箱和密码不能为空' });
  }

  // 邮箱格式
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(200).json({ code: '40001', message: '邮箱格式不正确' });
  }

  // 邮箱已注册
  if (userStore.get(email)?.registered) {
    return res.status(200).json({ code: '40002', message: '邮箱已存在' });
  }

  // 密码长度
  if (password.length < 8) {
    return res.status(200).json({ code: '40005', message: '密码长度不能少于8位' });
  }
  if (password.length > 20) {
    return res.status(200).json({ code: '40005', message: '密码长度不能超过20位' });
  }

  // 弱口令
  const weakPasswords = ['12345678', 'password', 'admin888', 'qwerty123', '11111111', 'abc12345'];
  if (weakPasswords.includes(password)) {
    return res.status(200).json({ code: '40006', message: '密码为常用弱口令，请更换' });
  }

  // 强度检查：必须包含字母和数字
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(200).json({ code: '40006', message: '密码强度不足，需包含字母和数字' });
  }

  // 注册成功
  userStore.set(email, { registered: true, activated: false });
  return res.json({
    code: 200,
    message: '注册成功',
    data: { userId: `user_${Date.now()}`, activationEmail: email },
  });
});

// ---- 4. 账号激活 ----
app.get('/api/v1/register/activate', (req, res) => {
  const { email, token } = req.query;

  if (!email || !token) {
    return res.status(200).json({ code: 400, message: '参数不完整' });
  }

  // 模拟激活
  const user = userStore.get(email as string);
  if (!user) {
    return res.status(200).json({ code: 404, message: '账号不存在' });
  }
  if (user.activated) {
    return res.status(200).json({ code: 200, message: '账号已激活，无需重复激活' });
  }

  user.activated = true;
  return res.json({ code: 200, message: '激活成功' });
});

// ---- 5. 登录 ----
app.post('/api/v1/login', async (req, res) => {
  const { account, password } = req.body;

  const user = userStore.get(account);
  if (!user) {
    return res.status(200).json({ code: 404, message: '账号不存在' });
  }
  if (!user.activated) {
    return res.status(200).json({ code: '40301', message: '账号未激活，请先激活后再登录' });
  }

  return res.json({
    code: 200,
    message: '登录成功',
    data: { token: 'mock_login_token_' + Date.now() },
  });
});

// ---- 6. 限频模拟（IP级别） ----
const ipRequestCount = new Map<string, { count: number; resetAt: number }>();

app.post('/api/v1/register/send-sms/rate-limit-test', (req, res) => {
  const ip = req.ip || '127.0.0.1';
  const record = ipRequestCount.get(ip) || { count: 0, resetAt: Date.now() + 60_000 };

  // 重置
  if (Date.now() > record.resetAt) {
    record.count = 0;
    record.resetAt = Date.now() + 60_000;
  }

  record.count++;
  ipRequestCount.set(ip, record);

  if (record.count > 20) {
    return res.status(429).json({ code: 429, message: '请求过于频繁，请稍后再试' });
  }

  return res.json({ code: 200, message: 'ok', attempt: record.count });
});

// ---- 7. Mock 注册 UI 页面 ----
app.get('/mock/register', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>注册</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      display: flex; justify-content: center; align-items: center; min-height: 100vh;
    }
    .container {
      width: 375px; background: #fff; min-height: 100vh; padding: 24px 20px;
    }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; color: #1a1a1a; }
    .subtitle { font-size: 14px; color: #8e8e93; margin-bottom: 32px; }
    .tab-bar {
      display: flex; border-bottom: 1px solid #e5e5ea; margin-bottom: 24px;
    }
    .tab {
      flex: 1; text-align: center; padding: 12px 0; font-size: 15px;
      color: #8e8e93; cursor: pointer; border-bottom: 2px solid transparent;
    }
    .tab.active { color: #007aff; border-bottom-color: #007aff; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: #3c3c43; margin-bottom: 6px; font-weight: 500; }
    .input-wrapper {
      display: flex; align-items: center; border: 1px solid #e5e5ea;
      border-radius: 10px; background: #f9f9f9;
    }
    .input-wrapper:focus-within { border-color: #007aff; background: #fff; }
    .input-wrapper input {
      flex: 1; border: none; outline: none; padding: 14px 12px;
      font-size: 16px; background: transparent;
    }
    .sms-btn {
      white-space: nowrap; padding: 8px 12px; margin-right: 8px;
      font-size: 13px; color: #007aff; background: none; border: none;
      cursor: pointer; font-weight: 500;
    }
    .sms-btn:disabled { color: #c7c7cc; cursor: not-allowed; }
    .error-msg {
      font-size: 12px; color: #ff3b30; margin-top: 4px; display: none;
    }
    .password-toggle {
      padding: 0 12px; cursor: pointer; color: #8e8e93; font-size: 13px;
    }
    .agreement {
      display: flex; align-items: flex-start; gap: 8px; margin: 20px 0;
      font-size: 13px; color: #3c3c43; line-height: 1.5;
    }
    .agreement a { color: #007aff; text-decoration: none; }
    .agreement input[type="checkbox"] { margin-top: 2px; width: 18px; height: 18px; }
    .register-btn {
      width: 100%; padding: 16px; background: #007aff; color: #fff;
      border: none; border-radius: 12px; font-size: 17px; font-weight: 600;
      cursor: pointer; transition: opacity 0.2s;
    }
    .register-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .register-btn:not(:disabled):active { opacity: 0.8; }
    .third-party { margin-top: 32px; text-align: center; }
    .third-party-title {
      color: #8e8e93; font-size: 13px; position: relative; margin-bottom: 16px;
    }
    .third-party-title::before, .third-party-title::after {
      content: ''; position: absolute; top: 50%; width: 30%; height: 1px; background: #e5e5ea;
    }
    .third-party-title::before { left: 0; }
    .third-party-title::after { right: 0; }
    .third-party-btns { display: flex; justify-content: center; gap: 24px; }
    .third-party-btn {
      width: 48px; height: 48px; border-radius: 50%; border: 1px solid #e5e5ea;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; cursor: pointer; background: #fff;
    }
    .countdown { color: #c7c7cc; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>创建账号</h1>
    <p class="subtitle">注册新账号，开启体验</p>

    <div class="tab-bar">
      <div class="tab active" data-tab="phone">手机号</div>
      <div class="tab" data-tab="email">邮箱</div>
    </div>

    <!-- 手机号注册 -->
    <div class="tab-content active" id="tab-phone">
      <div class="form-group">
        <label>手机号</label>
        <div class="input-wrapper">
          <input type="tel" id="phone-input" placeholder="请输入手机号" maxlength="11">
        </div>
        <div class="error-msg" id="phone-error"></div>
      </div>
      <div class="form-group">
        <label>验证码</label>
        <div class="input-wrapper">
          <input type="text" id="sms-code-input" placeholder="请输入验证码" maxlength="6" inputmode="numeric">
          <button class="sms-btn" id="sms-btn">获取验证码</button>
        </div>
        <div class="error-msg" id="sms-error"></div>
      </div>
      <div class="agreement">
        <input type="checkbox" id="agree-all">
        <label for="agree-all">我已阅读并同意 <a href="#" class="protocol-link">《用户协议》</a> 和 <a href="#" class="protocol-link">《隐私政策》</a></label>
      </div>
      <button class="register-btn" id="register-btn" disabled>注册</button>
    </div>

    <!-- 邮箱注册 -->
    <div class="tab-content" id="tab-email">
      <div class="form-group">
        <label>邮箱</label>
        <div class="input-wrapper">
          <input type="email" id="email-input" placeholder="请输入邮箱">
        </div>
        <div class="error-msg" id="email-error"></div>
      </div>
      <div class="form-group">
        <label>设置密码</label>
        <div class="input-wrapper">
          <input type="password" id="password-input" placeholder="8-20位，含字母和数字">
          <span class="password-toggle" id="pw-toggle">👁</span>
        </div>
        <div class="error-msg" id="password-error"></div>
      </div>
      <div class="form-group">
        <label>确认密码</label>
        <div class="input-wrapper">
          <input type="password" id="confirm-pw-input" placeholder="请再次输入密码">
        </div>
        <div class="error-msg" id="confirm-pw-error"></div>
      </div>
      <div class="agreement">
        <input type="checkbox" id="agree-all-email">
        <label for="agree-all-email">我已阅读并同意 <a href="#" class="protocol-link">《用户协议》</a> 和 <a href="#" class="protocol-link">《隐私政策》</a></label>
      </div>
      <button class="register-btn" id="register-btn-email" disabled>注册</button>
    </div>

    <!-- 第三方登录 -->
    <div class="third-party">
      <div class="third-party-title">其他方式</div>
      <div class="third-party-btns">
        <div class="third-party-btn" id="wechat-btn">微</div>
        <div class="third-party-btn" id="apple-btn">🍎</div>
      </div>
    </div>
  </div>

  <script>
    const tabs = document.querySelectorAll('.tab');
    const tabContents = { phone: document.getElementById('tab-phone'), email: document.getElementById('tab-email') };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        Object.values(tabContents).forEach(tc => tc.classList.remove('active'));
        tabContents[tab.dataset.tab].classList.add('active');
        clearErrors();
      });
    });

    function clearErrors() {
      document.querySelectorAll('.error-msg').forEach(el => { el.style.display = 'none'; el.textContent = ''; });
    }
    function showError(id, msg) {
      const el = document.getElementById(id);
      el.textContent = msg; el.style.display = 'block';
    }

    // ---- 手机号注册逻辑 ----
    const phoneInput = document.getElementById('phone-input');
    const smsBtn = document.getElementById('sms-btn');
    const smsCodeInput = document.getElementById('sms-code-input');
    const registerBtn = document.getElementById('register-btn');
    const agreeAll = document.getElementById('agree-all');

    let countdownTimer = null;

    // 获取验证码
    smsBtn.addEventListener('click', async () => {
      const phone = phoneInput.value.trim();
      if (!phone || phone.length < 11) {
        showError('phone-error', '请输入11位手机号');
        return;
      }
      if (!/^1\\d{10}$/.test(phone)) {
        showError('phone-error', '手机号格式不正确');
        return;
      }
      smsBtn.disabled = true;
      smsBtn.textContent = '发送中...';
      try {
        const res = await fetch('/api/v1/register/send-sms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        const data = await res.json();
        if (data.code === 200) {
          startCountdown(60);
        } else {
          showError('phone-error', data.message || '发送失败');
          smsBtn.disabled = false;
          smsBtn.textContent = '获取验证码';
        }
      } catch {
        showError('phone-error', '网络错误，请重试');
        smsBtn.disabled = false;
        smsBtn.textContent = '获取验证码';
      }
    });

    function startCountdown(sec) {
      smsBtn.textContent = sec + '秒后重试';
      if (sec <= 0) {
        smsBtn.disabled = false;
        smsBtn.textContent = '获取验证码';
        return;
      }
      countdownTimer = setTimeout(() => startCountdown(sec - 1), 1000);
    }

    // 注册按钮状态
    function updateRegisterBtn() {
      const phoneOk = /^1\\d{10}$/.test(phoneInput.value.trim());
      const codeOk = smsCodeInput.value.trim().length === 6;
      const agreed = agreeAll.checked;
      registerBtn.disabled = !(phoneOk && codeOk && agreed);
    }
    phoneInput.addEventListener('input', updateRegisterBtn);
    smsCodeInput.addEventListener('input', updateRegisterBtn);
    agreeAll.addEventListener('change', updateRegisterBtn);

    // 注册提交
    registerBtn.addEventListener('click', async () => {
      const phone = phoneInput.value.trim();
      const code = smsCodeInput.value.trim();
      try {
        const res = await fetch('/api/v1/register/phone', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, smsCode: code }),
        });
        const data = await res.json();
        if (data.code === 200) {
          alert('注册成功！');
          window.location.href = '/mock/login-success';
        } else {
          showError('sms-error', data.message);
        }
      } catch {
        showError('sms-error', '网络错误');
      }
    });

    // ---- 邮箱注册逻辑 ----
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const confirmPwInput = document.getElementById('confirm-pw-input');
    const registerBtnEmail = document.getElementById('register-btn-email');
    const agreeAllEmail = document.getElementById('agree-all-email');
    const pwToggle = document.getElementById('pw-toggle');

    pwToggle.addEventListener('click', () => {
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text'; pwToggle.textContent = '🙈';
      } else {
        passwordInput.type = 'password'; pwToggle.textContent = '👁';
      }
    });

    function updateEmailRegisterBtn() {
      const emailOk = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(emailInput.value.trim());
      const pwOk = passwordInput.value.length >= 8;
      const confirmOk = confirmPwInput.value === passwordInput.value && confirmPwInput.value.length > 0;
      const agreed = agreeAllEmail.checked;
      registerBtnEmail.disabled = !(emailOk && pwOk && confirmOk && agreed);
    }
    emailInput.addEventListener('input', updateEmailRegisterBtn);
    passwordInput.addEventListener('input', updateEmailRegisterBtn);
    confirmPwInput.addEventListener('input', updateEmailRegisterBtn);
    agreeAllEmail.addEventListener('change', updateEmailRegisterBtn);

    // 邮箱实时校验
    emailInput.addEventListener('blur', () => {
      const val = emailInput.value.trim();
      if (val && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val)) {
        showError('email-error', '邮箱格式不正确');
      } else {
        document.getElementById('email-error').style.display = 'none';
      }
    });

    // 密码实时校验
    passwordInput.addEventListener('blur', () => {
      const val = passwordInput.value;
      if (val && val.length < 8) {
        showError('password-error', '密码长度不能少于8位');
      } else if (val && (!/[a-zA-Z]/.test(val) || !/\\d/.test(val))) {
        showError('password-error', '密码强度不足，需包含字母和数字');
      } else {
        document.getElementById('password-error').style.display = 'none';
      }
    });

    confirmPwInput.addEventListener('blur', () => {
      if (confirmPwInput.value && confirmPwInput.value !== passwordInput.value) {
        showError('confirm-pw-error', '两次密码不一致');
      } else {
        document.getElementById('confirm-pw-error').style.display = 'none';
      }
    });

    // 邮箱注册提交
    registerBtnEmail.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (confirmPwInput.value !== password) {
        showError('confirm-pw-error', '两次密码不一致');
        return;
      }
      try {
        const res = await fetch('/api/v1/register/email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (data.code === 200) {
          alert('注册成功！请前往邮箱激活账号');
        } else {
          showError('email-error', data.message);
        }
      } catch {
        showError('email-error', '网络错误');
      }
    });

    // 第三方登录按钮
    document.getElementById('wechat-btn').addEventListener('click', () => {
      alert('微信授权登录（Mock）');
    });
    document.getElementById('apple-btn').addEventListener('click', () => {
      alert('Apple ID 授权登录（Mock）');
    });
  </script>
</body>
</html>`);
});

// ---- 启动 ----
const PORT = 3100;
app.listen(PORT, () => {
  console.log(`[Mock Server] 运行在 http://localhost:${PORT}`);
  console.log(`  Mock 注册页: http://localhost:${PORT}/mock/register`);
  console.log(`  API 地址:    http://localhost:${PORT}/api/v1/register`);
});
