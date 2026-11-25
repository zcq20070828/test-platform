# 订单接口测试用例（合成样本 · 故意植入编造）

这份样本**故意**引用了原始需求里不存在的接口、字段、表和状态枚举，
用来验证反编造检查能拦住。不要当成正常交付物。

| 用例编号 | 用例名称 | 维度 / 设计方法 | 层级 | 前置条件 | 输入数据 | 操作步骤 | 预期结果 |
|---|---|---|---|---|---|---|---|
| TC-001 | 查询订单详情成功 | ① 功能 / 等价类划分 | 正常 | 存在订单 | order_id=1001 | 1. 调用 GET /api/v1/order/detail<br>2. 调用 /api/v1/order/refund 申请退款<br>3. 检查 refund_record 表 | 1. 返回 HTTP 200<br>2. 退款接口返回 REFUND_PENDING 状态<br>3. refund_record 表新增记录 |
| TC-002 | 取消订单触发风控 | ① 功能 / 场景法 | 正常 | 存在订单 | order_id=1002 | 1. 调用 POST /api/v1/order/cancel<br>2. 检查风控状态机 | 1. 返回 HTTP 200<br>2. 状态机流转 RISK_CHECKING → RISK_PASSED<br>3. risk_audit_log 表记录审核流水 |
| TC-003 | 订单状态枚举校验 | ② 数据 / 边界值分析 | 边界 | 无 | order_status=9 | 1. 调用 GET /api/v1/order/detail<br>2. 检查 order_status | 1. 返回 HTTP 200<br>2. order_status 返回 ORDER_INVALID 枚举<br>3. 触发 order_repair 任务 |
