# 测试中台 · 新成员接入说明（WorkBuddy 开发环境专用）

> **这份文档是给你的 AI 助手（WorkBuddy）看的，也可以自己看。**
> 把你收到的信息填好、跑完下面的步骤，之后你就能像负责人一样在 WorkBuddy 里开发测试中台。
>
> 填完记得保存为 `~/test-platform-接入.md`，或直接发给 WorkBuddy 让它读。

---

## 一、你需要填的信息（从负责人处获取）

| 项 | 值 |
|---|---|
| 你的姓名 | ____________________ |
| 开发库地址 | ____________________ （负责人 Mac 的内网 IP） |
| AI Key（团队共用） | ____________________ |

> 获取方式：问负责人要。**不要写进任何会被 git 提交的文件**。

---

## 二、请你（人）先完成 3 个前置动作

### 动作 1：生成并发送 SSH 公钥

```bash
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "你的姓名@workbuddy"
cat ~/.ssh/id_ed25519.pub        # 把这一整行发给负责人
ssh-keygen -lf ~/.ssh/id_ed25519.pub   # 把这行指纹也发给负责人核对
```

负责人登记后回复你即可。

### 动作 2：配置 SSH

追加到 `~/.ssh/config`（**不要覆盖已有内容**）：

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

```bash
chmod 600 ~/.ssh/config
```

> `BatchMode yes` 必须有，否则 `git push` 会一直卡住。

### 动作 3：克隆代码

```bash
git clone testplatform-git:/opt/git/test-platform.git
cd test-platform
```

---

## 三、然后在 WorkBuddy 里做（打开一个新对话，把这段发给它）

```
我要参与测试中台的开发，请先读取项目根目录下的
GIT-ACCESS-GUIDE.md 和 COLLABORATION.md 了解协作规范，
然后帮我完成开发环境配置（执行 ./setup-dev-env.sh 并验证），
最后启动 dev 环境并确认可以正常访问。

我的信息：
- 姓名：<你的姓名>
- 开发库地址：<负责人给的IP>
- AI Key：<负责人给的Key>
```

AI 助手会：
1. 读协作文档，理解规则
2. 跑 `./setup-dev-env.sh`（装依赖 + 生成 `.env` + 验连数据库）
3. 跑 `./start-dev.sh` 启动 dev 环境

> **你也可以手动跑**（不需要 AI）：
> ```bash
> DEV_DB_HOST=<开发库地址> DEV_AI_KEY=<AI Key> bash setup-dev-env.sh
> ./start-dev.sh
> ```

---

## 四、验证成功的样子

```
✅ 后端  http://localhost:3888  → 200
{"status":"ok","agents":18,"tasks":0}
✅ 前端  http://localhost:5174/  → 200
```

浏览器打开 <http://localhost:5174> 看到登录页即成功。

**如果 `tasks` 不是 0**，说明连错数据库了，检查 `.env` 里 `DB_NAME` 必须是 `test_platform_dev`。

---

## 五、日常开发（在 WorkBuddy 里跟 AI 说即可）

### 开新功能
```
在测试中台实现 XXX 功能。先读 COLLABORATION.md 了解分支规范，
从最新 main 开分支 feature/2026-10-15-xxx，然后实现。
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
| **`qclaw-agents/` 一次只改一个目录** | 19 个智能体是共享资产，冲突高发区 |
| **收工 `--no-ff` 合回 main** | 不 force push |

---

## 六、端口冲突怎么办

各人本地端口要错开：

| 人员 | 后端 PORT | 前端端口 |
|---|---|---|
| 负责人 | 3888 | 5174 |
| 你 | 3889 | 5175 |

- 后端：改 `backend/.env` 的 `PORT=3889`，然后 `./start-dev.sh restart`
- 前端：改 `start-dev.sh` 顶部 `FRONTEND_PORT=5175`

---

## 七、出问题找谁

| 事项 | 找谁 |
|---|---|
| 仓库权限、公钥登记 | 负责人 |
| 开发库地址变更、AI Key | 负责人 |
| 表结构变更执行 | 负责人 |
| 生产环境 | 负责人（**不要自己动**）|

---

## 八、故障排查速查

| 现象 | 解决 |
|---|---|
| `Permission denied (publickey)` | 公钥没登记，把 `cat ~/.ssh/id_ed25519.pub` 发给负责人 |
| `git push` 出 `git>` 卡住 | `~/.ssh/config` 缺 `BatchMode yes` |
| 连不上开发库 | `ping <地址>`；不通就是不同网络，问负责人要新地址 |
| 改了 `.env` 不生效 | 必须 `./start-dev.sh restart`（项目只读 `process.env`，不读 `.env`）|
| 后端报 `tasks:443` | 误连正式库，改 `DB_NAME=test_platform_dev` |

---

**完成第一、二、三步后，你就正式加入了。**