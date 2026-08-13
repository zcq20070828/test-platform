/**
 * data-formatter.js
 * 多格式输出格式化（JSON / CSV / SQL / xlsx-friendly / map）与脱敏。
 * 纯 JavaScript / ESM，无外部依赖。
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ *
 * 工具函数
 * ------------------------------------------------------------------ */

/**
 * 将数据规整为「记录数组」并提取表头。
 * @param {Array<any>} data 输入数据（记录对象数组 或 原始值数组）
 * @returns {{records: Array<object>, headers: Array<string>}}
 */
function normalize(data) {
  if (!Array.isArray(data)) throw new Error('formatAs: data 必须为数组');
  if (data.length === 0) return { records: [], headers: [] };
  const isRecords = data.every(
    (d) => d !== null && typeof d === 'object' && !Array.isArray(d)
  );
  let records;
  let headers;
  if (isRecords) {
    records = data;
    const set = new Set();
    data.forEach((r) => Object.keys(r).forEach((k) => set.add(k)));
    headers = [...set];
  } else {
    records = data.map((v) => ({ value: v }));
    headers = ['value'];
  }
  return { records, headers };
}

/**
 * 将单个值转为 SQL 字面量。
 * @param {any} v 值
 * @returns {string}
 */
function toSqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ *
 * 公开 API
 * ------------------------------------------------------------------ */

/**
 * 将数据格式化为指定输出格式。
 *
 * @param {Array<any>} data 测试数据（记录对象数组 或 原始值数组）
 * @param {string} [format='json'] 格式：json | csv | sql | xlsx-friendly | map
 * @returns {string|{headers:string[],rows:any[][],table?:string}|Map<any,any>}
 *   - json: 格式化 JSON 字符串
 *   - csv:  CSV 字符串（含表头）
 *   - sql:  INSERT 语句（表名为 test_data）
 *   - xlsx-friendly: { headers, rows } 结构，便于表格库直接消费
 *   - map:  Map，键为每行首个字段（或 'value'）的值，值为整行记录
 */
export function formatAs(data, format = 'json') {
  const { records, headers } = normalize(data);
  const table = 'test_data';

  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);

    case 'csv': {
      if (records.length === 0) return '';
      const esc = (v) => {
        if (v === null || v === undefined) return '';
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [headers.join(',')];
      for (const r of records) {
        lines.push(headers.map((h) => esc(r[h])).join(','));
      }
      return lines.join('\n');
    }

    case 'sql': {
      if (records.length === 0) return '';
      const cols = headers.join(', ');
      const stmts = records.map((r) => {
        const vals = headers.map((h) => toSqlLiteral(r[h])).join(', ');
        return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
      });
      return stmts.join('\n');
    }

    case 'xlsx-friendly':
      return {
        headers,
        rows: records.map((r) => headers.map((h) => (r[h] === undefined ? '' : r[h]))),
      };

    case 'map': {
      const m = new Map();
      if (records.length === 0) return m;
      const keyField = headers[0];
      for (const r of records) m.set(r[keyField], r);
      return m;
    }

    default:
      throw new Error(`formatAs: 不支持的格式 ${format}（json/csv/sql/xlsx-friendly/map）`);
  }
}

/* ------------------------------------------------------------------ *
 * 脱敏
 * ------------------------------------------------------------------ */

/**
 * 手机号脱敏：保留前3后4，中间四位为 *。
 * @param {any} v 值
 * @returns {string}
 */
function maskPhone(v) {
  const s = String(v);
  if (/^1\d{10}$/.test(s)) return s.slice(0, 3) + '****' + s.slice(7);
  if (s.length >= 7) return s.slice(0, 3) + '*'.repeat(s.length - 6) + s.slice(-3);
  return '*'.repeat(s.length);
}

/**
 * 邮箱脱敏：@ 前保留前2位，其余为 *，域名完整保留。
 * @param {any} v 值
 * @returns {string}
 */
function maskEmail(v) {
  const s = String(v);
  const idx = s.indexOf('@');
  if (idx <= 0) return '***';
  const local = s.slice(0, idx);
  const keep = local.slice(0, 2);
  const masked = keep + '*'.repeat(Math.max(0, local.length - 2));
  return masked + s.slice(idx);
}

/**
 * 姓名脱敏：保留首末字符，中间为 *。
 * @param {any} v 值
 * @returns {string}
 */
function maskName(v) {
  const s = String(v);
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + '*';
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
}

/**
 * 身份证脱敏：保留前6后4，中间为 *。
 * @param {any} v 值
 * @returns {string}
 */
function maskIdCard(v) {
  const s = String(v);
  if (s.length <= 10) return '*'.repeat(s.length);
  return s.slice(0, 6) + '*'.repeat(s.length - 10) + s.slice(-4);
}

/**
 * 全脱敏：整体替换为 *。
 * @param {any} v 值
 * @returns {string}
 */
function maskAll(v) {
  return '*'.repeat(String(v).length || 3);
}

const MASKERS = {
  phone: maskPhone,
  email: maskEmail,
  name: maskName,
  idCard: maskIdCard,
  all: maskAll,
};

/**
 * 对敏感字段应用脱敏规则。返回脱敏后的新数据（不修改原数据）。
 *
 * @param {Array<object>} data 记录对象数组
 * @param {Array<{field:string, method:string}> | object} rules
 *   脱敏规则：
 *   - 数组形式：[{ field, method }]，method ∈ phone/email/name/idCard/all
 *   - 对象形式：{ fieldName: method }
 * @returns {Array<object>} 脱敏后的数据副本
 */
export function applyMasking(data, rules) {
  if (!Array.isArray(data)) throw new Error('applyMasking: data 必须为数组');
  if (!rules || (Array.isArray(rules) && rules.length === 0) ||
      (typeof rules === 'object' && Object.keys(rules).length === 0)) {
    throw new Error('applyMasking: rules 不能为空');
  }

  const normalized = Array.isArray(rules)
    ? rules.map((r) => ({ field: r.field, method: r.method }))
    : Object.entries(rules).map(([field, method]) => ({ field, method }));

  for (const r of normalized) {
    if (!MASKERS[r.method]) {
      throw new Error(`applyMasking: 未知脱敏方法 ${r.method}（phone/email/name/idCard/all）`);
    }
  }

  const clone = data.map((row) => ({ ...row }));
  for (const row of clone) {
    for (const r of normalized) {
      if (r.field in row && row[r.field] !== null && row[r.field] !== undefined) {
        row[r.field] = MASKERS[r.method](row[r.field]);
      }
    }
  }
  return clone;
}

/* ------------------------------------------------------------------ *
 * 数据清单
 * ------------------------------------------------------------------ */

/**
 * 推断值的类型名称。
 * @param {any} v 值
 * @returns {string}
 */
function inferType(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'object') return 'object';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return 'email';
  if (/^1\d{10}$/.test(s)) return 'phone';
  return 'string';
}

/**
 * 生成数据清单：字段说明 + 样本值 + 格式统计。
 *
 * @param {Array<object>} data 记录对象数组
 * @param {object} [opts] 选项：{ sampleSize?: number }
 * @returns {{rowCount:number, generatedAt:string, fields:Array<{name:string,type:string,sampleValues:any[],distinctCount:number,nullCount:number}>}}
 */
export function generateDataManifest(data, opts = {}) {
  if (!Array.isArray(data)) throw new Error('generateDataManifest: data 必须为数组');
  const sampleSize = Number.isInteger(opts.sampleSize) ? opts.sampleSize : 5;

  const { records, headers } = normalize(data);
  const fields = headers.map((name) => {
    const values = records.map((r) => r[name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined);
    const distinct = [...new Set(nonNull.map((v) => JSON.stringify(v)))];
    const sampleValues = distinct.slice(0, sampleSize).map((s) => JSON.parse(s));
    const type = nonNull.length ? inferType(nonNull[0]) : 'null';
    return {
      name,
      type,
      sampleValues,
      distinctCount: distinct.length,
      nullCount: values.length - nonNull.length,
    };
  });

  return {
    rowCount: records.length,
    generatedAt: new Date().toISOString(),
    fields,
  };
}

/* ------------------------------------------------------------------ *
 * 自测块：node data-formatter.js
 * ------------------------------------------------------------------ */

function runSelfTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error('自测失败: ' + msg); };

  const data = [
    { id: 1, name: 'Alice', email: 'alice@example.com', phone: '13800138000', age: 28 },
    { id: 2, name: 'Bob', email: 'bob@example.com', phone: '13912345678', age: 35 },
    { id: 3, name: 'Chris', email: 'chris@example.com', phone: '13700137000', age: 42 },
  ];

  // json
  const json = formatAs(data, 'json');
  assert(JSON.parse(json).length === 3, 'json 输出可解析');

  // csv
  const csv = formatAs(data, 'csv');
  const csvLines = csv.split('\n');
  assert(csvLines[0] === 'id,name,email,phone,age', 'csv 表头');
  assert(csvLines.length === 4, 'csv 行数');

  // sql
  const sql = formatAs(data, 'sql');
  assert(sql.includes('INSERT INTO test_data'), 'sql 含 INSERT');
  assert((sql.match(/INSERT INTO/g) || []).length === 3, 'sql 条数');

  // xlsx-friendly
  const xf = formatAs(data, 'xlsx-friendly');
  assert(Array.isArray(xf.headers) && Array.isArray(xf.rows), 'xlsx-friendly 结构');
  assert(xf.rows.length === 3 && xf.rows[0].length === 5, 'xlsx-friendly 维度');

  // map
  const mp = formatAs(data, 'map');
  assert(mp instanceof Map && mp.size === 3, 'map 结构');
  assert(mp.get(1).name === 'Alice', 'map 取值');

  // 原始值数组
  const prim = formatAs([1, 2, 3], 'csv');
  assert(prim.split('\n')[0] === 'value', '原始值数组 csv 表头');

  // 空数组
  assert(formatAs([], 'json') === '[]', '空数组 json');
  assert(formatAs([], 'csv') === '', '空数组 csv');

  // 脱敏
  const masked = applyMasking(data, [
    { field: 'phone', method: 'phone' },
    { field: 'email', method: 'email' },
  ]);
  assert(masked[0].phone === '138****8000', 'phone 脱敏: ' + masked[0].phone);
  assert(masked[0].email.startsWith('al') && masked[0].email.includes('@'), 'email 脱敏: ' + masked[0].email);
  // 原数据未被修改
  assert(data[0].phone === '13800138000', '原数据未被修改');

  // 对象形式规则
  const masked2 = applyMasking(data, { name: 'name', phone: 'phone' });
  assert(masked2[0].name === 'A***e', 'name 脱敏: ' + masked2[0].name);

  // 未知方法报错
  let threw = false;
  try { applyMasking(data, { email: 'unknown' }); } catch (_) { threw = true; }
  assert(threw, '未知脱敏方法应报错');

  // 清单
  const manifest = generateDataManifest(data);
  assert(manifest.rowCount === 3, 'manifest 行数');
  assert(manifest.fields.some((f) => f.name === 'email' && f.type === 'email'), 'manifest email 类型推断');
  assert(manifest.fields.find((f) => f.name === 'phone').type === 'phone', 'manifest phone 类型推断');

  console.log('[data-formatter] 自测通过 ✓');
  console.log('  样本 - CSV 首行:', csvLines[0]);
  console.log('  样本 - 脱敏 phone:', masked[0].phone, '| email:', masked[0].email);
  console.log('  样本 - manifest 字段数:', manifest.fields.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSelfTest();
}
