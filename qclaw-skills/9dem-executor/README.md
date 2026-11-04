# 9DEM Executor Skill

九维穷举模型执行器（9DEM）× 黑盒 9 种设计方法，用于生成高覆盖率且不重复的测试用例。

- **维度（测哪里）**：用户 / 数据 / 流程 / 操作 / 安全 / 性能 / 网络环境 / 终端环境 / 兼容性
- **方法（怎么设计）**：等价类划分 / 边界值分析 / 因果图 / 判定表 / 正交试验 / 错误推测 / 场景法 / 状态迁移 / 功能图

## 安装

将此 Skill 复制到 `~/.qclaw/skills/9dem-executor/`，或在测试中台仓库内直接使用（后端按 `qclaw-skills/9dem-executor` 加载）。

## 使用方法

### 1. 作为独立 Skill 调用

```javascript
const { execute9DEM } = require('./executor.js');
const { executeDesignMethods } = require('./backend/design-methods');

const inputSpec = {
  username: { type: 'string', length: [3, 20] },
  age: { type: 'integer', range: [18, 65] },
  role: { type: 'enum', values: ['admin', 'user', 'guest'] },
};

// 九维维度引导（data 维度含自动化计算）
const dims = execute9DEM({ inputSpec, dimensions: ['data', 'process', 'compatibility'] });

// 黑盒 9 法确定性生成用例（跨方法去重）
const design = executeDesignMethods({
  input: {
    inputSpec,
    factors: { 平台: ['iOS', 'Android'], 网络: ['4G', '弱网'] },
    scenarios: [{ name: '登录成功', type: 'basic', steps: ['输入账号', '提交'] }],
    states: { states: ['未登录', '已登录'], transitions: [{ from: '未登录', to: '已登录', event: '登录成功' }] },
  },
});
console.log(design.stats, design.cases);
```

### 2. 通过统一工具入口（LLM tool-call）

```javascript
const { invoke } = require('./backend/9dem-invoker');

const result = await invoke({
  inputSpec: { age: { type: 'integer', range: [18, 120] } },
  methods: ['equivalence', 'boundary', 'errorGuessing'],
  designInput: {
    scenarios: [{ name: '正常下单', type: 'basic', steps: ['选商品', '提交订单'] }],
  },
  dedupe: true,
});

console.log(result.design.cases);   // 可直接落表的用例
console.log(result.design.stats);   // 方法覆盖 + 去重统计
```

### 3. 集成到智能体

在智能体的 system prompt / SKILL 列表中声明：

```markdown
## 技能
- 9dem-executor：九维穷举 × 黑盒 9 法执行器（确定性用例 + 去重）
```

## 功能说明

### 九维维度（决定覆盖范围）

| 维度 | 关注点 |
|------|--------|
| ① 用户 | 登录态/角色/数据隔离/越权 |
| ② 数据 | 业务数据、接口参数、LLM 输出 |
| ③ 流程 | 多阶段状态机、合法与非法迁移 |
| ④ 操作 | 重复操作/中断恢复/幂等/前置条件 |
| ⑤ 安全 | 鉴权/越权/脱敏/注入 |
| ⑥ 性能 | 超时/并发/大数据量/宕机恢复 |
| ⑦ 网络环境 | 弱网/断网/切网/SSE 断流 |
| ⑧ 终端环境 | 浏览器与系统级中断（切后台/锁屏） |
| ⑨ 兼容性 | 浏览器矩阵/渲染布局一致性 |

> data 维度含自动化计算（等价类、边界值、Pairwise）；其余维度返回结构化方法论引导。

### 黑盒 9 种设计方法（决定用例怎么来）

| 方法 | 输入 | 输出 |
|------|------|------|
| 等价类划分法 | `inputSpec` / `fields` | 有效/无效等价类各至少 1 条 |
| 边界值分析法 | 区间或长度 | min-1/min/min+1/内点/max-1/max/max+1 |
| 因果图法 | `causes` + `effects` + `rules` | 每条规则 1 条 + 取反反例 |
| 判定表法 | `rules` | 每条规则列 1 条 + 全不满足默认规则 |
| 正交试验法 | `factors`（≥2 因子） | 2-wise 覆盖组合（≤64 条） |
| 错误推测法 | `inputSpec` / `fields` | 空值/超长/特殊字符/SQLi/XSS/重复提交/并发 |
| 场景法 | `scenarios` | 每条业务路径 1 条 |
| 状态迁移法 | `states` + `transitions` | 合法迁移全覆盖 + 非法迁移抽样 |
| 功能图法 | `functions` | 正常调用 + 前置条件不满足反例 |

### 去重规则

以「输入数据 + 执行步骤 + 预期结果」归一化为唯一键：

- 同一键只保留一条用例；
- 命中多种方法的用例合并标注，例如 `methodLabel = "等价类划分法+边界值分析法"`、`dimension = "② 数据"`；
- `design.stats` 输出 `totalCasesBeforeDedupe / uniqueCases / duplicatesRemoved`，便于核对。

## 输出示例

```json
{
  "cases": [
    {
      "methodKey": "M1",
      "methods": ["等价类划分法"],
      "methodLabel": "等价类划分法",
      "dimension": "② 数据",
      "layer": "异常",
      "name": "等价类-age-小于下界",
      "precondition": "系统已部署且可访问对应功能",
      "input": "age=17",
      "steps": "",
      "expected": "拒绝处理并返回明确的参数错误提示，不返回 5xx",
      "priority": "中",
      "trace": "无效等价类 age<18"
    }
  ],
  "stats": {
    "requestedMethods": 9,
    "methodsWithCases": 9,
    "skippedMethods": [],
    "totalCasesBeforeDedupe": 90,
    "uniqueCases": 88,
    "duplicatesRemoved": 2,
    "methodCoverage": 100
  }
}
```

## 工具依赖

- **Node.js >= 18**（仓库内运行建议 22+）
- **PICT**（可选）：大规模组合时替代内置贪心 2-wise
- Jest / Pytest / Playwright（可选）：测试脚本生成与执行

## 单元测试

```bash
node test/design-methods-test.js   # 黑盒 9 法 + 去重（22 项）
node test.js                       # 数据维度等价类/边界值/Pairwise
```

## 版本历史

- **V3.0**（2026-11-04）：新增黑盒 9 种设计方法确定性生成器与跨方法去重；invoker 支持 methods/designInput/dedupe
- **V2.1**（2026-09-20）：五维升级为九维（9DEM），未实现维度返回结构化引导
- **V2.0**（2026-07-05）：PICT、测试脚本生成器、测试框架集成
- **V1.0**（2026-07-03）：数据维度（等价类、边界值、Pairwise）
