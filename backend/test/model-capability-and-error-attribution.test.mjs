/**
 * 模型能力自适应 + 错误归因（2026-11-25 · 第 2、3 项）
 *
 * 第 2 项背景：`api-executor` 在 FORCE_TOOL_CALL_AGENTS 里，会被强制带
 * tool_choice='required'。是否「推理模型」靠模型名关键词判断
 * （reasoner / v4-pro / thinking），但生产配的 `deepseek-flash` 三个都不匹配，
 * 于是被当普通模型带上 tool_choice，服务端在思考模式下直接 400：
 *   "Thinking mode does not support this tool_choice"
 * 实测 2026-11-25 08:52 连续 3 个任务整条失败。
 *
 * 第 3 项背景：同一个根因（平台 Key 失效）在生产被包装成四种不同文案：
 * 「Gateway 401」「Agent 调用失败：…401」「circuit breaker open」
 * 「All agent call strategies failed」。运维看到「熔断器打开」会去查熔断配置，
 * 全是白费。近 30 天 34 次失败里 20 次是 Key 失效，其中 5 次还被熔断器
 * 二次转述成「circuit breaker open」。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');

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

console.log('=== 模型能力自适应 & 错误归因 单元测试 ===');

// ---------------- 第 2 项：tool_choice 自适应 ----------------

/** 取 callOpenClawAPI 里构造请求体的那一段 */
function requestBodyBlock() {
  const start = SERVER.indexOf('const modelBlocksToolChoice');
  assert.ok(start > 0, '找不到 tool_choice 自适应代码');
  return SERVER.slice(start, start + 2200);
}

t('不再用模型名关键词猜「是否推理模型」', () => {
  // 关键词判断是这次故障的根因，必须彻底移除
  const block = requestBodyBlock();
  assert.ok(!/includes\(['"]v4-pro['"]\)/.test(block), '仍在用模型名关键词判断');
  assert.ok(!/isReasoningModelByName/.test(SERVER), '仍保留关键词判断变量');
});

t('拒绝 tool_choice 的 400 会触发就地重发', () => {
  const block = requestBodyBlock();
  assert.ok(/rejectsToolChoice/.test(block), '缺少 400 特征识别');
  assert.ok(/Thinking mode does not support/.test(block), '未匹配真实报错文案');
  assert.ok(/response\s*=\s*await sendRequest\(\)/.test(block), '识别后没有重发请求');
});

t('命中过的模型记入缓存，后续不再带 tool_choice', () => {
  assert.ok(/MODELS_WITHOUT_TOOL_CHOICE\s*=\s*new Set\(\)/.test(SERVER), '缺少模型能力缓存');
  assert.ok(/MODELS_WITHOUT_TOOL_CHOICE\.add\(deepseekModel\)/.test(SERVER), '命中后未写入缓存');
  assert.ok(/MODELS_WITHOUT_TOOL_CHOICE\.has\(deepseekModel\)/.test(SERVER), '未读取缓存');
});

t('自适应重发不消耗重试次数', () => {
  // 这不是服务抖动，是本机对模型能力判断错了；消耗重试会让 4 次重试全烧在同一个错上
  const block = requestBodyBlock();
  const idx = block.indexOf('rejectsToolChoice');
  const after = block.slice(idx, idx + 900);
  assert.ok(!/continue;/.test(after), '自适应路径里出现了 continue（会误触发重试计数）');
});

t('工具定义仍然保留（只去掉 tool_choice，不是去掉 tools）', () => {
  const block = requestBodyBlock();
  assert.ok(/if \(!withToolChoice\) return \{ tools \}/.test(block),
    '去 tool_choice 时把 tools 也去掉了，模型就看不到工具了');
});

// ---------------- 第 3 项：错误归因 ----------------

/** 取出 classifyAgentError 的函数体 */
function classifierBody() {
  const start = SERVER.indexOf('function classifyAgentError');
  assert.ok(start > 0, '找不到 classifyAgentError');
  const end = SERVER.indexOf('function formatAgentError', start);
  assert.ok(end > start, '找不到函数边界');
  return SERVER.slice(start, end);
}

t('存在统一的错误归因函数', () => {
  assert.ok(/function classifyAgentError/.test(SERVER), '缺少 classifyAgentError');
  assert.ok(/function formatAgentError/.test(SERVER), '缺少 formatAgentError');
});

t('Key 失效的各种文案都能识别为同一根因', () => {
  const body = classifierBody();
  assert.ok(/Authentication Fails/.test(body), '未匹配 DeepSeek 文案');
  assert.ok(/is invalid/.test(body), '未匹配 "api key xxx is invalid"');
  assert.ok(/invalid_api_key|Incorrect API key/.test(body), '未匹配 OpenAI 系文案');
  assert.ok(/401/.test(body), '未兜底匹配 401 状态码');
  assert.ok(/invalid_key/.test(body), '缺少 invalid_key 归因类型');
});

t('Key 失效的处置建议指向「换 Key」，不是让用户去查熔断', () => {
  const body = classifierBody();
  const idx = body.indexOf('invalid_key');
  assert.ok(idx > 0, '缺少 invalid_key');
  const advice = body.slice(idx, idx + 400);
  assert.ok(/API ?KEY|Key/.test(advice), '建议里没提 Key');
  assert.ok(/管理员|更新/.test(advice), '没说清该找谁、怎么修');
});

t('熔断被明确标注为「后果而非原因」', () => {
  const body = classifierBody();
  const idx = body.indexOf("kind: 'circuit_breaker'");
  assert.ok(idx > 0, '缺少 circuit_breaker 归因');
  const seg = body.slice(idx, idx + 500);
  assert.ok(/结果|后果|不是原因/.test(seg), '未说明熔断是连续失败的后果');
});

t('熔断器返回错误时带出根因和冷却时间', () => {
  const start = SERVER.indexOf('if (isAgentCircuitOpen(agentId))');
  assert.ok(start > 0, '找不到熔断器检查');
  const block = SERVER.slice(start, start + 900);
  assert.ok(/formatAgentError\(state\.lastError/.test(block), '熔断返回未走统一归因');
  assert.ok(/rootCause/.test(block), '未透出根因，只给了「熔断」两个字');
  assert.ok(/秒后自动恢复/.test(block), '未告知冷却剩余时间');
});

t('agent 调用失败的出口也走统一归因', () => {
  assert.ok(/error: formatAgentError\(err\.message, \{ agentId \}\)/.test(SERVER),
    'catch 出口仍在各自拼文案');
});

t('格式化是幂等的（不会重复包【】）', () => {
  const start = SERVER.indexOf('function formatAgentError');
  const block = SERVER.slice(start, start + 900);
  assert.ok(/raw\.startsWith\('【'\)\) return raw/.test(block), '缺少幂等判断，会重复叠加包装');
});

t('上下文超限走独立归因，不被当成普通失败', () => {
  assert.ok(/errorKind: 'context_overflow'/.test(SERVER), '上下文超限未单独标注');
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
