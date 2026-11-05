/**
 * 测试用例交付物「确定性质量门禁」（2026-11-05）
 *
 * 背景：实测一份 136 条用例的交付物，42% 的预期结果无法判定对错（「被接受」「正常处理」
 * 这类描述），13% 的输入是占位值（`phone="AAAAAAAAAAA"`、`password=33位字符`），
 * 但三审给了 82/85/78 分放行——因为审核只能看形式，看不出「结论不可验证」。
 *
 * 这里的 6 项检查全部是规则可判定的，不调用 LLM：
 *   结果可复现、可审计、零 token 成本，作为**硬伤闸门**挡在审核之前。
 *
 * 注意：本模块只做判定与可自动修复的替换，**不编造**预期结果——
 * 缺断言的一律标 needsAssertion 交给模型定向补。
 */

// ============================================================
// 1. 断言识别：预期结果是否可判定
// ============================================================

/** 强断言：出现任一即认为「可判定」 */
const ASSERTION_PATTERNS = [
  { type: 'status', re: /\b(?:HTTP\s*)?[1-5]\d{2}\b/ },                       // 200 / 401 / HTTP 500
  { type: 'status', re: /状态码|返回码|错误码|业务码|响应码/ },
  { type: 'field', re: /字段|响应体|返回值|token|JWT|traceId|data\.|\bjson\b/i },
  // 注意：不能用 \b 收尾——JS 的 \b 基于 ASCII，中文字符后不成立
  { type: 'numeric', re: /\d+\s*(?:次|条|个|分钟|秒|小时|ms|元|%|QPS|TPS)(?![\d])/ }, // 5 次 / 30 分钟
  { type: 'numeric', re: /(?:等于|等于为|>=|<=|≥|≤|大于|小于|超过|不超过)\s*\d/ },
  { type: 'redirect', re: /跳转|重定向|返回首页|回到登录页|刷新页面/ },
  { type: 'ui', re: /提示[「"']|弹窗|toast|蒙层|按钮|文案[「"']|显示[「"']|置灰|不可点击/i },
  { type: 'db', re: /数据库|落库|写入|记录数|计数|状态变为|状态更新为/ },
  // 负向结果：拒绝/拦截/报错本身就是可观测的（能判断「有没有被挡住」）
  { type: 'reject', re: /拒绝|拦截|阻断|不允许|禁止|不通过|报错|失败并|抛出|无法(?:登录|提交|进入)/ },
];

/** 弱描述：只描述「通过/正常」而没有可观测证据 */
const WEAK_PATTERNS = [
  /^(?:功能)?(?:正常|正确|成功)(?:处理|返回|执行)?[。.]?$/,
  /(?:被)?(?:接受|认可)(?:，|,)?(?:进入|继续)/,
  /校验通过[。.]?$/,
  /(?:可)?正常(?:登录|提交|处理|返回|显示)[。.]?$/,
  /符合预期[。.]?$/,
  /无异常[。.]?$/,
  /按预期(?:执行|返回|处理)[。.]?$/,
];

/**
 * 判定预期结果是否可验证
 * @param {string} expected
 * @returns {{ verifiable: boolean, assertionType: string|null, reason: string }}
 */
export function inspectAssertion(expected) {
  const text = String(expected || '').trim();
  if (!text) return { verifiable: false, assertionType: null, reason: '预期结果为空' };

  for (const p of ASSERTION_PATTERNS) {
    if (p.re.test(text)) return { verifiable: true, assertionType: p.type, reason: '' };
  }
  for (const w of WEAK_PATTERNS) {
    if (w.test(text)) return { verifiable: false, assertionType: null, reason: '仅描述「正常/通过」，无可观测证据' };
  }
  // 兜底：长度 >= 12 且含具体名词（引号内容、括号内枚举）也视为可判定
  if (text.length >= 12 && /[「"'（(]/.test(text)) {
    return { verifiable: true, assertionType: 'text', reason: '' };
  }
  return { verifiable: false, assertionType: null, reason: '未命中任何可验证断言模式' };
}

// ============================================================
// 2. 占位输入识别与修复
// ============================================================

/** 占位值模式 */
const PLACEHOLDER_PATTERNS = [
  { re: /"{2,}|'{2,}/, tag: 'emptyQuotes' },
  { re: /A{4,}/, tag: 'repeatedA' },
  { re: /__ILLEGAL__|ILLEGAL_VALUE|INVALID_VALUE/, tag: 'illegalToken' },
  { re: /\d+\s*位(?:字符|数字|号码)|（\d+位）|\(\d+位\)/, tag: 'lengthWords' },
  { re: /^(?:xxx+|XXX+|abc123|test123|test123456|123456789)$/i, tag: 'dummyToken' },
  { re: /\.{4,}|…{2,}/, tag: 'ellipsis' },
];

/** 常见字段语义 → 真实示例值（用于自动修复） */
const FIELD_EXAMPLES = [
  { match: /手机|phone|mobile|msisdn/i, type: 'string', value: '13800138000', illegal: '12345' },
  { match: /邮箱|email|mail/i, type: 'string', value: 'tester@example.com', illegal: 'not-an-email' },
  { match: /密码|password|passwd|pwd/i, type: 'string', value: 'Abc12345', illegal: '123' },
  { match: /验证码|smscode|captcha|otp/i, type: 'string', value: '123456', illegal: '12' },
  { match: /身份证|idcard|id_no/i, type: 'string', value: '110101199001011234', illegal: '123' },
  { match: /用户名|username|account|loginname/i, type: 'string', value: 'tester01', illegal: '' },
  { match: /姓名|name|nickname/i, type: 'string', value: '张三', illegal: '' },
  { match: /订单号|order(?:no|id)/i, type: 'string', value: 'ORD202611050001', illegal: '' },
  { match: /金额|amount|price|money/i, type: 'number', value: '100.00', illegal: '-1' },
  { match: /数量|count|qty|num/i, type: 'number', value: '1', illegal: '-1' },
  { match: /年龄|age/i, type: 'number', value: '30', illegal: '0' },
  { match: /平台|platform|channel|渠道/i, type: 'enum', value: 'app', illegal: 'wap' },
  { match: /状态|status/i, type: 'enum', value: 'active', illegal: 'unknown' },
  { match: /token|jwt|access_?token/i, type: 'string', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y', illegal: 'invalid' },
];

function fieldExample(fieldName, wantIllegal = false) {
  for (const f of FIELD_EXAMPLES) {
    if (f.match.test(fieldName)) return wantIllegal ? f.illegal : f.value;
  }
  return wantIllegal ? 'INVALID@#' : 'test_value';
}

/** 生成指定长度的可读字符串（避免全是 A） */
function readableString(len) {
  const base = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += base[i % base.length];
  return out;
}

/**
 * 识别并修复单条输入表达式里的占位值
 *
 * 支持形如 `phone="AAAAAAAAAAA"`、`password=33位字符`、`channel=__ILLEGAL__`、
 * 逗号分隔的多字段 `phone=10位数字, password=123`
 *
 * @param {string} input
 * @returns {{ input: string, repaired: boolean, repairs: Array<{field:string,from:string,to:string}> }}
 */
export function repairPlaceholderInput(input) {
  const original = String(input || '');
  if (!original.trim()) return { input: original, repaired: false, repairs: [] };

  const repairs = [];

  // 按逗号/分号切分字段片段（保留分隔符以便还原）
  const parts = original.split(/([,;，；])/);
  const out = parts.map((part) => {
    if (/^[,;，；]$/.test(part)) return part;
    const m = part.match(/^\s*([A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5.]*)\s*=\s*(.+?)\s*$/);
    if (!m) return part;
    const field = m[1];
    const rawValue = m[2];

    const placeholder = PLACEHOLDER_PATTERNS.find((p) => p.re.test(rawValue));
    if (!placeholder) return part;

    const wantIllegal = placeholder.tag === 'illegalToken';
    let replacement;

    if (placeholder.tag === 'lengthWords') {
      // `33位字符` / `10位数字`：按字段语义给真实值；若是长度边界场景，按位数生成长度正确的串
      const lenMatch = rawValue.match(/(\d+)\s*位/);
      const len = lenMatch ? Number(lenMatch[1]) : 0;
      const semantic = fieldExample(field, wantIllegal);
      const looksBoundary = /边界|min|max|超长|过短/i.test(part);
      if (looksBoundary && len > 0) {
        replacement = len <= 11 ? readableString(len) : `"${readableString(Math.min(len, 64))}"`;
      } else {
        replacement = /^\d+$/.test(semantic) ? semantic : `"${semantic}"`;
      }
    } else if (placeholder.tag === 'repeatedA' || placeholder.tag === 'emptyQuotes') {
      const inner = rawValue.replace(/^"|"$/g, '');
      const len = Math.max(inner.length, 1);
      const semantic = fieldExample(field, wantIllegal);
      const semanticKnown = FIELD_EXAMPLES.some((f) => f.match.test(field));
      if (semanticKnown && !wantIllegal) {
        replacement = /^-?\d+(\.\d+)?$/.test(semantic) ? semantic : `"${semantic}"`;
      } else if (semanticKnown && wantIllegal) {
        replacement = `"${semantic}"`;
      } else {
        // 无字段语义可依时，按原长度生成非重复字符，保证长度边界仍然有效
        replacement = `"${readableString(len)}"`;
      }
    } else {
      const semantic = fieldExample(field, wantIllegal);
      replacement = /^-?\d+(\.\d+)?$/.test(semantic) ? semantic : `"${semantic}"`;
    }

    repairs.push({ field, from: rawValue, to: replacement });
    return part.replace(rawValue, replacement);
  });

  return {
    input: out.join(''),
    repaired: repairs.length > 0,
    repairs,
  };
}

// ============================================================
// 3. 用例表格解析
// ============================================================

const COLUMN_ALIASES = {
  id: ['用例编号', '编号', '用例ID', 'ID', 'caseid'],
  module: ['所属模块', '模块', '功能模块'],
  name: ['用例名称', '名称', '标题', '用例标题', '用例'],
  dimension: ['维度', '维度/方法', '覆盖维度'],
  layer: ['层级', '用例层级'],
  precondition: ['前置条件', '预置条件'],
  input: ['输入数据', '测试数据', '输入', '数据'],
  steps: ['执行步骤', '测试步骤', '操作步骤', '步骤'],
  expected: ['预期结果', '期望结果', '预期'],
  priority: ['优先级', '级别'],
  requirement: ['关联需求', '需求编号', '需求', '追溯需求'],
};

function mapHeader(cells) {
  const idx = {};
  const used = new Set();

  // 第一轮：精确匹配（避免「用例编号」被 name 的别名「用例」抢先命中）
  cells.forEach((c, i) => {
    const v = String(c || '').trim();
    if (!v || used.has(i)) return;
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (idx[key] !== undefined) continue;
      if (aliases.some((a) => v === a)) {
        idx[key] = i;
        used.add(i);
        break;
      }
    }
  });

  // 第二轮：包含匹配（跳过已占用列）
  cells.forEach((c, i) => {
    const v = String(c || '').trim();
    if (!v || used.has(i)) return;
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (idx[key] !== undefined) continue;
      if (aliases.some((a) => v.includes(a))) {
        idx[key] = i;
        used.add(i);
        break;
      }
    }
  });

  return idx;
}

/**
 * 从 Markdown 文本中解析用例表
 * @param {string} text
 * @returns {{ cases: Array<object>, headerFound: boolean, headerMap: object }}
 */
export function parseCaseTable(text) {
  const lines = String(text || '').split(/\r?\n/);
  const cases = [];
  let firstHeaderMap = null;
  const tables = [];

  // 先按「连续表格块」切分：一份交付物里可能有多张表（用例清单、覆盖分析、矩阵…），
  // 只有表头是用例表头的块才解析，否则会把覆盖分析的 FR-xxx 行误当成用例。
  let block = null;
  const flush = () => {
    if (block && block.length) tables.push(block);
    block = null;
  };

  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!block) block = [];
      block.push(line);
    } else {
      flush();
    }
  }
  flush();

  for (const table of tables) {
    const headerCells = table[0].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const map = mapHeader(headerCells);
    // 必须同时具备「用例编号」和「预期结果」两列，才算用例表
    if (map.id === undefined || map.expected === undefined) continue;
    if (!firstHeaderMap) firstHeaderMap = map;

    for (let li = 1; li < table.length; li += 1) {
      const cells = table[li].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      // 分隔行
      if (/^[-:\s|]+$/.test(cells.join(''))) continue;
      const get = (key) => (map[key] !== undefined ? (cells[map[key]] || '') : '');
      const id = get('id');
      if (!id || !/^[A-Za-z]{0,6}-?\d+$/.test(id)) continue;

      cases.push({
        id,
        module: get('module'),
        name: get('name'),
        dimension: get('dimension'),
        layer: get('layer'),
        precondition: get('precondition'),
        input: get('input'),
        steps: get('steps').replace(/<br\s*\/?>/gi, ' '),
        expected: get('expected'),
        priority: get('priority'),
        requirement: get('requirement'),
      });
    }
  }

  return { cases, headerFound: !!firstHeaderMap, headerMap: firstHeaderMap || {}, tableCount: tables.length };
}

// ============================================================
// 4. 逐条检查
// ============================================================

/** 步骤是否含可执行动词 */
const ACTION_VERB_RE = /(输入|填写|点击|提交|上传|选择|打开|访问|请求|调用|等待|切换|刷新|删除|修改|新增|查询|登录|退出|关闭|开启|滑动|拖拽|扫码|确认|取消|发送|校验|验证|触发|观察|执行|模拟|重置|查看|发起|轮询|中断|恢复|重连|并发|重复)/;

/**
 * 单条用例检查
 * @param {object} c - parseCaseTable 的条目
 * @param {object} ctx - { requirementIds: Set<string>, seenKeys: Map }
 * @returns {{ id:string, usable:boolean, reasons:string[], detail:string, repairs:Array }}
 */
export function inspectCase(c, ctx = {}) {
  const reasons = [];
  const details = [];
  let repairs = [];

  // 1) 必填完整性
  const required = ['name', 'steps', 'expected'];
  const missing = required.filter((k) => !String(c[k] || '').trim());
  if (missing.length) {
    reasons.push('missingField');
    details.push(`缺少 ${missing.join('/')}`);
  }

  // 2) 断言可判定性
  const assertion = inspectAssertion(c.expected);
  if (!assertion.verifiable) {
    reasons.push('weakAssertion');
    details.push(assertion.reason);
  }

  // 3) 输入真实性
  if (String(c.input || '').trim()) {
    const rep = repairPlaceholderInput(c.input);
    if (rep.repaired) {
      const stillPlaceholder = PLACEHOLDER_PATTERNS.some((p) => p.re.test(rep.input));
      if (stillPlaceholder) {
        reasons.push('placeholderInput');
        details.push('输入含占位值且无法自动修复');
      } else {
        // 能自动修复 → 不计入不可用，但记录修复动作
        repairs = rep.repairs;
        details.push(`已自动修复输入占位: ${rep.repairs.map((r) => `${r.field}: ${r.from} → ${r.to}`).join('; ')}`);
      }
    }
  } else if (!String(c.precondition || '').trim()) {
    // 输入与前置都空 → 无法执行
    reasons.push('missingField');
    details.push('输入与前置条件均为空');
  }

  // 4) 步骤可执行性
  const steps = String(c.steps || '');
  if (steps) {
    const hasOrder = /(?:^|\s)\d+[.、)]|<br/i.test(steps);
    const hasVerb = ACTION_VERB_RE.test(steps);
    if (!hasOrder && !hasVerb) {
      reasons.push('badSteps');
      details.push('步骤无序号且无可执行动作动词');
    } else if (!hasVerb) {
      reasons.push('badSteps');
      details.push('步骤中没有可执行动作');
    }
  }

  // 5) 需求可达性
  const req = String(c.requirement || '').trim();
  if (ctx.requirementIds && ctx.requirementIds.size > 0 && req) {
    const ids = req.split(/[\/,，、;；\s]+/).filter(Boolean);
    const orphan = ids.filter((x) => !ctx.requirementIds.has(x.toUpperCase()));
    if (orphan.length) {
      reasons.push('orphanRequirement');
      details.push(`关联需求不存在: ${orphan.join(',')}`);
    }
  }

  // 6) 重复检测
  if (ctx.seenKeys) {
    const key = [c.module, c.name, c.input, c.expected].map((x) => String(x || '').replace(/\s+/g, '').toLowerCase()).join('|');
    if (ctx.seenKeys.has(key)) {
      reasons.push('duplicate');
      details.push(`与 ${ctx.seenKeys.get(key)} 重复`);
    } else {
      ctx.seenKeys.set(key, c.id);
    }
  }

  // 严重度：结构/占位/重复属硬伤，弱断言属主要问题
  const blockerReasons = new Set(['missingField', 'placeholderInput', 'duplicate', 'orphanRequirement']);
  const severity = reasons.some((r) => blockerReasons.has(r)) ? 'blocker'
    : reasons.length ? 'major' : 'none';

  return {
    id: c.id,
    usable: reasons.length === 0,
    reasons,
    detail: details.join('；'),
    severity,
    repairs,
    assertionType: assertion.assertionType,
  };
}

// ============================================================
// 5. 整体门禁
// ============================================================

/**
 * 对交付物做确定性质量检查
 *
 * @param {string} text - 交付物 Markdown
 * @param {Object} [options]
 * @param {string} [options.originalInput] - 原始任务输入（用于提取需求编号集合）
 * @param {number} [options.minUsabilityRate=0.85]
 * @returns {Object}
 */
export function checkDeliverable(text, options = {}) {
  const minRate = Number(options.minUsabilityRate ?? 0.85);
  const original = String(options.originalInput || '');

  // 从原始需求里提取需求编号（FR-001 / NFR-002 / API-001）
  const requirementIds = new Set();
  for (const m of original.matchAll(/\b((?:FR|NFR|API)-\d{1,4})\b/gi)) {
    requirementIds.add(m[1].toUpperCase());
  }

  const { cases, headerFound } = parseCaseTable(text);

  if (!cases.length) {
    return {
      applicable: false,
      reason: headerFound ? '解析到表头但没有数据行' : '未解析到用例表格（可能不是用例类交付物）',
      total: 0,
      usable: 0,
      usabilityRate: 1,
      pass: true,
      minUsabilityRate: minRate,
      bySeverity: { blocker: 0, major: 0, minor: 0 },
      cases: [],
      repairs: [],
      needsAssertion: [],
      summary: { reason: '不适用' },
    };
  }

  const seenKeys = new Map();
  const ctx = { requirementIds, seenKeys };
  const results = cases.map((c) => ({ ...inspectCase(c, ctx), caseRef: c }));

  const usable = results.filter((r) => r.usable).length;
  const usabilityRate = Math.round((usable / results.length) * 1000) / 1000;

  const bySeverity = { blocker: 0, major: 0, minor: 0 };
  for (const r of results) {
    if (r.severity !== 'none') bySeverity[r.severity] += 1;
  }

  const allRepairs = results.flatMap((r) => r.repairs.map((x) => ({ caseId: r.id, ...x })));
  const needsAssertion = results.filter((r) => r.reasons.includes('weakAssertion')).map((r) => ({
    id: r.id,
    name: r.caseRef.name,
    current: r.caseRef.expected,
  }));

  // 按原因归类，便于生成定向修复指令
  const byReason = {};
  for (const r of results) {
    for (const reason of r.reasons) byReason[reason] = (byReason[reason] || 0) + 1;
  }

  return {
    applicable: true,
    total: results.length,
    usable,
    usabilityRate,
    pass: usabilityRate >= minRate,
    minUsabilityRate: minRate,
    bySeverity,
    byReason,
    cases: results.filter((r) => !r.usable),
    repairs: allRepairs,
    needsAssertion,
    summary: buildSummary({ total: results.length, usable, usabilityRate, byReason, minRate }),
  };
}

const REASON_LABELS = {
  weakAssertion: '预期结果不可判定',
  placeholderInput: '输入含占位值',
  duplicate: '用例重复',
  missingField: '必填字段缺失',
  badSteps: '步骤不可执行',
  orphanRequirement: '关联需求不存在',
};

function buildSummary({ total, usable, usabilityRate, byReason, minRate }) {
  const parts = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${REASON_LABELS[k] || k} ${v} 条`);
  const verdict = usabilityRate >= minRate
    ? `可用率 ${(usabilityRate * 100).toFixed(1)}% 达标（阈值 ${(minRate * 100).toFixed(0)}%）`
    : `可用率 ${(usabilityRate * 100).toFixed(1)}% 未达标（阈值 ${(minRate * 100).toFixed(0)}%）`;
  return {
    text: `${verdict}：${usable}/${total} 条可直接使用${parts.length ? `；问题分布：${parts.join('、')}` : ''}`,
    verdict,
    issues: parts,
  };
}

/**
 * 把门禁结果转成给生成智能体的**定向修复指令**
 * （替代历史上永远为空的 r.issues）
 *
 * @param {Object} report - checkDeliverable 的返回值
 * @param {Object} [options]
 * @param {number} [options.maxListPerReason=30] - 每类问题最多列出多少条用例
 * @returns {string}
 */
export function buildRepairPrompt(report, options = {}) {
  if (!report || !report.applicable) return '';
  const maxList = Number(options.maxListPerReason ?? 30);

  const lines = [`【必须修复的问题】（确定性检查：${report.summary?.verdict || ''}）`];

  const groupOf = (reason) => report.cases.filter((c) => c.reasons.includes(reason));

  const weak = groupOf('weakAssertion');
  if (weak.length) {
    lines.push('');
    lines.push(`1. 预期结果不可判定（${weak.length} 条）：以下用例的「预期结果」无法判断对错。`);
    lines.push('   请改写为可观测断言，至少包含下列之一：HTTP 状态码 / 具体字段值与类型 / 明确文案（用引号包裹原文）/ 跳转目标 / 数值或计数变化 / 数据库状态。');
    for (const c of weak.slice(0, maxList)) {
      lines.push(`   - ${c.id} ${c.caseRef.name}：现为「${c.caseRef.expected}」`);
    }
    if (weak.length > maxList) lines.push(`   - ……其余 ${weak.length - maxList} 条同类问题，请一并整改`);
  }

  const placeholder = groupOf('placeholderInput');
  if (placeholder.length) {
    lines.push('');
    lines.push(`2. 输入数据仍含占位值（${placeholder.length} 条）：请替换为符合业务规则的真实值。`);
    for (const c of placeholder.slice(0, maxList)) {
      lines.push(`   - ${c.id}：${c.caseRef.input}`);
    }
  }

  const dup = groupOf('duplicate');
  if (dup.length) {
    lines.push('');
    lines.push(`3. 重复用例（${dup.length} 条）：请合并或说明差异，不要用不同措辞重复同一条用例。`);
    for (const c of dup.slice(0, maxList)) {
      lines.push(`   - ${c.id} ${c.caseRef.name}：${c.detail}`);
    }
  }

  const missing = groupOf('missingField');
  if (missing.length) {
    lines.push('');
    lines.push(`4. 必填字段缺失（${missing.length} 条）：${missing.slice(0, maxList).map((c) => c.id).join('、')}`);
  }

  const badSteps = groupOf('badSteps');
  if (badSteps.length) {
    lines.push('');
    lines.push(`5. 步骤不可执行（${badSteps.length} 条）：请补全「操作对象 + 动作 + 数据」，并用序号分步。`);
    for (const c of badSteps.slice(0, maxList)) {
      lines.push(`   - ${c.id}：${c.caseRef.steps}`);
    }
  }

  const orphan = groupOf('orphanRequirement');
  if (orphan.length) {
    lines.push('');
    lines.push(`6. 关联需求不存在（${orphan.length} 条）：请改为原始需求中真实存在的编号，或标注为「新增建议项」。`);
    for (const c of orphan.slice(0, maxList)) {
      lines.push(`   - ${c.id}：${c.detail}`);
    }
  }

  if (report.repairs?.length) {
    lines.push('');
    lines.push(`7. 已由系统自动修复的占位输入（${report.repairs.length} 处，无需再处理，仅供核对）：`);
    for (const r of report.repairs.slice(0, 10)) {
      lines.push(`   - ${r.caseId} ${r.field}: ${r.from} → ${r.to}`);
    }
  }

  lines.push('');
  lines.push('请只针对上述问题修改，保持其余用例不变；不要新增与问题无关的内容。');
  return lines.join('\n');
}

/**
 * 应用自动修复：把能修的占位输入替换回交付物文本
 * @param {string} text
 * @returns {{ text: string, applied: number }}
 */
export function applyInputRepairs(text) {
  const lines = String(text || '').split('\n');
  let applied = 0;
  const out = lines.map((line) => {
    if (!/^\s*\|/.test(line)) return line;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|');
    let changed = false;
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      if (!/[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5.]*\s*=/.test(cell)) continue;
      const rep = repairPlaceholderInput(cell);
      if (rep.repaired && !PLACEHOLDER_PATTERNS.some((p) => p.re.test(rep.input))) {
        cells[i] = rep.input;
        changed = true;
        applied += 1;
      }
    }
    if (!changed) return line;
    return `| ${cells.map((c) => c.trim()).join(' | ')} |`;
  });
  return { text: out.join('\n'), applied };
}

export default {
  inspectAssertion,
  repairPlaceholderInput,
  parseCaseTable,
  inspectCase,
  checkDeliverable,
  buildRepairPrompt,
  buildSurgicalRepairPrompt,
  spliceRepairedRows,
  applyInputRepairs,
};

// ============================================================
// 6. 外科式修复：只改出问题的用例，不重写整份文档
// ============================================================

/**
 * 生成「只返回待修用例」的指令（输出量小 → 快）
 * @param {Object} report
 * @param {Object} [options]
 * @returns {string}
 */
export function buildSurgicalRepairPrompt(report, options = {}) {
  if (!report || !report.applicable || report.pass) return '';
  const maxItems = Number(options.maxItems ?? 40);
  const targets = report.cases.slice(0, maxItems);

  const rows = targets.map((c) => {
    const ref = c.caseRef || {};
    const needs = [];
    if (c.reasons.includes('weakAssertion')) needs.push('预期结果');
    if (c.reasons.includes('badSteps')) needs.push('执行步骤');
    if (c.reasons.includes('missingField')) needs.push('缺失字段');
    return `| ${c.id} | ${ref.name || ''} | ${ref.expected || ''} | ${ref.steps || ''} | ${needs.join('+')} |`;
  });

  return [
    '【只修复下列用例，不要输出整份文档】',
    '',
    '下面是确定性检查判定为「不可用」的用例。请只为它们提供修正后的字段值。',
    '',
    '要求：',
    '1. 预期结果必须可判定，至少包含其一：HTTP 状态码 / 具体字段名与值 / 引号包裹的原文案 / 跳转目标 / 数值或计数变化 / 数据库状态。',
    '2. 执行步骤需「操作对象 + 动作 + 数据」，用 1. 2. 3. 分步。',
    '3. **只输出一个 Markdown 表格**，表头必须是：`| 用例编号 | 预期结果 | 执行步骤 |`，每个待修用例一行。',
    '4. 不要输出解释、说明、前言或结语；不要重复未列出的用例。',
    '',
    '| 用例编号 | 用例名称 | 现有预期结果 | 现有执行步骤 | 需修复 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `（共 ${targets.length} 条${report.cases.length > maxItems ? `，其余 ${report.cases.length - maxItems} 条同类问题请自行按同规则整改` : ''}）`,
  ].join('\n');
}

/**
 * 把模型返回的「待修用例表」按用例编号替换回原文档
 *
 * 只替换「预期结果」「执行步骤」两列，其余字段、行序、表格结构全部不动。
 *
 * @param {string} originalText
 * @param {string} repairedMarkdown
 * @returns {{ text: string, replaced: number, skipped: string[] }}
 */
export function spliceRepairedRows(originalText, repairedMarkdown) {
  const original = String(originalText || '');
  const patch = parseRepairPatch(repairedMarkdown);
  if (!patch.size) return { text: original, replaced: 0, skipped: [] };

  const lines = original.split('\n');
  let headerMap = null;
  let replaced = 0;
  const hit = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*\|.*\|\s*$/.test(line)) { headerMap = null; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

    if (!headerMap) {
      const map = {};
      cells.forEach((c, ci) => {
        if (/^用例编号$/.test(c)) map.id = ci;
        else if (/^(预期结果|期望结果)$/.test(c)) map.expected = ci;
        else if (/^(执行步骤|测试步骤|操作步骤)$/.test(c)) map.steps = ci;
      });
      if (map.id !== undefined && (map.expected !== undefined || map.steps !== undefined)) headerMap = map;
      continue;
    }

    if (/^[-:\s|]+$/.test(cells.join(''))) continue;
    const id = headerMap.id !== undefined ? cells[headerMap.id] : '';
    if (!id || !patch.has(id)) continue;

    const fix = patch.get(id);
    let changed = false;
    if (fix.expected && headerMap.expected !== undefined) {
      cells[headerMap.expected] = fix.expected.replace(/\|/g, '\\|');
      changed = true;
    }
    if (fix.steps && headerMap.steps !== undefined) {
      cells[headerMap.steps] = fix.steps.replace(/\|/g, '\\|');
      changed = true;
    }
    if (changed) {
      lines[i] = `| ${cells.join(' | ')} |`;
      replaced += 1;
      hit.add(id);
    }
  }

  const skipped = [...patch.keys()].filter((id) => !hit.has(id));
  return { text: lines.join('\n'), replaced, skipped };
}

/** 解析模型返回的补丁表 → Map<id, {expected, steps}> */
function parseRepairPatch(markdown) {
  const out = new Map();
  const lines = String(markdown || '').split(/\r?\n/);
  let map = null;

  for (const line of lines) {
    if (!/^\s*\|.*\|\s*$/.test(line)) { map = null; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

    if (!map) {
      const m = {};
      cells.forEach((c, ci) => {
        if (/^用例编号$/.test(c)) m.id = ci;
        else if (/^(预期结果|期望结果)$/.test(c)) m.expected = ci;
        else if (/^(执行步骤|测试步骤|操作步骤)$/.test(c)) m.steps = ci;
      });
      if (m.id !== undefined && (m.expected !== undefined || m.steps !== undefined)) map = m;
      continue;
    }
    if (/^[-:\s|]+$/.test(cells.join(''))) continue;
    const id = map.id !== undefined ? cells[map.id] : '';
    if (!id) continue;
    const expected = map.expected !== undefined ? cells[map.expected] || '' : '';
    const steps = map.steps !== undefined ? cells[map.steps] || '' : '';
    if (!expected && !steps) continue;
    out.set(id, { expected, steps });
  }
  return out;
}
