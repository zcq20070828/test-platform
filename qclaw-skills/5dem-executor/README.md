# 5DEM Executor Skill

五维穷举模型执行器，用于生成高覆盖率测试用例。

## 安装

将此Skill复制到 `~/.qclaw/skills/5dem-executor/` 目录。

## 使用方法

### 1. 作为独立Skill调用

```javascript
const { execute5DEM } = require('./executor.js');

const inputSpec = {
  username: { type: 'string', minLength: 3, maxLength: 20 },
  age: { type: 'number', min: 18, max: 65 },
  role: { type: 'enum', values: ['admin', 'user', 'guest'] }
};

const result = execute5DEM({ inputSpec, dimensions: ['data'] });
console.log(JSON.stringify(result, null, 2));
```

### 2. 集成到智能体

在智能体的SKILL.md中添加：

```markdown
## 技能
- 5dem-executor：五维穷举模型执行器
```

## 功能说明

### 数据维度（当前实现）

1. **等价类划分**：将输入划分为有效等价类和无效等价类
2. **边界值分析**：识别边界点，生成边界值测试用例
3. **Pairwise组合**：生成最优组合，保证两两部分覆盖

### 其他维度（V2.0）

- 流程维度：FSM建模、决策表
- 环境维度：环境配置组合
- 时间维度：时序依赖分析
- 依赖维度：服务依赖图

## 示例

### 输入

```json
{
  "username": { "type": "string", "minLength": 3, "maxLength": 20 },
  "age": { "type": "number", "min": 18, "max": 65 },
  "role": { "type": "enum", "values": ["admin", "user", "guest"] }
}
```

### 输出

```json
{
  "data": {
    "equivalenceClasses": {
      "validClasses": [...],
      "invalidClasses": [...]
    },
    "boundaryValues": [...],
    "pairwise": [...]
  }
}
```

## 工具依赖

- **PICT**（可选）：生成最优Pairwise组合
- **ACTS**（可选）：NIST高级组合测试

## 版本历史

- **V1.0**（2026-07-03）：实现数据维度（等价类、边界值、Pairwise）
- **V2.0**（计划）：实现流程、环境、时间、依赖维度
