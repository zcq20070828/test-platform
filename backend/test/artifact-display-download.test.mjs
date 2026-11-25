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

t('artifactsFromRegistry 补 size 字段', () => {
  const start = SERVER.indexOf('async function artifactsFromRegistry');
  const end = SERVER.indexOf('async function', start + 10);
  const block = SERVER.slice(start, end > start ? end : start + 2000);
  assert.ok(/size/.test(block), '注册表重建的 artifacts 仍没有 size');
  assert.ok(/statSync\(f\.filePath\)\.size/.test(block), '没有从文件系统取真实大小');
});

t('normalizeArtifactsField 统一给历史数据补 size', () => {
  const start = SERVER.indexOf('function normalizeArtifactsField');
  const end = SERVER.indexOf('\n}', SERVER.indexOf('return a;', start)) + 2;
  const block = SERVER.slice(start, end);
  assert.ok(/statSync\(a\.path\)\.size/.test(block),
    '读时没有补 size，历史任务仍显示「-」');
  assert.ok(/a\.size != null/.test(block), '已有 size 时应跳过，避免重复 stat');
});

t('size 缺失不影响下载（容错）', () => {
  const start = SERVER.indexOf('function normalizeArtifactsField');
  const block = SERVER.slice(start, start + 1600);
  assert.ok(/catch\s*\(_\)/.test(block), 'stat 失败没有兜底，会让整个接口报错');
});

// ---------------- 缺陷 1：按钮缺失 ----------------

t('任务列表的预览按钮不再只认 content', () => {
  const start = TASKS_VIEW.indexOf('class="artifact-actions"');
  const block = TASKS_VIEW.slice(start, start + 1400);
  assert.ok(!/v-if="artifact\.content"[^>]*@click="previewArtifact"/.test(block),
    '预览按钮仍只在有 content 时显示，后端不给 content 就永远看不到');
  assert.ok(/canPreviewArtifact\(artifact\)/.test(block), '缺少统一的预览判定函数');
});

t('预览判定包含 downloadUrl，且排除二进制格式', () => {
  const start = TASKS_VIEW.indexOf('function canPreviewArtifact');
  assert.ok(start > 0, '缺少 canPreviewArtifact');
  const block = TASKS_VIEW.slice(start, start + 700);
  assert.ok(/artifact\.downloadUrl/.test(block), '没把 downloadUrl 当可预览依据');
  assert.ok(/docx/.test(block) && /xlsx/.test(block), '未排除二进制格式，预览会出乱码');
});

t('任务列表补齐「复制」「用作输入」按钮', () => {
  const start = TASKS_VIEW.indexOf('class="artifact-actions"');
  const block = TASKS_VIEW.slice(start, start + 1600);
  assert.ok(/copyArtifactContent/.test(block), '缺少复制按钮');
  assert.ok(/useArtifactAsInput/.test(block), '缺少用作输入按钮');
});

t('复制对二进制格式给明确提示，不尝试读文本', () => {
  const start = TASKS_VIEW.indexOf('async function copyArtifactContent');
  const block = TASKS_VIEW.slice(start, start + 900);
  assert.ok(/不支持复制内容/.test(block), '复制二进制文件时没有提示');
});

t('「用作输入」真的把内容带进提交框', () => {
  const start = TASKS_VIEW.indexOf('async function useArtifactAsInput');
  const block = TASKS_VIEW.slice(start, start + 1000);
  assert.ok(/query: \{ seed:/.test(block), '没有把内容通过 query 传给提交页');
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

t('图标与类型标签同源（不会显示「报告」却用文件夹图标）', () => {
  assert.ok(/function artifactIcon/.test(TASKS_VIEW), '缺少 artifactIcon');
  // 模板里图标必须走 artifactIcon(artifactKind(...))
  assert.ok(/artifactIcon\(artifactKind\(artifact\)\)/.test(TASKS_VIEW),
    '图标没有使用同一套判据');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
