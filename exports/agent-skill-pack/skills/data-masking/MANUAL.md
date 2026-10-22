# 数据脱敏Agent 安装与使用手册

> Skill ID：`data-masking` · 类型：提示词/方法论 Skill · 目录：`skills/data-masking`

## 1. 用途

数据脱敏Agent，专业数据安全工程师。用于对敏感数据进行脱敏处理。触发场景：用户说"脱敏"、"数据脱敏"、"隐私处理"、"敏感信息"等。

## 2. 目录结构

```text
data-masking/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── scripts/
├── references/
├── assets/
```

## 3. 安装

- 无额外运行时依赖；纯提示词/方法论型 Skill 可直接阅读 `SKILL.md` 使用。

## 4. 快速开始

提示词/方法论型 Skill，无需安装运行时。使用方式：

1. 把 `SKILL.md`（或其中“职责/核心能力/输入输出约定”章节）注入你的 Agent system prompt；
2. 或把本目录作为知识文档挂载到 RAG / 上下文；
3. 如果你的框架支持工具调用，按 `SKILL.md` 的输入输出约定实现适配器，不要声称已调用不存在的工具。

## 5. 输出说明

本 Skill 不直接执行代码，输出由宿主 Agent 按 `SKILL.md` 的约定生成（通常是文本、Markdown 或 JSON）。不要把方法论描述当作已执行结果。

## 6. 限制与排错

- 本 Skill 不执行代码，不存在 `TOOL_NOT_FOUND`；如果宿主声称调用了工具，说明适配器实现有误。
- 迁移时保留 `SKILL.md` 的职责边界与输入输出约定，不要把方法论描述当作执行证据。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
