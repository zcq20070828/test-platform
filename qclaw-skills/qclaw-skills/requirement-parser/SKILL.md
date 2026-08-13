# requirement-parser

## 职责
将各类格式的需求文档解析为结构化输出，供测试用例生成使用。

## 技能
- parser-core：核心解析引擎（模块提取/AC识别/优先级检测）
- structure-builder：结构化输出构建与校验

## 工作流程
1. 接收原始需求文本
2. parser-core 提取模块、功能点、验收标准、优先级、边界条件
3. structure-builder 构建标准结构化格式
4. 校验结构完整性后返回

## 调用方式
```js
import { parseRequirement, extractModules } from '~/.qclaw/skills/requirement-parser/backend/parser-core.js';
import { buildStructuredRequirement } from '~/.qclaw/skills/requirement-parser/backend/structure-builder.js';
```

## parser-core 导出函数
- `parseRequirement(text, options?)`：主解析入口，输出 `{ modules, functionalPoints, acceptanceCriteria, priority, edgeCases }`
- `extractModules(text)`：提取模块/子系统（支持中文模块名 + 英文术语配对）
- `extractAcceptanceCriteria(text)`：识别验收标准（支持"验收标准"/"AC"/"Given…When…Then"/"预期结果"等格式，含中文 给定/当/那么）
- `detectPriority(text)`：识别优先级（P0=冒烟 / P1=核心 / P2=扩展，支持中文标签反推）

## structure-builder 导出函数
- `buildStructuredRequirement(parsed, format?)`：构建标准结构化格式，`format` 支持 `json`（默认）/ `markdown` / `excel`（Excel 友好行数组）
- `validateStructure(data)`：校验结构完整性，返回 `{ valid, missingFields, warnings }`

## 示例
```js
const text = `
# 用户管理模块 (User Management)
## 功能点
- 支持用户注册，使用手机号注册
## 验收标准
Given 用户未登录 When 访问需要权限的页面 Then 跳转到登录页
优先级：P0 冒烟
`;

const parsed = parseRequirement(text);
const structured = buildStructuredRequirement(parsed, 'json');
const check = validateStructure(structured);
console.log(check.valid); // true
```
