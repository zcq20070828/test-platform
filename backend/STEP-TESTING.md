# 分步测试真实执行与证据门禁

本文件说明「分步测试」9 个智能体的真实执行边界，以及 2026-10-21 起生效的证据门禁。

## 1. 每个智能体到底做了什么

| 智能体 | 可执行工具 | 说明 |
| --- | --- | --- |
| test-requirement-analyzer | `requirement_parser` | 确定性解析模块/功能点/验收标准/优先级/边界条件，LLM 基于解析结果写报告 |
| test-scheme-generator | `test_strategy_designer` | 确定性生成测试模式、层级、里程碑、工具链、风险缓解 |
| test-case-generator | `9dem_executor` | 九维穷举模型生成覆盖组合，LLM 组织成用例表 |
| test-data-generator | `test_data_generator_skill` | 真实生成随机/边界值/组合数据（不是只写“数据清单”） |
| data-masking | `data_masking_invoker` | 文本正则脱敏；服务器内 docx/图片调用 `mask_wrapper.py` |
| api-executor | `api_direct_invoker` / `api_test_tool_invoker` | 真实 HTTP 请求 + 断言；不可达会如实失败 |
| ui-e2e-executor | `ui_direct_invoker` / `ui_test_tool_invoker` / `mobile_e2e_invoker` / `desktop_e2e_invoker` | 真实 Playwright/Appium 驱动 |
| defect-analyzer | `defect_classifier` / `failure_root_cause_analyzer` | 确定性分类 + 5Why/鱼骨图根因分析 |
| test-reporter | `result_aggregator` / `quality_metrics_calculator` | 只聚合真实 UTRM 并计算指标 |

## 2. 强制证据门禁

`REQUIRED_SKILLS_BY_AGENT` 中列出的智能体，任务结束时必须至少成功执行一个对应工具：

- 一次工具都没调用 → 任务直接 `failed`，不会再输出“看起来完整”的文字报告。
- 首轮没有调用工具 → 系统会追加一次纠偏提示再重试。
- 工具返回 `success:false` / `error` → 视为未执行，任务失败。
- 输出中出现 `<｜｜DSML｜｜tool_calls>` 等伪工具调用标记 → 任务失败。

## 3. 报告与缺陷分析的数据来源

`test-reporter` / `defect-analyzer` 只接受两类输入：

1. 输入里直接包含结构化数据：
   - 报告：UTRM JSON（`testcases` 或 `summary.total > 0`）
   - 缺陷：`defects`/`failures`，或含失败用例的 UTRM
2. 输入中引用一个带「执行证据.json」的任务 ID（UUID）。

只有“请生成测试报告”这类没有数据的请求会被拒绝，并提示补充 UTRM 或任务 ID。
引用任务时，系统会把该任务的真实证据自动注入提示词。

## 4. 证据交付件

任务通过审核后，会自动把以下内容挂到任务交付件：

- `执行证据.json`：每次工具调用的 skillId、参数（已脱敏）、结果（已去 base64/凭证）
- 截图（UI 测试）：从临时目录复制到任务输出目录，可在前端预览
- 脱敏产物（docx/图片）：从工具输出目录复制到任务输出目录

## 5. 交付件命名

- 执行/分析类智能体的主交付件固定为完整 Markdown 报告（md + 派生 docx/xlsx）。
- 报告里的响应体 JSON 代码块不会再被误当成唯一交付物。
- 文件名从项目/需求标签或标题推导，不再从表格片段截取。

## 6. 失败行为

- 不再生成 mock 测试数据（旧 `generateMockResult` 已删除）。
- 任务失败时只输出明确的失败原因，并保留已有的证据文件。
