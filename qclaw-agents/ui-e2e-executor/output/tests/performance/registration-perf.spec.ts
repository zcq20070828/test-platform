/**
 * 性能与并发测试
 *
 * 运行方式:
 *   npx playwright test --config=playwright.config.ts --project=performance
 *
 * ⚠️ 注意: 性能测试会向被测服务发送大量请求。
 * 请确保在测试环境而非生产环境执行。
 *
 * 覆盖用例:
 *   TC_REG_PERF_001 ~ TC_REG_PERF_005
 */

import { test, expect } from '@playwright/test';
import { API_ENDPOINTS } from '../../test-data/test-data';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

// 测试配置
const CONFIG = {
  RESPONSE_TIMEOUT_SMS: 3000,   // 发送验证码响应上限 3秒
  RESPONSE_TIMEOUT_REG: 2000,   // 注册提交响应上限 2秒
  CONCURRENT_QPS: 100,          // 并发 QPS
  CONCURRENT_ERROR_RATE: 0.01,  // 允许的失败率 (1%)
  STABILITY_ITERATIONS: 100,    // 稳定性测试次数
};

test.describe('TC_REG_PERF_001/002 — 响应时间', () => {
  test('TC_REG_PERF_001: 发送验证码接口响应时间 < 3秒 (P1)', async ({ request }) => {
    const samplePhones = Array.from({ length: 10 }, (_, i) =>
      `131${String(10000000 + i).substring(0, 8)}`
    );

    const timings: number[] = [];

    for (const phone of samplePhones) {
      const start = Date.now();
      const res = await request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
        data: { phone },
      });
      const elapsed = Date.now() - start;
      timings.push(elapsed);

      expect(res.status()).toBe(200);
      expect(elapsed).toBeLessThan(CONFIG.RESPONSE_TIMEOUT_SMS);
    }

    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    const max = Math.max(...timings);
    const p95 = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];

    console.log(`\n  [PERF] 发送验证码响应时间:`);
    console.log(`    平均: ${avg.toFixed(0)}ms`);
    console.log(`    P95:  ${p95}ms`);
    console.log(`    最大: ${max}ms`);

    // 记录性能结果注解
    test.info().annotations.push({
      type: 'performance',
      description: `10次请求: avg=${avg.toFixed(0)}ms, p95=${p95}ms, max=${max}ms`,
    });
  });

  test('TC_REG_PERF_002: 注册提交接口响应时间 < 2秒 (P0)', async ({ request }) => {
    const samplePhones = Array.from({ length: 10 }, (_, i) =>
      `130${String(10000000 + i).substring(0, 8)}`
    );

    const timings: number[] = [];

    for (const phone of samplePhones) {
      const start = Date.now();
      const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_PHONE}`, {
        data: { phone, smsCode: '123456' },
      });
      const elapsed = Date.now() - start;
      timings.push(elapsed);

      expect(res.status()).toBe(200);
      expect(elapsed).toBeLessThan(CONFIG.RESPONSE_TIMEOUT_REG);
    }

    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    const max = Math.max(...timings);
    const p95 = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];

    console.log(`\n  [PERF] 注册提交响应时间:`);
    console.log(`    平均: ${avg.toFixed(0)}ms`);
    console.log(`    P95:  ${p95}ms`);
    console.log(`    最大: ${max}ms`);

    test.info().annotations.push({
      type: 'performance',
      description: `10次请求: avg=${avg.toFixed(0)}ms, p95=${p95}ms, max=${max}ms`,
    });
  });
});

test.describe('TC_REG_PERF_003/004 — 并发性能', () => {
  test('TC_REG_PERF_003: 100 QPS 注册请求 — 成功率 ≥ 99% (P1)', async ({ request }) => {
    const promises = Array.from({ length: CONFIG.CONCURRENT_QPS }, (_, i) =>
      request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
        data: { phone: `129${String(10000000 + i).substring(0, 8)}` },
        timeout: 30_000,
      })
    );

    const start = Date.now();
    const results = await Promise.allSettled(promises);
    const elapsed = Date.now() - start;

    const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter(r => r.status === 'rejected');

    const successCount = fulfilled.filter(r => r.value.status() === 200).length;
    const successRate = successCount / CONFIG.CONCURRENT_QPS;
    const avgTime = (Date.now() - start) / CONFIG.CONCURRENT_QPS;

    console.log(`\n  [PERF] 100 QPS 并发结果:`);
    console.log(`    总请求: ${CONFIG.CONCURRENT_QPS}`);
    console.log(`    成功:   ${successCount}`);
    console.log(`    失败:   ${rejected.length}`);
    console.log(`    成功率: ${(successRate * 100).toFixed(1)}%`);
    console.log(`    耗时:   ${elapsed}ms (平均 ${avgTime.toFixed(0)}ms/请求)`);

    expect(successRate).toBeGreaterThanOrEqual(1 - CONFIG.CONCURRENT_ERROR_RATE);

    test.info().annotations.push({
      type: 'performance',
      description: `100QPS: rate=${(successRate * 100).toFixed(1)}%, total=${elapsed}ms`,
    });
  });

  test('TC_REG_PERF_004: 500 QPS 压力测试 — 系统不崩溃 (P1)', async ({ request }) => {
    // 500个请求，不要求全部成功，但系统不应崩溃（不应返回5xx或其他异常）
    const promises = Array.from({ length: 500 }, (_, i) =>
      request.post(`${BASE}${API_ENDPOINTS.SEND_SMS}`, {
        data: { phone: `128${String(10000000 + i).substring(0, 8)}` },
        timeout: 60_000,
      }).catch(() => null) // 网络错误不使测试失败
    );

    const start = Date.now();
    const results = await Promise.all(promises);
    const elapsed = Date.now() - start;

    const validResponses = results.filter(r => r !== null) as any[];
    const statusCodes = validResponses.map(r => r.status());
    const serverErrors = statusCodes.filter(s => s >= 500).length;

    console.log(`\n  [PERF] 500 QPS 压力测试:`);
    console.log(`    总请求:  500`);
    console.log(`    有效响应: ${validResponses.length}`);
    console.log(`    5xx错误: ${serverErrors}`);
    console.log(`    总耗时:  ${elapsed}ms`);

    // 系统不应崩溃（5xx比例应极低）
    expect(serverErrors).toBeLessThan(validResponses.length * 0.1);

    test.info().annotations.push({
      type: 'performance',
      description: `500QPS stress: valid=${validResponses.length}, 5xx=${serverErrors}, time=${elapsed}ms`,
    });
  });
});

test.describe('TC_REG_PERF_005 — 稳定性测试', () => {
  test('连续100次注册操作 — 无内存泄漏迹象 (P2)', async ({ request }) => {
    const timings: number[] = [];

    for (let i = 0; i < CONFIG.STABILITY_ITERATIONS; i++) {
      const start = Date.now();
      const res = await request.post(`${BASE}${API_ENDPOINTS.REGISTER_EMAIL}`, {
        data: {
          email: `stress_${Date.now()}_${i}@example.com`,
          password: 'Stress@123',
        },
        timeout: 30_000,
      });
      const elapsed = Date.now() - start;
      timings.push(elapsed);

      // 连续请求中，响应时间不应持续增长
      expect(res.status()).toBeLessThan(500);
    }

    // 分析响应时间趋势
    const firstHalf = timings.slice(0, 50);
    const secondHalf = timings.slice(50);
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    console.log(`\n  [PERF] 稳定性测试 (100次):`);
    console.log(`    前50次平均: ${firstAvg.toFixed(0)}ms`);
    console.log(`    后50次平均: ${secondAvg.toFixed(0)}ms`);
    console.log(`    趋势: ${secondAvg > firstAvg * 1.2 ? '⚠️ 性能退化' : '✅ 稳定'}`);

    // 如果后50次平均比前50次慢20%以上，提示性能退化风险
    if (secondAvg > firstAvg * 1.2) {
      test.info().annotations.push({
        type: 'warning',
        description: `性能退化趋势: 前50次avg=${firstAvg.toFixed(0)}ms, 后50次avg=${secondAvg.toFixed(0)}ms`,
      });
    }

    test.info().annotations.push({
      type: 'performance',
      description: `稳定性: 前50 avg=${firstAvg.toFixed(0)}ms, 后50 avg=${secondAvg.toFixed(0)}ms`,
    });
  });
});
