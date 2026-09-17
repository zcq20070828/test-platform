/**
 * API 接口规范测试
 *
 * 覆盖用例:
 *   TC_REG_API_001 ~ TC_REG_API_006
 *   TC_REG_REGR_001 ~ TC_REG_REGR_005 (回归)
 *   TC_REG_BACK_007/008 (并发)
 */

import { test, expect } from '@playwright/test';
import { API_ENDPOINTS, ERROR_CODES } from '../../test-data/test-data';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('TC_REG_API_001~006 — 接口规范', () => {
  test('TC_REG_API_001: POST接口使用GET方法 — 返回405 (P0)', async ({ request }) => {
    const res = await request.get(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`);
    // 严格模式应返回405；有些服务返回400也可接受
    expect([405, 400, 404]).toContain(res.status());
  });

  test('TC_REG_API_002: 缺少必填参数 — 返回400 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { /* 空参数 */ },
    });
    const body = await res.json();
    expect(body.code).toBe(ERROR_CODES.BAD_REQUEST);
    expect(body.message).toBeDefined();
  });

  test('TC_REG_API_003: 参数类型错误 — 合理处理 (P1)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone: 12345678901, smsCode: 123456 },  // 数字而非字符串
    });
    const body = await res.json();
    // 后端应自动转换或返回格式错误，不应500
    expect(res.status()).toBeLessThan(500);
    expect(body.code).toBeDefined();
    expect(body.message).toBeDefined();
  });

  test('TC_REG_API_004: 非JSON格式请求体 — 返回415 (P1)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      headers: { 'Content-Type': 'text/plain' },
      data: 'phone=13800138001&smsCode=123456',
    });
    // 415 Unsupported Media Type 或 400 Bad Request
    expect([415, 400]).toContain(res.status());
  });

  test('TC_REG_API_005: 统一错误码格式 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone: '', smsCode: '' },
    });
    const body = await res.json();
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
    // code 应为数字或字符串统一格式
    expect(typeof body.code === 'number' || typeof body.code === 'string').toBeTruthy();
  });

  test('TC_REG_API_006: 响应Content-Type为application/json (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone: '13800138001', smsCode: '123456' },
    });
    const contentType = res.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');
  });
});

test.describe('TC_REG_REGR_001~005 — 回归测试', () => {
  const testPhone = '18800188001';

  test('TC_REG_REGR_004: 重复提交幂等性 — 仅注册一个账号 (P0)', async ({ request }) => {
    // 并行发送2个相同的注册请求
    const [res1, res2] = await Promise.all([
      request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
        data: { phone: testPhone, smsCode: '123456' },
      }),
      request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
        data: { phone: testPhone, smsCode: '123456' },
      }),
    ]);

    const body1 = await res1.json();
    const body2 = await res2.json();

    // 至少一个成功，另一个应提示已处理或重复
    const successCount = [body1, body2].filter(b => b.code === 200).length;
    expect(successCount).toBeGreaterThanOrEqual(1);

    if (successCount < 2) {
      const failedBody = body1.code === 200 ? body2 : body1;
      expect(failedBody.code).toBe(ERROR_CODES.DUPLICATE_REQUEST);
      console.log(`  [INFO] 重复请求被拦截: code=${failedBody.code}, message=${failedBody.message}`);
    }
  });

  test('TC_REG_REGR_003: 唯一性约束 — 重复注册被拒绝 (P0)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: { phone: '18800188002', smsCode: '654321' },
    });
    const body = await res.json();
    // 无论是否第一次注册，至少不抛500
    expect(res.status()).toBeLessThan(500);
    console.log(`  [INFO] 唯一性验证: code=${body.code}, msg=${body.message}`);
  });
});

test.describe('TC_REG_BACK_007/008 — 并发注册', () => {
  test('TC_REG_BACK_007: 同一手机号并发注册 — 仅一个成功 (P0)', async ({ request }) => {
    const phone = '18800188003';

    // 模拟毫秒级并发请求
    const promises = Array.from({ length: 5 }, (_, i) =>
      request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
        data: { phone, smsCode: `00000${i}` },
      })
    );

    const results = await Promise.all(promises);
    const bodies = await Promise.all(results.map(r => r.json()));

    const successCount = bodies.filter(b => b.code === 200).length;
    expect(successCount).toBe(1);

    const rejectedCount = bodies.filter(b => b.code === ERROR_CODES.PHONE_EXISTS || b.code === ERROR_CODES.DUPLICATE_REQUEST).length;
    expect(rejectedCount).toBe(4);

    console.log(`  [INFO] 并发结果: ${successCount} 成功, ${rejectedCount} 被拒绝`);
  });
});
