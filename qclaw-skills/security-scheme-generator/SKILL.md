---
name: security-scheme-generator
description: 安全测试方案生成Skill。攻击面分析、威胁建模、OWASP覆盖规划、工具选型方法论。基于通用知识库「XX系统安全测试方案」模板生成结构化安全测试方案。
metadata:
  openclaw:
    emoji: "🛡️"
    version: "1.0.0"
---

# 安全测试方案生成 Skill

当 security-sentinel 进入 **scheme（方案）** 阶段时调用本 Skill，生成结构化安全测试方案。

## 必须遵循的【安全测试方案】模板结构（基于通用知识库「XX系统安全测试方案」）

**报告标题**：XX项目安全测试方案（AI智能增强模板）

- **一、目的**：明确安全测试目标、范围与交付物
- **二、背景和目标**：2.1 背景 / 2.2 测试目标 / 2.3 术语 / 2.4 参考文档（OWASP TOP10、OWASP Testing Guide v4、PTES、OSSTMM3）
- **三、测试范围**：3.1 安全检查范围（资产/应用/接口/基础设施）/ 3.2 已排除的测试范围
- **四、测试约束**：4.1 测试约束（时间/环境/授权）/ 4.2 进出标准 / 4.3 通过失败标准 / 4.4 中断恢复准则
- **五、AI智能体执行记录**：5.1 执行概况 / 5.2 知识库应用 / 5.3 执行日志摘要 / 5.4 自动化扫描结果摘要
- **六、测试方法和策略**：6.1 安全测试策略总览 / 6.2 各检查项详细测试方法（按 OWASP Top10，见下表）
- **七、测试交付品**：方案/用例/报告/漏洞清单
- **八、测试环境和工具**：软件/硬件/安全工具清单
- **九、角色和职责**
- **十、测试进度表**（见下表）
- **十一、缺陷定义和跟踪**
- **十二、风险和延缓计划**
- **十三、AI质量审核结果**：审核摘要 / 一票否决项
- **十四、人工审核与审批**

### 各检查项详细测试方法（OWASP Top 10 2021）
| 检查项(OWASP) | 测试方法 | 工具 | 负责智能体 |
|--------------|---------|------|-----------|
| A01 失效的访问控制 | 越权/水平垂直越权测试 | security-vuln-scanner | security-sentinel |
| A02 加密失败 | 传输/存储加密校验 | pentest-workbench | security-sentinel |
| A03 注入 | SQL/XSS/命令注入 | security-vuln-scanner/security-scanner | security-sentinel |
| A04 不安全设计 | 业务逻辑/威胁建模 | pentest-workbench | security-sentinel |
| A05 安全配置错误 | 默认配置/目录遍历 | security-scanner | security-sentinel |
| A06 易受攻击组件 | 依赖扫描/CVE | security-audit-toolkit | security-sentinel |
| A07 身份识别认证失败 | 认证/会话/口令策略 | pentest-workbench | security-sentinel |
| A08 软件数据完整性 | 反序列化/篡改 | pentest-workbench | security-sentinel |
| A09 安全日志监控失败 | 日志/审计缺失 | pentest-workbench | security-sentinel |
| A10 SSRF | 服务端请求伪造 | security-vuln-scanner | security-sentinel |

### 测试进度表
| 阶段 | 开始 | 结束 | 交付物 |
|------|------|------|--------|
| 方案设计 | (d1) | (d2) | 本方案 |
| 用例生成 | (d3) | (d4) | 安全测试用例 |
| 扫描执行 | (d5) | (d6) | 扫描结果 |
| 渗透验证 | (d7) | (d8) | 渗透报告 |
| 报告生成 | (d9) | (d10) | 安全评估报告 |

## 输出要求
- 严格按 14 章结构输出方案
- 各检查项必须覆盖 OWASP Top10
- 明确工具选型与智能体分工
