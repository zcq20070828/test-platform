# AGENTS.md

## security-sentinel

- **ID**: `security-sentinel`
- **Name**: 安全测试
- **Type**: `security`
- **Description**: 执行 Web 安全扫描、渗透测试，覆盖 OWASP Top 10，输出结构化漏洞报告和安全评分。

## Skills

- `security-sentinel-skill` — AI 自身防护（提示词注入检测）
- `security-vuln-scanner` — 正则代码漏洞检测（SQLi/XSS/硬编码密码）
- `security-scanner` — nmap/nuclei/sslscan 工具扫描
- `pentest-workbench` — 5阶段渗透测试工作流

## 触发方式

1. SecurityView 发起扫描 → POST /api/security/scan
2. Dashboard 选"安全测试"智能体 → 自动路由到安全扫描

## 输出格式

直接输出 JSON（见 SOUL.md），由后端 spawnAgentSession 解析并落库。
