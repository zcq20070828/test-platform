# 测试中台 · Git 仓库授权与上手手册

> 面向两类人：
> - **授权方**（赵成庆 / 项目负责人）：给新同事开通仓库权限
> - **被授权方**（新加入的研发）：拿到权限后在自己的电脑上配置环境
>
> 仓库地址：`testplatform-git:/opt/git/test-platform.git`（腾讯云 `42.194.137.114`）
>
> 相关文档：
> - `COLLABORATION.md` —— 日常协作规范（分支策略、数据库纪律、代码资产冲突）
> - `add-collaborator.sh` —— 授权方一键登记脚本
> - `setup-dev-env.sh` —— 被授权方一键配置环境脚本

---

# 第一部分：授权方操作（负责人执行）

## 步骤 1：拿到新同事的 SSH 公钥

让同事在自己的 Mac 上执行：

```bash
# 如果还没有密钥，先生成
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "姓名@workbuddy"

# 把输出发给负责人
cat ~/.ssh/id_ed25519.pub
```

发过来的是**一整行**，长这样：

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... 姓名@workbuddy
```

> 顺便让同事把**指纹**也发来（用于核对，防止传输中被篡改）：
> ```bash
> ssh-keygen -lf ~/.ssh/id_ed25519.pub
> ```
> 输出形如 `SHA256:MnglUvNLLElFNzJwgIknilA9wLkJH2RtNv5FXYmiROw zhaochengqing@workbuddy (ED25519)`

## 步骤 2：一键登记（推荐）

在项目根目录执行：

```bash
./add-collaborator.sh 张三
```

脚本会输出三段内容：SSH 配置段、服务器登记命令、验证命令。

> ⚠️ **脚本会读取你本机的公钥**。如果你是给自己登记别人的密钥，
> 请直接照抄下面【步骤 3】的手工方式，把对方的公钥粘进去。

## 步骤 3：服务器登记（手工方式，等价于步骤 2）

在**你自己的 Mac** 上执行（会提示输入服务器 root 密码）：

```bash
ssh root@42.194.137.114
```

登录后，在服务器上执行：

```bash
# 1. 准备目录
mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh
touch /home/dev/.ssh/authorized_keys && chmod 600 /home/dev/.ssh/authorized_keys

# 2. 把下面这行里的 <粘贴对方公钥> 替换成同事发来的完整公钥
echo 'command="/usr/local/bin/git-force-wrapper",no-port-forwarding,no-X11-forwarding,no-pty <粘贴对方公钥>' >> /home/dev/.ssh/authorized_keys

# 3. 修权限
chown -R dev:dev /home/dev/.ssh
chmod 700 /home/dev/.ssh && chmod 600 /home/dev/.ssh/authorized_keys
```

**验证登记成功**：

```bash
# 应该能看到多出来的条目（末尾是公钥注释，通常是姓名）
awk '{print NR": "$NF}' /home/dev/.ssh/authorized_keys
```

## 步骤 4：核对指纹（防篡改）

```bash
# 服务器上该公钥的指纹
ssh-keygen -lf /home/dev/.ssh/authorized_keys
```

把输出里的指纹与同事发给你的指纹比对，**一致才算登记正确**。

## 步骤 5：回话给同事

告诉同事：

> 授权好了，你现在按第二部分操作。仓库地址：
> `testplatform-git:/opt/git/test-platform.git`

---

# 第二部分：被授权方操作（新同事执行）

## 前置条件

| 项 | 要求 |
|---|---|
| 网络 | **必须和负责人在同一个局域网**（开发库在 `192.168.43.4`） |
| 工具 | Mac / Linux + Git + Node.js 18+ |
| 收到 | 负责人已把你的公钥登记到服务器 |

> 先验证网络：`ping 192.168.43.4` 通不通。不通先解决网络，后面都做不了。

## 步骤 1：配置 SSH

编辑 `~/.ssh/config`（**追加**，不要覆盖你已有的内容）：

```
Host testplatform-git
    HostName 42.194.137.114
    User dev
    Port 22
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    PreferredAuthentications publickey
    BatchMode yes
    StrictHostKeyChecking accept-new
```

然后：

```bash
chmod 600 ~/.ssh/config
```

> `BatchMode yes` 很重要：不加它，git 挂起时会反复等密码输入，表现为「push 一直卡住」。

**验证**（用这个，不要直接 ssh 跑 git-upload-pack，那个会因协议握手报 `fatal: bad argument`）：

```bash
git ls-remote testplatform-git:/opt/git/test-platform.git
```

看到一批 `refs/heads/...` 分支列表就说明身份验证通过。

## 步骤 2：克隆代码

```bash
git clone testplatform-git:/opt/git/test-platform.git
cd test-platform
```

看到 `Cloning into 'test-platform'...` 且无报错即成功。

## 步骤 3：配置环境（一键）

```bash
chmod +x setup-dev-env.sh
./setup-dev-env.sh
```

它会自动完成：检查 Node → 安装前后端依赖 → 生成 `backend/.env` 并填入开发库和 AI 配置 → 验证数据库连通。

**期望输出**：

```
✓ Node: v22.x.x
✓ 后端依赖就绪
✓ 前端依赖就绪
✓ 已从 .env.example 复制
✓ 已写入开发库与 AI 配置
✓ 开发库可连接（test_platform_dev，共 42 张表）
```

> 如果第 4 步报「连不上开发库」，看本文末尾的故障排查。

## 步骤 4：启动开发环境

```bash
./start-dev.sh
```

**期望输出**：

```
✅ 后端  http://localhost:3888  → 200
{"status":"ok","agents":18,"tasks":0}
✅ 前端  http://localhost:5174/  → 200
```

看到 `tasks:0` 是正常的 —— 开发库是空的。

打开浏览器访问 <http://localhost:5174> 即可。

## 步骤 5：改端口（如果和你自己的其他服务冲突）

同一台机器上多人或已有服务占用时，先查端口：

```bash
lsof -iTCP:3888 -sTCP:LISTEN    # 后端端口
lsof -iTCP:5174 -sTCP:LISTEN    # 前端端口
```

改法：

| 改什么 | 怎么改 |
|---|---|
| 后端 | `backend/.env` 里 `PORT=3889`（或其他空闲端口） |
| 前端 | `start-dev.sh` 顶部 `FRONTEND_PORT=5175` |

改完必须 `./start-dev.sh restart`。

## 步骤 6：开始干活

标准 Git 流程：

```bash
# 开工
git checkout main && git pull origin main
git checkout -b feature/2026-10-12-我的任务

# 干活……

# 提交
git add -A
git commit -m "feat(模块): 做了什么"

# 推送自己的分支
git push -u origin feature/2026-10-12-我的任务

# 收工合回 main
git checkout main
git merge --no-ff feature/2026-10-12-我的任务
git push origin main
```

提交信息格式：`<类型>(<模块>): <说明>`，类型用 `feat` / `fix` / `refactor` / `docs` / `test` / `chore`。

---

# 第三部分：日常协作规范

## 数据库纪律（最容易出乱子）

| 项 | 值 |
|---|---|
| 库地址 | `192.168.43.4:3306` |
| 库名 | `test_platform_dev`（**空库，42 张表结构**） |
| 账号 | `appuser` / `apppwd123` |

**能做的**：随便查、随便造测试数据。

**不能做的**：

- 🚫 不要连 `test_platform`（负责人本机正式库，443 条历史任务）
- 🚫 不要碰腾讯云生产库
- 🚫 不要直接 `ALTER TABLE` 改表结构

**改表结构的正确流程**：

1. 写脚本到 `backend/migrations/YYYYMMDD_描述.sql`
2. 提交到 feature 分支
3. 告知负责人「本分支含表结构变更，需执行 xxx.sql」
4. 由负责人统一执行

## 代码资产冲突高发区

| 目录 | 风险 |
|---|---|
| `qclaw-agents/`（19 个智能体） | **高** —— 多人改不同智能体容易互相覆盖 |
| `qclaw-skills/` | **高** —— 同上 |

避免冲突：

1. 动手前先 `git pull origin main`
2. 一次只改一个智能体目录
3. 合并遇到冲突**先沟通**，不要直接覆盖

## 安全红线

1. 生产环境不直接改源码，问题回本地修
2. 不擅自部署 / build（需负责人统一安排）
3. `.env` 绝不入库（已在 `.gitignore` 排除）
4. 不 force push 到 main（用 `--no-ff`）
5. 数据库弱口令仅限可信内网，**不要映射到公网**

---

# 第四部分：故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| `Permission denied (publickey)` | 你的公钥没被登记 | 把 `cat ~/.ssh/id_ed25519.pub` 发给负责人 |
| `git push` 一直卡住出 `git>` | 缺 `BatchMode yes` | 检查 `~/.ssh/config` 里该别名是否有这行 |
| `fatal: not a git repository` | 不在项目目录 | `cd` 到含 `.git` 的目录 |
| 连不上开发库 | 不同网络 / IP 变了 | `ping 192.168.43.4`；不通则问负责人最新 IP |
| 改了 `.env` 不生效 | 项目不读 `.env` 文件 | 必须用 `./start-dev.sh` 启动，然后 `restart` |
| AI 调用 401 | Key 失效 | 找负责人 |
| 端口被占用 | 本机其他服务 | 改 `PORT` / `FRONTEND_PORT` 后 restart |

> **重要提示**：`backend/database/db.js` 只读 `process.env`，**不读 `.env` 文件**。
> 所以改完 `.env` 必须 `./start-dev.sh restart`，直接 `node server.js` 不生效。

---

## 附：当前授权清单

| 人员 | 公钥指纹 | 状态 |
|---|---|---|
| 赵成庆 | `SHA256:MnglUvNLLElFNzJwgIknilA9wLkJH2RtNv5FXYmiROw` | 已授权 |

**新增授权时**，在上表补一行即可。

---

**文档版本**：v1.0（2026-10-11）
**仓库**：`testplatform-git:/opt/git/test-platform.git`
**联系人**：赵成庆