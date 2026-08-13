# 📊 智能评估报告

**报告类型**: 单任务评估(任务ID: 19654458-3a6b-42f0-81a8-887808266759)  
**评估范围**: capability、quality、business  
**生成时间**: 2026/7/30 07:19:24  
**评估智能体数**: 1  
**评估任务总数**: 1  
**平均综合评分**: 45 分

---

## 📈 综合评分汇总

| 智能体 | 综合评分 | 等级 | 评级 | 能力层 | 质量层 | 业务层 |
|--------|----------|------|------|--------|--------|--------|
| ai-quality-reviewer-2 | 45 | D | 较差 | 40 | 50 | 45 |

> **评分标准**: S(≥90) / A(80-89) / B(70-79) / C(60-69) / D(<60)

---

## 📋 各智能体详细评估

---

## ai-quality-reviewer-2 `ai-quality-reviewer-2`

**综合评分: 45 分 | 等级: D(较差)**

评估时间: 2026/7/30 07:19:24

### 🧠 能力层(40分)

| 指标 | 得分 | 评价 |
|------|------|------|
| intentAccuracy | 30 |  |
| toolInvocationRate | 20 |  |
| contextEfficiency | 50 |  |
| errorRecoveryRate | 60 |  |


### ✅ 质量层(50分)

| 指标 | 得分 | 评价 |
|------|------|------|
| syntaxAccuracy | 60 |  |
| logicCompleteness | 40 |  |
| standardCompliance | 50 |  |


### 💼 业务价值层(45分)

| 指标 | 得分 | 评价 |
|------|------|------|
| executabilityRate | 30 |  |
| defectDiscoveryRate | 50 |  |
| coverageImprovement | 55 |  |


### 📋 改进建议
1. 必须调用ui_test_tool_invoker工具真实执行dashboard.spec.ts测试脚本
2. 需根据用户指定的并发workers=4、超时30000ms等选项配置测试执行参数
3. 输出应包含完整的UTRM标准结果，包括测试用例状态、日志、覆盖率数据等


---

*本报告由测试中台智能评估系统自动生成 | 2026/7/30 07:19:24*
