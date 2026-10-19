# 测试中台 · Git 仓库授权与上手手册

> ⚠️ **本文档已迁移到 GitHub，旧的「腾讯云裸库 + dev 账号 + 手工登记公钥」流程作废。**
>
> - 小白版完整接入流程：**[`ONBOARDING.md`](ONBOARDING.md)**（推荐先看这个）
> - 协作规范：**[`COLLABORATION.md`](COLLABORATION.md)**
> - AI 助手速查版：**[`NEW-MEMBER-ONBOARDING.md`](NEW-MEMBER-ONBOARDING.md)**
>
> 本文件只保留「负责人授权操作」和「纪律红线」两部分。

---

## 一、仓库地址

| 用途 | 地址 |
|---|---|
| 主仓库（日常开发） | <https://github.com/zcq20070828/test-platform> |
| SSH 克隆 | `git clone git@github.com:zcq20070828/test-platform.git` |
| 历史遗留（只读，不再更新） | `testplatform-git:/opt/git/test-platform.git`（腾讯云 `42.194.137.114`） |

> 腾讯云上的裸库最后一版停在 2026-10-14，**不要再用它推送**。
> 仓库里还残留着旧历史的敏感内容（一个已废弃的 API Key、一个测试密码文件），
> 如果那台服务器还要继续用，建议把 `/opt/git/test-platform.git` 整个删掉重建。

---

## 二、负责人授权新成员（GitHub 方式）

### 步骤 1：邀请成为 Collaborator

1. 打开 <https://github.com/zcq20070828/test-platform/settings/access>
2. 点 **Add people**
3. 输入同事的 GitHub 用户名或邮箱
4. 权限选 **Write**（能推分支、不能改仓库设置）
5. 点 **Add**

同事会收到邮件，点 **Accept invitation** 后即可推送。

> 仓库目前是 Public，未受邀的人也能 clone 和查看代码，只是不能推。
> 如果代码含敏感信息，请把仓库改成 Private：
> **Settings → 拉到底 Danger Zone → Change repository visibility → Change to private**。

### 步骤 2：私聊发送三项信息

| 项目 | 说明 |
|---|---|
| 开发库地址 | 负责人 Mac 的当前内网 IP（`./get-dev-db-host.sh` 可查） |
| AI Key | 团队共用 DeepSeek Key |
| 端口编号 | 分配一组没被占用的端口（见下） |

**只能私聊发送**，不要发群、不要写进任何会被提交的文件。

### 步骤 3：分配端口

| 人员 | 后端 PORT | 前端端口 |
|---|---|---|
| 负责人 | 3002 | 5174 |
| 成员 A | 3003 | 5175 |
| 成员 B | 3004 | 5176 |
| 成员 C | 3005 | 5177 |

同一台机器上多项目并存时也要错开。

### 步骤 4：确认对方能推送

让同事在新克隆的仓库里执行：

```bash
git push -u origin main
```

输出 `Everything up-to-date` 或正常推送即说明权限到位。

> 如果报 `Permission denied (publickey)`，是他自己的 SSH 没配好（见 `ONBOARDING.md` 第 3 章）。
> 如果报 `403` 或 `Permission to ... denied`，是邀请还没接受。

---

## 三、被授权方（新同事）

**请直接看 [`ONBOARDING.md`](ONBOARDING.md)**，那里有：

1. 装软件（Git / Node / MySQL / Python）
2. 注册 GitHub + 接受邀请
3. 配置 SSH 密钥
4. 克隆代码
5. `npm ci` 装依赖
6. 写 `backend/.env`
7. 建库（连开发库 或 本地用 `database/00-schema-full.sql` 建）
8. 启动前后端
9. 验证登录
10. 日常开发流程
11. 常见问题排查

---

## 四、数据库纪律（最容易出乱子）

| 项 | 值 |
|---|---|
| 开发库地址 | 负责人 Mac 的内网 IP `:3306`（**会变，用 `./get-dev-db-host.sh` 查**） |
| 库名 | `test_platform_dev`（空库，42 张表结构） |
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

---

## 五、代码资产冲突高发区

| 目录 | 风险 |
|---|---|
| `qclaw-agents/`（19 个智能体） | **高** —— 多人改不同智能体容易互相覆盖 |
| `qclaw-skills/` | **高** —— 同上 |
| `frontend/src/` | 中 |
| `backend/services/` | 中 |

避免冲突：

1. 动手前先 `git pull origin main`
2. 一次只改一个智能体目录
3. 合并遇到冲突**先沟通**，不要直接覆盖

---

## 六、安全红线

1. **生产环境不直接改源码**，问题回本地修
2. **不擅自部署 / build**（需负责人统一安排）
3. **`.env` 绝不入库**（已在 `.gitignore` 排除）
4. **不 force push 到 main**（用 `--no-ff` 合并）
5. **Key / 密码只私聊**，不贴群、不写进被跟踪的文件
6. **数据库弱口令仅限可信内网**，不要映射到公网
7. GitHub 有推送保护：一旦 commit 里含 API Key，**推送会被直接拒绝**

---

## 七、故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| `Permission denied (publickey)` | 公钥没加到 GitHub | `cat ~/.ssh/id_ed25519.pub` 贴到 <https://github.com/settings/ssh/new> |
| `git push` 卡住 / 超时 | 网络到 github.com 不稳 | 先 `ssh -T git@github.com` 测通；必要时用代理 |
| `403` / `Permission to ... denied` | 邀请没接受 | 检查邮箱，点 Accept invitation |
| `remote rejected ... GH013` | 历史里有密钥 | 从历史中移除该密钥后重新推送（见 ONBOARDING 第 12 章） |
| 连不上开发库 | 不同网络 / 负责人 IP 变了 | 向负责人要当前地址；或 `DEV_DB_HOST=<地址> bash setup-dev-env.sh` |
| 改了 `.env` 不生效 | 项目不读 `.env` 文件 | 用 `./start-dev.sh` 启动，然后 `restart` |
| 端口被占用 | 本机其他服务 | `BACKEND_PORT=xxxx FRONTEND_PORT=xxxx ./start-dev.sh` |

> **重要提示**：`backend/database/db.js` 只读 `process.env`，**不读 `.env` 文件**。
> 所以改完 `.env` 必须重启；用 `./start-dev.sh` 启动会自动注入。

---

**文档版本**：v2.0（2026-10-19 迁移至 GitHub）
**仓库**：<https://github.com/zcq20070828/test-platform>
**联系人**：赵成庆
