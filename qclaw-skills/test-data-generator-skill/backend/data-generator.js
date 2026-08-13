/**
 * data-generator.js
 * 测试数据生成引擎（纯 JavaScript / ESM，无外部依赖）
 *
 * 负责：
 *  - 按字段规格随机生成测试数据（等价类/特殊值的基础）
 *  - 生成边界值（min-1 / min / min+1 / normal / max-1 / max / max+1）
 *  - 划分等价类（有效类 / 无效类 / 边界类）并返回代表值
 *  - 生成组合数据（全组合 / 全对偶 pairwise / 正交覆盖 / 随机）
 *
 * 支持的类型（type）：
 *  string / number / date / email / phone / postalCode /
 *  creditCard / url / ip / json / customRegex
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ *
 * 通用工具函数
 * ------------------------------------------------------------------ */

/** 默认随机源（可被各生成函数内部使用；公开函数不接受 rng 参数以维持固定签名） */
const RNG = Math.random;

/**
 * 生成 [min, max] 区间内的随机整数。
 * @param {number} min 下限（含）
 * @param {number} max 上限（含）
 * @param {() => number} rng 随机源（0~1）
 * @returns {number}
 */
function randInt(min, max, rng = RNG) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error(`randInt: 无效的区间 [${min}, ${max}]`);
  }
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * 生成 [min, max] 区间内的随机浮点数。
 * @param {number} min 下限
 * @param {number} max 上限
 * @param {() => number} rng 随机源
 * @returns {number}
 */
function randFloat(min, max, rng = RNG) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error(`randFloat: 无效的区间 [${min}, ${max}]`);
  }
  return rng() * (max - min) + min;
}

/**
 * 从数组中随机取一个元素。
 * @param {Array<any>} arr 候选数组
 * @param {() => number} rng 随机源
 * @returns {any}
 */
function pick(arr, rng = RNG) {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('pick: 数组为空或非法');
  }
  return arr[Math.floor(rng() * arr.length)];
}

const DEFAULT_CHARSET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * 生成指定长度的随机字符串。
 * @param {number} len 长度
 * @param {() => number} rng 随机源
 * @param {string} [charset] 字符集
 * @returns {string}
 */
function randString(len, rng = RNG, charset = DEFAULT_CHARSET) {
  if (!Number.isInteger(len) || len < 0) {
    throw new Error(`randString: 非法长度 ${len}`);
  }
  let out = '';
  for (let i = 0; i < len; i++) out += charset[Math.floor(rng() * charset.length)];
  return out;
}

/**
 * 将 Date 按格式化为字符串。
 * @param {Date} d 日期
 * @param {string} [format='YYYY-MM-DD'] 格式模板
 * @returns {string}
 */
function fmtDate(d, format = 'YYYY-MM-DD') {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return format
    .replace('YYYY', y)
    .replace('MM', m)
    .replace('DD', day)
    .replace('HH', hh)
    .replace('mm', mm)
    .replace('ss', ss);
}

/** 将输入解析为 Date，非法时回退到默认值。 */
function toDate(x) {
  if (x instanceof Date) return x;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/* ------------------------------------------------------------------ *
 * 各类型的值生成器
 * ------------------------------------------------------------------ */

/** 生成随机字符串（支持长度约束与可选 pattern） */
function genString(c, rng = RNG) {
  const minLen = Number.isInteger(c.minLength) ? c.minLength : 1;
  const maxLen = Number.isInteger(c.maxLength) ? c.maxLength : 10;
  if (c.pattern) return generateFromRegex(c.pattern, rng);
  if (c.charset) return randString(randInt(minLen, maxLen, rng), rng, c.charset);
  return randString(randInt(minLen, maxLen, rng), rng);
}

/** 生成随机数字（支持 min/max/integer/decimals） */
function genNumber(c, rng = RNG) {
  const min = Number.isFinite(c.min) ? c.min : 0;
  const max = Number.isFinite(c.max) ? c.max : 100;
  if (c.integer) return randInt(min, max, rng);
  const decimals = Number.isInteger(c.decimals) ? c.decimals : 2;
  return Number(randFloat(min, max, rng).toFixed(decimals));
}

/** 生成随机日期（支持 min/max/format） */
function genDate(c, rng = RNG) {
  const min = toDate(c.min ?? '2020-01-01');
  const max = toDate(c.max ?? '2030-12-31');
  const t = randFloat(min.getTime(), max.getTime(), rng);
  return fmtDate(new Date(t), c.format || 'YYYY-MM-DD');
}

/** 生成随机邮箱 */
function genEmail(rng = RNG) {
  const domains = ['example.com', 'test.org', 'mail.net', 'demo.cn'];
  return `${randString(randInt(4, 8), rng).toLowerCase()}@${pick(domains, rng)}`;
}

/** 生成随机手机号（中国大陆 11 位） */
function genPhone(rng = RNG) {
  const prefixes = ['3', '4', '5', '6', '7', '8', '9'];
  let s = '1' + pick(prefixes, rng);
  for (let i = 0; i < 9; i++) s += randInt(0, 9, rng);
  return s;
}

/** 生成随机邮政编码（6 位） */
function genPostal(rng = RNG) {
  let s = '';
  for (let i = 0; i < 6; i++) s += randInt(0, 9, rng);
  return s;
}

/** 生成通过 Luhn 校验的 16 位信用卡号 */
function genCreditCard(rng = RNG) {
  const digits = [];
  for (let i = 0; i < 15; i++) digits.push(randInt(0, 9, rng));
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = digits[14 - i];
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  digits.push(check);
  return digits.join('');
}

/** 生成随机 URL */
function genUrl(rng = RNG) {
  const tld = ['com', 'cn', 'org', 'net'];
  return `https://www.${randString(randInt(4, 8), rng).toLowerCase()}.${pick(tld, rng)}`;
}

/** 生成随机 IPv4 */
function genIp(rng = RNG) {
  return [randInt(1, 255, rng), randInt(0, 255, rng), randInt(0, 255, rng), randInt(1, 255, rng)].join('.');
}

/** 生成随机 JSON 字符串 */
function genJson(rng = RNG) {
  const obj = {
    id: randInt(1, 9999, rng),
    name: randString(randInt(3, 6), rng).toLowerCase(),
    active: pick([true, false], rng),
  };
  return JSON.stringify(obj);
}

/**
 * 根据字段规格生成一个随机值（尊重 constraints）。
 * @param {{field:string,type:string,constraints?:object}} spec 字段规格
 * @param {() => number} rng 随机源
 * @returns {any}
 */
function randomValue(spec, rng = RNG) {
  if (!spec || typeof spec !== 'object' || !spec.type) {
    throw new Error('randomValue: spec 必须包含 type 字段');
  }
  const c = spec.constraints || {};
  if (Array.isArray(c.allowedValues) && c.allowedValues.length) {
    return pick(c.allowedValues, rng);
  }
  switch (spec.type) {
    case 'string': return genString(c, rng);
    case 'number': return genNumber(c, rng);
    case 'date': return genDate(c, rng);
    case 'email': return genEmail(rng);
    case 'phone': return genPhone(rng);
    case 'postalCode': return genPostal(rng);
    case 'creditCard': return genCreditCard(rng);
    case 'url': return genUrl(rng);
    case 'ip': return genIp(rng);
    case 'json': return genJson(rng);
    case 'customRegex':
      if (typeof c.pattern !== 'string' || c.pattern.length === 0) {
        throw new Error('customRegex 类型必须在 constraints.pattern 提供正则表达式');
      }
      return generateFromRegex(c.pattern, rng);
    default:
      throw new Error(`不支持的字段类型: ${spec.type}`);
  }
}

/* ------------------------------------------------------------------ *
 * 基于正则表达式反向生成匹配字符串（支持常见正则子集）
 * ------------------------------------------------------------------ */

/**
 * 将正则表达式解析为节点树，并生成一个匹配的字符串。
 * 支持：字面量、转义(\d \w \s \D \W \S \. 等)、字符类 [a-z]/[^..]、
 * 分组 (...) / (?:...)、量词 * + ? {n} {n,m}、选择 |、通配 .，忽略锚点 ^ $
 *
 * @param {string} pattern 正则表达式
 * @param {() => number} [rng] 随机源
 * @returns {string}
 */
function generateFromRegex(pattern, rng = RNG) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('generateFromRegex: pattern 必须为非空字符串');
  }
  const PRIMITIVE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const pool = () => PRIMITIVE[Math.floor(rng() * PRIMITIVE.length)];

  let i = 0;

  function parseAlternation() {
    const options = [parseConcat()];
    while (pattern[i] === '|') { i++; options.push(parseConcat()); }
    return options.length === 1 ? options[0] : { kind: 'alt', options };
  }

  function parseConcat() {
    const items = [];
    while (i < pattern.length && pattern[i] !== '|' && pattern[i] !== ')') {
      items.push(parseQuantified());
    }
    return items.length === 1 ? items[0] : { kind: 'concat', items };
  }

  function parseQuantified() {
    let node = parseAtom();
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '*') { node = { kind: 'quant', node, min: 0, max: Infinity }; i++; }
      else if (ch === '+') { node = { kind: 'quant', node, min: 1, max: Infinity }; i++; }
      else if (ch === '?') { node = { kind: 'quant', node, min: 0, max: 1 }; i++; }
      else if (ch === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
        if (m) {
          const n = parseInt(m[1], 10);
          const max = m[3] === undefined ? n : (m[3] === '' ? Infinity : parseInt(m[3], 10));
          node = { kind: 'quant', node, min: n, max };
          i += m[0].length;
        } else break;
      } else break;
    }
    return node;
  }

  function parseAtom() {
    const ch = pattern[i];
    if (ch === '(') {
      i++;
      let nonCapture = false;
      if (pattern[i] === '?' && pattern[i + 1] === ':') { nonCapture = true; i += 2; }
      const inner = parseAlternation();
      if (pattern[i] !== ')') throw new Error(`generateFromRegex: 缺少右括号，位置 ${i}`);
      i++;
      return { kind: 'group', node: inner, nonCapture };
    }
    if (ch === '[') return parseCharClass();
    if (ch === '\\') {
      i++;
      const e = pattern[i];
      i++;
      switch (e) {
        case 'd': return { kind: 'charclass', members: [['0', '9']], negated: false };
        case 'D': return { kind: 'charclass', members: [['0', '9']], negated: true };
        case 'w': return { kind: 'charclass', members: [['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']], negated: false };
        case 'W': return { kind: 'charclass', members: [['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']], negated: true };
        case 's': return { kind: 'literal', value: ' ' };
        case 'S': return { kind: 'charclass', members: [[' ', ' ']], negated: true };
        case 'n': return { kind: 'literal', value: '\n' };
        case 't': return { kind: 'literal', value: '\t' };
        case '.': return { kind: 'literal', value: '.' };
        default: return { kind: 'literal', value: e };
      }
    }
    if (ch === '.') { i++; return { kind: 'dot' }; }
    if (ch === '^' || ch === '$') { i++; return { kind: 'empty' }; }
    i++;
    return { kind: 'literal', value: ch };
  }

  function parseCharClass() {
    i++; // skip [
    let negated = false;
    if (pattern[i] === '^') { negated = true; i++; }
    const members = [];
    while (i < pattern.length && pattern[i] !== ']') {
      let lo;
      if (pattern[i] === '\\') {
        i++;
        const e = pattern[i];
        i++;
        if (e === 'd') members.push(['0', '9']);
        else if (e === 'w') members.push(['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']);
        else if (e === 's') members.push([' ', ' ']);
        else lo = e;
      } else {
        lo = pattern[i]; i++;
      }
      if (pattern[i] === '-' && pattern[i + 1] && pattern[i + 1] !== ']') {
        i++; // skip -
        let hi;
        if (pattern[i] === '\\') { i++; hi = pattern[i]; i++; }
        else { hi = pattern[i]; i++; }
        members.push([lo, hi]);
      } else {
        members.push([lo, lo]);
      }
    }
    if (pattern[i] !== ']') throw new Error('generateFromRegex: 字符类缺少 ]');
    i++; // skip ]
    return { kind: 'charclass', members, negated };
  }

  function genCharClass(node) {
    if (!node.negated) {
      // 从一个成员中随机选一个字符
      const m = node.members[Math.floor(rng() * node.members.length)];
      if (m[0] === m[1]) return m[0];
      const code = randInt(m[0].charCodeAt(0), m[1].charCodeAt(0), rng);
      return String.fromCharCode(code);
    }
    // 取反：从默认字符池中选一个不在类中的字符
    for (let t = 0; t < 50; t++) {
      const c = pool();
      const inClass = node.members.some(([a, b]) => c >= a && c <= b);
      if (!inClass) return c;
    }
    return 'x';
  }

  function genNode(node) {
    if (node.kind === 'empty') return '';
    if (node.kind === 'literal') return node.value;
    if (node.kind === 'dot') return pool();
    if (node.kind === 'charclass') return genCharClass(node);
    if (node.kind === 'group' || node.kind === 'concat') {
      if (node.kind === 'group') return genNode(node.node);
      return node.items.map(genNode).join('');
    }
    if (node.kind === 'alt') return genNode(pick(node.options, rng));
    if (node.kind === 'quant') {
      let n = node.min;
      if (node.max === Infinity) n = node.min + randInt(0, 3, rng);
      else if (node.max > node.min) n = randInt(node.min, node.max, rng);
      let out = '';
      for (let k = 0; k < n; k++) out += genNode(node.node);
      return out;
    }
    throw new Error(`generateFromRegex: 未知节点类型 ${node.kind}`);
  }

  const ast = parseAlternation();
  if (i !== pattern.length) {
    throw new Error(`generateFromRegex: 解析未完成，剩余 "${pattern.slice(i)}"`);
  }
  return genNode(ast);
}

/* ------------------------------------------------------------------ *
 * 公开 API
 * ------------------------------------------------------------------ */

/**
 * 主生成入口：根据字段规格生成测试数据。
 *
 * @param {{field:string,type:string,constraints?:object} | Array<{field:string,type:string,constraints?:object}>} spec
 *   单个字段规格 或 多个字段规格数组。
 *   - 单规格：返回该字段的随机值数组（长度 = count）。
 *   - 数组规格：返回 count 条记录（每条记录含所有字段的值）。
 * @param {number} [count=10] 生成数量
 * @returns {Array<any> | Array<object>}
 */
export function generateTestData(spec, count = 10) {
  if (spec === undefined || spec === null) {
    throw new Error('generateTestData: spec 不能为空');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('generateTestData: count 必须为正整数');
  }
  if (Array.isArray(spec)) {
    if (spec.length === 0) throw new Error('generateTestData: 字段规格数组不能为空');
    const records = [];
    for (let r = 0; r < count; r++) {
      const rec = {};
      for (const f of spec) {
        if (!f || typeof f.field !== 'string') {
          throw new Error('generateTestData: 数组规格中每个元素需包含 field 字符串');
        }
        rec[f.field] = randomValue(f);
      }
      records.push(rec);
    }
    return records;
  }
  const arr = [];
  for (let r = 0; r < count; r++) arr.push(randomValue(spec));
  return arr;
}

/**
 * 生成边界值：min-1 / min / min+1 / 正常值 / max-1 / max / max+1。
 *
 * @param {number|string} min 下限（number/string长度/date字符串）
 * @param {number|string} max 上限
 * @param {string} [type='number'] 类型：number | string | date
 * @returns {Array<{label:string, value:any}>}
 */
export function generateBoundaryValues(min, max, type = 'number') {
  if (type === 'number') {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new Error(`generateBoundaryValues: 非法数值区间 [${min}, ${max}]`);
    }
    const mid = min + Math.floor((max - min) / 2);
    return [
      { label: 'min-1', value: min - 1 },
      { label: 'min', value: min },
      { label: 'min+1', value: min + 1 },
      { label: 'normal', value: mid },
      { label: 'max-1', value: max - 1 },
      { label: 'max', value: max },
      { label: 'max+1', value: max + 1 },
    ];
  }
  if (type === 'string') {
    const a = Number(min), b = Number(max);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a > b || a < 0) {
      throw new Error(`generateBoundaryValues: 非法字符串长度区间 [${min}, ${max}]`);
    }
    const mid = a + Math.floor((b - a) / 2);
    const s = (n) => (n < 0 ? '' : randString(n));
    return [
      { label: 'min-1', value: s(a - 1) },
      { label: 'min', value: s(a) },
      { label: 'min+1', value: s(a + 1) },
      { label: 'normal', value: s(mid) },
      { label: 'max-1', value: s(b - 1) },
      { label: 'max', value: s(b) },
      { label: 'max+1', value: s(b + 1) },
    ];
  }
  if (type === 'date') {
    const dmin = toDate(min), dmax = toDate(max);
    if (dmin > dmax) throw new Error('generateBoundaryValues: 非法日期区间');
    const span = dmax.getTime() - dmin.getTime();
    const before = new Date(dmin.getTime() - Math.max(span / 10, 86400000));
    const after = new Date(dmax.getTime() + Math.max(span / 10, 86400000));
    const mid = new Date(dmin.getTime() + span / 2);
    return [
      { label: 'min-1', value: fmtDate(before) },
      { label: 'min', value: fmtDate(dmin) },
      { label: 'min+1', value: fmtDate(new Date(dmin.getTime() + 86400000)) },
      { label: 'normal', value: fmtDate(mid) },
      { label: 'max-1', value: fmtDate(new Date(dmax.getTime() - 86400000)) },
      { label: 'max', value: fmtDate(dmax) },
      { label: 'max+1', value: fmtDate(after) },
    ];
  }
  throw new Error(`generateBoundaryValues: 不支持的类型 ${type}（仅 number/string/date）`);
}

/**
 * 划分等价类，返回有效类 / 无效类 / 边界类的代表值。
 *
 * @param {{field:string,type:string,constraints?:object}} spec 字段规格
 * @returns {{valid:Array<{label:string,value:any}>, invalid:Array<{label:string,value:any}>, boundary:Array<{label:string,value:any}>}}
 */
export function generateEquivalenceClasses(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('generateEquivalenceClasses: spec 非法');
  const { type, constraints: c = {} } = spec;
  const valid = [];
  const invalid = [];
  const boundary = [];

  // 有效类：一个代表性合法值
  try { valid.push({ label: '有效-典型值', value: randomValue(spec) }); } catch (_) { /* ignore */ }

  // 边界类
  if (type === 'number') {
    const min = Number.isFinite(c.min) ? c.min : 0;
    const max = Number.isFinite(c.max) ? c.max : 100;
    boundary.push({ label: '下边界', value: min });
    boundary.push({ label: '上边界', value: max });
    // 无效类
    invalid.push({ label: '低于下界', value: min - 1 });
    invalid.push({ label: '高于上界', value: max + 1 });
    invalid.push({ label: '非数字', value: 'abc' });
  } else if (type === 'string') {
    const minLen = Number.isInteger(c.minLength) ? c.minLength : 1;
    const maxLen = Number.isInteger(c.maxLength) ? c.maxLength : 10;
    boundary.push({ label: '最短长度', value: randString(minLen) });
    boundary.push({ label: '最长长度', value: randString(maxLen) });
    invalid.push({ label: '空字符串', value: '' });
    if (minLen > 0) invalid.push({ label: '过短', value: randString(Math.max(0, minLen - 1)) });
    invalid.push({ label: '过长', value: randString(maxLen + 5) });
    if (c.pattern) {
      invalid.push({ label: '不符合pattern', value: '#@!' });
    }
  } else if (['email', 'phone', 'url', 'ip', 'creditCard', 'postalCode'].includes(type)) {
    boundary.push({ label: '合法样例', value: randomValue(spec) });
    const samples = {
      email: ['not-an-email', 'a@b', '@example.com'],
      phone: ['12345', 'abcdefghijk', '1234567890a'],
      url: ['not-a-url', 'http://', 'ftp:///'],
      ip: ['999.999.999.999', '1.2.3', 'abc.def.ghi.jkl'],
      creditCard: ['1234', '0000000000000000', 'abcd'],
      postalCode: ['1234', 'abcdef', '0000000'],
    };
    (samples[type] || []).forEach((v, idx) => invalid.push({ label: `非法样例${idx + 1}`, value: v }));
  } else if (type === 'date') {
    const min = c.min || '2020-01-01';
    const max = c.max || '2030-12-31';
    boundary.push({ label: '下边界', value: min });
    boundary.push({ label: '上边界', value: max });
    invalid.push({ label: '早于下界', value: '1990-01-01' });
    invalid.push({ label: '晚于上界', value: '2999-01-01' });
    invalid.push({ label: '非法格式', value: 'not-a-date' });
  } else if (type === 'customRegex') {
    if (!c.pattern) throw new Error('customRegex 需要 constraints.pattern');
    boundary.push({ label: '合法样例', value: generateFromRegex(c.pattern) });
    invalid.push({ label: '不符合正则', value: '@@@' });
  }

  // allowedValues 类型的无效类
  if (Array.isArray(c.allowedValues) && c.allowedValues.length) {
    valid.unshift({ label: 'allowed值', value: c.allowedValues[0] });
    const outside = '#__NOT_IN_SET__#';
    if (!c.allowedValues.includes(outside)) {
      invalid.push({ label: '不在allowedValues', value: outside });
    }
  }

  return { valid, invalid, boundary };
}

/* ------------------------------------------------------------------ *
 * 组合数据生成
 * ------------------------------------------------------------------ */

/**
 * 笛卡尔积（全组合）。
 * @param {Array<Array<any>>} factorArrays 每个因子的取值数组
 * @returns {Array<Array<any>>}
 */
function cartesian(factorArrays) {
  return factorArrays.reduce(
    (acc, vals) => acc.flatMap((combo) => vals.map((v) => [...combo, v])),
    [[]]
  );
}

/**
 * 全对偶（pairwise / 2-way 覆盖）生成。
 * 采用贪心 In-Parameter-Order 思路，保证任意两因子的取值组合均被覆盖。
 *
 * @param {Array<Array<any>>} factorArrays 每个因子的取值数组
 * @returns {Array<Array<any>>}
 */
function pairwise(factorArrays) {
  const n = factorArrays.length;
  if (n === 0) return [];
  if (n === 1) return factorArrays[0].map((v) => [v]);

  // 所有待覆盖的 (i, j, a, b) 对
  const allPairs = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (const a of factorArrays[i])
        for (const b of factorArrays[j]) allPairs.push({ i, j, a, b });

  const covered = new Set();
  const key = (i, j, a, b) => `${i}:${j}:${JSON.stringify(a)}::${JSON.stringify(b)}`;

  const covers = (test) => {
    const found = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (test[i] === undefined || test[j] === undefined) continue;
        const k = key(i, j, test[i], test[j]);
        if (!covered.has(k)) found.push(k);
      }
    return found;
  };

  const tests = [];
  let guard = 0;
  const maxIter = allPairs.length * 4 + 100;

  while (covered.size < allPairs.length && guard++ < maxIter) {
    // 从未覆盖对中取一个作为种子
    let seed = null;
    for (const p of allPairs) {
      if (!covered.has(key(p.i, p.j, p.a, p.b))) { seed = p; break; }
    }
    if (!seed) break;

    let test = factorArrays.map((f) => f[0]);
    test[seed.i] = seed.a;
    test[seed.j] = seed.b;

    // 逐位选择能覆盖最多新对的取值
    for (let pos = 0; pos < n; pos++) {
      let bestVal = factorArrays[pos][0];
      let bestCount = -1;
      for (const v of factorArrays[pos]) {
        const t2 = test.slice();
        t2[pos] = v;
        const cnt = covers(t2).length;
        if (cnt > bestCount) { bestCount = cnt; bestVal = v; }
      }
      test[pos] = bestVal;
    }

    const cov = covers(test);
    if (cov.length === 0) break; // 无新覆盖，避免死循环
    cov.forEach((k) => covered.add(k));
    tests.push(test);
  }
  return tests;
}

/**
 * 生成组合数据，支持多种策略。
 *
 * @param {Array<Array<any>> | Array<{name:string, values:Array<any>}>} factors
 *   因子列表：可直接传取值数组，或传 {name, values} 对象。
 * @param {string} [strategy='pairwise'] 策略：
 *   'all'（全组合）/ 'pairwise'（全对偶）/ 'orthogonal'（2-way 覆盖数组）/ 'random'（随机抽样）
 * @param {object} [opts] 额外选项（random 策略用：{ count: number }）
 * @returns {Array<object>} 每条组合为以因子名为 key 的对象（无名则用 factor{i}）
 */
export function generateCombinations(factors, strategy = 'pairwise', opts = {}) {
  if (!Array.isArray(factors) || factors.length === 0) {
    throw new Error('generateCombinations: factors 必须为非空数组');
  }
  const names = [];
  const arrays = factors.map((f, idx) => {
    if (f && typeof f === 'object' && Array.isArray(f.values)) {
      names.push(f.name || `factor${idx}`);
      return f.values;
    }
    if (Array.isArray(f)) {
      names.push(`factor${idx}`);
      return f;
    }
    throw new Error('generateCombinations: 因子必须是取值数组或 {name, values} 对象');
  });

  let combos;
  switch (strategy) {
    case 'all':
      combos = cartesian(arrays);
      break;
    case 'pairwise':
    case 'orthogonal': // 以 2-way 覆盖数组近似正交
      combos = pairwise(arrays);
      break;
    case 'random': {
      const total = arrays.reduce((acc, a) => acc * a.length, 1);
      const want = Math.min(opts.count || 20, total);
      const seen = new Set();
      combos = [];
      let guard = 0;
      while (combos.length < want && guard++ < want * 20) {
        const c = arrays.map((a) => a[Math.floor(RNG() * a.length)]);
        const k = JSON.stringify(c);
        if (!seen.has(k)) { seen.add(k); combos.push(c); }
      }
      break;
    }
    default:
      throw new Error(`generateCombinations: 未知策略 ${strategy}`);
  }

  return combos.map((c) => {
    const obj = {};
    names.forEach((nm, idx) => { obj[nm] = c[idx]; });
    return obj;
  });
}

/* ------------------------------------------------------------------ *
 * 自测块：node data-generator.js
 * ------------------------------------------------------------------ */

function runSelfTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error('自测失败: ' + msg); };

  // generateTestData - 单字段
  const ages = generateTestData({ field: 'age', type: 'number', constraints: { min: 0, max: 120, integer: true } }, 5);
  assert(ages.length === 5, 'generateTestData 单字段数量');
  assert(ages.every((a) => Number.isInteger(a) && a >= 0 && a <= 120), 'generateTestData number 区间');

  // generateTestData - 多字段记录
  const recs = generateTestData([
    { field: 'name', type: 'string', constraints: { minLength: 2, maxLength: 6 } },
    { field: 'email', type: 'email' },
    { field: 'phone', type: 'phone' },
  ], 3);
  assert(recs.length === 3, 'records 数量');
  assert(/^1\d{10}$/.test(recs[0].phone), 'phone 格式');
  assert(/@/.test(recs[0].email), 'email 格式');

  // allowedValues 覆盖
  const colors = generateTestData({ field: 'c', type: 'string', constraints: { allowedValues: ['red', 'green', 'blue'] } }, 4);
  assert(colors.every((c) => ['red', 'green', 'blue'].includes(c)), 'allowedValues');

  // customRegex
  const rx = generateTestData({ field: 'code', type: 'customRegex', constraints: { pattern: '[A-Z]{2}\\d{3}' } }, 3);
  assert(rx.every((v) => /^[A-Z]{2}\d{3}$/.test(v)), 'customRegex 匹配: ' + JSON.stringify(rx));

  // generateBoundaryValues
  const bv = generateBoundaryValues(1, 10, 'number');
  assert(bv.length === 7, 'boundary 数量');
  assert(bv[0].value === 0 && bv[5].value === 10 && bv[6].value === 11, 'boundary 数值');
  const bvs = generateBoundaryValues(2, 5, 'string');
  assert(bvs.every((x) => typeof x.value === 'string'), 'boundary string');
  const bvd = generateBoundaryValues('2020-01-01', '2020-01-10', 'date');
  assert(bvd.length === 7, 'boundary date');

  // generateEquivalenceClasses
  const eq = generateEquivalenceClasses({ field: 'age', type: 'number', constraints: { min: 0, max: 120 } });
  assert(eq.valid.length > 0 && eq.invalid.length > 0 && eq.boundary.length > 0, '等价类三集合非空');
  assert(eq.invalid.some((x) => x.value === -1), '等价类含越界无效值');

  // generateCombinations - all
  const all = generateCombinations([['a', 'b'], ['1', '2'], ['x', 'y']], 'all');
  assert(all.length === 8, '全组合 2*2*2=8');
  assert(all.every((o) => 'factor0' in o && 'factor1' in o && 'factor2' in o), '组合对象键名');

  // generateCombinations - pairwise 覆盖检查
  const fA = ['a1', 'a2', 'a3'];
  const fB = ['b1', 'b2'];
  const fC = ['c1', 'c2', 'c3', 'c4'];
  const pw = generateCombinations([fA, fB, fC], 'pairwise');
  const pairSet = new Set();
  for (const t of pw) pairSet.add(`${t.factor0}|${t.factor1}`);
  for (const t of pw) pairSet.add(`${t.factor0}|${t.factor2}`);
  for (const t of pw) pairSet.add(`${t.factor1}|${t.factor2}`);
  assert(pairSet.size === fA.length * fB.length + fA.length * fC.length + fB.length * fC.length,
    `pairwise 覆盖缺失: ${pairSet.size}`);

  // generateCombinations - random
  const rnd = generateCombinations([['x', 'y'], ['1', '2']], 'random', { count: 3 });
  assert(rnd.length === 3, 'random 组合数量');

  // generateCombinations - named factors
  const named = generateCombinations([{ name: 'os', values: ['win', 'mac'] }, { name: 'browser', values: ['chrome', 'safari'] }], 'all');
  assert(named[0].os && named[0].browser, 'named 因子键名');

  console.log('[data-generator] 自测通过 ✓');
  console.log('  样本 - boundary:', JSON.stringify(bv.map((x) => x.value)));
  console.log('  样本 - customRegex:', JSON.stringify(rx[0]));
  console.log('  样本 - pairwise 条数:', pw.length, '(全组合需', fA.length * fB.length * fC.length, ')');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSelfTest();
}

export { generateFromRegex };
