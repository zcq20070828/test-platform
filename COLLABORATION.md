# 测试中台 · 多人协作开发指南

> 面向所有参与测试中台建设的研发。看完这一篇就能独立上手。
>
> **第一次接入请先看 [`ONBOARDING.md`](ONBOARDING.md)** —— 那是逐条命令的小白版，
> 包含装软件、配 SSH、装依赖、建库、启动、排错的完整流程。本文只讲协作规范。
>
> 远程仓库：GitHub <https://github.com/zcq20070828/test-platform>
> （历史遗留的腾讯云裸库 `42.194.137.114:/opt/git/test-platform.git` 仍可读，但**不再作为主仓库**）

---

## 一、第一次上手（每人只需做一次）

### 1. 拿到仓库访问权限

向项目负责人索取：

| 项目 | 内容 |
|---|---|
| 仓库邀请 | 负责人在 GitHub 上邀请你为 Collaborator（Write 权限） |
| 开发库地址 | 负责人 Mac 的当前内网 IP |
| AI Key | 团队共用 Key（只能私聊，不要贴群） |

> GitHub 仓库当前是 Public，未受邀也能 clone 和查看；
> 但**推送代码必须被邀请**，否则 `git push` 会被拒绝。

### 2. 配置 SSH

用你自己的 GitHub 账号生成密钥并上传公钥：

```bash
ssh-keygen -t ed25519 -C "你的邮箱@example.com"
cat ~/.ssh/id_ed25519.pub        # 复制整行 → https://github.com/settings/ssh/new
ssh -T git@github.com            # 应显示 Hi <你的用户名>!
```

### 3. 克隆代码

```bash
git clone git@github.com:zcq20070828/test-platform.git
cd test-platform
```

### 4. 一键配置环境（推荐）

```bash
chmod +x setup-dev-env.sh
DEV_DB_HOST=<负责人给的IP> DEV_AI_KEY=<负责人给的Key> ./setup-dev-env.sh
```

它会自动装依赖、生成 `.env`、填入开发库和 AI 配置、并验证数据库连通。

完成后启动（端口按你的编号错开）：

```bash
BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh
```

### 5. 手动配置（若不想用脚本）

```bash
cd backend && npm ci && cd ..
cd frontend && npm ci && cd ..
cp backend/.env.example backend/.env
```

在 `backend/.env` 里填：

```ini
PORT=3003                 # 你的专属后端端口，见附录「端口规划」
DB_HOST=<问负责人要当前地址>
DB_PORT=3306
DB_USER=appuser
DB_PASSWORD=apppwd123
DB_NAME=test_platform_dev
NODE_ENV=development
DEEPSEEK_API_KEY=<负责人私聊给你的 Key>
```

AI Key **不要写进任何入库的文件**（`.env.example`、脚本、文档都会被提交）。
向负责人索取共用 Key，然后任选一种方式配置：

```bash
# 方式一：跑脚本时传入（推荐，Key 不留痕）
DEV_AI_KEY=<Key> bash setup-dev-env.sh

# 方式二：写进本机环境变量（后续所有脚本自动带上）
echo 'export DEV_AI_KEY=<Key>' >> ~/.zshrc && source ~/.zshrc

# 方式三：直接编辑 backend/.env（此文件已被 .gitignore 排除，不会入库）
```

> ⚠️ **不要写死 DB_HOST**：负责人 Mac 的内网 IP 随其网络变化
> （例如 10-11 是 `192.168.43.4`，10-12 换网络后变成 `192.168.151.45`）。
> 用 `./setup-dev-env.sh` 会自动探测，或者向负责人要最新地址。
> 负责人自己执行 `./get-dev-db-host.sh` 可随时查看当前地址。

> **必读**：`backend/database/db.js` 只读 `process.env`，**不读 `.env` 文件**。
> 所以 `.env` 里改了 DB 配置后，必须用 `./start-dev.sh` 启动（它会把这些值注入进程环境），
> 或者在启动前手动 `set -a; source .env; set +a`；直接 `node server.js` 是不会生效的。

> `.env` 已在 `.gitignore` 中排除，**永远不会被提交**，放心填。

### 6. 启动开发环境

```bash
BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh   # 换成你的端口
./start-dev.sh status   # 查看运行状态（同样带上端口变量）
./start-dev.sh stop     # 停止
```

> 不设环境变量时默认 3002 / 5174（负责人的配置）。
> **同一台机器上不要和别人用同一组端口。**

---

## 二、日常开发流程

### 分支策略

```
main                ← 受保护，只接受合并，不直接 push
  └─ feature/2026-10-12-xxx-yyy   ← 你的日常分支
```

命名规范：`feature/YYYY-MM-DD-简短描述`

例：`feature/2026-10-12-security-preview-hours`

### 一天的完整流程

```bash
# 1. 开工：拉最新代码，从最新 main 开新分支
git checkout main
git pull origin main
git checkout -b feature/2026-10-12-my-task

# 2. 干活……改代码

# 3. 提交（提交信息用中文，说清做了什么）
git add -A
git commit -m "feat(安全): 预览时长校验增加上限保护"

# 4. 推送自己的分支
git push -u origin feature/2026-10-12-my-task

# 5. 收工：合回 main 并推送
git checkout main
git merge --no-ff feature/2026-10-12-my-task
git push origin main
```

### 提交信息规范

沿用项目现有格式：`<类型>(<模块>): <说明>`

| 类型 | 用于 |
|---|---|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `refactor` | 重构（不改行为） |
| `docs` | 文档 |
| `test` | 测试相关 |
| `chore` | 构建/配置等杂项 |

示例：
```
feat(执行通道): 新增免脚本直执通道
fix(UI/E2E): 任务创建 500 根因修复 - input 列扩容
refactor(DB): 全库 TEXT 列统一扩容
```

---

## 三、数据库纪律（最容易出乱子，务必遵守）

**当前模式：所有人的本地后端连同一台开发库。**

| 项 | 值 |
|---|---|
| 库地址 | 负责人 Mac 的内网 IP `:3306`（**IP 会随其网络变化，用 `./get-dev-db-host.sh` 查当前值**） |
| 库名 | `test_platform_dev`（**不是** `test_platform`） |
| 账号 | `appuser` / `apppwd123` |
| 克隆来源 | `test_platform`（42 张表结构，空数据） |

> **前提**：你必须和负责人在**同一个局域网**。地址是内网 IP，不通时找负责人确认最新地址。
> 负责人换网络后 IP 会变，改动无需改代码 —— 重跑 `./setup-dev-env.sh` 即可重新探测。

### 能做的

- 随意查询数据（SELECT）
- 增删改业务数据（测试数据随便造）

### 不能直接做的

- **不要直接 `ALTER TABLE` 改表结构。**

原因：你改了，同事的后端还在按旧结构跑，会突然报错；而同事可能正在调试同一张表。

### 绝对不要碰的

- 🚫 **不要连 `test_platform` 库**（负责人本机在用的正式开发库，443 条历史任务在里面）
- 🚫 **不要碰腾讯云生产库**（`42.194.137.114`上的 `test_platform`）

你的 `.env` 里 `DB_NAME` 必须是 `test_platform_dev`。填错了就是在动不该动的数据。

### 正确做法（改表结构）

1. 把变更写成脚本，放到 `backend/migrations/`，命名 `YYYYMMDD_描述.sql`：

   ```sql
   -- 20261012_add_preview_hours.sql
   -- 需求：预览时长增加上限字段
   ALTER TABLE security_tasks ADD COLUMN preview_hours_limit INT DEFAULT 24
     COMMENT '预览时长上限(小时)';
   ```

2. 提交这个脚本到你的 feature 分支
3. 在群里/提交说明里告知「本分支含表结构变更，需在 main 执行 `20261012_add_preview_hours.sql`」
4. 由负责人统一在开发库执行

---

## 四、端口规划（各人错开，避免冲突）

端口只影响你自己，不影响别人，但同一台机器上多人要错开：

| 人员 | 后端 PORT | 前端端口 |
|---|---|---|
| 负责人 | 3002 | 5174 |
| 成员 A | 3003 | 5175 |
| 成员 B | 3004 | 5176 |
| 成员 C | 3005 | 5177 |

改法：
- 后端 → `.env` 里 `PORT=3889`
- 前端 → `./start-dev.sh` 启动前 `export FRONTEND_PORT=5175`，或直接改脚本顶部默认值

---

## 五、代码资产同步（重要）

项目里有两个目录是**团队共享资产**，多人协作时要特别小心：

| 目录 | 内容 | 冲突风险 |
|---|---|---|
| `qclaw-agents/` | 19 个智能体（提示词、角色定义） | **高** —— 多人改不同智能体时容易互相覆盖 |
| `qclaw-skills/` | 技能库 | **高** —— 同上 |
| `frontend/src/` | 前端代码 | 中 |
| `backend/services/` | 后端服务 | 中 |

### 避免覆盖别人的智能体

1. **动手前先同步**：`git pull origin main`
2. **一次只改一个智能体目录**，不要一次改多个
3. **合并前看清冲突**：如果同事也改了同一个智能体，git 会提示冲突，此时**先沟通**再改，不要直接覆盖

---

## 六、安全红线（务必遵守）

1. **生产环境（aitestplatform.com.cn:8443）不直接改源码**
   - 生产只跑构建产物；代码问题回本地修，走部署流程
   - 本仓库（`/opt/git/`）与生产部署目录（`/opt/test-platform/`）完全隔离，互不影响

2. **不擅自执行部署、build**
   - 需要部署时由负责人统一安排

3. **`.env` 绝不入库**
   - 已在 `.gitignore` 排除；若误提交，立即 `git rm --cached backend/.env` 并改密码

4. **不要 force push 到 main**
   - 用 `--no-ff` 合并，保留历史，便于追溯

5. **`dev` 账号不是 root**
   - 它只能做 git 操作，不要尝试用 root 密码做仓库操作

6. **数据库只碰 `test_platform_dev`**
   - `test_platform`（负责人本机正式库，443 条历史任务）和腾讯云生产库都不属于你
   - 弱口令 `apppwd123` 只在可信内网使用，不要把开发库端口映射到公网

---

## 七、常见问题

**Q：`git push` 一直卡住不动？**
A：大概率是 SSH 连不上。先跑 `ssh -T git@github.com` 确认输出 `Hi <你的用户名>!`；不通说明公钥没加到 GitHub，或网络需要代理。详见 `ONBOARDING.md` 第 3 章。

**Q：`fatal: not a git repository`？**
A：不在项目目录内。`cd` 到含 `.git` 的目录再执行。

**Q：拉代码时提示 `Permission denied (publickey)`？**
A：你的公钥还没加到 GitHub 账号。执行 `cat ~/.ssh/id_ed25519.pub`，把整行粘贴到 <https://github.com/settings/ssh/new>。

**Q：改了 `.env` 的数据库配置但不生效？**
A：项目**不用 dotenv**，`backend/database/db.js` 只读 `process.env`。所以必须用 `./start-dev.sh` 启动（脚本会注入配置），直接 `node server.js` 不生效。改完记得 `./start-dev.sh restart`。

**Q：连不上开发库？**
A：开发库在负责人 Mac 上，IP 会随其换网络而变。
① `ping <地址>` 不通 → 问负责人要当前地址（负责人执行 `./get-dev-db-host.sh` 就能看到）
② 拿到新地址后改 `.env` 的 `DB_HOST`，或直接 `DEV_DB_HOST=<新地址> bash setup-dev-env.sh` 重跑
③ 仍不通 → 确认负责人 Mac 上 MariaDB 在跑（`brew services list | grep maria`）

**Q：AI 报 401 / 调用失败？**
A：确认 `.env` 里 `DEEPSEEK_API_KEY` 填对了。这个 Key 是共用的，如果失效找负责人。

**Q：同事推的代码我拉不到？**
A：`git fetch origin` 更新远程引用，再 `git pull origin main`。

**Q：本地数据库连不上？**
A：先看 `./start-dev.sh status` 的健康检查输出，再确认 `.env` 里 `DB_NAME=test_platform_dev`（不能是 `test_platform`）。

**Q：改了 `.env` 不生效？**
A：改完需重启后端：`./start-dev.sh restart`。

---

## 八、联系人

| 事项 | 找谁 |
|---|---|
| 仓库权限申请 | 赵成庆 |
| 开发库地址 / AI Key | 赵成庆 |
| 表结构变更执行 | 赵成庆 |
| 生产环境问题 | 赵成庆（不要自行操作生产） |

---

**文档版本**：v1.1（2026-10-19 迁移至 GitHub，补充端口覆盖说明）
**仓库地址**：<https://github.com/zcq20070828/test-platform>
**小白版接入指南**：[`ONBOARDING.md`](ONBOARDING.md)