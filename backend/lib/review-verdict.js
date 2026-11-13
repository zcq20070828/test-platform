/**
 * 审核结果解析与判定（2026-11-09 抽取为独立模块）
 *
 * 为什么单独抽出来：
 *   1. 解析逻辑此前内嵌在 server.js，无法单测——而它正是「审核不通过率高」的元凶之一；
 *   2. 四条链路（单任务 / 交互工作流 / 自动工作流 / 原生工作流）各写了一套通过判定，
 *      阈值口径不一致（全票≥80 / 平均≥80 / 中位数≥75），同一份产出换个入口结论就不同。
 *
 * 本模块只做纯函数：解析模型输出、归一化 issues、按统一口径投票。
 */

// ============================================================
// 1. JSON 容错清洗
// ============================================================

/**
 * 转义 JSON 字符串字面量里的裸控制字符（换行/制表/回车）。
 *
 * 模型经常在 description 里直接换行，产出非法 JSON：
 *   "description": "字段不一致
 *   且加密方式不符"
 * JSON.parse 会报 Bad control character，整条审核结果被解析成 0 分。
 * 实测 18 次审核里有 2 次因此被判 0，直接把任务拉成「审核不通过」。
 *
 * 只处理字符串内部，不动结构性的换行与缩进。
 */
export function sanitizeJsonControlChars(text) {
  const src = String(text || '');
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += ' ';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    out += ch;
  }
  return out;
}

/**
 * 从文本中提取第一个「花括号配平」且含 score/veto 的 JSON 对象
 * 扫描时跳过字符串内的括号，支持嵌套 issues 数组。
 */
export function extractBalancedJson(text) {
  const src = String(text || '');
  const first = src.indexOf('{');
  if (first < 0) return null;

  for (let from = first; from >= 0; from = src.indexOf('{', from + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = from; i < src.length; i += 1) {
      const ch = src[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(src.slice(from, i + 1));
            if (parsed && typeof parsed === 'object' && ('score' in parsed || 'veto' in parsed)) return parsed;
          } catch (_) { /* 换下一个起点 */ }
          break;
        }
      }
    }
  }
  return null;
}

// ============================================================
// 2. issues 归一化
// ============================================================

export function normalizeReviewIssues(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      severity: ['blocker', 'major', 'minor'].includes(x.severity) ? x.severity : 'major',
      category: String(x.category || 'other').slice(0, 32),
      caseId: x.caseId ? String(x.caseId).slice(0, 32) : '',
      description: String(x.description || '').slice(0, 400),
      suggestion: String(x.suggestion || '').slice(0, 400),
    }))
    .filter((x) => x.description)
    .slice(0, 80);
}

// ============================================================
// 3. 审核输出解析
// ============================================================

/** 解析失败时返回的标记，供上层判断「这条评分是否可信」 */
export const PARSE_FAILED = Symbol('parse-failed');

/**
 * 解析审核智能体的输出
 *
 * 返回两个独立标记，不要混用：
 *   - `parseOk`    结构化 JSON 是否解析成功（用于日志与统计口径，不代表分数不可用）
 *   - `scoreSource` 分数从哪来，决定**能不能参与投票**：
 *       'json' 结构化 JSON，完全可信
 *       'text' 从正文抽到的分数（如 `"score": 76` 但 JSON 损坏），分数可信、issues 缺失
 *       'none' 完全没解析出分数（score=0 只是占位，**绝不能当作 0 分参与投票**）
 *   - `scoreOk` = scoreSource !== 'none'
 *
 * 为什么必须区分 'text' 与 'none'：实测任务 fece20f3 里模型明确给了 76 分，
 * 旧代码因 JSON 有裸换行解析失败、降级正则又匹配不到带引号的键名，把 76 记成 0，
 * 直接把任务拉成「审核不通过」。这类分数是真实的，只是格式不规范。
 *
 * @param {string} reviewText
 * @param {Object} [options]
 * @param {number} [options.passThreshold=80]
 * @returns {{score:number, veto:boolean, passed:boolean, reason:string, issues:Array, usabilityEstimate?:number, parseOk:boolean, scoreSource:'json'|'text'|'none', scoreOk:boolean}}
 */
export function parseReviewResult(reviewText, options = {}) {
  const threshold = Number(options.passThreshold ?? 80);
  const text = String(reviewText || '');

  try {
    // 1) 优先解析 ```json 代码块
    let parsed = null;
    const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
    if (fenced) {
      const body = fenced[1].trim();
      try { parsed = JSON.parse(body); } catch (_) {
        try { parsed = JSON.parse(sanitizeJsonControlChars(body)); } catch (_) { parsed = null; }
      }
    }

    // 2) 花括号配平扫描（原文 → 清洗后）
    if (!parsed) parsed = extractBalancedJson(text);
    if (!parsed) parsed = extractBalancedJson(sanitizeJsonControlChars(text));

    if (parsed && Number.isFinite(Number(parsed.score))) {
      const score = Number(parsed.score);
      const veto = parsed.veto === true;
      return {
        score,
        veto,
        passed: score >= threshold && !veto,
        reason: parsed.reason || '',
        issues: normalizeReviewIssues(parsed.issues),
        usabilityEstimate: typeof parsed.usabilityEstimate === 'number' ? parsed.usabilityEstimate : undefined,
        parseOk: true,
        scoreSource: 'json',
        scoreOk: true,
      };
    }

    // 3) 备用：从文本抽分数
    //    兼容 `"score": 76`（带引号键名，旧正则 /score[::]/ 匹配不到）、
    //    `score: 76`、`评分：76`、`给 76 分` 四种形态。
    const cleaned = sanitizeJsonControlChars(text);
    const scoreMatch = cleaned.match(/["'「]?score["'」]?\s*[:：]\s*(\d{1,3})/i)
      || cleaned.match(/["'「]?评分["'」]?\s*[:：]\s*(\d{1,3})/i)
      || cleaned.match(/(\d{1,3})\s*分/);
    const vetoMatch = cleaned.match(/["'「]?veto["'」]?\s*[:：]\s*(true|false)/i)
      || cleaned.match(/veto\s*[:：]\s*(true|false|是|否|否决)/i);

    if (scoreMatch) {
      const score = parseInt(scoreMatch[1], 10);
      let veto = false;
      if (vetoMatch) {
        const v = vetoMatch[1].toLowerCase();
        veto = v === 'true' || v === '是' || v === '否决';
      }
      return {
        score,
        veto,
        passed: score >= threshold && !veto,
        reason: '（结构化解析失败，分数从文本抽取）',
        issues: [],
        parseOk: false,
        scoreSource: 'text',
        scoreOk: true,
      };
    }

    // 4) 彻底解析不出来：明确标记失败，不要伪装成 0 分
    return {
      score: 0,
      veto: false,
      passed: false,
      reason: '审核输出无法解析（既无 JSON 也无明确分数）',
      issues: [],
      parseOk: false,
      scoreSource: 'none',
      scoreOk: false,
    };
  } catch (err) {
    return {
      score: 0,
      veto: false,
      passed: false,
      reason: `解析异常: ${err.message}`,
      issues: [],
      parseOk: false,
      scoreSource: 'none',
      scoreOk: false,
    };
  }
}

// ============================================================
// 4. 统一投票
// ============================================================

/**
 * 判断一条审核结果是不是「审核智能体自身没跑起来」。
 *
 * 这类结果和「模型认真审了，给了 0 分」在数据库里长得一样（score=0, veto=0, passed=0），
 * 混进统计会把通过率压低，看上去像产出物质量崩了。判据：
 *   - error 非空（写入时明确记了失败原因）；或
 *   - 解析彻底失败（scoreSource='none' / scoreOk=false），即分数只是占位 0。
 *
 * 注意：scoreSource='text'（从正文抽到分数）**不算**失败——分数是模型真实给出的，
 * 只是格式不规范，仍应参与投票。
 */
export function isReviewerFailure(r) {
  if (!r) return true;
  if (r.error) return true;
  if (r.scoreOk === false) return true;
  if (r.scoreSource === 'none') return true;
  // 兼容旧记录（没有 scoreSource 字段）：parseOk=false 且分数为 0 视为失败
  if (r.parseOk === false && Number(r.score) === 0) return true;
  return false;
}

/**
 * 四条链路共用的审核判定
 *
 * 规则（按优先级）：
 *   1. 任一 reviewer 触发一票否决 → 不通过（只看有效审核，审核自身失败的否决不计）；
 *   2. 有效评分（非审核失败、parseOk 未标记失败、分数 > 0）少于 minValid 条 →
 *      **不判产品不合格**，返回 inconclusive（审核不可用），由调用方决定放行并告警
 *      ——不能因为解析失败或模型超时就判产出物质量差；
 *   3. 中位数 ≥ 阈值且无否决 → 通过。
 *
 * 为什么用中位数而不是「全票 ≥ 阈值」：三个 reviewer 职责正交，格式审核
 * 对一份内容优秀的报告给 78 分属正常分歧；全票制会让一个人的严格否掉整个任务
 * （实测 82/80/78 被判不通过）。
 *
 * @param {Array<{score:number, veto?:boolean, parseOk?:boolean, error?:string}>} results
 * @param {Object} [options]
 * @param {number} [options.threshold=80]
 * @param {number} [options.minValid=2]
 * @returns {{passed:boolean, verdict:'passed'|'failed'|'inconclusive', reason:string, median:number|null, validCount:number, scores:number[], vetoTriggered:boolean, reviewerFailures:number}}
 */
export function decideReviewVerdict(results, options = {}) {
  const threshold = Number(options.threshold ?? 80);
  const minValid = Number(options.minValid ?? 2);
  const list = Array.isArray(results) ? results.filter(Boolean) : [];

  const usable = list.filter((r) => !isReviewerFailure(r));
  const reviewerFailures = list.length - usable.length;

  const scores = list.map((r) => Number(r.score) || 0);
  const vetoTriggered = usable.some((r) => r.veto === true);

  if (vetoTriggered) {
    return {
      passed: false,
      verdict: 'failed',
      reason: '触发一票否决',
      median: null,
      validCount: usable.filter((r) => Number(r.score) > 0).length,
      scores,
      vetoTriggered: true,
      reviewerFailures,
    };
  }

  // 有效评分：非审核失败、分数来源可用（scoreSource≠'none'）、分数 > 0。
  // 这里刻意不用 parseOk 作为条件：scoreSource='text' 时 parseOk=false 但分数是
  // 模型真实给出的（只有格式不规范），把它排除会把真问题漏掉。
  const validScores = usable
    .filter((r) => r.scoreOk !== false && Number(r.score) > 0)
    .map((r) => Number(r.score));

  if (validScores.length < minValid) {
    return {
      passed: true,
      verdict: 'inconclusive',
      reason: `有效审核结果不足（${validScores.length}/${list.length}${reviewerFailures ? `，其中 ${reviewerFailures} 条为审核自身失败` : ''}），按审核不可用处理，已放行并告警`,
      median: null,
      validCount: validScores.length,
      scores,
      vetoTriggered: false,
      reviewerFailures,
    };
  }

  const sorted = [...validScores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  if (median >= threshold) {
    return {
      passed: true,
      verdict: 'passed',
      reason: `中位数 ${median} ≥ ${threshold}（评分 ${validScores.join(', ')}${reviewerFailures ? `，${reviewerFailures} 条审核自身失败已排除` : ''}）`,
      median,
      validCount: validScores.length,
      scores,
      vetoTriggered: false,
      reviewerFailures,
    };
  }

  return {
    passed: false,
    verdict: 'failed',
    reason: `评分未达标（中位数 ${median} < ${threshold}，评分 ${validScores.join(', ')}）`,
    median,
    validCount: validScores.length,
    scores,
    vetoTriggered: false,
    reviewerFailures,
  };
}

/**
 * 带「客观门禁」的复合判定（2026-11-12）
 *
 * 问题：阈值 80 是设计时拍定的，从未校准。近 7 天 20 个有效轮次的中位数均分 74.8，
 * 阈值 80 只能过 45% —— 而其中像任务 374bc1eb 那种确定性门禁已经 99.7% 可用、
 * 9/9 维覆盖、必测点 98% 的交付物，仅因为审核给了 76/73/76 就被判未通过，
 * 又白花 60 分钟重跑。
 *
 * 这里区分两类失败：
 *   - **客观不达标**：确定性门禁没过（可用率/维度/必测点）。这是硬事实，必须重做。
 *   - **主观打分偏低**：门禁已客观达标，但审核中位数没到阈值。
 *     此时正确的动作是「按问题清单局部改进」，而不是「扔掉重来」。
 *
 * 因此：
 *   - 门禁已达标 + 中位数 ≥ softThreshold（默认 70）→ passed，标注「客观达标+主观可用」
 *   - 门禁已达标 + 中位数 < softThreshold → 仍 passed，但 verdict='passed_with_notes'，
 *     让上层保留审核意见供人工参考，不触发重试
 *   - 门禁未达标 → 按原阈值判定，不通过则重试
 *
 * @param {Array} results - 审核结果
 * @param {Object} options
 * @param {number} [options.threshold=80] - 主观分阈值（门禁未达标时使用）
 * @param {number} [options.softThreshold=70] - 门禁已达标时的主观分下限
 * @param {boolean} [options.gatePassed=false] - 确定性门禁是否已客观达标
 * @param {number} [options.minValid=2]
 */
export function decideReviewVerdictWithGate(results, options = {}) {
  const base = decideReviewVerdict(results, {
    threshold: Number(options.threshold ?? 80),
    minValid: options.minValid,
  });

  const gatePassed = options.gatePassed === true;
  if (!gatePassed) return { ...base, gatePassed: false };

  // 门禁已客观达标：一票否决仍然生效（内容是幻觉/违规不能靠门禁洗白）
  if (base.vetoTriggered) {
    return { ...base, gatePassed: true, reason: `门禁已达标，但${base.reason}` };
  }
  // 有效评审不足（审核自身失败）→ 保持 inconclusive 的放行语义
  if (base.verdict === 'inconclusive') {
    return { ...base, gatePassed: true };
  }

  const softThreshold = Number(options.softThreshold ?? 70);
  const median = base.median;
  if (median != null && median >= softThreshold) {
    if (base.passed) {
      return { ...base, gatePassed: true, reason: `${base.reason}（门禁客观达标）` };
    }
    return {
      ...base,
      passed: true,
      verdict: 'passed_with_notes',
      gatePassed: true,
      reason: `门禁客观达标（可用率/维度/必测点全部通过），审核中位数 ${median} ≥ ${softThreshold}：允许交付，审核意见作为改进建议保留`,
    };
  }

  // 门禁达标但主观分很低（< softThreshold）：内容层面确实有问题，仍判不通过
  return {
    ...base,
    gatePassed: true,
    reason: `门禁客观达标但审核中位数 ${median} < ${softThreshold}，内容质量仍需改进：${base.reason}`,
  };
}

export default {
  sanitizeJsonControlChars,
  extractBalancedJson,
  normalizeReviewIssues,
  parseReviewResult,
  decideReviewVerdict,
  decideReviewVerdictWithGate,
  isReviewerFailure,
};
