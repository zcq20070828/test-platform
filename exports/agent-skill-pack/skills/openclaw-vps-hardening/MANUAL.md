# OpenClaw VPS Server Hardening 安装与使用手册

> Skill ID：`openclaw-vps-hardening` · 类型：代码/脚本型 Skill（未注册通用入口） · 目录：`skills/openclaw-vps-hardening`

## 1. 用途

Harden a Hostinger VPS running OpenClaw agents against unauthorized access, brute force, and exposure. Use when securing a publicly-deployed OpenClaw instance, locking down a VPS after initial deployment, setting up Cloudflare Tunnel + Access as an identity gate, or implementing defense-in-depth for AI agent infrastructure. Covers UFW firewall lockdown, SSH hardening, Fail2Ban, OpenClaw loopback binding, Cloudflare Tunnel, Cloudflare Access per-agent policies, unattended security upgrades, and file permission hardening.

## 2. 目录结构

```text
openclaw-vps-hardening/
├── SKILL.md          # 语义说明 / 输入输出约定
├── MANUAL.md         # 本手册
├── scripts/
├── references/
```

## 3. 安装

- **Python 3.10+（可选）**：仅在使用 pytest / Python 脚本模式时需要；纯 Node 模式可忽略。
- 本 Skill **未注册为通用入口**，不能通过 `invoke-skill.mjs openclaw-vps-hardening` 调用；请按第 4 节直接 import 或运行脚本。

## 4. 快速开始

本目录没有注册到 `invoke-skill.mjs` 的通用入口，但包含可复用代码/脚本：

Shell 脚本（先做语法检查并阅读，确认不会修改生产环境后再运行）：

```bash
bash -n skills/openclaw-vps-hardening/scripts/harden.sh  # 只检查语法，不执行
sed -n '1,120p' skills/openclaw-vps-hardening/scripts/harden.sh
```

> 这些模块原本由测试中台 `server.js` 直接 import，可能依赖平台内部的任务对象、数据库连接或 LLM 客户端；对外使用时需要自行注入等价上下文。

## 5. 输出说明

输出由模块/脚本自身决定，通用调用器不会自动包装成 UTRM。调用前先查看第 4 节列出的导出符号或脚本参数；这些代码原本由测试中台内部直接 import，迁移后需要自行注入任务对象、数据库、LLM 等上下文。

## 6. 限制与排错

- 模块依赖未安装或导入路径错误：按 Node/Python 的报错安装依赖；本模块不经过工具调用器，不存在 `TOOL_NOT_FOUND`。
- 文件路径：脱敏/SMB 类 Skill 只允许项目目录或临时目录内的路径，迁移后请按你的环境调整白名单。
- 真实执行：接口/UI/性能类 Skill 会发起真实请求或启动浏览器/压测工具，请只在获得授权的目标上使用。
- 未注册通用入口：不要执行 `invoke-skill.mjs <本 Skill>`；按第 4 节直接 import 或运行脚本。
- 更多语义与边界条件见同目录 `SKILL.md`。

## 7. 来源与许可

本 Skill 从测试中台 `qclaw-skills` 导出，沿用原 Skill 的上游许可；对外分发前请确认对应项目/依赖的许可证。
