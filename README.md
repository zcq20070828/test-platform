# 测试中台（Test Platform）

一个 AI 驱动的测试中台：需求分析 → 用例生成 → 测试执行 → 质量审核 → 报告输出，全流程由智能体编排。

**前端**：Vue 3 + Vite + Element Plus
**后端**：Node.js + Express
**数据库**：MySQL / MariaDB
**智能体**：19 个 AI Agent（`qclaw-agents/`）+ 46 个技能（`qclaw-skills/`）

---

## 🚀 我是新成员，怎么开始

👉 **请读 [`ONBOARDING.md`](ONBOARDING.md)**

那是一份从零开始的小白指南，包含：装软件 → 配 SSH → 拉代码 → 装依赖 → 建库 → 启动 → 验证 → 日常开发 → 排错，每条命令都可以直接复制。

前置条件只有三个：

```bash
git --version      # 需要 git
node -v            # 需要 ≥ 20.19 或 ≥ 22.12
# 以及一个 GitHub 账号（用于拉取和推送代码）
```

---

## ⚡ 已经配好环境的，三步启动

```bash
cd test-platform

# 1. 装依赖（首次）
(cd backend && npm ci) && (cd frontend && npm ci)

# 2. 配环境（首次）
cp backend/.env.example backend/.env
$EDITOR backend/.env      # 填 DB_HOST / DEEPSEEK_API_KEY / PORT

# 3. 启动（端口换成你自己的编号）
BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh
```

打开 <http://localhost:5175>，用 `admin / admin123` 登录。

```bash
./start-dev.sh status    # 看状态
./start-dev.sh stop      # 停止
./start-dev.sh restart   # 重启
```

---

## 📚 文档索引

| 文档 | 内容 | 看的人 |
|---|---|---|
| [`ONBOARDING.md`](ONBOARDING.md) | **小白版完整接入指南**（推荐入口） | 新成员 |
| [`NEW-MEMBER-ONBOARDING.md`](NEW-MEMBER-ONBOARDING.md) | 给 AI 助手读的清单版 | 新成员 / AI |
| [`COLLABORATION.md`](COLLABORATION.md) | 分支策略、数据库纪律、冲突处理 | 所有人 |
| [`GIT-ACCESS-GUIDE.md`](GIT-ACCESS-GUIDE.md) | 授权操作、安全红线 | 负责人 |
| [`database/README.md`](database/README.md) | 数据库脚本说明 | 需要建库的人 |
| [`MIGRATION.md`](MIGRATION.md) | 历史迁移记录（参考） | —— |

---

## 📁 目录结构

```
test-platform/
├── backend/              后端服务（Express API）
│   ├── server.js         主服务入口
│   ├── database/         MySQL 连接封装
│   ├── migrations/       表结构变更脚本
│   ├── services/         业务服务
│   ├── vector/           知识库向量检索（Python）
│   └── .env.example      配置模板（复制成 .env 后填写）
│
├── frontend/             前端界面（Vue 3 + Vite）
│   ├── src/views/        页面
│   ├── src/components/   组件
│   ├── src/api/          接口封装
│   └── tests/e2e/        Playwright 端到端测试
│
├── qclaw-agents/         19 个 AI 智能体（提示词 + 配置）
├── qclaw-skills/         46 个技能（测试执行器、分析器）
├── qclaw-knowledge-base/ 知识库文档（需求、模板、规范）
├── database/             数据库脚本
│   ├── 00-schema-full.sql     ← 从零建库用这个（42 张表）
│   ├── 01-schema-incremental.sql   历史增量脚本
│   └── 02-init-data-incremental.sql  默认账号数据
├── deploy/               部署脚本
├── setup-dev-env.sh      新成员一键配置
└── start-dev.sh          一键启动
```

---

## 🗄️ 数据库

两种方式二选一：

**A. 连团队开发库**（推荐）— 向负责人要当前 IP，填进 `backend/.env` 的 `DB_HOST`。

**B. 本地自建** — 用仓库自带的完整建表脚本（已验证可导入）：

```bash
mysql -u root -p < database/00-schema-full.sql
mysql -u root -p -e "CREATE USER IF NOT EXISTS 'appuser'@'localhost' IDENTIFIED BY 'apppwd123';
  GRANT ALL PRIVILEGES ON test_platform_dev.* TO 'appuser'@'localhost'; FLUSH PRIVILEGES;"
mysql -u appuser -papppwd123 test_platform_dev < database/02-init-data-incremental.sql
```

默认账号：`admin / admin123`、`test1 / test123`、`testuser / test123`、`tester2 / test123`。

> ⚠️ `DB_NAME` 必须是 `test_platform_dev`。填成 `test_platform` 会连到负责人的正式库（443 条历史任务）。

---

## 🔐 安全约定

- `.env` 已被 `.gitignore` 排除，**永远不会入库**；密码和 Key 只放本地
- 不要提交 `node_modules/`、`dist/`、`runtime/`、`*.log`
- Key 和密码只私聊传递，不贴群、不写进被跟踪的文件
- GitHub 启用了推送保护：commit 里含 API Key 会被**直接拒绝推送**

---

## 🌿 分支规范

```bash
git checkout main && git pull
git checkout -b feature/2026-10-19-简短描述

# ...开发...
git add . && git commit -m "feat: 做了什么"
git push -u origin feature/2026-10-19-简短描述

# 收工合回 main
git checkout main && git merge --no-ff feature/2026-10-19-简短描述 && git push
```

详见 [`COLLABORATION.md`](COLLABORATION.md)。

---

## 🆘 出问题了

1. 先看 [`ONBOARDING.md` 第 11 章 常见问题排查](ONBOARDING.md#11-常见问题排查)
2. 还不行，把**完整报错信息**发给负责人（说清楚：哪一步、什么命令、什么报错）

常见速查：

| 现象 | 解决 |
|---|---|
| 页面能开但数据不出来 | `VITE_API_TARGET` 和后端端口不一致 |
| 后端报错连不上数据库 | `DB_HOST` 不对，或不在同一局域网 |
| `npm ci` 很慢 | `npm config set registry https://registry.npmmirror.com` |
| `git push` 卡住 | `ssh -T git@github.com` 先测通 |
| 登录提示密码错误 | 连错库了，确认 `DB_NAME=test_platform_dev` |
