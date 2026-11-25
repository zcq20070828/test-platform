/**
 * authenticate 中间件不能把请求挂死（2026-11-25）
 *
 * 真实故障：签名合法但缺 sub 的令牌进来，authenticate 用 decoded.sub
 * （undefined）查库，mysql2 抛「Bind parameters must not contain undefined」。
 * Express 4 不接收 async 中间件的 rejection，于是 next() 永不调用、
 * 响应永不结束 —— 客户端只看到 20 秒超时，服务端只留一条 Unhandled Rejection。
 *
 * 修复后有两条硬约束：
 *   1) 缺 sub 必须在查库之前挡掉，回 401
 *   2) 查库抛错必须转成 500，不能漏成未捕获 rejection
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ❌ ${name} :: ${e.message}`);
  }
}

console.log('=== 认证中间件挂死 单元测试 ===');

function authBody() {
  const start = SERVER.indexOf('async function authenticate(req, res, next)');
  assert.ok(start > 0, '找不到 authenticate');
  const end = SERVER.indexOf('function requireAdmin(', start);
  assert.ok(end > start, '找不到 requireAdmin 边界');
  return SERVER.slice(start, end);
}

t('缺 sub 的令牌在查库前被挡掉', () => {
  const body = authBody();
  const subGuard = body.indexOf('if (!decoded.sub)');
  const dbCall = body.indexOf('getUserById');
  assert.ok(subGuard > 0, '缺少 decoded.sub 判空');
  assert.ok(dbCall > subGuard, '判空必须在查库之前，否则 undefined 会进 mysql2');
  // 判空分支必须真的 return，不能只是发个响应继续往下走
  const guardBlock = body.slice(subGuard, subGuard + 300);
  assert.ok(/return res\.status\(401\)/.test(guardBlock), '缺 sub 必须 return 401');
});

t('查库抛错被捕获并回 500', () => {
  const body = authBody();
  assert.ok(/try\s*\{[\s\S]{0,400}getUserById[\s\S]{0,600}\}\s*catch/.test(body),
    'getUserById 必须包在 try/catch 里');
  assert.ok(/catch[\s\S]{0,300}res\.status\(500\)/.test(body),
    'catch 里必须回 500，否则请求会挂到超时');
});

t('不再出现「先 let user = users.get() 又 let user」的重复声明', () => {
  const body = authBody();
  const decls = body.match(/let user\b/g) || [];
  assert.strictEqual(decls.length, 1, `let user 声明了 ${decls.length} 次`);
});

t('内存 Map 命中时不查库（性能）', () => {
  const body = authBody();
  assert.ok(/user = users\.get\(decoded\.sub\)[\s\S]{0,200}if \(!user\)/.test(body),
    '应先用内存 Map，未命中再查库');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
