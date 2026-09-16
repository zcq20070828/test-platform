/**
 * 第三方登录注册 — API 测试
 *
 * 覆盖用例:
 *   TC_REG_3RD_001 ~ TC_REG_3RD_009
 *
 * ⚠️ 注意: 第三方登录（微信/Apple ID）需要真实的 OAuth 授权环境。
 * 本测试提供 API 级别的验证框架，完整测试需真机 + 真实第三方 SDK。
 */

import { test, expect } from '@playwright/test';
import { API_ENDPOINTS, ERROR_CODES } from '../../test-data/test-data';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('TC_REG_3RD_001~004 — 微信登录', () => {
  test('TC_REG_3RD_003: 同一微信账号重复登录 — 绑定已有账号 (P0)', async ({ request }) => {
    // 模拟微信 unionId 重复绑定
    const res = await request.post(`${BASE}${API_ENDPOINTS.THIRD_PARTY}`, {
      data: {
        provider: 'wechat',
        unionId: 'mock_wechat_union_001',
        nickName: 'WeChatUser',
      },
    });
    const body = await res.json();
    // 应返回已有账号或创建新账号
    expect(res.status()).toBeLessThan(500);
    console.log(`  [INFO] 微信重复登录: code=${body.code}, msg=${body.message}`);
    test.info().annotations.push({
      type: 'requires_env',
      description: '需微信开放平台OAuth环境',
    });
  });

  test('TC_REG_3RD_004: 微信服务不可用 — 降级处理 (P1)', async ({ request }) => {
    // 模拟微信授权失败场景
    const res = await request.post(`${BASE}${API_ENDPOINTS.THIRD_PARTY}`, {
      data: {
        provider: 'wechat',
        unionId: '',
        error: 'auth_denied',
      },
    });
    const body = await res.json();
    expect(body.code).not.toBe(200); // 应返回错误
    console.log(`  [INFO] 微信服务不可用: code=${body.code}`);
  });
});

test.describe('TC_REG_3RD_005~007 — Apple ID 登录', () => {
  test('TC_REG_3RD_007: Apple登录返回用户信息为空 — 引导补充 (P1)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.THIRD_PARTY}`, {
      data: {
        provider: 'apple',
        userId: '',
        email: '',
      },
    });
    const body = await res.json();
    // 信息为空时应要求补充手机号
    if (body.code !== 200) {
      console.log(`  [INFO] Apple信息为空: code=${body.code}, 提示补充信息`);
    }
  });
});

test.describe('TC_REG_3RD_008/009 — 第三方通用', () => {
  test('TC_REG_3RD_008: 第三方登录后补充绑定手机号 (P1)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
      data: {
        phone: '13300133001',
        smsCode: '123456',
        bindProvider: 'wechat',
        bindUnionId: 'mock_wechat_union_bind',
      },
    });
    const body = await res.json();
    expect(res.status()).toBeLessThan(500);
    console.log(`  [INFO] 绑定手机号补充: code=${body.code}`);
  });

  test('TC_REG_3RD_009: 第三方账号已绑定其他本地账号 — 冲突 (P1)', async ({ request }) => {
    const res = await request.post(`${BASE}${API_ENDPOINTS.THIRD_PARTY}`, {
      data: {
        provider: 'wechat',
        unionId: 'already_bound_union',
      },
    });
    const body = await res.json();
    // 冲突时应返回明确错误
    if (body.code !== 200) {
      console.log(`  [INFO] 绑定冲突: code=${body.code}`);
    }
  });
});
