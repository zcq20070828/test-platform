/**
 * data-masking 可执行技能封装
 * - 文本：确定性正则脱敏（手机号/身份证/邮箱/银行卡/姓名/口令），不依赖模型
 * - 文件：调用 data-masking-skill/scripts/mask_wrapper.py 对 docx/图片做真实脱敏
 *
 * 安全约束：文件路径必须位于项目目录或系统临时目录内；不修改原文件（先复制到临时目录）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PYTHON = process.env.PLATFORM_PYTHON_PATH || 'python3';
const MASK_SCRIPT = path.join(__dirname, '..', 'scripts', 'mask_wrapper.py');

function isAllowedPath(p) {
  const resolved = path.resolve(String(p || ''));
  const roots = [ROOT, os.tmpdir()];
  return roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
}

function runPython(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(PYTHON, [MASK_SCRIPT, ...args], { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? err.message : null });
    });
  });
}

/** 确定性文本脱敏；返回 maskedText 与记录（不保留原始敏感值） */
export function maskText(text) {
  let out = String(text || '');
  const records = [];
  const add = (field, method, before, after) => {
    if (before === after) return;
    records.push({ field, method, maskedSample: after.slice(0, 80) });
  };

  // 1. 口令/令牌（先处理，避免被后续数字规则误伤）
  out = out.replace(/((?:password|passwd|pwd|secret|token|authorization|cookie)\s*[:=：]\s*)([^\s,;，；]+)/gi, (m, p1, p2) => {
    add('口令/令牌', '整值替换', p2, '***');
    return `${p1}***`;
  });

  // 2. 身份证（18 位 / 15 位）
  out = out.replace(/\b(\d{3})\d{11}(\d{4})\b/g, (m, a, b) => {
    const masked = `${a}***********${b}`;
    add('身份证号', '掩码(前3后4)', m, masked);
    return masked;
  });
  out = out.replace(/\b(\d{3})\d{8}(\d{4})\b/g, (m, a, b) => {
    const masked = `${a}********${b}`;
    add('身份证号', '掩码(前3后4)', m, masked);
    return masked;
  });

  // 3. 手机号（可带 +86）
  out = out.replace(/(?<!\d)(?:\+?86[-\s]?)?(1[3-9]\d{9})(?!\d)/g, (m, phone) => {
    const masked = `${phone.slice(0, 3)}****${phone.slice(-4)}`;
    add('手机号', '掩码(前3后4)', m, masked);
    return masked;
  });

  // 4. 邮箱
  out = out.replace(/\b([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (m, first, rest, domain) => {
    const masked = `${first}***@${domain}`;
    add('邮箱', '掩码(用户名首字母)', m, masked);
    return masked;
  });

  // 5. 银行卡（16-19 位，保留前 6 后 4）
  out = out.replace(/\b(\d{6})\d{6,9}(\d{4})\b/g, (m, a, b) => {
    const masked = `${a}${'*'.repeat(Math.max(4, m.length - 10))}${b}`;
    add('银行卡号', '掩码(前6后4)', m, masked);
    return masked;
  });

  // 6. 姓名（标签后的 2-4 个中文）
  out = out.replace(/((?:姓名|名字|联系人|用户)\s*[:：]?\s*)([\u4e00-\u9fa5]{2,4})/g, (m, p1, name) => {
    const masked = `${name[0]}${'*'.repeat(Math.max(1, name.length - 1))}`;
    add('姓名', '掩码(保留姓)', name, masked);
    return `${p1}${masked}`;
  });

  // 7. 地址（保留前 6 个字符）
  out = out.replace(/((?:地址|住址|收货地址)\s*[:：]?\s*)([^\n,，;；]{6,60})/g, (m, p1, addr) => {
    const masked = `${addr.slice(0, 6)}***`;
    add('地址', '截断掩码', addr, masked);
    return `${p1}${masked}`;
  });

  return { maskedText: out, records, fieldsMasked: records.length };
}

async function maskFile(filePath, params = {}) {
  if (!filePath) return null;
  if (!isAllowedPath(filePath)) {
    return { success: false, error: '文件路径不在允许范围内（仅项目目录或临时目录）' };
  }
  if (!fs.existsSync(filePath)) return { success: false, error: `文件不存在: ${filePath}` };
  if (!fs.existsSync(MASK_SCRIPT)) return { success: false, error: 'mask_wrapper.py 不存在' };

  const ext = path.extname(filePath).toLowerCase();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-mask-'));
  const inputCopy = path.join(tmpDir, `input${ext}`);
  fs.copyFileSync(filePath, inputCopy);

  try {
    if (['.docx', '.doc'].includes(ext)) {
      const r = await runPython(['docx', inputCopy]);
      const output = path.join(tmpDir, `input_脱敏${ext}`);
      if (!r.ok || !fs.existsSync(output)) {
        return { success: false, error: r.stderr || r.error || 'docx 脱敏失败（可能缺少 python-docx）' };
      }
      return { success: true, type: 'docx', input: filePath, outputPath: output };
    }
    if (['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext)) {
      const outPath = path.join(tmpDir, `masked${ext}`);
      const r = await runPython(['image', inputCopy, '--output', outPath, '--method', params.method || 'blur']);
      if (!r.ok || !fs.existsSync(outPath)) {
        return { success: false, error: r.stderr || r.error || '图片脱敏失败（可能缺少 opencv/easyocr）' };
      }
      return { success: true, type: 'image', input: filePath, outputPath: outPath };
    }
    return { success: false, error: `不支持的文件类型: ${ext}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function invoke(params = {}) {
  const text = params.text || params.content || params.input || '';
  const filePath = params.filePath || params.path || '';
  const results = [];

  let fileResult = null;
  if (filePath) {
    fileResult = await maskFile(filePath, params);
    if (fileResult && !fileResult.success && !text) return fileResult;
    if (fileResult) results.push(fileResult);
  }

  let textResult = null;
  if (text) {
    textResult = maskText(text);
    results.push({ success: true, type: 'text', ...textResult });
  }

  if (!results.length) {
    return { success: false, error: '缺少待脱敏内容（text 或 filePath）' };
  }

  return {
    success: results.every((r) => r.success !== false),
    tool: 'data-masking',
    text: textResult ? textResult.maskedText : undefined,
    maskedText: textResult ? textResult.maskedText : undefined,
    records: textResult ? textResult.records : [],
    fieldsMasked: textResult ? textResult.fieldsMasked : 0,
    file: fileResult || undefined,
    results,
  };
}

export default { invoke };
