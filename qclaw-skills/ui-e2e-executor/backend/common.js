/**
 * 多端 UI/E2E 通用基础模块
 * ============================================================
 * 提供:
 *   ① toUTRM —— 与 ui-direct-invoker / api-direct-invoker 完全一致的结果格式,
 *      保证 result-aggregator 等下游智能体无需改动即可消费多端执行结果。
 *   ② 通用小工具:模板渲染 / 文本裁剪 / 截图落盘。
 *
 * 为什么要单独抽一个文件:
 *   mobile-e2e-invoker 与 desktop-e2e-invoker 共用同一套结果契约,
 *   分散写死会导致两边格式漂移,下游聚合失败。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * 统一测试结果容器(UTRM)
 * @param {{testcases?: Array, summary?: object}} results
 * @param {string} tool  工具名
 * @param {number} exitCode 0=通过 1=存在失败 2=环境/参数错误
 * @param {string} [rawOutput]
 */
function toUTRM(results, tool, exitCode, rawOutput) {
  const { testcases = [], summary = {} } = results;
  return {
    tool,
    timestamp: new Date().toISOString(),
    summary: {
      total: summary.total || testcases.length,
      passed: summary.passed || testcases.filter((t) => t.status === 'passed').length,
      failed: summary.failed || testcases.filter((t) => t.status === 'failed').length,
      skipped: summary.skipped || testcases.filter((t) => t.status === 'skipped').length,
      duration: summary.duration || testcases.reduce((s, t) => s + (t.duration || 0), 0),
    },
    testcases,
    exitCode: exitCode || 0,
    raw: rawOutput || null,
  };
}

/** {{var}} 模板渲染(字符串 / 数组 / 对象递归) */
function renderTemplate(value, vars) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (m, key) => {
      const v = vars[key];
      return v === undefined || v === null ? m : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[renderTemplate(k, vars)] = renderTemplate(v, vars);
    return out;
  }
  return value;
}

function clip(s, max = 1500) {
  if (s == null) return null;
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (str == null) return null;
  return str.length > max ? str.slice(0, max) + `... [截断,共 ${str.length} 字符]` : str;
}

/**
 * 把 base64 截图落盘
 * @param {string} base64
 * @param {string} tag 目录名后缀(如 mobile / desktop)
 * @param {string} label
 */
function saveShot(base64, tag, label) {
  try {
    if (!base64) return { path: null, error: 'no screenshot data' };
    const dir = path.join(os.tmpdir(), `${tag}-e2e-shots`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${String(label).replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`);
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(file, buf);
    const out = { path: file, bytes: buf.length };
    // base64 仅在小图时回传,避免工具结果撑爆上下文
    if (buf.length <= 200 * 1024) out.base64 = base64;
    return out;
  } catch (e) {
    return { path: null, error: e && e.message };
  }
}

/**
 * 读取"文件路径或内容":给一段可能是路径也可能是正文的字符串,返回文本。
 * 用于模型传入用例文件(.xlsx/.csv/.md/.json)路径时自动读取。
 * @param {string} maybePathOrContent
 * @param {number} [maxBytes=200000]
 */
function readMaybeFile(maybePathOrContent, maxBytes = 200000) {
  if (!maybePathOrContent || typeof maybePathOrContent !== 'string') return '';
  const s = maybePathOrContent.trim();
  if (!s) return '';
  // 含换行 / 明显是正文 → 直接当作内容
  if (s.includes('\n') || s.length > 4096) return s.slice(0, maxBytes);
  try {
    if (fs.existsSync(s) && fs.statSync(s).isFile()) {
      const buf = fs.readFileSync(s);
      // xlsx 为 zip 二进制,直接读会是一坨乱码 —— 只取可读片段,其余交给调用方按文本信号处理
      const text = buf.toString('utf-8');
      const printable = text.replace(/[^\x20-\x7e\u4e00-\u9fa5]+/g, ' ');
      return printable.slice(0, maxBytes);
    }
  } catch (_) {
    /* 读不到就当正文 */
  }
  return s.slice(0, maxBytes);
}

module.exports = { toUTRM, renderTemplate, clip, saveShot, readMaybeFile };
