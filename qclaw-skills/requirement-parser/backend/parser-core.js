/**
 * parser-core.js
 * ------------------------------------------------------------------
 * 需求解析核心引擎（requirement-parser / backend）
 *
 * 职责：
 *   将自然语言 / 原型图描述 / 表格 / 用户故事 / Business Rules 等
 *   各类格式的需求文本，解析为结构化输出，供后续测试用例生成使用。
 *
 * 导出的公开函数：
 *   - parseRequirement(text, options?)       主解析入口
 *   - extractModules(text)                   提取模块 / 子系统
 *   - extractAcceptanceCriteria(text)        提取验收标准
 *   - detectPriority(text)                   检测优先级（P0/P1/P2）
 *
 * 纯 JavaScript（ESM），仅依赖 Node 内置模块，无第三方依赖。
 * ------------------------------------------------------------------
 */

import { pathToFileURL } from 'node:url';

/* ============================ 基础工具 ============================ */

/**
 * 将文本按行拆分（兼容 CRLF / LF），并去除每行首尾空白。
 * @param {string} text 原始文本
 * @returns {string[]} 行数组
 */
function toLines(text) {
  return String(text).split(/\r?\n/);
}

/**
 * 判断一行是否为 Markdown 标题（# ~ ######）。
 * @param {string} line 已 trim 的行
 * @returns {boolean}
 */
function isHeading(line) {
  return /^#{1,6}\s+/.test(line);
}

/* ============================ 模块提取 ============================ */

/**
 * 从需求文本中提取模块 / 子系统列表。
 * 支持中文模块名 + 英文术语配对，例如：
 *   - "# 用户管理模块 (User Management)"
 *   - "支付子系统 (Payment Subsystem)"
 *   - "模块：订单中心"
 *
 * @param {string} text 需求文本
 * @returns {Array<{name:string, english?:string, source:'heading'|'label'}>}
 *   返回去重后的模块对象数组。
 * @throws {TypeError} 当 text 不是字符串时抛出。
 */
export function extractModules(text) {
  if (typeof text !== 'string') {
    throw new TypeError('extractModules: text 必须是字符串');
  }

  const modules = [];
  const seen = new Set();

  // 英文术语配对：捕获 "名称 (English Term)" 中的中英文名
  const EN_RE = /([\u4e00-\u9fa5A-Za-z0-9_·\-\/ ]+?)\s*[（(]([A-Za-z0-9_ ]+)[)）]/;
  // 标签行关键词
  const LABEL_RE = /(模块|子系统|Module|Subsystem)/;
  // 纯结构性标题（不是模块，应跳过）
  const STRUCTURAL = /^(功能点|功能|特性|验收标准|验收条件|验收要求|边界条件|边界|概述|简介|背景|流程图|说明|备注|优先级|非功能需求|接口|数据流|用户故事)$/;
  // 句子级标点：含此类标点的标签行视为描述性句子，不应作为模块名
  const SENTENCE_PUNCT = /[，。；！？、]/;

  /**
   * 将去重后的模块加入结果集。
   * @param {string} name
   * @param {string} [english]
   * @param {'heading'|'label'} source
   */
  function push(name, english, source) {
    const key = (name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const mod = { name: name.trim() };
    if (english) mod.english = english.trim();
    mod.source = source;
    modules.push(mod);
  }

  for (const raw of toLines(text)) {
    const line = raw.trim();
    if (!line) continue;

    let candidate = null;

    // 1) Markdown 标题
    if (isHeading(line)) {
      const h = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (h && !STRUCTURAL.test(h[1].trim())) candidate = h[1];
    }

    // 2) 含模块 / 子系统标签的行
    //    - "模块：XX" 取冒号后内容（多为短名称）
    //    - "XX模块" 形式：仅当整行不含句子标点且长度较短时，视为模块名
    if (!candidate && LABEL_RE.test(line)) {
      const colon = line.match(/[:：]\s*(.+)$/);
      if (colon) {
        candidate = colon[1];
      } else if (!SENTENCE_PUNCT.test(line) && line.length <= 30) {
        candidate = line;
      }
    }

    if (!candidate) continue;

    // 解析英文术语配对
    let name = candidate;
    let english;
    const en = candidate.match(EN_RE);
    if (en) {
      name = en[1];
      english = en[2];
    }
    // 清理名称末尾的"模块/子系统"等词
    name = name.replace(/(模块|子系统|Module|Subsystem)\s*$/i, '').trim();

    push(name, english, isHeading(line) ? 'heading' : 'label');
  }

  return modules;
}

/* ============================ 验收标准提取 ============================ */

/**
 * 从需求文本中识别验收标准（Acceptance Criteria）。
 * 支持多种格式：
 *   - "验收标准" / "验收条件" / "AC" 标题块
 *   - "AC1: ..." / "验收1：..." 条目
 *   - "Given ... When ... Then ..."（含中文 给定/当/那么）
 *   - "预期结果 / 预期输出 / 期望结果"
 *
 * @param {string} text 需求文本
 * @returns {Array<{format:'GWT'|'ITEM', text:string, raw:string}>}
 * @throws {TypeError} 当 text 不是字符串时抛出。
 */
export function extractAcceptanceCriteria(text) {
  if (typeof text !== 'string') {
    throw new TypeError('extractAcceptanceCriteria: text 必须是字符串');
  }

  const out = [];
  let current = null;   // { format, lines: [] }
  let inSection = false; // 处于某个验收标准区块内

  const acHeaderMatch = (l) =>
    /^(验收标准|验收条件|验收要求|Acceptance\s*Criteria|AC)\b\s*[:：]?\s*(.*)$/i.exec(l);
  // 以"验收"或"AC"开头且含冒号的中文标签行（如"验收标准：..."）
  const isAcLabelLine = (l) => /^(验收|AC)/i.test(l) && /[:：]/.test(l);
  const isGwt = (l) =>
    /\b(Given|When|Then)\b/i.test(l) ||
    (/给定/.test(l) && /当/.test(l) && /(那么|预期)/.test(l));
  const isItem = (l) =>
    isAcLabelLine(l) ||
    /^(AC\d*|验收\d*)\s*[:：]/i.test(l) ||
    /^AC\s*\d+/i.test(l) ||
    /(预期结果|预期输出|期望结果)/.test(l);
  const isBullet = (l) => /^[-*•]\s+|\d+[.、]\s+/.test(l);

  const flush = () => {
    if (current && current.lines.length) {
      out.push({
        format: current.format,
        text: current.lines.join(' ').replace(/\s+/g, ' ').trim(),
        raw: current.lines.join('\n'),
      });
    }
    current = null;
  };

  for (const raw of toLines(text)) {
    const line = raw.trim();

    if (!line) {
      // 空行结束当前条目（GWT 多行块除外，仍保持）
      if (current && current.format !== 'GWT') flush();
      continue;
    }

    if (isHeading(line)) {
      // 验收/Acceptance/AC 相关标题视为验收标准区块起点
      if (/(验收|Acceptance|AC)/i.test(line)) {
        flush();
        inSection = true;
      } else {
        flush();
        inSection = false;
      }
      continue;
    }

    const hMatch = acHeaderMatch(line);
    if (hMatch) {
      flush();
      inSection = true;
      const inline = (hMatch[2] || '').trim();
      if (inline) current = { format: 'ITEM', lines: [inline] };
      continue;
    }

    if (isGwt(line)) {
      if (!current || current.format !== 'GWT') {
        flush();
        current = { format: 'GWT', lines: [] };
      }
      current.lines.push(line);
      inSection = true;
      continue;
    }

    if (isItem(line)) {
      if (!current || current.format !== 'ITEM') {
        flush();
        current = { format: 'ITEM', lines: [] };
      }
      current.lines.push(line);
      inSection = true;
      continue;
    }

    if (inSection && isBullet(line)) {
      if (!current) current = { format: 'ITEM', lines: [] };
      current.lines.push(line);
      continue;
    }

    if (inSection && current) {
      // 区块内的续行（非列表文本）
      current.lines.push(line);
      continue;
    }
  }

  flush();
  return out;
}

/* ============================ 优先级检测 ============================ */

/**
 * 检测需求中的优先级标签。
 * 映射关系：P0 = 冒烟，P1 = 核心，P2 = 扩展。
 * 同时支持通过中文标签（冒烟/核心/扩展）反推优先级。
 *
 * @param {string} text 需求文本
 * @returns {Array<{level:'P0'|'P1'|'P2', label:string, context:string, inferred?:boolean}>}
 * @throws {TypeError} 当 text 不是字符串时抛出。
 */
export function detectPriority(text) {
  if (typeof text !== 'string') {
    throw new TypeError('detectPriority: text 必须是字符串');
  }

  const MAP = { P0: '冒烟', P1: '核心', P2: '扩展' };
  const findings = [];
  const seen = new Set();

  for (const raw of toLines(text)) {
    const line = raw.trim();
    if (!line) continue;

    // 显式 P0/P1/P2 标签
    const re = /\bP([012])\b/gi;
    let m;
    while ((m = re.exec(line)) !== null) {
      const level = m[0].toUpperCase();
      const key = level + '|' + line;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ level, label: MAP[level], context: line });
    }

    // 中文标签反推（仅在未出现显式 P 标签时）
    if (!/\bP[012]\b/i.test(line)) {
      for (const [lvl, zh] of [['P0', '冒烟'], ['P1', '核心'], ['P2', '扩展']]) {
        if (new RegExp(zh).test(line)) {
          const key = lvl + '|zh|' + line;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({ level: lvl, label: zh, context: line, inferred: true });
        }
      }
    }
  }

  return findings;
}

/* ============================ 内部：功能点 / 边界条件 ============================ */

/**
 * 提取功能点（支持"功能点"区块内的列表项、用户故事、动词开头描述）。
 * @param {string} text
 * @returns {Array<{id:string, text:string}>}
 */
function extractFunctionalPoints(text) {
  const lines = toLines(text);
  const points = [];
  const seen = new Set();
  let inFunc = false;
  let inEdge = false;

  const funcHeader = /^(功能点|功能|特性|Feature|用户故事|User\s*Story)/i;
  const edgeHeader = /^(边界条件|边界|异常场景|异常|Edge\s*Case|极端情况)/i;
  const isAc = (l) =>
    /^(AC\d*|验收\d*)\s*[:：]/i.test(l) ||
    /(验收标准|验收条件|预期结果|Given|When|Then|给定|那么)/i.test(l);
  const isEdge = (l) => /(边界|异常|Edge\s*Case|极端|非法|超限|容错|长度限制)/i.test(l);
  const bullet = (l) =>
    /^[-*•]\s+(.+)$/.exec(l) || /^\d+[.、]\s+(.+)$/.exec(l);
  const verbStart = /^(支持|实现|提供|允许|能够|可以|用户可|系统应|应支持)/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isHeading(line)) {
      inFunc = funcHeader.test(line);
      inEdge = edgeHeader.test(line);
      continue;
    }

    const b = bullet(line);
    if (b) {
      const content = b[1].trim();
      // 跳过验收标准 / 边界条件 / 异常场景区块内的列表项
      if (isAc(content) || isEdge(content) || inEdge) continue;
      const key = content.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ id: 'FP' + (points.length + 1), text: content });
    } else if (inFunc && !inEdge && verbStart.test(line)) {
      const key = line.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        points.push({ id: 'FP' + (points.length + 1), text: line });
      }
    }
  }

  return points;
}

/**
 * 提取边界条件 / 异常场景。
 * @param {string} text
 * @returns {string[]}
 */
function extractEdgeCases(text) {
  const lines = toLines(text);
  const edges = [];
  const seen = new Set();
  let inEdge = false;

  const edgeHeader = /^(边界条件|边界|异常场景|异常|Edge\s*Case|极端情况)/i;
  const bullet = (l) =>
    /^[-*•]\s+(.+)$/.exec(l) || /^\d+[.、]\s+(.+)$/.exec(l);
  const edgeKeyword = /(边界|异常|极端|非法|超限|Edge\s*Case|容错)/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isHeading(line)) {
      inEdge = edgeHeader.test(line);
      continue;
    }

    if (inEdge || edgeKeyword.test(line)) {
      const b = bullet(line);
      const content = b ? b[1].trim() : line;
      const key = content.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(content);
      }
    }
  }

  return edges;
}

/* ============================ 主解析入口 ============================ */

/**
 * 主解析入口：将需求文本解析为结构化输出。
 *
 * @param {string} text 原始需求文本（支持自然语言 / 原型图描述 / 表格 / 用户故事 / Business Rules）
 * @param {object} [options] 可选配置
 * @param {boolean} [options.includeEdgeCases=true] 是否提取边界条件
 * @returns {{
 *   modules: Array<{name:string, english?:string, source:string}>,
 *   functionalPoints: Array<{id:string, text:string}>,
 *   acceptanceCriteria: Array<{format:'GWT'|'ITEM', text:string, raw:string}>,
 *   priority: Array<{level:string, label:string, context:string, inferred?:boolean}>,
 *   edgeCases: string[]
 * }}
 * @throws {TypeError} 当 text 不是字符串时抛出。
 */
export function parseRequirement(text, options = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('parseRequirement: text 必须是字符串');
  }
  if (options !== null && typeof options !== 'object') {
    throw new TypeError('parseRequirement: options 必须是对象');
  }

  const opts = { includeEdgeCases: true, ...options };

  return {
    modules: extractModules(text),
    functionalPoints: extractFunctionalPoints(text),
    acceptanceCriteria: extractAcceptanceCriteria(text),
    priority: detectPriority(text),
    edgeCases: opts.includeEdgeCases ? extractEdgeCases(text) : [],
  };
}

/* ============================ 自测块 ============================ */

/**
 * 直接运行 `node backend/parser-core.js` 时执行的自测逻辑。
 */
function runSelfTest() {
  const sample = `# 用户管理模块 (User Management)
用户管理模块负责账户的生命周期管理，包括注册、登录与资料维护。

## 功能点
- 支持用户注册，使用手机号注册
- 用户登录支持密码和短信验证码两种方式
- 用户可以修改个人资料

## 验收标准
AC1: 给定已注册用户，当用户使用正确密码登录时，那么系统应返回登录成功。
验收标准：用户密码错误超过5次，账户锁定30分钟。
Given 用户未登录 When 访问需要权限的页面 Then 跳转到登录页

## 边界条件
- 手机号格式非法时应提示错误
- 用户名长度限制 2-20 字符

优先级：P0 冒烟，P1 核心功能
`;

  const parsed = parseRequirement(sample);

  console.log('=== requirement-parser / parser-core 自测 ===');
  console.log('modules:');
  console.log(JSON.stringify(parsed.modules, null, 2));
  console.log('functionalPoints:');
  console.log(JSON.stringify(parsed.functionalPoints, null, 2));
  console.log('acceptanceCriteria:');
  console.log(JSON.stringify(parsed.acceptanceCriteria, null, 2));
  console.log('priority:');
  console.log(JSON.stringify(parsed.priority, null, 2));
  console.log('edgeCases:');
  console.log(JSON.stringify(parsed.edgeCases, null, 2));

  // 输入校验测试
  let validationOk = true;
  try {
    parseRequirement(123);
    validationOk = false;
  } catch (e) {
    validationOk = e instanceof TypeError;
  }
  console.log('input-validation (TypeError on non-string):', validationOk ? 'PASS' : 'FAIL');
  console.log('=== 自测结束 ===');
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runSelfTest();
}
