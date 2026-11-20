#!/usr/bin/env node
/**
 * 实时输出自然语言化 单元测试（2026-11-19）
 *
 * 用户反馈：「前端页面上的实时输出信息要转换成自然语言再输出，别直接输出 json
 * 文件内容，可读性比较差。」
 *
 * 三处过去会直接甩 JSON：
 *   1. 审核完成 —— 把 score/dimensions/issues 结构用 ``` 代码块原样贴在聊天面板
 *      （实测单条 3766 字符，用户要自己找分数、数问题）
 *   2. 工具调用参数 —— 把 arguments JSON 摊在 <pre> 里（9dem_executor 单次参数可达数 KB）
 *   3. 工具执行结果 —— 只塞进 realtimeSkillResult（仅测试运行器消费），聊天面板里
 *      完全看不到执行结论；时间线重放只说「调用真实工具 xxx 完成」
 *
 * 现在统一走 frontend/src/utils/tool-summary.ts 转中文摘要。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UTIL = path.join(ROOT, 'frontend', 'src', 'utils', 'tool-summary.ts');
const STORE = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'stores', 'main.ts'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

/** 在 node 里跑 TS 版的摘要函数 */
function runProbe(code) {
  const file = path.join(ROOT, 'backend', 'test', '.summary-probe.mjs');
  fs.writeFileSync(file, `import * as M from ${JSON.stringify(UTIL)};\n${code}`, 'utf8');
  try {
    return execFileSync(process.execPath, ['--experimental-strip-types', file], { encoding: 'utf8' }).trim();
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
}

console.log('=== 实时输出自然语言化 单元测试 ===');

// ---------------- util 存在且导出齐全 ----------------
t('utils/tool-summary.ts 导出五个函数', () => {
  assert.ok(fs.existsSync(UTIL), '缺少 tool-summary.ts');
  const src = fs.readFileSync(UTIL, 'utf8');
  for (const fn of ['summarizeToolResult', 'summarizeReviewOutput', 'describeToolCall', 'skillLabel', 'summarizeTaskOutput']) {
    assert.ok(new RegExp(`export function ${fn}`).test(src), `缺少 ${fn}`);
  }
});

// ---------------- 审核输出：JSON → 中文 ----------------
const REVIEW_JSON = JSON.stringify({
  score: 82,
  veto: false,
  reason: '整体覆盖完整，但存在输入与步骤矛盾',
  dimensions: { requirement: 80, factLogic: 78, security: 92, format: 82, traceability: 82 },
  issues: [
    { severity: 'major', category: 'fact', caseId: 'TC-019', description: '输入数据与执行步骤矛盾', suggestion: '统一输入数据' },
    { severity: 'minor', category: 'format', caseId: 'TC-020', description: '措辞不统一', suggestion: '统一术语' },
  ],
});

t('审核输出摘要含分数与中文等级', () => {
  const out = runProbe(`console.log(M.summarizeReviewOutput(${JSON.stringify(REVIEW_JSON)}));`);
  assert.ok(out.includes('综合评分 82 分'), out);
  assert.ok(out.includes('评分达标'), out);
});

t('审核输出摘要含五维中文名（不再是 requirement/factLogic 这种键名）', () => {
  const out = runProbe(`console.log(M.summarizeReviewOutput(${JSON.stringify(REVIEW_JSON)}));`);
  assert.ok(out.includes('需求一致性 80'), out);
  assert.ok(out.includes('事实与逻辑 78'), out);
  assert.ok(!/factLogic\s*[:=]/.test(out), '仍输出原始键名');
});

t('审核输出摘要列出问题（含用例编号与建议）', () => {
  const out = runProbe(`console.log(M.summarizeReviewOutput(${JSON.stringify(REVIEW_JSON)}));`);
  assert.ok(out.includes('列出问题 2 条'), out);
  assert.ok(out.includes('TC-019'), out);
  assert.ok(out.includes('建议：'), out);
});

t('审核输出是 ```json 代码块时也能解析', () => {
  const fenced = '```json\n' + REVIEW_JSON + '\n```';
  const out = runProbe(`console.log(M.summarizeReviewOutput(${JSON.stringify(fenced)}));`);
  assert.ok(out.includes('综合评分 82 分'), out);
});

t('审核输出解析失败时退回纯文本（不抛异常、不输出 JSON 花括号堆）', () => {
  const out = runProbe(`console.log(M.summarizeReviewOutput('这不是 JSON，只是一段审核意见说明'));`);
  assert.ok(out.includes('这不是 JSON'), out);
  assert.ok(!out.includes('{"'), '不应输出 JSON');
});

t('审核摘要不包含 ``` 代码围栏（不再以代码块呈现）', () => {
  const out = runProbe(`console.log(M.summarizeReviewOutput(${JSON.stringify(REVIEW_JSON)}));`);
  assert.ok(!out.includes('```'), out.slice(0, 200));
});

// ---------------- 工具调用参数：JSON → 中文 ----------------
t('9dem-executor 调用参数转成中文描述', () => {
  const args = JSON.stringify({
    inputSpec: { phone: { type: 'string' } },
    dimensions: ['user', 'data', 'process'],
    methods: ['equivalence', 'boundary'],
    designInput: { rules: [{ id: 'R1' }], factors: { a: ['1', '2'] } },
  });
  const out = runProbe(`console.log(M.describeToolCall('9dem-executor', ${JSON.stringify(args)}));`);
  assert.ok(out.includes('九维穷举'), out);
  assert.ok(out.includes('3 个维度'), out);
  assert.ok(out.includes('2 种设计方法'), out);
  assert.ok(!out.includes('{'), `不应输出 JSON：${out}`);
});

t('接口执行参数转成中文描述', () => {
  const args = JSON.stringify({ baseUrl: 'https://example.com', cases: [{ name: 'a' }, { name: 'b' }] });
  const out = runProbe(`console.log(M.describeToolCall('api-direct-invoker', ${JSON.stringify(args)}));`);
  assert.ok(out.includes('接口直连执行'), out);
  assert.ok(out.includes('https://example.com'), out);
  assert.ok(out.includes('2 个测试场景'), out);
});

t('参数被截断成非法 JSON 时只报长度不贴原文', () => {
  const out = runProbe(`console.log(M.describeToolCall('9dem-executor', '{"inputSpec": {"a":'));`);
  assert.ok(out.includes('字符参数'), out);
  assert.ok(!out.includes('inputSpec'), `不应贴原始参数：${out}`);
});

// ---------------- 工具执行结果：JSON → 中文 ----------------
t('执行类结果转成通过率摘要', () => {
  const res = JSON.stringify({
    summary: { total: 12, passed: 10, failed: 2, skipped: 0, duration: 3450 },
    testcases: [{ id: 'c1', name: '登录成功', status: 'passed' }, { id: 'c2', name: '手机号过短', status: 'failed' }],
  });
  const out = runProbe(`console.log(M.summarizeToolResult('api-direct-invoker', ${JSON.stringify(res)}));`);
  assert.ok(out.includes('12 个用例'), out);
  assert.ok(out.includes('通过率 83.3%'), out);
  assert.ok(out.includes('手机号过短'), out);
});

t('9dem 结果转成方法/维度/条数摘要', () => {
  const res = JSON.stringify({
    methods: [
      { method: 'equivalence', methodLabel: '等价类划分法', caseCount: 3, skipped: false },
      { method: 'causeEffect', methodLabel: '因果图法', caseCount: 0, skipped: true, reason: '缺少 causes' },
    ],
    design: { cases: new Array(17).fill({}), stats: { dimensionsCovered: ['② 数据'] } },
    dimensionCases: new Array(42).fill({}),
    summary: { designDuplicatesRemoved: 1, dimensionCoveredCount: 9 },
  });
  const out = runProbe(`console.log(M.summarizeToolResult('9dem-executor', ${JSON.stringify(res)}));`);
  assert.ok(out.includes('等价类划分法（3 条）'), out);
  assert.ok(out.includes('未启用'), out);
  assert.ok(out.includes('17 条不重复用例'), out);
  assert.ok(out.includes('42 条用例'), out);
});

t('未知结构的工具结果退化为字段摘要，不贴 JSON', () => {
  const out = runProbe(`console.log(M.summarizeToolResult('some-unknown-skill', ${JSON.stringify({ foo: 1, bar: 'ok', list: [1, 2, 3] })}));`);
  assert.ok(out.includes('关键结果') || out.includes('返回数据'), out);
  assert.ok(!out.includes('{') && !out.includes('['), `不应输出 JSON 结构：${out}`);
});

t('skillLabel 给出中文名，未知 id 原样返回', () => {
  const out = runProbe(`console.log(M.skillLabel('9dem-executor') + '|' + M.skillLabel('mystery-skill') + '|' + M.skillLabel(''));`);
  assert.strictEqual(out, '九维穷举 + 黑盒9法|mystery-skill|工具', out);
});

// ---------------- store 接入 ----------------
t('聊天面板审核完成不再贴 JSON 代码块', () => {
  const block = STORE.slice(STORE.indexOf("case 'reviewer_completed'"), STORE.indexOf("case 'task_completed'"));
  assert.ok(/summarizeReviewOutput\(rawOutput/.test(block), '未调用 summarizeReviewOutput');
  assert.ok(!/```\\n\$\{typeof rawOutput/.test(block), '仍在用代码块包裹原始输出');
});

t('时间线重放审核完成也走自然语言', () => {
  const idx = STORE.indexOf("case 'reviewer_completed': {");
  const block = STORE.slice(idx, idx + 1200);
  assert.ok(/summarizeReviewOutput\(raw/.test(block), '重放链路未转换');
});

t('工具调用参数不再摊 JSON', () => {
  assert.ok(/describeToolCall\(toolName, rawArgs\)/.test(STORE), '未使用 describeToolCall');
  assert.ok(!/JSON\.stringify\(toolInfo\.arguments \?\? toolInfo, null, 2\)/.test(STORE), '仍在 stringify 参数');
});

t('工具执行结果会写入聊天面板（不再只存 realtimeSkillResult）', () => {
  // 该 case 在时间线重放与实时链路各出现一次，取最后一个（实时链路）
  const idx = STORE.lastIndexOf("case 'agent_skill_result':");
  const block = STORE.slice(idx, idx + 1000);
  assert.ok(/realtimeSkillResult\.value = data/.test(block), '应保留 realtimeSkillResult');
  assert.ok(/summarizeToolResult\(/.test(block), '未生成自然语言摘要');
  assert.ok(/writeMsg\(/.test(block), '未写入聊天面板');
});

t('时间线重放的工具结果也给出执行结论', () => {
  const idx = STORE.indexOf("id: `tl-skill-");
  const block = STORE.slice(idx, idx + 500);
  assert.ok(/summarizeToolResult/.test(block) || /summaryText/.test(block), '重放未给执行结论');
});

t('9dem-planner 单独走规划摘要（不落进字段计数兜底）', () => {
  const planner = JSON.stringify({
    skill: '9dem-planner',
    success: true,
    plan: { dimensions: [{ name: 'user' }, { name: 'data' }] },
    summary: {
      totalDimensions: 9, probeTotal: 42, estimatedCases: 42, recommendedDays: 6,
      coveredCount: 0, pendingCount: 9, topPriority: '③ 流程（medium）',
      gapMessage: '缺少以下维度覆盖: ① 用户、② 数据',
    },
    priorities: [{ rank: 1, label: '③ 流程', reason: '风险等级5，被5个维度依赖。' }],
    checklist: new Array(9).fill({}),
  })
  const out = runProbe(`
console.log(M.summarizeToolResult('9dem-planner', ${JSON.stringify(planner)}))`)
  assert.ok(/规划 9 个维度、共 42 个必测点/.test(out), '缺少规划规模: ' + out)
  assert.ok(/尚未覆盖任何维度/.test(out), '缺少覆盖缺口: ' + out)
  assert.ok(/最高优先级：③ 流程/.test(out), '缺少优先级: ' + out)
  assert.ok(!/skill=9dem-planner/.test(out), '仍落进字段计数兜底: ' + out)
})

t('下划线形式的 skill id 也能识别（后端 skillToolName 输出）', () => {
  const out = runProbe(`
console.log(M.summarizeToolResult('9dem_executor', JSON.stringify({ methods: [{ methodKey: 'M1', methodLabel: '等价类划分法', caseCount: 3, skipped: false }] })))`)
  assert.ok(/启用了 1 种设计方法：等价类划分法（3 条）/.test(out), '未识别下划线 id: ' + out)
  const lbl = runProbe(`console.log(M.skillLabel('9dem_executor'))`)
  assert.strictEqual(lbl, '九维穷举 + 黑盒9法')
})

t('被截断的审核 JSON 走尽力提取，不原样贴 JSON', () => {
  // 实测 2026-11-20：模型列出 45 条 issues 撞上 max_tokens，JSON 在数组中途断掉，
  // JSON.parse 失败 → 旧代码把整段 ```json 原样返回，用户看到的就是「又输出 JSON 了」
  const truncated = [
    '```json',
    '{',
    '  "score": 65,',
    '  "veto": false,',
    '  "reason": "预期结果不可判定2条，必测点覆盖83%未达标",',
    '  "dimensions": { "requirement": 70, "factLogic": 75, "security": 80, "format": 65, "traceability": 60 },',
    '  "issues": [',
    '    { "severity": "major", "description": "预期结果不可判定，只写返回200" },',
    '    { "severity": "major", "description": "缺少手机号掩码显示测试用例" },',
    '    { "severity": "minor", "description": "输入数据为占位符，不符合业务规则" },',
    '    { "severity": "minor", "description": "L4: 缺',
  ].join('\n')
  const out = runProbe(`
console.log(M.summarizeReviewOutput(${JSON.stringify(truncated)}, { maxIssues: 3 }))`)
  assert.ok(/综合评分 65 分/.test(out), '没救出综合评分: ' + out)
  assert.ok(/五维评分：需求一致性 70/.test(out), '没救出五维: ' + out)
  assert.ok(/审核结论：预期结果不可判定/.test(out), '没救出 reason: ' + out)
  assert.ok(/已列出问题 3 条/.test(out), '没列出已解析的问题条数: ' + out)
  assert.ok(/被模型截断/.test(out), '没提示输出被截断')
  // 关键：绝不能把原始 JSON 贴出来
  assert.ok(!out.includes('```'), '仍输出了代码围栏')
  assert.ok(!/"score"\s*:/.test(out), '仍输出了 JSON 字段名')
  assert.ok(!out.trim().startsWith('{'), '仍以花括号开头')
})

t('审核提示要求 issues 不超过 15 条（避免撞 token 上限被截断）', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'backend', 'lib', 'reviewer-prompt.js'), 'utf8')
  assert.ok(/issues 上限 15 条/.test(prompt), '缺少 issues 条数上限要求')
  assert.ok(/截断/.test(prompt), '未说明为什么要限制条数')
})

// ---------------- 任务结果：JSON → 自然语言 ----------------
const SECURITY_JSON = JSON.stringify({
  securityScore: 35,
  riskLevel: 'high',
  severityDist: { critical: 1, high: 2, medium: 0, low: 0, info: 0 },
  findings: [
    { title: '登录接口 SQL 注入', severity: 'critical', vulnType: 'SQL注入' },
    { title: 'Cookie 缺少 HttpOnly', severity: 'high', vulnType: '会话安全' },
    { title: '未开启 HSTS', severity: 'high', vulnType: '传输安全' },
  ],
  summary: '存在可直接利用的注入点，建议立即修复。',
})

t('安全扫描 JSON 结果转成评分/漏洞条数摘要', () => {
  const out = runProbe(`
console.log(M.summarizeTaskOutput(${JSON.stringify(SECURITY_JSON)}))`)
  assert.ok(/安全评分 35 分/.test(out), '缺少评分: ' + out)
  assert.ok(/风险等级 high/.test(out), '缺少风险等级: ' + out)
  assert.ok(/共发现 3 个问题/.test(out), '缺少漏洞条数: ' + out)
  assert.ok(/登录接口 SQL 注入/.test(out), '缺少主要问题: ' + out)
  assert.ok(!/[{}"]/.test(out), '仍在输出 JSON 花括号/引号: ' + out)
})

t('Markdown 报告原样返回，不被改写', () => {
  const md = '# 测试用例集\n\n| 用例编号 | 预期结果 |\n| --- | --- |\n| TC-001 | 登录成功 |'
  const out = runProbe(`
console.log(M.summarizeTaskOutput(${JSON.stringify(md)}))`)
  assert.strictEqual(out, md, 'Markdown 报告被改写了')
})

t('数字开头但不是 JSON 的文本原样返回（不误伤）', () => {
  const text = '2026-11-19 任务已完成，共 184 条用例'
  const out = runProbe(`
console.log(M.summarizeTaskOutput(${JSON.stringify(text)}))`)
  assert.strictEqual(out, text, '普通文本被改写')
})

t('store 里所有任务输出展示点都走 summarizeTaskOutput', () => {
  // 4 处：ensureTaskDeliverable / loadRecentTaskResults（两条）/ task_completed
  const hits = (STORE.match(/summarizeTaskOutput\(taskOutput\)/g) || []).length
  assert.ok(hits >= 5, `只接了 ${hits} 处，应为 5 处以上`)
  assert.ok(!/\$\{taskOutput\}/.test(STORE), '仍有地方直接拼 taskOutput')
})

t('未处理事件的兜底文案不再拼 JSON', () => {
  const idx = STORE.lastIndexOf('      default:')
  const block = STORE.slice(idx, idx + 400)
  assert.ok(!/JSON\.stringify\(data\)/.test(block), '兜底仍 stringify 整个事件')
  assert.ok(/收到事件/.test(block), '兜底文案缺失')
})

t('完整 JSON 仍作为可下载交付物保留（不丢审计依据）', () => {
  const block = STORE.slice(STORE.indexOf("case 'reviewer_completed'"), STORE.indexOf("case 'task_completed'"));
  assert.ok(/name: '审核结果\.json'/.test(block), '审核 JSON 交付物被删了');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
