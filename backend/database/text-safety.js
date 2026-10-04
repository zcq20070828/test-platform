/**
 * 文本写库安全护栏(统一模块)
 *
 * 背景:
 *   MySQL/MariaDB 的 TEXT 列上限 65535 字节。超限时会被截断,若截断点落在
 *   多字节字符(如汉字)中间,产生非法 UTF-8 序列,抛出:
 *     - ER_TRUNCATED_WRONG_VALUE_FOR_FIELD(1366) "Incorrect string value"
 *     - ER_DATA_TOO_LONG(1406) "Data too long for column"
 *   这个报错**完全不提长度**,极易被误判为"字符集不对 / 脏字节"问题
 *   (本项目已因此连续打偏两次根因)。
 *
 * 本模块提供统一的三道防线:
 *   1. sanitizeUtf8  —— 保证写入值一定是合法 UTF-8(消解孤立代理/二进制视图)
 *   2. fitUtf8Bytes  —— 按字节上限安全截断,**绝不切断多字节字符**
 *   3. isCapacityError / describeCapacityError —— 把 1366/1406 翻译成人能看懂的
 *      "内容超出列容量"提示,避免再次误判方向
 *
 * 用法:
 *   import { sanitizeUtf8, fitUtf8Bytes, TYPE_CAPACITY, isCapacityError } from './text-safety.js';
 *   const safe = fitUtf8Bytes(sanitizeUtf8(input), TYPE_CAPACITY.MEDIUMTEXT);
 */

/** MySQL/MariaDB 各文本类型的字节上限 */
export const TYPE_CAPACITY = {
  TINYTEXT: 255,
  TEXT: 65535,
  MEDIUMTEXT: 16777215,
  LONGTEXT: 4294967295,
};

/**
 * 单次写入的"安全字节上限"默认值:8MB。
 *
 * 为什么不是直接取列容量(如 MEDIUMTEXT 16MB):
 *   除了列容量,还要受服务端 `max_allowed_packet` 约束(默认 16777216 = 16MB),
 *   且一个 packet 里还包含 SQL 语句本身与其它字段。实测把内容截到
 *   MEDIUMTEXT 上限(16777215)再写入,仍会触发
 *   `ER_NET_PACKET_TOO_LARGE: Got a packet bigger than 'max_allowed_packet' bytes`。
 *   故默认取 8MB(约为 packet 上限一半),为语句开销留足余量。
 *   如需写入更大内容,应显式调大 max_allowed_packet 后再放宽此值。
 */
export const SAFE_WRITE_BYTES = 8 * 1024 * 1024;

/** 截断附加标记,提示内容被裁过(计入字节预算) */
const DEFAULT_MARKER = '\n…[内容超长已截断]';

/**
 * 将任意值清洗为合法 UTF-8 字符串。
 * - Buffer / ArrayBuffer / TypedArray 等二进制: 按 UTF-8 解码(非法字节 → U+FFFD)
 * - 字符串: 重新编解码,消解孤立代理 / CESU-8 等非法序列
 * - 其它类型: JSON.stringify,杜绝原样写库
 */
export function sanitizeUtf8(v) {
  if (v == null) return v;
  if (typeof v === 'string') {
    return Buffer.from(v, 'utf-8').toString('utf-8');
  }
  if (Buffer.isBuffer(v)) {
    return v.toString('utf-8');
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(v)) {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('utf-8');
  }
  if (v instanceof ArrayBuffer) {
    return Buffer.from(v).toString('utf-8');
  }
  return JSON.stringify(v);
}

/**
 * 按字节上限安全截断字符串,保证不切断多字节字符。
 *
 * @param {string} v          待处理字符串
 * @param {number} maxBytes   目标列的字节上限(TYPE_CAPACITY.*)
 * @param {object} [opts]     { marker } 截断标记,传 '' 表示不加标记
 * @returns {string} 一定满足 Buffer.byteLength(result) <= maxBytes
 */
export function fitUtf8Bytes(v, maxBytes, opts = {}) {
  if (typeof v !== 'string') return v;
  if (!(maxBytes > 0)) return v;
  if (Buffer.byteLength(v, 'utf-8') <= maxBytes) return v;

  const marker = opts.marker === undefined ? DEFAULT_MARKER : opts.marker;
  const markerBytes = Buffer.byteLength(marker, 'utf-8');
  let budget = maxBytes - markerBytes;
  if (budget <= 0) {
    // 连标记都放不下:直接按裸字节截断
    budget = maxBytes;
  }

  const buf = Buffer.from(v, 'utf-8');
  let end = Math.min(budget, buf.length);
  // 回退到字符边界:只要下一字节是续字节(10xxxxxx),说明当前位置切在字符中间
  while (end > 0 && (buf[end] & 0xC0) === 0x80) end--;

  const head = buf.subarray(0, end).toString('utf-8');
  return budget === maxBytes ? head : head + marker;
}

/** 是否为「内容超出列容量」类错误(超长截断导致,而非字符集/编码问题) */
export function isCapacityError(err) {
  const code = err && err.code;
  return code === 'ER_DATA_TOO_LONG' || code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD';
}

/**
 * 把容量类错误翻译成明确提示。
 * 注意:MySQL 的 "Incorrect string value" 并不等于字符集问题 —— 超长截断切坏
 * 多字节字符时报的也是它。遇到该错误应先用本函数提示"内容超长",避免误判方向。
 */
export function describeCapacityError(err) {
  if (!isCapacityError(err)) return null;
  const m = String(err.message || '').match(/column '([^']+)'/i);
  const col = m ? m[1] : '未知列';
  return `内容长度超出列 ${col} 的容量上限(请检查是否仍为 TEXT 64KB,或内容是否异常膨胀)`;
}

export default { TYPE_CAPACITY, sanitizeUtf8, fitUtf8Bytes, isCapacityError, describeCapacityError };
