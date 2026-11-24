#!/usr/bin/env node
/**
 * 图标字体本地化 + 溢出兜底 + preload（2026-11-24）
 *
 * 用户给的诊断（完全正确）：
 *   内网访问极慢甚至超时 → 图标字体没加载 → `.material-symbols-outlined`
 *   把图标名当普通文字渲染（checklist / smart_toy 一长串英文）→ 冲出容器
 *   与旁边中文叠在一起。
 *
 * 核实出的实际情况：
 *   - Material Symbols 其实已经由 npm 包 `material-symbols` 本地化了
 *     （main.ts 里 import 'material-symbols/outlined.css'，woff2 3.8MB 打进 dist/assets）；
 *   - 但 index.html 还挂着 4 个外网请求：fonts.googleapis.com × 2、
 *     fonts.gstatic.com preconnect、cdn.jsdelivr.net（Geist 备用）。
 *     内网环境下就是这 4 个请求挂到超时，拖慢首屏；
 *   - 图标样式缺 overflow: hidden，字体没到位时字母串确实会外溢；
 *   - 没有 preload，字体要等 CSS 解析到 @font-face 才发起请求。
 *
 * 三步修复（本文件逐条锁死）：
 *   A. index.html 不再引用任何外网字体
 *   B. `.material-symbols-outlined` 限宽 + overflow: hidden（全局兜底 10 处直接调用）
 *   C. 构建时注入 preload（文件名带 hash，无法硬编码进 index.html）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'frontend');
const INDEX = fs.readFileSync(path.join(FE, 'index.html'), 'utf8');
const VITE = fs.readFileSync(path.join(FE, 'vite.config.ts'), 'utf8');
const CSS = fs.readFileSync(path.join(FE, 'src', 'styles', 'stitch-cards.css'), 'utf8');
const MSICON = fs.readFileSync(path.join(FE, 'src', 'components', 'MsIcon.vue'), 'utf8');
const MAIN = fs.readFileSync(path.join(FE, 'src', 'main.ts'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 图标字体本地化 / 溢出兜底 / preload ===');

/** 去掉 HTML 注释（说明文字里会提到这些域名，不能算引用） */
function stripHtmlComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

// ---------------- A) 无外网字体 ----------------
console.log('\n-- A. 不请求外网字体 --');

t('★★ index.html 里没有生效的外网字体 link（注释不算）', () => {
  const code = stripHtmlComments(INDEX);
  const bad = [];
  if (/fonts\.googleapis\.com/.test(code)) bad.push('fonts.googleapis.com');
  if (/fonts\.gstatic\.com/.test(code)) bad.push('fonts.gstatic.com');
  if (/cdn\.jsdelivr\.net/.test(code)) bad.push('cdn.jsdelivr.net');
  assert.deepStrictEqual(bad, [], `仍有外网字体请求：${bad.join(', ')}（内网会挂到超时）`);
});

t('★ 没有 preconnect 到外网字体域（那是为外网字体服务的）', () => {
  const code = stripHtmlComments(INDEX);
  assert.ok(!/rel="preconnect"[^>]*fonts\.(googleapis|gstatic)/.test(code),
    'preconnect 仍指向 Google 字体域');
});

t('★★ 图标字体来自本地 npm 包（main.ts 引入 CSS，Vite 打包 woff2）', () => {
  assert.ok(/import ['"]material-symbols\/outlined\.css['"]/.test(MAIN),
    'main.ts 没有引入本地 material-symbols CSS');
  // 依赖包必须在 package.json 里（否则 clean install 后字体消失）
  const pkg = JSON.parse(fs.readFileSync(path.join(FE, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(deps['material-symbols'], 'package.json 缺 material-symbols 依赖');
});

t('Geist / JetBrains 有完整系统字体 fallback（不装字体也能读）', () => {
  const vars = fs.readFileSync(path.join(FE, 'src', 'styles', 'variables.css'), 'utf8');
  const ui = vars.match(/--font-ui:\s*([^;]+);/);
  const mono = vars.match(/--font-mono:\s*([^;]+);/);
  assert.ok(ui && mono, '找不到 --font-ui / --font-mono');
  // 每个字体栈都必须以通用族结尾，否则内网无字体时回退不确定
  assert.ok(/sans-serif|system-ui/.test(ui[1]), '--font-ui 没有系统字体兜底');
  assert.ok(/monospace/.test(mono[1]), '--font-mono 没有等宽兜底');
});

/** 取出指定选择器的规则块
 *
 * 注意：文件里有多个含 .material-symbols-outlined 的规则
 * （如 `.pto-icon-tile .material-symbols-outlined`），
 * 用 indexOf('.material-symbols-outlined {') 会命中错的那个。
 * 这里要求选择器前是行首或 `,`/`}`，即精确匹配顶层的独立选择器。
 */
function ruleBlock(css, selector) {
  const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm');
  const m = re.exec(css);
  assert.ok(m, `找不到规则 ${selector}`);
  const start = m.index + m[0].length - 1;
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

// ---------------- B) 溢出兜底 ----------------
console.log('\n-- B. 字体未加载时不外溢 --');

t('★★ 全局 `.material-symbols-outlined` 有 overflow: hidden', () => {
  const block = ruleBlock(CSS, '.material-symbols-outlined');
  assert.ok(/overflow:\s*hidden/.test(block),
    '缺 overflow: hidden —— 图标名会当文字排出来并冲出容器');
  assert.ok(/text-overflow:\s*clip/.test(block),
    '缺 text-overflow: clip（默认可能出省略号，观感同样像乱码）');
});

t('★★ 全局图标有宽度约束（否则 overflow:hidden 无处可裁）', () => {
  const block = ruleBlock(CSS, '.material-symbols-outlined');
  assert.ok(/width:\s*1em/.test(block) && /max-width:\s*1em/.test(block),
    '没有宽度约束，overflow: hidden 不会生效');
  assert.ok(/height:\s*1em/.test(block), '没有高度约束，多行字母会撑高');
});

t('★ MsIcon 组件自身也加了 overflow: hidden', () => {
  const styleIdx = MSICON.indexOf('<style');
  const style = MSICON.slice(styleIdx);
  assert.ok(/overflow:\s*hidden/.test(style), 'MsIcon 缺 overflow: hidden');
  // 尺寸由 iconStyle 提供，必须保留（不能只靠 1em 兜底）
  assert.ok(/width:\s*sizePx\.value/.test(MSICON), 'MsIcon 的显式 width 被删掉了');
  assert.ok(/height:\s*sizePx\.value/.test(MSICON), 'MsIcon 的显式 height 被删掉了');
});

t('兜底不会破坏正常渲染（字体加载后仍是 1em 见方）', () => {
  const block = ruleBlock(CSS, '.material-symbols-outlined');
  // 不能出现 display:none 之类「看不见」的兜底——字体好了也看不见图标
  assert.ok(!/display:\s*none/.test(block), '兜底把图标整个藏了，字体加载后也看不见');
  assert.ok(/display:\s*inline-block/.test(block), 'display 被改坏');
});

// ---------------- C) preload ----------------
console.log('\n-- C. 图标字体 preload --');

t('★★ vite 插件在构建时注入 preload（文件名带 hash，不能硬编码）', () => {
  assert.ok(/fontPreloadPlugin/.test(VITE), 'vite.config.ts 没有 font-preload 插件');
  assert.ok(/generateBundle/.test(VITE), '没有在 generateBundle 阶段处理（拿不到最终文件名）');
  assert.ok(/\.woff2/.test(VITE), '没有筛选 woff2 产物');
  assert.ok(/rel="preload"/.test(VITE), '没有生成 preload link');
  assert.ok(/as="font"/.test(VITE), 'preload 缺 as="font"');
  assert.ok(/crossorigin/.test(VITE),
    'preload 缺 crossorigin —— 字体请求按 CORS 规则发起，不带会重复下载');
});

t('★ 插件只在 build 阶段跑（dev 不需要）', () => {
  assert.ok(/apply:\s*'build'/.test(VITE), '插件没限定 build 阶段');
});

t('★★ 已构建产物里 preload 指向本地字体', () => {
  const distIndex = path.join(FE, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    // 还没构建过就跳过（CI 里构建后再跑这个测试即可）
    console.log('     (未构建，跳过对 dist 的检查)');
    return;
  }
  const dist = fs.readFileSync(distIndex, 'utf8');
  const preloads = dist.match(/<link[^>]+rel="preload"[^>]+as="font"[^>]*>/g) || [];
  assert.ok(preloads.length > 0, 'dist/index.html 里没有字体 preload');
  for (const p of preloads) {
    assert.ok(/href="\/assets\/[^"]+\.woff2"/.test(p), `preload 不指向本地 assets: ${p}`);
    assert.ok(/crossorigin/.test(p), `preload 缺 crossorigin: ${p}`);
  }
  // 产物里不能有外网字体
  assert.ok(!/https:\/\/fonts\.(googleapis|gstatic)\.com/.test(dist),
    'dist/index.html 仍引用外网字体');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
