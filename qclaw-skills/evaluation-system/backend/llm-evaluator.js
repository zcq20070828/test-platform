/**
 * llm-evaluator.js — 基于 DeepSeek LLM 的深度评估模块
 *
 * 三种评估场景：
 *  - task:    对单个任务进行深度评估
 *  - agent:   对智能体批量评估（取最近N个任务）
 *  - all:     对智能体 + 指定任务组合评估
 *
 * 输出结构（统一）：
 *  { overall: {score, grade}, capability: {score, metrics:[{key,name,score,reason}]},
 *    quality: {score, metrics:[...]}, business: {score, metrics:[...]}, suggestions:[], reasoning }
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || '/Users/zhaochengqing';
const EVALUATOR_VERSION = '1.1.0';

// DeepSeek API 配置（从 server.js 注入或直接读取
let _deepseekApiKey = '';

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

export function setApiKey(key) {
  _deepseekApiKey = key;
  console.log(`[LLMEvaluator] v${EVALUATOR_VERSION} initialized, API key set (${key ? key.slice(0,8)+'...' : 'empty'})`);
}

function getApiKey() {
  if (_deepseekApiKey) return _deepseekApiKey;
  // 尝试从环境变量读取（server.js 会设置）
  return process.env.DEEPSEEK_API_KEY || '';
}

/**
 * 调用 DeepSeek Chat API
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} opts  { temperature, max_tokens }
 */
async function callDeepSeek(systemPrompt, userPrompt, opts = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('DeepSeek API key 未配置');

  const { temperature = 0.3, max_tokens = 2000 } = opts;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`DeepSeek API ${resp.status}: ${errText}`);
    }

    const json = await resp.json();
    return json.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('DeepSeek 请求超时（120s）');
    throw err;
  }
}

/**
 * 截断文本（防止超出 token 限制）
 */
function truncate(text = '', maxLen = 6000) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n...（已截断）';
}

// ─────────────────────────────────────────────
// 交付物质量评估
// ─────────────────────────────────────────────

const DELIVERABLE_SYSTEM_PROMPT = `你是一个专业的交付物质量评估专家。你的任务是对AI智能体生成的交付物（文档、报告、代码、测试用例等）进行多维度质量评估。

评分标准（0-10分）：
- 完整性（3分）：交付物结构是否完整，是否包含所有必要章节/模块/组成部分
- 正确性（3分）：内容是否准确无误，逻辑是否严密，数据是否可靠
- 可执行性（2分）：代码/用例是否可直接执行或使用，格式是否规范
- 专业性（2分）：语言是否专业流畅，格式是否规范统一，有无明显低级错误

评分规则：
- 9-10分：优秀，超越预期
- 7-8分：良好，符合要求
- 5-6分：及格，存在不足
- 3-4分：较差，需较大改进
- 0-2分：不合格

请严格按照以下JSON格式输出，不要输出任何其他内容：
{
  "deliverable_score": <0-10整数或一位小数>,
  "dimensions": {
    "completeness": {"score": <0-3整数>, "reason": "<评分理由20-50字>"},
    "correctness":   {"score": <0-3整数>, "reason": "<评分理由20-50字>"},
    "executability": {"score": <0-2整数>, "reason": "<评分理由20-50字>"},
    "professionalism":{"score": <0-2整数>, "reason": "<评分理由20-50字>"}
  },
  "summary": "<总体评价50字以内>"
}`;

/**
 * 交付物质量评估（有artifacts时调用）
 * @param {object} taskData - 任务基本信息 {taskId, agentId, taskType, input, output}
 * @param {Array}  artifacts - 交付物数组 [{name, content, text, size}]
 * @returns {Promise<object>} { score: 0-10, dimensions: {...}, summary }
 */
export async function evaluateDeliverableQuality(taskData, artifacts = []) {
  if (!artifacts || artifacts.length === 0) {
    return { score: 0, dimensions: null, summary: '无交付物' };
  }

  // 构建用户提示词
  const { input, output, taskType, taskId, agentId } = taskData;
  const validArtifacts = artifacts.filter(a => (a.content || a.text || '').trim().length > 50);
  if (validArtifacts.length === 0) {
    return { score: 0, dimensions: null, summary: '交付物内容为空或过短' };
  }

  let userPrompt = `## 任务信息
- 任务ID：${taskId || '未知'}
- 智能体：${agentId || '未知'}
- 任务类型：${taskType || 'general'}

## 用户需求
${truncate(input, 2000)}

## 智能体执行结果摘要
${truncate(output, 3000)}

## 交付物（共 ${validArtifacts.length} 个，请逐一评估）
`;

  for (const art of validArtifacts.slice(0, 5)) {
    const content = art.content || art.text || '';
    const sizeKB = art.size ? Math.round(art.size / 1024) : Math.round(content.length / 1024);
    userPrompt += `\n### ${art.name || '未命名文件'} (约${sizeKB}KB)\n`;
    userPrompt += `${truncate(content, 4000)}\n`;
    userPrompt += '───\n';
  }

  if (validArtifacts.length > 5) {
    userPrompt += `\n（还有 ${validArtifacts.length - 5} 个交付物，内容略）\n`;
  }

  userPrompt += `\n请对上述交付物进行质量评分（0-10分制）。`;

  try {
    const raw = await callDeepSeekForDeliverable(DELIVERABLE_SYSTEM_PROMPT, userPrompt);
    const parsed = parseLLMResponse(raw);

    const score = typeof parsed.deliverable_score === 'number'
      ? Math.max(0, Math.min(10, parsed.deliverable_score))
      : 0;

    return {
      score: Math.round(score * 10) / 10,
      dimensions: parsed.dimensions || null,
      summary: parsed.summary || '',
    };
  } catch (err) {
    console.error(`[DeliverableEval] 评估失败: ${err.message}`);
    return { score: 0, dimensions: null, summary: `评估失败: ${err.message}` };
  }
}

/**
 * 专用于交付物评估的 DeepSeek 调用（更长超时 + 更大输出）
 */
async function callDeepSeekForDeliverable(systemPrompt, userPrompt) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('DeepSeek API key 未配置');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 3分钟超时

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 3000, // 交付物评估需要更长的输出
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`DeepSeek API ${resp.status}: ${errText}`);
    }

    const json = await resp.json();
    return json.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('交付物评估请求超时（180s）');
    throw err;
  }
}

// ─────────────────────────────────────────────
// 评估 Prompt 模板
// ─────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个专业的 AI 智能体质量评估专家。你的任务是对智能体的输出进行多维度深度评估。

评分标准：
- 能力层（权重 40%）：意图理解、工具调用、上下文利用、错误恢复
- 质量层（权重 35%）：语法正确性、逻辑完整性、规范符合度
- 业务层（权重 25%）：可执行性、缺陷发现、效率提升

评分规则：
- 0-59 分：不合格（D）
- 60-74 分：及格（C）
- 75-89 分：良好（B）
- 90-100 分：优秀（A）

请严格按照以下 JSON 格式输出，不要输出任何其他内容：
{
  "overall": { "score": <0-100整数>, "grade": "<A/B/C/D>" },
  "capability": {
    "score": <0-100整数>,
    "metrics": [
      { "key": "intentAccuracy", "name": "意图理解准确性", "score": <0-100整数>, "reason": "<评分理由20-50字>" },
      { "key": "toolInvocationRate", "name": "工具调用完整率", "score": <0-100整数>, "reason": "..." },
      { "key": "contextEfficiency", "name": "上下文利用效率", "score": <0-100整数>, "reason": "..." },
      { "key": "errorRecoveryRate", "name": "错误恢复能力", "score": <0-100整数>, "reason": "..." }
    ]
  },
  "quality": {
    "score": <0-100整数>,
    "metrics": [
      { "key": "syntaxAccuracy", "name": "语法正确性", "score": <0-100整数>, "reason": "..." },
      { "key": "logicCompleteness", "name": "逻辑完整性", "score": <0-100整数>, "reason": "..." },
      { "key": "standardCompliance", "name": "规范符合度", "score": <0-100整数>, "reason": "..." }
    ]
  },
  "business": {
    "score": <0-100整数>,
    "metrics": [
      { "key": "executabilityRate", "name": "可执行率", "score": <0-100整数>, "reason": "..." },
      { "key": "defectDiscoveryRate", "name": "缺陷发现率", "score": <0-100整数>, "reason": "..." },
      { "key": "coverageImprovement", "name": "覆盖率提升", "score": <0-100整数>, "reason": "..." }
    ]
  },
  "suggestions": ["<具体改进建议1>", "<建议2>", "<建议3>"]
}`;

function buildUserPrompt(taskData, artifacts = []) {
  const { input, output, taskType, taskId, agentId } = taskData;

  let prompt = `## 评估任务信息
- 任务ID：${taskId || '未知'}
- 智能体：${agentId || '未知'}
- 任务类型：${taskType || 'general'}

## 任务输入（用户需求）
${truncate(input, 3000)}

## 智能体输出
${truncate(output, 8000)}`;

  // 附加 artifacts（如果有）
  if (artifacts && artifacts.length > 0) {
    prompt += `\n\n## 生成的交付物（共 ${artifacts.length} 个）`;
    for (const art of artifacts.slice(0, 5)) {
      const sizeKB = art.size ? Math.round(art.size / 1024) : 0;
      prompt += `\n### ${art.name} (${sizeKB}KB)
\`\`\`\n${truncate(art.content || art.text || '', 2000)}\n\`\`\``;
    }
    if (artifacts.length > 5) {
      prompt += `\n...（还有 ${artifacts.length - 5} 个交付物已省略）`;
    }
  }

  return prompt;
}

function buildAgentPrompt(agentId, tasks) {
  const summary = tasks.slice(0, 5).map((t, i) => {
    return `--- 任务 ${i + 1}（${t.taskId?.slice(0, 8) || '?'}）---
输入：${truncate(t.input, 800)}
输出：${truncate(t.output, 2000)}`;
  }).join('\n');

  return `## 评估目标
对智能体 **${agentId}** 进行综合评估，基于其最近 ${tasks.length} 个任务的表现。

${summary}

请根据上述多个任务的表现，给出综合评分。`;
}

// ─────────────────────────────────────────────
// 核心评估函数
// ─────────────────────────────────────────────

/**
 * 解析 LLM 返回的 JSON（容错处理）
 */
function parseLLMResponse(raw) {
  // 尝试提取 ```json ... ``` 块
  let jsonStr = raw;
  const jsonBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) jsonStr = jsonBlockMatch[1];

  // 尝试直接解析
  try {
    return JSON.parse(jsonStr);
  } catch {
    // 尝试找第一个 { 和最后一个 }
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(jsonStr.slice(start, end + 1));
      } catch { /* fall through */ }
    }
    throw new Error(`LLM 返回格式异常：${truncate(jsonStr, 200)}`);
  }
}

/**
 * 验证并补全评估结果结构
 */
function normalizeResult(result) {
  const defaultMetric = (key, name) => ({ key, name, score: 0, reason: '未评分' });
  const normalizeLayer = (layer, defaults) => ({
    score: typeof layer?.score === 'number' ? layer.score : 0,
    metrics: Array.isArray(layer?.metrics) ? layer.metrics : [],
  });

  const normalized = {
    overall: {
      score: typeof result?.overall?.score === 'number' ? Math.round(result.overall.score) : 0,
      grade: ['A','B','C','D'].includes(result?.overall?.grade) ? result.overall.grade : 'D',
    },
    capability: normalizeLayer(result?.capability, []),
    quality: normalizeLayer(result?.quality, []),
    business: normalizeLayer(result?.business, []),
    suggestions: Array.isArray(result?.suggestions) ? result.suggestions : [],
  };

  // 计算综合分（三层加权）
  if (!normalized.overall.score) {
    normalized.overall.score = Math.round(
      normalized.capability.score * 0.4 +
      normalized.quality.score * 0.35 +
      normalized.business.score * 0.25
    );
  }
  if (!['A','B','C','D'].includes(normalized.overall.grade)) {
    const s = normalized.overall.score;
    normalized.overall.grade = s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : 'D';
  }

  return normalized;
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────

/**
 * 深度评估单个任务（核心方法）
 * @param {object} taskData  { taskId, agentId, taskType, input, output }
 * @param {Array}  artifacts 可选，交付物内容 [{name, content, size}]
 * @returns {Promise<object>} 评估结果（含 deliverableScore 字段）
 */
export async function evaluateTask(taskData, artifacts = []) {
  const userPrompt = buildUserPrompt(taskData, artifacts);
  const raw = await callDeepSeek(SYSTEM_PROMPT, userPrompt, { temperature: 0.3, max_tokens: 2000 });
  const parsed = parseLLMResponse(raw);
  const result = normalizeResult(parsed);

  // 交付物质量评估：有 artifacts 时触发
  if (artifacts && artifacts.length > 0) {
    try {
      const dlResult = await evaluateDeliverableQuality(taskData, artifacts);
      result.deliverableScore = dlResult.score;
      result.deliverableDimensions = dlResult.dimensions;
      result.deliverableSummary = dlResult.summary;
    } catch (err) {
      console.error(`[EvaluateTask] 交付物评估失败: ${err.message}`);
      result.deliverableScore = 0;
      result.deliverableSummary = `评估失败: ${err.message}`;
    }
  }

  return result;
}

/**
 * 评估智能体（批量任务）
 * @param {string} agentId
 * @param {Array}  tasks   最近的任务列表 [{taskId, agentId, taskType, input, output}]
 * @param {Array}  artifactsPerTask 可选，每个任务的交付物
 */
export async function evaluateAgent(agentId, tasks, artifactsPerTask = []) {
  if (!tasks || tasks.length === 0) {
    return { error: '没有可评估的任务数据' };
  }

  // 取最新 3 个任务进行深度评估
  const recentTasks = tasks.slice(0, 3);
  const results = [];

  for (let i = 0; i < recentTasks.length; i++) {
    const task = recentTasks[i];
    const arts = artifactsPerTask[i] || [];
    try {
      const r = await evaluateTask(task, arts);
      r.taskId = task.taskId;
      results.push(r);
    } catch (err) {
      console.error(`[LLMEval] 任务 ${task.taskId} 评估失败:`, err.message);
      results.push({ taskId: task.taskId, error: err.message });
    }
  }

  // 汇总：平均各层得分
  const valid = results.filter(r => !r.error && typeof r.overall?.score === 'number');
  if (valid.length === 0) {
    return { error: '所有任务评估均失败', agentId, taskCount: tasks.length };
  }

  const avgScore = (key) => {
    const sum = valid.reduce((acc, r) => {
      const layer = r[key] || {};
      return acc + (layer.score || 0);
    }, 0);
    return Math.round(sum / valid.length);
  };

  const suggestions = [...new Set(valid.flatMap(r => r.suggestions || []))].slice(0, 5);

  return {
    agentId,
    taskCount: tasks.length,
    evaluatedCount: valid.length,
    timestamp: new Date().toISOString(),
    overall: {
      score: avgScore('overall'),
      grade: (() => {
        const s = avgScore('overall');
        return s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : 'D';
      })(),
    },
    capability: { score: avgScore('capability'), metrics: valid[0]?.capability?.metrics || [] },
    quality:     { score: avgScore('quality'),     metrics: valid[0]?.quality?.metrics || [] },
    business:    { score: avgScore('business'),    metrics: valid[0]?.business?.metrics || [] },
    suggestions,
    taskResults: results,
    // 交付物均分（来自各任务评估结果中的 deliverableScore）
    deliverableScore: (() => {
      const scores = valid.filter(r => typeof r.deliverableScore === 'number').map(r => r.deliverableScore);
      if (scores.length === 0) return null;
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
    })(),
  };
}

/**
 * 评估特定智能体 + 特定任务组合
 * @param {string} agentId
 * @param {string} taskId
 * @param {object} taskData   任务详情
 * @param {Array}  artifacts  交付物
 */
export async function evaluateAgentTask(agentId, taskId, taskData, artifacts = []) {
  return evaluateTask(
    { ...taskData, agentId, taskId },
    artifacts
  );
}
