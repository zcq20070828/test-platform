/**
 * 审核否决也要保留交付物（2026-11-26）
 *
 * 用户截图：任务 e8cee999 三审未过（54/62/39），触发一票否决，重试耗尽。
 *
 * 查下来发现一个严重问题：**123071 字的用例集（222 条）一个文件都没落盘**。
 * 注册表里只有「执行证据.json」，DB artifacts 为 0 条。
 * 用户拿不到任何东西，连改的机会都没有。
 *
 * 根因是失败分支里的一个过时判断：
 *   if (!/```/.test(rawResult)) { 跳过物化 }
 * 本意是「不要物化纯状态/错误占位」，但它用「有没有 ``` 代码块」当判据，
 * 而**用例交付物是 Markdown 表格，没有代码块** —— 完整交付物被当成占位跳过。
 *
 * 顺带修了历史损失：加 rematerializeDeliverables，
 * 给「result 有实质内容但注册表没交付物」的任务按需补物化。
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

console.log('=== 否决保留交付物 单元测试 ===');

/** 取失败分支的物化逻辑 */
function failBranch() {
  const start = SERVER.indexOf('const reason = lastError ||');
  assert.ok(start > 0, '找不到失败分支');
  // 从失败分支开头取到下一个 case/分支标记，覆盖整段物化逻辑
  const end = SERVER.indexOf("type: 'task_review_exhausted'", start);
  return SERVER.slice(start, end > start ? end + 500 : start + 8000);
}

t('不再用「有没有代码块」判断要不要物化', () => {
  const block = failBranch();
  // 注释里会写「原来用 ``` 判断」，允许；只看生效代码
  const code = block.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/```/.test(code),
    '生效代码里仍有 ``` 判断——用例交付物是 Markdown 表格，会被误跳过');
});

t('改用「内容是否有实质产出」判断', () => {
  const block = failBranch();
  assert.ok(/hasSubstance/.test(block), '缺少实质内容判断');
  assert.ok(/length >= 500/.test(block), '缺长度下限');
  assert.ok(/looksLikeFailurePlaceholder/.test(block), '缺失败占位识别');
});

t('失败占位仍会被跳过（不物化垃圾）', () => {
  // 失败分支自己只识别「❌ 任务执行失败」
  assert.ok(failBranch().includes('任务执行失败'), '失败分支未识别失败占位');
  // 补物化函数（给历史任务用）要同时识别对话轮的失败占位
  const rs = SERVER.indexOf('async function rematerializeDeliverables');
  assert.ok(rs > 0, '找不到 rematerializeDeliverables');
  const rmBlock = SERVER.slice(rs, rs + 1200);
  // 源码里是 /^\[本轮失败\]/ 带转义反斜杠，不能用 includes('[本轮失败]')
  assert.ok(rmBlock.includes('本轮失败'), '补物化未识别对话失败占位');
});

t('存在 rematerializeDeliverables（补历史损失）', () => {
  assert.ok(/async function rematerializeDeliverables/.test(SERVER), '缺少补物化函数');
  const start = SERVER.indexOf('async function rematerializeDeliverables');
  const block = SERVER.slice(start, start + 2500);
  // 只在注册表确实没有交付物时才补（避免重复写盘）
  assert.ok(/hasDeliverable/.test(block), '未检查注册表是否已有交付物');
  assert.ok(/ARTIFACT_AUDIT_RE/.test(block), '未排除证据文件');
});

t('详情接口在「注册表也没交付物」时触发补物化', () => {
  const start = SERVER.indexOf("app.get('/api/tasks/:id', authenticate");
  const end = SERVER.indexOf('if (!canAccessTask(task, req))', start);
  const block = SERVER.slice(start, end);
  assert.ok(/rematerializeDeliverables/.test(block), '详情接口未触发补物化');
  // 必须在 artifactsFromRegistry 也没结果时才走
  const regIdx = block.indexOf('artifactsFromRegistry');
  const remIdx = block.indexOf('rematerializeDeliverables');
  assert.ok(regIdx > 0 && remIdx > regIdx, '补物化位置不对（应先查注册表）');
});

t('补物化结果走统一构造器（字段齐全）', () => {
  const start = SERVER.indexOf("app.get('/api/tasks/:id', authenticate");
  const end = SERVER.indexOf('if (!canAccessTask(task, req))', start);
  const block = SERVER.slice(start, end);
  assert.ok(/buildArtifacts\(id, remade/.test(block) || /buildArtifacts/.test(block),
    '补物化结果未走 buildArtifacts');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
