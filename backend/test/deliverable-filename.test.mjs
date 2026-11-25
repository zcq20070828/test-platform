#!/usr/bin/env node
/**
 * 交付物文件名要带项目名与版本号（2026-11-23）
 *
 * 用户反馈：「交付物的文档名称中没有项目名字、版本了？」
 *
 * 库里证据（同一天、同一项目，文件名却不一样）：
 *   11:13:38  中国移动云盘_算力大作战_活动(活动ID_NationalTokenPK_V1.0.0测试用例.md   ← 正常
 *   11:26:02  测试用例.md                                                          ← 退化
 *   10:58:43  需求分析报告.md                                                      ← 退化
 *
 * 根因：extractReportProjectName 的表格正则是 `([^|\n]{2,40})`，值长度上限 40。
 *   项目名「中国移动云盘"算力大作战"活动(活动ID: National_TokenPK / 全网算力大作战)」
 *   有 49 个字符 → 整行失配 → 一路回退到空 → buildDeliverableBaseName 返回纯类型名。
 *   内容本身完全正常（# 【测试用例集】… + 项目信息表格里项目名/版本号都在）。
 *
 * 真实项目名带括号补充说明很常见（活动ID、内部代号、需求来源），40 字上限太紧。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 交付物文件名带项目名与版本 ===');

/** 从 server.js 抠出三个函数并在沙箱里执行 */
function loadNamer() {
  const grab = (name) => {
    const i = SERVER.indexOf('function ' + name);
    assert.ok(i >= 0, `找不到 ${name}`);
    let d = 0;
    for (let k = SERVER.indexOf('{', i); k < SERVER.length; k += 1) {
      if (SERVER[k] === '{') d += 1;
      else if (SERVER[k] === '}') { d -= 1; if (d === 0) return SERVER.slice(i, k + 1); }
    }
    throw new Error(`${name} 解析失败`);
  };
  const code = [grab('stripProjectNameExplanation'), grab('extractReportProjectName'), grab('extractProjectInfo'), grab('buildDeliverableBaseName')].join('\n');
  // UNKNOWN_PROJECT_NAME 是模块级常量（2026-11-25 引入），
  // 沙箱里必须补上，否则 buildDeliverableBaseName 引用不到。
  const factory = new Function(
    `const UNKNOWN_PROJECT_NAME = ${JSON.stringify('不知名项目')};\n${code}; `
    + 'return { extractReportProjectName, extractProjectInfo, buildDeliverableBaseName };',
  );
  return factory();
}

// 实测那条退化内容的缩影（结构完全一致）
const REAL_CASE = [
  '# 【测试用例集】中国移动云盘"算力大作战"活动 V1.0.0',
  '',
  '## 项目信息',
  '',
  '| 项目项 | 内容 |',
  '| --- | --- |',
  '| 项目名称 | 中国移动云盘"算力大作战"活动(活动ID: National_TokenPK / 全网算力大作战) |',
  '| 版本号 | 1.0.0 |',
].join('\n');

t('★★ 长项目名（49 字，带括号说明）不再被丢弃', () => {
  const n = loadNamer();
  const name = n.extractReportProjectName(REAL_CASE);
  assert.ok(name, '项目名提取为空（这是文件名退化的直接原因）');
  assert.ok(name.includes('算力大作战'), `提取到的项目名不对：${name}`);
});

t('★★ 真实内容的文件名必须含项目名与版本号', () => {
  const n = loadNamer();
  const base = n.buildDeliverableBaseName(REAL_CASE, '测试用例');
  assert.ok(base.includes('算力大作战'), `文件名丢了项目名：${base}`);
  assert.ok(/V1\.0\.0/.test(base), `文件名丢了版本号：${base}`);
  assert.ok(base.endsWith('测试用例'), `文件名丢了交付件类型：${base}`);
});

t('★ 括号补充说明被剥离（避免文件名过长）', () => {
  const n = loadNamer();
  const base = n.buildDeliverableBaseName(REAL_CASE, '测试用例');
  assert.ok(!/活动ID|National_TokenPK/.test(base), `括号内补充没剥离，文件名过长：${base}`);
  assert.strictEqual(base, '中国移动云盘"算力大作战"活动V1.0.0测试用例',
    `文件名不符合预期：${base}`);
});

t('★ 剥离后不能太短（否则宁可保留原文）', () => {
  const n = loadNamer();
  // 项目名几乎全在括号里：剥离后只剩几个字，应保留原文
  const content = [
    '# 测试用例集',
    '',
    '| 项目名称 | AB(这是一个很长很长的括号补充说明用于测试剥离逻辑) |',
    '| 版本号 | 1.0.0 |',
  ].join('\n');
  const base = n.buildDeliverableBaseName(content, '测试用例');
  assert.ok(base.includes('AB'), `项目主干丢了：${base}`);
  assert.ok(!/^V1\.0\.0测试用例$/.test(base), '项目名被剥离成空');
});

t('★ 常规短项目名照常工作（不回归）', () => {
  const n = loadNamer();
  const cases = [
    ['# 托管系统技术方案\n\n| 项目名称 | 托管系统 |\n| 版本号 | V1.0 |', '测试用例', '托管系统V1.0测试用例'],
    ['# 需求分析报告\n\n| 项目名称 | 灵犀整理云盘照片为自定义相册 |\n| 版本号 | 1.0.0 |', '需求分析报告', '灵犀整理云盘照片为自定义相册V1.0.0需求分析报告'],
  ];
  for (const [txt, kind, expected] of cases) {
    assert.strictEqual(n.buildDeliverableBaseName(txt, kind), expected, `「${expected}」不匹配`);
  }
});

t('★★ 整句说明不能被当成项目名', () => {
  const n = loadNamer();
  // 无 # 标题时首行会走兜底，容易把整句当成项目名
  for (const junk of [
    '这是一段没有任何项目信息的内容',
    '请帮我分析一下这个需求',
    '以下是测试结果汇总。',
  ]) {
    const name = n.extractReportProjectName(junk);
    assert.strictEqual(name, '', `把整句当成了项目名：${name}`);
  }
});

t('真正没有项目信息时用「不知名项目」兜底', () => {
  const n = loadNamer();
  const base = n.buildDeliverableBaseName('这是一段没有任何项目信息的内容', '测试用例');
  // 2026-11-25 用户明确要求：取不到项目名时用「不知名项目」，
  // 而不是丢掉项目名栏位只留类型名——交付物归档时没有项目名就分不清是哪份。
  assert.strictEqual(base, '不知名项目测试用例', `应兜底为「不知名项目」，实际：${base}`);
});

t('★ 表格表头 | 项目 | 内容 | 不能被当成项目名', () => {
  const n = loadNamer();
  const content = [
    '# 测试用例集',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    '| 项目名称 | 移动云盘活动 |',
    '| 版本号 | 2.1.0 |',
  ].join('\n');
  const name = n.extractReportProjectName(content);
  assert.strictEqual(name, '移动云盘活动', `表头被误当成项目名：${name}`);
});

t('版本号三种写法都能提取', () => {
  const n = loadNamer();
  const cases = [
    '| 版本号 | 1.0.0 |',
    '版本号：2.3.1',
    '- **版本号**：V3.0',
  ];
  for (const line of cases) {
    const info = n.extractProjectInfo(`# 测试用例集\n\n| 项目名称 | 某系统 |\n${line}`);
    assert.ok(/^V\d+\.\d+/.test(info.versionOrFeature), `「${line}」没提取到版本号：${info.versionOrFeature}`);
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
