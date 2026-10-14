---
name: api-direct-invoker
description: 免脚本接口测试直执执行器。直接用 HTTP 客户端发出请求并断言，输出 UTRM 标准结果，不需要先生成 Postman 集合 / pytest / RestAssured 脚本。当用户提供接口文档、接口清单、测试用例表格或自然语言描述的接口场景并要求"直接执行/跑一下/验证接口"时使用本技能，避免先产出脚本中间物。
---

# API 直执执行器（api-direct-invoker）

## 定位

`api-test-tool-invoker` 要求先有 `testScript`（Postman 集合 / pytest / RestAssured 脚本）才能执行，
导致接口测试链路必须先"造脚本"。本技能**跳过这一步**：直接按用例定义发 HTTP 请求并断言。

- 依赖：仅 Node 内置能力，**不依赖 newman / pytest / RestAssured / maven**
- 输出：UTRM 标准格式（与 `ui-test-invoker`、`api-test-invoker` 完全一致，可被 `result-aggregator` 直接消费）

## 何时用

| 场景 | 用哪个 |
|---|---|
| 用户给了接口清单/文档/用例表格，要求直接执行验证 | **本技能** |
| 用户明确要 Postman 集合、pytest 脚本等可复用资产 | `test-script-generator` + `api-test-tool-invoker` |
| 需要接入 CI、长期回归复用 | 生成脚本（脚本更适合沉淀） |

## 执行模式

| `mode` | 含义 | 何时用 |
|---|---|---|
| `script`（默认） | 按传入的 `cases` 逐条发请求断言 | 已有明确的请求清单 |
| `intent` | **意图驱动**：先用模型把自然语言目标解析成结构化 Test Intent + 请求序列，再执行 | 用户只给了"验证登录能成功"这类描述，没有现成请求清单 |

意图驱动对标 Harness "AI-Powered Intent Testing" 五步：

1. **NL → 结构化 Test Intent**：解析目标、前置条件、入口 URL、断言点、数据依赖
2. **AI 推理 + 应用状态探索**：每步执行后采集紧凑 DOM/响应快照回传模型
3. **执行 ↔ 推理闭环**：模型据当前状态决定下一步，失败时换路径重试
4. **视觉 + DOM 双重校验**：断言点由模型提出、判定在本地客观完成（模型不打分，防幻觉）
5. **知识回流**：执行结束时产出可复用的 flow / element / contract 摘要

## 输入参数

调用入口：`invoke(params)`

| 参数 | 类型 | 说明 |
|---|---|---|
| `mode` | string | `script`（默认）/ `intent`（意图驱动） |
| `baseUrl` | string | 公共基地址，用例中 `url` 可写相对路径（如 `/api/login`） |
| `headers` | object | 公共请求头（如 `Authorization`、Cookie） |
| `vars` | object | 初始变量，供 `{{var}}` 引用 |
| `timeout` | number | 单请求超时(ms)，默认 15000 |
| `cases` | array | 用例数组（推荐）；`intent` 模式下每项可只给 `goal` |
| `spec` | object | 单用例简写（与 `cases` 二选一） |
| `goal` | string | `intent` 模式：自然语言测试目标 |
| `auth` | object | 鉴权配置，见「自动重登（自愈）」 |
| `autoAssert` | boolean | 用例未声明 `expect` 时是否自动生成断言，默认 true |
| `stopOnFail` | boolean | 失败后中止后续用例，默认 false |

## 自动断言

用例没写 `expect` 时，由模型基于「意图 + 真实响应」提出断言点（status / duration / json / jsonPath / contains / notContains / equals / header），
**判定在本地客观完成** —— 模型只提点、不打分，结果可复核、不幻觉。

## 自动重登（自愈）

```json
{
  "auth": {
    "login": { "url": "/api/login", "method": "POST", "body": {"username":"{{username}}","password":"{{password}}"}, "tokenPath": "data.token" },
    "injectAs": "Authorization",
    "tokenVar": "token"
  },
  "credentials": { "username": "admin", "password": "xxx" }
}
```

遇到 401/403 时自动重登取 token、注入请求头并重试一次。凭证不会写入结果（落库/展示前剔除敏感键）。

### 单个用例结构

```json
{
  "name": "登录成功-返回token",
  "method": "POST",
  "url": "/api/login",
  "headers": { "Content-Type": "application/json" },
  "query": { "debug": "1" },
  "body": { "username": "admin", "password": "123456" },
  "expect": {
    "status": 200,
    "json": { "code": 0, "data": { "token": { "$exists": true } } },
    "contains": "success",
    "notContains": "error",
    "header": { "Content-Type": { "$contains": "application/json" } },
    "maxDurationMs": 3000
  },
  "extract": { "token": "data.token" }
}
```

### expect 支持的断言

| 字段 | 说明 |
|---|---|
| `status` | 期望状态码，可为数组 `[200, 201]`。**未声明时默认要求 < 400** |
| `json` | 响应 JSON **子集匹配**（只校验列出的字段，允许响应有多余字段） |
| `jsonPath` | `{ path: "data.user.id", equals: 1 }` 或该对象的数组 |
| `contains` / `notContains` | 响应文本包含 / 不包含（字符串或数组） |
| `equals` | 响应文本完全相等 |
| `header` | 响应头匹配 |
| `maxDurationMs` | 响应时间上限 |

### json 匹配支持的操作符

| 操作符 | 含义 |
|---|---|
| `$contains` | 子串包含（字符串）或成员包含（数组） |
| `$regex` | 正则匹配（字符串形式，如 `"^\\d{11}$"`） |
| `$gt` `$gte` `$lt` `$lte` | 数值比较 |
| `$exists` | 字段是否存在（true/false） |
| `$ne` | 不等于 |

### 变量与联动

- 用 `extract` 从响应中提取变量：`{ "token": "data.token" }`
- 后续用例用 `{{token}}` 引用（可出现在 url、headers、body、query）
- 响应头取值用前缀：`"header:X-Token"`

## 输出（UTRM）

```json
{
  "tool": "api-direct",
  "summary": { "total": 3, "passed": 2, "failed": 1, "skipped": 0, "duration": 856 },
  "testcases": [
    {
      "name": "登录成功-返回token",
      "classname": "api-direct",
      "status": "failed",
      "duration": 320,
      "error": "状态码: 期望 200,实际 401",
      "stack": "状态码: 期望 200,实际 401",
      "request":  { "method": "POST", "url": "https://x/api/login", "headers": {}, "body": "..." },
      "response": { "status": 401, "headers": {}, "body": "..." }
    }
  ],
  "exitCode": 1,
  "raw": "PASS 健康检查 (120ms)\nFAIL 登录成功-返回token (320ms) :: 状态码..."
}
```

## 使用约束

1. `url` 必须以 `http(s)://` 开头，或配合 `baseUrl` 使用相对路径；不支持 `file://` 等协议。
2. 未声明 `expect.status` 时，4xx/5xx 一律判失败 —— 若用例本就是异常场景（如"密码错误应返回 401"），**必须显式写 `expect.status`**。
3. `json` 是子集匹配，不会因响应**对象**多余字段而失败；要校验"某字段不存在"用 `{ "$exists": false }`。
   注意：**数组按长度精确匹配** —— `items: [{id:1}]` 要求实际数组恰好 1 项；若只需校验其中几项，改用 `jsonPath` 或 `{ "$contains": {...} }`。
4. 请求体为对象时自动序列化为 JSON 并设置 `Content-Type: application/json`；传字符串则原样发送。
5. 用例数量建议控制在 50 条以内，避免单次调用耗时过长。

## 失败排查

| error | 含义 | 处理 |
|---|---|---|
| `MISSING_URL` | 用例没给 url 且没配 baseUrl | 补 url 或 baseUrl |
| `INVALID_URL` / `UNSUPPORTED_PROTOCOL` | URL 非法或协议不支持 | 只支持 http/https |
| `TIMEOUT` | 请求超时 | 调大 `timeout` 或确认目标可达 |
| `REQUEST_ERROR` | 网络错误（DNS/连接拒绝/TLS） | 确认地址与网络可达性 |
| 断言文案 | 断言未通过 | 按 `error` 中的期望/实际对比修正用例或上报缺陷 |
