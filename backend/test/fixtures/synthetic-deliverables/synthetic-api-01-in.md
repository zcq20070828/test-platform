需求背景（合成样本，非真实项目）：

某订单系统需要提供订单查询与取消接口，接口清单如下：

- GET /api/v1/order/detail —— 查询订单详情，返回字段 order_id、order_status、amount
- POST /api/v1/order/cancel —— 取消订单，入参 order_id、reason
- GET /api/v1/order/list —— 订单列表，返回 order_list 数组

订单状态定义（token_status 同级的枚举，必须严格使用下列值）：
- order_status 取值只能是 0（待支付）、1（已支付）、2（已取消）

数据表：orders 表存储订单主记录，order_items 表存储子项。
