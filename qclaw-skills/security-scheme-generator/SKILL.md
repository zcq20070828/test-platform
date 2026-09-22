---
name: security-scheme-generator
description: 安全测试方案生成Skill。覆盖 7 大测试域（Web/API/云原生/移动端/数据安全合规/供应链/AI），攻击面分析、威胁建模、合规基线规划、工具选型方法论。基于通用知识库「XX系统安全测试方案」模板生成结构化安全测试方案。
metadata:
  openclaw:
    emoji: "🛡️"
    version: "2.0.0"
---

# 安全测试方案生成 Skill

当 security-sentinel 进入 **scheme（方案）** 阶段时调用本 Skill，生成结构化安全测试方案。

> 本 Skill 须与 security-sentinel 的 7 大测试域 + 深度要求保持一致（详见 security-sentinel-skill / server.js 内嵌 prompt）。

## 🌐 测试域覆盖（7 大域，方案阶段必须明确本次覆盖哪些域）

| 域(domain) | 覆盖重点 | 合规 / 标准基线 |
|---|---|---|
| web | Web 应用：XSS / SQLi / 越权 / SSRF / CSRF / 逻辑漏洞 | OWASP Top 10 2021 |
| api | REST/GraphQL 接口：JWT/鉴权绕过、越权、参数污染、速率限制、批量分配 | OWASP API Security Top 10 |
| cloud | 云原生与基础设施：容器逃逸、K8s RBAC/IAM 越权、公网暴露、镜像/CVE、配置错误 | CIS Benchmark、等保2.0 |
| mobile | Android/iOS/HarmonyOS：组件导出、不安全存储、WebView、证书绑定、权限滥用 | OWASP MASVS |
| data | 数据安全与隐私合规：敏感数据落库/传输、脱敏、留存、跨境、权限最小化 | 等保2.0、个人信息保护法、数据安全法 |
| supply | 软件供应链：依赖 CVE、SBOM、恶意包、构建投毒、许可证风险 | SBOM/CVE、OWASP Top 10 for LLM(供应链) |
| ai | AI/大模型安全：提示注入、越狱、训练/推理数据泄露、工具调用越权、输出有害 | OWASP LLM Top 10 |

- `domain=all`（默认）：必须逐一覆盖全部 7 大域，每个域都要有检测项与 findings，不得只测单域。
- `domain=web|api|cloud|mobile|data|supply|ai`：聚焦该域专项检测，但方案仍须标注合规基线。

## 🔬 深度要求（方案阶段须规划，落地于后续用例/扫描/报告）

1. **攻击面与威胁建模**：每个域给出攻击面清单 + 威胁建模（STRIDE/攻击树），输出 `threatModel`。
2. **攻击链（attackChains）**：规划跨域/单域的攻击路径（name/steps/impact），供报告阶段呈现。
3. **合规映射**：每个域对应的等保2.0/个保法/数安法/CIS/MASVS/OWASP 条款，填入 findings 的 `compliance`。
4. **复测闭环**：若 `retestOf` 指向历史报告，方案须说明仅验证已修复项并给出「已修复/未修复」判定标准。
5. **双评分基线**：方案中预估采用 CVSS v3.1 + 业务风险双维度评级（高危及以上必附业务影响说明）。

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

### 各检查项详细测试方法（Web 域 · OWASP Top 10 2021 基线）

> 下表为 **web 域**基线；`api/cloud/mobile/data/supply/ai` 域须按上方「测试域覆盖」表的对应标准（OWASP API Top 10 / CIS / MASVS / 等保2.0·个保法·数安法 / SBOM-CVE / LLM Top 10）补充专项检查项。

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
