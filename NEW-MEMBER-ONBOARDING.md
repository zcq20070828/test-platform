# 测试中台 · 新成员接入说明（给 AI 助手读的简版）

> **完整的小白版请先看 [`ONBOARDING.md`](ONBOARDING.md)** —— 那里有逐条命令、现象对照和排错。
> 本文是给 AI 助手（WorkBuddy / Claude / Cursor 等）快速上手的清单版，人也可以看。

---

## 一、你需要填的信息（从负责人处获取）

| 项 | 值 |
|---|---|
| 你的姓名 | ____________________ |
| 开发库地址 | ____________________ （负责人 Mac 的内网 IP） |
| AI Key（团队共用） | ____________________ |
| 后端端口 | ____________________ （见附录，不要和别人重复） |
| 前端端口 | ____________________ |

> 获取方式：问负责人要。**不要写进任何会被 git 提交的文件**。

---

## 二、请你（人）先完成 3 个前置动作

### 动作 1：生成 SSH 公钥并上传到 GitHub

```bash
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "你的姓名@workbuddy"
cat ~/.ssh/id_ed25519.pub        # 复制整行 → https://github.com/settings/ssh/new
ssh -T git@github.com            # 必须显示 Hi <你的GitHub用户名>!
```

> 现在用**你自己的 GitHub 账号**，不再需要把公钥发给负责人登记。

### 动作 2：接受仓库邀请

负责人在 GitHub 上邀请你为 Collaborator，去邮箱点 **Accept invitation**。

> 仓库是 Public，未受邀也能 clone；但**推送必须被邀请**。

### 动作 3：克隆代码

```bash
git clone git@github.com:zcq20070828/test-platform.git
cd test-platform
```

---

## 三、然后在 AI 助手里做（打开一个新对话，把这段发给它）

```
我要参与测试中台的开发，请先读项目根目录的 ONBOARDING.md，
再读 COLLABORATION.md 了解协作规范。然后帮我完成环境配置：

1. 前端和后端都执行 npm ci 安装依赖
2. 复制 backend/.env.example 为 backend/.env，填入我下面给的信息
3. 验证数据库能连通（mysql 命令测试）
4. 启动前后端并确认 http://localhost:<前端端口> 能打开登录页

我的信息：
- 姓名：<你的姓名>
- 开发库地址：<负责人给的IP>
- AI Key：<负责人给的Key>
- 后端端口：<比如 3003>
- 前端端口：<比如 5175>
```

AI 助手会：
1. 读 `ONBOARDING.md` 和 `COLLABORATION.md`
2. 装依赖（`npm ci`）
3. 生成并填写 `backend/.env`
4. 验证数据库连通
5. 启动 dev 环境并做健康检查

> **你也可以手动跑**（不需要 AI）：
> ```bash
> DEV_DB_HOST=<开发库地址> DEV_AI_KEY=<AI Key> bash setup-dev-env.sh
>
> # 启动（端口换成自己的）
> BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh
> ```

---

## 四、验证成功的样子

```
✅ 后端  http://localhost:3003  → 200
{"status":"ok","timestamp":"...","agents":18,"tasks":4}
✅ 前端  http://localhost:5175/  → 200
```

浏览器打开 <http://localhost:5175> 看到登录页即成功，用 `admin / admin123` 登录。

**如果 `tasks` 是 0 或 443**，说明连错数据库了——检查 `.env` 里 `DB_NAME` 必须是 `test_platform_dev`。

---

## 五、日常开发（在 AI 助手里说即可）

### 开新功能
```
在测试中台实现 XXX 功能。先读 COLLABORATION.md 了解分支规范，
从最新 main 开分支 feature/2026-10-19-xxx，然后实现。
```

### 提交与合并
```
帮我把当前改动提交，提交信息用 feat/fix 前缀说明做了什么，
然后合回 main 并推送。
```

### 必须遵守的规矩

| 规矩 | 说明 |
|---|---|
| **DB_NAME 只能是 `test_platform_dev`** | 填错会动到负责人正式库（443 条历史任务）|
| **不许 `ALTER TABLE`** | 改表结构写 `backend/migrations/YYYYMMDD_描述.sql`，交负责人执行 |
| **不许改生产** | `aitestplatform.com.cn:8443` 一律不碰 |
| **不许擅自 build/部署** | 需要时由负责人统一安排 |
| **`.env` 不入库** | 已在 `.gitignore`；真实 Key 只放本地 |
| **Key / 密码只能私聊** | 不贴群、不写进任何被跟踪的文件 |
| **`qclaw-agents/` 一次只改一个目录** | 19 个智能体是共享资产，冲突高发区 |
| **收工 `--no-ff` 合回 main** | 不 force push |

---

## 六、端口冲突怎么办

各人本地端口要错开（同机多项目、多人同网都适用）：

| 人员 | 后端 PORT | 前端端口 |
|---|---|---|
| 负责人 | 3002 | 5174 |
| 成员 A | 3003 | 5175 |
| 成员 B | 3004 | 5176 |

两种改法，任选其一：

**方式一（推荐）：启动时用环境变量覆盖，不改文件**

```bash
BACKEND_PORT=3003 FRONTEND_PORT=5175 ./start-dev.sh
```

**方式二：写进 `backend/.env` 的 `PORT`，并手动起前端**

```bash
# 后端
cd backend && set -a && source .env && set +a && npm run dev

# 前端（另开一个终端）
cd frontend && VITE_API_TARGET=http://localhost:3003 npm run dev -- --port 5175
```

> ⚠️ 后端端口、`VITE_API_TARGET`、前端 `--port` 三处必须配套，否则页面能开但数据 502。

---

## 七、出问题找谁

| 事项 | 找谁 |
|---|---|
| 仓库邀请 | 负责人 |
| 开发库地址变更、AI Key | 负责人 |
| 表结构变更执行 | 负责人 |
| 生产环境 | 负责人（**不要自己动**）|

---

## 八、故障排查速查

| 现象 | 解决 |
|---|---|
| `Permission denied (publickey)` | 公钥没加到 GitHub，`cat ~/.ssh/id_ed25519.pub` 后贴到 GitHub Settings |
| `git push` 一直卡住 | `ssh -T git@github.com` 先测通；不通检查网络/代理 |
| 连不上开发库 | `ping <地址>`；不通就是不同网络，问负责人要新地址 |
| 改了 `.env` 不生效 | 必须重启：`./start-dev.sh restart`（项目只读 `process.env`，不读 `.env`）|
| 后端报 `tasks:443` | 误连正式库，改 `DB_NAME=test_platform_dev` |
| 页面能开但数据不出来 | 前端 `VITE_API_TARGET` 和后端端口不一致，改成同一个 |
| `npm ci` 卡住 | `npm config set registry https://registry.npmmirror.com` 后重试 |

> 更完整的排查见 [`ONBOARDING.md` 第 11 章](ONBOARDING.md#11-常见问题排查)。

---

**完成第一、二、三步后，你就正式加入了。**
