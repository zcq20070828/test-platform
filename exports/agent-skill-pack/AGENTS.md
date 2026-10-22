# 智能体 × 核心技能总览

| 智能体 | ID | 系统提示词 | 可执行核心 Skill |
|---|---|---|---|
| 🧪 测试主控 | `test-master` | ✅ | 提示词型 |
| 🔍 需求分析 | `test-requirement-analyzer` | ✅ | `requirement-parser` |
| ✅ 测试用例生成 | `test-case-generator` | ✅ | `9dem-executor` |
| 📊 测试数据生成 | `test-data-generator` | ✅ | `test-data-generator-skill` |
| 🐛 缺陷分析 | `defect-analyzer` | ✅ | `defect-classifier`<br>`failure-root-cause-analyzer` |
| 📝 测试报告生成 | `test-reporter` | ✅ | `result-aggregator`<br>`quality-metrics-calculator` |
| 🔒 数据脱敏 | `data-masking` | ✅ | `data-masking-invoker` |
| ✍️ 测试脚本生成 | `test-script-generator` | ✅ | 提示词型 |
| 🖥️ UI/E2E测试 | `ui-e2e-executor` | ✅ | `ui-direct-invoker`<br>`ui-test-tool-invoker`<br>`mobile-e2e-invoker`<br>`desktop-e2e-invoker` |
| 🔌 API测试 | `api-executor` | ✅ | `api-direct-invoker`<br>`api-test-tool-invoker` |
| 📋 测试方案生成 | `test-scheme-generator` | ✅ | `test-strategy-designer` |
| 🛡️ AI质量审核-1 | `ai-quality-reviewer-1` | ✅ | 提示词型 |
| 🛡️ AI质量审核-2 | `ai-quality-reviewer-2` | ✅ | 提示词型 |
| 🛡️ AI质量审核-3 | `ai-quality-reviewer-3` | ✅ | 提示词型 |
| 📊 AI评估智能体(人工) | `ai-evaluation-agent` | ✅ | `evaluation-system`<br>`quality-metrics-calculator` |
| 🛡️ 安全测试 | `security-sentinel` | ✅ | 提示词型 |
| 📈 性能测试 | `performance-tester` | ⚠️ 源码无独立提示词 | `execute_perf_script` |
| 🧭 兼容性测试协调 | `compatibility-coordinator` | ✅ | `compatibility-coordinator-invoker` |

> 提示词型智能体没有独立可执行 skill，但 `AGENT.md` 内含完整角色定义与提示词。
