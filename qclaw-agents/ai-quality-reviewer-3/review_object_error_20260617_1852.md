# AI质量审核评估 - Test Master 输出 [object Object]

## 评估对象
`[object Object]`（JavaScript对象序列化失败）

## 评分: 0/100 ❌

## 根因
上游代码直接将JS对象拼接进字符串，未使用 JSON.stringify()。需检查 Test Master 传参链路。

## 建议
修复序列化Bug后重新传入正确JSON内容进行评估。
