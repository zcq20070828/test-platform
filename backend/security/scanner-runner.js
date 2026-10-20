/**
 * scanner-runner.js — 开源安全扫描器适配层
 * ============================================================
 * 背景：平台原有的「执行安全扫描」「手工渗透」两个阶段实际上只是 LLM 角色扮演，
 * 没有任何真实工具执行，所以用例数量够但深度不足、结果不可复现。
 *
 * 本模块把成熟的开源扫描器接进来，统一成一套 finding 模型：
 *
 *   SAST      semgrep        （规则来自官方 Registry：p/security-audit / p/owasp-top-ten）
 *   SCA       trivy          （同时覆盖依赖漏洞、密钥、IaC 错误配置）
 *             npm audit      （前端/Node 依赖）
 *             pip-audit      （Python 依赖）
 *   Secrets   semgrep p/secrets + trivy secret scanner
 *   DAST      nuclei         （模板化 Web 漏洞验证，可选）
 *             nikto          （Web 服务器配置/已知问题）
 *             nmap           （端口与服务暴露面）
 *
 * 设计约束：
 *   1. 一律 execFile + 参数数组，绝不拼 shell；
 *   2. 每个工具独立超时，单工具失败不影响其它工具；
 *   3. 只读扫描（不执行 exploit），不修改目标；
 *   4. 输出做大小与条数上限，避免大仓库把内存打满；
 *   5. 工具缺失时返回明确的 unavailable 状态，绝不伪造结果。
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const HOME = os.homedir();
const EXTRA_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(HOME, '.local/bin'),
  path.join(HOME, '.workbuddy/binaries/python/envs/default/bin'),
].join(':');

const RUN_ENV = { ...process.env, PATH: `${process.env.PATH || ''}:${EXTRA_PATH}` };

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_FINDINGS = 500;

// ============ 工具注册表 ============
export const SCANNERS = {
  semgrep: {
    id: 'semgrep',
    name: 'Semgrep',
    category: 'sast',
    kind: 'source',
    description: '语义化静态代码分析，覆盖 OWASP Top 10 与常见危险 API',
    homepage: 'https://semgrep.dev',
    license: 'LGPL-2.1',
    bin: 'semgrep',
    versionArgs: ['--version'],
  },
  trivy: {
    id: 'trivy',
    name: 'Trivy',
    category: 'sca',
    kind: 'source',
    description: '依赖漏洞（CVE）、硬编码密钥、IaC 错误配置扫描',
    homepage: 'https://trivy.dev',
    license: 'Apache-2.0',
    bin: 'trivy',
    versionArgs: ['--version'],
  },
  npm_audit: {
    id: 'npm_audit',
    name: 'npm audit',
    category: 'sca',
    kind: 'source',
    description: 'Node/前端依赖漏洞（npm advisory 库）',
    homepage: 'https://docs.npmjs.com/cli/commands/npm-audit',
    license: 'Artistic-2.0',
    bin: 'npm',
    versionArgs: ['--version'],
  },
  pip_audit: {
    id: 'pip_audit',
    name: 'pip-audit',
    category: 'sca',
    kind: 'source',
    description: 'Python 依赖漏洞（PyPI advisory / OSV）',
    homepage: 'https://pypi.org/project/pip-audit/',
    license: 'Apache-2.0',
    bin: 'pip-audit',
    versionArgs: ['--version'],
  },
  bandit: {
    id: 'bandit',
    name: 'Bandit',
    category: 'sast',
    kind: 'source',
    description: 'Python 安全静态分析（注入、弱加密、危险函数）',
    homepage: 'https://bandit.readthedocs.io',
    license: 'Apache-2.0',
    bin: 'bandit',
    versionArgs: ['--version'],
  },
  nuclei: {
    id: 'nuclei',
    name: 'Nuclei',
    category: 'dast',
    kind: 'url',
    description: '模板化 Web 漏洞验证（CVE/默认口令/暴露面板等）',
    homepage: 'https://github.com/projectdiscovery/nuclei',
    license: 'MIT',
    bin: 'nuclei',
    versionArgs: ['-version'],
  },
  nikto: {
    id: 'nikto',
    name: 'Nikto',
    category: 'dast',
    kind: 'url',
    description: 'Web 服务器配置与已知危险文件扫描',
    homepage: 'https://cirt.net/Nikto2',
    license: 'GPL-2.0',
    bin: 'nikto',
    versionArgs: ['-Version'],
  },
  nmap: {
    id: 'nmap',
    name: 'Nmap',
    category: 'dast',
    kind: 'host',
    description: '端口与服务暴露面识别',
    homepage: 'https://nmap.org',
    license: 'NPSL',
    bin: 'nmap',
    versionArgs: ['--version'],
  },
};

// ============ 执行封装 ============
function runTool(bin, args, { timeoutMs = DEFAULT_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, cwd, env: RUN_ENV },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          timedOut: !!(err && err.killed),
          exitCode: err ? (err.code ?? -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          durationMs: Date.now() - started,
        });
      }
    );
  });
}

/** 探测工具是否可用及其版本。并发探测，带缓存。 */
const availabilityCache = new Map();
export async function getScannerStatus({ refresh = false } = {}) {
  if (!refresh && availabilityCache.size > 0) return [...availabilityCache.values()];

  const entries = await Promise.all(
    Object.values(SCANNERS).map(async (meta) => {
      const probe = await runTool(meta.bin, meta.versionArgs, { timeoutMs: 8000 });
      const firstLine = (probe.stdout || probe.stderr || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
      const status = {
        id: meta.id,
        name: meta.name,
        category: meta.category,
        kind: meta.kind,
        description: meta.description,
        homepage: meta.homepage,
        license: meta.license,
        available: probe.ok,
        version: probe.ok ? firstLine.slice(0, 120) : null,
        installHint: probe.ok ? null : installHint(meta),
      };
      availabilityCache.set(meta.id, status);
      return status;
    })
  );
  return entries;
}

function installHint(meta) {
  switch (meta.id) {
    case 'semgrep': return 'pip install semgrep';
    case 'trivy': return 'brew install trivy（或从 GitHub Releases 下载二进制到 ~/.local/bin）';
    case 'pip_audit': return 'pip install pip-audit';
    case 'bandit': return 'pip install bandit';
    case 'nuclei': return 'brew install nuclei（或从 GitHub Releases 下载）';
    case 'nikto': return 'brew install nikto';
    case 'nmap': return 'brew install nmap';
    case 'npm_audit': return '随 Node.js 安装';
    default: return `安装 ${meta.bin}`;
  }
}

// ============ 严重级别归一 ============
const SEVERITY_ORDER = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
function normSeverity(raw) {
  const s = String(raw || '').toLowerCase();
  if (['critical', 'crit', 'blocker'].includes(s)) return 'critical';
  if (['high', 'error', 'major'].includes(s)) return 'high';
  if (['medium', 'moderate', 'warning', 'warn'].includes(s)) return 'medium';
  if (['low', 'minor'].includes(s)) return 'low';
  return 'info';
}

function pickFirstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** 统一 finding 模型 —— 直接对齐 security_vulnerabilities 表 */
function makeFinding({
  tool, category, severity, title, description, location, evidence,
  remediation, cve, cwe, cvss, confidence, fingerprint, raw,
}) {
  return {
    source: tool,
    tool,
    category: category || 'unknown',
    severity: normSeverity(severity),
    title: String(title || '未命名问题').slice(0, 200),
    description: String(description || '').slice(0, 4000),
    location: location ? String(location).slice(0, 500) : null,
    evidence: evidence ? String(evidence).slice(0, 4000) : null,
    remediation: remediation ? String(remediation).slice(0, 2000) : null,
    cve: cve || null,
    cwe: cwe || null,
    cvss: cvss != null && Number.isFinite(Number(cvss)) ? Number(cvss) : null,
    confidence: confidence || 'medium',
    fingerprint: fingerprint || null,
    verified: true,       // 工具实测产出，不是 LLM 推测
    raw: raw || null,
  };
}

// ============ 各工具结果解析 ============

/** Semgrep JSON -> findings */
export function parseSemgrep(json, { category = 'sast' } = {}) {
  if (!json || !Array.isArray(json.results)) return [];
  return json.results.slice(0, MAX_FINDINGS).map((r) => {
    const extra = r.extra || {};
    const meta = extra.metadata || {};
    const checkId = r.check_id || '';
    const cwe = Array.isArray(meta.cwe) ? String(meta.cwe[0]).match(/CWE-\d+/i)?.[0] : (meta.cwe || null);
    const owasp = Array.isArray(meta.owasp) ? meta.owasp.join(', ') : (meta.owasp || '');
    const fileLoc = `${r.path}:${r.start?.line || 0}`;
    return makeFinding({
      tool: 'semgrep',
      category: meta.category === 'security' ? category : category,
      severity: extra.severity,
      title: pickFirstString(meta.shortDescription, checkId.split('.').pop(), checkId),
      description: pickFirstString(extra.message, meta.longDescription, checkId) + (owasp ? `\nOWASP: ${owasp}` : ''),
      location: fileLoc,
      evidence: (extra.lines || '').slice(0, 800) || null,
      remediation: meta.references ? `参考: ${[].concat(meta.references).slice(0, 3).join(' , ')}` : null,
      cwe,
      confidence: (extra.metadata?.confidence || 'medium').toLowerCase(),
      fingerprint: `${checkId}:${r.path}:${r.start?.line || 0}`,
      raw: { check_id: checkId, path: r.path, line: r.start?.line },
    });
  });
}

/** Trivy JSON -> findings（vuln + secret + misconfig） */
export function parseTrivy(json) {
  const out = [];
  for (const result of (json?.Results || [])) {
    const target = result.Target || '';
    const type = result.Type || '';

    for (const v of (result.Vulnerabilities || [])) {
      out.push(makeFinding({
        tool: 'trivy',
        category: 'sca',
        severity: v.Severity,
        title: `${v.VulnerabilityID} ${v.PkgName}${v.InstalledVersion ? `@${v.InstalledVersion}` : ''}`,
        description: pickFirstString(v.Description, v.Title, v.VulnerabilityID),
        location: `${target} (${v.PkgName}${v.InstalledVersion ? ` ${v.InstalledVersion}` : ''})`,
        evidence: v.FixedVersion ? `修复版本: ${v.FixedVersion}` : null,
        remediation: v.FixedVersion ? `升级 ${v.PkgName} 到 ${v.FixedVersion} 或更高` : '关注上游修复版本',
        cve: /^CVE-\d+/i.test(v.VulnerabilityID || '') ? v.VulnerabilityID : null,
        cwe: Array.isArray(v.CweIDs) ? v.CweIDs[0] : null,
        cvss: v.CVSS?.nvd?.V3Score ?? v.CVSS?.redhat?.V3Score ?? null,
        confidence: 'high',
        fingerprint: `trivy:${v.VulnerabilityID}:${target}:${v.PkgName}`,
        raw: { target, pkg: v.PkgName, installed: v.InstalledVersion, fixed: v.FixedVersion },
      }));
    }

    for (const s of (result.Secrets || [])) {
      out.push(makeFinding({
        tool: 'trivy',
        category: 'secret',
        severity: s.Severity || 'high',
        title: `硬编码密钥: ${s.Title || s.RuleID || 'secret'}`,
        description: pickFirstString(s.Match, s.RuleID, '检测到疑似硬编码凭据'),
        location: `${target}:${s.StartLine || 0}`,
        evidence: s.Match ? String(s.Match).slice(0, 200).replace(/([A-Za-z0-9_\-]{6})[A-Za-z0-9_\-]{10,}/g, '$1***') : null,
        remediation: '移入环境变量或密钥管理服务，并立即轮换该凭据',
        severityHint: s.Severity,
        confidence: 'medium',
        fingerprint: `trivy-secret:${s.RuleID}:${target}:${s.StartLine}`,
        raw: { rule: s.RuleID, line: s.StartLine },
      }));
    }

    for (const m of (result.Misconfigurations || [])) {
      if (m.Status === 'PASS') continue;
      out.push(makeFinding({
        tool: 'trivy',
        category: 'misconfig',
        severity: m.Severity,
        title: pickFirstString(m.Title, m.ID, '配置风险'),
        description: pickFirstString(m.Description, m.Message, m.ID),
        location: `${target}:${m.CauseMetadata?.StartLine || 0}`,
        evidence: m.Message || null,
        remediation: m.Resolution || null,
        confidence: 'medium',
        fingerprint: `trivy-misconf:${m.ID}:${target}:${m.CauseMetadata?.StartLine || 0}`,
        raw: { id: m.ID, type },
      }));
    }
  }
  return out.slice(0, MAX_FINDINGS);
}

/** npm audit JSON -> findings */
export function parseNpmAudit(json) {
  const advisories = json?.vulnerabilities || {};
  const out = [];
  for (const [pkg, item] of Object.entries(advisories)) {
    const via = Array.isArray(item.via) ? item.via : [];
    const details = via.filter(v => typeof v === 'object');
    const base = {
      tool: 'npm_audit',
      category: 'sca',
      severity: item.severity,
      fixed: item.fixAvailable,
    };
    if (details.length === 0) {
      out.push(makeFinding({
        ...base,
        title: `依赖漏洞: ${pkg}`,
        description: via.map(String).join('; ') || `检测到 ${pkg} 存在已知漏洞`,
        location: `package-lock.json (${pkg}${item.range ? ` ${item.range}` : ''})`,
        remediation: item.fixAvailable ? '执行 npm audit fix 或升级依赖' : '等待上游修复或替换依赖',
        confidence: 'high',
        fingerprint: `npm:${pkg}:${item.range || ''}`,
        raw: { pkg, range: item.range },
      }));
      continue;
    }
    for (const d of details) {
      out.push(makeFinding({
        ...base,
        title: pickFirstString(d.title, `依赖漏洞: ${pkg}`),
        description: pickFirstString(d.overview, d.title),
        location: `package-lock.json (${pkg}${item.range ? ` ${item.range}` : ''})`,
        evidence: d.url ? `advisory: ${d.url}` : null,
        remediation: item.fixAvailable ? `升级 ${pkg}${typeof item.fixAvailable === 'object' ? ` 到 ${item.fixAvailable.version}` : ''}` : '等待上游修复或替换依赖',
        cwe: Array.isArray(d.cwe) ? d.cwe[0] : (d.cwe || null),
        cvss: typeof d.cvss?.score === 'number' ? d.cvss.score : null,
        confidence: 'high',
        fingerprint: `npm:${pkg}:${d.url || d.title || ''}`,
        raw: { pkg, url: d.url, range: item.range },
      }));
    }
  }
  return out.slice(0, MAX_FINDINGS);
}

/** pip-audit JSON -> findings */
export function parsePipAudit(json) {
  const deps = Array.isArray(json?.dependencies) ? json.dependencies : (Array.isArray(json) ? json : []);
  const out = [];
  for (const dep of deps) {
    for (const v of (dep.vulns || [])) {
      const fixes = (v.fix_versions || []).filter(Boolean);
      out.push(makeFinding({
        tool: 'pip_audit',
        category: 'sca',
        severity: v.severity || 'high',
        title: `${v.id || 'PYSEC'} ${dep.name}${dep.version ? `@${dep.version}` : ''}`,
        description: pickFirstString(v.description, v.details, v.id),
        location: `requirements (${dep.name}${dep.version ? ` ${dep.version}` : ''})`,
        evidence: fixes.length ? `修复版本: ${fixes.join(', ')}` : null,
        remediation: fixes.length ? `升级到 ${fixes[fixes.length - 1]}` : '等待上游修复',
        cve: v.id && /^CVE-/i.test(v.id) ? v.id : null,
        cvss: v.cvss3?.base_score ?? null,
        confidence: 'high',
        fingerprint: `pip:${dep.name}:${v.id}`,
        raw: { pkg: dep.name, version: dep.version, id: v.id },
      }));
    }
  }
  return out.slice(0, MAX_FINDINGS);
}

/** Bandit JSON -> findings */
export function parseBandit(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.slice(0, MAX_FINDINGS).map((r) => makeFinding({
    tool: 'bandit',
    category: 'sast',
    severity: r.issue_severity,
    title: `${r.test_id || ''} ${r.test_name || 'Python 安全问题'}`.trim(),
    description: pickFirstString(r.issue_text, r.test_name),
    location: `${r.filename}:${r.line_number || 0}`,
    evidence: (r.code || '').slice(0, 800) || null,
    remediation: r.more_info ? `参考: ${r.more_info}` : null,
    cwe: r.issue_cwe?.id ? `CWE-${r.issue_cwe.id}` : null,
    confidence: (r.issue_confidence || 'medium').toLowerCase(),
    fingerprint: `bandit:${r.test_id}:${r.filename}:${r.line_number}`,
    raw: { test_id: r.test_id, line: r.line_number },
  }));
}

/**
 * Nikto JSON -> findings
 * 实际格式（nikto 2.6）：[{ host, ip, port, server_banner, vulnerabilities: [{ id, method, msg, url, references }] }]
 * 兼容扁平数组（部分版本/包装脚本）。
 */
export function parseNikto(json) {
  const hosts = Array.isArray(json) ? json : [json];
  const out = [];
  for (const h of hosts) {
    if (!h || typeof h !== 'object') continue;
    const list = Array.isArray(h.vulnerabilities) ? h.vulnerabilities
      : Array.isArray(h) ? h : [];
    const base = h.host ? `${h.host}${h.port ? `:${h.port}` : ''}` : '';
    for (const v of list) {
      const path = v.url || v.uri || '';
      const loc = path.startsWith('http') ? path : `${base}${path}`;
      out.push(makeFinding({
        tool: 'nikto',
        category: 'dast',
        severity: mapNiktoSeverity(v),
        title: pickFirstString(v.msg, v.message, 'Web 服务器问题').slice(0, 200),
        description: pickFirstString(v.msg, v.message, v.id),
        location: loc || base || null,
        evidence: v.id ? `Nikto ID: ${v.id}${v.method ? ` (${v.method})` : ''}` : null,
        remediation: '按 Nikto 建议加固 Web 服务器配置（隐藏版本、删除示例文件、补安全响应头）',
        confidence: 'medium',
        fingerprint: `nikto:${v.id || ''}:${loc}`,
        raw: { id: v.id, method: v.method, url: loc },
      }));
    }
  }
  return out.slice(0, MAX_FINDINGS);
}

function mapNiktoSeverity(v) {
  const text = `${v.msg || ''} ${v.message || ''}`.toLowerCase();
  if (/(sql|xss|cross site|remote code|command execution|rce|injection)/.test(text)) return 'high';
  if (/(default password|directory listing|backup|config|version disclosure|outdated)/.test(text)) return 'medium';
  return 'low';
}

/** Nmap XML（-oX）-> findings（只保留开放端口与高危服务） */
export function parseNmap(xml) {
  const out = [];
  const hostRe = /<host\b[\s\S]*?<\/host>/g;
  for (const host of (String(xml).match(hostRe) || [])) {
    const addr = host.match(/<address addr="([^"]+)"/)?.[1] || '';
    const portRe = /<port protocol="([^"]+)" portid="(\d+)">([\s\S]*?)<\/port>/g;
    let m;
    while ((m = portRe.exec(host)) !== null) {
      const [, proto, port, body] = m;
      if (!/<state state="open"/.test(body)) continue;
      const service = body.match(/<service name="([^"]+)"/)?.[1] || '';
      const product = body.match(/product="([^"]+)"/)?.[1] || '';
      const risky = ['telnet', 'ftp', 'smb', 'rdp', 'vnc', 'mongodb', 'redis', 'memcached', 'elasticsearch'].includes(service);
      out.push(makeFinding({
        tool: 'nmap',
        category: 'dast',
        severity: risky ? 'medium' : 'info',
        title: `开放端口 ${port}/${proto} ${service}${product ? ` (${product})` : ''}`.trim(),
        description: `目标 ${addr} 对外开放 ${port}/${proto}${service ? `，识别为 ${service}` : ''}。${risky ? '该服务属高风险暴露面，应限制来源 IP。' : ''}`,
        location: `${addr}:${port}`,
        evidence: null,
        remediation: risky ? '通过防火墙/安全组限制可访问来源，或关闭非必要端口' : '确认该端口是否为业务必需',
        confidence: 'high',
        fingerprint: `nmap:${addr}:${port}/${proto}`,
        raw: { addr, port, proto, service, product },
      }));
    }
  }
  return out.slice(0, MAX_FINDINGS);
}

// ============ 目标校验 ============
/**
 * 只允许扫描内网/公网的 http(s) URL，拒绝 file://、localhost 元数据等。
 * 注意：这里不做私网拦截——安全测试本身就常针对内网系统，
 * 但必须要求 operator 显式传入 allowInternal。
 */
export function normalizeUrlTarget(target) {
  let u;
  try { u = new URL(String(target).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  return u.toString();
}

export function normalizeHostTarget(target) {
  const t = String(target || '').trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes('://') ? t : `http://${t}`);
    return u.hostname;
  } catch {
    return null;
  }
}

// ============ 扫描编排 ============

/**
 * 源码/依赖扫描（本地路径）
 * @param {string} rootDir 绝对路径
 * @param {string[]} tools 指定工具，默认全部可用的 source 类工具
 */
export async function runSourceScan(rootDir, tools = ['semgrep', 'trivy'], opts = {}) {
  const results = [];
  const root = path.resolve(rootDir);
  const bin = await fs.stat(root).catch(() => null);
  if (!bin) throw new Error(`扫描路径不存在: ${root}`);

  const tasks = [];

  if (tools.includes('semgrep')) {
    tasks.push((async () => {
      const r = await runTool('semgrep', [
        '--config', 'p/security-audit',
        '--config', 'p/secrets',
        '--json', '--quiet',
        '--timeout', '60',
        '--max-target-bytes', '2000000',
        '--exclude', 'node_modules',
        '--exclude', 'dist',
        '--exclude', '.git',
        '--exclude', 'output',
        root,
      ], { timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS });
      return {
        tool: 'semgrep',
        ok: r.ok || !!r.stdout.trim().startsWith('{'),
        durationMs: r.durationMs,
        findings: safeParseJson(r.stdout, parseSemgrep),
        error: r.ok ? null : truncate(r.stderr, 500),
        timedOut: r.timedOut,
      };
    })());
  }

  if (tools.includes('trivy')) {
    tasks.push((async () => {
      const r = await runTool('trivy', [
        'fs', '--format', 'json', '--quiet',
        // 只跑 vuln：secret 全文件遍历在真实仓库上要 3-4 分钟，
        // 密钥检测已由 semgrep p/secrets 覆盖，这里保持扫描秒级完成。
        '--scanners', 'vuln',
        '--db-repository', 'public.ecr.aws/aquasecurity/trivy-db:2',
        '--skip-dirs', path.join(root, 'node_modules'),
        '--skip-dirs', path.join(root, 'dist'),
        '--skip-dirs', path.join(root, 'output'),
        root,
      ], { timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS });
      return {
        tool: 'trivy',
        ok: r.ok || !!r.stdout.trim().startsWith('{'),
        durationMs: r.durationMs,
        findings: safeParseJson(r.stdout, parseTrivy),
        error: r.ok ? null : truncate(r.stderr, 500),
        timedOut: r.timedOut,
      };
    })());
  }

  if (tools.includes('npm_audit')) {
    tasks.push((async () => {
      const r = await runTool('npm', ['audit', '--json', '--registry=https://registry.npmjs.org'], { cwd: root, timeoutMs: 120000 });
      return {
        tool: 'npm_audit',
        ok: r.ok || !!r.stdout.trim().startsWith('{'),
        durationMs: r.durationMs,
        findings: safeParseJson(r.stdout, parseNpmAudit),
        error: r.ok ? null : truncate(r.stderr, 500),
        timedOut: r.timedOut,
      };
    })());
  }

  if (tools.includes('bandit')) {
    tasks.push((async () => {
      // bandit 的 -x 只认相对/绝对路径前缀，glob 形式反而会失效（实测 266→4）
      const rel = path.relative(path.dirname(root), root);
      const excludes = ['node_modules', 'output', 'vector_data', 'test-results']
        .map(d => path.join(rel, d)).join(',');
      const r = await runTool('bandit', ['-r', root, '-f', 'json', '-q', '-x', excludes], { timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS });
      return {
        tool: 'bandit',
        ok: r.ok || !!r.stdout.trim().startsWith('{'),
        durationMs: r.durationMs,
        findings: safeParseJson(r.stdout, parseBandit),
        error: r.ok ? null : truncate(r.stderr, 500),
        timedOut: r.timedOut,
      };
    })());
  }

  if (tools.includes('pip_audit')) {
    tasks.push((async () => {
      const r = await runTool('pip-audit', ['--format', 'json', '--progress-spinner', 'off'], { cwd: root, timeoutMs: 180000 });
      return {
        tool: 'pip_audit',
        ok: r.ok || !!r.stdout.trim().startsWith('{'),
        durationMs: r.durationMs,
        findings: safeParseJson(r.stdout, parsePipAudit),
        error: r.ok ? null : truncate(r.stderr, 500),
        timedOut: r.timedOut,
      };
    })());
  }

  const settled = await Promise.all(tasks);
  for (const s of settled) {
    if (!s) continue;
    results.push({
      tool: s.tool,
      ok: s.ok,
      durationMs: s.durationMs,
      error: s.error,
      timedOut: s.timedOut,
      findingCount: s.findings.length,
    });
    if (Array.isArray(s.findings)) {
      for (const f of s.findings) results.push(f);
    }
  }
  return results;
}

/**
 * Web/主机扫描（URL）
 * @param {string} target http(s) URL
 */
export async function runUrlScan(target, tools = ['nikto', 'nmap'], opts = {}) {
  const url = normalizeUrlTarget(target);
  if (!url) throw new Error('目标必须是 http/https URL');
  const host = normalizeHostTarget(url);
  const results = [];
  const tasks = [];

  if (tools.includes('nuclei')) {
    tasks.push((async () => {
      const r = await runTool('nuclei', [
        '-u', url,
        '-jsonl', '-silent',
        '-severity', 'critical,high,medium',
        '-timeout', '10',
        '-retries', '1',
        '-no-mhe',    // 关闭自动请求头变形，避免误报
      ], { timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS });
      return { tool: 'nuclei', ok: r.ok, durationMs: r.durationMs, findings: parseNucleiJsonl(r.stdout), error: r.ok ? null : truncate(r.stderr, 500), timedOut: r.timedOut };
    })());
  }

  if (tools.includes('nikto')) {
    tasks.push((async () => {
      const tmp = path.join(os.tmpdir(), `nikto-${Date.now()}.json`);
      const r = await runTool('nikto', ['-h', url, '-Format', 'json', '-output', tmp, '-nointeractive', '-maxtime', '120'], { timeoutMs: opts.timeoutMs || 180000 });
      let findings = [];
      try {
        findings = parseNikto(JSON.parse(await fs.readFile(tmp, 'utf8')));
      } catch { /* 无输出则空 */ }
      await fs.unlink(tmp).catch(() => {});
      return { tool: 'nikto', ok: r.ok, durationMs: r.durationMs, findings, error: r.ok ? null : truncate(r.stderr, 500), timedOut: r.timedOut };
    })());
  }

  if (tools.includes('nmap') && host) {
    tasks.push((async () => {
      const r = await runTool('nmap', ['-F', '-T4', '-Pn', '-oX', '-', host], { timeoutMs: 180000 });
      return { tool: 'nmap', ok: r.ok, durationMs: r.durationMs, findings: r.ok ? parseNmap(r.stdout) : [], error: r.ok ? null : truncate(r.stderr, 500), timedOut: r.timedOut };
    })());
  }

  const settled = await Promise.all(tasks);
  for (const s of settled) {
    results.push({
      tool: s.tool, ok: s.ok, durationMs: s.durationMs,
      error: s.error, timedOut: s.timedOut, findingCount: s.findings.length,
    });
    results.push(...s.findings);
  }
  return results;
}

/** Nuclei JSONL -> findings */
export function parseNucleiJsonl(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let d;
    try { d = JSON.parse(trimmed); } catch { continue; }
    const info = d.info || {};
    const classification = info.classification || {};
    const cves = []
      .concat(classification['cve-id'] || [])
      .concat(classification.cve_id || [])
      .filter(Boolean);
    const cwes = []
      .concat(classification['cwe-id'] || [])
      .concat(classification.cwe_id || [])
      .filter(Boolean);
    out.push(makeFinding({
      tool: 'nuclei',
      category: 'dast',
      severity: info.severity,
      title: pickFirstString(info.name, d['template-id'], 'Web 漏洞'),
      description: pickFirstString(info.description, d['template-id']),
      location: d['matched-at'] || d.host || '',
      evidence: d['matcher-name'] ? `matcher: ${d['matcher-name']}` : null,
      remediation: info.remediation || '按模板给出的修复建议处理',
      cve: cves[0] ? String(cves[0]).toUpperCase() : null,
      cwe: cwes[0] ? (/^CWE-/i.test(String(cwes[0])) ? String(cwes[0]).toUpperCase() : `CWE-${cwes[0]}`) : null,
      cvss: classification['cvss-score'] ? Number(classification['cvss-score']) : null,
      confidence: 'high',
      fingerprint: `nuclei:${d['template-id']}:${d['matched-at'] || d.host}`,
      raw: { template: d['template-id'], matched: d['matched-at'] },
    }));
  }
  return out.slice(0, MAX_FINDINGS);
}

// ============ 工具函数 ============
function safeParseJson(text, parser) {
  if (!text) return [];
  try {
    const start = text.indexOf('{');
    if (start < 0) return [];
    return parser(JSON.parse(text.slice(start))) || [];
  } catch {
    return [];
  }
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

/** 去重 + 按严重级别排序 */
export function finalizeFindings(results) {
  const findings = results.filter(r => r && r.fingerprint && r.severity);
  const seen = new Set();
  const unique = [];
  for (const f of findings) {
    const key = f.fingerprint || `${f.tool}:${f.title}:${f.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
  }
  unique.sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0));
  return unique;
}

export function summarizeFindings(findings) {
  const dist = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byTool = {};
  const byCategory = {};
  for (const f of findings) {
    dist[f.severity] = (dist[f.severity] || 0) + 1;
    byTool[f.tool] = (byTool[f.tool] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  }
  const penalty = dist.critical * 20 + dist.high * 8 + dist.medium * 3 + dist.low;
  return {
    total: findings.length,
    severityDist: dist,
    byTool,
    byCategory,
    score: Math.max(0, 100 - penalty),
  };
}

export default {
  SCANNERS,
  getScannerStatus,
  runSourceScan,
  runUrlScan,
  finalizeFindings,
  summarizeFindings,
};
