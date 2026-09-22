---
name: security-scanner
description: 深度安全扫描技能。通过 AI 分析 + 正则匹配对目标执行 DAST，覆盖 7 大测试域（Web/API/云原生/移动端/数据安全合规/供应链/AI），含端口扫描、漏洞识别、SSL 检测、渗透测试各阶段。触发词：安全扫描、渗透测试、漏洞检测、OWASP、pentest、nmap、nuclei。
---

# Security Scanner（深度安全扫描）

本 skill 指导 AI 对目标执行**深度安全评估**，涵盖信息收集→漏洞识别→风险评级→修复建议全流程。

> 广度强化：评估目标须按 security-sentinel 的 **7 大测试域**（web / api / cloud / mobile / data / supply / ai）展开，各域重点与合规基线见 security-sentinel-skill。

## 🌐 扫描域覆盖（7 大域）

| 域 | DAST/探测重点 | 合规基线 |
|---|---|---|
| web | URL/表单/接口：注入、XSS、越权、SSRF、CORS、安全头 | OWASP Top 10 2021 |
| api | REST/GraphQL：JWT 绕过、越权、参数污染、限速缺失 | OWASP API Security Top 10 |
| cloud | 公网暴露面、云元数据(169.254.169.254)、存储桶、IAM 越权 | CIS Benchmark、等保2.0 |
| mobile | 移动端接口/深链/组件暴露、证书绑定 | OWASP MASVS |
| data | 明文传输、敏感接口越权获取、脱敏失效 | 等保2.0、个保法、数安法 |
| supply | 第三方组件 CVE、SBOM 缺失、依赖投毒 | SBOM/CVE |
| ai | 提示注入/越狱探测、工具调用越权 | OWASP LLM Top 10 |

## 🔬 深度要求（每条 finding 必含）

- `cvssScore`(CVSS v3.1)、`bizRisk`(业务风险)、`owaspCategory`/`cwe`/`cve`
- `poc`(真实可利用验证步骤) + `verified`(是否已真实验证)
- `codeFix`(代码级修复)、`compliance`([{standard,clause,level}])
- 报告级须给出 `attackChains`(攻击链) 与 `threatModel`(威胁建模)

## 扫描阶段（对应 pentest-workbench 五阶段）

### Phase 1: Recon & Fingerprinting（侦察与指纹识别）

**AI 分析内容：**
```
目标 URL: https://example.com
1. 提取域名 → 分析注册信息（whois）、子域名
2. HTTP 方法探测（GET/POST/PUT/DELETE/OPTIONS/PATCH）
3. HTTP 响应头分析：
   - Server（Web 服务器类型/版本）
   - X-Powered-By（编程语言/框架）
   - X-Frame-Options / X-Content-Type-Options / CSP（安全头配置）
   - CORS 配置（Access-Control-Allow-Origin）
   - HSTS / HTTPS 强制跳转
4. 技术栈指纹：
   - Cookie 名（JSESSIONID→Java, PHPSESSID→PHP, ASP.NET_SessionId→.NET）
   - HTML 源码特征（Vue/React/jQuery 版本标识）
   - robots.txt / sitemap.xml 暴露路径
5. WAF 检测（Cloudflare/Akamai/Security.WAF 响应特征）
```

**正则匹配：**
```javascript
// Web 技术指纹
const techFingerprints = [
  { pattern: /WordPress|wp-content|wp-includes/i, tech: 'WordPress' },
  { pattern: /Drupal|drupal/i, tech: 'Drupal' },
  { pattern: /Joomla|joomla/i, tech: 'Joomla' },
  { pattern: /Vue\.js|v-ref:/i, tech: 'Vue.js' },
  { pattern: /React|react-dom|_reactFiberId/i, tech: 'React' },
  { pattern: /Angular|ng-version/i, tech: 'Angular' },
  { pattern: /jQuery[\.\d]*\./i, tech: 'jQuery' },
  { pattern: /Express|express-session/i, tech: 'Express/Node.js' },
  { pattern: /Django|CSRFTOKEN|XSRF-TOKEN/i, tech: 'Django' },
  { pattern: /Laravel|laravel_session/i, tech: 'Laravel/PHP' },
  { pattern: /Apache-Coyote|Tomcat|catalina/i, tech: 'Apache Tomcat' },
  { pattern: /nginx/i, tech: 'Nginx' },
  { pattern: /IIS|ASP\.NET|iis/i, tech: 'IIS/.NET' },
];

// 安全头检测
const securityHeaders = {
  'x-frame-options': '防点击劫持',
  'x-content-type-options': '防 MIME 嗅探',
  'x-xss-protection': 'XSS 过滤器（旧）',
  'strict-transport-security': 'HSTS（强制 HTTPS）',
  'content-security-policy': 'CSP 内容安全策略',
  'referrer-policy': '来源策略',
  'permissions-policy': '权限策略',
};
```

### Phase 2: Endpoint Discovery（端点发现）

**AI 分析内容：**
```
1. 爬取主页面所有链接（<a href>、<form action>）
2. 识别参数化 URL（?id=, ?page=, ?search=）
3. 常见管理后台路径探测：
   - /admin /administrator /login /wp-admin
   - /console /api /swagger /swagger-ui
   - /phpmyadmin /wp-login.php /wp-admin/
4. API 端点识别：
   - /api/v1/* /api/v2/* /rest/*
   - /graphql /graphiql
5. 敏感文件扫描：
   - robots.txt、sitemap.xml
   - /.git/config（Git 仓库泄露）
   - /.env（环境变量泄露）
   - /backup/*.zip、/db.sql、/dump.sql
   - /config/*、/settings.py
```

**正则匹配：**
```javascript
// 敏感路径
const sensitivePaths = [
  '/.git/config', '/.git/HEAD', '/.gitignore',
  '/.env', '/.env.local', '/.env.production',
  '/config/', '/settings/', '/wp-config.php',
  '/backup/', '/backups/', '/db/', '/dump/',
  '/admin', '/administrator', '/manage',
  '/login', '/signin', '/wp-login.php',
  '/wp-admin', '/wp-admin/',
  '/phpmyadmin', '/pma',
  '/api', '/api-docs', '/swagger', '/swagger-ui',
  '/graphql', '/graphiql',
  '/console', '/actuator', '/env',
  '/debug', '/debug=true',
];

// 参数发现
const paramPatterns = [
  /[?&](id|user|uid|account)=/i,
  /[?&](page|offset|limit)=/i,
  /[?&](search|query|q|keyword)=/i,
  /[?&](sort|order|by|field)=/i,
  /[?&](file|path|url|src)=/i,
  /[?&](callback|jsonp|redirect)=/i,
  /[?&](name|email|phone|addr)=/i,
];
```

### Phase 3: Vulnerability Testing（漏洞测试）

**A03 注入类（优先级 P0）**

```
SQL 注入测试：
1. 参数 fuzzing（'、"、\、)、OR 1=1、UNION SELECT）
2. 错误信息分析（MySQL error / PostgreSQL error / Oracle error）
3. 布尔盲注测试（原始响应 vs 注入后响应）
4. 时间盲注（AND SLEEP(5)）
5. 检测点：所有 GET/POST 参数、Cookie、User-Agent

XSS 测试：
1. 反射型：<script>alert(1)</script> → 检查是否回显
2. 存储型：提交 payload → 访问其他页面检查是否触发
3. DOM 型：分析前端 JS 是否直接使用 location.hash/search
4. 检测点：所有输入点、评论区、搜索框、URL 参数

命令注入测试：
- ; ls / 或 | cat /etc/passwd
- `whoami` 或 $(whoami)
- 检测点：ping、traceroute、host、nslookup 等调用
```

**A01 失效的访问控制（优先级 P1）**

```
水平越权测试：
1. 登录 A 账号 → 获取资源 ID → 改 ID 访问 B 账号资源
2. 直接对象引用（修改 URL 中的 userId/orderId）

垂直越权测试：
1. 普通用户 → 访问 /admin/* 路径
2. 尝试访问管理员专属 API（用户管理/权限修改）

目录遍历测试：
1. ../../etc/passwd
2. ..%2F..%2F..%2Fetc%2Fpasswd
3. 检测点：文件下载、文件预览、文件包含接口
```

**A02 加密失败 / 敏感信息泄露（优先级 P1）**

```
1. HTTP 明文传输（无 HTTPS）
2. 响应体泄露：
   - 密码/手机号/身份证（未脱敏）
   - 数据库错误信息（SQL error）
   - 堆栈信息（Java stack trace / Python traceback）
   - API Key / Token（硬编码在响应中）
3. 敏感文件未授权访问：
   - 访问 /admin/user/list 返回用户数据
   - API 直接返回加密密钥
```

**A05 安全配置错误（优先级 P2）**

```
1. CORS 配置（Access-Control-Allow-Origin: *）
2. 调试接口暴露（/debug、/actuator）
3. OPTIONS 方法允许所有源
4. SSL/TLS 版本过老（TLS 1.0/1.1）
5. 证书过期或自签名
```

**A07 认证与会话（优先级 P2）**

```
1. 弱密码策略（无最小长度/无复杂度要求）
2. 验证码强度（4 位数字易暴力破解）
3. 会话固定攻击（登录前后 Session ID 不变）
4. 无超时机制（Session 永不过期）
5. JWT 无过期时间
```

**A08/A10（优先级 P2-P3）**

```
A08 软件完整性：
- 第三方依赖版本（已知 CVE 检查）
- 未签名更新包

A10 SSRF：
- 测试 URL 参数是否接受任意 URL
- 探测内网地址：http://localhost, http://169.254.169.254（云元数据）
```

### Phase 4: Risk Rating（风险评级）

**CVSS v3.1 评级标准：**

| 评级 | CVSS 分值 | 定义 |
|------|-----------|------|
| Critical | 9.0-10.0 | 远程代码执行、大规模数据泄露 |
| High | 7.0-8.9 | SQLi、RCE（需认证）、垂直越权 |
| Medium | 4.0-6.9 | XSS（存储型）、水平越权、敏感文件 |
| Low | 0.1-3.9 | 信息泄露、弱安全头、验证码可暴力 |
| Info | 0.0 | 技术指纹、banner 泄露 |

### Phase 5: Report Generation（报告生成）

**最终 JSON 输出格式：**

```json
{
  "success": true,
  "target": "https://example.com",
  "scanType": "full",
  "scanTimestamp": "ISO-8601",
  "durationMs": 60000,
  "securityScore": 65,
  "severityDist": {
    "critical": 0, "high": 2, "medium": 3, "low": 1, "info": 2
  },
  "findings": [
    {
      "title": "SQL 注入漏洞",
      "severity": "high",
      "vulnType": "sql_injection",
      "cweId": "CWE-89",
      "owaspCategory": "A03:2021 - Injection",
      "description": "搜索参数 'keyword' 存在 SQL 注入...",
      "evidence": "GET /search?q=a' OR 1=1-- 返回全部数据",
      "recommendation": "参数化查询 + 输入校验",
      "cvssScore": 8.6,
      "cvssVector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N"
    }
  ],
  "summary": "扫描发现 8 个问题...",
  "riskLevel": "medium",
  "recommendations": [
    "1. 立即修复高危 SQL 注入...",
    "2. 配置 CORS 白名单...",
    "3. 添加安全响应头..."
  ]
}
```

## 扫描类型选择

| scanType | 主要覆盖 | 优先级 |
|-----------|----------|--------|
| full | 全部 | P1 |
| xss | XSS（反射/存储/DOM）| P1 |
| sql | SQL/NoSQL/命令注入 | P0 |
| os | 系统层（端口/服务/指纹）| P2 |
| network | SSL/证书/协议 | P2 |
| business | 越权/验证码/支付逻辑 | P2 |

## 工具优先级

1. **AI 直接分析**（主要手段）：分析 HTTP 请求/响应、代码模式
2. **正则模式匹配**：匹配源码、响应体中的漏洞特征
3. **安全头分析**：评估 HTTP 安全响应头配置
4. **nmap/nuclei**（可选）：服务器可访问时执行真实端口/漏洞扫描

## 道德约束

- **只扫描授权目标**：输入的 URL 即授权范围
- **不扫描内网**：192.168.x.x、10.x.x.x、172.16-31.x.x 等私有地址（除非目标本身在内网）
- **不执行破坏**：不删数据、不提权、不横向移动
- **保护隐私**：发现的漏洞不公开，仅提交给授权方
