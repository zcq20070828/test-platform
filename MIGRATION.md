# 测试中台迁移记录

**日期：** 2026-08-13
**来源：** `~/.qclaw`（QClaw）
**目标：** `~/WorkBuddy/2026-08-13-20-26-38/test-platform/`

---

## ⚠️ 先读这段：搬过来的不是你最新的代码

勘查后确认，本机上同一个项目存在 **四个版本**，而本次迁移搬的是其中最旧的一个：

| 版本 | 位置 | server.js | 数据层 | 最后修改 | git |
|---|---|---|---|---|---|
| **A（本次已迁移）** | `~/.qclaw/skills/test-platform-*` | 5292 行 | JSON 文件存储 | 6/29 | ✅ 有 |
| **B（本地最完整）** | `~/Desktop/腾讯云应用服务器/20260730/` | **11343 行** | MySQL + 13 个 DAO | 7/30 23:39 | ❌ 无 |
| C | `~/Desktop/腾讯云应用服务器/20270718/test-platform-v1.0.0-20260718/` | — | MySQL DAO | 7/17 | ❌ 无 |
| **D（当前开发中）** | 腾讯云 42.194.137.114 | ? | ? | **今天 15:44** | ? |

**判定依据：** 你 2026-08-13 的日志记录改了 `backend/database/task-dao.js` 的 `getTasks`（SQL JOIN users 返回 username）。
该文件在 A 版仓库及其全部 git 历史中都不存在；Spotlight 全盘检索本机只有 B、C 两份 `task-dao.js`，且均不含 username 改动。
→ 今天的改动只存在于腾讯云服务器上。

**B 版才是测试中台的完整形态**：含 `backend`+`frontend`+`database`+`deploy`+`qclaw-agents`+`qclaw-knowledge-base`，
有 `schema.sql`、`migrations`、13 个 DAO（task/user/workflow/defects/stats/cost-config/conversation/learned-knowledge 等），
与记忆中「数据库统一使用 MySQL」一致。A 版属早期原型。

**风险提示：** B、C 两份均无 git 版本控制，是裸目录快照，无历史、无法回滚。

---

## 已完成的工作

### 1. 迁移前安全点（在 QClaw 原处，遵循每日分支策略）

| 仓库 | 分支 | 提交 | 内容 |
|---|---|---|---|
| test-platform-backend | `feature/2026-08-13-pre-migration` | `c05693b` | 38 项，全为 public/assets 构建产物 + server.js 备份，无源码改动 |
| test-platform-vue | `feature/2026-08-13-pre-migration` | `9fd37da` | 50 项，含 src/api、stores/main、3 个 view、11 个 e2e spec |

两仓库 `main` 未改动，工作区已清空。原目录 `~/.qclaw` 完整保留可运行。

### 2. 目录结构

```
test-platform/
├── backend/      ← git clone，21 提交完整（含 .env，权限 600）
├── frontend/     ← git clone，117 提交完整（dist 62 文件随行）
├── deploy/       ← deploy.sh + README
├── runtime/      ← 新建，承接原散落于 ~/.qclaw 的业务数据
│   ├── data/            16M（evaluation.db 11M、tasks.json 676K、users.json、228 份评估报告）
│   ├── knowledge-base/  4.9M（80 文件）
│   └── git-clones/      1.6M（240 文件）
└── MIGRATION.md
```

**未迁移：** `~/.qclaw/agents/main/sessions`（4.4G，QClaw 运行时会话资产，非平台业务数据）、
各 node_modules 缓存（backend 的 141 包因被 git 跟踪而随行）、dist 外的构建中间产物、日志。

### 3. 路径解耦改造（`backend/server.js`，5 处）

原代码硬编码 10 处 `~/.qclaw` 绝对路径，不改则搬过来仍读回旧目录。引入两个可覆盖的根变量：

```js
const PLATFORM_ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..', 'runtime');
const QCLAW_HOME    = process.env.QCLAW_HOME    || path.join(process.env.HOME, '.qclaw');
```

| 位置 | 改动 |
|---|---|
| `KB_ROOT` / `TASK_FILE` / `USERS_FILE` | → `PLATFORM_ROOT` |
| `ensureKBDirs()` 中的 data 目录 | → `PLATFORM_ROOT` |
| `gitRoot`（仓库克隆根） | → `PLATFORM_ROOT/git-clones` |
| `OPENCLAW_SESSIONS_DIR` / `agentSessionsDir` | → `QCLAW_HOME`（会话数据未迁移，仍读原处） |
| `UI_PATH` | → `../frontend/dist`，支持 `UI_PATH` 覆盖 |

### 4. 智能体 skill（13 个）→ `~/.workbuddy/skills/`

边界依据后端 `AGENTS` 注册表（server.js L790），非主观筛选：

`test-master`（规划中枢）、`test-requirement-analyzer`、`test-case-generator`、`test-data-generator`、
`test-scheme-generator`、`test-reporter`、`defect-analyzer`、`api-executor`、`ui-e2e-executor`、
`data-masking`、`ai-quality-reviewer-1/2/3`

frontmatter 全部合规，内部无 `.qclaw` 硬编码残留。QClaw 另有 40 余个 security-*/pentest/e2e-patterns
属通用能力、非平台依赖，未迁移。

与已有 `mail139-*` 系列构成「通用中台能力 + 139 邮箱项目特化」分层，mail139 那套未改动。

---

## 验证结果

| 项目 | 结果 |
|---|---|
| `node --check server.js` | ✅ 通过 |
| 服务启动（PORT 3002） | ✅ 成功 |
| `/api/health` | ✅ `{"status":"ok","agents":13,"tasks":0}` |
| KB Root 指向 | ✅ `.../test-platform/runtime/knowledge-base`（解耦生效） |
| 用户数据加载 | ✅ 加载 4 个用户 |
| git 历史 | ✅ 后端 21 提交 / 前端 117 提交完整 |
| 依赖完整性 | ✅ express/ws/multer/mammoth/jsonwebtoken 齐全 |

### 两个非迁移引入的既有问题

1. **`tasks: 0`** — `TASK_FILE` 常量定义后代码中无任何引用，`tasks.json` 里 54 条任务本就未被加载
   （文件最后更新 7/15）。属原有技术债，数据已完整保留在 `runtime/data/tasks.json`。
2. **智能体 warmup 报 `fetch failed`** — 依赖 `.env` 里的 `OPENCLAW_GATEWAY` 网关，QClaw 服务未启动所致。
   这是平台与 QClaw 的深层耦合点：13 个智能体的实际执行仍要经 QClaw 网关调度。

---

## 遗留事项

1. **确认迁移源**：以 B 版（桌面 20260730）还是 D 版（服务器最新）为主体，需你拍板。
2. **B/C 无版本控制**：建议纳入 git 管理，否则裸快照有丢失风险。
3. **git remote 指向旧目录**：clone 出的 `origin` 指向 `~/.qclaw/skills/...`，保留了溯源能力，但注意勿误 push。
4. **网关耦合**：智能体执行依赖 `OPENCLAW_GATEWAY`，若要完全脱离 QClaw 需评估改造方案。
