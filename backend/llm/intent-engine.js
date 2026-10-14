/**
 * intent-engine —— 意图驱动测试的模型侧能力(Harness intent-driven 五步的模型部分)
 * ============================================================
 * 本模块只负责"想":把自然语言解析成结构化 Test Intent、观察页面/响应后决定下一步、
 * 生成断言点、产出知识回流摘要。它不含任何浏览器或 HTTP 执行逻辑(那是执行器的职责),
 * 以保证执行器可独立测试、模型不可用时可降级。
 *
 * 对应 Harness 文档五步:
 *   ① NL → 结构化 Test Intent       : parseIntent()
 *   ② AI 推理 + 应用状态迭代探索      : decideNext()
 *   ③ 可执行命令生成 + 执行↔推理闭环   : decideNext() 每步产出(执行器执行后回传 observation)
 *   ④ 视觉 + DOM 双重校验            : autoAssertions() + 执行器内 DOM 校验/视觉基线比对
 *   ⑤ 每次运行回流 App Knowledgebase : kbDigest()
 *
 * 依赖: 仅 Node 内置 fetch(Node >= 18)。模型直连 Deepseek。
 * 环境变量: DEEPSEEK_API_KEY(必填)、DEEPSEEK_BASE_URL / DEEPSEEK_MODEL(可选)
 */

'use strict';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';

function clip(s, max = 1200) {
  if (s == null) return null;
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (str == null) return null;
  return str.length > max ? `${str.slice(0, max)}... [截断,共 ${str.length} 字符]` : str;
}

/**
 * 归一化断言期望值。
 * 模型经常把 expected 写成一整句描述(如「页面显示文本"分步测试"」),
 * 而本地客观判定需要的是**可直接比较的字面量**。
 * 这里在"期望值确实是一整句"时,抽取出引号内的内容作为字面值。
 */
function normalizeExpected(v) {
  if (v === undefined || v === null) return v;
  const s0 = String(v).trim();
  const quoted = s0.match(/[「『“"']([^」』“”"']{1,200})[」』“"']/);
  if (quoted && quoted[1]) {
    const inner = quoted[1].trim();
    if (inner && inner !== s0) return inner;
  }
  return s0;
}

/**
 * 归一化断言目标。
 * 模型常把 target 写成"导航栏中的「分步测试」导航项"这类长描述,
 * 而定位需要的是元素本身的短字面文本。这里抽取出引号内的内容。
 */
function normalizeTarget(v) {
  if (v === undefined || v === null) return v;
  const s0 = String(v).trim();
  const quoted = s0.match(/[「『“"']([^」』“”"']{1,200})[」』“"']/);
  if (quoted && quoted[1]) {
    const inner = quoted[1].trim();
    if (inner && inner !== s0) return inner;
  }
  return s0;
}

/** 从模型输出中稳健提取 JSON(兼容 ```json 代码块) */
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(s.slice(first, last + 1));
    } catch (_) {
      /* 继续尝试整体解析 */
    }
  }
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/**
 * 调模型并要求 JSON 输出
 * @returns {Promise<object>} 解析后的对象
 */
async function chatJSON({ system, user, maxTokens = 2000, timeoutMs = 60000, temperature = 0 }) {
  if (!DEEPSEEK_API_KEY) {
    const err = new Error('未配置 DEEPSEEK_API_KEY,intent-engine 不可用');
    err.code = 'NO_LLM_KEY';
    throw err;
  }

  const callOnce = async (tokens) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(DEEPSEEK_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature,
          max_tokens: tokens,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        const err = new Error(`模型调用失败 HTTP ${res.status}: ${clip(txt, 300)}`);
        err.code = 'LLM_HTTP_ERROR';
        throw err;
      }

      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  let payload = await callOnce(maxTokens);
  let choice = payload?.choices?.[0] || {};
  // 输出被 max_tokens 截断时,翻倍重试一次,避免拿到残缺 JSON
  if (choice.finish_reason === 'length' && maxTokens < 8000) {
    payload = await callOnce(Math.min(maxTokens * 3, 8000));
    choice = payload?.choices?.[0] || {};
  }

  // 部分推理型模型把正文放在 reasoning_content 而 content 为空,这里做兜底
  let content = choice?.message?.content || '';
  if (!content && choice?.message?.reasoning_content) {
    content = choice.message.reasoning_content;
  }

  const parsed = extractJson(content);
  if (!parsed) {
    const finishReason = choice.finish_reason || '未知';
    const usage = payload?.usage ? JSON.stringify(payload.usage) : '(无)';
    const err = new Error(
      `模型未返回可解析的 JSON(finish_reason=${finishReason}, usage=${usage}): ${clip(content, 300)}`
    );
    err.code = finishReason === 'length' ? 'LLM_TRUNCATED' : 'LLM_BAD_JSON';
    err.finishReason = finishReason;
    throw err;
  }
  return parsed;
}

/** 模型侧能力是否可用 */
function isAvailable() {
  return !!DEEPSEEK_API_KEY;
}

// ============================================================
// ① 自然语言 → 结构化 Test Intent
// ============================================================

const INTENT_SYSTEM = `你是一名资深测试架构师,负责把自然语言描述的测试诉求解析成结构化 Test Intent。
严格只输出 JSON,不要任何解释性文字。字段缺失时用空字符串/空数组,不要臆造。

输出结构:
{
  "goal": "一句话说明用户想验证什么",
  "preconditions": ["前置条件"],
  "entry": { "baseUrl": "", "startUrl": "" },
  "auth": { "required": false, "loginUrl": "", "tokenPath": "", "injectAs": "" },
  "dataNeeds": [{ "name": "", "desc": "", "source": "" }],
  "assertions": [{ "id": "A1", "description": "", "target": "", "expectation": "", "type": "dom|visual|status|schema", "severity": "block|major|minor" }],
  "successSignal": "达成意图的可观测信号",
  "risks": ["风险"]
}`;

const INTENT_SYSTEM_API = `${INTENT_SYSTEM}

另外必须输出 "requests" 数组(可直接执行的请求序列),每项:
{
  "name": "用例名",
  "method": "GET|POST|PUT|DELETE|PATCH",
  "url": "绝对地址或以 / 开头的相对路径",
  "headers": {},
  "query": {},
  "body": null,
  "expect": { "status": 200, "json": {}, "jsonPath": [], "contains": "", "notContains": "", "maxDurationMs": 3000 },
  "extract": { "变量名": "data.token" }
}
规则:
- url 优先用相对路径配合 baseUrl。
- expect.status 对异常场景(如密码错误期望 401)必须显式写出;正常场景默认 < 400。
- extract 只提取后续用例真正需要的字段(如 token、id、orderNo)。
- 用例之间若有数据依赖,用 extract + {{变量名}} 串起来。`;

const INTENT_SYSTEM_UI = `${INTENT_SYSTEM}

另外必须输出 "stepsHint" 数组(意图拆解出的自然语言步骤,不写死选择器),每项:
{
  "action": "goto|click|fill|type|press|select|check|uncheck|hover|wait|waitFor|waitForUrl|reload|goBack|screenshot|expectText|expectVisible|expectHidden|expectUrl|expectTitle|expectCount|expectValue|expectAttribute",
  "target": "人话描述要点什么/填什么(如:用户名输入框、登录按钮、页面右上角的用户名)",
  "value": "需要输入的值(没有则为 null)",
  "expectation": "这一步希望观察到的现象"
}
断言 type 只允许:text | visible | url | dom | visual
- text  :期望页面(或 target 元素)出现某段文本
- visible:期望 target 元素可见
- url   :期望 URL 包含某段
- dom / visual:期望 target 对应的界面元素存在;视觉/布局差异交由视觉基线比对覆盖
规则:
- target 必须是人话语义描述,禁止编造 CSS 选择器或 data-testid。
- 若需要登录,先输出 goto 登录页 + 填写凭证 + 点击登录。
- 用 expectText/expectUrl/expectVisible 等表达"怎么算通过"。`;

/**
 * 解析测试意图
 * @param {object} o
 * @param {'api'|'ui'} o.kind
 * @param {string} o.input   原始输入(用例文档 / 接口清单 / 场景描述 / URL+凭证)
 * @param {string} [o.baseUrl]
 * @param {object} [o.env]   环境信息补充(如账号)
 */
async function parseIntent({ kind, input, baseUrl = '', env = {} }) {
  const system = kind === 'api' ? INTENT_SYSTEM_API : INTENT_SYSTEM_UI;
  const user = [
    `【测试类型】${kind === 'api' ? '接口测试' : 'UI/E2E 测试'}`,
    baseUrl ? `【基地址】${baseUrl}` : '',
    env && Object.keys(env).length ? `【环境信息】${JSON.stringify(env)}` : '',
    '【原始输入开始】',
    String(input || '').slice(0, 24000),
    '【原始输入结束】',
  ]
    .filter(Boolean)
    .join('\n');

  const r = await chatJSON({ system, user, maxTokens: 4000, timeoutMs: 90000 });

  // 归一化:避免后续代码到处判空
  return {
    goal: r.goal || '',
    preconditions: Array.isArray(r.preconditions) ? r.preconditions : [],
    entry: {
      baseUrl: r.entry?.baseUrl || baseUrl || '',
      startUrl: r.entry?.startUrl || '',
    },
    auth: {
      required: !!r.auth?.required,
      loginUrl: r.auth?.loginUrl || '',
      tokenPath: r.auth?.tokenPath || '',
      injectAs: r.auth?.injectAs || '',
      username: r.auth?.username || '',
      password: r.auth?.password || '',
    },
    dataNeeds: Array.isArray(r.dataNeeds) ? r.dataNeeds : [],
    // 统一断言字段名、期望字面量与目标描述,避免执行器拿到"整句话"作为期望值
    assertions: (Array.isArray(r.assertions) ? r.assertions : []).map((a, i) => {
      if (!a || typeof a !== 'object') return a;
      const expected = a.expected !== undefined ? a.expected : a.expectation;
      return {
        ...a,
        id: a.id || `A${i + 1}`,
        expected: normalizeExpected(expected),
        target: normalizeTarget(a.target),
      };
    }),
    successSignal: r.successSignal || '',
    requests: Array.isArray(r.requests) ? r.requests : [],
    stepsHint: Array.isArray(r.stepsHint) ? r.stepsHint : [],
    risks: Array.isArray(r.risks) ? r.risks : [],
  };
}

// ============================================================
// ②③ 迭代决策:据当前应用状态决定下一步
// ============================================================

const DECIDE_SYSTEM = `你是一个"意图驱动的 UI 自动化执行代理"。你会看到:
1) 用户的测试意图(goal / successSignal / assertions)
2) 当前页面的紧凑快照(URL、标题、可见文本摘要、可交互元素列表)
3) 已经执行过的步骤与结果

你要做的是:判断意图是否已经达成;若未达成,给出**下一步唯一的一个动作**。

只输出 JSON:
{
  "done": false,
  "reasoning": "为什么这么判断/为什么还没达成",
  "action": {
    "action": "goto|click|fill|type|press|select|check|uncheck|hover|wait|waitFor|waitForUrl|reload|goBack|screenshot|expectText|expectVisible|expectHidden|expectUrl|expectTitle|expectCount|expectValue|expectAttribute|finish",
    "target": "人话描述(如:用户名输入框、登录按钮)",
    "selector": "仅当你能从快照的候选选择器中百分之百确定时才填,否则留空字符串",
    "value": "输入值或断言期望值,没有则 null",
    "state": "waitFor 用的状态: visible/hidden/attached/detached"
  },
  "achievedAssertions": ["已满足的断言 id"]
}

硬约束(违反即为错误决策):
1. 一次只输出一个动作,不要输出多个。
2. 优先用 target 人话描述;selector 留空由执行器用语义定位解析(可自愈)。
3. **先判定是否已达成,再决定动作**。判定时逐字比对 goal 与【当前状态快照】的 url / title / text / headings:
   - 若 goal 属于"打开/进入/访问 X 页面"这类**纯导航型意图**,而当前 url 已经是该目标地址(或已是 baseUrl 根路径、或已从 startUrl 跳转到预期页面),
     则意图已达成 —— 必须 done=true,action.action="finish",不得再安排任何动作。
   - 只有存在"登录后才能看到的内容""提交表单""校验业务结果"等**超出导航的后续动作**时,才继续输出动作。
4. **严禁编造快照中不存在的元素**。动作所需的 target 必须能在 elements 列表里找到语义对应项;
   找不到就说明当前页面没有这个东西,应换路径(如先 goto 其他地址、先登录)或直接 done=true 并在 reasoning 说明"页面无此元素,判定阻塞",
   **绝不允许自行脑补"返回首页按钮""退出登录"之类快照里没出现的控件**。
5. **严禁为了凑步骤而执行与 goal 无关的动作**(如 goal 是打开首页,却去点"返回首页")。
6. 若【已执行步骤】显示刚做过 goto 且成功,不要再对同一地址重复 goto。
7. 若连续多步无进展(同一元素始终找不到/动作反复失败),done=true 并在 reasoning 说明阻塞原因。`;

/**
 * @param {object} o
 * @param {'api'|'ui'} o.kind
 * @param {object} o.intent   parseIntent 产物
 * @param {object} o.observation 执行器采集的紧凑状态
 * @param {Array}  o.history  已执行步骤
 * @param {number} o.remaining 剩余可用步数
 * @param {string} o.startUrl 起始地址(用于判定导航型意图是否已达成)
 * @param {string} o.lastError 上一步失败原因
 */
async function decideNext({
  kind,
  intent,
  observation,
  history = [],
  remaining = 5,
  startUrl = '',
  lastError = '',
}) {
  const doneSteps = history.length;
  const failedSteps = history.filter((h) => h && h.ok === false);
  const progress = [
    `已执行步数: ${doneSteps}`,
    `失败步数: ${failedSteps.length}`,
    `起始地址: ${startUrl || '(未指定)'}`,
    `当前地址: ${(observation && observation.url) || '(未知)'}`,
    lastError ? `上一步失败原因: ${lastError}` : '上一步无失败',
  ].join('\n');

  const user = [
    '【意图】',
    JSON.stringify(
      {
        goal: intent.goal,
        successSignal: intent.successSignal,
        assertions: intent.assertions,
        preconditions: intent.preconditions,
      },
      null,
      2
    ),
    '',
    '【当前状态快照】',
    JSON.stringify(observation, null, 2).slice(0, 12000),
    '',
    '【已执行步骤】',
    JSON.stringify(history.slice(-12), null, 2).slice(0, 6000),
    '',
    '【进度判定】',
    progress,
    '',
    `【剩余步数】${remaining}`,
    '',
    '请先对照【进度判定】与【当前状态快照】判断意图是否已达成;',
    '若已达成 → done=true 且 action.action="finish";',
    '若未达成 → 给出唯一下一步动作,target 必须能在快照 elements 中找到语义对应项。',
  ].join('\n');

  // 注意:默认接入的是推理型模型(会消耗 reasoning tokens),预算给足,
  // 否则 max_tokens 被推理过程耗尽 → content 为空 → 解析失败
  const r = await chatJSON({
    system: DECIDE_SYSTEM,
    user,
    maxTokens: 4000,
    timeoutMs: 90000,
  });

  return {
    done: !!r.done,
    reasoning: r.reasoning || '',
    achievedAssertions: Array.isArray(r.achievedAssertions) ? r.achievedAssertions : [],
    action: r.action && typeof r.action === 'object' ? r.action : { action: 'finish' },
  };
}

// ============================================================
// ④ 自动断言生成
// ============================================================

const ASSERT_SYSTEM = `你是测试断言设计专家。基于"意图"和"观测到的响应/页面状态",产出可执行断言清单。
只输出 JSON:
{
  "assertions": [
    {
      "id": "A1",
      "description": "这条断言验证什么",
      "type": "status|duration|json|jsonPath|contains|notContains|text|visible|url",
      "target": "断言对象(状态码/响应耗时/JSON路径/元素语义描述)",
      "expected": "期望值",
      "severity": "block|major|minor"
    }
  ]
}
规则:
- 只基于已观测到的真实数据设计断言,不要假设未出现的数据。
- 接口场景至少覆盖:状态码、关键业务字段存在性/取值;必要时加响应时间上限。
- UI 场景优先用文本/URL/可见性这类可客观校验的断言;视觉类用 type:"visible"+元素描述。

【最关键】expected 必须是"被校验的那个字面值本身",不要写成一句描述。
正误对照(务必照此输出):
  ✅ {"type":"text","target":"分步测试 导航项","expected":"分步测试"}
  ❌ {"type":"text","target":"导航项","expected":"页面显示文本「分步测试」"}
  ✅ {"type":"status","target":"HTTP 状态码","expected":200}
  ❌ {"type":"status","target":"HTTP 状态码","expected":"请求应当成功"}
  ✅ {"type":"url","target":"当前地址","expected":"/dashboard"}
  ❌ {"type":"url","target":"当前地址","expected":"跳转到仪表盘"}

其他:
【target 的写法】用页面上**真实存在的短字面文本或可访问名**,不要用长描述句。
正误对照:
  ✅ "分步测试"              (导航项自身文本)
  ❌ "导航栏中的「分步测试」导航项"  (长描述,定位不到)
  ✅ "用户名"                 (输入框 placeholder)
  ❌ "页面顶部的用户名输入框"    (长描述)

其他:
- target 是人话语义,不要编造 CSS/XPath 选择器 —— 选择器由执行器语义定位解析并可自愈。
- expected 不要写正则;数字/布尔直接给字面量,不要加单位或说明。
- UI 场景能用 type:"text" 就优先用 text(整页文本包含即通过),它的判定最稳。
  只有当必须确认"某个控件存在"时才用 visible。`;

/**
 * 生成断言清单(由模型提出断言点,由执行器客观判定 passed)
 * @param {object} o
 * @param {'api'|'ui'} o.kind
 * @param {object} o.intent
 * @param {object} o.observation  响应摘要 / 页面快照
 */
async function autoAssertions({ kind, intent, observation }) {
  const user = [
    `【测试类型】${kind === 'api' ? '接口测试' : 'UI/E2E 测试'}`,
    '【意图】',
    JSON.stringify(
      { goal: intent.goal, successSignal: intent.successSignal, assertions: intent.assertions },
      null,
      2
    ).slice(0, 6000),
    '',
    '【观测数据】',
    JSON.stringify(observation, null, 2).slice(0, 10000),
  ].join('\n');

  const r = await chatJSON({ system: ASSERT_SYSTEM, user, maxTokens: 3000, timeoutMs: 90000 });
  const list = Array.isArray(r.assertions) ? r.assertions : [];
  // 统一字段名与字面量:模型可能给 expectation,也可能把 expected 写成整句话
  return list.map((a, i) => {
    if (!a || typeof a !== 'object') return a;
    const expected = a.expected !== undefined ? a.expected : a.expectation;
    return {
      ...a,
      id: a.id || `A${i + 1}`,
      expected: normalizeExpected(expected),
      target: normalizeTarget(a.target),
      expectation: undefined,
    };
  });
}

// ============================================================
// ⑤ 知识回流摘要
// ============================================================

const KB_SYSTEM = `你负责把一次测试执行沉淀为可复用的应用知识条目,供后续测试生成与自愈定位参考。
只输出 JSON:
{
  "flows": [{ "name": "", "entryUrl": "", "steps": [""], "notes": "" }],
  "elements": [{ "name": "", "kind": "input|button|link|text|other", "locators": ["text=xxx"], "page": "" }],
  "contracts": [{ "api": "", "method": "", "keyFields": [""], "notes": "" }],
  "findings": [""]
}
规则: 只记录本次真实观测到的内容,不臆造。元素定位优先给"text=/role="这类与人话描述对应的稳定定位。`;

async function kbDigest({ kind, intent, execResult }) {
  const user = [
    `【测试类型】${kind === 'api' ? '接口测试' : 'UI/E2E 测试'}`,
    `【意图】${intent.goal || ''}`,
    '【执行结果】',
    JSON.stringify(execResult, null, 2).slice(0, 12000),
  ].join('\n');

  const r = await chatJSON({ system: KB_SYSTEM, user, maxTokens: 2000, timeoutMs: 60000 });
  return {
    flows: Array.isArray(r.flows) ? r.flows : [],
    elements: Array.isArray(r.elements) ? r.elements : [],
    contracts: Array.isArray(r.contracts) ? r.contracts : [],
    findings: Array.isArray(r.findings) ? r.findings : [],
  };
}

module.exports = {
  isAvailable,
  chatJSON,
  extractJson,
  normalizeExpected,
  parseIntent,
  decideNext,
  autoAssertions,
  kbDigest,
};
