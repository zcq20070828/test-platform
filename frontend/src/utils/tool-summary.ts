/**
 * 工具结果 → 自然语言摘要（2026-11-19）
 *
 * 问题：智能体调用 skill 后，工具返回的是结构化 JSON（9dem_executor 单次可达 41KB，
 * 包含 design.cases / dimensionCases / summary 等嵌套数组）。前端过去把它
 * 原样塞进 <pre> 或渲染成一大段 JSON，用户读不懂也看不到重点。
 *
 * 这里做的事：**只提取人能读的结论**，按 skill 类型给出不同的摘要句式。
 * 不追求覆盖所有可能结构，识别不出来就退化成「字段计数」摘要，绝不原样贴 JSON。
 *
 * 设计原则：
 *   1. 输出是中文自然语言句子，不是 JSON 片段
 *   2. 单条摘要控制在 3~6 行，超出的明细由交付物承载
 *   3. 数值优先（条数/通过率/覆盖率），再做定性判断
 *   4. 无法识别结构时给出字段清单，而不是把 JSON 摊开
 */

const SKILL_LABELS: Record<string, string> = {
  '9dem-executor': '九维穷举 + 黑盒9法',
  '9dem-planner': '九维规划',
  'requirement-parser': '需求解析',
  'test-strategy-designer': '测试策略设计',
  'result-aggregator': '结果聚合',
  'quality-metrics-calculator': '质量度量',
  'defect-classifier': '缺陷分类',
  'failure-root-cause-analyzer': '根因分析',
  'data-masking-invoker': '数据脱敏',
  'test-data-generator-skill': '测试数据生成',
  'api-direct-invoker': '接口直连执行',
  'api-test-tool-invoker': '接口脚本执行',
  'ui-direct-invoker': '浏览器直连执行',
  'ui-test-tool-invoker': 'UI 脚本执行',
  'mobile-e2e-invoker': '移动端 E2E',
  'desktop-e2e-invoker': '桌面端 E2E',
  'browser-matrix-invoker': '浏览器矩阵',
  'compatibility-coordinator-invoker': '兼容性协调',
  'evaluation-system': '评估体系',
  'jmeter-executor': 'JMeter 压测',
  'k6-executor': 'k6 压测',
};

/**
 * skill id → 中文名（未知时回退原始 id）
 *
 * 工具调用里传来的是下划线形式（backend 用 skillToolName 把 '9dem-planner'
 * 变成 '9dem_planner'），所以两种写法都要能命中。
 */
export function skillLabel(skillId: string): string {
  const raw = String(skillId || '')
  if (SKILL_LABELS[raw]) return SKILL_LABELS[raw]
  const dashed = raw.replace(/_/g, '-')
  if (SKILL_LABELS[dashed]) return SKILL_LABELS[dashed]
  // '9dem_planner' → 中文表里是 '9dem-planner'，已覆盖；
  // 其余未知工具保留原名，至少比「工具」有信息量
  return raw || '工具'
}

function num(v: any): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pct(v: any): string | null {
  const n = num(v)
  if (n === null) return null
  // 0~1 视为比例，>1 视为已是百分数
  return n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`
}

/** 9dem-executor / 9dem-planner：维度、方法、用例条数 */
function summarizeNineDem(r: any): string[] {
  const lines: string[] = []
  const s = r.summary || {}

  if (Array.isArray(r.methods) && r.methods.length) {
    const used = r.methods.filter((m: any) => !m.skipped && (num(m.caseCount) || 0) > 0)
    const skipped = r.methods.filter((m: any) => m.skipped)
    const nameOf = (m: any) => m.methodLabel || m.method || m.methodKey || '未命名方法'
    if (used.length) {
      lines.push(`启用了 ${used.length} 种设计方法：${used.map((m: any) => `${nameOf(m)}（${m.caseCount} 条）`).join('、')}。`)
    }
    if (skipped.length) {
      const reasons = skipped.slice(0, 3).map(nameOf).join('、')
      lines.push(`另有 ${skipped.length} 种方法因输入信息不足未启用（${reasons}${skipped.length > 3 ? ' 等' : ''}）。`)
    }
  }

  const designCases = Array.isArray(r.design?.cases) ? r.design.cases.length : num(s.designUniqueCases)
  if (designCases) {
    const dup = num(s.designDuplicatesRemoved) || 0
    lines.push(`黑盒方法生成 ${designCases} 条不重复用例${dup ? `（跨方法去重 ${dup} 条）` : ''}。`)
  }

  const dimCases = Array.isArray(r.dimensionCases) ? r.dimensionCases.length : num(s.dimensionProbeCount)
  if (dimCases) {
    const coveredDims = num(s.dimensionCoveredCount) || (Array.isArray(r.dimensions) ? r.dimensions.length : null)
    lines.push(`九维必测点展开 ${dimCases} 条用例${coveredDims ? `，覆盖 ${coveredDims}/9 个维度` : ''}。`)
  }

  if (r.design?.stats?.dimensionsCovered?.length) {
    // 这是「黑盒设计用例」里涉及到的维度打标，和上面的九维必测点覆盖是两回事，
    // 混在同一句话里会让人以为 9/9 的覆盖虚标，所以显式区分主语。
    const list = r.design.stats.dimensionsCovered
    lines.push(`黑盒设计用例涉及 ${list.length} 个维度：${list.join('、')}。`)
  }

  const pw = s.pairwise
  if (pw && num(pw.factorCount)) {
    const mode = pw.mode === 'full' ? '全组合枚举' : '2-wise 压缩'
    const produced = Array.isArray(r.data?.pairwise) ? r.data.pairwise.length : num(pw.outputLimit)
    const truncated = pw.outputTruncated ? `（已按输出上限截取前 ${num(pw.outputLimit) || produced} 条）` : ''
    lines.push(`组合覆盖：${pw.factorCount} 个因子，${mode}后 ${num(pw.originalTotal) || '?'} → ${produced ?? '?'} 种组合${truncated}。`)
  }
  return lines
}

/**
 * 9dem-planner：只做规划，返回 plan/schedule/priorities/checklist
 *
 * 它和 executor 的返回结构完全不同（没有 design.cases / dimensionCases），
 * 走同一个 summarizeNineDem 只能落进兜底分支变成「skill=9dem-planner, success=true」。
 */
function summarizeNineDemPlanner(r: any): string[] {
  const lines: string[] = []
  const s = r.summary || {}
  const dims = Array.isArray(r.plan?.dimensions) ? r.plan.dimensions : []

  const totalDims = num(s.totalDimensions) ?? (dims.length || null)
  const probes = num(s.probeTotal) ?? num(s.estimatedCases)
  if (totalDims) {
    lines.push(
      `规划 ${totalDims} 个维度${probes ? `、共 ${probes} 个必测点` : ''}` +
      `${num(s.estimatedCases) ? `，预计需要 ${s.estimatedCases} 条用例` : ''}` +
      `${num(s.recommendedDays) ? `（约 ${s.recommendedDays} 个工作日）` : ''}。`
    )
  }

  const covered = num(s.coveredCount)
  const pending = num(s.pendingCount)
  if (covered !== null) {
    if (covered > 0) {
      lines.push(`上游需求已覆盖 ${covered}/${totalDims || '?'} 个维度${pending ? `，待补 ${pending} 个` : ''}。`)
    } else if (pending) {
      lines.push(`上游需求尚未覆盖任何维度，${pending} 个维度全部待补。`)
    }
  }
  if (typeof s.gapMessage === 'string' && s.gapMessage.trim()) {
    lines.push(`缺口：${s.gapMessage.trim().replace(/\s+/g, ' ').slice(0, 160)}`)
  }

  if (typeof s.topPriority === 'string' && s.topPriority.trim()) {
    const top = Array.isArray(r.priorities) ? r.priorities[0] : null
    const why = top?.reason ? `—— ${String(top.reason).replace(/\s+/g, ' ').slice(0, 100)}` : ''
    lines.push(`最高优先级：${s.topPriority.trim()}${why}`)
  }

  const checklist = Array.isArray(r.checklist) ? r.checklist : null
  if (checklist?.length && !totalDims) {
    lines.push(`产出 ${checklist.length} 条必测清单，供执行器展开成用例。`)
  }
  return lines
}

/** 接口/UI 执行类：通过率、失败数、耗时 */
function summarizeExecution(r: any): string[] {
  const lines: string[] = []
  const s = r.summary || r
  const total = num(s.total)
  const passed = num(s.passed)
  const failed = num(s.failed)
  const skipped = num(s.skipped)
  const duration = num(s.duration) || num(r.duration)

  if (total !== null) {
    const rate = passed !== null && total > 0 ? ((passed / total) * 100).toFixed(1) : null
    lines.push(`共执行 ${total} 个用例：通过 ${passed ?? '-'}，失败 ${failed ?? '-'}${skipped ? `，跳过 ${skipped}` : ''}${rate ? `，通过率 ${rate}%` : ''}。`)
  }
  if (duration) lines.push(`耗时 ${(duration / 1000).toFixed(1)} 秒。`)

  const failures = Array.isArray(r.testcases) ? r.testcases.filter((t: any) => t.status === 'failed') : []
  if (failures.length) {
    const names = failures.slice(0, 5).map((t: any) => t.name || t.id || '未命名用例').join('、')
    lines.push(`失败用例：${names}${failures.length > 5 ? ` 等 ${failures.length} 个` : ''}。`)
  }
  if (r.exitCode !== undefined && num(r.exitCode) !== 0 && !failed) {
    lines.push(`进程退出码 ${r.exitCode}，需检查执行日志。`)
  }
  return lines
}

/** 需求解析 / 策略设计 / 评估类：条数与覆盖 */
function summarizeAnalysis(r: any): string[] {
  const lines: string[] = []
  const arr = (k: string) => (Array.isArray(r[k]) ? r[k] : null)

  const modules = arr('modules')
  if (modules?.length) lines.push(`识别出 ${modules.length} 个功能模块。`)

  const fps = arr('functionalPoints') || arr('functionalRequirements')
  if (fps?.length) lines.push(`提取 ${fps.length} 条功能需求。`)

  const nfps = arr('nonFunctionalRequirements')
  if (nfps?.length) lines.push(`提取 ${nfps.length} 条非功能需求。`)

  const apis = arr('interfaces') || arr('apiRequirements')
  if (apis?.length) lines.push(`梳理 ${apis.length} 个接口。`)

  const ac = arr('acceptanceCriteria')
  if (ac?.length) lines.push(`整理 ${ac.length} 条验收标准。`)

  const edge = arr('edgeCases')
  if (edge?.length) lines.push(`补充 ${edge.length} 个边界场景。`)

  if (num(r.score) !== null) {
    lines.push(`评估得分 ${r.score}${r.grade ? `（等级 ${r.grade}）` : ''}。`)
  }
  if (num(r.capability?.score) !== null) lines.push(`能力层得分 ${r.capability.score}。`)
  if (num(r.quality?.score) !== null) lines.push(`质量层得分 ${r.quality.score}。`)
  if (num(r.business?.score) !== null) lines.push(`业务层得分 ${r.business.score}。`)
  return lines
}

/** 脱敏 / 数据生成类 */
function summarizeTransform(r: any): string[] {
  const lines: string[] = []
  const records = Array.isArray(r.records) ? r.records : null
  if (records?.length) lines.push(`处理 ${records.length} 条记录。`)

  const masked = num(r.maskedCount)
  if (masked !== null) lines.push(`脱敏字段 ${masked} 处。`)

  const fields = Array.isArray(r.maskedFields) ? r.maskedFields : null
  if (fields?.length) lines.push(`涉及字段：${fields.slice(0, 8).join('、')}${fields.length > 8 ? ' 等' : ''}。`)

  const count = num(r.count)
  if (count !== null) lines.push(`生成 ${count} 条测试数据。`)

  const text = r.maskedText || r.text
  if (typeof text === 'string' && text.trim() && !records?.length) {
    const preview = text.trim().replace(/\s+/g, ' ').slice(0, 80)
    lines.push(`处理结果预览：${preview}${text.length > 80 ? '…' : ''}。`)
  }
  return lines
}

/** 兜底：列出字段与关键数值，不贴 JSON */
function summarizeGeneric(r: any): string[] {
  const lines: string[] = []
  if (!r || typeof r !== 'object') {
    const text = String(r ?? '').trim()
    return text ? [text.slice(0, 160)] : []
  }

  if (r.success === false || r.error) {
    lines.push(`工具返回失败：${r.error || r.reason || '未知错误'}。`)
  }

  const scalars: string[] = []
  const arrays: string[] = []
  for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      if (v.length) arrays.push(`${k} ${v.length} 项`)
      continue
    }
    if (typeof v === 'object') continue
    if (typeof v === 'string' && v.length <= 60) scalars.push(`${k}=${v}`)
    else if (typeof v === 'number' || typeof v === 'boolean') scalars.push(`${k}=${v}`)
  }
  if (scalars.length) lines.push(`关键结果：${scalars.slice(0, 6).join('，')}。`)
  if (arrays.length) lines.push(`返回数据：${arrays.slice(0, 6).join('、')}。`)
  if (!lines.length) lines.push('工具已执行完成，返回的结构化结果已随交付物落盘。')
  return lines
}

/**
 * 把工具结果转成自然语言摘要
 *
 * @param {string} skillId - 工具/skill id
 * @param {any} rawResult - 工具返回的原始结果（通常是对象）
 * @param {Object} [options]
 * @param {number} [options.maxLines=6] - 最多几行
 * @returns {string} 中文自然语言摘要（多行）
 */
export function summarizeToolResult(skillId: string, rawResult: any, options: any = {}): string {
  const maxLines = Number(options.maxLines) || 6
  let r = rawResult

  // 后端把工具结果 JSON.stringify 后塞进 SSE，这里先解回对象；
  // 解不出来就当作纯文本处理（只截前 160 字，不贴花括号）。
  if (typeof r === 'string') {
    const text = r.trim()
    if (!text) return ''
    try {
      r = JSON.parse(text)
    } catch {
      return text.slice(0, 160)
    }
  }

  // 后端把工具结果包在 { skill, success, result } 或直接平铺，两种都兼容
  if (r && typeof r === 'object' && r.result !== undefined && typeof r.result === 'object') {
    r = r.result
  }
  if (r && typeof r === 'object' && typeof r.content === 'string' && Object.keys(r).length <= 3) {
    // 形如 { content: '...' } 的包一层
    r = r.content
    if (typeof r === 'string') return r.slice(0, 160)
  }

  // 工具名可能是下划线形式（backend 的 skillToolName 会把 9dem-executor
  // 变成 9dem_executor），统一成连字符再匹配下面的分支
  const id = String(skillId || '').replace(/_/g, '-')
  let lines: string[]

  if (/9dem-planner/.test(id)) lines = summarizeNineDemPlanner(r)
  else if (/9dem-executor/.test(id)) lines = summarizeNineDem(r)
  else if (/(executor|invoker)$/.test(id) && /(api|ui|mobile|desktop|browser|compat|jmeter|k6)/.test(id)) lines = summarizeExecution(r)
  else if (/(parser|designer|evaluation)/.test(id)) lines = summarizeAnalysis(r)
  else if (/(masking|data-generator|generator-skill)/.test(id)) lines = summarizeTransform(r)
  else lines = summarizeGeneric(r)

  if (!lines.length) lines = summarizeGeneric(r)
  return lines.slice(0, maxLines).join('\n')
}

/** 五维中文名 */
const DIMENSION_LABELS: Record<string, string> = {
  requirement: '需求一致性',
  factLogic: '事实与逻辑',
  security: '安全合规',
  format: '格式与可执行性',
  traceability: '跨环节承接',
}

/** 严重度中文名 */
const SEVERITY_LABELS: Record<string, string> = {
  blocker: '阻断',
  major: '主要',
  minor: '次要',
}

/**
 * 审核员输出（JSON）→ 自然语言
 *
 * 审核员返回的是结构化 JSON（score/veto/reason/dimensions/issues），
 * 过去前端把整段 JSON 用代码块贴在聊天面板，用户要自己找分数、数问题。
 * 这里转成中文句子：先给分数与结论，再给五维分，最后列出主要问题。
 *
 * @param {any} raw - 审核输出（JSON 字符串或对象）
 * @param {Object} [options]
 * @param {number} [options.maxIssues=5] - 最多列几条问题
 * @returns {string}
 */
export function summarizeReviewOutput(raw: any, options: any = {}): string {
  const maxIssues = Number(options.maxIssues) || 5
  let obj: any = null

  if (raw && typeof raw === 'object') {
    obj = raw
  } else if (typeof raw === 'string') {
    // 优先解析 ```json 代码块，再退回裸 JSON
    const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/i)
    const candidate: string = (fenced && fenced[1]) ? fenced[1] : raw
    try {
      obj = JSON.parse(candidate)
    } catch {
      try {
        obj = JSON.parse(candidate.replace(/[\u0000-\u001f]+/g, ' '))
      } catch {
        obj = null
      }
    }
  }

  // 解析不出来就原样返回（保留可读的纯文本审核意见）
  if (!obj || typeof obj !== 'object') {
    const text = String(raw || '').trim()
    return text ? text.slice(0, 800) : ''
  }

  const lines: string[] = []
  const score = num(obj.score)
  if (score !== null) {
    const level = score >= 90 ? '可直接投产' : score >= 80 ? '评分达标' : score >= 65 ? '存在明确缺陷但可用' : '需重做主体内容'
    lines.push(`综合评分 ${score} 分（${level}）${obj.veto ? '，且触发一票否决' : ''}。`)
  }

  if (obj.dimensions && typeof obj.dimensions === 'object') {
    const dims = Object.entries(DIMENSION_LABELS)
      .filter(([k]) => num(obj.dimensions[k]) !== null)
      .map(([k, label]) => `${label} ${obj.dimensions[k]}`)
    if (dims.length) lines.push(`五维评分：${dims.join('、')}。`)
  }

  if (obj.reason) lines.push(`审核结论：${String(obj.reason).slice(0, 300)}`)

  const issues = Array.isArray(obj.issues) ? obj.issues : []
  if (issues.length) {
    const bySeverity = { blocker: 0, major: 0, minor: 0 } as Record<string, number>
    for (const i of issues) {
      const sev = String(i?.severity || 'major')
      bySeverity[sev] = (bySeverity[sev] || 0) + 1
    }
    const parts = Object.entries(bySeverity)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${SEVERITY_LABELS[k] || k} ${v} 条`)
    lines.push(`列出问题 ${issues.length} 条（${parts.join('，')}）。`)

    const top = [...issues]
      .sort((a: any, b: any) => (a?.severity === 'blocker' ? -1 : 0) - (b?.severity === 'blocker' ? -1 : 0))
      .slice(0, maxIssues)
    // 单条控制在 120 字内：真实审核意见的描述常在 200 字以上，
    // 全量铺开会把一条聊天消息撑成十几行，反而更难扫读。完整描述在审核报告里。
    for (const i of top) {
      const where = i?.caseId ? `【${i.caseId}】` : ''
      const desc = String(i?.description || '').replace(/\s+/g, ' ').slice(0, 120)
      const fix = i?.suggestion ? ` → 建议：${String(i.suggestion).replace(/\s+/g, ' ').slice(0, 80)}` : ''
      lines.push(`· ${where}${desc}${fix}`)
    }
    if (issues.length > maxIssues) {
      lines.push(`· ……另有 ${issues.length - maxIssues} 条问题见审核报告`)
    }
  } else if (score !== null) {
    lines.push('未列出具体问题。')
  }

  return lines.join('\n')
}

/** 安全扫描报告：findings / severityDist → 漏洞与风险摘要 */
function summarizeSecurity(r: any): string[] {
  const lines: string[] = []
  const findings = Array.isArray(r.findings) ? r.findings : []
  const dist = r.severityDist || r.severity_dist || {}

  const score = num(r.securityScore) ?? num(r.security_score) ?? num(r.overallScore)
  if (score !== null) {
    const risk = r.riskLevel || r.risk_level
    lines.push(`安全评分 ${score} 分${risk && risk !== 'none' ? `，风险等级 ${risk}` : '，未发现风险项'}。`)
  }
  if (findings.length) {
    const bySev = ['critical', 'high', 'medium', 'low', 'info']
      .map((k) => [k, num(dist[k]) ?? 0] as const)
      .filter(([, v]) => v > 0)
    lines.push(
      `共发现 ${findings.length} 个问题${bySev.length ? `（${bySev.map(([k, v]) => `${k} ${v}`).join('、')}）` : ''}。`
    )
    const top = findings.slice(0, 5).map((f: any) => {
      const sev = f.severity ? `[${f.severity}] ` : ''
      return `${sev}${f.title || f.vulnType || '未命名问题'}`
    })
    lines.push(`主要问题：${top.join('；')}${findings.length > 5 ? ` 等 ${findings.length} 个` : ''}。`)
  } else if (score !== null) {
    lines.push('本次扫描未发现漏洞。')
  }
  if (typeof r.summary === 'string' && r.summary.trim()) {
    lines.push(`结论：${r.summary.trim().replace(/\s+/g, ' ').slice(0, 200)}`)
  }
  return lines
}

/**
 * 任务结果 → 自然语言
 *
 * 任务结果的正常形态是 Markdown 报告，原样展示即可；但安全扫描（security-sentinel）
 * 落库的是 JSON.stringify(securityReport)，某些兜底路径会把它直接当 output 塞进
 * 聊天面板，用户看到的就是一屏花括号。这里只在「确实是 JSON」时才转摘要，
 * Markdown 报告一律原样返回，不做任何改写。
 */
export function summarizeTaskOutput(raw: any): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw !== 'string') {
    if (typeof raw !== 'object') return String(raw)
    return summarizeJsonReport(raw)
  }
  const text = raw.trim()
  if (!text) return ''
  // 不以 { 或 [ 开头的一定不是整份 JSON（Markdown 报告、纯文本），原样返回
  if (!/^[[{]/.test(text)) return raw
  try {
    const obj = JSON.parse(text)
    if (!obj || typeof obj !== 'object') return raw
    return summarizeJsonReport(obj)
  } catch {
    return raw
  }
}

function summarizeJsonReport(obj: any): string {
  let lines: string[]
  if (Array.isArray(obj.findings) || obj.severityDist || obj.securityScore !== undefined) {
    lines = summarizeSecurity(obj)
  } else {
    lines = summarizeGeneric(obj)
  }
  return (lines.length ? lines : summarizeGeneric(obj)).slice(0, 8).join('\n')
}

/**
 * 工具调用参数 → 自然语言说明
 *
 * 过去直接把 arguments JSON 摊在 <pre> 里（9dem_executor 单次参数可达数 KB），
 * 用户看到的是一屏花括号。这里只描述「调了什么、带了多少入参、关键字段是什么」。
 *
 * @param {string} toolName - 工具名
 * @param {any} rawArgs - 原始参数（JSON 字符串或对象）
 * @returns {string}
 */
export function describeToolCall(toolName: string, rawArgs: any): string {
  const name = String(toolName || '工具')
  const label = skillLabel(name)

  let args: any = rawArgs
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      // 参数不是合法 JSON（模型半途被截断）：只报长度，不贴原文
      const len = String(rawArgs).length
      return `正在调用「${label}」，已提交约 ${len} 字符参数。`
    }
  }
  if (!args || typeof args !== 'object') {
    return `正在调用「${label}」。`
  }

  const parts: string[] = []
  const dims = Array.isArray(args.dimensions) ? args.dimensions : null
  if (dims?.length) parts.push(`计算 ${dims.length} 个维度（${dims.join('、')}）`)

  const methods = Array.isArray(args.methods) ? args.methods : null
  if (methods?.length) parts.push(`启用 ${methods.length} 种设计方法`)

  const fields = args.fields || (args.inputSpec ? Object.keys(args.inputSpec) : null)
  if (fields) {
    const list = Array.isArray(fields) ? fields : Object.keys(fields)
    if (list.length) parts.push(`输入字段 ${list.length} 个（${list.slice(0, 4).join('、')}${list.length > 4 ? ' 等' : ''}）`)
  }

  const di = args.designInput
  if (di && typeof di === 'object') {
    const keys: string[] = []
    if (Array.isArray(di.rules) && di.rules.length) keys.push(`判定规则 ${di.rules.length} 条`)
    if (di.factors && typeof di.factors === 'object') keys.push(`正交因子 ${Object.keys(di.factors).length} 个`)
    if (Array.isArray(di.scenarios) && di.scenarios.length) keys.push(`业务场景 ${di.scenarios.length} 个`)
    if (Array.isArray(di.states?.transitions) && di.states.transitions.length) keys.push(`状态迁移 ${di.states.transitions.length} 条`)
    if (Array.isArray(di.functions) && di.functions.length) keys.push(`功能节点 ${di.functions.length} 个`)
    if (keys.length) parts.push(keys.join('、'))
  }

  if (args.task) parts.push('已提供需求描述')

  const baseUrl = args.baseUrl || args.url
  if (baseUrl) parts.push(`目标地址 ${String(baseUrl).slice(0, 60)}`)
  const cases = Array.isArray(args.cases) ? args.cases : null
  if (cases?.length) parts.push(`${cases.length} 个测试场景`)
  const steps = Array.isArray(args.steps) ? args.steps : null
  if (steps?.length) parts.push(`${steps.length} 个操作步骤`)

  const count = num(args.count)
  if (count !== null) parts.push(`生成 ${count} 条`)
  if (args.text) parts.push(`处理文本约 ${String(args.text).length} 字符`)
  if (args.filePath) parts.push(`处理文件 ${String(args.filePath).split('/').pop()}`)

  if (!parts.length) {
    const keys = Object.keys(args).filter((k) => args[k] !== undefined && args[k] !== null)
    return `正在调用「${label}」（入参 ${keys.length} 项：${keys.slice(0, 5).join('、')}${keys.length > 5 ? ' 等' : ''}）。`
  }
  return `正在调用「${label}」：${parts.join('；')}。`
}

export default { summarizeToolResult, summarizeReviewOutput, describeToolCall, skillLabel, summarizeTaskOutput }
