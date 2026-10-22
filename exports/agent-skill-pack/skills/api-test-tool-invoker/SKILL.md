# api-test-tool-invoker

## 技能名称
`api-test-tool-invoker`

## 职责
封装 Postman/Newman、RestAssured（Java）、pytest（Python + requests）三个主流 API 测试工具的统一调用逻辑，供 api-executor 智能体在执行 API 测试时自动调用。输出统一的 UTRM（Uniform Test Result Model）格式。

## 工具选型策略

### 🏆 推荐：Postman/Newman
- **适用场景**：已有 Postman Collection 或 OpenAPI/Swagger 规范
- **优点**：命令行友好、社区成熟、支持环境变量、Mock Server
- **依赖**：`newman`（npm 全局包）+ `newman-reporter-junit`
- **判断依据**：用户提供 `.postman_collection.json` 或 `.postman_environment.json` 文件

### 🥈 次选：RestAssured（Java）
- **适用场景**：Java 项目中需要与后端服务深度集成测试
- **优点**：与 Spring Boot/Java 后端项目天然集成，支持BDD语法
- **依赖**：`maven` 或 `gradle`，`surefire` 插件
- **判断依据**：项目根目录存在 `pom.xml` 或 `build.gradle`，且包含 RestAssured 依赖

### 🥉 备选：pytest（Python）
- **适用场景**：Python 项目或轻量级 API 测试、快速脚本验证
- **优点**：语法简洁、生态丰富（pytest-html、pytest-xdist、requests）
- **依赖**：`pytest` + `pytest-html` + `pytest-xdist` + `requests`
- **判断依据**：用户提供 `.py` 测试文件

## 工作流程

```
输入 (testScript / testFramework)
    │
    ▼
┌─────────────────────┐
│  工具自动选择/确认   │  ← selectBestTool(available)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  命令构建           │  ← 根据工具构建 CLI 命令
│  - Newman: newman run ...
│  - pytest: pytest ... --junitxml
│  - Maven: mvn test ...
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  子进程执行         │  ← exec 模块运行命令
│  - 超时控制         │
│  - 工作目录指定     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  结果解析           │  ← parseJUnitXML / parseNewmanJSON
└──────────┬──────────┘
           │              / parsePytestReport
           ▼
┌─────────────────────┐
│  UTRM 格式输出      │  ← toUTRM(results, tool)
└─────────────────────┘
```

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `testScript` | string | ✅ | 脚本路径：Collection JSON 路径 / Java 项目路径 / Python 测试文件路径 |
| `envPath` | string | 否 | Postman 环境变量文件路径（仅 Newman） |
| `testFramework` | string | 否 | 强制指定工具：`postman` / `restassured` / `pytest`；不指定则自动选择 |
| `options` | object | 否 | 扩展选项（见下） |

### options 参数

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `timeout` | number | 120000 | 超时时间（毫秒） |
| `reportFormat` | string | `"junit"` | 报告格式：`junit` / `html` / `json` |
| `workingDir` | string | 自动推断 | 工作目录 |
| `envVars` | object | `{}` | 额外环境变量 |
| `verbose` | boolean | `false` | 是否输出详细日志 |

## 输出：UTRM 统一格式

```json
{
  "tool": "newman",
  "timestamp": "2026-07-13T11:30:00.000+08:00",
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 1,
    "skipped": 1,
    "duration": 3250
  },
  "testcases": [
    {
      "name": "GET /users - 200 OK",
      "classname": "Collection Folder",
      "status": "passed",
      "duration": 120,
      "error": null,
      "request": {
        "method": "GET",
        "url": "https://api.example.com/users",
        "headers": { "Authorization": "Bearer ***" },
        "body": null
      },
      "response": {
        "status": 200,
        "headers": { "Content-Type": "application/json" },
        "body": "{\"users\":[...]}"
      }
    },
    {
      "name": "POST /users - 400 Bad Request",
      "classname": "Collection Folder",
      "status": "failed",
      "duration": 85,
      "error": "Expected status 400 but got 422",
      "request": { "method": "POST", "url": "...", "headers": {}, "body": "{}" },
      "response": { "status": 422, "headers": {}, "body": "{\"error\":\"Validation failed\"}" }
    }
  ],
  "exitCode": 0,
  "rawOutput": "...",
  "errors": []
}
```

## 三个核心调用接口

### 1. invokeNewman(collectionPath, envPath?, options?)

执行 Postman Collection，返回 UTRM 格式。

**命令示例：**
```bash
newman run collection.json \
  -e environment.json \
  --reporters cli,junit \
  --reporter-junit-export results.xml \
  --timeout-request 30000 \
  --timeout 120000
```

**返回：** UTRM JSON（tool = `"newman"`）

---

### 2. invokeRestAssured(javaProjectPath, options?)

执行 Java RestAssured 项目（Maven/Gradle），返回 UTRM 格式。

**命令示例：**
```bash
# Maven
mvn test -Dtest=ApiTest -Dsurefire.reportFormat=junit
# Gradle
gradle test --tests "*ApiTest"
```

**返回：** UTRM JSON（tool = `"restassured"`）

---

### 3. invokePytest(pytestPath, options?)

执行 Python pytest，返回 UTRM 格式。

**命令示例：**
```bash
pytest test_api.py \
  -v \
  --tb=short \
  --junitxml=results.xml \
  --html=report.html \
  --self-contained-html
```

**返回：** UTRM JSON（tool = `"pytest"`）

## 结果解析函数

| 函数 | 输入 | 说明 |
|------|------|------|
| `parseJUnitXML(xmlContent)` | JUnit XML 字符串 | 解析标准 JUnit XML，返回结构化数据 |
| `parseNewmanJSON(jsonContent)` | Newman JSON 输出 | 解析 Newman JSON reporter 输出 |
| `parsePytestReport(reportPath)` | 报告文件路径 | 解析 pytest-junitxml 或 pytest-json-report |
| `toUTRM(results, tool)` | 解析后结果 + 工具名 | 转换为统一 UTRM 格式 |
| `selectBestTool(available)` | 可用工具列表 | 按推荐优先级返回最佳工具 |

## 依赖安装

### Newman（Node.js 环境）
```bash
npm install -g newman
npm install -g newman-reporter-junit
npm install -g newman-reporter-html
```

### RestAssured（Java/Maven 环境）
```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.rest-assured</groupId>
    <artifactId>rest-assured</artifactId>
    <version>5.4.0</version>
    <scope>test</scope>
</dependency>
```

### pytest（Python 环境）
```bash
pip install pytest pytest-html pytest-xdist requests
```

## 错误处理

- **超时**：返回 `exitCode: -1`，`errors: ["Test execution timed out after X ms"]`
- **命令不存在**：返回 `exitCode: -2`，`errors: ["Command not found: newman"]`
- **解析失败**：返回原始输出 + `errors: ["Failed to parse output: ..."]`
- **部分失败**：返回完整的 `testcases`，`summary` 反映真实结果

## 调用示例

### 场景一：自动选择工具
```javascript
const invoker = require('./backend/api-test-invoker');

const result = await invoker.invoke({
  testScript: '/path/to/collection.json',
  // testFramework 未指定，自动检测为 newman
  options: { timeout: 60000 }
});
console.log(result.summary.passed, '/', result.summary.total);
```

### 场景二：强制 pytest
```javascript
const result = await invoker.invoke({
  testScript: '/path/to/test_api.py',
  testFramework: 'pytest',
  options: { reportFormat: 'html' }
});
```

### 场景三：RestAssured
```javascript
const result = await invoker.invoke({
  testScript: '/path/to/java-api-tests/',
  testFramework: 'restassured',
  options: { timeout: 180000 }
});
```
