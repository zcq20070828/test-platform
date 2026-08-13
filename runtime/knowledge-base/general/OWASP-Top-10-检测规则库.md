# OWASP Top 10 (2021) 检测规则库

> 最后更新: 2026-08-13
> 数据源: local-fallback
> 官方仓库: https://github.com/OWASP/Top10/tree/master/2021/docs/en
> 本文档已向量化供 security-sentinel agent 检索

## 评分标准

| 评分区间 | 等级 | 说明 |
|---------|------|------|
| 90-100 | 优秀 | 无重大风险 |
| 75-89 | 良好 | 低危问题 |
| 60-74 | 中危 | 中危漏洞,必须修复 |
| 40-59 | 高危 | 高危漏洞,禁止上线 |
| 0-39 | 极差 | 严重漏洞 |
| 无漏洞 | 95 | 仅当确实无漏洞时 |

## A01:2021 失效的访问控制（Broken Access Control）

**严重程度**: 高危
**数据源**: local-fallback (A01_2021-Broken_Access_Control.md)

**CWE 映射**: CWE-22, CWE-284, CWE-285, CWE-639

**类型**: 水平越权 (IDOR)、垂直越权、路径遍历、权限提升

**检测方法**:

- 改资源 ID: GET /api/profile/123 → /api/profile/124
- JWT sub claim 篡改
- 路径穿越: ../../../etc/passwd
- HTTP 方法篡改

**正则检测规则**:

```regex
\.findById\s*\(\s*req\.params\.
jwt\.verify.*ignoreExpiration
path\.join.*\.\.\/\.\.\/\.\.
```

**修复建议**: 服务端权限校验;权限检查放业务层;JWT 严格验签;路径用白名单

**OWASP 抓取时间**: 2026-08-13T09:05:18.025Z

---

## A02:2021 加密失败（Cryptographic Failures）

**严重程度**: 高危
**数据源**: local-fallback (A02_2021-Cryptographic_Failures.md)

**CWE 映射**: CWE-259, CWE-327, CWE-330, CWE-916

**类型**: 硬编码密钥、弱加密算法、明文传输 (HTTP)、弱随机数

**检测方法**:

- 硬编码密码/密钥
- MD5/SHA1/DES
- Math.random()
- TLS 校验关闭

**正则检测规则**:

```regex
(password|secret|api_?key)\s*[:=]\s*['"][^'"]+['"]
crypto\.createHash\(['"](md5|sha1)['"]
Math\.random\(\)
verify\s*:\s*false
```

**修复建议**: bcrypt/Argon2 哈希;AES-256-GCM;强制 HTTPS;crypto.randomBytes();关闭详细错误堆栈

**OWASP 抓取时间**: 2026-08-13T09:05:06.275Z

---

## A03:2021 注入（Injection）

**严重程度**: 严重
**数据源**: local-fallback

**CWE 映射**: CWE-74, CWE-77, CWE-78, CWE-79, CWE-89, CWE-90

**类型**: SQL 注入、NoSQL 注入、命令注入、XSS、模板注入

**检测方法**:

- SQL: 字符串拼接用户输入
- XSS: <script>alert(1)</script>
- 命令注入: ; rm -rf /
- 模板注入: {{constructor}}

**正则检测规则**:

```regex
query\s*\(\s*['"].*\$\{
innerHTML\s*=\s*[^"']*\+
dangerouslySetInnerHTML
v-html
eval\s*\(
mongodb.*\$where\s*:
```

**修复建议**: 参数化查询(Prepared Statements);HTML 输出前转义;CSP 头;避免 innerHTML

---

## A04:2021 不安全设计（Insecure Design）

**严重程度**: 高危
**数据源**: local-fallback

**CWE 映射**: CWE-209, CWE-256, CWE-501, CWE-522

**类型**: 业务逻辑缺陷、缺乏威胁建模、缺少速率限制、无审计日志

**检测方法**:

- 业务流程可绕过
- 并发问题缺幂等
- 注册/找回密码无频控
- 缺少 SDL

**正则检测规则**:

```regex
TODO.*security
FIXME.*security
rate\s*limit.*not\s*implemented
```

**修复建议**: 业务用状态机建模;关键操作加幂等键;速率限制;SDL 流程;敏感操作二次验证

---

## A05:2021 安全配置错误（Security Misconfiguration）

**严重程度**: 高危
**数据源**: local-fallback (A05_2021-Security_Misconfiguration.md)

**CWE 映射**: CWE-2, CWE-16, CWE-260, CWE-732

**类型**: 默认配置、调试模式、未修补组件、缺失安全头

**检测方法**:

- 默认账号未修改 admin/admin123
- 调试模式暴露堆栈
- 管理后台暴露 /admin /actuator
- 缺失 CSP/HSTS/X-Frame-Options
- CORS * 允许
- 目录列表启用

**正则检测规则**:

```regex
NODE_ENV.*development
cors\(\s*\{\s*origin\s*:\s*['"]\*
swagger.*enabled.*true
```

**修复建议**: 生产关调试;最小化安装;HTTP 安全头全量;CORS 严格白名单;版本扫描

**OWASP 抓取时间**: 2026-08-13T09:05:18.657Z

---

## A06:2021 易受攻击和过时的组件（Vulnerable and Outdated Components）

**严重程度**: 严重
**数据源**: local-fallback (A06_2021-Vulnerable_and_Outdated_Components.md)

**CWE 映射**: CWE-937, CWE-1035, CWE-1104

**类型**: 已知 CVE 库、未维护依赖、过期框架

**检测方法**:

- 过期 jQuery < 3.5
- 过期 Log4j < 2.17
- 过期 Apache Struts
- 未更新的 Docker 镜像
- npm audit 报告未处理

**正则检测规则**:

```regex
"jquery"\s*:\s*"[\^~]?[12]\.
"log4j"\s*:\s*"[\^~]?[01]\.
"openssl"\s*:\s*"[\^~]?1\.0\.
```

**修复建议**: 建立 SBOM;订阅 CVE;CI 集成 SCA (Snyk/Dependabot);npm audit / pip-audit

**OWASP 抓取时间**: 2026-08-13T09:05:06.089Z

---

## A07:2021 识别和身份认证失败（Identification and Authentication Failures）

**严重程度**: 高危
**数据源**: local-fallback (A07_2021-Identification_and_Authentication_Failures.md)

**CWE 映射**: CWE-287, CWE-297, CWE-384, CWE-521

**类型**: 弱密码策略、缺少 MFA、会话固定、JWT 缺陷

**检测方法**:

- 弱密码 123456
- 登录无速率限制
- 会话 ID 不失效
- JWT 不验签
- alg=none
- Cookie 缺 Secure/HttpOnly

**正则检测规则**:

```regex
jwt\.decode\s*\(
alg.*none
cookie.*secure.*false
password.*min.*length.*[1-5]
```

**修复建议**: 密码 12+ 位含大小写数字符号;MFA;JWT HS256/RS256 严格验签;Cookie Secure+HttpOnly+SameSite

**OWASP 抓取时间**: 2026-08-13T09:05:18.507Z

---

## A08:2021 软件和数据完整性失败（Software and Data Integrity Failures）

**严重程度**: 高危
**数据源**: local-fallback

**CWE 映射**: CWE-345, CWE-353, CWE-426, CWE-494

**类型**: 不安全的反序列化、自动更新无签名、依赖混淆

**检测方法**:

- pickle.loads(用户输入)
- unserialize($_GET)
- CI/CD 无签名
- npm postinstall 自动执行

**正则检测规则**:

```regex
pickle\.loads?\s*\(
yaml\.load\([^,)]*Loader\s*=\s*yaml\.Loader
unserialize\s*\(\s*\$_(GET|POST)
JSON\.parse[^)]*\)\s*\.\s*eval
```

**修复建议**: 反序列化用签名/加密数据;CI/CD Sigstore/SLSA;npm --ignore-scripts;包管理哈希锁定

---

## A09:2021 安全日志和监控失败（Security Logging and Monitoring Failures）

**严重程度**: 中危
**数据源**: local-fallback (A09_2021-Security_Logging_and_Monitoring_Failures.md)

**CWE 映射**: CWE-117, CWE-223, CWE-532, CWE-778

**类型**: 缺少审计日志、日志注入、无可观测性、告警缺失

**检测方法**:

- 登录失败无日志
- 敏感操作无审计
- 日志可注入用户输入
- ELK/Loki 未部署
- 日志泄露 token/密码

**正则检测规则**:

```regex
console\.log\(.*\$
logger\.(info|debug).*password|token|secret
```

**修复建议**: 认证事件全部日志;关键操作 AOP 切面;日志脱敏;ELK/Loki;SIEM 告警;6+ 月保留

**OWASP 抓取时间**: 2026-08-13T09:04:58.024Z

---

## A10:2021 服务端请求伪造 (SSRF)（Server-Side Request Forgery）

**严重程度**: 高危
**数据源**: local-fallback

**CWE 映射**: CWE-918

**类型**: 内网探测、云元数据访问、协议走私

**检测方法**:

- fetch(req.query.url) 用户可控 URL
- 云元数据 169.254.169.254
- gopher:// dict:// file://
- DNS rebinding
- WebHook/图片代理被滥用

**正则检测规则**:

```regex
fetch\s*\(\s*req\.(query|body|params)
axios\s*\(\s*req\.(query|body|params)
requests\.(get|post)\s*\(\s*[^,)]*\+
```

**修复建议**: URL 白名单 + DNS 解析后再校验 IP 不在内网;禁 file/gopher/dict;云元数据需 IMDSv2;302 不自动跟随;内网分段隔离

---

## 增量补充: 最新攻击手法

截至 2026-08-13,补充以下最新发现的攻击向量:

### 2024-Q3: PyPI typosquatting 供应链投毒

**特征匹配**: `pip install reqests`

### 2024-Q4: AI Prompt Injection

**特征匹配**: `忽略以上指令|ignore previous instructions`

### 2025-Q1: JWT kid 注入

**特征匹配**: `jwt.verify.*kid.*req.body`

### 2025-Q2: GraphQL 批量查询 DoS

**特征匹配**: `graphql.*depthLimit`

---

## 元信息

- OWASP 版本: 2021
- 最后更新: 2026-08-13
- 规则条目数: 10 主分类 + 4 增量向量
- 数据源: local-fallback
- 官方仓库: https://github.com/OWASP/Top10
