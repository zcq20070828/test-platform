/**
 * 「继续」的指向 + 输出物按钮（2026-11-25）
 *
 * 两个独立问题：
 *
 * 1. **说「继续」却做了需求分析**
 *    analyzeTaskIntent('继续') 零命中（agentId=null），于是沿用前端下拉框的
 *    偏好值——它常常还停在上次选的 test-requirement-analyzer，结果又跑了一遍
 *    需求分析。但「继续」的指向是确定的：用户最近完成的那个任务。
 *
 * 2. **输出物又少按钮**
 *    UnifiedChatPanel 里「预览/用作输入/复制」三个按钮都写
 *    `v-if="artifact.content"`，而后端产出的 artifacts 只有 downloadUrl、
 *    没有 content —— 于是这三个按钮从来没显示过，用户只看到「编辑」和「下载」。
 *    上一轮修了 TasksView，漏了这个组件。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

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

console.log('=== 「继续」指向 与 输出物按钮 单元测试 ===');

// ---------------- 「继续」的指向 ----------------

t('「继续」类指令会沿用最近任务的智能体', () => {
  const idx = SERVER.indexOf('let continueHint = null');
  assert.ok(idx > 0, '找不到 continueHint 逻辑');
  const block = SERVER.slice(idx, idx + 2200);
  assert.ok(/assessSelfContained/.test(block), '未做内容语义判定');
  assert.ok(/taskDAO\.getTasks/.test(block), '未查最近任务');
  assert.ok(/targetAgent = prev\.agentId/.test(block), '未把最近任务的智能体作为目标');
});

t('「继续」按内容语义判断，不看长度（用户明确要求）', () => {
  const idx = SERVER.indexOf('let continueHint = null');
  const block = SERVER.slice(idx, idx + 2200);
  // 用户要求：「不能根据输入的长度来判断，要根据输入的内容来判断」
  // 注释里会写「原来用 t.length <= 12」，允许；只检查生效代码
  const codeBlock = block.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/t\.length <= \d+/.test(codeBlock), '仍在用长度阈值切分');
  assert.ok(/assessSelfContained\(t\)/.test(block), '未按内容语义判断');
  // 判定模块本身也不许有长度阈值
  const SEM = fs.readFileSync(path.join(ROOT, 'backend', 'lib', 'instruction-semantics.js'), 'utf8');
  const code = SEM.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/\.length\s*[<>]=?\s*\d+/.test(code), '语义模块里仍有长度阈值');
});

t('「继续」优先于意图识别（否则零命中会走下拉框兜底）', () => {
  const idxContinue = SERVER.indexOf('let continueHint = null');
  const idxIntent = SERVER.indexOf('intentInfo = analyzeTaskIntent(enrichedInput');
  assert.ok(idxContinue > 0 && idxIntent > 0);
  assert.ok(idxContinue < idxIntent, '「继续」必须在常规意图识别之前处理，否则会被下拉框偏好抢先');
});

t('任务记录里标注 continuedFrom（用户能看到接着哪个任务）', () => {
  assert.ok(/continuedFrom: continueHint \? continueHint\.taskId : null/.test(SERVER),
    '任务上没有记录续做来源');
});

t('enrichInputWithRecentContext 不再按当前智能体限定查找', () => {
  // 原来查 getTasks({ userId, agentId, ... }) —— 用户说「继续优化」时，
  // 若当前被判成需求分析，它只会在需求分析历史里找「上一份」，找不到就
  // 退化成全新需求重跑。这与「继续」的语义完全相反。
  const idx = SERVER.indexOf('async function enrichInputWithRecentContext');
  const block = SERVER.slice(idx, idx + 2400);
  const fetchIdx = block.indexOf('taskDAO.getTasks({');
  assert.ok(fetchIdx > 0, '找不到查询');
  const query = block.slice(fetchIdx, fetchIdx + 200);
  assert.ok(!/agentId,/.test(query), '仍按 agentId 限定查找，「继续」跨智能体时找不到上一份');
  assert.ok(/limit: 8/.test(query), '查询条数未放宽，可能取不到真正的上一份');
});

// ---------------- 输出物按钮 ----------------

const UNIFIED = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'UnifiedChatPanel.vue'), 'utf8');

t('UnifiedChatPanel 不再用 artifact.content 单独作为按钮条件', () => {
  // 只检查「生效的代码」，注释里提到这句是允许的（我们在那里写了原因）
  const realLines = UNIFIED.split(/\r?\n/).filter((l) => !/^\s*(\/\/|<!--|\*|\/\*)/.test(l) && !/用 v-if|原来都卡在/.test(l));
  const offenders = realLines.filter((l) => /v-if="artifact\.content"/.test(l));
  assert.strictEqual(offenders.length, 0,
    `仍有 ${offenders.length} 处只用 artifact.content 作条件：\n${offenders.join('\n')}`);
});

t('按钮判据统一在 ArtifactCard（2026-11-25 重构后）', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  assert.ok(/const hasContent = computed/.test(CARD), '组件缺 hasContent');
  assert.ok(/const canPreview = computed/.test(CARD), '组件缺 canPreview');
  assert.ok(/<ArtifactCard/.test(UNIFIED), 'UnifiedChatPanel 未使用组件');
  // 调用方不该再自己判
  assert.ok(!/function hasArtifactContent/.test(UNIFIED), 'UnifiedChatPanel 仍有自己的判据');
});

t('hasContent 认 downloadUrl（后端实际只给这个字段）', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  const idx = CARD.indexOf('const hasContent = computed');
  assert.ok(idx > 0, '找不到 hasContent');
  const block = CARD.slice(idx, idx + 300);
  assert.ok(/a\.downloadUrl/.test(block), 'downloadUrl 未被算作有内容');
});

t('预览排除二进制格式（按文本读会乱码）', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  assert.ok(/BIN_EXTS/.test(CARD), '缺二进制列表');
  assert.ok(/docx/.test(CARD) && /xlsx/.test(CARD), '未排除二进制格式');
});

t('取内容统一走 resolveContent（组件内，支持 downloadUrl + 认证头）', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  assert.ok(/async function resolveContent/.test(CARD), '缺少统一的取内容函数');
  const idx = CARD.indexOf('async function resolveContent');
  const block = CARD.slice(idx, idx + 700);
  assert.ok(/a\.downloadUrl/.test(block), '未支持 downloadUrl');
  assert.ok(/Authorization/.test(block), '未带认证头，会 401');
});

t('组件的三个交互都是异步取内容', () => {
  const CARD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'ArtifactCard.vue'), 'utf8');
  for (const fn of ['onPreview', 'onCopy', 'onUseAsInput']) {
    // 用完整签名匹配，避免 indexOf 命中调用处而非定义处
    assert.ok(new RegExp(`async function ${fn}\\(`).test(CARD), `${fn} 不是异步定义，无法走 downloadUrl`);
  }
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
