/**
 * 任务失败诊断（2026-11-20）
 *
 * 问题：任务失败时前端只显示一句「任务执行失败：<技术错误>」，用户不知道
 * 该改什么。实测任务 9184ca57 报「DeepSeek 账户余额不足（402）」，
 * 但真实原因是智谱 429 限流 —— 用户按提示去充值也解决不了。
 *
 * 这里把原始错误分类成「用户能采取行动的类别」，并给出：
 *   category   机器可读类别（前端可据此换图标/颜色）
 *   title      一句话说清是什么问题
 *   detail     具体原因（含服务商、模型名、状态码等可核对信息）
 *   actions[]  用户可以做的事（按优先级排列，每条都能落地）
 *   retryable  是否值得重试
 *
 * 设计原则：宁可给「我不确定，请把这条信息发给管理员」也不要给错方向的建议。
 * 判不准就归到 unknown，并把原始错误完整带上。
 */

/** 服务商中文名（错误提示里用，比 provider key 友好） */
const PROVIDER_NAMES = {
  deepseek: 'DeepSeek',
  dashscope: '阿里云百炼',
  zhipu: '智谱 AI',
  moonshot: '月之暗面 Kimi',
  volcengine: '火山方舟',
  hunyuan: '腾讯混元',
  qianfan: '百度千帆',
  spark: '讯飞星火',
  siliconflow: '硅基流动',
  minimax: 'MiniMax',
  stepfun: '阶跃星辰',
  sensenova: '商汤日日新',
  baichuan: '百川智能',
  openai: 'OpenAI',
  xai: 'xAI',
  gemini: 'Google Gemini',
  mistral: 'Mistral AI',
  groq: 'Groq',
  together: 'Together AI',
  openrouter: 'OpenRouter',
  deepinfra: 'DeepInfra',
};

export function providerDisplayName(provider) {
  return PROVIDER_NAMES[String(provider || '').toLowerCase()] || provider || '当前服务商';
}

/**
 * 诊断一条失败信息
 *
 * @param {string|Error} rawError 原始错误（后端拼好的中文错误串或 Error）
 * @param {Object} [ctx]
 * @param {string} [ctx.provider] 本次使用的服务商
 * @param {string} [ctx.model] 本次使用的模型
 * @param {number} [ctx.agentId] 智能体 id
 * @returns {{category:string,title:string,detail:string,actions:string[],retryable:boolean,raw:string}}
 */
export function diagnoseFailure(rawError, ctx = {}) {
  const raw = String((rawError && rawError.message) || rawError || '').trim();
  const provider = providerDisplayName(ctx.provider);
  const model = ctx.model ? String(ctx.model) : '';

  const build = (category, title, detail, actions, retryable) => ({
    category, title, detail, actions: actions.filter(Boolean), retryable, raw,
  });

  // ── 限流 / 并发超限（必须排在余额之前）────────────────────
  //
  // 顺序很重要：429 的响应体里**可能带「余额不足」字样**（实测智谱就是这样），
  // 如果先判余额，就会把限流误报成「账户余额不足」，用户去充值也没用。
  // 判据是状态码/限流关键词，不看余额词。
  if (/\b429\b|请求过于频繁|并发超限|rate limit|too many requests/i.test(raw)) {
    return build(
      'rate_limit',
      `${provider} 暂时拒绝了请求（限流）`,
      `${provider} 返回 429：请求过于频繁、并发超出套餐限制，或当日额度已用尽。这不是你配置错了。`,
      [
        '等 1~2 分钟后重新执行',
        `到 ${provider} 控制台确认套餐的并发/日额度是否够用`,
        '如果经常出现，换一个额度更高的服务商或在配置里调低并发',
      ],
      true,
    );
  }

  // ── 余额不足 ──────────────────────────────────────────────
  if (/余额不足|insufficient Balance|insufficient_quota|\b402\b/i.test(raw)) {
    return build(
      'balance',
      `${provider} 账户余额不足`,
      `${provider} 返回余额不足${model ? `（本次模型 ${model}）` : ''}。`,
      [
        `到 ${provider} 控制台给账户充值`,
        '或在「系统设置与管理 → API KEY 配置」里换一条有余额的 Key 并设为默认',
      ],
      false, // 充值后重试没有意义，必须先改配置
    );
  }

  // ── 认证失败 / Key 无效 ───────────────────────────────────
  if (/401|403|Authentication Fails|invalid.*api.?key|Unauthorized|令牌|未授权|鉴权失败/i.test(raw)) {
    return build(
      'auth',
      `${provider} 拒绝了这把 API Key`,
      `${provider} 返回鉴权失败：Key 可能已过期、被撤销，或填错了服务商（把 A 家的 Key 填成了 B 家）。`,
      [
        '到「系统设置与管理 → API KEY 配置」点这条 Key 的「验证」，看具体报错',
        '确认服务商选对了（Key 属于哪家就选哪家）',
        '必要时重新生成 Key 并更新到这里',
      ],
      false,
    );
  }

  // ── 模型名不受支持 ────────────────────────────────────────
  if (/model.*not.*(?:found|exist|support)|supported API model|模型.*(?:不存在|不支持)|invalid.*model/i.test(raw)) {
    return build(
      'model_not_found',
      `模型名 ${model || ''} 不被 ${provider} 支持`,
      `${provider} 不接受这个模型名${model ? `：${model}` : ''}。每家服务商的模型名不一样，填错会直接拒绝。`,
      [
        '到「系统设置与管理 → API KEY 配置」编辑这条 Key，把「模型」留空（会自动用该服务商的推荐模型）',
        '或填该服务商真实支持的模型名（可查它的官方文档）',
      ],
      false,
    );
  }

  // ── 上下文超限 ────────────────────────────────────────────
  if (/maximum context length|context.*too.*long|上下文超限|tokens.*exceed/i.test(raw)) {
    return build(
      'context_overflow',
      '本次输入超出了模型上下文上限',
      `提交给模型的内容比 ${provider} 允许的上下文更长${model ? `（模型 ${model}）` : ''}。通常是需求文档过长或历史对话累积过多。`,
      [
        '把需求拆成多次提交（例如按模块分批生成用例）',
        '或换上下文更大的模型/服务商',
        '或缩短输入文档（去掉与本次无关的章节）',
      ],
      false,
    );
  }

  // ── 网络 / 超时 ───────────────────────────────────────────
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|socket hang up|超时|timeout|AbortError/i.test(raw)) {
    return build(
      'network',
      '连不上模型服务',
      `请求 ${provider} 时网络不通或超时。可能是本机网络问题，也可能是该服务在当前网络下不可达（部分海外服务需要代理）。`,
      [
        '稍后重试一次',
        '到「API KEY 配置」点「验证」，能快速确认是不是网络问题',
        `若持续失败，确认服务器到 ${provider} 的网络是否可达`,
      ],
      true,
    );
  }

  // ── 并发任务冲突 ──────────────────────────────────────────
  if (/同一用户同一时间只能执行一个任务|TASK_CONFLICT/i.test(raw)) {
    return build(
      'busy',
      '你已有一个任务在执行',
      '同一用户同一时间只能跑一个任务，等当前任务结束再提交。',
      ['等正在执行的任务结束后重新提交', '或先取消正在执行的任务'],
      true,
    );
  }

  // ── 未执行必需工具 / 输入不足 ─────────────────────────────
  if (/未执行真实工具|未调用.*工具|EvidenceGate/i.test(raw)) {
    return build(
      'tool_not_called',
      '智能体没有真正调用必需的执行工具',
      '模型没有调用系统提供的确定性工具就试图输出结果，被系统拒绝了（避免编造）',
      ['重新执行一次（多数是模型偶发跳步）', '若反复出现，检查输入是否让模型认为「不需要工具」'],
      true,
    );
  }

  // ── 质量门禁拒绝交付 ──────────────────────────────────────
  if (/可用率.*低于|低于要求|未通过确定性检查|拒绝交付/i.test(raw)) {
    return build(
      'quality_gate',
      '交付物没通过质量门禁',
      '生成内容的可判定性/覆盖率不达标，系统拒绝把它当作成品交付。',
      ['重新执行一次（模型每轮结果会有差异）', '若反复不达标，补充更明确的需求描述（字段、规则、状态）'],
      true,
    );
  }

  // ── 兜底：不猜，把原文交出去 ──────────────────────────────
  return build(
    'unknown',
    '任务执行失败',
    raw ? `原始错误：${raw.slice(0, 400)}` : '没有拿到具体错误信息。',
    [
      '重新执行一次（偶发错误多数能自愈）',
      raw ? '若持续失败，把上面这条原始错误发给管理员排查' : '若持续失败，请联系管理员',
    ],
    true,
  );
}
