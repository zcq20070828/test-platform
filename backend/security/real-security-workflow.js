/**
 * 真实安全测试工作流引擎
 *
 * 设计原则：
 *  1. 方案、用例、扫描、验证、报告全部由确定性代码 + 真实工具产出，不调用 LLM。
 *  2. 每一条「用例」都绑定一个可自动执行的探测方法；无法自动验证的显式标记为 manual，
 *     绝不生成看似通过的假结果。
 *  3. 主动探测只使用只读/幂等请求（GET/HEAD/OPTIONS/TRACE、GraphQL introspection），
 *     不做爆破、不做写操作、不做拒绝服务类测试。
 *  4. 所有发现带真实证据（响应头、状态码、响应片段、工具原始输出摘要）。
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import crypto from 'node:crypto';

const UA = 'ZQ-Security-Workflow/1.0 (authorized-security-testing)';
const DEFAULT_TIMEOUT = 8000;
const MAX_BODY = 65536;

const SEVERITY_ORDER = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const SEVERITY_CVSS = { critical: 9.8, high: 8.1, medium: 5.3, low: 3.1, info: 0 };

// ============ 用例目录 ============
// source: live=URL 黑盒探测 / source=源码扫描 / manual=需人工或带认证上下文的验证
// probe:  true 表示由 runLiveProbes 产出结果
// tool:   绑定的扫描器 id（结果来自真实工具输出）
export const CASE_CATALOG = [
  // ── A01 访问控制失效 ──────────────────────────────────────────────
  { id: 'AC-01', owasp: 'A01', category: '访问控制', source: 'live', probe: true, title: 'Git 仓库目录对外暴露', method: 'GET /.git/HEAD 并校验 ref 签名', severity: 'high', cwe: 'CWE-200', remediation: '在 Web 服务器禁止访问 .git/.svn 等版本控制目录，并清理部署产物。' },
  { id: 'AC-02', owasp: 'A01', category: '访问控制', source: 'live', probe: true, title: '环境配置文件 .env 可下载', method: 'GET /.env 并校验 KEY=VALUE 签名', severity: 'critical', cwe: 'CWE-538', remediation: '禁止 Web 根目录存放 .env；将配置移出文档根并限制文件权限。' },
  { id: 'AC-03', owasp: 'A01', category: '访问控制', source: 'live', probe: true, title: '目录列表可浏览', method: 'GET 常见上传/静态目录，检测 "Index of /"', severity: 'medium', cwe: 'CWE-548', remediation: '关闭 Web 服务器 autoindex/目录浏览功能。' },
  { id: 'AC-04', owasp: 'A01', category: '访问控制', source: 'live', probe: true, title: 'Spring Actuator 管理端点暴露', method: 'GET /actuator 与 /actuator/env，校验 JSON 特征', severity: 'critical', cwe: 'CWE-306', remediation: '关闭或鉴权 actuator 端点，生产环境仅暴露 health。' },
  { id: 'AC-05', owasp: 'A01', category: '访问控制', source: 'live', probe: true, title: 'CORS 允许任意来源携带凭证', method: '携带 Origin: https://zq-probe.example 请求并检查 ACAO/ACAC', severity: 'high', cwe: 'CWE-942', remediation: '使用来源白名单，禁止 Access-Control-Allow-Origin 反射任意 Origin 且 Allow-Credentials=true。' },
  { id: 'AC-06', owasp: 'A01', category: '访问控制', source: 'live', probe: true, title: 'HTTP 危险方法未禁用', method: 'OPTIONS 探测 Allow 响应头', severity: 'medium', cwe: 'CWE-650', remediation: '仅允许业务所需方法；禁用 PUT/DELETE/TRACE 等。' },
  { id: 'AC-07', owasp: 'A01', category: '访问控制', source: 'live', probe: true, title: '备份/压缩包可下载', method: 'GET /backup.zip、/www.zip、/db.sql，校验内容类型与体积', severity: 'high', cwe: 'CWE-530', remediation: '删除发布目录中的源码包与数据库备份，禁止 Web 访问。' },
  { id: 'AC-08', owasp: 'A01', category: '访问控制', source: 'live', probe: true, title: '用户接口未鉴权即可访问', method: 'GET 常见用户接口并检查是否返回用户数据/口令字段', severity: 'high', cwe: 'CWE-306', remediation: '对所有业务接口强制认证与对象级授权校验。' },
  { id: 'AC-09', owasp: 'A01', category: '访问控制', source: 'manual', title: '水平/垂直越权', method: '需登录后替换对象 ID / 角色进行验证', severity: 'high', cwe: 'CWE-639', remediation: '服务端校验资源归属与角色权限，不信任前端传入的身份标识。' },

  // ── A02 加密机制失效 ──────────────────────────────────────────────
  { id: 'CR-01', owasp: 'A02', category: '加密', source: 'live', probe: true, title: 'HTTP 未强制跳转 HTTPS', method: '请求 http:// 并检查 301/302 Location', severity: 'high', cwe: 'CWE-319', remediation: '配置 301 全站跳转 HTTPS，并开启 HSTS。' },
  { id: 'CR-02', owasp: 'A02', category: '加密', source: 'live', probe: true, title: 'HSTS 响应头缺失', method: '检查 Strict-Transport-Security', severity: 'medium', cwe: 'CWE-319', remediation: '添加 Strict-Transport-Security: max-age=31536000; includeSubDomains。' },
  { id: 'CR-03', owasp: 'A02', category: '加密', source: 'live', probe: true, title: 'TLS 协议版本过低', method: 'TLS 握手读取 negotiated protocol', severity: 'high', cwe: 'CWE-326', remediation: '禁用 TLS 1.0/1.1，仅启用 TLS 1.2+。' },
  { id: 'CR-04', owasp: 'A02', category: '加密', source: 'live', probe: true, title: 'TLS 证书无效或已过期', method: 'TLS 握手校验证书有效期与自签名状态', severity: 'high', cwe: 'CWE-295', remediation: '部署受信任 CA 签发的有效证书并配置自动续期。' },
  { id: 'CR-05', owasp: 'A02', category: '加密', source: 'live', probe: true, title: '会话 Cookie 缺少 Secure 属性', method: '解析 Set-Cookie 属性', severity: 'medium', cwe: 'CWE-614', remediation: '为所有会话 Cookie 设置 Secure; HttpOnly; SameSite。' },
  { id: 'CR-06', owasp: 'A02', category: '加密', source: 'live', probe: true, title: '页面包含混合内容（http 资源）', method: '解析 HTTPS 页面中的 http:// 资源引用', severity: 'medium', cwe: 'CWE-319', remediation: '所有静态资源改用 HTTPS 或协议相对 URL。' },
  { id: 'CR-07', owasp: 'A02', category: '加密', source: 'live', title: '敏感页面缺少 Cache-Control 保护', method: '检查登录/账户类页面的 Cache-Control', severity: 'low', cwe: 'CWE-525', remediation: '对敏感页面返回 Cache-Control: no-store, private。' },

  // ── A03 注入 ─────────────────────────────────────────────────────
  { id: 'IN-01', owasp: 'A03', category: '注入', source: 'live', probe: true, title: 'SQL 注入错误特征', method: "注入 ' 并匹配 MySQL/PostgreSQL/Oracle/SQLite 报错特征", severity: 'high', cwe: 'CWE-89', remediation: '使用参数化查询/预编译语句，关闭详细数据库错误回显。' },
  { id: 'IN-02', owasp: 'A03', category: '注入', source: 'live', probe: true, title: '反射型 XSS（参数未编码回显）', method: '注入 <zqprobe> 标记并检查是否原样出现在 HTML', severity: 'medium', cwe: 'CWE-79', remediation: '按输出上下文进行 HTML/JS/URL 编码，启用 CSP。' },
  { id: 'IN-03', owasp: 'A03', category: '注入', source: 'url', tool: 'nuclei', title: '已知注入类漏洞模板命中', method: 'Nuclei 注入/注入类模板扫描', severity: 'high', cwe: 'CWE-74', remediation: '按 Nuclei 模板对应的 CVE/规则修复。' },
  { id: 'IN-04', owasp: 'A03', category: '注入', source: 'live', probe: true, title: '路径遍历/敏感文件读取', method: 'GET 编码后的 ../../etc/passwd 并匹配 passwd 特征', severity: 'critical', cwe: 'CWE-22', remediation: '对路径参数做规范化与白名单校验，禁止 .. 穿越。' },
  { id: 'IN-05', owasp: 'A03', category: '注入', source: 'manual', title: 'XXE / 命令注入 / 模板注入', method: '需针对具体参数构造带外载荷，自动探测易误报', severity: 'critical', cwe: 'CWE-611', remediation: '禁用外部实体、避免拼接命令、沙箱化模板引擎。' },
  { id: 'IN-06', owasp: 'A03', category: '注入', source: 'source', tool: 'semgrep', title: '静态代码安全缺陷（Semgrep 规则命中）', method: 'Semgrep p/security-audit + p/secrets', severity: 'high', cwe: 'CWE-74', remediation: '按 Semgrep 规则定位的代码行修复，并补充单元测试。' },
  { id: 'IN-07', owasp: 'A03', category: '注入', source: 'source', tool: 'bandit', title: 'Python 代码安全缺陷（Bandit 规则命中）', method: 'Bandit B1xx-B6xx 规则扫描', severity: 'high', cwe: 'CWE-74', remediation: '按 Bandit 规则修复（避免 eval/exec、subprocess shell=True、硬编码口令等）。' },

  // ── A04 不安全设计 ────────────────────────────────────────────────
  { id: 'DS-01', owasp: 'A04', category: '不安全设计', source: 'live', probe: true, title: 'GraphQL Introspection 对外开放', method: 'POST /graphql __schema 查询', severity: 'medium', cwe: 'CWE-200', remediation: '生产环境关闭 introspection，或按角色限制。' },
  { id: 'DS-02', owasp: 'A04', category: '不安全设计', source: 'manual', title: '登录接口缺少速率限制', method: '需受控的多次登录尝试，避免触发账户锁定', severity: 'medium', cwe: 'CWE-307', remediation: '对登录/OTP 接口实施 IP+账号维度限速与锁定策略。' },
  { id: 'DS-03', owasp: 'A04', category: '不安全设计', source: 'manual', title: '业务逻辑缺陷（价格/数量/流程绕过）', method: '需业务上下文与可写测试数据', severity: 'high', cwe: 'CWE-840', remediation: '服务端重算关键业务值并做状态机校验。' },
  { id: 'DS-04', owasp: 'A04', category: '不安全设计', source: 'manual', title: '批量赋值（Mass Assignment）', method: '需在写接口注入 role/isAdmin 等字段', severity: 'high', cwe: 'CWE-915', remediation: '使用字段白名单/DTO 映射，禁止直接绑定请求体到模型。' },

  // ── A05 安全配置错误 ──────────────────────────────────────────────
  { id: 'CM-01', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'Content-Security-Policy 缺失', method: '检查响应头', severity: 'medium', cwe: 'CWE-693', remediation: '配置最小权限 CSP，逐步用 report-only 收敛。' },
  { id: 'CM-02', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'X-Frame-Options / frame-ancestors 缺失', method: '检查响应头', severity: 'medium', cwe: 'CWE-1021', remediation: '设置 X-Frame-Options: DENY 或 CSP frame-ancestors。' },
  { id: 'CM-03', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'X-Content-Type-Options 缺失', method: '检查响应头', severity: 'low', cwe: 'CWE-436', remediation: '设置 X-Content-Type-Options: nosniff。' },
  { id: 'CM-04', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'Referrer-Policy 缺失', method: '检查响应头', severity: 'low', cwe: 'CWE-200', remediation: '设置 Referrer-Policy: strict-origin-when-cross-origin 或更严格。' },
  { id: 'CM-05', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'Permissions-Policy 缺失', method: '检查响应头', severity: 'info', cwe: 'CWE-693', remediation: '按需禁用摄像头/麦克风/地理位置等浏览器能力。' },
  { id: 'CM-06', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'Server 响应头泄露版本', method: '检查 Server 响应头', severity: 'low', cwe: 'CWE-200', remediation: '隐藏或泛化 Server 头，避免暴露具体版本。' },
  { id: 'CM-07', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'X-Powered-By 泄露技术栈', method: '检查 X-Powered-By 响应头', severity: 'low', cwe: 'CWE-200', remediation: '关闭 X-Powered-By。' },
  { id: 'CM-08', owasp: 'A05', category: '配置', source: 'live', probe: true, title: '错误页泄露堆栈信息', method: '请求异常路径/畸形参数并匹配堆栈特征', severity: 'medium', cwe: 'CWE-209', remediation: '统一错误页，生产环境关闭 debug 与详细堆栈。' },
  { id: 'CM-09', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'Swagger/OpenAPI 文档暴露', method: 'GET /swagger-ui.html 与 /v3/api-docs', severity: 'low', cwe: 'CWE-200', remediation: '生产环境关闭 API 文档或增加鉴权。' },
  { id: 'CM-10', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'phpinfo/调试页面暴露', method: 'GET /phpinfo.php、/server-status 等', severity: 'high', cwe: 'CWE-200', remediation: '删除调试脚本，限制服务器状态页来源。' },
  { id: 'CM-11', owasp: 'A05', category: '配置', source: 'live', probe: true, title: '前端 package.json 可公开访问', method: 'GET /package.json 并校验 dependencies 字段', severity: 'low', cwe: 'CWE-200', remediation: '构建产物中移除 package.json 与 source map。' },
  { id: 'CM-12', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'robots.txt 泄露敏感路径', method: 'GET /robots.txt 并匹配 admin/backup/internal 等 Disallow', severity: 'info', cwe: 'CWE-200', remediation: '不要在 robots.txt 中列出敏感目录（它只是君子协定）。' },
  { id: 'CM-13', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'security.txt 缺失', method: 'GET /.well-known/security.txt', severity: 'info', cwe: 'CWE-1059', remediation: '发布 security.txt 提供安全联系渠道。' },
  { id: 'CM-14', owasp: 'A05', category: '配置', source: 'live', probe: true, title: 'Host 头注入/被反射', method: '发送自定义 Host 并检查 Location/页面回显', severity: 'medium', cwe: 'CWE-644', remediation: '使用固定可信域名生成链接，校验 Host 头白名单。' },
  { id: 'CM-15', owasp: 'A05', category: '配置', source: 'url', tool: 'nikto', title: 'Web 服务器配置缺陷（Nikto 规则命中）', method: 'Nikto 服务器配置/危险文件/响应头规则扫描', severity: 'medium', cwe: 'CWE-16', remediation: '按 Nikto 规则逐条加固：删除示例/备份文件、补齐安全响应头、隐藏版本。' },
  { id: 'CM-16', owasp: 'A05', category: '配置', source: 'url', tool: 'nmap', title: '非必要端口/服务对外暴露', method: 'Nmap 全连接端口扫描（Top 100）', severity: 'low', cwe: 'CWE-1327', remediation: '通过防火墙/安全组限制来源 IP，关闭非业务必需端口。' },

  // ── A06 易受攻击组件 ──────────────────────────────────────────────
  { id: 'CV-01', owasp: 'A06', category: '组件', source: 'url', tool: 'nuclei', title: '已知 CVE 漏洞模板命中', method: 'Nuclei CVE 模板扫描', severity: 'critical', cwe: 'CWE-1035', remediation: '按 CVE 升级受影响组件，无法升级时加 WAF 虚拟补丁。' },
  { id: 'CV-02', owasp: 'A06', category: '组件', source: 'source', tool: 'trivy', title: '依赖组件存在已知漏洞', method: 'Trivy 漏洞库扫描（vuln）', severity: 'high', cwe: 'CWE-1395', remediation: '升级依赖到修复版本，移除未使用依赖。' },
  { id: 'CV-03', owasp: 'A06', category: '组件', source: 'source', tool: 'osv_scanner', title: '开源依赖 OSV 漏洞命中', method: 'OSV-Scanner 比对锁文件', severity: 'high', cwe: 'CWE-1395', remediation: '按 OSV 建议升级受影响包。' },
  { id: 'CV-04', owasp: 'A06', category: '组件', source: 'source', tool: 'npm_audit', title: 'npm 依赖安全公告命中', method: 'npm audit --json', severity: 'high', cwe: 'CWE-1395', remediation: '执行 npm audit fix 或升级受影响包。' },

  // ── A07 身份认证与授权 ────────────────────────────────────────────
  { id: 'AU-01', owasp: 'A07', category: '认证', source: 'url', tool: 'nuclei', title: '默认口令/弱口令登录', method: 'Nuclei default-login 模板', severity: 'critical', cwe: 'CWE-1392', remediation: '强制修改默认口令，实施口令复杂度与 MFA。' },
  { id: 'AU-02', owasp: 'A07', category: '认证', source: 'live', probe: true, title: '会话 Cookie 缺少 HttpOnly', method: '解析 Set-Cookie 属性', severity: 'medium', cwe: 'CWE-1004', remediation: '为会话 Cookie 设置 HttpOnly。' },
  { id: 'AU-03', owasp: 'A07', category: '认证', source: 'live', probe: true, title: '会话 Cookie 缺少 SameSite', method: '解析 Set-Cookie 属性', severity: 'low', cwe: 'CWE-1275', remediation: '设置 SameSite=Lax 或 Strict。' },
  { id: 'AU-04', owasp: 'A07', category: '认证', source: 'live', probe: true, title: '管理/登录入口暴露', method: 'GET /admin、/login、/manager 检查状态码', severity: 'info', cwe: 'CWE-200', remediation: '管理入口限制来源 IP 或增加额外认证。' },
  { id: 'AU-05', owasp: 'A07', category: '认证', source: 'manual', title: 'JWT 签名/算法校验缺陷', method: '需有效令牌并尝试篡改 alg/none', severity: 'critical', cwe: 'CWE-347', remediation: '固定算法白名单，严格校验签名、iss、aud、exp。' },

  // ── A08 软件与数据完整性 ──────────────────────────────────────────
  { id: 'DI-01', owasp: 'A08', category: '完整性', source: 'live', probe: true, title: '外部脚本缺少 SRI 完整性校验', method: '解析跨域 script/link 的 integrity 属性', severity: 'low', cwe: 'CWE-353', remediation: '为第三方静态资源添加 Subresource Integrity。' },
  { id: 'DI-02', owasp: 'A08', category: '完整性', source: 'url', tool: 'nuclei', title: '反序列化/RCE 类模板命中', method: 'Nuclei rce/deserialization 模板', severity: 'critical', cwe: 'CWE-502', remediation: '禁止反序列化不可信数据，升级受影响组件。' },
  { id: 'DI-03', owasp: 'A08', category: '完整性', source: 'source', tool: 'gitleaks', title: '源码中硬编码凭证/密钥', method: 'Gitleaks 规则扫描（已脱敏）', severity: 'high', cwe: 'CWE-798', remediation: '吊销并轮换泄露凭证，改用密钥管理服务。' },

  // ── A09 日志与监控失效 ────────────────────────────────────────────
  { id: 'LG-01', owasp: 'A09', category: '监控', source: 'manual', title: '鉴权失败/高危操作未记录审计日志', method: '需查看服务端日志与告警配置', severity: 'medium', cwe: 'CWE-778', remediation: '记录认证失败、权限变更、敏感数据访问并接入告警。' },
  { id: 'LG-02', owasp: 'A09', category: '监控', source: 'manual', title: '日志注入/敏感信息落日志', method: '需查看日志内容与换行过滤', severity: 'low', cwe: 'CWE-117', remediation: '日志输出前转义换行，禁止记录口令与令牌。' },

  // ── A10 SSRF ────────────────────────────────────────────────────
  { id: 'SS-01', owasp: 'A10', category: 'SSRF', source: 'url', tool: 'nuclei', title: 'SSRF/开放代理类模板命中', method: 'Nuclei ssrf 模板', severity: 'high', cwe: 'CWE-918', remediation: '对目标地址做协议/域名/IP 白名单，禁止访问内网与元数据地址。' },
  { id: 'SS-02', owasp: 'A10', category: 'SSRF', source: 'live', probe: true, title: '开放重定向', method: '向常见跳转参数注入外部域名并检查 Location', severity: 'medium', cwe: 'CWE-601', remediation: '跳转目标使用白名单或仅允许站内相对路径。' },
  { id: 'SS-03', owasp: 'A10', category: 'SSRF', source: 'manual', title: '服务端请求伪造（业务参数）', method: '需结合具体 URL/图片抓取/Webhook 参数验证', severity: 'high', cwe: 'CWE-918', remediation: '限制出站目标，禁用危险协议，解析后校验 IP。' },
];

// ============ 基础工具函数 ============
function fingerprint(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function clip(text, n = 400) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

function mdCell(text) {
  return String(text == null ? '' : text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function normalizeTarget(target) {
  let u;
  try { u = new URL(String(target || '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  // 云元数据地址是明确的攻击目标，任何情况下都不允许探测
  if (host === '169.254.169.254' || host === 'metadata.google.internal' || host === '100.100.100.200') return null;
  u.hash = '';
  return u.toString();
}

function isHtml(headers) {
  return /text\/html|application\/xhtml\+xml/i.test(String(headers['content-type'] || ''));
}

function makeFinding({
  caseId = null, source = '真实探测', tool = 'live-probe', category = 'web',
  severity = 'info', title, description = '', location = '', evidence = '',
  remediation = '', cve = null, cwe = null, cvss = null, confidence = 'high',
  verified = true, raw = null,
}) {
  return {
    caseId,
    source,
    tool,
    category,
    severity,
    title,
    description,
    location,
    evidence,
    remediation,
    cve,
    cwe,
    cvss: cvss != null ? cvss : SEVERITY_CVSS[severity] ?? null,
    confidence,
    verified,
    fingerprint: fingerprint([tool, title, location]),
    raw,
  };
}

// ============ HTTP / TLS 探测 ============
function rawRequest(url, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve({ ...r, durationMs: Date.now() - started }); } };
    let u;
    try { u = new URL(url); } catch (e) { return finish({ ok: false, error: 'URL 无效', status: 0 }); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || undefined,
      path: `${u.pathname}${u.search}`,
      method: opts.method || 'GET',
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
      timeout: opts.timeoutMs || DEFAULT_TIMEOUT,
      rejectUnauthorized: false,
      servername: u.hostname,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        if (size < MAX_BODY) {
          chunks.push(chunk);
          size += chunk.length;
        }
        if (size >= MAX_BODY) res.destroy();
      });
      const done = () => finish({
        ok: true,
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).subarray(0, MAX_BODY).toString('utf8'),
        location: res.headers.location || null,
        truncated: size >= MAX_BODY,
      });
      res.on('end', done);
      res.on('close', done);
      res.on('error', () => done());
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => finish({ ok: false, error: e.message, status: 0 }));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function requestFollow(url, opts = {}, depth = 0) {
  const r = await rawRequest(url, opts);
  if (!r.ok) return r;
  if ([301, 302, 303, 307, 308].includes(r.status) && r.location && depth < 5) {
    let next;
    try { next = new URL(r.location, url).toString(); } catch { return r; }
    const followed = await requestFollow(next, { ...opts, method: r.status === 307 || r.status === 308 ? opts.method : 'GET' }, depth + 1);
    return { ...followed, redirectChain: [url, ...(followed.redirectChain || [])] };
  }
  return r;
}

function checkTls(hostname, port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const socket = tls.connect({
      host: hostname,
      port,
      servername: hostname,
      rejectUnauthorized: false,
      timeout: 8000,
    }, () => {
      try {
        const cert = socket.getPeerCertificate() || {};
        done({
          ok: true,
          authorized: socket.authorized,
          authError: socket.authorizationError || null,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher()?.name || '',
          subject: cert.subject?.CN || '',
          issuer: cert.issuer?.CN || '',
          validFrom: cert.valid_from || '',
          validTo: cert.valid_to || '',
          daysRemaining: cert.valid_to ? Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000) : null,
        });
      } catch (e) {
        done({ ok: false, error: e.message });
      } finally {
        socket.destroy();
      }
    });
    socket.on('timeout', () => { socket.destroy(); done({ ok: false, error: 'timeout' }); });
    socket.on('error', (e) => done({ ok: false, error: e.message }));
  });
}

// ============ 主动探测 ============
const EXPOSED_PATHS = [
  { caseId: 'AC-01', path: '/.git/HEAD', signature: /^ref:\s+\S+/m, label: '.git/HEAD', contentType: 'text' },
  { caseId: 'AC-02', path: '/.env', signature: /(^|\n)\s*[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/, label: '.env', contentType: 'text' },
  { caseId: 'AC-07', path: '/backup.zip', binary: true, label: 'backup.zip' },
  { caseId: 'AC-07', path: '/www.zip', binary: true, label: 'www.zip' },
  { caseId: 'AC-07', path: '/db.sql', binary: true, label: 'db.sql', extraSignature: /(CREATE TABLE|INSERT INTO|DROP TABLE)/i },
  { caseId: 'AC-04', path: '/actuator', signature: /"(?:_links|status|self)"\s*:/, label: '/actuator' },
  { caseId: 'AC-04', path: '/actuator/env', signature: /"(?:propertySources|activeProfiles)"\s*:/, label: '/actuator/env' },
  { caseId: 'CM-09', path: '/swagger-ui.html', signature: /(swagger-ui|Swagger UI)/i, label: 'swagger-ui.html' },
  { caseId: 'CM-09', path: '/v3/api-docs', signature: /"(?:openapi|paths)"\s*:/, label: '/v3/api-docs' },
  { caseId: 'CM-09', path: '/api-docs', signature: /"(?:swagger|openapi|paths)"\s*:/, label: '/api-docs' },
  { caseId: 'CM-10', path: '/phpinfo.php', signature: /(PHP Version|phpinfo\(\))/i, label: 'phpinfo.php' },
  { caseId: 'CM-10', path: '/server-status', signature: /(Apache Server Status|Server uptime)/i, label: '/server-status' },
  { caseId: 'CM-11', path: '/package.json', signature: /"(?:dependencies|devDependencies)"\s*:/, label: '/package.json', jsonOnly: true },
  { caseId: 'AC-03', path: '/uploads/', signature: /Index of \//i, label: '/uploads/' },
  { caseId: 'AC-03', path: '/static/', signature: /Index of \//i, label: '/static/' },
  { caseId: 'IN-04', path: '/%2e%2e/%2e%2e/%2e%2e/etc/passwd', signature: /^root:.*:0:0:/m, label: '../../etc/passwd' },
  { caseId: 'IN-04', path: '/..%2f..%2f..%2fetc%2fpasswd', signature: /^root:.*:0:0:/m, label: '..%2f..%2fetc/passwd' },
];

const LOGIN_PATHS = ['/admin', '/login', '/manager', '/wp-admin/', '/admin/login'];
const USER_API_PATHS = ['/api/users', '/api/v1/users', '/api/admin/users', '/api/user/list'];

const SQL_ERROR_RE = /(SQL syntax.*MySQL|Warning.*mysqli|MySQLSyntaxErrorException|valid MySQL result|PostgreSQL.*ERROR|psql:.*ERROR|ORA-\d{5}|Oracle error|SQLite\/JDBC.*error|SQLite3::|Microsoft OLE DB Provider|ODBC SQL Server Driver|Unclosed quotation mark|You have an error in your SQL syntax|SequelizeDatabaseError|PrismaClientKnownRequestError|ER_PARSE_ERROR|ER_BAD_FIELD_ERROR)/i;
const STACK_RE = /(Traceback \(most recent call last\)|\n\s+at\s+[\w$.]+\s+\([^)]+:\d+:\d+\)|\n\s+at\s+\/[^\n]+:\d+:\d+|java\.lang\.\w+Exception|org\.springframework\.[\w.]+Exception|You have an error in your SQL syntax|\bTypeError:|\bReferenceError:|Cannot read propert(?:y|ies) of)/;
const REDIRECT_PARAMS = ['url', 'next', 'redirect', 'return', 'returnUrl', 'callback', 'target', 'dest'];

/**
 * 对 URL 目标执行只读主动探测。
 * @returns {{results: Object, findings: Array, meta: Object}}
 */
export async function runLiveProbes(target, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const baseUrl = normalizeTarget(target);
  if (!baseUrl) throw new Error('目标必须是 http(s) URL（且不得为云元数据地址）');
  const u = new URL(baseUrl);
  const origin = `${u.protocol}//${u.host}`;
  const isHttps = u.protocol === 'https:';
  const results = {};
  const findings = [];
  const meta = { target: baseUrl, origin, isHttps, probeTime: new Date().toISOString(), requests: 0 };

  const set = (id, status, evidence, detail = {}) => { results[id] = { status, evidence, ...detail }; };
  const add = (f) => { findings.push(f); };

  const root = await requestFollow(baseUrl, { timeoutMs });
  meta.requests += 1;
  if (!root.ok) throw new Error(`目标不可访问: ${root.error || root.status}`);
  meta.rootStatus = root.status;
  meta.server = root.headers.server || '';
  meta.poweredBy = root.headers['x-powered-by'] || '';
  const h = root.headers;

  // ── 安全响应头 ──
  const headerRules = [
    { id: 'CM-01', header: 'content-security-policy', name: 'Content-Security-Policy', sev: 'medium' },
    { id: 'CM-03', header: 'x-content-type-options', name: 'X-Content-Type-Options', sev: 'low' },
    { id: 'CM-04', header: 'referrer-policy', name: 'Referrer-Policy', sev: 'low' },
    { id: 'CM-05', header: 'permissions-policy', name: 'Permissions-Policy', sev: 'info' },
  ];
  for (const rule of headerRules) {
    if (h[rule.header]) {
      set(rule.id, 'passed', `已设置: ${h[rule.header]}`);
    } else {
      set(rule.id, 'failed', `响应头缺失: ${rule.name}`);
      const c = CASE_CATALOG.find(x => x.id === rule.id);
      add(makeFinding({
        caseId: rule.id, severity: rule.sev, title: c.title,
        description: `${baseUrl} 的响应未设置 ${rule.name}，浏览器侧防护能力被削弱。`,
        location: baseUrl, evidence: `HTTP ${root.status}，响应头中无 ${rule.name}`,
        remediation: c.remediation, cwe: c.cwe,
      }));
    }
  }

  // X-Frame-Options / CSP frame-ancestors
  const csp = String(h['content-security-policy'] || '');
  const xfo = String(h['x-frame-options'] || '');
  if (xfo || /frame-ancestors/i.test(csp)) {
    set('CM-02', 'passed', xfo ? `X-Frame-Options: ${xfo}` : 'CSP 含 frame-ancestors');
  } else {
    set('CM-02', 'failed', 'X-Frame-Options 与 CSP frame-ancestors 均缺失');
    const c = CASE_CATALOG.find(x => x.id === 'CM-02');
    add(makeFinding({
      caseId: 'CM-02', severity: 'medium', title: c.title,
      description: '页面可被任意站点通过 iframe 嵌入，存在点击劫持风险。',
      location: baseUrl, evidence: '响应头无 X-Frame-Options，CSP 无 frame-ancestors',
      remediation: c.remediation, cwe: c.cwe,
    }));
  }

  // HSTS / HTTPS 跳转
  if (isHttps) {
    if (h['strict-transport-security']) {
      set('CR-02', 'passed', `Strict-Transport-Security: ${h['strict-transport-security']}`);
    } else {
      set('CR-02', 'failed', 'Strict-Transport-Security 缺失');
      const c = CASE_CATALOG.find(x => x.id === 'CR-02');
      add(makeFinding({
        caseId: 'CR-02', severity: 'medium', title: c.title,
        description: 'HTTPS 站点未启用 HSTS，首次访问仍可能被降级劫持。',
        location: baseUrl, evidence: '响应头无 Strict-Transport-Security',
        remediation: c.remediation, cwe: c.cwe,
      }));
    }
    set('CR-01', 'passed', '目标已使用 HTTPS');
  } else {
    const httpUrl = baseUrl;
    const r = await rawRequest(httpUrl, { timeoutMs, headers: { Connection: 'close' } });
    meta.requests += 1;
    if (r.ok && [301, 302, 307, 308].includes(r.status) && /^https:\/\//i.test(String(r.location || ''))) {
      set('CR-01', 'passed', `HTTP ${r.status} → ${r.location}`);
    } else {
      set('CR-01', 'failed', r.ok ? `HTTP ${r.status}，Location: ${r.location || '(无)'}` : `请求失败: ${r.error}`);
      const c = CASE_CATALOG.find(x => x.id === 'CR-01');
      add(makeFinding({
        caseId: 'CR-01', severity: 'high', title: c.title,
        description: '站点可通过明文 HTTP 直接访问，未强制跳转 HTTPS。',
        location: baseUrl, evidence: r.ok ? `HTTP ${r.status}，未返回 HTTPS 跳转` : `HTTP 请求失败: ${r.error}`,
        remediation: c.remediation, cwe: c.cwe,
      }));
    }
    set('CR-02', 'skipped', 'HTTP 目标不评估 HSTS');
    set('CR-03', 'skipped', 'HTTP 目标无 TLS 握手');
    set('CR-04', 'skipped', 'HTTP 目标无 TLS 证书');
  }

  // ── TLS ──
  if (isHttps) {
    const t = await checkTls(u.hostname, u.port || 443);
    meta.requests += 1;
    if (!t.ok) {
      set('CR-03', 'error', `TLS 握手失败: ${t.error}`);
      set('CR-04', 'error', `TLS 握手失败: ${t.error}`);
    } else {
      const badProto = /TLSv1(\.[01])?$/i.test(t.protocol || '');
      if (badProto) {
        set('CR-03', 'failed', `协商协议: ${t.protocol}`);
        const c = CASE_CATALOG.find(x => x.id === 'CR-03');
        add(makeFinding({
          caseId: 'CR-03', severity: 'high', title: c.title,
          description: `TLS 握手协商到过时协议 ${t.protocol}。`,
          location: `${u.hostname}:${u.port || 443}`, evidence: `protocol=${t.protocol}, cipher=${t.cipher}`,
          remediation: c.remediation, cwe: c.cwe,
        }));
      } else {
        set('CR-03', 'passed', `协商协议: ${t.protocol} / ${t.cipher}`);
      }

      const certOk = t.authorized && t.daysRemaining != null && t.daysRemaining > 0;
      if (certOk) {
        set('CR-04', 'passed', `证书有效，剩余 ${t.daysRemaining} 天（${t.issuer}）`);
      } else {
        const reason = !t.authorized
          ? `证书链不受信任: ${t.authError || 'unknown'}`
          : (t.daysRemaining != null && t.daysRemaining <= 0 ? `证书已过期（valid_to=${t.validTo}）` : '证书有效期无法确认');
        set('CR-04', 'failed', reason);
        const c = CASE_CATALOG.find(x => x.id === 'CR-04');
        add(makeFinding({
          caseId: 'CR-04', severity: 'high', title: c.title,
          description: `TLS 证书校验失败：${reason}`,
          location: `${u.hostname}:${u.port || 443}`,
          evidence: `subject=${t.subject}, issuer=${t.issuer}, valid_to=${t.validTo}, authorized=${t.authorized}`,
          remediation: c.remediation, cwe: c.cwe,
        }));
      }
    }
  }

  // ── Cookie 属性 ──
  const cookies = Array.isArray(h['set-cookie']) ? h['set-cookie'] : [];
  if (cookies.length === 0) {
    set('CR-05', 'skipped', '根路径未设置 Cookie，无法评估（需登录态）');
    set('AU-02', 'skipped', '根路径未设置 Cookie，无法评估（需登录态）');
    set('AU-03', 'skipped', '根路径未设置 Cookie，无法评估（需登录态）');
  } else {
    const sessionish = cookies.filter(c => /(session|sid|token|auth|jwt|login)/i.test(c.split('=')[0]));
    const pool = sessionish.length ? sessionish : cookies;
    const noSecure = isHttps ? pool.filter(c => !/;\s*secure\b/i.test(c)) : [];
    const noHttpOnly = pool.filter(c => !/;\s*httponly\b/i.test(c));
    const noSameSite = pool.filter(c => !/;\s*samesite\s*=/i.test(c));

    if (!isHttps) {
      set('CR-05', 'skipped', 'HTTP 目标不评估 Secure 属性');
    } else if (noSecure.length) {
      set('CR-05', 'failed', noSecure.map(c => clip(c.split('=')[0], 40)).join(', '));
      const c = CASE_CATALOG.find(x => x.id === 'CR-05');
      add(makeFinding({
        caseId: 'CR-05', severity: 'medium', title: c.title,
        description: '会话 Cookie 未设置 Secure，可能在明文信道中泄露。',
        location: baseUrl, evidence: noSecure.map(c => clip(c, 160)).join(' | '),
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else set('CR-05', 'passed', `受检 Cookie 均含 Secure（${pool.length} 个）`);

    if (noHttpOnly.length) {
      set('AU-02', 'failed', noHttpOnly.map(c => clip(c.split('=')[0], 40)).join(', '));
      const c = CASE_CATALOG.find(x => x.id === 'AU-02');
      add(makeFinding({
        caseId: 'AU-02', severity: 'medium', title: c.title,
        description: 'Cookie 缺少 HttpOnly，XSS 可直接读取会话标识。',
        location: baseUrl, evidence: noHttpOnly.map(c => clip(c, 160)).join(' | '),
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else set('AU-02', 'passed', `受检 Cookie 均含 HttpOnly（${pool.length} 个）`);

    if (noSameSite.length) {
      set('AU-03', 'failed', noSameSite.map(c => clip(c.split('=')[0], 40)).join(', '));
      const c = CASE_CATALOG.find(x => x.id === 'AU-03');
      add(makeFinding({
        caseId: 'AU-03', severity: 'low', title: c.title,
        description: 'Cookie 未声明 SameSite，跨站请求可能携带会话。',
        location: baseUrl, evidence: noSameSite.map(c => clip(c, 160)).join(' | '),
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else set('AU-03', 'passed', `受检 Cookie 均含 SameSite（${pool.length} 个）`);
  }

  // ── CORS ──
  const corsProbe = await requestFollow(origin + (u.pathname || '/'), {
    timeoutMs,
    headers: { Origin: 'https://zq-probe.example', 'Access-Control-Request-Method': 'GET' },
  });
  meta.requests += 1;
  if (corsProbe.ok) {
    const acao = corsProbe.headers['access-control-allow-origin'] || '';
    const acac = String(corsProbe.headers['access-control-allow-credentials'] || '').toLowerCase() === 'true';
    if (acao === '*' && acac) {
      set('AC-05', 'failed', 'ACAO=* 且 ACAC=true');
      const c = CASE_CATALOG.find(x => x.id === 'AC-05');
      add(makeFinding({
        caseId: 'AC-05', severity: 'high', title: c.title,
        description: 'CORS 同时允许任意来源与携带凭证，任意站点可读取认证后的响应。',
        location: baseUrl, evidence: 'Access-Control-Allow-Origin: *, Access-Control-Allow-Credentials: true',
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else if (acao === 'https://zq-probe.example' || acao === '*' || acao === 'null') {
      set('AC-05', 'failed', `ACAO=${acao}${acac ? ' + ACAC=true' : ''}`);
      const c = CASE_CATALOG.find(x => x.id === 'AC-05');
      add(makeFinding({
        caseId: 'AC-05', severity: acac ? 'high' : 'low', title: c.title,
        description: `服务端将任意 Origin 反射/放行（ACAO=${acao}），${acac ? '且允许携带凭证。' : '但未允许携带凭证。'}`,
        location: baseUrl, evidence: `Access-Control-Allow-Origin: ${acao}${acac ? ', Access-Control-Allow-Credentials: true' : ''}`,
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else {
      set('AC-05', 'passed', acao ? `ACAO=${acao}` : '未返回 CORS 放行头');
    }
  } else {
    set('AC-05', 'error', `CORS 探测失败: ${corsProbe.error}`);
  }

  // ── HTTP 方法 ──
  // 注意：Express/Koa 的 OPTIONS 会自动宣称支持多种方法，仅凭 Allow 判断误报很高。
  // 这里改为向不存在的路径实际发送 PUT/DELETE，只有真正返回 2xx 才判定为方法未受限。
  const opt = await rawRequest(baseUrl, { method: 'OPTIONS', timeoutMs });
  meta.requests += 1;
  const allow = opt.ok ? String(opt.headers.allow || opt.headers['access-control-allow-methods'] || '') : '';
  const probePath = `${origin}/__zq_method_probe_${crypto.randomBytes(4).toString('hex')}`;
  const [putProbe, delProbe] = await Promise.all([
    rawRequest(probePath, { method: 'PUT', timeoutMs: Math.min(timeoutMs, 6000), headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    rawRequest(probePath, { method: 'DELETE', timeoutMs: Math.min(timeoutMs, 6000) }),
  ]);
  meta.requests += 2;
  const writable = [
    ['PUT', putProbe], ['DELETE', delProbe],
  ].filter(([, r]) => r.ok && r.status >= 200 && r.status < 300);
  if (writable.length) {
    set('AC-06', 'failed', `${writable.map(([m, r]) => `${m} → HTTP ${r.status}`).join('；')}；Allow: ${allow || '-'}`);
    const c = CASE_CATALOG.find(x => x.id === 'AC-06');
    add(makeFinding({
      caseId: 'AC-06', severity: 'medium', title: c.title,
      description: '对不存在的路径发送写方法仍返回 2xx，写方法未被限制，需确认是否存在兜底写入逻辑。',
      location: probePath,
      evidence: `${writable.map(([m, r]) => `${m} → HTTP ${r.status}`).join('；')}；OPTIONS Allow: ${allow || '(无)'}`,
      remediation: c.remediation, cwe: c.cwe, confidence: 'medium',
    }));
  } else {
    set('AC-06', 'passed', `PUT/DELETE 返回 404/405（Allow 声明: ${allow || '-'}）`);
  }

  // ── 服务端版本泄露 ──
  if (h.server) {
    set('CM-06', 'failed', `Server: ${h.server}`);
    const c = CASE_CATALOG.find(x => x.id === 'CM-06');
    add(makeFinding({
      caseId: 'CM-06', severity: 'low', title: c.title,
      description: '响应暴露了服务器软件及版本，便于攻击者匹配已知漏洞。',
      location: baseUrl, evidence: `Server: ${h.server}`,
      remediation: c.remediation, cwe: c.cwe,
    }));
  } else set('CM-06', 'passed', '未返回 Server 头');

  if (h['x-powered-by']) {
    set('CM-07', 'failed', `X-Powered-By: ${h['x-powered-by']}`);
    const c = CASE_CATALOG.find(x => x.id === 'CM-07');
    add(makeFinding({
      caseId: 'CM-07', severity: 'low', title: c.title,
      description: '响应暴露了后端技术栈。',
      location: baseUrl, evidence: `X-Powered-By: ${h['x-powered-by']}`,
      remediation: c.remediation, cwe: c.cwe,
    }));
  } else set('CM-07', 'passed', '未返回 X-Powered-By');

  // ── 暴露路径（并发） ──
  const pathResults = await Promise.all(EXPOSED_PATHS.map(async (p) => {
    const r = await rawRequest(origin + p.path, { timeoutMs: Math.min(timeoutMs, 6000) });
    return { p, r };
  }));
  meta.requests += pathResults.length;
  for (const { p, r } of pathResults) {
    if (!r.ok) continue;
    if (r.status < 200 || r.status >= 300) continue;
    const ct = String(r.headers['content-type'] || '');
    const body = r.body || '';
    let hit = false;
    if (p.binary) {
      hit = /application\/(zip|x-zip|octet-stream|sql)/i.test(ct) || (p.extraSignature ? p.extraSignature.test(body) : false);
      if (/text\/html/i.test(ct)) hit = false; // SPA fallback
    } else if (p.jsonOnly) {
      hit = /json/i.test(ct) && p.signature.test(body);
    } else {
      hit = p.signature.test(body) && !/text\/html/i.test(ct) || (p.signature.test(body) && p.path.includes('..'));
    }
    if (!hit) continue;
    const c = CASE_CATALOG.find(x => x.id === p.caseId);
    if (!c) continue;
    const existing = results[p.caseId];
    const evidence = `${p.path} → HTTP ${r.status}, content-type=${ct || '-'}`;
    if (existing && existing.status === 'failed') {
      results[p.caseId] = { ...existing, evidence: `${existing.evidence}；${evidence}` };
    } else {
      set(p.caseId, 'failed', evidence);
    }
    add(makeFinding({
      caseId: p.caseId, severity: c.severity, title: c.title,
      description: `${p.label} 可被未授权直接访问，命中内容特征。`,
      location: origin + p.path, evidence: `${evidence}；响应片段: ${clip(body, 200)}`,
      remediation: c.remediation, cwe: c.cwe,
    }));
  }
  for (const id of ['AC-01', 'AC-02', 'AC-04', 'AC-07', 'AC-03', 'CM-09', 'CM-10', 'CM-11', 'IN-04']) {
    if (!results[id]) set(id, 'passed', '未命中暴露特征');
  }

  // ── 登录/管理入口 ──
  // 必须排除 SPA 的 history fallback：很多前端对任意路径都返回同一份 index.html，
  // 仅看 200 会把 /admin、/login 全部误判为“暴露”。
  const loginChecks = await Promise.all(LOGIN_PATHS.map(async p => ({ p, r: await rawRequest(origin + p, { timeoutMs: Math.min(timeoutMs, 5000) }) })));
  meta.requests += loginChecks.length;
  const rootHtml = isHtml(root.headers) ? (root.body || '') : '';
  const loginHits = loginChecks
    .filter(x => x.r.ok && x.r.status >= 200 && x.r.status < 300 && isHtml(x.r.headers))
    .filter(x => {
      const body = x.r.body || '';
      if (rootHtml && body === rootHtml) return false; // 与首页完全相同 → SPA fallback
      return /type\s*=\s*["']password["']|name\s*=\s*["']password["']|id\s*=\s*["']login["']|class\s*=\s*["'][^"']*login/i.test(body);
    })
    .map(x => `${x.p} → HTTP ${x.r.status}`);
  if (loginHits.length) {
    set('AU-04', 'failed', loginHits.join('；'));
    const c = CASE_CATALOG.find(x => x.id === 'AU-04');
    add(makeFinding({
      caseId: 'AU-04', severity: 'info', title: c.title,
      description: '发现真实登录表单页面，建议限制来源或增加多因素认证。',
      location: origin, evidence: loginHits.join('；'),
      remediation: c.remediation, cwe: c.cwe, confidence: 'medium',
    }));
  } else set('AU-04', 'passed', '未发现独立登录表单（已排除 SPA history fallback）');

  // ── 用户接口未鉴权 ──
  const apiChecks = await Promise.all(USER_API_PATHS.map(async p => ({ p, r: await rawRequest(origin + p, { timeoutMs: Math.min(timeoutMs, 5000) }) })));
  meta.requests += apiChecks.length;
  const apiHits = [];
  for (const { p, r } of apiChecks) {
    if (!r.ok || r.status !== 200) continue;
    if (!/json/i.test(String(r.headers['content-type'] || ''))) continue;
    let json = null;
    try { json = JSON.parse(r.body); } catch { /* ignore */ }
    const text = JSON.stringify(json || {});
    const sensitive = /"(password|passwd|pwd|passwordHash|password_hash|salt|secret|token)"\s*:/i.test(text);
    const hasData = Array.isArray(json) ? json.length > 0 : (json && typeof json === 'object' && Object.keys(json).length > 0);
    if (sensitive || (hasData && /"email"\s*:/.test(text))) {
      apiHits.push({ p, status: r.status, sensitive, sample: clip(text, 180) });
    }
  }
  if (apiHits.length) {
    const sensitive = apiHits.some(x => x.sensitive);
    set('AC-08', 'failed', apiHits.map(x => `${x.p} → HTTP ${x.status}${x.sensitive ? '（含口令/密钥字段）' : ''}`).join('；'));
    const c = CASE_CATALOG.find(x => x.id === 'AC-08');
    add(makeFinding({
      caseId: 'AC-08', severity: sensitive ? 'critical' : 'high', title: c.title,
      description: sensitive
        ? '接口在未认证情况下返回了包含口令/密钥字段的数据，属于严重越权与敏感信息泄露。'
        : '接口在未认证情况下返回了用户数据，疑似缺少鉴权。',
      location: origin + apiHits[0].p,
      evidence: apiHits.map(x => `${x.p} → HTTP ${x.status}；响应片段: ${x.sample}`).join(' | '),
      remediation: c.remediation, cwe: c.cwe,
    }));
  } else {
    set('AC-08', 'passed', '常见用户接口均未返回未鉴权数据');
  }

  // ── GraphQL introspection ──
  const gqlBody = JSON.stringify({ query: '{__schema{queryType{name} types{name}}}' });
  const gqlPaths = ['/graphql', '/api/graphql'];
  const gqlChecks = await Promise.all(gqlPaths.map(async p => ({
    p,
    r: await rawRequest(origin + p, {
      method: 'POST', timeoutMs: Math.min(timeoutMs, 6000),
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(gqlBody) },
      body: gqlBody,
    }),
  })));
  meta.requests += gqlChecks.length;
  const gqlHit = gqlChecks.find(x => x.r.ok && x.r.status === 200 && /__schema|"types"\s*:/.test(x.r.body || ''));
  if (gqlHit) {
    set('DS-01', 'failed', `${gqlHit.p} 返回 __schema`);
    const c = CASE_CATALOG.find(x => x.id === 'DS-01');
    add(makeFinding({
      caseId: 'DS-01', severity: 'medium', title: c.title,
      description: 'GraphQL 端点允许未认证的 introspection 查询，攻击者可枚举全部类型与字段。',
      location: origin + gqlHit.p, evidence: `POST ${gqlHit.p} → HTTP 200；响应片段: ${clip(gqlHit.r.body, 180)}`,
      remediation: c.remediation, cwe: c.cwe,
    }));
  } else set('DS-01', 'passed', '未发现开放的 GraphQL introspection');

  // ── 错误回显 / SQL 注入 / XSS / 开放重定向 ──
  const probeQs = `id=1%27&q=1%27&search=1%27&name=%3Czqprobe%3E`;
  const errProbe = await requestFollow(`${origin}${u.pathname}?${probeQs}`, { timeoutMs });
  meta.requests += 1;
  if (errProbe.ok) {
    const body = errProbe.body || '';
    if (STACK_RE.test(body)) {
      set('CM-08', 'failed', `HTTP ${errProbe.status}，响应含异常堆栈特征`);
      const c = CASE_CATALOG.find(x => x.id === 'CM-08');
      add(makeFinding({
        caseId: 'CM-08', severity: 'medium', title: c.title,
        description: '畸形参数触发了异常响应，页面/接口回显了堆栈或框架异常信息。',
        location: `${origin}${u.pathname}?${probeQs}`,
        evidence: `HTTP ${errProbe.status}；命中片段: ${clip((body.match(STACK_RE) || [])[0] || body, 200)}`,
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else {
      set('CM-08', 'passed', `HTTP ${errProbe.status}，未发现堆栈回显`);
    }
    if (SQL_ERROR_RE.test(body)) {
      set('IN-01', 'failed', '响应命中数据库错误特征');
      const c = CASE_CATALOG.find(x => x.id === 'IN-01');
      add(makeFinding({
        caseId: 'IN-01', severity: 'high', title: c.title,
        description: "注入单引号后响应出现数据库报错特征，疑似存在 SQL 注入。",
        location: `${origin}${u.pathname}?${probeQs}`,
        evidence: `命中片段: ${clip((body.match(SQL_ERROR_RE) || [])[0] || '', 200)}`,
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else set('IN-01', 'passed', '单引号探测未触发数据库报错');
    if (isHtml(errProbe.headers) && /<zqprobe>/.test(body)) {
      set('IN-02', 'failed', '参数值未编码直接回显到 HTML');
      const c = CASE_CATALOG.find(x => x.id === 'IN-02');
      add(makeFinding({
        caseId: 'IN-02', severity: 'medium', title: c.title,
        description: '查询参数中的 HTML 标签被原样回显，存在反射型 XSS 风险（需结合上下文确认可执行）。',
        location: `${origin}${u.pathname}?${probeQs}`,
        evidence: `响应中出现未编码的 <zqprobe>；片段: ${clip(body.slice(Math.max(0, body.indexOf('<zqprobe>') - 60), body.indexOf('<zqprobe>') + 120), 200)}`,
        remediation: c.remediation, cwe: c.cwe, confidence: 'medium',
      }));
    } else set('IN-02', 'passed', 'HTML 标签未被原样回显');
  } else {
    for (const id of ['CM-08', 'IN-01', 'IN-02']) set(id, 'error', `探测失败: ${errProbe.error}`);
  }

  const redirectQuery = REDIRECT_PARAMS.map(p => `${p}=https%3A%2F%2Fzq-probe.example%2F`).join('&');
  const redirProbe = await rawRequest(`${origin}${u.pathname}?${redirectQuery}`, { timeoutMs });
  meta.requests += 1;
  if (redirProbe.ok && [301, 302, 303, 307, 308].includes(redirProbe.status) && /^https:\/\/zq-probe\.example/i.test(String(redirProbe.location || ''))) {
    set('SS-02', 'failed', `Location: ${redirProbe.location}`);
    const c = CASE_CATALOG.find(x => x.id === 'SS-02');
    add(makeFinding({
      caseId: 'SS-02', severity: 'medium', title: c.title,
      description: '跳转参数可直接控制 Location 指向外部域名，可用于钓鱼与令牌窃取。',
      location: `${origin}${u.pathname}?${redirectQuery}`,
      evidence: `HTTP ${redirProbe.status}；Location: ${redirProbe.location}`,
      remediation: c.remediation, cwe: c.cwe,
    }));
  } else {
    set('SS-02', 'passed', redirProbe.ok ? `HTTP ${redirProbe.status}，未跳转到外部域名` : `探测失败: ${redirProbe.error}`);
  }

  // ── 混合内容 / SRI ──
  const html = isHtml(root.headers) ? (root.body || '') : '';
  if (isHttps && html) {
    const mixed = [...html.matchAll(/(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi)].map(m => m[1]);
    if (mixed.length) {
      set('CR-06', 'failed', mixed.slice(0, 5).join(', '));
      const c = CASE_CATALOG.find(x => x.id === 'CR-06');
      add(makeFinding({
        caseId: 'CR-06', severity: 'medium', title: c.title,
        description: 'HTTPS 页面引用了明文 HTTP 资源，可能被中间人篡改。',
        location: baseUrl, evidence: `引用: ${mixed.slice(0, 5).join(', ')}`,
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else set('CR-06', 'passed', '未发现 http:// 资源引用');
  } else {
    set('CR-06', 'skipped', '页面非 HTML 或目标非 HTTPS');
  }

  if (html) {
    const ext = [];
    const scriptRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const linkRe = /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi;
    let m;
    while ((m = scriptRe.exec(html)) !== null) {
      const tag = m[0]; const src = m[1];
      try {
        const su = new URL(src, baseUrl);
        if (su.host !== u.host && !/\bintegrity\s*=/.test(tag)) ext.push(src);
      } catch { /* ignore */ }
    }
    while ((m = linkRe.exec(html)) !== null) {
      const tag = m[0];
      const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      try {
        const su = new URL(href, baseUrl);
        if (su.host !== u.host && !/\bintegrity\s*=/.test(tag)) ext.push(href);
      } catch { /* ignore */ }
    }
    if (ext.length) {
      set('DI-01', 'failed', ext.slice(0, 5).join(', '));
      const c = CASE_CATALOG.find(x => x.id === 'DI-01');
      add(makeFinding({
        caseId: 'DI-01', severity: 'low', title: c.title,
        description: '跨域静态资源未声明 integrity，第三方 CDN 被入侵时可注入任意脚本。',
        location: baseUrl, evidence: `无 integrity 的跨域资源: ${ext.slice(0, 5).join(', ')}`,
        remediation: c.remediation, cwe: c.cwe, confidence: 'medium',
      }));
    } else set('DI-01', 'passed', '未发现缺少 SRI 的跨域资源');
  } else {
    set('DI-01', 'skipped', '页面非 HTML');
  }

  // ── robots.txt / security.txt ──
  const robots = await rawRequest(origin + '/robots.txt', { timeoutMs: Math.min(timeoutMs, 5000) });
  meta.requests += 1;
  if (robots.ok && robots.status === 200 && /text\/plain/i.test(String(robots.headers['content-type'] || ''))) {
    const sensitive = (robots.body.match(/^\s*Disallow:\s*(\S+)/gim) || [])
      .map(x => x.replace(/^\s*Disallow:\s*/i, '').trim())
      .filter(p => /(admin|backup|internal|private|config|api|db|sql|test|debug)/i.test(p));
    if (sensitive.length) {
      set('CM-12', 'failed', sensitive.slice(0, 8).join(', '));
      const c = CASE_CATALOG.find(x => x.id === 'CM-12');
      add(makeFinding({
        caseId: 'CM-12', severity: 'info', title: c.title,
        description: 'robots.txt 列出了敏感路径，为攻击者提供了目录枚举线索。',
        location: origin + '/robots.txt', evidence: `Disallow: ${sensitive.slice(0, 8).join(', ')}`,
        remediation: c.remediation, cwe: c.cwe,
      }));
    } else set('CM-12', 'passed', 'robots.txt 未列出敏感路径');
  } else {
    set('CM-12', 'passed', '无 robots.txt 或不可读');
  }

  const secTxt = await rawRequest(origin + '/.well-known/security.txt', { timeoutMs: Math.min(timeoutMs, 5000) });
  meta.requests += 1;
  if (secTxt.ok && secTxt.status === 200 && /(Contact|Expires)\s*:/i.test(secTxt.body || '')) {
    set('CM-13', 'passed', 'security.txt 已发布');
  } else {
    set('CM-13', 'failed', '未发布 security.txt');
    const c = CASE_CATALOG.find(x => x.id === 'CM-13');
    add(makeFinding({
      caseId: 'CM-13', severity: 'info', title: c.title,
      description: '未提供安全联系渠道，外部研究者无法规范上报漏洞。',
      location: origin + '/.well-known/security.txt', evidence: `HTTP ${secTxt.status || 'error'}`,
      remediation: c.remediation, cwe: c.cwe, confidence: 'high',
    }));
  }

  // ── Host 头注入 ──
  const hostProbeUrl = `${origin}${u.pathname}`;
  const hostProbe = await rawRequest(hostProbeUrl, {
    timeoutMs,
    headers: { Host: 'zq-probe.example', 'X-Forwarded-Host': 'zq-probe.example' },
  });
  meta.requests += 1;
  if (hostProbe.ok && (/zq-probe\.example/i.test(String(hostProbe.location || '')) || /zq-probe\.example/i.test(hostProbe.body || ''))) {
    set('CM-14', 'failed', `HTTP ${hostProbe.status}，Host 值被回显`);
    const c = CASE_CATALOG.find(x => x.id === 'CM-14');
    add(makeFinding({
      caseId: 'CM-14', severity: 'medium', title: c.title,
      description: '应用信任并回显了客户端提供的 Host/X-Forwarded-Host，可用于密码重置链接投毒与缓存污染。',
      location: hostProbeUrl,
      evidence: `自定义 Host 出现在响应中；片段: ${clip(hostProbe.body, 180)}`,
      remediation: c.remediation, cwe: c.cwe,
    }));
  } else if (hostProbe.ok) {
    set('CM-14', 'passed', `HTTP ${hostProbe.status}，Host 未被回显`);
  } else {
    set('CM-14', 'error', `探测失败: ${hostProbe.error}`);
  }

  // 未探测的 live 用例兜底
  for (const c of CASE_CATALOG) {
    if (c.source !== 'live') continue;
    if (!results[c.id]) set(c.id, 'skipped', '该用例需登录态或人工上下文，自动探测未覆盖');
  }

  return { results, findings, meta };
}

/**
 * 将用例目录与探测/工具结果合并，得到每条用例的真实状态。
 */
export function evaluateCases({ mode = 'url', probeResults = {}, toolRuns = {}, findings = [] } = {}) {
  const attributed = attributeToolFindings(findings || []);
  return CASE_CATALOG.map((c) => {
    const base = {
      id: c.id, owasp: c.owasp, category: c.category, title: c.title,
      method: c.method, severity: c.severity, cwe: c.cwe, remediation: c.remediation,
      source: c.source,
    };
    if (c.source === 'manual') {
      return { ...base, status: 'manual', evidence: '需要登录态/业务上下文，未纳入自动探测（不计为通过）' };
    }
    if (mode === 'url' && c.source === 'source') {
      return { ...base, status: 'skipped', evidence: '源码类用例（当前为 URL 黑盒模式）' };
    }
    if (mode === 'source' && c.source === 'live') {
      return { ...base, status: 'skipped', evidence: 'URL 黑盒用例（当前为源码模式）' };
    }
    if (c.tool) {
      const run = toolRuns[c.tool];
      if (!run) return { ...base, status: 'skipped', evidence: `工具 ${c.tool} 未安装或未执行` };
      if (run.error && !run.findings) return { ...base, status: 'error', evidence: `工具执行失败: ${clip(run.error, 200)}` };
      const hits = attributed.filter(f => f.caseId === c.id);
      return hits.length > 0
        ? { ...base, status: 'failed', evidence: `${run.tool} 命中 ${hits.length} 条（${run.durationMs || 0}ms）` }
        : { ...base, status: 'passed', evidence: `${run.tool} 未命中（${run.durationMs || 0}ms）` };
    }
    const pr = probeResults[c.id];
    if (!pr) return { ...base, status: 'skipped', evidence: '未执行' };
    return { ...base, ...pr };
  });
}

/**
 * 把工具发现映射到用例：工具命中的 caseId 已在解析时尽量标注；
 * 未标注的按类别归到对应用例，保证每条工具发现都能被用例覆盖。
 */
export function attributeToolFindings(findings) {
  const byTool = {
    nikto: 'CM-15',
    nmap: 'CM-16',
    semgrep: 'IN-06',
    trivy: 'CV-02',
    osv_scanner: 'CV-03',
    npm_audit: 'CV-04',
    bandit: 'IN-07',
    gitleaks: 'DI-03',
  };
  const nucleiCase = (f) => {
    const text = `${f.title || ''} ${f.description || ''} ${f.raw?.templateId || ''}`.toLowerCase();
    if (/default[-_ ]?(login|password|cred)|weak[-_ ]?cred/.test(text)) return 'AU-01';
    if (/ssrf|server[-_ ]?side[-_ ]?request|open[-_ ]?redirect/.test(text)) return 'SS-01';
    if (/deserial|rce|remote[-_ ]?code|command[-_ ]?inject|template[-_ ]?inject/.test(text)) return 'DI-02';
    if (/sql|inject|xss|cross[-_ ]?site|traversal|lfi|rfi/.test(text)) return 'IN-03';
    return 'CV-01';
  };
  return findings.map(f => {
    if (f.caseId) return f;
    const caseId = f.tool === 'nuclei' ? nucleiCase(f) : (byTool[f.tool] || null);
    return { ...f, caseId };
  });
}

export function summarizeCases(cases) {
  const out = { total: cases.length, passed: 0, failed: 0, skipped: 0, manual: 0, error: 0 };
  for (const c of cases) out[c.status] = (out[c.status] || 0) + 1;
  return out;
}

export function summarizeFindings(findings) {
  const severityDist = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byTool = {};
  const byCategory = {};
  for (const f of findings) {
    severityDist[f.severity] = (severityDist[f.severity] || 0) + 1;
    byTool[f.tool || '-'] = (byTool[f.tool || '-'] || 0) + 1;
    byCategory[f.category || '-'] = (byCategory[f.category || '-'] || 0) + 1;
  }
  const penalty = severityDist.critical * 20 + severityDist.high * 8 + severityDist.medium * 3 + severityDist.low * 1;
  const score = Math.max(0, 100 - penalty);
  let riskLevel = '低';
  if (severityDist.critical > 0 || score < 40) riskLevel = '严重';
  else if (severityDist.high > 0 || score < 70) riskLevel = '高';
  else if (severityDist.medium > 0 || score < 90) riskLevel = '中';
  return { total: findings.length, severityDist, byTool, byCategory, score, riskLevel, unavailable: false };
}

export function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    if (!f || !f.title) continue;
    const key = f.fingerprint || fingerprint([f.tool, f.title, f.location]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...f, fingerprint: key });
  }
  out.sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0));
  return out;
}

/**
 * 手工验证阶段：对已有发现做复现确认，并补充一组真实主动检查。
 */
export async function runActiveVerification(target, findings, { probeResults = {}, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const baseUrl = normalizeTarget(target);
  if (!baseUrl) throw new Error('目标必须是 http(s) URL');
  const origin = new URL(baseUrl).origin;
  const checks = [];
  const newFindings = [];

  // 1) 复核 live 探测类发现：重新请求，确认问题仍存在
  const liveIds = new Set(Object.keys(probeResults || {}));
  const rechecked = new Map();
  for (const f of findings) {
    if (f.tool !== 'live-probe') {
      checks.push({
        id: f.caseId || '-', title: f.title,
        method: `工具证据复核（${f.tool}）`,
        result: 'confirmed',
        evidence: clip(f.evidence || f.description, 200),
      });
      continue;
    }
    const caseId = f.caseId;
    if (!caseId || !liveIds.has(caseId) || rechecked.has(caseId)) continue;
    rechecked.set(caseId, true);
    const pr = probeResults[caseId];
    checks.push({
      id: caseId, title: f.title,
      method: '重新执行探测请求',
      result: pr.status === 'failed' ? 'confirmed' : 'not_reproduced',
      evidence: `首次: ${clip(f.evidence, 160)} / 复核: ${clip(pr.evidence, 160)}`,
    });
  }

  // 2) TRACE 方法（RFC 9110 定义为安全/幂等）
  const trace = await rawRequest(baseUrl, { method: 'TRACE', timeoutMs: Math.min(timeoutMs, 6000) });
  if (trace.ok && trace.status === 200 && /TRACE/i.test(trace.body || '')) {
    const f = makeFinding({
      caseId: 'AC-06', severity: 'medium', title: 'HTTP TRACE 方法启用',
      description: '服务器响应 TRACE 请求，可能被用于跨站追踪（XST）。',
      location: baseUrl, evidence: `TRACE → HTTP 200；响应片段: ${clip(trace.body, 160)}`,
      remediation: '在 Web 服务器禁用 TRACE 方法。', cwe: 'CWE-650',
    });
    newFindings.push(f);
    checks.push({ id: 'AC-06', title: f.title, method: 'TRACE 请求', result: 'confirmed', evidence: clip(f.evidence, 200) });
  } else {
    checks.push({ id: 'AC-06', title: 'TRACE 方法禁用检查', method: 'TRACE 请求', result: 'passed', evidence: trace.ok ? `HTTP ${trace.status}` : `请求失败: ${trace.error}` });
  }

  // 3) crossdomain.xml / clientaccesspolicy.xml 宽松策略
  const cross = await rawRequest(origin + '/crossdomain.xml', { timeoutMs: Math.min(timeoutMs, 5000) });
  if (cross.ok && cross.status === 200 && /allow-access-from\s+domain\s*=\s*["']\*["']/i.test(cross.body || '')) {
    const f = makeFinding({
      caseId: 'AC-05', severity: 'medium', title: 'crossdomain.xml 允许任意域访问',
      description: 'Flash/Silverlight 跨域策略允许任意来源，历史客户端可能借此绕过同源策略。',
      location: origin + '/crossdomain.xml', evidence: clip(cross.body, 200),
      remediation: '删除 crossdomain.xml 或限制为可信域名。', cwe: 'CWE-942',
    });
    newFindings.push(f);
    checks.push({ id: 'AC-05', title: f.title, method: 'GET /crossdomain.xml', result: 'confirmed', evidence: clip(cross.body, 200) });
  } else {
    checks.push({ id: 'AC-05', title: 'crossdomain.xml 宽松策略', method: 'GET /crossdomain.xml', result: 'passed', evidence: cross.ok ? `HTTP ${cross.status}` : `请求失败: ${cross.error}` });
  }

  // 4) 敏感页面缓存控制
  const root = await requestFollow(baseUrl, { timeoutMs });
  if (root.ok) {
    const cc = String(root.headers['cache-control'] || '');
    const sensitivePath = /(login|admin|account|user|profile|order|pay)/i.test(new URL(baseUrl).pathname);
    if (sensitivePath && !/no-store|private/i.test(cc)) {
      const f = makeFinding({
        caseId: 'CR-07', severity: 'low', title: '敏感页面缺少 Cache-Control 保护',
        description: '登录/账户类页面未声明 no-store/private，可能被共享缓存或浏览器历史留存。',
        location: baseUrl, evidence: `Cache-Control: ${cc || '(缺失)'}`,
        remediation: '对敏感页面返回 Cache-Control: no-store, private。', cwe: 'CWE-525',
      });
      newFindings.push(f);
      checks.push({ id: 'CR-07', title: f.title, method: '检查 Cache-Control', result: 'confirmed', evidence: `Cache-Control: ${cc || '(缺失)'}` });
    } else {
      checks.push({ id: 'CR-07', title: '敏感页面缓存控制', method: '检查 Cache-Control', result: 'passed', evidence: `Cache-Control: ${cc || '(缺失，页面非敏感路径)'}` });
    }
  }

  // 5) 明文 HTTP 到 HTTPS 的跳转复核（若目标为 https 则尝试 http）
  const parsed = new URL(baseUrl);
  if (parsed.protocol === 'https:') {
    const httpUrl = `http://${parsed.host}${parsed.pathname}`;
    const r = await rawRequest(httpUrl, { timeoutMs: Math.min(timeoutMs, 6000) });
    if (r.ok && [301, 302, 307, 308].includes(r.status) && /^https:\/\//i.test(String(r.location || ''))) {
      checks.push({ id: 'CR-01', title: 'HTTP→HTTPS 强制跳转复核', method: '请求 http:// 变体', result: 'passed', evidence: `HTTP ${r.status} → ${r.location}` });
    } else if (r.ok && r.status === 200) {
      const f = makeFinding({
        caseId: 'CR-01', severity: 'high', title: 'HTTP 端口可直接提供业务响应',
        description: '同一主机 80 端口直接返回 200，未强制跳转 HTTPS。',
        location: httpUrl, evidence: `HTTP 200；Server: ${r.headers.server || '-'}`,
        remediation: '关闭 80 端口业务响应，统一 301 到 HTTPS。', cwe: 'CWE-319',
      });
      newFindings.push(f);
      checks.push({ id: 'CR-01', title: f.title, method: '请求 http:// 变体', result: 'confirmed', evidence: clip(f.evidence, 200) });
    } else {
      checks.push({ id: 'CR-01', title: 'HTTP→HTTPS 强制跳转复核', method: '请求 http:// 变体', result: r.ok ? 'passed' : 'skipped', evidence: r.ok ? `HTTP ${r.status}` : `HTTP 不可达: ${r.error}` });
    }
  }

  return { checks, newFindings: dedupeFindings(newFindings) };
}

// ============ Markdown 构建 ============
const OWASP_NAMES = {
  A01: 'A01 访问控制失效',
  A02: 'A02 加密机制失效',
  A03: 'A03 注入',
  A04: 'A04 不安全设计',
  A05: 'A05 安全配置错误',
  A06: 'A06 易受攻击和过时的组件',
  A07: 'A07 身份识别与认证失败',
  A08: 'A08 软件和数据完整性失败',
  A09: 'A09 安全日志和监控失败',
  A10: 'A10 服务端请求伪造（SSRF）',
};

const DOMAIN_NAMES = {
  all: '全测试域', web: 'Web 应用', api: 'API/接口', cloud: '云原生/基础设施',
  mobile: '移动端', data: '数据安全与隐私合规', supply: '软件供应链', ai: 'AI/大模型',
};

export function buildSchemeMarkdown({ target, scanType = 'full', testDomain = 'web', description = '', tools = [], engine = '真实工具执行引擎' }) {
  const available = tools.filter(t => t.available);
  const missing = tools.filter(t => !t.available);
  const mode = /^https?:\/\//i.test(String(target || '')) ? 'URL 黑盒（DAST + 主动验证）' : '源码/本地目录（SAST + SCA）';
  const counts = CASE_CATALOG.reduce((acc, c) => {
    acc[c.owasp] = (acc[c.owasp] || 0) + 1;
    return acc;
  }, {});
  const liveCount = CASE_CATALOG.filter(c => c.source === 'live').length;
  const manualCount = CASE_CATALOG.filter(c => c.source === 'manual').length;
  const sourceCount = CASE_CATALOG.filter(c => c.source === 'source').length;
  const urlToolCount = CASE_CATALOG.filter(c => c.source === 'url').length;

  return `# 安全测试方案

> 本方案由**${engine}**生成：工具清单、用例目录、执行流程均为确定性配置，不依赖大模型推测。

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | SEC-SCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')} |
| 生成时间 | ${new Date().toISOString()} |
| 测试目标 | \`${mdCell(target)}\` |
| 目标类型 | ${mode} |
| 测试域 | ${DOMAIN_NAMES[testDomain] || testDomain} |
| 扫描模式 | ${scanType} |
| 执行引擎 | ${engine} |

## 2. 测试目标与范围

${description ? `需求/背景说明：${description}\n\n` : ''}本次测试覆盖以下层面：

1. **暴露面识别**：端口、服务、Web 服务器指纹、管理入口。
2. **配置基线**：安全响应头、TLS、Cookie 属性、CORS、HTTP 方法、错误回显。
3. **已知漏洞**：Nuclei 模板（CVE/暴露/默认口令/未授权访问）、Nikto 服务器配置检查。
4. **应用探测**：SQL 注入错误特征、反射型 XSS、路径遍历、开放重定向、GraphQL introspection、Host 头注入。
5. **依赖与代码**（源码模式）：Semgrep、Trivy、Bandit、Gitleaks、OSV-Scanner。

**不在本次自动范围**：需要登录态的业务越权、批量赋值、支付/订单逻辑绕过、密码爆破、拒绝服务类测试。这些在用例目录中标记为 \`manual\`，不会伪装成已通过。

## 3. 工具清单（真实安装状态）

| 工具 | 类别 | 状态 | 版本 |
| --- | --- | --- | --- |
${available.map(t => `| ${t.name} | ${t.category} | ✅ 可用 | ${mdCell(t.version || '-')} |`).join('\n') || '| - | - | 无可用工具 | - |'}
${missing.map(t => `| ${t.name} | ${t.category} | ⚠️ 未安装 | - |`).join('\n')}

> 未安装的工具不会产生任何结果，也不会被模型“模拟”。安装方式见 \`backend/security/README.md\`。

## 4. 测试用例设计

用例目录共 **${CASE_CATALOG.length}** 条，分布如下：

| 类型 | 数量 | 说明 |
| --- | --- | --- |
| URL 主动探测 | ${liveCount} | 只读 GET/HEAD/OPTIONS/TRACE，带真实证据 |
| 工具规则映射 | ${urlToolCount} | 绑定 Nuclei/Nikto/Nmap 等工具输出 |
| 源码扫描 | ${sourceCount} | 绑定 Semgrep/Trivy/Bandit/Gitleaks/OSV |
| 人工验证 | ${manualCount} | 需登录态/业务上下文，不自动判定 |

| OWASP 分类 | 用例数 |
| --- | --- |
${Object.entries(OWASP_NAMES).map(([k, v]) => `| ${v} | ${counts[k] || 0} |`).join('\n')}

## 5. 执行流程

1. **方案生成**：根据目标类型与已安装工具生成测试范围（本阶段）。
2. **用例生成**：输出可执行用例目录，每条用例带验证方法与判定标准。
3. **安全扫描**：并行执行已安装的扫描器，采集原始输出并归一化为统一漏洞模型。
4. **手工渗透/验证**：对发现逐条复现，补充 TRACE、Host 头、crossdomain、缓存控制等主动检查。
5. **报告生成**：基于真实证据生成报告，标注置信度、CWE/CVE、复现证据与修复建议。

## 6. 授权与安全约束

- 主动探测仅使用只读/幂等方法，不写入数据、不爆破口令、不发起拒绝服务。
- 不访问云元数据地址（169.254.169.254 等）。
- 所有请求带固定 User-Agent，便于目标方审计与白名单。
- 测试前需确认已获得目标系统书面授权。

## 7. 交付物

| 阶段 | 交付物 |
| --- | --- |
| 安全测试方案生成 | 本方案（Markdown/Word/Excel） |
| 安全测试用例生成 | 用例目录（含判定标准） |
| 执行安全扫描 | 工具执行记录 + 原始发现 |
| 执行手工渗透 | 发现复现与主动验证记录 |
| 安全报告生成 | 完整测试报告（含证据与修复建议） |
`;
}

export function buildCasesMarkdown({ target, testDomain = 'web', mode = 'url', cases, scanType = 'full' }) {
  const rows = (cases || CASE_CATALOG.map(c => ({ ...c, status: 'pending', evidence: '待执行' })));
  const stats = summarizeCases(rows);
  return `# 安全测试用例目录

| 项目 | 内容 |
| --- | --- |
| 测试目标 | \`${mdCell(target)}\` |
| 测试域 | ${DOMAIN_NAMES[testDomain] || testDomain} |
| 模式 | ${mode === 'url' ? 'URL 黑盒' : '源码扫描'} / ${scanType} |
| 用例总数 | ${stats.total} |
| 生成方式 | 确定性用例目录（不依赖 LLM） |
| 生成时间 | ${new Date().toISOString()} |

## 执行状态汇总

| 状态 | 数量 |
| --- | --- |
| 通过 | ${stats.passed} |
| 失败（存在风险） | ${stats.failed} |
| 跳过 | ${stats.skipped} |
| 人工验证 | ${stats.manual} |
| 执行异常 | ${stats.error} |

## 用例清单

| 编号 | OWASP | 分类 | 用例 | 验证方法 | 失败时级别 | CWE | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map(c => `| ${c.id} | ${c.owasp} | ${mdCell(c.category)} | ${mdCell(c.title)} | ${mdCell(c.method || '-')} | ${c.severity} | ${c.cwe || '-'} | ${statusLabel(c.status)} |`).join('\n')}

## 判定标准

- **通过（passed）**：探测请求完成，未命中风险特征。
- **失败（failed）**：命中风险特征，且证据记录在报告中。
- **跳过（skipped）**：当前模式不适用或目标/工具不满足前置条件。
- **人工（manual）**：需要登录态、业务数据或写操作，自动引擎不做判定。
- **异常（error）**：探测请求失败，无法得出结论。

> 本目录中的每一条 passed/failed 都对应一次真实请求或真实工具执行；manual 用例不会计入通过率。
`;
}

function statusLabel(status) {
  return ({
    passed: '✅ 通过', failed: '❌ 失败', skipped: '⏭️ 跳过',
    manual: '🙋 人工', error: '⚠️ 异常', pending: '⏳ 待执行',
  })[status] || status;
}

export function buildScanMarkdown({ target, tools = [], findings = [], cases = [], meta = {}, unavailable = false }) {
  const summary = summarizeFindings(findings);
  if (unavailable) { summary.score = null; summary.riskLevel = '无法评估'; summary.unavailable = true; }
  const toolRows = tools.map(t => `| ${t.tool} | ${t.ok ? '✅' : '⚠️'} | ${t.findings ?? 0} | ${t.durationMs ?? '-'} | ${mdCell(t.error || '-')} |`).join('\n');
  return `# 安全扫描执行记录

| 项目 | 内容 |
| --- | --- |
| 测试目标 | \`${mdCell(target)}\` |
| 执行时间 | ${new Date().toISOString()} |
| 探测请求数 | ${meta.requests ?? '-'} |
| 原始发现数 | ${findings.length} |
| 去重后 | ${summary.total} |
| 风险评分 | ${summary.score == null ? '**无法评估**（目标不可达或工具全部失败，不代表目标安全）' : `${summary.score}/100（${summary.riskLevel}）`} |

${unavailable ? '> ⚠️ **本次扫描没有取得有效结果**：目标不可达或所有扫描器执行失败。请检查目标地址/网络/工具安装后重新执行，不要将本记录视为“无漏洞”。\n' : ''}

## 工具执行结果

| 工具 | 状态 | 发现数 | 耗时(ms) | 错误 |
| --- | --- | --- | --- | --- |
${toolRows || '| - | - | - | - | - |'}

## 严重性分布

| Critical | High | Medium | Low | Info |
| --- | --- | --- | --- | --- |
| ${summary.severityDist.critical} | ${summary.severityDist.high} | ${summary.severityDist.medium} | ${summary.severityDist.low} | ${summary.severityDist.info} |

## 真实发现清单

| # | 级别 | 标题 | 工具 | 用例 | 位置 | CVE/CWE |
| --- | --- | --- | --- | --- | --- | --- |
${findings.map((f, i) => `| ${i + 1} | ${f.severity} | ${mdCell(f.title)} | ${f.tool} | ${f.caseId || '-'} | ${mdCell(f.location || '-')} | ${f.cve || f.cwe || '-'} |`).join('\n') || '| - | - | 未发现 | - | - | - | - |'}

## 工具原始输出摘要

${findings.slice(0, 50).map(f => `### [${f.severity.toUpperCase()}] ${f.title}\n\n- 工具：${f.tool}\n- 用例：${f.caseId || '-'}\n- 位置：${f.location || '-'}\n- 证据：${f.evidence || '-'}\n- 说明：${f.description || '-'}\n- 修复：${f.remediation || '-'}\n`).join('\n') || '（无）'}

## 用例执行状态

已评估 ${cases.length} 条用例：通过 ${cases.filter(c => c.status === 'passed').length}，失败 ${cases.filter(c => c.status === 'failed').length}，跳过 ${cases.filter(c => c.status === 'skipped').length}，人工 ${cases.filter(c => c.status === 'manual').length}，异常 ${cases.filter(c => c.status === 'error').length}。

> 扫描阶段仅记录原始结果，不做模型推断。每条发现均可在上表追溯到工具与用例编号。
`;
}

export function buildVerificationMarkdown({ target, findings = [], verification = { checks: [], newFindings: [] }, cases = [] }) {
  const all = dedupeFindings([...findings, ...(verification.newFindings || [])]);
  const confirmed = (verification.checks || []).filter(c => c.result === 'confirmed').length;
  const notReproduced = (verification.checks || []).filter(c => c.result === 'not_reproduced').length;
  const passedChecks = (verification.checks || []).filter(c => c.result === 'passed').length;

  return `# 手工渗透与验证记录

| 项目 | 内容 |
| --- | --- |
| 测试目标 | \`${mdCell(target)}\` |
| 执行时间 | ${new Date().toISOString()} |
| 复现确认 | ${confirmed} |
| 未复现 | ${notReproduced} |
| 主动检查通过 | ${passedChecks} |
| 新增发现 | ${(verification.newFindings || []).length} |

## 一、发现复现

| 用例 | 发现 | 验证方法 | 结果 | 证据摘要 |
| --- | --- | --- | --- | --- |
${(verification.checks || []).map(c => `| ${c.id} | ${mdCell(c.title)} | ${mdCell(c.method)} | ${({ confirmed: '✅ 已复现', not_reproduced: '❌ 未复现', passed: '✅ 通过', skipped: '⏭️ 跳过' })[c.result] || c.result} | ${mdCell(c.evidence || '-')} |`).join('\n') || '| - | - | - | - | - |'}

## 二、补充主动检查

本阶段额外执行以下真实检查（均为只读/幂等）：

1. **TRACE 方法**：验证是否启用跨站追踪。
2. **crossdomain.xml**：检查是否存在允许任意域的宽松跨域策略。
3. **Cache-Control**：敏感页面是否禁止缓存。
4. **HTTP→HTTPS 跳转**：从 80 端口复测是否强制跳转。

## 三、验证后漏洞清单

| # | 级别 | 标题 | 用例 | 置信度 | 已验证 | 位置 |
| --- | --- | --- | --- | --- | --- | --- |
${all.map((f, i) => `| ${i + 1} | ${f.severity} | ${mdCell(f.title)} | ${f.caseId || '-'} | ${f.confidence || '-'} | ${f.verified ? '是' : '否'} | ${mdCell(f.location || '-')} |`).join('\n') || '| - | - | 无 | - | - | - | - |'}

## 四、逐条证据

${all.slice(0, 60).map(f => `### [${f.severity.toUpperCase()}] ${f.title}\n\n- 用例：${f.caseId || '-'}\n- 工具/方法：${f.tool}\n- 位置：${f.location || '-'}\n- 证据：${f.evidence || '-'}\n- 说明：${f.description || '-'}\n- 修复建议：${f.remediation || '-'}\n- 置信度：${f.confidence || '-'}；已验证：${f.verified ? '是' : '否'}\n`).join('\n') || '（无）'}

> 未复现的发现不会被删除，而是在结果中标注 \`not_reproduced\`，供人工判断是否为环境差异或偶发。
`;
}

export function buildReportMarkdown({
  workflowId, target, scanType = 'full', testDomain = 'web', mode = 'url',
  scanSummary, findings = [], cases = [], verification = {}, tools = [],
  durationMs = 0, description = '',
}) {
  const combined = dedupeFindings([...findings, ...(verification.newFindings || [])]);
  const summary = scanSummary || summarizeFindings(combined);
  const unavailable = !!summary.unavailable;
  const caseStats = summarizeCases(cases);
  const owaspStats = {};
  for (const c of cases) {
    if (!owaspStats[c.owasp]) owaspStats[c.owasp] = { total: 0, passed: 0, failed: 0, manual: 0, skipped: 0, error: 0 };
    owaspStats[c.owasp].total += 1;
    owaspStats[c.owasp][c.status] = (owaspStats[c.owasp][c.status] || 0) + 1;
  }
  const top = combined.slice(0, 10);
  const manualCases = cases.filter(c => c.status === 'manual');
  const failedCases = cases.filter(c => c.status === 'failed');
  const confirmedChecks = (verification.checks || []).filter(c => c.result === 'confirmed').length;

  return `# 安全测试报告

> 执行引擎：**真实工具执行引擎**（确定性用例 + 开源扫描器 + 主动探测，无 LLM 生成内容）
> 报告中每一条发现都可追溯到工具输出或原始 HTTP 证据。

## 1. 报告信息

| 项目 | 内容 |
| --- | --- |
| 报告编号 | SEC-RPT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(workflowId).slice(-6)} |
| 工作流 ID | \`${workflowId}\` |
| 测试目标 | \`${mdCell(target)}\` |
| 目标类型 | ${mode === 'url' ? 'URL 黑盒（DAST）' : '源码/依赖（SAST+SCA）'} |
| 测试域 | ${DOMAIN_NAMES[testDomain] || testDomain} |
| 扫描模式 | ${scanType} |
| 执行时间 | ${new Date().toISOString()} |
| 总耗时 | ${Math.round(durationMs / 1000)} 秒 |
| 需求说明 | ${mdCell(description || '-')} |

## 2. 执行摘要

| 指标 | 数值 |
| --- | --- |
| 安全评分 | **${summary.score == null ? '无法评估' : `${summary.score}/100`}** |
| 风险等级 | **${summary.riskLevel}** |
| 漏洞总数 | ${summary.total} |
| Critical / High / Medium / Low / Info | ${summary.severityDist.critical} / ${summary.severityDist.high} / ${summary.severityDist.medium} / ${summary.severityDist.low} / ${summary.severityDist.info} |
| 用例总数 | ${caseStats.total} |
| 通过 / 失败 / 跳过 / 人工 / 异常 | ${caseStats.passed} / ${caseStats.failed} / ${caseStats.skipped} / ${caseStats.manual} / ${caseStats.error} |
| 复现确认 | ${confirmedChecks} |

${unavailable ? '> ⚠️ **本次执行未取得有效扫描结果**：目标不可达或所有扫描器失败。报告中的 0 漏洞不代表目标安全，请修复可达性/工具后重新执行。\n' : ''}${top.length ? `**优先处置（Top ${top.length}）**：

${top.map((f, i) => `${i + 1}. **[${f.severity.toUpperCase()}]** ${f.title} — \`${f.location || '-'}\`（${f.tool}）`).join('\n')}` : (unavailable ? '**本次未取得有效扫描结果，无法判断目标安全性。**' : '**本次未发现可确认的安全问题。** 这不等于系统绝对安全，请结合 manual 用例与业务上下文复核。')}

## 3. 测试方法与工具

### 3.1 工具执行记录

| 工具 | 状态 | 发现数 | 耗时(ms) |
| --- | --- | --- | --- |
${tools.map(t => `| ${t.tool} | ${t.ok ? '✅' : '⚠️'} | ${t.findings ?? 0} | ${t.durationMs ?? '-'} |`).join('\n') || '| - | - | - | - |'}

### 3.2 测试阶段

1. 方案生成（确定性）：目标类型识别、工具盘点、范围与授权约束。
2. 用例生成（确定性）：${caseStats.total} 条用例，覆盖 OWASP Top 10。
3. 安全扫描（真实工具）：Nuclei / Nikto / Nmap（URL）或 Semgrep / Trivy / Bandit / Gitleaks / OSV（源码）。
4. 手工渗透（主动验证）：逐条复现 + TRACE / Host 头 / crossdomain / 缓存 / HTTPS 跳转。
5. 报告生成（确定性）：基于证据汇总，不做模型补全。

## 4. 漏洞统计

| 严重性 | 数量 |
| --- | --- |
| Critical | ${summary.severityDist.critical} |
| High | ${summary.severityDist.high} |
| Medium | ${summary.severityDist.medium} |
| Low | ${summary.severityDist.low} |
| Info | ${summary.severityDist.info} |

### 按类别

| 类别 | 数量 |
| --- | --- |
${Object.entries(summary.byCategory).map(([k, v]) => `| ${mdCell(k)} | ${v} |`).join('\n') || '| - | - |'}

## 5. 漏洞详情

${combined.map((f, i) => `### 5.${i + 1} [${f.severity.toUpperCase()}] ${f.title}

| 属性 | 值 |
| --- | --- |
| 用例编号 | ${f.caseId || '-'} |
| 来源工具 | ${f.tool} |
| 置信度 | ${f.confidence || '-'} |
| 已验证 | ${f.verified ? '是' : '否'} |
| CVSS | ${f.cvss ?? '-'} |
| CWE | ${f.cwe || '-'} |
| CVE | ${f.cve || '-'} |
| 位置 | \`${mdCell(f.location || '-')}\` |

**描述**：${f.description || '-'}

**证据**：${f.evidence || '-'}

**修复建议**：${f.remediation || '-'}
`).join('\n') || '（本次未发现可确认漏洞）'}

## 6. 用例执行结果

### 6.1 OWASP 覆盖

| 分类 | 用例数 | 通过 | 失败 | 人工 | 跳过 | 异常 |
| --- | --- | --- | --- | --- | --- | --- |
${Object.entries(OWASP_NAMES).map(([k, v]) => {
    const s = owaspStats[k] || { total: 0, passed: 0, failed: 0, manual: 0, skipped: 0, error: 0 };
    return `| ${v} | ${s.total} | ${s.passed} | ${s.failed} | ${s.manual} | ${s.skipped} | ${s.error} |`;
  }).join('\n')}

### 6.2 失败用例

| 编号 | 用例 | 证据 |
| --- | --- | --- |
${failedCases.map(c => `| ${c.id} | ${mdCell(c.title)} | ${mdCell(c.evidence || '-')} |`).join('\n') || '| - | 无 | - |'}

### 6.3 未自动验证（manual）

以下用例需要登录态、业务数据或写操作，自动引擎**未做判定**，请安排人工测试：

| 编号 | 用例 | 原因 |
| --- | --- | --- |
${manualCases.map(c => `| ${c.id} | ${mdCell(c.title)} | ${mdCell(c.evidence || '需人工验证')} |`).join('\n') || '| - | 无 | - |'}

## 7. 修复优先级建议

${summary.severityDist.critical > 0 ? '- **立即（24h 内）**：修复所有 Critical 发现，必要时下线受影响接口。\n' : ''}${summary.severityDist.high > 0 ? '- **尽快（1 周内）**：修复 High 发现并回归验证。\n' : ''}${summary.severityDist.medium > 0 ? '- **本迭代**：修复 Medium 发现（安全响应头、CORS、Cookie 属性等）。\n' : ''}${summary.severityDist.low + summary.severityDist.info > 0 ? '- **持续改进**：清理 Low/Info 项（版本泄露、security.txt、SRI 等）。\n' : ''}- 修复后重新执行本工作流，确认失败用例转为通过。

## 8. 测试限制与说明

1. 本报告仅覆盖**无需登录**即可触达的攻击面；认证后的越权、业务逻辑、批量赋值需人工验证。
2. 未执行口令爆破、拒绝服务、写操作类测试，避免影响目标可用性与数据完整性。
3. 工具规则存在误报/漏报，Critical/High 发现建议人工复核证据后处置。
4. 扫描结果反映**执行时点**状态；依赖库与 CVE 数据会随时间变化。
5. 本报告不包含任何 LLM 推测内容；未验证项已明确标注。

## 附录：执行环境

- Node.js：${process.version}
- 扫描器数量：${tools.length}
- 探测请求数：见「安全扫描执行记录」阶段交付物
- 生成时间：${new Date().toISOString()}
`;
}

export default {
  CASE_CATALOG,
  normalizeTarget,
  runLiveProbes,
  runActiveVerification,
  evaluateCases,
  attributeToolFindings,
  summarizeCases,
  summarizeFindings,
  dedupeFindings,
  buildSchemeMarkdown,
  buildCasesMarkdown,
  buildScanMarkdown,
  buildVerificationMarkdown,
  buildReportMarkdown,
};
