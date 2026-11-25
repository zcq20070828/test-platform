# 订单接口测试用例（合成样本）

| 用例编号 | 用例名称 | 维度 / 设计方法 | 层级 | 前置条件 | 输入数据 | 操作步骤 | 预期结果 |
|---|---|---|---|---|---|---|---|
| TC-001 | 查询订单详情成功 | ① 功能 / 等价类划分 | 正常 | 存在订单 order_id=1001 | order_id=1001 | 1. 调用 GET /api/v1/order/detail?order_id=1001<br>2. 检查响应体 | 1. 返回 HTTP 200<br>2. 响应体 order_id 为 "1001"<br>3. order_status 为 1，amount 为数值类型 |
| TC-002 | 取消待支付订单 | ① 功能 / 等价类划分 | 正常 | 存在 order_status=0 的订单 | order_id=1002、reason="用户主动取消" | 1. 调用 POST /api/v1/order/cancel<br>2. 查询订单详情 | 1. 返回 HTTP 200<br>2. 再次查询 order_status 为 2<br>3. orders 表中该记录状态同步更新 |
| TC-003 | 取消已支付订单被拒 | ① 功能 / 错误推测法 | 异常 | 存在 order_status=1 的订单 | order_id=1003、reason="测试" | 1. 调用 POST /api/v1/order/cancel<br>2. 检查响应 | 1. 返回 HTTP 400<br>2. 响应提示"已支付订单不可取消"<br>3. order_status 仍为 1 |
| TC-004 | 订单状态非法值 | ② 数据 / 边界值分析 | 异常 | 无 | order_status 设为 9 | 1. 直接修改 orders 表 order_status=9<br>2. 调用 GET /api/v1/order/detail | 1. 返回 HTTP 200<br>2. 响应 order_status 原样返回 9 或按容错逻辑处理<br>3. 服务不崩溃 |
| TC-005 | 订单列表分页 | ② 数据 / 边界值分析 | 边界 | 存在 3 条订单 | 无 | 1. 调用 GET /api/v1/order/list<br>2. 检查 order_list 字段 | 1. 返回 HTTP 200<br>2. order_list 为数组<br>3. 数组长度与订单数一致 |
