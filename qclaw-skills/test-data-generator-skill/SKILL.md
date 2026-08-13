# test-data-generator-skill
## 职责
生成测试数据（等价类/边界值/组合数据/特殊值），支持多格式输出，自动应用脱敏规则。

## 技能
- data-generator：测试数据生成引擎（等价类/边界值/正交组合）
- data-formatter：多格式输出（JSON/CSV/SQL）与脱敏

## 工作流程
1. 接收字段规格（类型/约束/数量）
2. data-generator 生成等价类、边界值、组合数据
3. data-formatter 按需求格式输出（JSON/CSV/SQL）
4. 应用脱敏规则后返回

## 调用方式
```js
import { generateTestData, generateBoundaryValues, generateEquivalenceClasses, generateCombinations }
  from '~/.qclaw/skills/test-data-generator-skill/backend/data-generator.js';
import { formatAs, applyMasking, generateDataManifest }
  from '~/.qclaw/skills/test-data-generator-skill/backend/data-formatter.js';
```

## 字段规格（spec）说明
每个字段为一个对象：
```js
{
  field: 'age',          // 字段名
  type: 'number',        // string|number|date|email|phone|postalCode|creditCard|url|ip|json|customRegex
  constraints: {         // 可选约束
    min: 0, max: 120,    // number/date 区间
    integer: true,       // number 是否整数
    minLength: 2, maxLength: 6, // string 长度
    pattern: '\\d{6}',   // customRegex 必填；string 可选
    allowedValues: ['red','green','blue'], // 枚举取值（优先于类型随机生成）
  }
}
```

## 函数速查
### data-generator
- `generateTestData(spec, count?)` — 主入口。spec 为单字段对象时返回随机值数组；为字段数组时返回记录数组。
- `generateBoundaryValues(min, max, type?)` — 边界值 min-1/min/min+1/normal/max-1/max/max+1（type: number/string/date）。
- `generateEquivalenceClasses(spec)` — 返回 `{ valid, invalid, boundary }` 三类代表值。
- `generateCombinations(factors, strategy?)` — 组合数据。strategy: `all`(全组合) / `pairwise`(全对偶) / `orthogonal`(2-way 覆盖) / `random`(随机抽样)。factors 为取值数组或 `{name, values}`。

### data-formatter
- `formatAs(data, format?)` — 格式：json / csv / sql / xlsx-friendly / map。
- `applyMasking(data, rules)` — 脱敏。rules: `[{field, method}]` 或 `{field: method}`，method ∈ phone/email/name/idCard/all。
- `generateDataManifest(data)` — 数据清单（字段说明 + 样本值 + 类型统计）。

## 自测
```bash
node ~/.qclaw/skills/test-data-generator-skill/backend/data-generator.js
node ~/.qclaw/skills/test-data-generator-skill/backend/data-formatter.js
```
