/**
 * 交付物展示与下载（2026-11-25）
 *
 * 用户报了两个问题，都对应真实缺陷：
 *
 * 1. **操作按钮少了几个**：任务列表的输出物卡片只有「预览」「下载」，
 *    对话面板有四个。而且任务列表的「预览」条件是 v-if="artifact.content"，
 *    后端产出的 artifacts 只有 downloadUrl、没有 content，
 *    所以连预览按钮都从来不显示——用户实际只看到「下载」一个。
 *
 * 2. **信息缺一块**：卡片上显示「文件  -  14:38:09」，
 *    中间的 "-" 是 size 缺失。落库的 artifacts 字段确实没有 size。
 *
 * 另外查出一个更严重的问题：
 * 3. **下载时 Content-Type 写死 text/markdown**，xlsx/docx 按 markdown 返回。
 *    Excel 打开报「文件格式与扩展名不符」。文件本身是好的，
 *    只是响应头类型错，但足以让下载后的文件打不开。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const TASKS_VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'TasksView.vue'), 'utf8');

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

console.log('=== 交付物展示与下载 单元测试 ===');

// ---------------- 缺陷 3：Content-Type（最严重）----------------

/** 取下载路由处理体 */
function downloadHandler() {
  const start = SERVER.indexOf("app.get('/api/tasks/:taskId/artifacts/:artifactId/download'");
  assert.ok(start > 0, '找不到下载路由');
  const end = SERVER.indexOf("app.get('/api/tasks/:taskId/artifacts/:artifactId/preview'", start);
  assert.ok(end > start, '找不到路由边界');
  return SERVER.slice(start, end);
}

t('下载不再把 Content-Type 写死成 text/markdown', () => {
  const h = downloadHandler();
  assert.ok(!/setHeader\('Content-Type',\s*'text\/markdown/.test(h),
    'Content-Type 仍是写死的 text/markdown，xlsx/docx 下载后打不开');
});

t('按扩展名返回正确 MIME', () => {
  const h = downloadHandler();
  assert.ok(/ext2mime/.test(h), '缺少扩展名到 MIME 的映射');
  assert.ok(/docx: 'application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document'/.test(h),
    'docx 的 MIME 不对');
  assert.ok(/xlsx: 'application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet'/.test(h),
    'xlsx 的 MIME 不对');
  assert.ok(/pdf: 'application\/pdf'/.test(h), 'pdf 的 MIME 不对');
});

t('未知扩展名退化成 octet-stream（不是硬套 markdown）', () => {
  const h = downloadHandler();
  assert.ok(/application\/octet-stream/.test(h), '未知类型没有兜底');
});

t('文件名用 RFC 5987 filename* 传 UTF-8（中文名不乱码）', () => {
  const h = downloadHandler();
  assert.ok(/filename\*=UTF-8''/.test(h), '缺少 filename*，中文文件名可能丢失');
});

// ---------------- 缺陷 2：size 缺失 ----------------

t('artifactsFromRegistry 走统一构造器（size 在构造器里补）', () => {
  const start = SERVER.indexOf('async function artifactsFromRegistry');
  const end = SERVER.indexOf('async function', start + 10);
  const block = SERVER.slice(start, end > start ? end : start + 2000);
  // 2026-11-26 重构：size 的 stat 逻辑收敛进 buildArtifact，
  // 这里只验证「注册表重建确实走了构造器」。
  assert.ok(/buildArtifacts\(/.test(block), '注册表重建未使用统一构造器');
  // 构造器里必须有 statSync 取 size
  const bStart = SERVER.indexOf('function buildArtifact(');
  const bEnd = SERVER.indexOf('function buildArtifacts(');
  const body = SERVER.slice(bStart, bEnd);
  assert.ok(/statSync\(fp\)\.size/.test(body), '构造器没有从文件系统取真实大小');
});

t('normalizeArtifactsField 统一给历史数据补 size', () => {
  const start = SERVER.indexOf('function normalizeArtifactsField');
  const end = SERVER.indexOf('function', SERVER.indexOf('return a;', start));
  const block = SERVER.slice(start, end);
  assert.ok(/statSync\(a\.path\)\.size/.test(block),
    '读时没有补 size，历史任务仍显示「-」');
  // 2026-11-26：改为 patch 模式（a.size == null 才补），语义等价
  assert.ok(/a\.size == null/.test(block), '已有 size 时应跳过，避免重复 stat');
});

t('size 缺失不影响下载（容错）', () => {
  const start = SERVER.indexOf('function normalizeArtifactsField');
  const block = SERVER.slice(start, start + 1600);
  assert.ok(/catch\s*\(_\)/.test(block), 'stat 失败没有兜底，会让整个接口报错');
});

// ---------------- 缺陷 1：按钮缺失 ----------------

t('任务列表不再自己实现按钮判据（已收进 ArtifactCard）', () => {
  // 2026-11-25 重构：判据统一到 ArtifactCard，
  // 调用方只传 show 数组决定显示哪几个按钮。
  // 这条测试从「检查调用方有没有正确的 v-if」改为「检查调用方不再自己判」，
  // 因为后者才是重构后该守住的不变量。
  assert.ok(/<ArtifactCard/.test(TASKS_VIEW), '未使用 ArtifactCard');
  const code = TASKS_VIEW.split('\n').filter((l) => !/^\s*(\/\/|<!--|\*)/.test(l)).join('\n');
  assert.ok(!/v-if="artifact\.content/.test(code), '仍在用 artifact.content 作按钮条件');
});

t('预览判定在 ArtifactCard 里，认 downloadUrl（docx/xlsx 也能预览）', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  assert.ok(/const canPreview = computed/.test(CARD), '组件缺 canPreview');
  // 2026-11-26：预览走服务端转换，docx/xlsx 支持（判据在常量里）
  assert.ok(/const SERVER_PREVIEW_EXTS = \/[^\n]*docx\|xlsx/.test(CARD),
    '预览应支持 docx/xlsx（后端有转换能力）');
  const contentIdx = CARD.indexOf('const hasContent');
  assert.ok(/a\.downloadUrl/.test(CARD.slice(contentIdx, contentIdx + 300)), '没把 downloadUrl 当可用依据');
});

t('任务列表通过 show 声明要哪几个按钮', () => {
  const m = TASKS_VIEW.match(/:show="\[([^\]]+)\]"/);
  assert.ok(m, 'TasksView 未传 show');
  for (const action of ['preview', 'copy', 'useAsInput', 'download']) {
    assert.ok(m[1].includes(action), `show 里缺 ${action}`);
  }
});

t('复制对二进制格式给明确提示（在 ArtifactCard 里）', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  assert.ok(/不支持复制内容/.test(CARD), '复制二进制文件时没有提示');
  const idx = CARD.indexOf('async function onCopy');
  assert.ok(/isBinary\.value/.test(CARD.slice(idx, idx + 400)), '复制前未判二进制');
});

t('「用作输入」真的把内容带进提交框', () => {
  // 重构后：ArtifactCard 取好内容 → emit → TasksView 的 handler 负责跳转
  assert.ok(/function handleUseArtifactAsInput/.test(TASKS_VIEW), '缺 handler');
  const idx = TASKS_VIEW.indexOf('function handleUseArtifactAsInput');
  assert.ok(/query: \{ seed:/.test(TASKS_VIEW.slice(idx, idx + 800)), '没有通过 query 传内容');
  // Dashboard 侧要真的读这个参数，否则跳过去输入框还是空的
  const DASHBOARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'DashboardView.vue'), 'utf8');
  assert.ok(/route\.query\.seed/.test(DASHBOARD), 'Dashboard 没有读取 seed，用作输入无效');
  assert.ok(/taskInput\.value = seed/.test(DASHBOARD), 'seed 没有填进提交框');
});

t('seed 用完清掉 query（避免刷新重复填入）', () => {
  const DASHBOARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'DashboardView.vue'), 'utf8');
  assert.ok(/router\.replace/.test(DASHBOARD), '没有清理 query，刷新会重复填入');
});

// ---------------- 类型与图标一致 ----------------

t('输出物类型按扩展名细化（不再全是「文件」）', () => {
  assert.ok(/function artifactKind/.test(TASKS_VIEW), '缺少 artifactKind');
  const start = TASKS_VIEW.indexOf('function artifactKind');
  const block = TASKS_VIEW.slice(start, start + 700);
  assert.ok(/xlsx\?/.test(block), '未识别表格');
  assert.ok(/md\|docx\?/.test(block), '未识别报告');
});

t('图标与类型标签同源（在 ArtifactCard 里用同一份 kind）', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  assert.ok(/const kind = computed/.test(CARD), '缺少 kind 判据');
  // 标签与图标都从同一个 kind 派生，不可能不一致
  assert.ok(/const kindLabel = computed/.test(CARD), '缺 kindLabel');
  assert.ok(/const kindIcon = computed/.test(CARD), '缺 kindIcon');
  // 模板里两者都直接绑定，不再各自传参
  assert.ok(/:name="kindIcon"/.test(CARD), '图标没有绑定 kindIcon');
  assert.ok(/\{\{ kindLabel \}\}/.test(CARD), '标签没有绑定 kindLabel');
});

// ---------------- 缺陷 4：列表接口不带 artifacts（真正的根因）----------------

const TASK_DAO = fs.readFileSync(path.join(ROOT, 'backend', 'database', 'task-dao.js'), 'utf8');

t('formatTask 必须映射 artifacts（根因）', () => {
  // 这是用户报「还是提示没有可下载的内容」的真正原因：
  // formatTask 是 DAO 的统一出口，它没映射 artifacts，
  // 于是列表接口返回 undefined，前端 artifact 对象既无 content 也无 downloadUrl，
  // 点下载必然弹「该输出物没有可下载的内容」。
  // 只有详情接口走 resolveTaskForArtifact 单独查列，所以详情能看到、列表看不到。
  const start = TASK_DAO.indexOf('function formatTask');
  assert.ok(start > 0, '找不到 formatTask');
  const end = TASK_DAO.indexOf('\n}', TASK_DAO.indexOf('modelName', start));
  const block = TASK_DAO.slice(start, end > start ? end : start + 3000);
  assert.ok(/artifacts:/.test(block), 'formatTask 仍未映射 artifacts，列表接口拿不到交付物');
});

t('artifacts 兼容字符串与数组两种存储形态', () => {
  const start = TASK_DAO.indexOf('function formatTask');
  const block = TASK_DAO.slice(start, start + 4000);
  assert.ok(/Array\.isArray\(row\.artifacts\)/.test(block), '未处理数组形态');
  assert.ok(/JSON\.parse\(row\.artifacts\)/.test(block), '未处理字符串形态（MySQL 驱动可能返回字符串）');
});

t('列表接口对 artifacts 补 size', () => {
  const start = SERVER.indexOf("app.get('/api/tasks', authenticate");
  const block = SERVER.slice(start, start + 1500);
  assert.ok(/normalizeArtifactsField\(slim\.artifacts\)/.test(block),
    '列表接口没有补 size，卡片仍会显示「-」');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
