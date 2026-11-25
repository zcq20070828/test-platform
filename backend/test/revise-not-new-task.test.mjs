#!/usr/bin/env node
/**
 * 「继续优化」不该新建任务（2026-11-23）
 *
 * 用户实测反馈：「我刚在dev实测用例优化，怎么还重新建一个任务啊」。
 *
 * 库里证据（任务 c1e6dc32，2026-11-23 09:22 创建，running）：
 *   input = 「五维评分：需求一致性 84…从审核结果看，该用例还有优化空间，继续优化」（192 字）
 *   → 被当成全新需求，从需求重跑了一遍完整生成。
 * 更早的 ab0ff0cd（11-20）输入就两个字「继续优化」，直接 failed「输入长度不足」。
 *
 * 三个真实缺陷：
 *   1) 前后端的续做词表都只有「重新生成/重做/重跑」，没有「继续优化/继续改进/
 *      还有优化空间」——用户看完审核意见说的正是后者。
 *   2) 后端注入逻辑用的是 60 字上限，这条 192 字的指令连注入都没触发；
 *      就算触发，注入的也是「需求原文 + 交付物摘要」，模型会从需求重新生成，
 *      而不是在现有交付物上改——与本意相反。
 *   3) 前端只弹「要不要新建」的提示，用户点「去对话修改」后还得自己去历史里
 *      找那个任务，路径太长；现在直接送进上一份任务的对话并发送。
 *
 * 本文件把这些固化成不变量。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'views', 'DashboardView.vue'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

console.log('=== 「继续优化」应走对话而非新建任务 ===');

/** 取出 enrichInputWithRecentContext 函数体（从参数列表右括号后开始配对，避免默认参数的 {} 干扰） */
function enrichFn() {
  const start = SERVER.indexOf('async function enrichInputWithRecentContext');
  assert.ok(start > 0, '找不到 enrichInputWithRecentContext');
  const parenStart = SERVER.indexOf('(', start);
  let d = 0; let parenEnd = -1;
  for (let k = parenStart; k < SERVER.length; k += 1) {
    if (SERVER[k] === '(') d += 1;
    else if (SERVER[k] === ')') { d -= 1; if (d === 0) { parenEnd = k; break; } }
  }
  let depth = 0; let end = -1;
  for (let i = SERVER.indexOf('{', parenEnd); i < SERVER.length; i += 1) {
    if (SERVER[i] === '{') depth += 1;
    else if (SERVER[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > start, '函数体解析失败');
  return SERVER.slice(start, end + 1);
}

// ---------------- A) 词表 ----------------
console.log('\n-- A. 续做词表 --');

/**
 * 从后端 enrichInputWithRecentContext 提取「是否改稿指令」的判定函数
 *
 * 2026-11-23 起后端改成两个常量 + 长度粗筛（与前端同一套模式）：
 *   const REVISE_VERB_RE = /.../
 *   const REVISE_REF_RE  = /.../
 *   const refersToPrevious = REVISE_REF_RE.test(input) || (REVISE_VERB_RE.test(input) && input.length <= 80)
 * 不能再按单行正则字面量提取。
 */
function backendRevisionDetector() {
  const fn = enrichFn();
  const verbM = fn.match(/const REVISE_VERB_RE = \/(.+?)\/;/);
  const refM = fn.match(/const REVISE_REF_RE = \/(.+?)\/;/);
  assert.ok(verbM && refM, '后端缺少 REVISE_VERB_RE / REVISE_REF_RE');
  const verb = new RegExp(verbM[1]);
  const ref = new RegExp(refM[1]);
  // 长度阈值从代码里读，避免测试硬编码
  const limitM = fn.match(/input\.length <= (\d+)/);
  const limit = limitM ? Number(limitM[1]) : 80;
  return (s) => {
    const t = String(s).trim();
    return ref.test(t) || (verb.test(t) && t.length <= limit);
  };
}

t('★★ 后端认识「继续优化」类改稿指令（实测漏判的直接原因）', () => {
  const detect = backendRevisionDetector();
  for (const phrase of ['继续优化', '继续改进', '继续完善', '还有优化空间', '进一步优化', '继续调整', '接着优化', '在此基础上', '优化完要输出交付物']) {
    assert.ok(detect(phrase), `后端不认识「${phrase}」`);
  }
});

t('★ 原有「重新生成」类仍被识别（不能顾此失彼）', () => {
  const detect = backendRevisionDetector();
  for (const phrase of ['重新生成', '再生成', '重做', '重跑', '刚才那份']) {
    assert.ok(detect(phrase), `后端丢失了对「${phrase}」的识别`);
  }
});

t('★★ 前后端对「改稿指令」的判断必须一致', () => {
  // 2026-11-23 前后端都改为「模式识别」（改稿动词 + 指代词 + 长度粗筛），
  // 不再是一张逐字对齐的长词表 —— 所以比对的不是正则字面量，而是**判定结果**：
  // 同一句话两边必须得出相同结论。
  const vIdx = VIEW.indexOf('const REVISE_VERB');
  assert.ok(vIdx > 0, '找不到前端 REVISE_VERB');
  const vBlock = VIEW.slice(vIdx, VIEW.indexOf('\n  if (isRevisionInstruction'));
  const verbM = vBlock.match(/const REVISE_VERB = \/(.+?)\//);
  const refM = vBlock.match(/const REVISE_REF = \/(.+?)\//);
  assert.ok(verbM && refM, '前端缺少 REVISE_VERB / REVISE_REF');
  const verb = new RegExp(verbM[1]);
  const ref = new RegExp(refM[1]);
  const frontendSaysRevision = (s) => ref.test(s.trim()) || (verb.test(s.trim()) && s.trim().length <= 80);

  const backendSaysRevision = backendRevisionDetector();

  // 这批短语是真实用户说过的改稿指令，两边都必须认
  for (const phrase of ['继续优化', '继续改进', '还有优化空间', '优化完要输出交付物', '完善一下这个需求的测试覆盖']) {
    assert.ok(backendSaysRevision(phrase), `后端不认识「${phrase}」`);
    assert.ok(frontendSaysRevision(phrase), `前端不认识「${phrase}」`);
  }
  // 明确的新需求，两边都不该认
  for (const phrase of ['帮我给登录功能设计测试用例', '对支付模块做安全测试，检查SQL注入漏洞']) {
    assert.ok(!backendSaysRevision(phrase), `后端误判「${phrase}」为改稿`);
    assert.ok(!frontendSaysRevision(phrase), `前端误判「${phrase}」为改稿`);
  }
});

t('★ 「继续优化」这类长指令不再被长度挡住（改用语义判定）', () => {
  const fn = enrichFn();
  // 原判据是 `input.length > 400 return null`，实测一条 192 字的改稿指令
  // 曾被 60 字上限挡掉，放宽到 400 才通过。
  //
  // 2026-11-25 用户要求「不能根据长度判断，要根据内容语义判断」，
  // 长度门槛整体去掉：一份需求文档自然含大量业务对象，靠语义判据
  // 就能和「改稿指令」区分开，不需要再猜长度。
  assert.ok(!/input\.length > \d+\) return null/.test(fn), '仍在用长度上限排除输入');
  assert.ok(/assessSelfContained\(input\)/.test(fn), '未使用内容语义判定');
  // 实测那条 192 字指令必须仍被识别为改稿
  assert.ok(/REVISE_VERB_RE/.test(fn) && /REVISE_REF_RE/.test(fn), '词表丢失');
});

// ---------------- B) 注入内容 ----------------
console.log('\n-- B. 注入内容：优化 vs 重新生成 --');

t('★★ 优化类指令注入的是「完整交付物」而不是「需求原文」', () => {
  const fn = enrichFn();
  assert.ok(/isRefine/.test(fn), '没有区分优化模式与重新生成模式');
  const idx = fn.indexOf('if (isRefine)');
  assert.ok(idx > 0, '找不到优化分支');
  const block = fn.slice(idx, fn.indexOf('// 重新生成模式'));
  assert.ok(/prevFull|prevDeliverable/.test(block), '优化分支没注入交付物全文');
  assert.ok(/这是要被修改的对象/.test(block), '没说明交付物是要被修改的对象');
});

t('★★ 优化模式明确要求「保留其余部分」（否则会改坏本来满意的内容）', () => {
  const fn = enrichFn();
  const idx = fn.indexOf('if (isRefine)');
  const block = fn.slice(idx, fn.indexOf('// 重新生成模式'));
  assert.ok(/不是重新生成|优化改稿/.test(block), '没声明「这是改稿不是重新生成」');
  assert.ok(/其余内容必须原样保留/.test(block), '没要求保留其余内容');
  assert.ok(/不要.*从需求重新生成/.test(block), '没禁止从需求重写');
});

t('★ 优化模式带上审核意见（用户就是看了审核结论才说要优化的）', () => {
  const fn = enrichFn();
  const idx = fn.indexOf('if (isRefine)');
  const block = fn.slice(idx, fn.indexOf('// 重新生成模式'));
  assert.ok(/reviewBrief/.test(block), '没注入审核意见');
  assert.ok(/reviewNotes/.test(block), '没读 reviewNotes（formatTask 把 review_notes 映射成驼峰）');
});

t('★★ 审核意见字段名用驼峰 reviewNotes（用 review_notes 会永远读不到）', () => {
  const fn = enrichFn();
  // formatTask 把 review_notes 映射成 reviewNotes；直接读 snake_case 会是 undefined
  assert.ok(/prev\.reviewNotes/.test(fn), '没用格式化的 reviewNotes 字段');
});

t('★ 重新生成模式仍然注入需求原文（两种模式不能混）', () => {
  const fn = enrichFn();
  const idx = fn.indexOf('// 重新生成模式');
  assert.ok(idx > 0, '找不到重新生成分支');
  const block = fn.slice(idx);
  assert.ok(/prevRequirement/.test(block), '重新生成分支没注入需求原文');
  assert.ok(/需求原文（这是要处理的/.test(block), '没说明这是要处理的需求');
});

// ---------------- C) 前端引导 ----------------
console.log('\n-- C. 前端直接送进对话 --');

t('★★ 识别到改稿指令时直接进入上一份任务的对话（不再只弹提示）', () => {
  assert.ok(/findContinuableTask/.test(VIEW), '没有查找可续做任务的逻辑');
  assert.ok(/enterChatModeAndSend/.test(VIEW), '没有「进入对话并发送」的辅助函数');
  const idx = VIEW.indexOf('if (isRevisionInstruction');
  const block = VIEW.slice(idx, idx + 1800);
  assert.ok(/await enterChatModeAndSend\(prevTask, taskInputValue\)/.test(block),
    '确认后没有直接发送，用户还得自己再点一次');
  assert.ok(/return/.test(block), '发送后没有 return，会继续新建任务');
});

t('★ 找不到可续做任务时说明白并退回普通提交', () => {
  const idx = VIEW.indexOf('if (isRevisionInstruction');
  const block = VIEW.slice(idx, idx + 1800);
  assert.ok(/没找到可继续修改的历史任务/.test(block), '没告知用户为何没能进对话');
});

t('★ 可续做任务的筛选条件合理（排除运行中与空产出）', () => {
  const idx = VIEW.indexOf('function findContinuableTask');
  assert.ok(idx > 0, '找不到 findContinuableTask');
  const body = VIEW.slice(idx, idx + 900);
  assert.ok(/status === 'running'/.test(body), '没排除运行中的任务（它还没产出可改的对象）');
  assert.ok(/result\.length > 200/.test(body), '没要求有实质交付物');
});

t('★ 优先同智能体，其次任意最近（用户心里的对象是上次看到的交付物）', () => {
  const idx = VIEW.indexOf('function findContinuableTask');
  const body = VIEW.slice(idx, idx + 900);
  assert.ok(/sameAgent/.test(body), '没优先匹配当前智能体');
  assert.ok(/sameAgent \|\| usable\[0\]/.test(body), '没有兜底到最近任意任务');
});

t('进入对话后复用 sendChat（与手动进对话走同一链路）', () => {
  const idx = VIEW.indexOf('async function enterChatModeAndSend');
  const body = VIEW.slice(idx, idx + 900);
  assert.ok(/enterChatMode\(task/.test(body), '没有复用 enterChatMode');
  assert.ok(/taskApi\.sendChat/.test(body), '没有走统一的对话接口');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
