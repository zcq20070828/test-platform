/**
 * OWASP Top 10 知识库自动更新生成器
 *
 * 数据流:
 *   1. fetchOwaspOfficial()   - 从 OWASP GitHub 拉 2021 英文版 A01-A10 原文
 *   2. enhanceWithLLM()       - 用 security-sentinel 把原文 + 本地规则合成最终文档
 *   3. writeKnowledgeBase()   - 写入 ~/.qclaw/knowledge-base/general/
 *
 * 设计:
 *   - OWASP 源: https://github.com/OWASP/Top10/tree/master/2021/docs/en
 *   - 每条 A0x 一个 md 文件, 包含 Factors/Overview/Description/How to Prevent
 *   - LLM 增强: 把原文翻译成中文 + 提取 CWE 列表 + 生成检测向量 + 生成正则
 *   - 网络失败重试 3 次, 仍失败抛错由前端提示重试
 *   - 混合策略: OWASP 原文为权威事实, LLM 只做翻译/提炼/补充
 *
 * 维护:
 *   - OWASP_RULES 是基础事实, OWASP 源有则覆盖
 *   - LATEST_VECTORS 是增量补充(本地维护, LLM 可扩展)
 *
 * 依赖 spawnAgentSession: 由调用方传参或从 globalThis 获取（避免循环依赖）
 */

const OWASP_REPO = 'OWASP/Top10';
const OWASP_BRANCH = 'master';
const OWASP_DOCS_PATH = '2021/docs/en';
const OWASP_VERSION = '2021';

const AXX_FILES = [
  { code: 'A01', file: 'A01_2021-Broken_Access_Control.md', fallback: 'A01' },
  { code: 'A02', file: 'A02_2021-Cryptographic_Failures.md', fallback: 'A02' },
  { code: 'A03', file: 'A03_2021-Injection.md', fallback: 'A03' },
  { code: 'A04', file: 'A04_2021-Insecure_Design.md', fallback: 'A04' },
  { code: 'A05', file: 'A05_2021-Security_Misconfiguration.md', fallback: 'A05' },
  { code: 'A06', file: 'A06_2021-Vulnerable_and_Outdated_Components.md', fallback: 'A06' },
  { code: 'A07', file: 'A07_2021-Identification_and_Authentication_Failures.md', fallback: 'A07' },
  { code: 'A08', file: 'A08_2021-Software_and_Data_Integrity_Failures.md', fallback: 'A08' },
  { code: 'A09', file: 'A09_2021-Security_Logging_and_Monitoring_Failures.md', fallback: 'A09' },
  { code: 'A10', file: 'A10_2021-Server-Side_Request_Forgery_(SSRF).md', fallback: 'A10' },
];

// ─── 本地基础事实(OWASP 源覆盖则用源) ──────────────────────────────
const OWASP_RULES = [
  { code: 'A01', title: '失效的访问控制', titleEn: 'Broken Access Control', severity: '高危',
    types: ['水平越权 (IDOR)', '垂直越权', '路径遍历', '权限提升'],
    cwe: ['CWE-22', 'CWE-284', 'CWE-285', 'CWE-639'],
    detection: ['改资源 ID: GET /api/profile/123 → /api/profile/124', 'JWT sub claim 篡改', '路径穿越: ../../../etc/passwd', 'HTTP 方法篡改'],
    regex: ['\\.findById\\s*\\(\\s*req\\.params\\.', 'jwt\\.verify.*ignoreExpiration', 'path\\.join.*\\.\\.\\/\\.\\.\\/\\.\\.'],
    fix: '服务端权限校验;权限检查放业务层;JWT 严格验签;路径用白名单' },
  { code: 'A02', title: '加密失败', titleEn: 'Cryptographic Failures', severity: '高危',
    types: ['硬编码密钥', '弱加密算法', '明文传输 (HTTP)', '弱随机数'],
    cwe: ['CWE-259', 'CWE-327', 'CWE-330', 'CWE-916'],
    detection: ['硬编码密码/密钥', 'MD5/SHA1/DES', 'Math.random()', 'TLS 校验关闭'],
    regex: ['(password|secret|api_?key)\\s*[:=]\\s*[\'"][^\'"]+[\'"]', 'crypto\\.createHash\\([\'"](md5|sha1)[\'"]', 'Math\\.random\\(\\)', 'verify\\s*:\\s*false'],
    fix: 'bcrypt/Argon2 哈希;AES-256-GCM;强制 HTTPS;crypto.randomBytes();关闭详细错误堆栈' },
  { code: 'A03', title: '注入', titleEn: 'Injection', severity: '严重',
    types: ['SQL 注入', 'NoSQL 注入', '命令注入', 'XSS', '模板注入'],
    cwe: ['CWE-74', 'CWE-77', 'CWE-78', 'CWE-79', 'CWE-89', 'CWE-90'],
    detection: ['SQL: 字符串拼接用户输入', 'XSS: <script>alert(1)</script>', '命令注入: ; rm -rf /', '模板注入: {{constructor}}'],
    regex: ['query\\s*\\(\\s*[\'"].*\\$\\{', 'innerHTML\\s*=\\s*[^"\']*\\+', 'dangerouslySetInnerHTML', 'v-html', 'eval\\s*\\(', 'mongodb.*\\$where\\s*:'],
    fix: '参数化查询(Prepared Statements);HTML 输出前转义;CSP 头;避免 innerHTML' },
  { code: 'A04', title: '不安全设计', titleEn: 'Insecure Design', severity: '高危',
    types: ['业务逻辑缺陷', '缺乏威胁建模', '缺少速率限制', '无审计日志'],
    cwe: ['CWE-209', 'CWE-256', 'CWE-501', 'CWE-522'],
    detection: ['业务流程可绕过', '并发问题缺幂等', '注册/找回密码无频控', '缺少 SDL'],
    regex: ['TODO.*security', 'FIXME.*security', 'rate\\s*limit.*not\\s*implemented'],
    fix: '业务用状态机建模;关键操作加幂等键;速率限制;SDL 流程;敏感操作二次验证' },
  { code: 'A05', title: '安全配置错误', titleEn: 'Security Misconfiguration', severity: '高危',
    types: ['默认配置', '调试模式', '未修补组件', '缺失安全头'],
    cwe: ['CWE-2', 'CWE-16', 'CWE-260', 'CWE-732'],
    detection: ['默认账号未修改 admin/admin123', '调试模式暴露堆栈', '管理后台暴露 /admin /actuator', '缺失 CSP/HSTS/X-Frame-Options', 'CORS * 允许', '目录列表启用'],
    regex: ['NODE_ENV.*development', 'cors\\(\\s*\\{\\s*origin\\s*:\\s*[\'"]\\*', 'swagger.*enabled.*true'],
    fix: '生产关调试;最小化安装;HTTP 安全头全量;CORS 严格白名单;版本扫描' },
  { code: 'A06', title: '易受攻击和过时的组件', titleEn: 'Vulnerable and Outdated Components', severity: '严重',
    types: ['已知 CVE 库', '未维护依赖', '过期框架'],
    cwe: ['CWE-937', 'CWE-1035', 'CWE-1104'],
    detection: ['过期 jQuery < 3.5', '过期 Log4j < 2.17', '过期 Apache Struts', '未更新的 Docker 镜像', 'npm audit 报告未处理'],
    regex: ['"jquery"\\s*:\\s*"[\\^~]?[12]\\.', '"log4j"\\s*:\\s*"[\\^~]?[01]\\.', '"openssl"\\s*:\\s*"[\\^~]?1\\.0\\.'],
    fix: '建立 SBOM;订阅 CVE;CI 集成 SCA (Snyk/Dependabot);npm audit / pip-audit' },
  { code: 'A07', title: '识别和身份认证失败', titleEn: 'Identification and Authentication Failures', severity: '高危',
    types: ['弱密码策略', '缺少 MFA', '会话固定', 'JWT 缺陷'],
    cwe: ['CWE-287', 'CWE-297', 'CWE-384', 'CWE-521'],
    detection: ['弱密码 123456', '登录无速率限制', '会话 ID 不失效', 'JWT 不验签', 'alg=none', 'Cookie 缺 Secure/HttpOnly'],
    regex: ['jwt\\.decode\\s*\\(', 'alg.*none', 'cookie.*secure.*false', 'password.*min.*length.*[1-5]'],
    fix: '密码 12+ 位含大小写数字符号;MFA;JWT HS256/RS256 严格验签;Cookie Secure+HttpOnly+SameSite' },
  { code: 'A08', title: '软件和数据完整性失败', titleEn: 'Software and Data Integrity Failures', severity: '高危',
    types: ['不安全的反序列化', '自动更新无签名', '依赖混淆'],
    cwe: ['CWE-345', 'CWE-353', 'CWE-426', 'CWE-494'],
    detection: ['pickle.loads(用户输入)', 'unserialize($_GET)', 'CI/CD 无签名', 'npm postinstall 自动执行'],
    regex: ['pickle\\.loads?\\s*\\(', 'yaml\\.load\\([^,)]*Loader\\s*=\\s*yaml\\.Loader', 'unserialize\\s*\\(\\s*\\$_(GET|POST)', 'JSON\\.parse[^)]*\\)\\s*\\.\\s*eval'],
    fix: '反序列化用签名/加密数据;CI/CD Sigstore/SLSA;npm --ignore-scripts;包管理哈希锁定' },
  { code: 'A09', title: '安全日志和监控失败', titleEn: 'Security Logging and Monitoring Failures', severity: '中危',
    types: ['缺少审计日志', '日志注入', '无可观测性', '告警缺失'],
    cwe: ['CWE-117', 'CWE-223', 'CWE-532', 'CWE-778'],
    detection: ['登录失败无日志', '敏感操作无审计', '日志可注入用户输入', 'ELK/Loki 未部署', '日志泄露 token/密码'],
    regex: ['console\\.log\\(.*\\$', 'logger\\.(info|debug).*password|token|secret'],
    fix: '认证事件全部日志;关键操作 AOP 切面;日志脱敏;ELK/Loki;SIEM 告警;6+ 月保留' },
  { code: 'A10', title: '服务端请求伪造 (SSRF)', titleEn: 'Server-Side Request Forgery', severity: '高危',
    types: ['内网探测', '云元数据访问', '协议走私'],
    cwe: ['CWE-918'],
    detection: ['fetch(req.query.url) 用户可控 URL', '云元数据 169.254.169.254', 'gopher:// dict:// file://', 'DNS rebinding', 'WebHook/图片代理被滥用'],
    regex: ['fetch\\s*\\(\\s*req\\.(query|body|params)', 'axios\\s*\\(\\s*req\\.(query|body|params)', 'requests\\.(get|post)\\s*\\(\\s*[^,)]*\\+'],
    fix: 'URL 白名单 + DNS 解析后再校验 IP 不在内网;禁 file/gopher/dict;云元数据需 IMDSv2;302 不自动跟随;内网分段隔离' },
];

// ─── 增量补充: 最新攻击手法(LLM 可扩展) ──────────────────────────
const LATEST_VECTORS = [
  { year: '2024-Q3', name: 'PyPI typosquatting 供应链投毒', pattern: 'pip install reqests' },
  { year: '2024-Q4', name: 'AI Prompt Injection', pattern: '忽略以上指令|ignore previous instructions' },
  { year: '2025-Q1', name: 'JWT kid 注入', pattern: 'jwt.verify.*kid.*req.body' },
  { year: '2025-Q2', name: 'GraphQL 批量查询 DoS', pattern: 'graphql.*depthLimit' },
];

// ─── HTTP 拉取(带重试) ──────────────────────────────────────────
async function fetchWithRetry(url, retries = 3, timeoutMs = 10000) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OWASP-KB-Updater/1.0', 'Accept': 'application/vnd.github.v3+json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return await res.text();
      if (res.status === 404) return null;  // 文件不存在不算错
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));  // 1s, 2s, 3s 退避
    }
  }
}

// ─── 抓 OWASP 官方源 ──────────────────────────────────────────
export async function fetchOwaspOfficial() {
  const results = {};
  const tasks = AXX_FILES.map(async (item) => {
    const url = `https://raw.githubusercontent.com/${OWASP_REPO}/${OWASP_BRANCH}/${OWASP_DOCS_PATH}/${item.file}`;
    try {
      const md = await fetchWithRetry(url);
      if (md) results[item.code] = { file: item.file, url, content: md, fetchedAt: new Date().toISOString() };
    } catch (e) {
      console.warn(`[OWASP] 拉取 ${item.code} 失败: ${e.message}`);
    }
  });
  await Promise.all(tasks);
  return results;
}

// ─── 简化 OWASP md: 提取 Factors/Overview/Description/How to Prevent ──
function extractOwaspSections(mdContent) {
  const out = { factors: '', overview: '', description: '', howToPrevent: '', examples: '' };
  if (!mdContent) return out;

  // 移除 mkdocs/jekyll 语法
  const clean = mdContent
    .replace(/\{\:[^}]*\}/g, '')  // {: ...}
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')  // 移除图片
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');  // 移除链接保留文字

  // 提取章节
  const sections = clean.split(/^##\s+/m);
  for (const sec of sections) {
    const title = (sec.split('\n')[0] || '').trim();
    const body = sec.split('\n').slice(1).join('\n').trim();
    if (/^Factors/i.test(title)) out.factors = body.slice(0, 800);
    else if (/^Overview/i.test(title)) out.overview = body.slice(0, 800);
    else if (/^Description/i.test(title)) out.description = body.slice(0, 2000);
    else if (/How to Prevent|How_to_Prevent/i.test(title)) out.howToPrevent = body.slice(0, 1500);
    else if (/Example Attack Scenarios|Attack Scenarios/i.test(title)) out.examples = body.slice(0, 1000);
  }
  return out;
}

// ─── LLM 增强: 让 security-sentinel 把 OWASP 英文原文转成中文检测规则 ──
// 注意: 这里不能直接 import server.js (循环依赖), 调用方传 spawnFn 或依赖 globalThis
export async function enhanceWithLLM(officialDocs, spawnFn, taskId) {
  const enhanced = {};
  // 调用方传 spawnFn(避免循环依赖), 传 null 则用 globalThis
  const actualSpawnFn = spawnFn || globalThis.spawnAgentSession;

  for (const item of AXX_FILES) {
    const code = item.code;
    const doc = officialDocs[code];
    const local = OWASP_RULES.find(r => r.code === code);
    if (!doc && !local) continue;

    const sections = doc ? extractOwaspSections(doc.content) : {};
    const systemPrompt = `你是安全测试专家。基于 OWASP ${OWASP_VERSION} ${code} 官方原文, 输出中文检测规则。
必须严格输出 JSON:
{
  "code": "${code}",
  "title_zh": "中文标题",
  "title_en": "English Title",
  "severity": "严重|高危|中危|低危",
  "summary": "150字中文概述",
  "cwe_list": ["CWE-xxx", ...],  // 从官方原文 Factors 表提取
  "attack_types": ["类型1", "类型2", ...],  // 5-10条
  "detection_methods": ["方法1", ...],  // 5-10条
  "regex_patterns": ["regex1", ...],  // 5-10条检测正则
  "fix_recommendation": "修复建议150字"
}
不要任何额外文字,只输出 JSON。`;

    const userPrompt = `OWASP 官方原文(已提取章节):
${JSON.stringify(sections, null, 2)}

本地参考规则(可补充):
${JSON.stringify({
  title: local?.title,
  types: local?.types,
  detection: local?.detection,
  regex: local?.regex,
  fix: local?.fix,
}, null, 2)}

请基于官方原文生成 JSON,本地规则仅作补充。`;

    try {
      if (!actualSpawnFn) {
        throw new Error('spawnAgentSession 未提供');
      }
      const result = await actualSpawnFn('security-sentinel',
        { systemPrompt, userMessage: userPrompt },
        taskId || `owasp-enhance-${code}`,
        null,  // streamCallback
        true,  // skipReview
        []
      );
      const text = (result?.text || result?.content || '').trim();

      // JSON 提取
      let json = null;
      const m1 = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonText = m1 ? m1[1] : text;
      const m2 = jsonText.match(/\{[\s\S]*\}/);
      if (m2) {
        try { json = JSON.parse(m2[0]); } catch {}
      }
      if (json && json.code) {
        enhanced[code] = { ...json, source: 'owasp+llm', owaspFile: doc?.file, fetchedAt: doc?.fetchedAt };
      } else if (local) {
        // LLM 失败,回退到本地
        enhanced[code] = { ...local, source: 'local-fallback', owaspFile: doc?.file, fetchedAt: doc?.fetchedAt };
      }
    } catch (e) {
      console.warn(`[OWASP] LLM 增强 ${code} 失败: ${e.message}, 回退本地`);
      if (local) enhanced[code] = { ...local, source: 'local-fallback', error: e.message };
    }
  }
  return enhanced;
}

// ─── 拼装最终 Markdown ──────────────────────────────────────────
function buildMarkdown(enhancedDocs) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 10);
  const sources = new Set(Object.values(enhancedDocs).map(d => d.source));

  lines.push(`# OWASP Top 10 (${OWASP_VERSION}) 检测规则库`);
  lines.push('');
  lines.push(`> 最后更新: ${now}`);
  lines.push(`> 数据源: ${[...sources].join(', ')}`);
  lines.push(`> 官方仓库: https://github.com/${OWASP_REPO}/tree/${OWASP_BRANCH}/${OWASP_DOCS_PATH}`);
  lines.push(`> 本文档已向量化供 security-sentinel agent 检索`);
  lines.push('');

  // 评分标准
  lines.push('## 评分标准');
  lines.push('');
  lines.push('| 评分区间 | 等级 | 说明 |');
  lines.push('|---------|------|------|');
  lines.push('| 90-100 | 优秀 | 无重大风险 |');
  lines.push('| 75-89 | 良好 | 低危问题 |');
  lines.push('| 60-74 | 中危 | 中危漏洞,必须修复 |');
  lines.push('| 40-59 | 高危 | 高危漏洞,禁止上线 |');
  lines.push('| 0-39 | 极差 | 严重漏洞 |');
  lines.push('| 无漏洞 | 95 | 仅当确实无漏洞时 |');
  lines.push('');

  // 每条 A0x
  for (const item of AXX_FILES) {
    const code = item.code;
    const d = enhancedDocs[code];
    if (!d) continue;

    lines.push(`## ${code}:${OWASP_VERSION} ${d.title_zh || d.title}（${d.title_en || d.titleEn}）`);
    lines.push('');
    lines.push(`**严重程度**: ${d.severity}`);
    lines.push(`**数据源**: ${d.source}${d.owaspFile ? ' (' + d.owaspFile + ')' : ''}`);
    lines.push('');

    if (d.cwe_list || d.cwe) {
      lines.push(`**CWE 映射**: ${(d.cwe_list || d.cwe).join(', ')}`);
      lines.push('');
    }
    if (d.attack_types || d.types) {
      lines.push(`**类型**: ${(d.attack_types || d.types).join('、')}`);
      lines.push('');
    }
    if (d.summary) {
      lines.push(`**概述**: ${d.summary}`);
      lines.push('');
    }
    if (d.detection_methods || d.detection) {
      lines.push('**检测方法**:');
      lines.push('');
      for (const x of d.detection_methods || d.detection) lines.push(`- ${x}`);
      lines.push('');
    }
    if (d.regex_patterns || d.regex) {
      lines.push('**正则检测规则**:');
      lines.push('');
      lines.push('```regex');
      for (const p of d.regex_patterns || d.regex) lines.push(p);
      lines.push('```');
      lines.push('');
    }
    if (d.fix_recommendation || d.fix) {
      lines.push(`**修复建议**: ${d.fix_recommendation || d.fix}`);
      lines.push('');
    }
    if (d.fetchedAt) {
      lines.push(`**OWASP 抓取时间**: ${d.fetchedAt}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // 增量补充
  lines.push('## 增量补充: 最新攻击手法');
  lines.push('');
  lines.push(`截至 ${now},补充以下最新发现的攻击向量:`);
  lines.push('');
  for (const v of LATEST_VECTORS) {
    lines.push(`### ${v.year}: ${v.name}`);
    lines.push('');
    lines.push(`**特征匹配**: \`${v.pattern}\``);
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  // 元信息
  lines.push('## 元信息');
  lines.push('');
  lines.push(`- OWASP 版本: ${OWASP_VERSION}`);
  lines.push(`- 最后更新: ${now}`);
  lines.push(`- 规则条目数: ${Object.keys(enhancedDocs).length} 主分类 + ${LATEST_VECTORS.length} 增量向量`);
  lines.push(`- 数据源: ${[...sources].join(', ')}`);
  lines.push(`- 官方仓库: https://github.com/${OWASP_REPO}`);
  lines.push('');

  return lines.join('\n');
}

// ─── 主入口 ──────────────────────────────────────────
export async function updateOwaspKnowledgeBase({ spawnAgentSession: spawnFn, taskId } = {}) {
  // 1. 抓官方源
  const official = await fetchOwaspOfficial();
  const fetchedCount = Object.keys(official).length;

  // 2. LLM 增强
  let enhanced = {};
  if (spawnFn) {
    enhanced = await enhanceWithLLM(official, spawnFn, taskId);
  }

  // 3. 回填本地规则(LLM 没覆盖到的)
  for (const r of OWASP_RULES) {
    if (!enhanced[r.code]) enhanced[r.code] = { ...r, source: 'local-only' };
  }

  // 4. 拼装文档
  const md = buildMarkdown(enhanced);

  return {
    markdown: md,
    fetchedCount,
    enhancedCount: Object.keys(enhanced).length,
    sources: [...new Set(Object.values(enhanced).map(d => d.source))],
    officialFiles: Object.keys(official),
  };
}

export { OWASP_VERSION, OWASP_RULES, LATEST_VECTORS };