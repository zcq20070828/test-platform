# 测试中台 · 新成员开发接入指南（小白版）

> 这份文档假设你**从来没做过多人协作开发**。
> 按顺序从上往下做，每条命令都可以直接复制粘贴到终端里执行。
> 每一步都写了「你应该看到什么」，对不上就跳到最后一章「常见问题」。

---

## 目录

- [0. 先搞清楚三件事](#0-先搞清楚三件事)
- [1. 安装基础软件](#1-安装基础软件)
- [2. 注册 GitHub 并接受邀请](#2-注册-github-并接受邀请)
- [3. 配置 SSH 密钥（配一次，以后不用管）](#3-配置-ssh-密钥配一次以后不用管)
- [4. 把代码拉到本地](#4-把代码拉到本地)
- [5. 安装项目依赖（约 520MB）](#5-安装项目依赖约-520mb)
- [6. 配置后端环境变量](#6-配置后端环境变量)
- [7. 准备数据库](#7-准备数据库)
- [8. 启动项目](#8-启动项目)
- [9. 验证是否跑起来了](#9-验证是否跑起来了)
- [10. 日常开发流程（每天都要用）](#10-日常开发流程每天都要用)
- [11. 常见问题排查](#11-常见问题排查)
- [12. 绝对不能做的事](#12-绝对不能做的事)
- [附录 A：项目目录是干什么的](#附录-a项目目录是干什么的)
- [附录 B：端口规划](#附录-b端口规划)
- [附录 C：可选组件（不影响主流程）](#附录-c可选组件不影响主流程)

---

## 0. 先搞清楚三件事

**第一，这个项目是什么。**
一个前后端分离的「AI 测试中台」：

- 前端：Vue 3 + Vite + Element Plus（界面）
- 后端：Node.js + Express（API 服务）
- 数据库：MySQL / MariaDB
- 另外还有一批 Python 脚本，用于文档解析和知识库向量检索（可选）

**第二，代码在哪。**
GitHub 仓库：<https://github.com/zcq20070828/test-platform>

**第三，你需要向负责人要三样东西。**

| 东西 | 用途 | 怎么给你 |
|---|---|---|
| 仓库邀请 | 让你能把代码推上去 | GitHub 邮件邀请 |
| 开发库地址（IP） | 连团队共用的开发数据库 | 私聊发你 |
| DeepSeek API Key | 让 AI 功能能用 | 私聊发你 |

> ⚠️ **Key 和密码只能私聊发，绝对不能发到群里，更不能写进任何会被提交的文件。**

---

## 1. 安装基础软件

打开「终端」（macOS 上按 `Command + 空格`，输入 `Terminal` 回车）。

### 1.1 检查 Git

```bash
git --version
```

**应该看到**：`git version 2.x.x` 之类。

- 如果提示 `command not found`，说明没装：
  - macOS：终端执行 `xcode-select --install`，弹窗点「安装」
  - Windows：去 <https://git-scm.com/download/win> 下载安装，装完用「Git Bash」当终端
  - Ubuntu/Debian：`sudo apt install git`

### 1.2 安装 Node.js（版本必须 ≥ 20.19 或 ≥ 22.12）

```bash
node -v
```

**应该看到**：`v20.19.x`、`v22.12.x`、`v24.x` 之类。

- 如果版本太老或没装，**推荐用 nvm 管理**（以后切换版本方便）：

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# 让 nvm 生效（或者关掉终端重新打开）
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# 安装并使用 Node 22
nvm install 22
nvm use 22
node -v
```

- 不想用 nvm 的话，去 <https://nodejs.org/zh-cn> 下载 LTS 版本安装包，双击安装即可。

### 1.3 检查 npm

```bash
npm -v
```

**应该看到**：`10.x` 或 `11.x`。npm 随 Node 一起安装，一般不用单独装。

### 1.4（可选）安装 MySQL 客户端

只有你需要**自己连数据库查数据**时才需要。启动项目本身不强制要求装。

```bash
mysql --version
```

macOS 安装：

```bash
brew install mysql-client
```

> 如果提示没有 `brew`，先装 Homebrew：<https://brew.sh/>

### 1.5（可选）安装 Python 3

只有要用「知识库文档解析」和「向量检索」功能时才需要，不装也能正常启动项目。

```bash
python3 --version
```

**应该看到**：`Python 3.9` 以上。

---

## 2. 注册 GitHub 并接受邀请

### 2.1 没有账号就先注册

打开 <https://github.com/signup>，用邮箱注册一个账号。

> 记住你的**用户名**（比如 `zhangsan`），后面配置要用。

### 2.2 把用户名发给负责人

负责人会在仓库的 `Settings → Collaborators` 里邀请你。

### 2.3 接受邀请

你会收到一封邮件，标题类似 `[GitHub] @zcq20070828 invited you to collaborate`。

点邮件里的 **View invitation** → 在网页上点 **Accept invitation**。

**应该看到**：能打开 <https://github.com/zcq20070828/test-platform> 并且能看到代码。

> 这个仓库目前是公开的，不邀请也能看代码、也能 clone。
> 但**推送代码必须被邀请**，所以这一步不能省。

---

## 3. 配置 SSH 密钥（配一次，以后不用管）

GitHub 需要确认「推代码的人是你」，SSH 密钥就是你的身份证。
**只需要配置一次**，以后再也不用了。

### 3.1 生成密钥

```bash
ssh-keygen -t ed25519 -C "你的邮箱@example.com"
```

执行后会问你三个问题，**全部直接按回车**：

```
Enter file in which to save the key (/Users/你/.ssh/id_ed25519):     ← 回车
Enter passphrase (empty for no passphrase):                          ← 回车（不设密码更方便）
Enter same passphrase again:                                         ← 回车
```

**应该看到**：终端打印出一堆字符画和 `Your identification has been saved...`。

> 如果提示 `... already exists. Overwrite (y/n)?`，说明你之前生成过密钥，**输入 `n` 回车**跳过生成，直接用现有的（跳到 3.2）。

### 3.2 查看公钥内容

```bash
cat ~/.ssh/id_ed25519.pub
```

**应该看到**：一行以 `ssh-ed25519 AAAA...` 开头的文字，最后是你的邮箱。

**完整复制这一整行**（从 `ssh-ed25519` 到最后，不要漏字符）。

### 3.3 把公钥加到 GitHub

1. 打开 <https://github.com/settings/ssh/new>
2. **Title** 随便填，比如 `我的 MacBook`
3. **Key** 粘贴刚才复制的那一整行
4. 点 **Add SSH key**

### 3.4 验证配置成功

```bash
ssh -T git@github.com
```

第一次会问：

```
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

输入 `yes` 回车。

**应该看到**：

```
Hi 你的用户名! You've successfully authenticated, but GitHub does not provide shell access.
```

看到 `Hi 你的用户名!` 就说明成功了。如果看到 `Permission denied (publickey)`，说明公钥没粘贴成功，回到 3.3 重做。

---

## 4. 把代码拉到本地

### 4.1 选一个放代码的目录

建议放在用户主目录下的 `code` 或 `projects` 文件夹：

```bash
mkdir -p ~/code
cd ~/code
```

### 4.2 克隆仓库

```bash
git clone git@github.com:zcq20070828/test-platform.git
```

**应该看到**：

```
Cloning into 'test-platform'...
remote: Enumerating objects: ...
Receiving objects: 100% ...
```

**克隆完成后检查**：

```bash
cd test-platform
ls
```

**应该看到**这些文件和目录：

```
COLLABORATION.md  GIT-ACCESS-GUIDE.md  MIGRATION.md  NEW-MEMBER-ONBOARDING.md
ONBOARDING.md  backend  database  deploy  frontend  qclaw-agents  qclaw-skills
setup-dev-env.sh  start-dev.sh  等等
```

### 4.3 确认在 main 分支

```bash
git branch
```

**应该看到**：`* main`

### 4.4 设置你的 Git 身份（只需一次）

```bash
git config --global user.name "你的名字"
git config --global user.email "你的GitHub邮箱"
```

> 邮箱最好用你 GitHub 账号绑定的邮箱，这样提交记录才会关联到你的头像。

---

## 5. 安装项目依赖（约 520MB）

这个项目分前端和后端两个独立的 Node 项目，**两边都要装**。

> 为什么不在仓库里直接带着依赖？因为 `node_modules` 有 500 多 MB，
> 而且里面含各平台专用的二进制文件，别人电脑上不一定能用。
> 所以仓库只记录「需要哪些包、什么版本」（`package.json` + `package-lock.json`），
> 你本地用命令还原出来。

### 5.1 安装后端依赖（约 170MB）

```bash
cd ~/code/test-platform/backend
npm ci
```

**这一步可能要 1～3 分钟**，会下载 express、mysql2、bcrypt、playwright 等包。

**应该看到**最后一行类似：

```
added 300 packages in 60s
```

> 如果卡在 `bcrypt` 或 `playwright` 报错，看第 11 章「常见问题」。

### 5.2 安装前端依赖（约 350MB）

```bash
cd ~/code/test-platform/frontend
npm ci
```

**应该看到**：

```
added 400 packages in 90s
```

### 5.3 确认安装成功

```bash
ls ~/code/test-platform/backend/node_modules | head
ls ~/code/test-platform/frontend/node_modules | head
```

两个命令都应该列出目录名（`express`、`vue` 之类），而不是报 `No such file or directory`。

> ⚠️ 一定要用 `npm ci`，不要用 `npm install`。
> `ci` 严格按锁定版本安装，保证所有人环境一致；
> `install` 可能会偷偷升级版本，导致「我这儿好的你那儿报错」。

---

## 6. 配置后端环境变量

后端需要知道数据库在哪、AI Key 是什么。这些配置放在 `backend/.env` 文件里。

> `.env` 已经被 `.gitignore` 排除，**永远不会被提交**，所以可以放心写密码。

### 6.1 复制配置模板

```bash
cd ~/code/test-platform/backend
cp .env.example .env
```

### 6.2 用文本编辑器打开 `.env`

macOS 没有 VS Code 的话可以用自带的：

```bash
open -e .env
```

（如果你装了 VS Code：`code .env`）

### 6.3 修改下面这几行

找到对应行，把值改成你的情况：

```ini
# ---------- 服务器 ----------
PORT=3003                 ← 改成你的专属端口（见附录 B，别和别人重复）
NODE_ENV=development      ← 保持 development

# ---------- 数据库（连负责人的开发库） ----------
DB_HOST=192.168.x.x       ← 改成负责人给你的 IP
DB_PORT=3306              ← 不变
DB_USER=appuser           ← 不变
DB_PASSWORD=apppwd123     ← 不变（负责人如果改了会告诉你）
DB_NAME=test_platform_dev ← 必须是这个，绝对不能填 test_platform

# ---------- AI ----------
DEEPSEEK_API_KEY=sk-xxxx  ← 负责人私聊发给你的 Key
```

保存并关闭文件。

### 6.4 验证配置有没有写对

```bash
grep -E "^(PORT|DB_HOST|DB_NAME|DEEPSEEK_API_KEY)=" .env
```

**应该看到**你刚填的值。注意 `DEEPSEEK_API_KEY` 那一行后面不能有引号和空格。

> 提示：`.env.example` 里有详细的注释，看不懂哪一行就别动它。

---

## 7. 准备数据库

后端所有数据（用户、任务、报告）都存在 MySQL 里，**没有数据库登录都进不去**。

### 方式 A（推荐）：连团队共用的开发库

这是最省事的方式，负责人机器上跑着一个开发库，所有人连同一个。

**前提**：你和负责人在**同一个局域网**（连同一个 WiFi / 同一个公司网络）。

**第 1 步**：确认 `backend/.env` 里的 `DB_HOST` 是负责人给你的 IP。

**第 2 步**：测试能不能连上：

```bash
cd ~/code/test-platform/backend
mysql -h 负责人的IP -u appuser -papppwd123 -e "SELECT COUNT(*) FROM users;" test_platform_dev
```

**应该看到**：

```
+----------+
| COUNT(*) |
+----------+
|        1 |
+----------+
```

能查出数字就说明通了。

**如果报错**：

- `Can't connect to MySQL server` → 不在同一网络，或者 IP 填错了，找负责人重新要
- `Access denied for user` → 密码错了
- `Unknown database 'test_platform_dev'` → 库名填错了

**第 3 步**：什么都不用做，数据库已经有人建好了，直接用。

### 方式 B：在自己电脑上建一个数据库（进阶）

适合「不想依赖负责人电脑」的情况。**下面 4 步可以完全照抄执行。**

**第 1 步**：安装 MySQL 或 MariaDB。

macOS：

```bash
brew install mariadb
brew services start mariadb
```

Windows：去 <https://dev.mysql.com/downloads/installer/> 下载安装，一路默认即可。
Ubuntu/Debian：`sudo apt install mariadb-server && sudo systemctl start mariadb`

**第 2 步**：用仓库里自带的脚本建库建表（42 张表，已验证可直接导入）。

```bash
cd ~/code/test-platform
mysql -u root -p < database/00-schema-full.sql
```

> 输入你本机 MySQL 的 root 密码，回车。
> 脚本会自动创建 `test_platform_dev` 库、42 张表、字符集 utf8mb4。

**第 3 步**：给这个库创建一个应用账号（和后端默认配置一致）。

```bash
mysql -u root -p -e "
CREATE USER IF NOT EXISTS 'appuser'@'localhost' IDENTIFIED BY 'apppwd123';
GRANT ALL PRIVILEGES ON test_platform_dev.* TO 'appuser'@'localhost';
FLUSH PRIVILEGES;"
```

**第 4 步**：导入默认账号（admin / test1 / testuser / tester2）。

```bash
cd ~/code/test-platform
mysql -u appuser -papppwd123 test_platform_dev < database/02-init-data-incremental.sql
```

**第 5 步**：把 `backend/.env` 里的数据库配置改成连本机。

```ini
DB_HOST=localhost       ← 从负责人 IP 改成 localhost
DB_NAME=test_platform_dev
DB_USER=appuser
DB_PASSWORD=apppwd123
```

**验证**：

```bash
mysql -u appuser -papppwd123 -e "SELECT username FROM users;" test_platform_dev
```

**应该看到** `admin`、`test1`、`testuser`、`tester2` 四个账号。

> ✅ 说明：`database/00-schema-full.sql` 是从团队开发库导出的完整结构，不包含任何真实业务数据。
> `database/01-schema-incremental.sql` 是历史增量脚本（给已有旧库补表用），**新建库不要用它**。

---

## 8. 启动项目

前端和后端是**两个独立的程序**，要开**两个终端窗口**分别启动。

> 💡 想省事的话，也可以用项目自带的一键脚本，直接跳到 [8.3 用脚本启动](#83可选用一键脚本启动)。
> 但第一次建议按 8.1、8.2 手动启一遍，出问题更容易定位。

### 8.1 手动启动（推荐第一次用）

#### 8.1.1 打开第一个终端 —— 启动后端

```bash
cd ~/code/test-platform/backend

# 把 .env 里的配置读进当前终端环境（后端读数据库配置依赖这一步）
set -a
source .env
set +a

# 启动后端
npm run dev
```

**应该看到**（关键几行）：

```
[Deepseek] API Key: sk-xxxxxxxxxxxxxxxxxxxx***abcd
[Tasks] 从数据库加载了 4 个任务
[Users] 从数据库加载了 1 个用户

🦞 测试中台后端 API
   HTTP: http://localhost:3003
   WebSocket: ws://localhost:3003
   Agents: 18
   SSO: 未启用
   Ready to accept connections.
```

看到 `Ready to accept connections.` 就说明后端起来了。

**怎么判断数据库连上了**：看 `[Users] 从数据库加载了 N 个用户` 这一行。
如果 N ≥ 1，说明数据库通了；如果是 `0 个用户` 或者根本没有这一行，说明连的是空库或没连上。

> 第一次启动会有一堆 `[Warmup]` 日志在后台跑，属于正常现象，不影响使用。
> **这个终端不能关**，关掉后端就停了。

### 8.2 打开第二个终端 —— 启动前端

新开一个终端窗口（macOS：`Command + N`），执行：

```bash
cd ~/code/test-platform/frontend

# VITE_API_TARGET 告诉前端把 /api 请求转发到哪个后端端口
# 后面的 --port 是你的前端端口（见附录 B）
VITE_API_TARGET=http://localhost:3003 npm run dev -- --port 5175
```

> ⚠️ 如果你的后端端口不是 3003，把 `VITE_API_TARGET` 也改成对应端口。
> 两个端口必须对得上，否则页面能打开但数据加载不出来（报 502）。

**应该看到**：

```
VITE v8.x.x  ready in 1500 ms

➜  Local:   http://localhost:5175/
➜  Network: http://192.168.x.x:5175/
```

**这个终端也不能关。**

### 8.3（可选）用一键脚本启动

项目根目录有个 `start-dev.sh`，会自动完成「注入环境变量 + 起后端 + 起前端 + 健康检查」。

```bash
cd ~/code/test-platform

# 换成你的端口（不写默认是 3002 / 5174）
BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh
```

**应该看到**：

```
=== 启动测试中台 dev 环境 (WorkBuddy) ===
✅ 后端 已就绪
{"status":"ok","timestamp":"...","agents":18,"tasks":4}
✅ 前端 已就绪
✅ 后端  http://localhost:3003  → 200
     listener PID: 12345
✅ 前端  http://localhost:5175/  → 200
     listener PID: 12346
```

其他命令：

```bash
# 注意：status / stop / restart 也要带上同样的端口变量，
# 否则脚本会去找 3002/5174，找不到反而误报「未运行」
BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh status
BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh stop
BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh restart
```

> 嫌每次都要带变量麻烦？可以写一个别名到 `~/.zshrc`：
>
> ```bash
> echo 'alias tp-start="cd ~/code/test-platform/backend && set -a && source .env && set +a && cd .. && BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh"' >> ~/.zshrc
> source ~/.zshrc
> tp-start
> ```

---

## 9. 验证是否跑起来了

### 9.1 检查后端

在**第三个终端**（或者第一个终端按 `Command + T` 新开标签）执行：

```bash
curl http://localhost:3003/api/health
```

**应该看到**：

```json
{"status":"ok","timestamp":"2026-...","agents":18,"tasks":4}
```

看到 `"status":"ok"` 就说明后端正常。

> `tasks` 是数据库里已有的任务数。连团队开发库通常不是 0；连自己新建的空库就是 0。两个都正常。
> 但如果你的库应该是空的却显示 `tasks:443`，说明连到负责人的正式库了，立刻改 `DB_NAME`。

### 9.2 打开页面

浏览器访问：<http://localhost:5175>

**应该看到**：测试中台的登录页面。

### 9.3 登录

- 用户名：`admin`
- 密码：`admin123`

点登录。

**应该看到**：进入主界面，左侧有菜单栏。

> 如果登录报错「用户名或密码错误」，说明数据库里的账号不对。
> 连共用开发库的话找负责人确认；本地建库的话确认导入了 users 表数据。

### 9.4 检查数据能不能加载

在界面上随便点几个菜单（比如「任务管理」「智能体」）。

**应该看到**：列表能加载出来，不是一直转圈或空白。

如果一直转圈，打开浏览器开发者工具（`F12`）→ `Network` 标签，看 `/api/` 开头的请求是不是 502 —— 那是前端代理没指对后端端口，回到 8.2 检查 `VITE_API_TARGET`。

---

## 10. 日常开发流程（每天都要用）

### 10.1 每天开工前：先拉最新代码

```bash
cd ~/code/test-platform
git checkout main
git pull origin main
```

**应该看到**：`Already up to date.` 或者拉下来几个文件的更新。

### 10.2 开一个自己的分支

**不要直接在 main 上改代码。** 每天、每个任务都开一个新分支：

```bash
git checkout -b feature/2026-10-19-我的任务名
```

分支命名规则：`feature/年月日-简短描述`，例如：

- `feature/2026-10-19-fix-login-button`
- `feature/2026-10-19-add-report-export`

**应该看到**：`Switched to a new branch 'feature/2026-10-19-我的任务名'`

### 10.3 改代码、看效果

前端代码改了会自动刷新（Vite 热更新），不用重启。
后端代码改了需要重启后端：在第一个终端按 `Ctrl + C` 停掉，再 `npm run dev`。

### 10.4 提交代码

```bash
cd ~/code/test-platform
git status                 # 看看改了哪些文件
git add .                  # 把改动加进来
git commit -m "feat: 完成 XXX 功能"
```

提交信息用中文，说清做了什么。常用前缀：

| 前缀 | 含义 | 例子 |
|---|---|---|
| `feat:` | 新功能 | `feat: 新增报告导出按钮` |
| `fix:` | 修 bug | `fix: 修复登录页白屏` |
| `docs:` | 改文档 | `docs: 补充接入说明` |
| `chore:` | 杂活（依赖、配置） | `chore: 升级 vite 版本` |

### 10.5 推送到 GitHub

```bash
git push -u origin feature/2026-10-19-我的任务名
```

**应该看到**：

```
To github.com:zcq20070828/test-platform.git
 * [new branch]      feature/... -> feature/...
```

### 10.6 收工：合回 main

项目的约定是**自己合回 main**（不是提 Pull Request）：

```bash
git checkout main
git pull origin main                        # 先确保 main 是最新的
git merge --no-ff feature/2026-10-19-我的任务名
git push origin main
```

> `--no-ff` 会保留一条「这是从分支合并来的」记录，方便以后追溯。

### 10.7 合并前必看：冲突了怎么办

如果 `git merge` 输出 `CONFLICT`，说明你和同事改了同一个文件的同一处。

1. **先别慌，也别直接覆盖。** 打开冲突文件，会看到这样的标记：

```
<<<<<<< HEAD
同事的代码
=======
你的代码
>>>>>>> feature/...
```

2. 找同事沟通，决定保留哪一版（或者合并两版）
3. 手动编辑文件，把 `<<<<<<<`、`=======`、`>>>>>>>` 三行删掉，留下最终代码

4. 然后：

```bash
git add 冲突的文件
git commit
git push origin main
```

### 10.8 改数据库结构怎么办

**绝对不要直接在自己的库里 `ALTER TABLE` 然后就算了。** 按项目约定：

1. 在 `backend/migrations/` 下新建文件，命名 `YYYYMMDD_描述.sql`，例如 `20261019_add_export_status.sql`
2. 在里面写 `ALTER TABLE ...` 语句，要保证**可以重复执行不报错**（用 `IF NOT EXISTS` 或先查 INFORMATION_SCHEMA）
3. 提交这个文件到你的 feature 分支
4. 在提交说明或群里告诉负责人「这个分支有表结构变更」
5. 由负责人统一在 main 上执行

### 10.9 提交前自查清单

每次 `git add .` 之前，执行一次：

```bash
git status
```

**看到这些文件千万不要提交**（它们应该已经被 `.gitignore` 挡住了，但自己要确认）：

- `.env` / `.env.local` / 任何带密码的文件
- `node_modules/`
- `dist/`
- `runtime/`
- `*.log`
- `.DS_Store`

如果不小心把 `.env` 加进来了，立刻执行：

```bash
git restore --staged backend/.env
```

---

## 11. 常见问题排查

### Q1：`npm ci` 报 node 版本不对

```
npm ERR! engine Unsupported engine
```

**原因**：Node 版本太低。

**解决**：`nvm install 22 && nvm use 22`，然后重新 `npm ci`。

### Q2：装依赖时 `bcrypt` 编译失败

```
gyp ERR! stack Error: not found: make
```

**原因**：缺少编译工具。

**解决**（macOS）：

```bash
xcode-select --install
```

然后重新 `npm ci`。

### Q3：`npm ci` 卡住不动 / 下载很慢

**原因**：npm 默认源在国外。

**解决**：

```bash
npm config set registry https://registry.npmmirror.com
```

然后重新 `npm ci`。

### Q4：后端启动报 `ECONNREFUSED` 或 `Access denied`

**原因**：数据库连不上。

**排查顺序**：

1. 确认 `DB_HOST` 是负责人最新给你的 IP（负责人换网络后 IP 会变）
2. 确认你和负责人在同一个局域网
3. 用第 7 章的 `mysql` 命令单独测一下能不能连
4. 确认 `DB_NAME=test_platform_dev`（不是 `test_platform`）

### Q5：页面能打开，但数据一直加载不出来

**原因**：前端代理没指对后端端口。

**解决**：检查启动前端时的 `VITE_API_TARGET` 和后端实际端口是否一致。

```bash
# 看后端到底监听在哪个端口
lsof -nP -iTCP -sTCP:LISTEN | grep node
```

### Q6：端口被占用

```
Error: listen EADDRINUSE :::3003
```

**原因**：这个端口已经有别的程序在用。

**解决**：换一个端口（附录 B 里有空闲的），前后端两个端口一起换。

```bash
# 查看谁占用了 3003
lsof -nP -iTCP:3003 -sTCP:LISTEN
```

### Q7：登录提示用户名或密码错误

**原因**：数据库里没有默认账号，或者你连错了库。

**解决**：

```bash
mysql -h 你的DB_HOST -u appuser -papppwd123 -e "SELECT username FROM users;" test_platform_dev
```

**应该看到** `admin` 这个用户。如果没有，说明库不对，找负责人。

### Q8：AI 功能报错「未配置 DEEPSEEK_API_KEY」

**原因**：`backend/.env` 里的 Key 没填或填错。

**解决**：确认 Key 填在 `DEEPSEEK_API_KEY=` 后面，没有引号、没有空格，然后重启后端。

### Q9：文档解析 / 知识库功能报错 `python: command not found`

**原因**：没装 Python 或者路径不对。

**解决**：这属于可选功能，不影响主流程。要启用的话：

```bash
# 安装依赖
pip3 install mysql-connector-python python-docx openpyxl pdfplumber

# 找到 python3 的位置
which python3

# 把路径写进 backend/.env
PLATFORM_PYTHON_PATH=/opt/homebrew/bin/python3
```

然后重启后端。

### Q10：`git push` 报 `Permission denied (publickey)`

**原因**：SSH 没配好。

**解决**：重做第 3 章，然后：

```bash
ssh -T git@github.com
```

必须看到 `Hi 你的用户名!` 才能推送。

### Q11：`git push` 报 `rejected - non-fast-forward`

**原因**：你本地落后于远程（同事推了新代码）。

**解决**：

```bash
git pull --rebase origin main
git push origin main
```

如果是自己的 feature 分支报这个错，可能是你之前推过又改写了历史（比如 rebase），可以强制推自己的分支（**只能对自己的分支用**）：

```bash
git push --force-with-lease origin feature/你的分支名
```

### Q12：完全搞乱了，想重新来一遍

```bash
cd ~/code
rm -rf test-platform
git clone git@github.com:zcq20070828/test-platform.git
cd test-platform
```

然后从第 5 章重新装依赖、第 6 章重新配 `.env`。

> 你改的代码如果还没提交就删了，就没了。
> 重新来之前先确认没有未提交的重要改动（`git status` 看一眼）。

---

## 12. 绝对不能做的事

### ❌ 不要提交 `.env` 或任何密钥

仓库里有自动化扫描，一旦提交了 API Key，GitHub 会**直接拒绝推送**，而且历史里会永久留下记录。

- 密码、Key 只放在 `backend/.env`（已被忽略）
- 协作文档里只写 `sk-xxx` 这种占位符
- 需要共享 Key 时私聊，不要贴群、不要写进代码注释

### ❌ 不要在 main 上直接改代码

main 是大家的公共分支。所有改动走 feature 分支，改完再合回来。

### ❌ 不要提交这些目录

```
node_modules/    依赖，每个人自己 npm ci
dist/            构建产物，npm run build 生成
runtime/         本地运行数据
*.log            日志
.DS_Store        macOS 系统文件
```

### ❌ 不要直接 `ALTER TABLE` 然后不写迁移脚本

表结构变更必须写成 `backend/migrations/YYYYMMDD_描述.sql`，由负责人统一执行。

### ❌ 不要一个人改多个智能体目录

`qclaw-agents/` 下有 19 个智能体，每个人一次只改自己负责的那一个，避免和同事冲突。

### ❌ 不要 `git push --force` 到 main

会覆盖掉同事的提交。只有自己的 feature 分支可以 force push，而且推荐用 `--force-with-lease`。

---

## 附录 A：项目目录是干什么的

```
test-platform/
├── backend/                后端服务（Node.js + Express）
│   ├── server.js           主服务文件（很大，1 万多行）
│   ├── database/           数据库连接封装
│   ├── services/           业务服务
│   ├── migrations/         数据库变更脚本（改表结构写这里）
│   ├── vector/             知识库向量检索（Python）
│   ├── llm/                大模型调用封装
│   └── .env                你的本地配置（不提交）
│
├── frontend/               前端界面（Vue 3 + Vite）
│   ├── src/
│   │   ├── views/          各个页面
│   │   ├── components/     可复用组件
│   │   ├── stores/         全局状态管理
│   │   ├── api/            后端接口封装
│   │   └── router/         路由配置
│   ├── tests/e2e/          Playwright 端到端测试
│   └── vite.config.ts      前端构建配置
│
├── qclaw-agents/           19 个 AI 智能体（提示词 + 配置）
├── qclaw-skills/           技能库（各种测试执行器）
├── qclaw-knowledge-base/   知识库文档（需求文档、模板）
├── database/               数据库增量脚本
├── deploy/                 部署相关脚本
├── runtime/                本地运行数据（不提交）
│
├── start-dev.sh            一键启动脚本（自动注入 .env、起前后端、健康检查）
├── setup-dev-env.sh        新成员一键配置脚本（可选）
├── COLLABORATION.md        协作规范（分支、数据库纪律）
└── ONBOARDING.md           本文档
```

---

## 附录 B：端口规划

每个人用不同的端口，避免自己电脑上多个项目打架。
**找负责人要一个没被占用的编号**，或者按这个表：

| 人员 | 后端 PORT | 前端端口 |
|---|---|---|
| 负责人 | 3002 | 5174 |
| 成员 A | 3003 | 5175 |
| 成员 B | 3004 | 5176 |
| 成员 C | 3005 | 5177 |

改了端口以后，三处必须一致：

1. `backend/.env` 里的 `PORT`
2. 启动前端时的 `VITE_API_TARGET`（指向后端端口）
3. 启动前端时的 `--port`（前端自己的端口）

---

## 附录 C：可选组件（不影响主流程）

这些功能不装也能正常开发和调试主流程，需要时再弄。

### C1. 知识库文档解析

后端要把 `.docx` / `.xlsx` / `.pdf` 解析成文本时，会调用 `backend/parse_document.py`。

```bash
pip3 install python-docx openpyxl pdfplumber
which python3     # 把输出写进 backend/.env 的 PLATFORM_PYTHON_PATH
```

### C2. 知识库向量检索

会调用 `backend/vector/vector_service_mysql.py`。

```bash
pip3 install mysql-connector-python
```

### C3. 前端端到端测试（Playwright）

```bash
cd ~/code/test-platform/frontend
npm install -D @playwright/test     # 项目当前没有声明这个依赖，需要手动装
npx playwright install chromium     # 下载浏览器（约 150MB）
npx playwright test                 # 跑测试
```

> 测试默认访问 `http://localhost:5174`。
> 如果你用的是别的端口，加参数：`BASE_URL=http://localhost:5175 npx playwright test`

### C4. Python 自动化测试脚本

`qclaw-agents/ui-e2e-executor/` 下有独立的 Python 测试项目：

```bash
cd ~/code/test-platform/qclaw-agents/ui-e2e-executor
pip3 install -r requirements.txt
python3 -m playwright install chromium
```

---

## 最后：遇到问题怎么办

1. 先看第 11 章「常见问题排查」
2. 还不行，把**完整的报错信息**截图或复制，私聊负责人
3. 不要只说「跑不起来」——要说清楚：你在哪一步、执行了什么命令、看到什么报错

祝开发顺利 🎉
