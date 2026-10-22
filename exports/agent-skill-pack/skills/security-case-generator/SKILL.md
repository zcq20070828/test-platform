---
name: security-case-generator
description: 安全测试用例生成Skill。覆盖 7 大测试域（Web/API/云原生/移动端/数据安全合规/供应链/AI），OWASP Top10 用例设计、Payload 构造、真实验证 PoC 生成、合规映射方法论。基于通用知识库安全测试方法论生成结构化安全测试用例集。
metadata:
  openclaw:
    emoji: "🛡️"
    version: "2.0.0"
---

# 安全测试用例生成 Skill

当 security-sentinel 进入 **cases（用例）** 阶段时调用本 Skill，生成结构化安全测试用例集。

> 须与 security-sentinel 的 7 大测试域 + 深度要求一致（详见 security-sentinel-skill / server.js 内嵌 prompt）。

## 🌐 测试域覆盖（7 大域，用例须按域归类）

| 域(domain) | 用例设计要点 |
|---|---|
| web | OWASP Top 10：越权/注入/XSS/SSRF/CSRF/逻辑漏洞 |
| api | OWASP API Top 10：JWT 绕过、越权(BOLA/BFLA)、参数污染、速率限制、批量分配 |
| cloud | 容器逃逸、K8s RBAC/IAM 越权、公网暴露面、镜像 CVE、配置错误 |
| mobile | 组件导出、不安全存储、WebView 桥接、证书绑定缺失、权限滥用（MASVS） |
| data | 敏感数据落库/传输加密、脱敏、留存周期、跨境、权限最小化（等保2.0/个保法/数安法） |
| supply | 依赖 CVE、SBOM 缺失、恶意包、构建投毒、许可证风险 |
| ai | 提示注入、越狱、训练/推理数据泄露、工具调用越权、输出有害（OWASP LLM Top 10） |

- `domain=all`：上述 7 域都要有对应用例，不得只覆盖 web。

## 🔬 深度要求（每个用例须含）

- **cvssScore**：CVSS v3.1 基础分 0.0–10.0
- **bizRisk**：业务风险（高/中/低）+ 业务影响说明
- **owaspCategory / cwe / cve**：分类与编号
- **poc**：真实可利用验证步骤；**verified**：是否已真实验证（true/false）
- **codeFix**：代码级修复建议（含示例）
- **compliance**：合规映射 `[{standard, clause, level}]`（等保2.0/个保法/数安法/CIS/MASVS/OWASP）

## 必须遵循的【安全测试用例】模板

**用例集标题**：XX项目安全测试用例集（AI智能增强模板）

### 用例清单表
| 用例ID | 测试域 | 漏洞类别 | CWE | 测试项 | 测试方法/Payload示例 | 预期结果 | CVSS | 业务风险 | 负责智能体 |
|--------|--------|---------|-----|--------|---------------------|---------|------|---------|-----------|
| SEC-001 | web | A01 失效的访问控制 | CWE-285 | 水平越权访问他人数据 | 替换用户ID参数访问他人资源 | 返回403/无数据 | 8.1 | 高 | security-sentinel |
| SEC-002 | web | A01 失效的访问控制 | CWE-639 | 垂直越权(普通用户提权) | 修改角色参数/访问管理接口 | 拒绝访问 | 8.8 | 高 | security-sentinel |
| SEC-003 | web | A02 加密失败 | CWE-319 | 敏感数据明文传输 | 抓包检查密码/令牌是否加密 | 全程TLS加密 | 7.4 | 中 | pentest-workbench |
| SEC-004 | web | A03 注入-SQL | CWE-89 | SQL注入 | ' OR '1'='1 注入点探测 | 参数化/报错拦截 | 9.8 | 高 | security-vuln-scanner |
| SEC-005 | web | A03 注入-XSS | CWE-79 | 存储型/反射型XSS | <script>alert(1)</script> 注入 | 转义/过滤 | 6.1 | 高 | security-vuln-scanner |
| SEC-006 | web | A03 注入-命令 | CWE-78 | 命令注入 | ;cat /etc/passwd 注入 | 命令隔离/拦截 | 9.8 | 高 | security-vuln-scanner |
| SEC-007 | web | A04 不安全设计 | CWE-840 | 业务逻辑缺陷 | 并发请求/绕过业务校验 | 幂等/校验 | 5.3 | 中 | pentest-workbench |
| SEC-008 | web | A05 安全配置错误 | CWE-16 | 默认口令/目录遍历 | 遍历/../ 探测 | 禁用目录列表 | 6.5 | 中 | security-scanner |
| SEC-009 | supply | A06 易受攻击组件 | CWE-1104 | 已知CVE依赖 | 依赖版本CVE扫描 | 升级修复 | 9.8 | 高 | security-audit-toolkit |
| SEC-010 | web | A07 身份识别认证失败 | CWE-287 | 弱口令/会话固定 | 弱口令爆破/会话复用 | 锁定/重生成 | 8.1 | 高 | pentest-workbench |
| SEC-011 | web | A08 软件数据完整性 | CWE-502 | 不安全反序列化 | 构造恶意序列化载荷 | 签名校验 | 8.1 | 中 | pentest-workbench |
| SEC-012 | web | A09 安全日志监控失败 | CWE-778 | 日志缺失/敏感信息落日志 | 检查审计日志完整性 | 完整审计 | 4.3 | 低 | pentest-workbench |
| SEC-013 | web | A10 SSRF | CWE-918 | 服务端请求伪造 | 利用URL参数请求内网 | 白名单/拦截 | 8.6 | 高 | security-vuln-scanner |
| SEC-014 | api | API2 鉴权失效(BOLA) | CWE-639 | 越权访问他人 API 资源 | 替换 object-id 调用他人接口 | 拒绝访问 | 9.1 | 高 | security-vuln-scanner |
| SEC-015 | api | API4 资源过量/速率限制缺失 | CWE-770 | 未限流被遍历/刷接口 | 高频请求验证限流 | 触发限流 | 7.5 | 中 | security-vuln-scanner |
| SEC-016 | cloud | 容器逃逸/特权容器 | CWE-250 | 挂载 docker.sock/特权模式 | 容器内尝试逃逸 | 隔离拦截 | 9.0 | 高 | pentest-workbench |
| SEC-017 | mobile | 组件导出 | CWE-926 | Android 组件 exported=true | 隐式调用导出组件 | 需显式权限 | 7.0 | 中 | pentest-workbench |
| SEC-018 | data | 敏感数据存储未加密 | CWE-311 | 明文存储身份证/手机号 | 检查本地存储/数据库 | 加密存储 | 8.0 | 高 | pentest-workbench |
| SEC-019 | ai | 提示注入 | CWE-1426 | 注入指令篡改系统行为 | 构造恶意 prompt 越权 | 拒执行/告警 | 8.5 | 高 | security-sentinel |
| SEC-020 | ai | 越狱 | CWE-1426 | 角色扮演绕过安全策略 | 多轮越狱话术 | 保持策略 | 7.5 | 中 | security-sentinel |

### 用例设计要点
- 每个用例含：前置条件、测试步骤、Payload、预期结果、风险等级、CVSS、业务风险
- 覆盖全部目标域（domain=all 时 7 域都要有），高危优先
- 结合 PentestWorkbench 生成**真实验证** PoC，并标注 verified
- 手工渗透发现的漏洞登记到漏洞列表时标题前加【手工渗透】标记

## 输出要求
- 严格按用例清单表输出（含测试域/CVSS/业务风险列）
- 覆盖目标域与 OWASP Top10，高危项优先
- Payload 仅为授权测试用途
