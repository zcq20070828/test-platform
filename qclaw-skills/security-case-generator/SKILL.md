---
name: security-case-generator
description: 安全测试用例生成Skill。OWASP Top10用例设计、Payload构造、PoC生成方法论。基于通用知识库安全测试方法论生成结构化安全测试用例集。
metadata:
  openclaw:
    emoji: "🛡️"
    version: "1.0.0"
---

# 安全测试用例生成 Skill

当 security-sentinel 进入 **cases（用例）** 阶段时调用本 Skill，生成结构化安全测试用例集。

## 必须遵循的【安全测试用例】模板（基于 OWASP Top 10 2021）

**用例集标题**：XX项目安全测试用例集（AI智能增强模板）

### 用例清单表
| 用例ID | 漏洞类别(OWASP) | CWE | 测试项 | 测试方法/Payload示例 | 预期结果 | 风险等级 | 负责智能体 |
|--------|----------------|-----|--------|---------------------|---------|---------|-----------|
| SEC-001 | A01 失效的访问控制 | CWE-285 | 水平越权访问他人数据 | 替换用户ID参数访问他人资源 | 返回403/无数据 | 高 | security-sentinel |
| SEC-002 | A01 失效的访问控制 | CWE-639 | 垂直越权(普通用户提权) | 修改角色参数/访问管理接口 | 拒绝访问 | 高 | security-sentinel |
| SEC-003 | A02 加密失败 | CWE-319 | 敏感数据明文传输 | 抓包检查密码/令牌是否加密 | 全程TLS加密 | 中 | pentest-workbench |
| SEC-004 | A03 注入-SQL | CWE-89 | SQL注入 | ' OR '1'='1 注入点探测 | 参数化/报错拦截 | 高 | security-vuln-scanner |
| SEC-005 | A03 注入-XSS | CWE-79 | 存储型/反射型XSS | <script>alert(1)</script> 注入 | 转义/过滤 | 高 | security-vuln-scanner |
| SEC-006 | A03 注入-命令 | CWE-78 | 命令注入 | ;cat /etc/passwd 注入 | 命令隔离/拦截 | 高 | security-vuln-scanner |
| SEC-007 | A04 不安全设计 | CWE-840 | 业务逻辑缺陷 | 并发请求/绕过业务校验 | 幂等/校验 | 中 | pentest-workbench |
| SEC-008 | A05 安全配置错误 | CWE-16 | 默认口令/目录遍历 | 遍历/../ 探测 | 禁用目录列表 | 中 | security-scanner |
| SEC-009 | A06 易受攻击组件 | CWE-1104 | 已知CVE依赖 | 依赖版本CVE扫描 | 升级修复 | 高 | security-audit-toolkit |
| SEC-010 | A07 身份识别认证失败 | CWE-287 | 弱口令/会话固定 | 弱口令爆破/会话复用 | 锁定/重生成 | 高 | pentest-workbench |
| SEC-011 | A08 软件数据完整性 | CWE-502 | 不安全反序列化 | 构造恶意序列化载荷 | 签名校验 | 中 | pentest-workbench |
| SEC-012 | A09 安全日志监控失败 | CWE-778 | 日志缺失/敏感信息落日志 | 检查审计日志完整性 | 完整审计 | 低 | pentest-workbench |
| SEC-013 | A10 SSRF | CWE-918 | 服务端请求伪造 | 利用URL参数请求内网 | 白名单/拦截 | 高 | security-vuln-scanner |

### 用例设计要点
- 每个用例含：前置条件、测试步骤、Payload、预期结果、风险等级
- 覆盖 OWASP Top10 全部类别，高危优先
- 结合 PentestWorkbench 生成针对性 PoC
- 手工渗透发现的漏洞登记到漏洞列表时标题前加【手工渗透】标记

## 输出要求
- 严格按用例清单表输出
- 覆盖 OWASP Top10，高危项优先
- Payload 仅为授权测试用途
