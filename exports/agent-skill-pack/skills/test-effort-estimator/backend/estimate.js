/**
 * test-effort-estimator · 人工工作量确定性估算
 *
 * 用于测试中台的任务 manualHours / 工作流工时 / 节省成本统计。
 * 纯函数，不调用 LLM；同一输入永远得到同一结果，便于成本复核。
 *
 * @version 1.0.0
 */

/** 各智能体人工执行一次的基准人天 */
const BASE_PERSON_DAYS = {
  'test-requirement-analyzer': 0.5,
  'test-scheme-generator': 0.75,
  'test-case-generator': 1.0,
  'test-data-generator': 0.25,
  'test-script-generator': 1.0,
  'api-executor': 0.5,
  'ui-e2e-executor': 1.0,
  'performance-tester': 1.0,
  'security-sentinel': 1.0,
  'compatibility-coordinator': 1.0,
  'defect-analyzer': 0.5,
  'data-masking': 0.25,
  'test-reporter': 0.75,
  'test-master': 0.5,
};

const DEFAULT_BASE_PERSON_DAYS = 0.5;
const HOURS_PER_PERSON_DAY = 8;
const SCALE_MIN = 0.6;
const SCALE_MAX = 2.5;

function asText(taskInput) {
  if (taskInput == null) return '';
  if (typeof taskInput === 'string') return taskInput;
  try {
    return JSON.stringify(taskInput);
  } catch {
    return String(taskInput);
  }
}

function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

/** 统计去重后的编号数量（同一需求在追溯矩阵里会重复出现多次，不能都算规模） */
function countUniqueIds(text, regex) {
  const set = new Set();
  for (const m of text.matchAll(regex)) set.add(String(m[0]).toUpperCase());
  return set.size;
}

/** 输入长度维度 */
function lengthFactor(text) {
  const len = text.length;
  let weight = 1.0;
  let level = 'medium';
  if (len < 2000) { weight = 0.9; level = 'small'; }
  else if (len <= 8000) { weight = 1.0; level = 'medium'; }
  else if (len <= 30000) { weight = 1.1; level = 'large'; }
  else { weight = 1.2; level = 'very_large'; }
  return { raw: len, level, weight };
}

/** 需求条目维度：按去重后的 FR-/NFR- 编号计 */
function requirementFactor(text) {
  const count = countUniqueIds(text, /\b(?:FR|NFR)-\d{1,4}\b/gi);
  let weight = 1.0;
  if (count >= 41) weight = 1.6;
  else if (count >= 16) weight = 1.4;
  else if (count >= 5) weight = 1.2;
  return { count, weight };
}

/** 接口数量维度：按去重后的 API-xxx 编号计；无编号时退回「方法+路径」行数 */
function apiFactor(text) {
  const apiIds = countUniqueIds(text, /\bAPI-\d{2,4}\b/gi);
  const methodLines = new Set();
  for (const m of text.matchAll(/^\s*(?:[-*|]\s*)?((?:GET|POST|PUT|DELETE|PATCH)\s+[A-Za-z0-9_\-/{}.]+)/gim)) {
    methodLines.add(m[1].replace(/\s+/g, ' ').toUpperCase());
  }
  const count = Math.max(apiIds, methodLines.size);
  let weight = 1.0;
  if (count >= 21) weight = 1.5;
  else if (count >= 6) weight = 1.3;
  else if (count >= 1) weight = 1.1;
  return { count, weight };
}

/** 模块数量维度：按去重后的模块名计（「模块」字样出现次数会随表格重复放大） */
function moduleFactor(text) {
  const names = new Set();
  for (const m of text.matchAll(/([\u4e00-\u9fa5A-Za-z0-9_]{2,12})(?:模块|子系统)/g)) names.add(m[1]);
  const count = names.size;
  let weight = 1.0;
  if (count > 6) weight = 1.2;
  else if (count >= 3) weight = 1.1;
  return { count, weight };
}

/** 风险/边界线索维度：按去重后的风险关键词计 */
function riskFactor(text) {
  const keywords = new Set();
  for (const m of text.matchAll(/(边界|异常|并发|幂等|越权|超时|回滚|重试|锁定|限流|降级)/g)) keywords.add(m[1]);
  const count = keywords.size;
  let weight = 1.0;
  if (count > 8) weight = 1.1;
  else if (count >= 3) weight = 1.05;
  return { count, weight };
}

function complexityOf(personDays) {
  if (personDays < 0.5) return { level: 'low', score: 2 };
  if (personDays <= 1.5) return { level: 'medium', score: 4 };
  if (personDays <= 3) return { level: 'high', score: 7 };
  return { level: 'very_high', score: 9 };
}

/**
 * 估算人工工作量
 * @param {Object} options
 * @param {string} [options.taskType] - 智能体 ID
 * @param {string|Object} [options.taskInput] - 任务输入（文本或对象）
 * @returns {Object} 估算结果
 */
function estimateEffort(options = {}) {
  const taskType = String(options.taskType || '').trim();
  const text = asText(options.taskInput);

  const basePersonDays = Object.prototype.hasOwnProperty.call(BASE_PERSON_DAYS, taskType)
    ? BASE_PERSON_DAYS[taskType]
    : DEFAULT_BASE_PERSON_DAYS;

  const factors = {
    inputLength: lengthFactor(text),
    requirements: requirementFactor(text),
    apis: apiFactor(text),
    modules: moduleFactor(text),
    risks: riskFactor(text),
  };

  const rawScale = Object.values(factors).reduce((acc, f) => acc * f.weight, 1);
  const scale = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, rawScale)) * 100) / 100;
  const totalPersonDays = Math.round(basePersonDays * scale * 100) / 100;
  const totalHours = Math.round(totalPersonDays * HOURS_PER_PERSON_DAY * 100) / 100;
  const complexity = complexityOf(totalPersonDays);

  return {
    taskType: taskType || 'unknown',
    complexity: complexity.level,
    complexityScore: complexity.score,
    basePersonDays,
    scale,
    factors,
    totalPersonDays,
    totalHours,
    basis: `基准人天 ${basePersonDays} × 规模系数 ${scale}（输入长度/${factors.inputLength.level}、需求 ${factors.requirements.count} 条、接口 ${factors.apis.count} 个、模块线索 ${factors.modules.count} 处、风险线索 ${factors.risks.count} 处）`,
  };
}

module.exports = {
  estimateEffort,
  BASE_PERSON_DAYS,
  HOURS_PER_PERSON_DAY,
};
