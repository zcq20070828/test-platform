#!/usr/bin/env node
/**
 * 菜单屏蔽状态（2026-11-20）
 *
 * 用户要求「前端页面暂时屏蔽截图所示功能」：
 *   自动化测试 / 性能测试 / 智能评估 / 安全测试 / 兼容性测试 / 测试流水线 / 知识库
 *
 * 沿用项目已有的「平台瘦身」机制（2026-10-14 屏蔽「智能体」时定的）：
 *   - App.vue 菜单项注释掉
 *   - router/index.ts 的 meta 加 disabled + disabledTip
 *   - 路由守卫拦截并提示，页面文件与后端 API 一律保留
 * 这样恢复只是「取消注释 + 删两行 meta」，不需要重建页面。
 *
 * 这套测试锁住的是「屏蔽必须是完整的」：
 * 只注释菜单但忘了 meta，用户直接输 URL 还能进；
 * 只加 meta 但忘了注释菜单，菜单里还挂着点不动的入口。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'App.vue'), 'utf8');
const ROUTER = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'router', 'index.ts'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

/** 屏蔽的 7 个模块 */
const DISABLED = [
  { path: '/knowledge', name: 'Knowledge', label: '知识库' },
  { path: '/workflow', name: 'Workflow', label: '测试流水线' },
  { path: '/test-runner', name: 'TestRunner', label: '自动化测试' },
  { path: '/performance-test', name: 'PerformanceTest', label: '性能测试' },
  { path: '/evaluation', name: 'Evaluation', label: '智能评估' },
  { path: '/security', name: 'Security', label: '安全测试' },
  { path: '/web-compatibility', name: 'WebCompatibility', label: '兼容性测试' },
];

console.log('=== 菜单屏蔽状态 ===');

t('7 个路由都带 disabled + disabledTip', () => {
  for (const d of DISABLED) {
    const idx = ROUTER.indexOf(`path: '${d.path}'`);
    assert.ok(idx > 0, `找不到路由 ${d.path}`);
    // 取该路由块（到下一个 path: 之前）
    const next = ROUTER.indexOf("path: '", idx + 10);
    const block = ROUTER.slice(idx, next > 0 ? next : idx + 600);
    assert.ok(/disabled: true/.test(block), `${d.path} 缺 disabled`);
    assert.ok(/disabledTip:/.test(block), `${d.path} 缺 disabledTip`);
    assert.ok(new RegExp(`「${d.label}」`).test(block), `${d.path} 的提示没写模块名`);
  }
});

t('菜单里不再有这 7 个入口（已被注释）', () => {
  for (const d of DISABLED) {
    const active = new RegExp(`^\\s*\\{ path: '${d.path.replace(/[/\\-]/g, '\\$&')}'`, 'm');
    assert.ok(!active.test(APP), `${d.path} 仍在菜单里可点`);
    // 但恢复用的注释要留着（否则以后想恢复还得重写）
    const commented = new RegExp(`//\\s*\\{ path: '${d.path.replace(/[/\\-]/g, '\\$&')}'`, 'm');
    assert.ok(commented.test(APP), `${d.path} 没有留恢复注释`);
  }
});

t('保留项没被误删（分步测试 / 任务 / 系统设置与管理）', () => {
  assert.ok(/path: '\/'/.test(APP), '分步测试入口丢失');
  assert.ok(/title: '分步测试'/.test(APP), '分步测试标题丢失');
  assert.ok(/path: '\/tasks'/.test(APP), '任务入口丢失');
  assert.ok(/path: '\/admin'/.test(APP), '系统设置与管理入口丢失');
});

t('保留项的路由没有被禁用', () => {
  for (const kept of ['/', '/tasks', '/admin', '/profile']) {
    const idx = ROUTER.indexOf(`path: '${kept}'`);
    if (idx < 0) continue;
    const next = ROUTER.indexOf("path: '", idx + 10);
    const block = ROUTER.slice(idx, next > 0 ? next : idx + 500);
    assert.ok(!/disabled: true/.test(block), `${kept} 被误禁用了`);
  }
});

t('路由守卫会拦截并给出模块级提示', () => {
  assert.ok(/to\.meta\.disabled/.test(ROUTER), '守卫没有处理 disabled');
  assert.ok(/disabledTip/.test(ROUTER), '守卫没有用 disabledTip');
  // 拦截后回首页，而不是留在空白页
  const idx = ROUTER.indexOf('if (to.meta.disabled)');
  const block = ROUTER.slice(idx, idx + 300);
  assert.ok(/return \{ name: 'Dashboard' \}/.test(block), '拦截后没有回首页');
});

t('屏蔽只在前端，页面文件与后端接口都保留（可随时恢复）', () => {
  const views = {
    '/knowledge': 'KnowledgeView.vue',
    '/workflow': 'WorkflowView.vue',
    '/test-runner': 'TestRunnerView.vue',
    '/performance-test': 'PerformanceTestView.vue',
    '/evaluation': 'EvaluationView.vue',
    '/security': 'SecurityView.vue',
    '/web-compatibility': 'WebCompatibilityView.vue',
  };
  for (const [route, file] of Object.entries(views)) {
    const p = path.join(ROOT, 'frontend', 'src', 'views', file);
    assert.ok(fs.existsSync(p), `页面文件 ${file} 被删了（应该保留）`);
    assert.ok(new RegExp(`component: \\(\\) => import\\('@/views/${file}'\\)`).test(ROUTER),
      `${route} 的组件导入被删了（应该保留）`);
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
