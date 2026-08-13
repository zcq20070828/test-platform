# 测试任务确认

## 任务来源
用户输入："test"

## 任务分析
用户需求模糊，需要明确测试类型和模式。

## 可选模式

### 1. 全自动模式
- 工作流：需求分析 → 用例生成 → UI/E2E测试 → 报告生成
- 每个阶段有3个审核智能体进行质量把关
- 适合完整测试流程

### 2. 人机交互模式
可调度的智能体（9个执行智能体 + 3个审核智能体）：
- test-requirement-analyzer（需求分析）
- test-scheme-generator（测试方案）
- test-case-generator（用例生成）
- test-data-generator（数据生成）
- data-masking（数据脱敏）
- api-executor（接口测试）
- ui-e2e-executor（UI/E2E测试）
- defect-analyzer（缺陷分析）
- test-reporter（报告生成）

## 待确认信息
1. 测试对象（产品/功能/接口）
2. 测试模式（全自动/人机交互）
3. 具体要求和约束

## 下一步
等待用户补充需求信息后，使用 sessions_spawn 调度相应智能体执行任务。
