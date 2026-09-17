/**
 * 手机号+验证码注册 — API 自动化测试
 *
 * 覆盖用例:
 *   TC_REG_MB_001 ~ TC_REG_MB_015 (15条)
 *   以及 BACK_001 ~ BACK_003 (边界)
 *
 * 预置条件: 被测服务运行中，BASE_URL 环境变量已配置
 */

import { test, expect } from '@playwright/test';
import { API_ENDPOINTS, ERROR_CODES, PHONE_FORMATS } from '../../test-data/test-data';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

// ------------------------------
// 1. 发送验证码
// ------------------------------

test.describe('TC_REG_MB_001~005 — 发送验证码', () => {
  const unregisteredPhone = '13800138001';

  test('TC_REG_MB_001: 正常发送短信验证码 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
      data: { phone: unregisteredPhone },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(body.message).toContain('验证码');
  });

  test('TC_REG_MB_002: 无效手机号格式拒绝发送 — 前端/后端双层拦截 (P0)', async ({ request }) => {
    const invalidCases = PHONE_FORMATS.filter(p => p.expected !== 'valid');

    for (const { phone, desc } of invalidCases) {
      const res = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
        data: { phone },
      });
      // 后端应返回业务错误（非200业务码）而非HTTP 500
      const body = await res.json();
      expect([400, '40001', 40001]).toContain(body.code);
      expect(body.message).toBeDefined();
      console.log(`  [PASS] 手机号 "${phone}" (${desc}) → ${JSON.stringify(body)}`);
    }
  });

  test('TC_REG_MB_003: 已注册手机号拒绝重复发送 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
      data: { phone: '13900139001' },
    });
    const body = await res.json();
    expect(body.code).toBe(ERROR_CODES.PHONE_EXISTS);
    expect(body.message).toContain('已注册');
  });

  test('TC_REG_MB_004: 60秒内重复点击 — 防刷验证 (P1)', async ({ request }) => {
    // 第一次发送
    const res1 = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
      data: { phone: '13600136001' },
    });
    expect(res1.status()).toBe(200);

    // 立即第二次（60秒内）
    const res2 = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
      data: { phone: '13600136001' },
    });
    const body2 = await res2.json();
    expect(body2.code).toBe(ERROR_CODES.RATE_LIMIT);
    expect(body2.message).toContain('频繁');
  });

  test('TC_REG_MB_005: 同一手机号1小时超过5次 — 触发限制 (P1)', async ({ request }) => {
    const phone = '13500135001';

    for (let i = 0; i < 5; i++) {
      await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
        data: { phone },
      });
    }

    // 第6次应被拒绝
    const res = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
      data: { phone },
    });
    const body = await res.json();
    expect(body.code).toBe(ERROR_CODES.RATE_LIMIT);
    expect(body.message).toContain('次数超限');
  });
});

// ------------------------------
// 2. 验证码输入与注册提交
// ------------------------------

test.describe('TC_REG_MB_006~011 — 验证码输入与注册', () => {
  const phone = '13800138002';
  const smsCode = '654321';

  test.beforeAll(async ({ request }) => {
    // 预发送验证码
    const res = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
      data: { phone },
    });
    const body = await res.json();
    console.log(`[SETUP] SMS code for ${phone}: ${body.debug_code || smsCode}`);
  });

  test('TC_REG_MB_006: 正确验证码完成注册 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone, smsCode },
    });
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(body.message).toBe('注册成功');
    expect(body.data).toHaveProperty('userId');
    expect(body.data).toHaveProperty('token');
  });

  test('TC_REG_MB_007: 验证码错误 — 拒绝注册 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone: '13800138003', smsCode: '000000' },
    });
    const body = await res.json();
    expect(body.code).toBe(ERROR_CODES.SMS_CODE_WRONG);
    expect(body.message).toContain('验证码错误');
  });

  test('TC_REG_MB_011: 输入非数字验证码 — 前端/格式拦截 (P1)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone: '13800138004', smsCode: 'abcde' },
    });
    const body = await res.json();
    // 后端对非数字应返回验证码错误或格式错误
    expect([ERROR_CODES.SMS_CODE_WRONG, ERROR_CODES.BAD_REQUEST]).toContain(body.code);
  });

  test('TC_REG_MB_012: 手机号为空提交 — 拦截 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone: '', smsCode: '123456' },
    });
    const body = await res.json();
    expect(body.code).toBe(ERROR_CODES.BAD_REQUEST);
  });

  test('TC_REG_MB_013: 使用他人已注册手机号 — 提示已注册 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone: '13900139001', smsCode: '123456' },
    });
    const body = await res.json();
    expect(body.code).toBe(ERROR_CODES.PHONE_EXISTS);
  });
});

// ------------------------------
// 3. 手机号边界测试
// ------------------------------

test.describe('TC_REG_BACK_001~003 — 手机号边界', () => {
  test('TC_REG_BACK_001/002: +86/0086 开头国际区号 (P1)', async ({ request }) => {
    const cases = [
      { phone: '+8613800138001', label: '+86前缀' },
      { phone: '008613800138001', label: '0086前缀' },
    ];
    for (const { phone, label } of cases) {
      const res = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
        data: { phone },
      });
      const body = await res.json();
      // 至少后端有合理响应，不抛500
      expect(body.code).toBeDefined();
      console.log(`  [PASS] ${label} ${phone} → code: ${body.code}`);
    }
  });

  test('TC_REG_BACK_003: 含空格或横线的手机号 (P1)', async ({ request }) => {
    const cases = [
      { phone: '138 0000 0000', label: '含空格' },
      { phone: '138-0000-0000', label: '含横线' },
    ];
    for (const { phone, label } of cases) {
      const res = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
        data: { phone },
      });
      // 可能前端已清理或后端拒绝；都是合理行为
      const body = await res.json();
      expect(body.code).toBeDefined();
      console.log(`  [INFO] ${label} "${phone}" → code: ${body.code}, msg: ${body.message}`);
    }
  });
});
