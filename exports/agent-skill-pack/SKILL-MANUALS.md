# Skill 安装与使用手册索引

共 43 个 Skill。每个目录下都有独立的 `MANUAL.md`，包含安装、参数、调用示例、输出与排错。

- **可执行 Skill**：已注册到 `manifest.json`，可用 `invoke-skill.mjs <id>` 或直接 import。
- **代码/脚本型 Skill（未注册通用入口）**：目录内有可复用代码，但需要按手册直接 import / 运行脚本，不能走通用调用器。
- **提示词/方法论 Skill**：不含可执行代码，注入 `SKILL.md` 使用。

| Skill | ID | 类型 | 可执行入口 | 手册 |
|---|---|---|---|---|
| 九维穷举模型执行器（9DEM Executor） | `9dem-executor` | 可执行 Skill | `9dem-executor` | [MANUAL.md](skills/9dem-executor/MANUAL.md) |
| 9dem-planner | `9dem-planner` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/9dem-planner/MANUAL.md) |
| 能力评估Agent | `ai-evaluation-agent` | 提示词/方法论 Skill | — | [MANUAL.md](skills/ai-evaluation-agent/MANUAL.md) |
| API 直执执行器（api-direct-invoker） | `api-direct-invoker` | 可执行 Skill | `api-direct-invoker` | [MANUAL.md](skills/api-direct-invoker/MANUAL.md) |
| 接口测试执行Agent | `api-executor` | 提示词/方法论 Skill | — | [MANUAL.md](skills/api-executor/MANUAL.md) |
| api-test-tool-invoker | `api-test-tool-invoker` | 可执行 Skill | `api-test-tool-invoker` | [MANUAL.md](skills/api-test-tool-invoker/MANUAL.md) |
| context-manager | `context-manager` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/context-manager/MANUAL.md) |
| 数据脱敏Agent | `data-masking` | 提示词/方法论 Skill | — | [MANUAL.md](skills/data-masking/MANUAL.md) |
| Data Masking Skill - 数据脱敏技能 | `data-masking-skill` | 可执行 Skill | `data-masking-invoker` | [MANUAL.md](skills/data-masking-skill/MANUAL.md) |
| 缺陷分析Agent | `defect-analyzer` | 提示词/方法论 Skill | — | [MANUAL.md](skills/defect-analyzer/MANUAL.md) |
| defect-classifier | `defect-classifier` | 可执行 Skill | `defect-classifier` | [MANUAL.md](skills/defect-classifier/MANUAL.md) |
| defect-knowledge-queryer | `defect-knowledge-queryer` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/defect-knowledge-queryer/MANUAL.md) |
| evaluation-system Skill | `evaluation-system` | 可执行 Skill | `evaluation-system` | [MANUAL.md](skills/evaluation-system/MANUAL.md) |
| failure-root-cause-analyzer | `failure-root-cause-analyzer` | 可执行 Skill | `failure-root-cause-analyzer` | [MANUAL.md](skills/failure-root-cause-analyzer/MANUAL.md) |
| improvement-advisor | `improvement-advisor` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/improvement-advisor/MANUAL.md) |
| jmeter-executor —— 性能压测脚本执行器 | `jmeter-executor` | 可执行 Skill | `execute_perf_script` | [MANUAL.md](skills/jmeter-executor/MANUAL.md) |
| OpenClaw VPS Server Hardening | `openclaw-vps-hardening` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/openclaw-vps-hardening/MANUAL.md) |
| Pentest Workbench | `pentest-workbench` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/pentest-workbench/MANUAL.md) |
| 质量度量计算器（Quality Metrics Calculator） | `quality-metrics-calculator` | 可执行 Skill | `quality-metrics-calculator` | [MANUAL.md](skills/quality-metrics-calculator/MANUAL.md) |
| quality-metrics-definer | `quality-metrics-definer` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/quality-metrics-definer/MANUAL.md) |
| 测试脚本质量自检（Quality Self-Checker） | `quality-self-checker` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/quality-self-checker/MANUAL.md) |
| 报告生成Agent | `report-generator` | 提示词/方法论 Skill | — | [MANUAL.md](skills/report-generator/MANUAL.md) |
| requirement-parser | `requirement-parser` | 可执行 Skill | `requirement-parser` | [MANUAL.md](skills/requirement-parser/MANUAL.md) |
| 结果聚合器（Result Aggregator） | `result-aggregator` | 可执行 Skill | `result-aggregator` | [MANUAL.md](skills/result-aggregator/MANUAL.md) |
| Security Audit | `security-audit-toolkit` | 提示词/方法论 Skill | — | [MANUAL.md](skills/security-audit-toolkit/MANUAL.md) |
| 安全测试用例生成 Skill | `security-case-generator` | 提示词/方法论 Skill | — | [MANUAL.md](skills/security-case-generator/MANUAL.md) |
| Security Operator v2.0 | `security-operator` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/security-operator/MANUAL.md) |
| 安全测试报告生成 Skill | `security-report-generator` | 提示词/方法论 Skill | — | [MANUAL.md](skills/security-report-generator/MANUAL.md) |
| Security Review Skill | `security-review` | 提示词/方法论 Skill | — | [MANUAL.md](skills/security-review/MANUAL.md) |
| Security Scanner（深度安全扫描） | `security-scanner` | 提示词/方法论 Skill | — | [MANUAL.md](skills/security-scanner/MANUAL.md) |
| 安全测试方案生成 Skill | `security-scheme-generator` | 提示词/方法论 Skill | — | [MANUAL.md](skills/security-scheme-generator/MANUAL.md) |
| Security Sentinel | `security-sentinel` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/security-sentinel/MANUAL.md) |
| Security Sentinel | `security-sentinel-skill` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/security-sentinel-skill/MANUAL.md) |
| Security Vulnerability Scanner | `security-vuln-scanner` | 提示词/方法论 Skill | — | [MANUAL.md](skills/security-vuln-scanner/MANUAL.md) |
| self-healing | `self-healing` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/self-healing/MANUAL.md) |
| test-data-generator-skill | `test-data-generator-skill` | 可执行 Skill | `test-data-generator-skill` | [MANUAL.md](skills/test-data-generator-skill/MANUAL.md) |
| test-strategy-designer | `test-strategy-designer` | 可执行 Skill | `test-strategy-designer` | [MANUAL.md](skills/test-strategy-designer/MANUAL.md) |
| trend-analyzer | `trend-analyzer` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/trend-analyzer/MANUAL.md) |
| UI 直执执行器（ui-direct-invoker） | `ui-direct-invoker` | 可执行 Skill | `ui-direct-invoker` | [MANUAL.md](skills/ui-direct-invoker/MANUAL.md) |
| ui-e2e-executor —— 多端 UI/E2E 执行器 | `ui-e2e-executor` | 可执行 Skill | `mobile-e2e-invoker`<br>`desktop-e2e-invoker` | [MANUAL.md](skills/ui-e2e-executor/MANUAL.md) |
| SKILL.md — ui-test-tool-invoker | `ui-test-tool-invoker` | 可执行 Skill | `ui-test-tool-invoker` | [MANUAL.md](skills/ui-test-tool-invoker/MANUAL.md) |
| unified-report-generator | `unified-report-generator` | 代码/脚本型 Skill（未注册通用入口） | — | [MANUAL.md](skills/unified-report-generator/MANUAL.md) |
| web-compatibility | `web-compatibility` | 可执行 Skill | `compatibility-coordinator-invoker` | [MANUAL.md](skills/web-compatibility/MANUAL.md) |
