# 测试中台迁移记录（WorkBuddy）

> 迁移日期：2026-08-13 ｜ 状态：**已完成（B 版为权威源）**
> 工作区：`/Users/zhaochengqing/WorkBuddy/2026-08-13-20-26-38/test-platform/`

---

## 一、关键结论（先读这段）

上一轮误把 `~/.qclaw` 下的**早期原型（A 版，5292 行 JSON 存储）**搬了过来。
经 Spotlight 全盘核查，真正的完整平台在**桌面 `~/Desktop/腾讯云应用服务器/20260730`（B 版，11343 行 + MySQL DAO 层）**，
而今天（8/13 15:44）你改的 `task-dao.js` 只存在于**生产服务器 42.194.137.114**。

本轮已用 **B 版完整覆盖** A 版（A 版 git 历史仍保留在 `~/.qclaw`，A 版文件备份在 `/tmp/tp-legacy-A` 安全网）。

## 二、平台架构（B 版，自包含于 test-platform/）

| 目录 | 内容 | 说明 |
|---|---|---|
| `backend/` | `server.js` 11343 行 + `database/` 13 个 DAO + `services/` | MySQL 驱动，含 `db.js`/`schema.sql`/`migrations`/`migrate-from-json.js` |
| `frontend/` | Vue3 + Vite + Playwright | 含 `dist/` 构建产物 |
| `database/` | `01-schema-incremental.sql` / `02-init-data-incremental.sql` | 增量 schema |
| `deploy/` | 部署脚本 | |
| `qclaw-agents/` | **15 个智能体**定义（含 `SOUL.md` + 工作区产物） | 平台运行时从这里加载 agent |
| `qclaw-knowledge-base/` | `general` / `project-biz` / `project-test` | 知识库 |
| `qclaw-skills/` | **28 个工具 skill**（含 `api-test-tool-invoker`/`ui-test-tool-invoker`/`5dem-executor`/`evaluation-system`） | 执行层 |
| `runtime/` | 本地运行时数据（git 忽略） | `data/`(users/tasks/评估) + `git-clones/` |

**15 个注册智能体**（后端 `AGENTS` 注册表）：test-master、test-requirement-analyzer、test-case-generator、test-data-generator、test-scheme-generator、test-reporter、defect-analyzer、api-executor、ui-e2e-executor、data-masking、test-script-generator、ai-evaluation-agent、ai-quality-reviewer-1/2/3

## 三、路径解耦（核心改造）

`server.js` 原 **91 处 `~/.qclaw` 硬编码**（代码路径 + 提示文本），全部改为以下常量驱动，平台数据面不再回读 `~/.qclaw`：

```
PLATFORM_ROOT  = path.resolve(__dirname, '..')   // = test-platform/
RUNTIME_ROOT   = PLATFORM_ROOT/runtime
KB_ROOT        = PLATFORM_ROOT/qclaw-knowledge-base
AGENTS_DIR     = PLATFORM_ROOT/qclaw-agents
SKILLS_DIR     = PLATFORM_ROOT/qclaw-skills
```

解耦后启动日志已验证：`KB Root: .../test-platform/qclaw-knowledge-base`，运行期**无任何 `~/.qclaw` 残留读取**。
可用环境变量 `PLATFORM_ROOT` / `RUNTIME_ROOT` 覆盖根位置。

## 四、版本控制

- B 版原是**裸快照、无 git**（丢失风险高）。已在 `test-platform/` 初始化 git：
  - `837026e` 初始化完整平台（解耦后）
  - `64312c4` 将 `runtime/` 移出版本控制（含嵌套 git 仓库 express）
- 当前 1075 个跟踪文件，工作区干净，main 分支无远程。

## 五、运行验证（2026-08-13 实测）

```
node server.js  →  http://localhost:3888
/api/health → {"status":"ok","agents":15,"tasks":286}
[Users] 从数据库加载了 4 个用户
[Tasks] 从数据库加载了 286 个任务
[KB] Root: .../test-platform/qclaw-knowledge-base
OPENCLAW_GATEWAY 未启动 → 自动回退直连 Deepseek API（不卡死）
```

- **本地 MariaDB（3306）已运行且含 `test_platform` 库**（286 任务 / 4 用户），平台直接连上，**MySQL 为活存储**。
- 依赖已 `npm install`（220 包）于 `backend/node_modules`（git 忽略）。

## 六、已知事项 / 待你定

1. **生产服务器最新代码未纳入**：今天 15:44 改的 `task-dao.js`（`getTasks/formatTask` 加 username）只在 `42.194.137.114`。
   按红线「不主动操作生产线」，**未连接**。需你明确授权我才拉取合并。
2. **`package.json` 缺 `"type":"module"`**：Node 22 会触发 `MODULE_TYPELESS_PACKAGE_JSON` 警告并自动按 ESM 重解析（无害，仅性能提示）。
   可选修复：加 `"type":"module"`。属源码改动，按红线需你确认后再做。
3. **25 处大写 `QClaw` 引用**：macOS QClaw 网关 Python 路径（`Library/Application Support/QClaw/...`），
   属 QClaw 原生特性依赖，本地无 QClaw 时该路径不可用，但核心流程已验证可脱离 QClaw 网关运行。
4. **`~/.workbuddy/skills/` 下上轮搬的 13 个 A 版镜像已过时**：权威定义现位于 `test-platform/qclaw-agents`，
   格式为 `SOUL.md`。那 13 个镜像不影响平台运行（平台自包含），如需作为独立 WorkBuddy 智能体使用，应从 B 版刷新。
5. **`test-effort-estimator` skill 在 B 中缺失**：`server.js` 引用了 `qclaw-skills/test-effort-estimator`，但 `qclaw-skills/` 里无此目录（B 自身即如此，非迁移引入）。

## 七、红线提醒（继承自 QClaw MEMORY.md，永久生效）

- 不许自由发挥 / 擅自作主，先确认；无指令绝不主动提 build 与生产部署。
- 改源码 → 你在 dev 验收 → 你说可 build → 才 build。
- 腾讯云 42.194.137.114 是生产线：只增量、不主动动。

## 八、如何运行

```bash
cd test-platform/backend && npm install   # 已完成
node server.js                            # 或 npm run dev（默认 3888）
# 前端：cd ../frontend && npm install && npm run dev（5173）/ build
# 数据库：本地 MariaDB test_platform（已就绪）；生产见 deploy/
```

---

## 九、2026-09-16 同步（从 QClaw 真实 dev 源 `~/.qclaw/workspace`）

> 触发：用户指出「dev 环境最新版本不是 8/27」。查证后确认真实 **dev 源是 `~/.qclaw/workspace/`**（git 仓库，今日 18:30 仍含未提交改动），而非桌面导出快照（8/17–8/27 衍生品）。
> 决策（用户确认）：**连未提交改动一起同步**；**保留 test-platform 分层，内容归位**；**不碰生产服务器 42.194.137.114**。

### 9.1 同步范围与结果

| 项 | 同步前 | 同步后 | 来源 |
|---|---|---|---|
| `backend/server.js` | 11343 行 | **14354 行**（+今日未提交改动） | rsync `~/.qclaw/workspace/backend/` |
| `qclaw-agents/` | 15 目录 | **19 目录** | 新增 compatibility-coordinator / performance-tester / report-generator / security-sentinel |
| 注册 agent（AGENTS 表） | 15 | **18**（report-generator 目录存在但未注册） | server.js 注册表 |
| `qclaw-skills/` | 28 | **38** | 合并 workspace/skills 安全类（security-sentinel / security-vuln-scanner 等） |
| `frontend/dist/` | 8/13 构建 | **8/26 构建（87 文件）** | rsync workspace/frontend/dist/ |
| `qclaw-knowledge-base/` | 162 文件 | **保留不变** | workspace 无此目录，沿用 test-platform |
| `database/` | 现有 | **保留不变** | workspace 无 database 目录 |

### 9.2 路径解耦（重做）

新 server.js 含 **116 处 `~/.qclaw` 硬编码**，全部重写为常量驱动：
`PLATFORM_ROOT / RUNTIME_ROOT / SKILLS_DIR / AGENTS_DIR / KB_ROOT / DATA_ROOT / GIT_CLONES_DIR / TEST_RUNS_DIR`。
**残留 2 处**（openclaw.json / sessions，QClaw 兼容保留，非硬编码路径）。`node --check` 通过，实测启动干净、无 `~/.qclaw` 残留读取。

### 9.3 同步中暴露并修复的问题

1. **后端 node_modules 不完整**：rsync 带入 workspace 的残缺 node_modules，缺 `helmet` / `express-rate-limit` / `playwright`。已 `npm install` 补齐（playwright 跳过浏览器下载）。
2. **解耦引入语法错误**：decouple 脚本在 L2378 多写一个 `)`，已修正 `path.join(AGENTS_DIR, agentId, 'SOUL.md'))` → 单 `)`。
3. **嵌套 .git 导致 submodule 报错**：`performance-tester` / `compatibility-coordinator` 自带 `.git`（workspace 内为独立仓库），`git add` 报「does not have a commit checked out」。已删除这两个嵌套 `.git` 元数据（文件保留）。
4. **.gitignore 加固**：原仅忽略 `node_modules/`、`*/node_modules/`，新增 `**/node_modules/`、`**/dist/` 排除深层嵌套依赖。

### 9.4 运行验证（2026-09-16 实测）

```text
node server.js  →  http://localhost:3002   （读取 backend/.env：PORT=3002, NODE_ENV=production）
/api/health    →  {"status":"ok","agents":18,"tasks":389}
```
- 启动无 `~/.qclaw` 残留读取错误；18 个注册 agent 正常加载。
- ⚠️ **本地 MariaDB（3306）当前无 `test_platform` 库 / `appuser` 账号**：连接池采用 `database/db.js` 默认值（localhost/appuser/apppwd123/test_platform）。需先建库建用户（`mysql < database/*.sql` 或执行 migrations）才能打通 DB 相关功能。`/api/health` 不查库故不受影响。
- ⚠️ 带入少量 QClaw 运行时产物（各 agent 目录下 `.openclaw/workspace-state.json`），无害；后续可加 `.openclaw/` 到 .gitignore。

### 9.5 版本控制

- 分支：`feature/2026-09-16-sync-workspace`（独立于 main）。
- 提交 `107ee5a`「同步 QClaw workspace 最新状态」：**856 文件变更，+178441 / −2077**，工作树干净。
- **未合并 main、未 push、未部署**（按红线，待你在 dev 验收后授权）。

### 9.6 待你定

1. 是否在 dev 验收后合并 `feature/2026-09-16-sync-workspace` → main 并 push？
2. 是否建立/导入本地 `test_platform` 库（执行 `database/` 迁移）以打通 DB 功能？
3. 生产服务器 42.194.137.114 仍为旧状态，是否需将本次变更**增量**同步上去（红线：需你明确授权）？
