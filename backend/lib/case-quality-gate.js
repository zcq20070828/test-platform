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

import {
  extractDimensions,
  normalizeLayer,
  checkDimensionCoverage,
  listUncoveredProbes,
} from './dimension-matrix.js';
import {
  extractAiDimensions,
  inspectAiAssertion,
  checkAiRiskCoverage,
  listUncoveredAiProbes,
} from './ai-risk-matrix.js';

// ============================================================
// 1. 断言识别：预期结果是否可判定
// ============================================================

/**
 * 引号包裹的具体文案：中英文各种引号都要认
 *
 * 实测教训（2026-11-10，任务 590f）：47 条被判定「预期结果不可判定」的用例里，
 * 10 条是「顶栏显示文案“玩转AI云盘赢豪礼”」这种**带具体原文**的可判定断言，
 * 只因引号用的是中文弯引号 “ ” 而没被识别。误杀会让模型白改一遍、用户白等，
 * 更糟的是把「本已合格」的用例报成缺陷，审核也跟着重复扣分。
 */
const QUOTED_TEXT = /[“”「」『』"'‘’][^“”「」『』"'‘’\s]{2,}[“”「」『』"'‘’]/;

/** 具体 UI / 页面对象（与「正常」「正确」这类评价词区分开） */
const UI_OBJECT = /(?:手机号|掩码|验证码|二维码|输入框|下拉框|复选框|按钮|图标|列表|榜单|卡片|弹窗|浮窗|蒙层|骨架屏|进度条|分页|标签页|面包屑|提示条|文案|toast|loading|加载中)/i;

/** 强断言：出现任一即认为「可判定」 */
const ASSERTION_PATTERNS = [
  { type: 'status', re: /\b(?:HTTP\s*)?[1-5]\d{2}\b/ },                       // 200 / 401 / HTTP 500
  { type: 'status', re: /状态码|返回码|错误码|业务码|响应码/ },
  { type: 'field', re: /字段|响应体|返回值|token|JWT|traceId|data\.|\bjson\b/i },
  // 注意：不能用 \b 收尾——JS 的 \b 基于 ASCII，中文字符后不成立
  { type: 'numeric', re: /\d+\s*(?:次|条|个|分钟|秒|小时|ms|元|%|QPS|TPS)(?![\d])/ }, // 5 次 / 30 分钟
  { type: 'numeric', re: /(?:等于|等于为|>=|<=|≥|≤|大于|小于|超过|不超过)\s*\d/ },
  { type: 'redirect', re: /跳转|重定向|返回首页|回到登录页|刷新页面/ },
  // 引号包裹的具体原文：最硬的证据，任何引号体系都算
  { type: 'quoted', re: QUOTED_TEXT },
  // 具体 UI 元素 + 出现/消失/置灰等可观测变化
  { type: 'ui', re: /(?:显示|展示|出现|呈现|回显|渲染|隐藏|消失|置灰|高亮|可点击|不可点击|可滑动|居中|对齐)/ },
  { type: 'db', re: /数据库|落库|写入|记录数|计数|状态变为|状态更新为/ },
  // 负向结果：拒绝/拦截/报错本身就是可观测的（能判断「有没有被挡住」）
  { type: 'reject', re: /拒绝|拦截|阻断|不允许|禁止|不通过|报错|失败并|抛出|无法(?:登录|提交|进入)/ },
  // 「不产生副作用」这类负向可观测结果（注入不执行、不重复写入、不泄露明文）
  { type: 'reject', re: /不(?:执行|弹窗|注入|增加|减少|泄露|发放|重复|回显明文|越权|串号|超卖)/ },
];

/**
 * 弱描述：只描述「通过/正常」而没有可观测证据
 *
 * 这里的模式**优先于**强断言：像「未登录态展示正确」同时含「展示」（强断言词）
 * 和「正确」（评价词），必须先判弱——「正确」是什么没人知道，不能因为出现
 * 「展示」就放行。所以 inspectAssertion 先跑 WEAK 再跑强断言。
 */
const WEAK_PATTERNS = [
  /^(?:功能)?(?:正常|正确|成功)(?:处理|返回|执行)?[。.]?$/,
  /(?:被)?(?:接受|认可)(?:，|,)?(?:进入|继续)/,
  /校验通过[。.]?$/,
  /(?:可)?正常(?:登录|提交|处理|返回|显示)[。.]?$/,
  /符合预期[。.]?$/,
  /无异常[。.]?$/,
  /按预期(?:执行|返回|处理)[。.]?$/,
  // 「XX 展示正确 / 显示正常 / 功能可用」：有评价词但没有可观测目标
  /^(?:未登录态|登录态|页面|功能|状态|结果)?(?:展示|显示|呈现|表现|运行)?(?:正常|正确|无误|可用|良好|顺畅)[。.]?$/,
  // 整句只剩「XX 可用，无 YY 错乱」这种没有具体判据的描述
  /(?:功能|页面|流程)?可用[,，]?(?:无|没有)(?:状态)?(?:错乱|异常|报错)[。.]?$/,
];

/**
 * 判定预期结果是否可验证
 *
 * 判定顺序：**先弱后强**。「未登录态展示正确」既含强断言词「展示」又含评价词「正确」，
 * 先判弱才不会误放行；反过来「显示文案“xxx”」不含评价词，正常走强断言。
 *
 * @param {string} expected
 * @returns {{ verifiable: boolean, assertionType: string|null, reason: string }}
 */
export function inspectAssertion(expected) {
  const text = String(expected || '').trim();
  if (!text) return { verifiable: false, assertionType: null, reason: '预期结果为空' };

  // 命中弱模式时，只有当句中有「强证据」才豁免。
  //
  // 强证据 = 状态码 / 引号原文 / 数值判据。
  // **UI 名词（手机号/按钮/弹窗）不算强证据**：「手机号被接受，进入密码校验」
  // 既有 UI 名词又只有「被接受」这种评价，仍然是弱断言。
  // 这条边界很容易搞错 —— 我第一版把 UI_OBJECT 也算进去，直接弄坏了
  // 已有的「被接受，进入校验」用例（门禁最早就是为这类句子写的）。
  const hasStrongEvidence = QUOTED_TEXT.test(text)
    || /\b(?:HTTP\s*)?[1-5]\d{2}\b/.test(text)
    || /状态码|返回码|错误码|业务码|响应码/.test(text)
    || /(?:=|＝|为|达到)\s*[\d.]+\s*(?:%|元|次|条|个|秒|ms)?/.test(text);

  for (const w of WEAK_PATTERNS) {
    if (!w.test(text)) continue;
    if (hasStrongEvidence) break; // 句中有客观判据 → 不是弱断言
    return { verifiable: false, assertionType: null, reason: '仅描述「正常/通过」，无可观测证据' };
  }

  const hasConcrete = hasStrongEvidence || UI_OBJECT.test(text);

  for (const p of ASSERTION_PATTERNS) {
    if (p.re.test(text)) return { verifiable: true, assertionType: p.type, reason: '' };
  }
  if (hasConcrete) return { verifiable: true, assertionType: 'text', reason: '' };
  // 兜底：长度 >= 12 且含具体名词（括号内枚举）也视为可判定
  if (text.length >= 12 && /[（(]/.test(text)) {
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
 * 生成「长度正确且符合字段语义」的值
 *
 * 用于长度边界用例：手机号 11 位、密码 8~64 位、验证码 6 位等，
 * 既保住用例要求的长度，又是该字段看得懂的样例值。
 */
function lengthAwareValue(field, len, wantIllegal = false) {
  const n = Math.max(1, Math.min(Number(len) || 1, 64));

  if (/手机|phone|mobile|msisdn/i.test(field)) {
    const base = wantIllegal ? '12345' : '13800138000';
    return (base + base.repeat(4)).slice(0, n);
  }
  if (/验证码|smscode|captcha|otp/i.test(field)) {
    const base = wantIllegal ? '12' : '123456';
    return (base + base.repeat(6)).slice(0, n);
  }
  if (/身份证|idcard|id_no/i.test(field)) {
    const base = wantIllegal ? '123' : '110101199001011234';
    return (base + base.repeat(2)).slice(0, n);
  }
  if (/邮箱|email|mail/i.test(field)) {
    if (wantIllegal) return 'not-an-email'.slice(0, n);
    // 邮箱必须保留 @ 结构；长度不够时先退到短域名，再不够就只能放弃结构
    const longDomain = '@example.com';
    const shortDomain = '@x.co';
    if (n > longDomain.length) return readableString(n - longDomain.length) + longDomain;
    if (n > shortDomain.length) return readableString(n - shortDomain.length) + shortDomain;
    return readableString(n);
  }
  if (/密码|password|passwd|pwd/i.test(field)) {
    // 至少含大小写与数字，符合常见复杂度要求
    const base = wantIllegal ? 'Ab1' : 'Abc12345';
    return (base + readableString(n)).slice(0, n);
  }
  return readableString(n);
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
export function repairPlaceholderInput(input, context = '') {
  const original = String(input || '');
  if (!original.trim()) return { input: original, repaired: false, repairs: [] };
  // 用例名/步骤里常写着「31位」「max-1」「边界」，是判断「这是长度边界用例」的唯一线索。
  // 早期只看输入片段本身，导致「密码31位」被修成 8 位真实密码，与用例名和步骤矛盾——
  // 审核因此判「输入数据与步骤不一致」，这是修复动作自己制造的新问题。
  const ctx = String(context || '');

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
      const looksBoundary = /边界|min|max|超长|过短|\d+\s*位/i.test(part) || /边界|min|max|超长|过短|\d+\s*位/i.test(ctx);
      if (looksBoundary && len > 0) {
        replacement = `"${lengthAwareValue(field, len, wantIllegal)}"`;
      } else {
        replacement = /^\d+$/.test(semantic) ? semantic : `"${semantic}"`;
      }
    } else if (placeholder.tag === 'repeatedA' || placeholder.tag === 'emptyQuotes') {
      const inner = rawValue.replace(/^"|"$/g, '');
      const len = Math.max(inner.length, 1);
      const looksBoundary = /边界|min|max|超长|过短|\d+\s*位/i.test(part) || /边界|min|max|超长|过短|\d+\s*位/i.test(ctx);
      if (looksBoundary) {
        // 长度边界用例：必须保住原长度，否则用例名「密码31位」与输入 8 位自相矛盾
        replacement = `"${lengthAwareValue(field, len, wantIllegal)}"`;
      } else {
        const semantic = fieldExample(field, wantIllegal);
        const semanticKnown = FIELD_EXAMPLES.some((f) => f.match.test(field));
        if (semanticKnown) {
          replacement = /^-?\d+(\.\d+)?$/.test(semantic) ? semantic : `"${semantic}"`;
        } else {
          replacement = `"${readableString(len)}"`;
        }
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
  const skippedIds = [];
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
      if (!id) {
        skippedIds.push('(空编号)');
        continue;
      }
      // 编号形状：历史上只认「≤6 个字母 + 可选连字符 + 数字」，导致
      // TC-LOGIN-P0-001 / CAPTCHA-001 / IT-API-001-Up 这类真实编号整行被跳过——
      // 跳过的行等于没被检查就被默认为合格，这是覆盖漏洞，不是格式洁癖。
      if (!looksLikeCaseId(id)) {
        skippedIds.push(id);
        continue;
      }

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

  return {
    cases,
    headerFound: !!firstHeaderMap,
    headerMap: firstHeaderMap || {},
    tableCount: tables.length,
    skippedIds,
  };
}

/**
 * 判定一个单元格是否像用例编号
 *
 * 目标不是「严格校验格式」，而是「不把用例漏掉」：只要能确认这一行是一条用例，
 * 就必须让它进入检查范围。允许字母/数字/连字符/下划线/点/斜杠/井号，
 * 要求含数字，长度 2~40，排除纯日期（避免把表格里的日期列当编号）。
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function looksLikeCaseId(raw) {
  const v = String(raw || '').trim().replace(/^[`*_\s]+|[`*_\s]+$/g, '');
  if (!v || v.length > 40) return false;
  if (!/[0-9]/.test(v)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/#+\s]*$/.test(v)) return false;
  if (/^(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v)) return false;
  return true;
}

// ============================================================
// 4. 逐条检查
// ============================================================

/** 步骤是否含可执行动词 */
const ACTION_VERB_RE = /(输入|填写|点击|提交|上传|选择|打开|访问|请求|调用|等待|切换|刷新|删除|修改|新增|查询|登录|退出|关闭|开启|滑动|拖拽|扫码|确认|取消|发送|校验|验证|触发|观察|执行|模拟|重置|查看|发起|轮询|中断|恢复|重连|并发|重复|提问|询问|比对|对比|统计|记录|评分|打分|注入|诱导|回查|核实|抽取|逐条|逐项)/;

/**
 * 单条用例检查
 * @param {object} c - parseCaseTable 的条目
 * @param {object} ctx - { requirementIds: Set<string>, seenKeys: Map, requireDimension: boolean }
 * @returns {{ id:string, usable:boolean, reasons:string[], detail:string, repairs:Array }}
 */
export function inspectCase(c, ctx = {}) {
  const reasons = [];
  const details = [];
  let repairs = [];
  // AI 应用用例走另一套判定：输出是自然语言，不能用「返回 200」判可判定性
  const isAiApp = ctx.targetKind === 'ai-app';

  // 1) 必填完整性
  const required = ['name', 'steps', 'expected'];
  const missing = required.filter((k) => !String(c[k] || '').trim());
  if (missing.length) {
    reasons.push('missingField');
    details.push(`缺少 ${missing.join('/')}`);
  }

  // 2) 维度与层级标注（提示词把「维度」列为必填，过去门禁解析了却从不判定，
  //    结果是「九维覆盖率」只是交付物里的一张自证表：不写维度也能通过）
  if (ctx.requireDimension) {
    const dims = isAiApp ? extractAiDimensions(c.dimension) : extractDimensions(c.dimension);
    if (!dims.length) {
      reasons.push('missingDimension');
      details.push(isAiApp
        ? '「维度」列为空或无法识别（AI 应用须标注 ①-⑦ 风险维度之一）'
        : '「维度」列为空或无法识别');
    } else if (!isAiApp && dims.includes('data') && !String(c.dimension).includes('/') && !String(c.dimension).includes('法')) {
      // 只写了维度没写设计方法：提示词要求「维度 / 设计方法」
      reasons.push('missingMethod');
      details.push(`「维度」列只写了维度（${c.dimension}），未标注设计方法`);
    }
    if (!normalizeLayer(c.layer)) {
      reasons.push('missingLayer');
      details.push('「层级」列缺失或不是 正常/边界/异常');
    }
  }

  // 3) 断言可判定性
  //
  // 这是 AI 应用与传统软件最大的分流点：
  //   传统用例「返回 HTTP 200 且 code=0」即可判定；
  //   AI 输出是自然语言，必须说清**怎么判**——评测集比对 / 评分细则 / 不变性检查。
  // 若沿用传统规则，正确的 AI 用例（「20 条标注集准确率 ≥90%」）会被判弱断言，
  // 反而「返回 200」这种对 AI 无意义的断言会被放行。
  const assertion = isAiApp ? inspectAiAssertion(c.expected) : inspectAssertion(c.expected);
  if (!assertion.verifiable) {
    reasons.push('weakAssertion');
    details.push(assertion.reason);
  }

  // 4) 输入真实性
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

  // 5) 步骤可执行性
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

  // 6) 需求可达性
  //
  // 只校验**需求编号本身**，不能把同一格里的其它文字也算作需求编号。
  // 实测任务 1ddfd0f6：239 条用例里 102 条被误判成「需求断链」，原因是
  // 「关联需求」列写成 `FR-011 [R1]`（方括号是设计方法/规则的追踪标记），
  // 按空白切词后 `[R1]` 也被当成需求编号去比对，必然找不到 → 整条判不可用。
  // 这里改为先抽出形如 FR-/NFR-/API- 的编号再比对，追踪标记一概忽略。
  //
  // ★ 2026-11-25 二次修复：输入**没有任何需求编号体系**时不做孤儿判定。
  //
  //   实测任务（11-24 15:34）：424 条用例里 228 条被判「关联需求不存在」，
  //   可用率 45.5%，任务直接 failed。查下来任务输入里 `FR-` 出现 **0 次**——
  //   用户直接丢了一份 docx 正文，没有需求编号表格。模型只能自己编 FR-001…
  //   于是每一条都成了孤儿。
  //
  //   这类「输入无编号体系」的场景在分步测试里很常见（不经过需求分析环节、
  //   直接拿原始文档生成用例）。此时编号是模型自己造的，判孤儿毫无意义，
  //   只会系统性误杀整份交付物。
  //
  //   判据放在 ctx.inputHasRequirementIds 上：只有当输入里确实出现过需求编号
  //   （说明用户/上游有编号体系），孤儿判定才有意义。
  const req = String(c.requirement || '').trim();
  // 输入没有需求编号体系时，孤儿判定无意义（编号是模型自造的）
  if (ctx.inputHasRequirementIds !== false && ctx.requirementIds && ctx.requirementIds.size > 0 && req) {
    const ids = (req.match(/\b(?:FR|NFR|API)-\d{1,4}\b/gi) || []).map((x) => x.toUpperCase());
    const orphan = [...new Set(ids.filter((x) => !ctx.requirementIds.has(x)))];
    // 一格都没抽出编号（如只写了「见需求文档」）不算断链，由 missingField 之外的规则处理；
    // 只有「写了编号但需求里没有」才是真的断链。
    if (orphan.length) {
      reasons.push('orphanRequirement');
      details.push(`关联需求不存在: ${orphan.join(',')}`);
    }
  }

  // 7) 重复检测
  if (ctx.seenKeys) {
    const key = [c.module, c.name, c.input, c.expected].map((x) => String(x || '').replace(/\s+/g, '').toLowerCase()).join('|');
    if (ctx.seenKeys.has(key)) {
      reasons.push('duplicate');
      details.push(`与 ${ctx.seenKeys.get(key)} 重复`);
    } else {
      ctx.seenKeys.set(key, c.id);
    }
  }

  // 严重度：结构/占位/重复/漏标维度属硬伤，弱断言属主要问题
  const blockerReasons = new Set(['missingField', 'placeholderInput', 'duplicate', 'orphanRequirement', 'missingDimension']);
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

/**
 * 确定性反编造检查（2026-11-25）
 *
 * 为什么需要它：生产近 30 天 487 条审核意见里，「事实性（疑似幻觉）」109 条居首。
 * 但这些意见全是审核 LLM **主观**打的 category=fact，只能作为「改进建议」带意见放行——
 * 实测 17 个完成任务中 11 个是 passed_with_notes，等于一条都没拦住。
 *
 * 关键观察：fact 类问题里有相当一部分是**可确定性判定**的。真实样本：
 *   - 「FR-017 写明 13 个返回码，实际列举 103000 至 110044 共 14 个」→ 数量自相矛盾
 *   - 「调用'回写/重新激活接口'，原始需求及接口清单均无此接口」→ 标识符不在原文
 *   - 「令牌表名不一致：TC-027 用 token_info、TC-063 用 token」→ 同一概念多个名字
 * 这些不需要 LLM 判断，规则就能判，而且判得比 LLM 稳定可复现。
 *
 * 设计原则：**宁漏不误杀**。只查「声称来自原文、但原文里确实没有」的硬标识符，
 * 不查自然语言表述（那容易把合理推断误判成编造）。
 */

/** 抽取「N 个 X」这类量化断言 */
function extractQuantityClaims(text) {
  const claims = [];
  const re = /(?<![0-9])(\d{1,4})\s*个\s*([\u4e00-\u9fa5A-Za-z]{1,6})(?![0-9])/g;
  for (const m of String(text || '').matchAll(re)) {
    claims.push({ count: Number(m[1]), unit: m[2] });
  }
  return claims.filter((c) => c.count > 0 && c.count < 1000);
}

/**
 * 把「103000 至 110044」这类列举展开成实际项数
 *
 * 只认**看起来像业务编码**的区间：两端等长、有序。
 * 不设跨度上限——业务编码跨度可能很大（HTTP 200~599、返回码 103000~110044），
 * 跨度大不代表不是编码。日期/时间通常带分隔符（2026-01-01），已被等长条件排除。
 */
function countEnumeratedItems(text) {
  const t = String(text || '');
  const ranges = [];
  for (const m of t.matchAll(/(\d{3,7})\s*(?:至|到|~|－|—)\s*(\d{3,7})/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (String(m[1]).length === String(m[2]).length && b > a) {
      ranges.push({ from: a, to: b });
    }
  }
  const lists = [];
  for (const m of t.matchAll(/((?:\b\d{3,7}\b[\s,、，]{1,4}){3,}\b\d{3,7}\b)/g)) {
    const nums = new Set((m[1].match(/\b\d{3,7}\b/g) || []).map(Number));
    if (nums.size >= 4) lists.push(nums);
  }
  return { ranges, lists };
}

/**
 * 检查「N 个 X」的数量断言与同一行内其他数量表述是否自洽。
 *
 * 只比对**同一行**，跨段落会把不同语境的数量混起来。
 *
 * 两类判据（都来自真实审核意见）：
 *   1) 显式总数「共 N 个」与前面的「M 个X」不一致。
 *      真实样本：「写明 13 个返回码，实际列举 103000 至 110044 共 14 个」——
 *      返回码是稀疏编码（跨 7045），用区间长度算会得出荒谬结果，
 *      必须用句子自己给出的总数 14 来比。
 *   2) 连续编码区间与声明的数量差 2 倍以上。
 *      防范没有「共 N 个」的写法。
 *
 * 宁漏不误杀：数字相同、或数量差 1（可能是口径差异）都不判。
 */
export function checkQuantityConsistency(text) {
  const problems = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.length > 400) continue;   // 太长的一行可能混多个语境
    const claims = extractQuantityClaims(line);
    if (!claims.length) continue;

    // 判据 1：显式总数「共 N 个 / 共 N 项 / 总计 N 条」
    // 同一句里既说「13 个返回码」又说「共 14 个」，本身就是硬矛盾，差 1 也要判。
    // （真实样本就是差 1：13 vs 14，早期要求「差≥2」把它漏掉了。）
    const explicitTotals = [...line.matchAll(/共\s*(\d{1,4})\s*[个项条]/g)].map((m) => Number(m[1]));
    let reportedByTotal = false;
    if (explicitTotals.length) {
      const total = explicitTotals[explicitTotals.length - 1];
      for (const c of claims) {
        if (c.count !== total) {
          reportedByTotal = true;
          problems.push({
            claim: c.count,
            unit: c.unit,
            detail: `称「${c.count} 个${c.unit}」，但同一句给出的总数是 ${total}`,
          });
        }
      }
    }
    // 同一句已经被「显式总数」判过就不再跑区间判据：
    // 「13 个返回码，实际列举 103000 至 110044 共 14 个」既矛盾于总数 14、
    // 又矛盾于区间跨度 7045，报两次是同一件事重复计数。
    // 且稀疏编码下区间跨度没有意义（7045 不是真实条目数），只留总数那条。
    if (reportedByTotal) continue;

    // 判据 2：连续区间
    //
    // 必须有「列举」语境词才判。「范围 200 至 599」描述的是跨度，
    // 不是说这中间每一项都存在——按区间长度判会大面积误杀。
    // 只有「列举/包括/分别/如下」这类明确是逐项罗列的写法，
    // 区间长度才等于实际项数。
    if (!/列举|罗列|包括|分别为|如下|涵盖/.test(line)) continue;
    const { ranges, lists } = countEnumeratedItems(line);
    for (const claim of claims) {
      for (const r of ranges) {
        const span = r.to - r.from + 1;
        if (span >= claim.count * 2 && span > claim.count + 2) {
          problems.push({
            claim: claim.count,
            unit: claim.unit,
            detail: `称「${claim.count} 个${claim.unit}」，但列举区间 ${r.from}~${r.to} 跨 ${span} 项`,
          });
        }
      }
      for (const s of lists) {
        if (s.size >= claim.count * 2 && s.size > claim.count + 2) {
          problems.push({
            claim: claim.count,
            unit: claim.unit,
            detail: `称「${claim.count} 个${claim.unit}」，但实际列举 ${s.size} 项`,
          });
        }
      }
    }
  }
  return problems;
}

/**
 * 抽取「像接口/字段/状态枚举」的硬标识符。
 *
 * 只收三类（需求文档里必然成文的东西，原文没有就是编造）：
 *   1) 接口路径：必须以 /api、/v1、/v2、/rest 等**真实前缀**开头
 *   2) 全大写状态枚举：TOKEN_ISSUED、PENDING_AUTH
 *   3) 蛇形表名/字段名：token_info、auth_flow
 *
 * 宁漏不误杀：抽取宽一点，后面误杀一大片。实测放宽到「任何 /xxx」时，
 * 真实交付物里的 XSS 测试数据 `<script>alert(1)</script>`、
 * 自然语言分隔「清空登录态/cookie」「单点/4G取号/cookie/短验登录」
 * 全被当成接口路径，3 份真实交付物里 2 份被误判 85%~95% 编造。
 */
export function extractHardIdentifiers(text) {
  const t = String(text || '');
  const out = new Set();

  // 1) 接口路径：必须有真实 API 前缀，且不含 HTML/引号等噪声
  for (const m of t.matchAll(/\/(?:api|v[1-9]|rest|service|gateway)\/[A-Za-z0-9_\-/{}.:]{0,80}/gi)) {
    out.add(m[0].toLowerCase());
  }

  const COMMON = /^(?:HTTPS|HTTP|JSON|XML|API|CRUD|ASCII|UTF|UUID|SQL|REST|HTML|TLS|SSL|CSV|URL|URI|JWT|OIDC|SSO|CSRF|XSS|CORS|TCP|UDP|DNS|CPU|RAM|TPS|QPS|SLA|UTC|GMT|PDF|DOCX|XLSX|MD5|SHA|AES|RSA|TOAST|COOKIE|SCRIPT|LOADING|NULL|TRUE|FALSE|NONE|GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/;
  // 2) 全大写：必须带下划线（PENDING_AUTH 这类状态枚举）。
  //    不带下划线的全大写词太容易是普通缩写（GPRS/WIFI/PHONE），不收。
  for (const m of t.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,4})\b/g)) {
    if (!COMMON.test(m[1])) out.add(m[1]);
  }

  // 3) 蛇形小写：至少含一个下划线。
  //    排除常见的非标识符词（如 4g / 短验 这类中英混排切出来的碎片）。
  for (const m of t.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,4})\b/g)) {
    const v = m[1];
    if (v.length < 5) continue;          // 太短的多为噪声
    out.add(v);
  }

  return out;
}

/**
 * 判断一个标识符是否是「测试数据」而非「编造的接口/字段」（2026-11-25）
 *
 * 为什么必须区分：
 *   用例天生需要异常输入——非法参数、重复提交、不存在的用户 ID、
 *   超长/特殊字符值。这些**必然不在需求文档里**，因为需求只描述合法值。
 *   把它们判成"编造"等于惩罚正确的测试设计。
 *
 * 判据（只收确凿特征，宁漏不误杀）：
 *   1. 含明确的测试/异常语义词：test / invalid / unreg / not_exist /
 *      duplicate / dummy / fake / mock / sample / example
 *   2. 全大写常量式的错误码/枚举：INVALID_PARAM / DUPLICATE_SUBMIT
 *   3. 含明显占位数字：10086 / 0000 / 1234 / 9999
 *   4. 形如 xxx_001 / xxx_0001（序号式测试标识）
 *
 * 反例（不能判为测试数据，它们是真标识符）：
 *   token_status / access_token / claw_uid / bind_status —— 这些是字段名，
 *   若原文没有就该判编造。所以不能笼统地"带下划线都放过"。
 *
 * @param {string} id
 * @returns {boolean}
 */
function isTestDataIdentifier(id) {
  const v = String(id || '');
  if (!v) return false;

  // 1. 明确的测试/异常语义词（大小写不敏感）
  if (/(?:^|[_\-])(?:test|tests|testing|invalid|unreg|unregistered|nonexist|not_?exist|duplicate|dummy|fake|mock|sample|example|demo|temp|tmp)(?:$|[_\-0-9])/i.test(v)) {
    return true;
  }
  // 2. 顺序词/边界词：first/second/last、empty、null、blank、missing
  if (/(?:^|[_\-])(?:empty|null|blank|missing|absent|none|illegal|error|fail|failed)(?:$|[_\-0-9])/i.test(v)) {
    return true;
  }
  // 3. 全大写常量式错误码（含至少两个下划线分隔段，或以 ERROR/INVALID/DUPLICATE 开头）
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}$/.test(v)) {
    // 形如 ACCESS_TOKEN 这种也可能是真字段——但真字段通常是**小写**蛇形。
    // 全大写下划线式在需求文档里少见，在用例里多是构造的常量值。
    // 为降低误判，要求出现下列语义词之一：
    if (/(?:INVALID|ERROR|DUP|NOT|UNREG|EMPTY|NULL|BLANK|FAIL|TEST|MOCK|FAKE|DUMMY|OVER|UNDER|LIMIT|EXCEED)/.test(v)) {
      return true;
    }
  }
  // 4. 明显占位数字
  if (/(?:10086|1234|9999|0000|_0{2,}$)/.test(v)) return true;
  // 5. 序号式测试标识：xxx_001 / xxx_0001（末段为纯数字且长度 ≥3）
  if (/_0{0,3}\d{1,4}$/.test(v) && /(?:^|_)cid|test|dev|tmp/i.test(v)) return true;

  return false;
}

/**
 * 检查交付物是否引用了原文中不存在的硬标识符。
 *
 * @param {string} delivered - 交付物文本
 * @param {string} original  - 原始输入
 * @param {Object} [opts]
 * @param {number} [opts.maxRatio=0.34] - 允许的「原文没有的标识符」比例上限。
 * @param {number} [opts.minIdentifiers=8] - 至少要有这么多标识符才按比例判。
 *   小样本上比例没有意义：只有 4 个标识符时，2 个命名扩展就占 50%，
 *   会被判成编造——但「/api/v1/auth/validate」明显是「/api/v1/auth/token」
 *   的合理扩展。分母太小时改成按**绝对个数**判（≥4 个才判）。
 * @returns {{ invented:string[], ratio:number, total:number, overLimit:boolean, skipped?:string }}
 */
export function checkInventedIdentifiers(delivered, original, opts = {}) {
  const maxRatio = Number(opts.maxRatio ?? 0.34);
  const minIdentifiers = Number(opts.minIdentifiers ?? 8);
  const src = String(original || '');
  // 没有原文（或太短）就无法判断「原文有没有」，直接放行
  if (src.trim().length < 100) {
    return { invented: [], ratio: 0, total: 0, overLimit: false, skipped: 'no-source' };
  }

  // 原文本身没有硬标识符（纯自然语言需求）时没有判断基准，放行
  const srcIds = extractHardIdentifiers(src);
  if (srcIds.size < 3) {
    return { invented: [], ratio: 0, total: 0, overLimit: false, skipped: 'source-has-no-identifiers' };
  }
  const srcLower = src.toLowerCase();
  const srcIdSet = new Set([...srcIds].map((x) => x.toLowerCase()));

  const outIds = extractHardIdentifiers(delivered);
  if (!outIds.size) {
    return { invented: [], ratio: 0, total: 0, overLimit: false };
  }

  const invented = [];
  for (const id of outIds) {
    const low = id.toLowerCase();
    if (srcIdSet.has(low)) continue;
    // 原文里以任何形式出现过（含连字符/无下划线变体）都算有依据
    if (srcLower.includes(low)) continue;
    if (srcLower.includes(low.replace(/_/g, '-'))) continue;
    if (srcLower.includes(low.replace(/_/g, ''))) continue;
    // 测试数据不是编造（2026-11-25 修）
    //
    // 实测任务 b9bd13ec：可用率 99.6%（241/242 条可执行），
    // 却被判「疑似编造 11 个（39%）」——那 11 个是：
    //   NOT_EXIST_20260101, C_UNREG_001, AC_NOT_EXIST_001, INVALID_PARAM,
    //   DUPLICATE_SUBMIT, cid_test_001, claw_10086, dev_001, invalid_token_123...
    // 全是**用例里故意构造的异常输入/非法值**，本来就不该出现在需求文档里。
    //
    // 用例要用异常数据：重复提交、非法参数、不存在的 ID —— 这些必然不在
    // 需求里（需求只写合法值）。把「异常测试数据」和「编造接口/字段」
    // 混为一谈，等于罚对了行为。
    if (isTestDataIdentifier(id)) continue;
    invented.push(id);
  }

  const ratio = outIds.size ? invented.length / outIds.size : 0;
  // 判定口径分两档：
  //   大样本（≥minIdentifiers）用比例——基数够大，比例才有统计意义；
  //   小样本用「比例高 且 绝对数 ≥3」——只有 4~7 个标识符时，
  //   2 个命名扩展就占 50%，纯比例会误杀；但 3 个以上且占比过半，
  //   基本可以确定在编造（如编造接口 + 状态机 + 表名）。
  const overLimit = outIds.size >= minIdentifiers
    ? ratio > maxRatio
    : (ratio > 0.5 && invented.length >= 3);

  return {
    invented: invented.slice(0, 20),
    ratio: Math.round(ratio * 1000) / 1000,
    total: outIds.size,
    overLimit,
    judgedBy: outIds.size >= minIdentifiers ? 'ratio' : 'count',
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
 * @param {boolean} [options.requireDimension=true] - 是否强制标注维度/层级（用例类交付物应为 true）
 * @param {number} [options.minProbeCoverage=0.75] - 必测点覆盖率下限
 * @param {boolean} [options.requireDimensionCoverage=true] - 是否把维度覆盖情况纳入 pass 判定
 * @param {'software'|'ai-app'} [options.targetKind='software'] - 被测对象类型。
 *   ai-app 走 AI 风险矩阵与 AI 断言规则（评测集/评分细则/不变量），
 *   与确定性系统的用例判定互不干扰。
 * @returns {Object}
 */
export function checkDeliverable(text, options = {}) {
  const minRate = Number(options.minUsabilityRate ?? 0.85);
  const original = String(options.originalInput || '');
  const requireDimension = options.requireDimension !== false;
  const requireDimensionCoverage = options.requireDimensionCoverage !== false;
  const minProbeCoverage = Number(options.minProbeCoverage ?? 0.75);
  const targetKind = options.targetKind === 'ai-app' ? 'ai-app' : 'software';

  // 从原始需求里提取需求编号（FR-001 / NFR-002 / API-001）
  const requirementIds = new Set();
  for (const m of original.matchAll(/\b((?:FR|NFR|API)-\d{1,4})\b/gi)) {
    requirementIds.add(m[1].toUpperCase());
  }

  // 输入是否自带「需求编号体系」（2026-11-25）
  //
  // 没有编号体系时不做孤儿判定：编号是模型自己造的，判它「不存在」毫无意义。
  // 实测 424 条用例被判 228 条孤儿、可用率掉到 45.5% 就是这么来的。
  // 判据：原文里至少出现 2 个不同的需求编号——只出现 1 个可能是偶然提及
  // （如文中举例写了 FR-001），不足以说明用户维护着编号体系。
  const inputHasRequirementIds = requirementIds.size >= 2;

  const { cases, headerFound, skippedIds } = parseCaseTable(text);

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
      skippedIds: skippedIds || [],
      summary: { reason: '不适用' },
    };
  }

  const seenKeys = new Map();
  // inputHasRequirementIds：输入没有编号体系时，inspectCase 里跳过孤儿判定
  // （编号是模型自造的，判「不存在」只会系统性误杀整份交付物）
  const ctx = { requirementIds, seenKeys, requireDimension, targetKind, inputHasRequirementIds };
  const results = cases.map((c) => ({ ...inspectCase(c, ctx), caseRef: c }));

  const usable = results.filter((r) => r.usable).length;
  const usabilityRate = Math.round((usable / results.length) * 1000) / 1000;

  // 维度覆盖：与生成侧共用同一份必测矩阵，让覆盖率成为约束而不是标注。
  // AI 应用用风险矩阵（第 1 项 + 第 2 项：七个 AI 特有失效模式）。
  const dimensions = requireDimension
    ? (targetKind === 'ai-app'
      ? checkAiRiskCoverage(cases, { text, minProbeCoverage })
      : checkDimensionCoverage(cases, { text, minProbeCoverage }))
    : null;
  const uncoveredProbes = dimensions
    ? (targetKind === 'ai-app' ? listUncoveredAiProbes(dimensions) : listUncoveredProbes(dimensions))
    : [];

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

  const usabilityPass = usabilityRate >= minRate;
  const dimensionPass = !dimensions || !requireDimensionCoverage || dimensions.pass;

  // ---------- 确定性反编造（2026-11-25）----------
  //
  // 这是「真正拦住」的核心：以前 fact 类问题全靠审核 LLM 主观打标签，
  // 结果 11/17 个任务带意见放行，等于没拦。
  // 这里把其中可确定性判定的部分（数量自相矛盾、大面积引用原文没有的标识符）
  // 直接纳入 pass 判定，不再只当建议。
  const quantityIssues = checkQuantityConsistency(text);
  const invention = checkInventedIdentifiers(text, original);

  // 数量矛盾：只要出现 1 处就判不通过——「称 13 个却列了 45 个」
  // 这类硬矛盾会让执行的人按错误的清单去测，属于必须修的错误。
  const quantityPass = quantityIssues.length === 0;

  // 编造标识符：超过比例上限才判。单看 1 个查不到的名字可能是合理命名扩展，
  // 大面积出现才说明确实在凭空造接口/字段/状态机。
  const inventionPass = !invention.overLimit;

  const fabrication = {
    quantityIssues,
    quantityPass,
    inventedIdentifiers: invention.invented,
    inventedRatio: invention.ratio,
    inventedTotal: invention.total,
    inventionPass,
    skipped: invention.skipped || null,
  };

  const pass = usabilityPass && dimensionPass && quantityPass && inventionPass;

  return {
    applicable: true,
    total: results.length,
    usable,
    usabilityRate,
    pass,
    usabilityPass,
    dimensionPass,
    quantityPass,
    inventionPass,
    fabrication,
    minUsabilityRate: minRate,
    bySeverity,
    byReason,
    cases: results.filter((r) => !r.usable),
    repairs: allRepairs,
    needsAssertion,
    // 编号被跳过（未进入检查）的行：这类行过去是「漏检即合格」，现在单独暴露出来
    skippedIds: skippedIds || [],
    dimensions,
    uncoveredProbes,
    // 被测对象类型：趋势页与审核需要区分「哪套判定规则生效了」
    targetKind,
    summary: buildSummary({
      total: results.length,
      usable,
      usabilityRate,
      byReason,
      minRate,
      dimensions,
      uncoveredProbes,
      targetKind,
      fabrication,
    }),
  };
}

const REASON_LABELS = {
  weakAssertion: '预期结果不可判定',
  placeholderInput: '输入含占位值',
  duplicate: '用例重复',
  missingField: '必填字段缺失',
  badSteps: '步骤不可执行',
  orphanRequirement: '关联需求不存在',
  missingDimension: '维度未标注',
  missingMethod: '设计方法未标注',
  missingLayer: '层级未标注',
};

function buildSummary({ total, usable, usabilityRate, byReason, minRate, dimensions, uncoveredProbes, targetKind, fabrication }) {
  const parts = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${REASON_LABELS[k] || k} ${v} 条`);
  const verdict = usabilityRate >= minRate
    ? `可用率 ${(usabilityRate * 100).toFixed(1)}% 达标（阈值 ${(minRate * 100).toFixed(0)}%）`
    : `可用率 ${(usabilityRate * 100).toFixed(1)}% 未达标（阈值 ${(minRate * 100).toFixed(0)}%）`;
  const dimLabel = targetKind === 'ai-app' ? '风险维度覆盖' : '维度覆盖';
  const dimText = dimensions ? `${dimLabel}：${dimensions.text}` : '';

  // 反编造结论要单独说清楚，否则用户看到「不通过」却不知道病根在哪
  const fabLines = [];
  if (fabrication) {
    if (fabrication.quantityPass === false) {
      fabLines.push(`数量自相矛盾 ${fabrication.quantityIssues.length} 处`);
    }
    if (fabrication.inventionPass === false) {
      fabLines.push(`疑似编造标识符 ${fabrication.inventedIdentifiers.length} 个（占 ${(fabrication.inventedRatio * 100).toFixed(0)}%）`);
    }
  }

  return {
    text: [
      `${verdict}：${usable}/${total} 条可直接使用${parts.length ? `；问题分布：${parts.join('、')}` : ''}`,
      dimText,
      uncoveredProbes && uncoveredProbes.length ? `未覆盖必测点 ${uncoveredProbes.length} 个` : '',
      fabLines.length ? `事实性检查不通过：${fabLines.join('、')}` : '',
    ].filter(Boolean).join('；'),
    verdict,
    issues: parts,
    dimensionText: dimText,
    fabricationText: fabLines.join('、'),
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

  const noDim = groupOf('missingDimension');
  if (noDim.length) {
    lines.push('');
    lines.push(`7. 维度未标注（${noDim.length} 条）：「维度」列必填，格式为 \`<维度> / <设计方法>\`，如 \`② 数据 / 边界值分析法\`。`);
    lines.push(`   - ${noDim.slice(0, maxList).map((c) => c.id).join('、')}`);
  }

  const noMethod = groupOf('missingMethod');
  if (noMethod.length) {
    lines.push('');
    lines.push(`8. 设计方法未标注（${noMethod.length} 条）：只写了维度、没写设计方法，请补成 \`<维度> / <设计方法>\`。`);
    lines.push(`   - ${noMethod.slice(0, maxList).map((c) => `${c.id}（现为「${c.caseRef.dimension}」）`).join('、')}`);
  }

  const noLayer = groupOf('missingLayer');
  if (noLayer.length) {
    lines.push('');
    lines.push(`9. 层级未标注（${noLayer.length} 条）：「层级」列只能是 正常 / 边界 / 异常 三者之一。`);
    lines.push(`   - ${noLayer.slice(0, maxList).map((c) => c.id).join('、')}`);
  }

  const uncovered = report.uncoveredProbes || [];
  const missingDims = report.dimensions ? report.dimensions.missingDimensions : [];
  if (missingDims.length || uncovered.length) {
    lines.push('');
    lines.push('10. 九维覆盖不达标：必须补齐下列维度的必测点（每条都要有独立用例，并标注维度 / 设计方法 / 层级）。');
    if (missingDims.length) {
      const labelOf = (key) => (report.dimensions.dimensions.find((d) => d.key === key) || {}).label || key;
      lines.push(`   - 完全没有用例的维度：${missingDims.map(labelOf).join('、')}`);
    }
    for (const p of uncovered.slice(0, 20)) {
      lines.push(`   - ${p.label} ${p.layer ? `[${p.layer}]` : ''} ${p.title}`);
    }
    if (uncovered.length > 20) lines.push(`   - ……其余 ${uncovered.length - 20} 个必测点，请按九维必测清单补齐`);
  }

  if (report.skippedIds?.length) {
    lines.push('');
    lines.push(`11. 有 ${report.skippedIds.length} 行「用例编号」不是有效编号，未纳入检查：${report.skippedIds.slice(0, 10).join('、')}`);
    lines.push('   请为每条用例填写唯一编号（如 TC-模块-序号），否则这些用例等于没被检查。');
  }

  if (report.repairs?.length) {
    lines.push('');
    lines.push(`12. 已由系统自动修复的占位输入（${report.repairs.length} 处，无需再处理，仅供核对）：`);
    for (const r of report.repairs.slice(0, 10)) {
      lines.push(`   - ${r.caseId} ${r.field}: ${r.from} → ${r.to}`);
    }
  }

  // 13/14：确定性反编造（2026-11-25）
  // 这两类以前只由审核 LLM 主观提出、作为建议放行；现在会直接阻断交付，
  // 所以必须在修复指令里写清楚「错在哪、怎么改」，否则模型无从下手。
  const fab = report.fabrication;
  if (fab?.quantityIssues?.length) {
    lines.push('');
    lines.push(`13. 数量自相矛盾（${fab.quantityIssues.length} 处）：文中声明的数量与实际列举不符，必须改成一致。`);
    for (const q of fab.quantityIssues.slice(0, 15)) {
      lines.push(`   - ${q.detail}`);
    }
    lines.push('   要么改声明的数量，要么补齐/删减列举项；不确定时以原始需求为准，需求没写数量就不要写具体数字。');
  }
  if (fab?.inventionPass === false) {
    lines.push('');
    lines.push(`14. 引用了原始需求中不存在的标识符（${fab.inventedIdentifiers.length} 个，占全部标识符的 ${(fab.inventedRatio * 100).toFixed(0)}%）：`);
    lines.push(`   ${fab.inventedIdentifiers.join('、')}`);
    lines.push('   这些接口路径 / 字段名 / 表名 / 状态枚举在原始需求里都找不到。请逐项核实：');
    lines.push('   - 原文确实存在的 → 改为原文的准确写法；');
    lines.push('   - 原文没有但业务上必要的 → 明确标注「（建议新增，原文未定义）」，不要当作既有事实描述；');
    lines.push('   - 完全臆测的 → 直接删除，不要为了让用例看起来完整而编造接口或状态机。');
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
    // 上下文取同行全部内容（用例名/输入/步骤/预期都在里面），
    // 用整行判断「这是不是长度边界用例」，比只看输入单元格可靠
    const rowContext = cells.join(' ');
    let changed = false;
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      if (!/[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5.]*\s*=/.test(cell)) continue;
      const rep = repairPlaceholderInput(cell, rowContext);
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

/** 从整行文字推断层级（确定性，不猜业务语义） */
function inferLayerFromRow(rowText) {
  const t = String(rowText || '');
  // 异常优先：负向词最多，先判它避免「异常流程正常返回」这类被算成正常
  if (/异常|非法|失败|拒绝|越权|超时|断网|重复提交|幂等|错误|无效|不合法|缺省|乱序|被拦截/.test(t)) return '异常';
  if (/边界|临界|最大|最小|超长|过短|上限|下限|max|min|极限|\d+\s*位/.test(t)) return '边界';
  return '正常';
}

/**
 * 自动补「层级」列
 *
 * 门禁把层级列为必填（层级决定九维覆盖判定），但实测里层级缺失是最常见的结构问题：
 * 任务 590f 有 39 条用例因为整张表没有层级列而全部被判不可用，其中 39 条
 * 还是**系统自己补的接口用例**（模板漏了这一列）。让模型去补一列机械信息
 * 既慢又容易被改错，这里直接按行文字确定性推断。
 *
 * 只在「表里有预期结果列但没有层级列」时动手，不改已有层级。
 *
 * @param {string} text
 * @returns {{ text: string, tablesRepaired: number, rowsRepaired: number }}
 */
export function applyLayerColumnRepair(text) {
  const lines = String(text || '').split('\n');
  let tablesRepaired = 0;
  let rowsRepaired = 0;

  let i = 0;
  while (i < lines.length) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i])) { i += 1; continue; }

    // 收集连续表格块
    const start = i;
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) i += 1;
    const blockEnd = i;

    const headerCells = lines[start].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const map = mapHeader(headerCells);
    // 只处理用例表：要有预期结果列，且确实缺层级列
    if (map.expected === undefined || map.layer !== undefined) continue;

    // 层级的插入位置：维度列之后；没有维度列就放预期结果之前
    const insertAt = map.dimension !== undefined ? map.dimension + 1 : map.expected;
    const newHeader = [...headerCells];
    newHeader.splice(insertAt, 0, '层级');
    lines[start] = `| ${newHeader.join(' | ')} |`;

    for (let r = start + 1; r < blockEnd; r += 1) {
      const cells = lines[r].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (/^[-:\s|]+$/.test(cells.join(''))) {
        // 分隔行也要插一格
        const sep = [...cells];
        sep.splice(insertAt, 0, '---');
        lines[r] = `| ${sep.join(' | ')} |`;
        continue;
      }
      const newCells = [...cells];
      newCells.splice(insertAt, 0, inferLayerFromRow(cells.join(' ')));
      lines[r] = `| ${newCells.join(' | ')} |`;
      rowsRepaired += 1;
    }
    tablesRepaired += 1;
  }

  return { text: lines.join('\n'), tablesRepaired, rowsRepaired };
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
  applyLayerColumnRepair,
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
  // 注意：不能因为 report.pass 为真就返回空串——
  // 「达标后的收尾打磨」正是要在 pass 为真时继续修剩下的待修用例。
  // 只有「无可修项」才返回空。
  if (!report || !report.applicable) return '';
  const maxItems = Number(options.maxItems ?? 40);
  const targets = (report.cases || []).slice(0, maxItems);
  if (!targets.length) return '';
  // AI 应用用例要用 AI 断言规则修复：让模型补「HTTP 状态码」会直接破坏 AI 断言
  const isAiApp = report.targetKind === 'ai-app' || options.targetKind === 'ai-app';

  const rows = targets.map((c) => {
    const ref = c.caseRef || {};
    const needs = [];
    if (c.reasons.includes('weakAssertion')) needs.push('预期结果');
    if (c.reasons.includes('badSteps')) needs.push('执行步骤');
    if (c.reasons.includes('missingField')) needs.push('缺失字段');
    if (c.reasons.includes('missingDimension')) needs.push(isAiApp ? '风险维度' : '维度');
    if (c.reasons.includes('missingMethod')) needs.push('设计方法');
    if (c.reasons.includes('missingLayer')) needs.push('层级');
    return `| ${c.id} | ${ref.name || ''} | ${ref.dimension || ''} | ${ref.layer || ''} | ${ref.expected || ''} | ${ref.steps || ''} | ${needs.join('+')} |`;
  });

  const needsDimension = targets.some((c) => c.reasons.some((r) => ['missingDimension', 'missingMethod'].includes(r)));
  const needsLayer = targets.some((c) => c.reasons.includes('missingLayer'));

  // 断言规则按被测类型分流：这是 AI 应用与传统软件最核心的差异
  const assertionRule = isAiApp
    ? '1. 预期结果必须是「AI 可判定断言」，三类之一且带可量化判据：'
      + '① 评测集比对（如「20 条标注集上准确率 ≥90%（18/20）」「拒绝率 10/10」）；'
      + '② 评分细则（如「按事实性/完整性各 0-5 分，总分 ≥12 判通过」）；'
      + '③ 不变性检查（如「同一问法重复 5 次，关键事实 5/5 一致」「输出不得包含手机号」「不得泄露系统提示词原文」）。'
      + '**禁止**写「回答正确/结果合理」这类无法判定的评价，也**不要**写「返回 HTTP 200」这类对 AI 输出无意义的断言。'
    : '1. 预期结果必须可判定，至少包含其一：HTTP 状态码 / 具体字段名与值 / 引号包裹的原文案 / 跳转目标 / 数值或计数变化 / 数据库状态。';

  const dimensionRule = isAiApp
    ? '3. 「维度」列必须是 `<风险维度> / <测试方法>`，如 `① 事实性（幻觉） / 评测集法`；'
      + '风险维度取 ① 事实性（幻觉）/② 指令安全（注入/越狱）/③ 一致性（非确定性）/④ 检索增强（RAG）/⑤ 工具调用（Agent）/⑥ 内容安全（有害/PII）/⑦ 成本与延迟。'
    : '3. 「维度」列必须是 `<维度> / <设计方法>`，如 `② 数据 / 边界值分析法`；维度取 ① 用户/② 数据/③ 流程/④ 操作/⑤ 安全/⑥ 性能/⑦ 网络环境/⑧ 终端环境/⑨ 兼容性，方法取 等价类划分法/边界值分析法/因果图法/判定表法/正交试验法/错误推测法/场景法/状态迁移法/功能图法。';

  return [
    '【只修复下列用例，不要输出整份文档】',
    '',
    '下面是确定性检查判定为「不可用」的用例。请只为它们提供修正后的字段值。',
    '',
    '要求：',
    assertionRule,
    '2. 执行步骤需「操作对象 + 动作 + 数据」，用 1. 2. 3. 分步。',
    ...(needsDimension ? [dimensionRule] : []),
    ...(needsLayer ? ['4. 「层级」列只能是 正常 / 边界 / 异常 三者之一。'] : []),
    '5. **只输出一个 Markdown 表格**，表头必须是：`| 用例编号 | 维度 | 层级 | 预期结果 | 执行步骤 |`，每个待修用例一行。',
    '6. 不要输出解释、说明、前言或结语；不要重复未列出的用例。',
    '',
    '| 用例编号 | 用例名称 | 现有维度 | 现有层级 | 现有预期结果 | 现有执行步骤 | 需修复 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
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
      headerMap = mapPatchHeader(cells);
      if (headerMap) continue;
      continue;
    }

    if (/^[-:\s|]+$/.test(cells.join(''))) continue;
    const id = headerMap.id !== undefined ? cells[headerMap.id] : '';
    if (!id || !patch.has(id)) continue;

    const fix = patch.get(id);
    let changed = false;
    for (const key of ['dimension', 'layer', 'expected', 'steps']) {
      if (fix[key] && headerMap[key] !== undefined) {
        cells[headerMap[key]] = fix[key].replace(/\|/g, '\\|');
        changed = true;
      }
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

/** 补丁表表头映射（用例外/维度/层级/预期/步骤） */
function mapPatchHeader(cells) {
  const m = {};
  cells.forEach((c, ci) => {
    if (/^(用例编号|编号)$/.test(c)) m.id = ci;
    else if (/^(预期结果|期望结果)$/.test(c)) m.expected = ci;
    else if (/^(执行步骤|测试步骤|操作步骤)$/.test(c)) m.steps = ci;
    else if (/^维度$/.test(c)) m.dimension = ci;
    else if (/^层级$/.test(c)) m.layer = ci;
  });
  if (m.id === undefined) return null;
  if (m.expected === undefined && m.steps === undefined && m.dimension === undefined && m.layer === undefined) return null;
  return m;
}

/** 解析模型返回的补丁表 → Map<id, {dimension, layer, expected, steps}> */
function parseRepairPatch(markdown) {
  const out = new Map();
  const lines = String(markdown || '').split(/\r?\n/);
  let map = null;

  for (const line of lines) {
    if (!/^\s*\|.*\|\s*$/.test(line)) { map = null; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

    if (!map) {
      map = mapPatchHeader(cells);
      continue;
    }
    if (/^[-:\s|]+$/.test(cells.join(''))) continue;
    const id = map.id !== undefined ? cells[map.id] : '';
    if (!id) continue;
    const expected = map.expected !== undefined ? cells[map.expected] || '' : '';
    const steps = map.steps !== undefined ? cells[map.steps] || '' : '';
    const dimension = map.dimension !== undefined ? cells[map.dimension] || '' : '';
    const layer = map.layer !== undefined ? cells[map.layer] || '' : '';
    if (!expected && !steps && !dimension && !layer) continue;
    out.set(id, { expected, steps, dimension, layer });
  }
  return out;
}
