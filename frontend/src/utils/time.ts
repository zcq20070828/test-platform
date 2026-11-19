/**
 * 时间格式化（2026-11-19）
 *
 * 背景：这个系统里时间字符串有两种形态，直接交给 `new Date()` 会出现 8 小时偏差：
 *
 *   1. **UTC ISO 带 Z**：`2026-11-19T06:41:23.000Z`
 *      —— 后端 SSE 事件的 `timestamp`、`artifacts.createdAt` 等，new Date() 能正确解析。
 *   2. **北京墙钟无时区**：`2026-11-19 14:41:23`
 *      —— 后端 `localNowStr()` 写入 MySQL 的 created_at/updated_at/completed_at。
 *      浏览器按本地时区解析（在 UTC+8 机器上恰好正确，但在 UTC 机器上会被当成 UTC，
 *      显示成 14:41 而实际应该是 22:41）。
 *
 * 另一个坑：`new Date('2026-11-19 06:41:23')` 并不依赖 ISO 规范，Safari 旧版会返回
 * Invalid Date。所以这里统一把「空格分隔」改写成 ISO 形式再解析，解析失败时原样返回。
 *
 * 输出一律按**北京时区（Asia/Shanghai）**渲染，与后端 localNowStr 的口径一致，
 * 也与用户预期（北京时间）一致——不随浏览器所在时区漂移。
 */

const BEIJING_TZ = 'Asia/Shanghai';

/**
 * 把后端返回的各种时间字符串解析成 Date
 *
 * 关键点：后端有两种时间格式，**无时区的那种必须显式声明为北京时区**：
 *   - `2026-11-19T06:41:23.000Z`（带 Z）→ 直接 new Date() 就是正确时刻
 *   - `2026-11-19 14:41:23`（后端 localNowStr 写入 MySQL 的北京墙钟，无时区）
 *     如果直接 new Date()，浏览器会按**本地时区**解释：在 UTC 机器上会当成 14:41 UTC，
 *     再渲染成北京时间就变成 22:41 —— 正是「时间不对」的来源。
 *     所以这里补 `+08:00` 显式声明它是北京时间。
 *
 * @param {string|number|Date} input
 * @returns {Date|null} 无法解析时返回 null
 */
export function parseServerTime(input: any): Date | null {
  if (input == null || input === '') return null
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input

  if (typeof input === 'number') {
    // 10 位当作秒
    const d = input < 1e12 ? new Date(input * 1000) : new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const text = String(input).trim()
  if (!text) return null

  // 纯数字时间戳（秒或毫秒）
  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000)
  if (/^\d{13}$/.test(text)) return new Date(Number(text))

  // 已经是带时区的 ISO（...Z 或 ...+08:00）→ 直接解析
  if (/\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const d = new Date(text)
    return Number.isNaN(d.getTime()) ? null : d
  }

  // 无时区的 `YYYY-MM-DD HH:mm:ss` / `YYYY-MM-DDTHH:mm:ss` → 显式标注为北京时区
  const naive = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/)
  if (naive) {
    const d = new Date(`${naive[1]}T${naive[2]}+08:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }

  // 只有日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const d = new Date(`${text}T00:00:00+08:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 内部：把 Date 按北京时区格式化 */
function formatInBeijing(d: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: BEIJING_TZ, ...options }).format(d)
}

/**
 * 时:分:秒（消息时间戳、日志时间）
 * @param {string|number|Date} input
 * @param {boolean} [withSeconds=true]
 */
export function formatClock(input: any, withSeconds = true): string {
  const d = parseServerTime(input)
  if (!d) return '-'
  return formatInBeijing(d, {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  })
}

/**
 * 年-月-日 时:分:秒（任务详情、创建时间）
 * @param {string|number|Date} input
 */
export function formatDateTime(input: any): string {
  const d = parseServerTime(input)
  if (!d) return '-'
  return formatInBeijing(d, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * 年-月-日（表格筛选用）
 * @param {string|number|Date} input
 */
export function formatDate(input: any): string {
  const d = parseServerTime(input)
  if (!d) return '-'
  return formatInBeijing(d, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** 相对时间（刚刚 / N 分钟前 / N 小时前 / 具体日期） */
export function formatRelative(input: any): string {
  const d = parseServerTime(input)
  if (!d) return '-'
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 0) return formatDateTime(input)
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day} 天前`
  return formatDate(input)
}

export default { parseServerTime, formatClock, formatDateTime, formatDate, formatRelative }
