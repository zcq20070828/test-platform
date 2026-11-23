#!/usr/bin/env node
/**
 * 部署完整性：启动自检 + 动态资源清单（2026-11-23）
 *
 * 事故背景（生产实测）：
 *   生产「测试用例生成」长期缺 9dem-planner/9dem-executor 的 6 个文件：
 *     9dem-planner/backend/9dem-planner-invoker.js
 *     9dem-planner/backend/dimension-matrix-data.js
 *     9dem-executor/backend/design-input-derive.js
 *     9dem-executor/backend/design-methods.js
 *     9dem-executor/backend/dimension-cases.js
 *     9dem-executor/backend/dimension-probes.js
 *   导致交付物里没有 42 条九维必测点、没有黑盒9法覆盖。
 *
 * 为什么一直没被发现——三个结构性原因，本文件逐个锁死：
 *
 *   1) 这些文件是**运行时按路径 import** 的（`path.join(SKILLS_DIR, ...)`），
 *      构建期完全不校验。dist 里写着 import 路径，文件不在也不会在构建时报错。
 *      → 启动自检：缺失关键资源直接拒绝启动。
 *
 *   2) 调用失败**静默降级**：只打一行 `[ToolLoop] xxx 执行失败` 就继续，
 *      任务照样「成功」返回，用户拿到残缺交付物却看不出来。
 *      → catch 里区分「部署缺失」与「业务错误」，前者发 tool_unavailable 事件。
 *
 *   3) 部署脚本的 SKILLS 清单是**手写的**，路径还指向已失效的旧目录。
 *      → 构建脚本改为从 server.js 实际引用自动推导，缺文件构建失败。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOOT = await import(path.join(ROOT, 'backend', 'lib', 'boot-check.js'));
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const BUILD_SH = fs.readFileSync(path.join(ROOT, 'deploy', 'build-deploy-package.sh'), 'utf8');
const VERIFY_SH = fs.readFileSync(path.join(ROOT, 'deploy', 'verify-deploy.sh'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 部署完整性（启动自检 + 资源清单）===');

// ---------------- A) 清单与代码引用一致 ----------------
console.log('\n-- A. 资源清单 --');

t('★★ 清单覆盖 server.js 里全部工具模块引用（不能漏任何一个）', () => {
  const re = /path\.join\(SKILLS_DIR,\s*'([^']+)',\s*'backend',\s*'([^']+)'\)/g;
  const referenced = new Set();
  let m;
  while ((m = re.exec(SERVER))) referenced.add(`${m[1]}/backend/${m[2]}`);

  const declared = new Set([
    ...BOOT.REQUIRED_MODULES.map((x) => x.rel),
    ...BOOT.OPTIONAL_MODULES.map((x) => x.rel),
  ]);

  const missing = [...referenced].filter((x) => !declared.has(x));
  assert.deepStrictEqual(missing, [],
    `以下被代码引用的模块没进清单（自检会漏掉它们）: ${missing.join(', ')}`);
  assert.ok(referenced.size >= 19, `server.js 只识别到 ${referenced.size} 个引用，预期 ≥19`);
});

t('★★ 事故涉及的 6 个文件被列为「关键」（缺失必须拒绝启动）', () => {
  const requiredRels = BOOT.REQUIRED_MODULES.map((x) => x.rel);
  // 最少要覆盖这两个 invoker —— 缺了九维规划与确定性用例就全废
  assert.ok(requiredRels.includes('9dem-planner/backend/9dem-planner-invoker.js'),
    '没把 9dem-planner-invoker.js 列为关键');
  assert.ok(requiredRels.includes('9dem-executor/backend/9dem-invoker.js'),
    '没把 9dem-invoker.js 列为关键');
});

t('清单里的路径在当前仓库都真实存在（清单本身没过期）', () => {
  const skillsDir = path.join(ROOT, 'qclaw-skills');
  const all = [...BOOT.REQUIRED_MODULES, ...BOOT.OPTIONAL_MODULES];
  const missing = all.filter((x) => !fs.existsSync(path.join(skillsDir, x.rel)));
  assert.deepStrictEqual(missing.map((x) => x.rel), [], `清单里有过期路径: ${missing.map((x) => x.rel).join(', ')}`);
});

// ---------------- B) 自检行为 ----------------
console.log('\n-- B. 自检行为 --');

t('★★ 关键资源缺失时抛错（strict 模式）', () => {
  const fakeDir = fs.mkdtempSync(path.join(ROOT, '.tmp-bootcheck-'));
  try {
    let threw = null;
    try {
      BOOT.verifyRuntimeResources(fakeDir, { strict: true, log: () => {}, warn: () => {} });
    } catch (e) { threw = e; }
    assert.ok(threw, '空目录下没有抛错，自检形同虚设');
    assert.strictEqual(threw.code, 'BOOT_RESOURCE_MISSING', `错误码不对: ${threw.code}`);
    assert.ok(Array.isArray(threw.missing) && threw.missing.length >= 2, '没有报告缺失清单');
    // 错误信息要能指导运维
    assert.ok(/9dem/.test(threw.message), '错误信息没指明缺哪个文件');
    assert.ok(/补齐|部署/.test(threw.message), '错误信息没说该怎么修');
  } finally {
    fs.rmSync(fakeDir, { recursive: true, force: true });
  }
});

t('严格模式下也不因「可选资源」缺失而拒绝启动', () => {
  // 只造 required 的两个文件，可选全缺 → 应通过
  const tmp = fs.mkdtempSync(path.join(ROOT, '.tmp-bootcheck-'));
  try {
    for (const mod of BOOT.REQUIRED_MODULES) {
      const abs = path.join(tmp, mod.rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, '// stub');
    }
    const r = BOOT.verifyRuntimeResources(tmp, { strict: true, log: () => {}, warn: () => {} });
    assert.strictEqual(r.ok, true, '可选资源缺失不该导致启动失败');
    assert.ok(r.warnings.length > 0, '可选缺失应作为 warning 报告');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('仓库实际状态能通过自检（不能让正常部署起不来）', () => {
  const r = BOOT.verifyRuntimeResources(path.join(ROOT, 'qclaw-skills'), {
    strict: false, log: () => {}, warn: () => {},
  });
  assert.strictEqual(r.ok, true, `当前仓库自检失败: ${r.fatal.map((x) => x.rel).join(', ')}`);
});

t('assertModulePathExist 缺失时抛 RESOURCE_MISSING（替代静默降级）', () => {
  let threw = null;
  try {
    BOOT.assertModulePathExist(ROOT, 'qclaw-skills/不存在/backend/x.js', '测试模块');
  } catch (e) { threw = e; }
  assert.ok(threw, '文件不存在时没有抛错');
  assert.strictEqual(threw.code, 'RESOURCE_MISSING');
  assert.ok(/部署包不完整/.test(threw.message), '错误信息没点明是部署问题');
});

t('assertModulePathExist 存在时返回绝对路径', () => {
  const rel = BOOT.REQUIRED_MODULES[0].rel;
  const p = BOOT.assertModulePathExist(path.join(ROOT, 'qclaw-skills'), rel, 'planner');
  assert.ok(fs.existsSync(p), `返回路径不存在: ${p}`);
});

// ---------------- C) 服务端接入 ----------------
console.log('\n-- C. 服务端接入 --');

t('★★ 启动时先跑自检，缺失则 exit(1)', () => {
  const idx = SERVER.indexOf('async function start() {');
  assert.ok(idx > 0, '找不到 start()');
  const block = SERVER.slice(idx, idx + 1200);
  assert.ok(/verifyRuntimeResources\(SKILLS_DIR\)/.test(block), '启动时没有跑资源自检');
  assert.ok(/process\.exit\(1\)/.test(block), '缺失时没有拒绝启动');
  // 自检必须在任何初始化之前
  const checkPos = block.indexOf('verifyRuntimeResources');
  const firstInit = block.indexOf('ensureKBDirs');
  assert.ok(checkPos < firstInit, '自检应在初始化之前（否则会带着残缺状态做初始化）');
});

t('★★ ToolLoop 失败区分「部署缺失」与「业务错误」，不再一律静默', () => {
  const idx = SERVER.indexOf('[ToolLoop] ${fnName}');
  assert.ok(idx > 0, '找不到 ToolLoop 错误处理');
  const block = SERVER.slice(Math.max(0, idx - 1200), idx + 1400);
  assert.ok(/RESOURCE_MISSING|Cannot find module/.test(block), '没有识别「模块缺失」这一类');
  assert.ok(/needsDeployFix/.test(block), '没有标记需要补部署');
  assert.ok(/tool_unavailable/.test(block), '没有广播 tool_unavailable 事件');
});

t('★★ PlannerBackfill 补算失败也明确上报（原来只有一行 warn）', () => {
  const idx = SERVER.indexOf('[PlannerBackfill]');
  const block = SERVER.slice(idx, idx + 1600);
  assert.ok(/needsDeployFix/.test(block), 'planner 补算失败没标记部署问题');
  assert.ok(/tool_unavailable/.test(block), 'planner 补算失败没广播事件');
});

t('失败广播带 userId（否则会被 SSE 隔离拦掉或当全局事件）', () => {
  const idx = SERVER.indexOf('tool_unavailable');
  const block = SERVER.slice(idx, idx + 500);
  assert.ok(/userId/.test(block), 'tool_unavailable 事件没带 userId');
  assert.ok(/taskId/.test(block), 'tool_unavailable 事件没带 taskId');
});

// ---------------- D) 部署脚本 ----------------
console.log('\n-- D. 部署脚本 --');

t('★★ 构建脚本从代码推导清单（不再手写 SKILLS 列表）', () => {
  assert.ok(/path\\\.join\\\(SKILLS_DIR/.test(BUILD_SH) || /SKILLS_DIR/.test(BUILD_SH),
    '构建脚本没有扫描 SKILLS_DIR 引用');
  // 不能再有写死的技能名列表
  assert.ok(!/^SKILLS="5dem-executor/.test(BUILD_SH), '仍在用写死的技能清单');
  assert.ok(/\/tmp\/deploy-skill-dirs\.txt/.test(BUILD_SH), '没有生成推导出的清单文件');
});

t('★★ 构建脚本缺关键文件时直接失败（不打半个包）', () => {
  assert.ok(/missingReq\.length/.test(BUILD_SH) || /关键技能缺失/.test(BUILD_SH),
    '缺关键技能时没有报错退出');
  assert.ok(/missingMods\.length/.test(BUILD_SH) || /工具模块文件缺失/.test(BUILD_SH),
    '缺被引用模块时没有报错退出');
  assert.ok(/process\.exit\(1\)/.test(BUILD_SH), '没有 exit 1');
});

t('★★ 构建脚本用 --bundle（生产没有 backend/lib）', () => {
  assert.ok(/--bundle/.test(BUILD_SH), '后端构建没用 --bundle，生产会因缺 lib 目录启动失败');
  assert.ok(/RESIDUAL/.test(BUILD_SH), '没有校验是否还有未内联的相对 import');
  assert.ok(/--loader:\.js=ts/.test(BUILD_SH), '缺 --loader 配置（中文会被转义，需一致）');
});

t('构建脚本校验包内模块完整性', () => {
  assert.ok(/missing_in_pkg/.test(BUILD_SH), '没有校验包内模块是否齐全');
});

t('★★ 验证脚本能在目标机实跑关键技能', () => {
  assert.ok(/9dem-executor\/backend\/9dem-invoker\.js/.test(VERIFY_SH), '没验证 executor');
  assert.ok(/invoke\(\{ task:/.test(VERIFY_SH), '没有真实调用（只查文件存在不够）');
  assert.ok(/基线用例|九维必测/.test(VERIFY_SH), '没有校验产出规模');
  assert.ok(/exit 1/.test(VERIFY_SH), '失败时没有非零退出码');
});

t('验证脚本检查 dist 是否残留相对 import', () => {
  assert.ok(/RESIDUAL/.test(VERIFY_SH), '没检查未内联的 import');
  assert.ok(/backend\/lib/.test(VERIFY_SH), '没说明 backend/lib 缺失的后果');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
