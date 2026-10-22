# API 直执执行器（api-direct-invoker） 安装与使用手册

> Skill ID：`api-direct-invoker` · 类型：可执行 Skill · 目录：`skills/api-direct-invoker`

## 1. 用途

免脚本接口测试直执执行器。直接用 HTTP 客户端发出请求并断言，输出 UTRM 标准结果，不需要先生成 Postman 集合 / pytest / RestAssured 脚本。当用户提供接口文档、接口清单、测试用例表格或自然语言描述的接口场景并要求"直接执行/跑一下/验证接口"时使用本技能，避免先产出脚本中间物。

## 2. 目录结构

```text
api-direct-invoker/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── backend/
```

## 3. 安装

- **Node.js >= 22**：技能包内混合 CommonJS / ESM，依赖 Node 22+ 的语法自动检测。
- 在技能包根目录运行（保证 `invoke-skill.mjs` 能解析到 `manifest.json`）。

## 4. 快速开始

### 4.1 通过通用调用器

```bash
cd <技能包根目录>  # 例如 agent-skill-pack / 测试中台专属skill
node invoke-skill.mjs list
# 参数较多时建议写文件，避免 shell 引号转义：
cat > params.json <<'JSON'
{
  "baseUrl": "https://example.com",
  "cases": [
    {
      "name": "健康检查",
      "method": "GET",
      "url": "/health",
      "expect": {
        "status": 200
      }
    },
    {
      "name": "登录",
      "method": "POST",
      "url": "/api/login",
      "body": {
        "username": "demo",
        "password": "***"
      },
      "expect": {
        "status": 200,
        "jsonPath": {
          "data.token": "*"
        }
      }
    }
  ]
}
JSON
node invoke-skill.mjs api-direct-invoker --file params.json
```

### 4.2 直接 import

```js
import * as skill from './skills/api-direct-invoker/backend/api-direct-invoker.js';
const result = await skill.invoke({"baseUrl":"https://example.com","cases":[{"name":"健康检查","method":"GET","url":"/health","expect":{"status":200}},{"name":"登录","method":"POST","url":"/api/login","body":{"username":"demo","password":"***"},"expect":{"status":200,"jsonPath":{"data.token":"*"}}}]});
console.log(result);
```

### 4.3 入口 `api-direct-invoker`

- 文件：`skills/api-direct-invoker/backend/api-direct-invoker.js`
- 导出：`invoke`
- 说明：接口测试免脚本直执:直接用 HTTP 客户端按用例定义发请求并断言,返回 UTRM 结果。不需要先生成 Postman 集合 / pytest / RestAssured 脚本;当输入是接口清单、接口文档、测试用例表格或自然语言场景描述时使用。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `baseUrl` | string | 否 | 公共基地址,用例 url 可写相对路径(如 /api/login) |
| `headers` | object | 否 | 公共请求头(如 Authorization、Cookie) |
| `vars` | object | 否 | 初始变量,供 {{var}} 引用 |
| `timeout` | number | 否 | 单请求超时(ms),默认 15000 |
| `mode` | enum(script / intent) | 否 | script(默认)=按 cases 原样执行; intent=意图驱动:先用模型把 goal 解析成结构化 Test Intent 与请求序列再执行;用例缺 expect 时自动生成兜底断言 |
| `goal` | string | 否 | mode=intent 时必填:自然语言测试目标,如「验证用户能登录并看到用户名」。执行器据此解析意图、请求序列与断言点 |
| `auth` | object | 否 | 鉴权配置 { login:{url,method,body,headers,tokenPath}, injectAs:"Authorization", tokenVar:"token" }。遇到 401/403 自动重登取 token 注入请求头并重试一次 |
| `autoAssert` | boolean | 否 | 用例未声明 expect 时,由模型基于意图与实际响应生成断言点(判定在本地客观完成),默认 true |
| `cases` | array | 否 | 用例数组。每项: { name, method, url, headers, query, body, expect:{status,json,jsonPath,contains,notContains,equals,header,maxDurationMs}, extract:{变量名:"data.token"} }。mode=intent 时每项可只给 { name, goal } |
| `spec` | object | 否 | 单用例简写(与 cases 二选一) |
| `stopOnFail` | boolean | 否 | 失败后中止后续用例,默认 false |

**示例参数**

```json
{
  "baseUrl": "https://example.com",
  "cases": [
    {
      "name": "健康检查",
      "method": "GET",
      "url": "/health",
      "expect": {
        "status": 200
      }
    },
    {
      "name": "登录",
      "method": "POST",
      "url": "/api/login",
      "body": {
        "username": "demo",
        "password": "***"
      },
      "expect": {
        "status": 200,
        "jsonPath": {
          "data.token": "*"
        }
      }
    }
  ]
}
```

**调用**

将示例参数保存为 `params.json` 后：

```bash
node invoke-skill.mjs api-direct-invoker --file params.json
```

**直接 import**

```js
import * as skill from './skills/api-direct-invoker/backend/api-direct-invoker.js';
const result = await skill.invoke(/* 上面的示例参数 */);
```

## 5. 输出说明

返回 **UTRM** 统一结果：

```json
{
  "tool": "工具名",
  "timestamp": "ISO 时间",
  "summary": { "total": 1, "passed": 1, "failed": 0, "skipped": 0, "duration": 123 },
  "testcases": [ { "name": "用例名", "status": "passed", "duration": 100, "error": null, "steps": [] } ],
  "exitCode": 0,
  "raw": null
}
```

可直接交给 `result-aggregator` 聚合，或作为测试证据落库。

## 6. 限制与排错

- 工具未安装或不在 PATH：返回失败/`TOOL_NOT_FOUND`，不会伪造测试通过；先按第 3 节安装。
- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。
- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
