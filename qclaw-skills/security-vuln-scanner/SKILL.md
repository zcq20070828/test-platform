# Security Vulnerability Scanner

针对 Web 应用源码和 API 进行**静态安全扫描**，覆盖 OWASP Top 10，输出结构化漏洞报告。

> 广度强化：本 Skill 的扫描视角须扩展到 security-sentinel 的 **7 大测试域**（web / api / cloud / mobile / data / supply / ai），各域检查项与合规基线见 security-sentinel-skill。

## 🌐 扫描域覆盖（7 大域）

| 域 | 静态扫描重点 | 合规基线 |
|---|---|---|
| web | 越权/注入/XSS/SSRF/CSRF/逻辑漏洞（OWASP Top 10） | OWASP Top 10 2021 |
| api | JWT/鉴权绕过、越权(BOLA/BFLA)、参数污染、速率限制、批量分配 | OWASP API Security Top 10 |
| cloud | 容器/镜像配置、IAM/RBAC 策略、密钥硬编码、公网暴露 | CIS Benchmark、等保2.0 |
| mobile | 组件导出、不安全存储、WebView 桥接、证书绑定 | OWASP MASVS |
| data | 敏感数据落库/传输、脱敏、留存、跨境 | 等保2.0、个保法、数安法 |
| supply | 依赖 CVE、SBOM 缺失、恶意包、许可证风险 | SBOM/CVE |
| ai | 提示注入/越狱检测、工具调用越权、输出有害（可复用 security-sentinel-skill） | OWASP LLM Top 10 |

## 🔬 深度要求（每条 finding 必含）

- `cvssScore`(CVSS v3.1)、`bizRisk`(业务风险高/中/低)、`owaspCategory`/`cwe`/`cve`
- `poc`(真实可利用验证步骤) + `verified`(是否已真实验证)
- `codeFix`(代码级修复示例)、`compliance`([{standard,clause,level}])

## 功能

- **A01 失效的访问控制**：水平/垂直越权、IDOR、路径遍历
- **A02 加密失败**：硬编码密码/密钥/Token、弱加密算法
- **A03 注入**：SQLi、XSS、命令注入、LDAP 注入、NoSQL 注入
- **A04 不安全设计**：安全反模式、弱验证码
- **A05 安全配置错误**：CORS 宽松配置、调试模式、默认凭据
- **A06 易受攻击和过时的组件**：已知 CVE 依赖（需配合 package-lock）
- **A07 识别与身份验证失败**：弱密码策略、Session 固定攻击
- **A08 软件和数据完整性失败**：未签名序列化、依赖未校验
- **A09 安全日志和监控失败**：缺少登录失败日志、审计日志
- **A10 服务器端请求伪造（SSRF）**：用户可控 URL 发起请求

## 触发词

- "安全扫描"
- "漏洞检测"
- "security scan"
- "代码安全"
- "OWASP"
- scanType: `full` / `sql` / `xss` / `os` / `business`

## 扫描入口

```javascript
// 主扫描函数
async function scanCode(code, scanType = 'full') {
  // code: 源码文本或文件列表
  // scanType: full|sql|xss|os|business
}
```

## 检测规则

### A01 失效的访问控制

```javascript
// 路径遍历
const pathTraversal = [
  /\.\.\/|\.\.\\|%2e%2e/i,  // 经典路径穿越
  /readFile\s*\(\s*req\.(body|params|query)/,
  /res\.sendFile\s*\(\s*req\./,
  /include\s*\(\s*req\./,
  /render\s*\(\s*req\./,
];

// 越权访问（直接对象引用）
const idor = [
  /SELECT.*FROM.*WHERE.*\+\s*req\.session\.userId/i,
  /DELETE.*WHERE.*id\s*=\s*req\.body/,
  /\.findById\s*\(\s*req\.params/,
  /\.(find|findOne|findById)\([^)]*(?!userId|session|owner)/,
];

// 缺失鉴权中间件
const missingAuth = [
  /router\.(get|post|put|delete)\s*\(\s*['"][^'"]+['"],\s*(?!.*auth|middleware)/,
  /@GetMapping|@PostMapping(?!.*secured)/,
];
```

### A02 加密失败

```javascript
const weakCrypto = [
  /crypto\.createCipher\s*\(/,  // 已废弃的 cipher
  /md5\s*\(|sha1\s*\(/,
  /password\s*=\s*['"][^'"]+['"]/i,
  /api[_-]?key\s*=\s*['"][^'"]+['"]/i,
  /secret\s*=\s*['"][^'"]+['"]/i,
  /token\s*=\s*['"][A-Za-z0-9]{8,}['"]/i,
  /Authorization:\s*['"]Bearer\s+[A-Za-z0-9_\-]{10,}['"]/,
  /\.env\s*:\s*['"]/,
  /process\.env\.(AWS_|AZURE_|GOOGLE_|STRIPE_)/,
  /sk[-_]live[-_]/,  // Stripe live key
];
```

### A03 注入

```javascript
// SQL 注入
const sqlInjection = [
  /query\s*\(\s*['"`]SELECT.*\+\s*\w+/i,
  /execute\s*\(\s*['"`].*\$\{/i,
  /db\.exec\s*\(\s*['"`].*\$\{/i,
  /sequelize\.query\s*\([^)]*\+[^)]*\)/i,
  /WHERE\s+\w+\s*=\s*'\s*\+/,  // string concat in WHERE
  /\+ ['"].*['"]\s*\.join\s*\(/,
];

// XSS
const xssPatterns = [
  /innerHTML\s*=/,
  /document\.write\s*\(/,
  /\.html\s*\(\s*.*(?:req|input|body|params|query)/i,
  /dangerouslySetInnerHTML/,
  /v-html\s*=/,         // Vue
  /\{\{\{.*\}\}\}/,     // Handlebars unescaped
  /<%\s*=.*%>/,        // EJS unescaped
];

// 命令注入
const cmdInjection = [
  /exec\s*\(\s*.*\$/,
  /execSync\s*\(\s*.*\$/,
  /spawn\s*\([^)]*\$/,
  /popen\s*\([^)]*\$/,
  /shell\s*\([^)]*\$/,
  /\${\s*(?:req|input|body|params|query)/,
  /`.*\$\{.*\}`/,
];

// NoSQL 注入
const nosqlInjection = [
  /\$where\s*:/,
  /\$ne\s*:/,
  /\$gt\s*:/,
  /\$lt\s*:/,
  /password\s*:\s*\{[^}]*\$/,
  /email\s*:\s*\{[^}]*ne:/,
];

// LDAP 注入
const ldapInjection = [
  /ldap\.search\s*\([^)]*\+.*\)/i,
  /searchFilter\s*\(\s*['"`].*\$\{/,
];
```

### A04 不安全设计

```javascript
const weakDesign = [
  /Math\.random\s*\(\)/,       // 不安全随机数（用于安全上下文）
  /captcha\s*[=:]\s*['" ]*['" ]*[0-9]{4}['" ]*['" ]*\}/i,
  /verifyCode\s*[=:]\s*['" ]*\d{4,6}/i,
  /rateLimit\s*[=:]\s*0\b/,   // 无速率限制
  /maxAttempts\s*[=:]\s*['" ]*(unlimited|infinite|false|null)/i,
];
```

### A05 安全配置错误

```javascript
const misconfig = [
  /accessControlAllowOrigin\s*[=:]\s*['" ]*\*['" ]*;/i,
  /CORS\s*\(\s*\{[^}]*origin\s*:\s*['" ]*\*['" ]*/i,
  /debug\s*[=:]\s*true/i,
  /DEBUG\s*[=:]\s*true/i,
  /NODE_ENV\s*=\s*['" ]*development['" ]*$/m,
  /app\.use\s*\(\s*express\.json\s*\(\s*\{[^}]*limit\s*:\s*['" ]*undefined/i,
  /strictTransportSecurity\s*[=:]\s*['" ]*['" ]*['" ]*;/i,
];
```

### A07 识别与身份验证失败

```javascript
const weakAuth = [
  /password\s*===\s*['"][^'"]{0,7}['"]/i,  // 弱密码比较
  /if\s*\(\s*password\s*===\s*['"][^'"]+['"]\s*\)/i,
  /bcrypt\.compareSync\s*\(\s*[^,]+,\s*['"][^'"]+['"]\s*\)/i,  // 硬编码 hash
  /jwt\.sign\s*\(\s*\{[^}]*expiresIn\s*:[^}]*['"]*['" ]*\}/i,  // 无过期时间
  /session\.cookie\.secure\s*[=:]\s*false/i,
  /cookie\s*\(\s*\{[^}]*httpOnly\s*:[^}]*false/i,
];
```

### A10 SSRF

```javascript
const ssrf = [
  /https?:\/\/.*\$\{/,                    // 用户输入拼入 URL
  /axios\.(get|post|request)\s*\([^)]*\$\{/,
  /fetch\s*\([^)]*\$\{/,
  /request\s*\([^)]*\$\{/,
  /urllib\.request\s*\([^)]*\$\{/,
  /url\s*:\s*['" ]*https?:\/\/['" ]*\+.*\)/i,
];
```

## 评分算法

```
基础分 = 100
每发现 1 个 critical → -25
每发现 1 个 high → -15
每发现 1 个 medium → -8
每发现 1 个 low → -3
每发现 1 个 info → -1
最低分 = 0
```

## 输出格式

```json
{
  "scanType": "full",
  "timestamp": "ISO-8601",
  "durationMs": 1234,
  "summary": {
    "total": 5,
    "critical": 1,
    "high": 2,
    "medium": 1,
    "low": 1,
    "info": 0
  },
  "score": 54,
  "findings": [
    {
      "id": "A03-SQL-001",
      "category": "A03:2021 - Injection",
      "type": "sql_injection",
      "severity": "high",
      "title": "SQL 注入风险",
      "description": "用户输入通过字符串拼接进入 SQL 查询",
      "location": "src/user.js:42",
      "evidence": "query(`SELECT * FROM users WHERE id=${req.params.id}`)",
      "recommendation": "使用参数化查询或 ORM",
      "cweId": "CWE-89",
      "remediation": "const users = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id])"
    }
  ],
  "recommendations": [
    "优先修复 A03 注入类漏洞（SQLi/XSS）",
    "检查所有用户输入进入敏感上下文的路径",
    "启用安全响应头（X-Frame-Options, CSP, HSTS）"
  ]
}
```

## 限制

- 本 skill 为**静态代码扫描**，不执行动态 HTTP 请求
- 对于需要运行时行为检测的漏洞（如 SSRF），仅作启发式匹配
- 实际扫描时需结合 security-scanner（nmap/nuclei）做 DAST
