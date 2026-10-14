# 测试中台 · Linux 部署手册

> 适用版本：v1.0.0-20260718
> 适用环境：腾讯云 CVM / 任意 Linux（Ubuntu 20.04+ / CentOS 7+）
> 架构：单进程后端（Node.js）同时托管前端 + 提供 API/WebSocket

---

## 0. 架构与端口说明

```
浏览器 ──HTTP──> Nginx(可选, :80/:443) ──proxy_pass──> 后端(:3002)
                                          └─ 后端同时 serve 前端静态文件(frontend/dist/)
                                          └─ 后端连接 MySQL(:3306)
                                          └─ 后端直连 Deepseek API（密钥硬编码于 server.js）
```

- 后端端口统一为 **3002**（`server.js` 兜底与 `.env` 均为 3002，与前端 vite 的 `/api` 代理 target 三方一致）。
- 前端已构建在 `frontend/dist/`，由后端直接托管，**生产环境无需单独运行前端服务**。
- 智能体定义读取 `~/.qclaw/agents/<id>/SOUL.md`；技能读取 `~/.qclaw/skills/<id>/SKILL.md`。
- 知识库根目录硬编码为 `$HOME/.qclaw/knowledge-base/`。**知识库根目录硬编码为 `$HOME/.qclaw/knowledge-base/`**

> 🚨 **部署前必读**：数据库名**必须命名为 `test_platform`**（详见第 3 节「⚠️ 醒目警告」）。`02-init-data.sql` 内部硬编码 `USE test_platform;`，库名不符会导致初始化数据插错库、管理员无法登录、系统配置缺失。

---

## 1. 环境要求

| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18（建议 20 LTS） | 运行后端；esbuild 转译需 ≥ 18 |
| npm | ≥ 9 | 安装依赖 |
| MySQL / MariaDB | ≥ 10.3 | 字符集 **utf8mb4**（中文不乱码） |
| 构建工具 | gcc / g++ / make / python3 | **bcrypt 原生模块编译所需** |
| Nginx（可选） | 任意 | 反向代理 / HTTPS |

---

## 2. 服务器准备

### 2.1 安装 Node.js（以 Ubuntu 为例）

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v
```

### 2.2 安装构建工具（bcrypt 必须）

```bash
# Ubuntu / Debian
sudo apt-get install -y build-essential python3 make g++

# CentOS / RHEL
sudo yum groupinstall -y "Development Tools"
sudo yum install -y python3
```

> ⚠️ 若缺少这些，`npm install` 时 bcrypt 原生编译会失败，后端无法启动。

### 2.3 安装并初始化 MySQL

```bash
# Ubuntu
sudo apt-get install -y mariadb-server   # 或 mysql-server
sudo systemctl enable --now mariadb
sudo mysql_secure_installation   # 设置 root 密码

# 创建库与应用账号（也可直接执行本包 database/ 脚本，见第 3 节）
```

---

## 3. 数据库初始化

将本包 `database/` 目录上传到服务器，执行：

```bash
# 建库 + 建表（17 张，含 system_config）
mysql -u root -p < database/01-create-database.sql

# 初始化数据（默认账户 + 系统配置）
# 🚨 注意：<数据库名> 必须严格为 test_platform！详见下方醒目警告
mysql -u root -p test_platform < database/02-init-data.sql
```

> # ⚠️⚠️⚠️ 醒目警告：数据库名必须为 `test_platform` ⚠️⚠️⚠️
>
> `database/02-init-data.sql` 内部**硬编码**了 `USE test_platform;` 语句。
> 如果你的目标库**不叫 `test_platform`**，初始化数据会**插错库或静默失败**，
> 直接后果是：**部署后管理员无法登录、系统配置缺失、页面功能异常**。
>
> **部署前必须满足以下二选一：**
> 1. ✅ **（推荐）** 创建并授权一个名为 `test_platform` 的数据库 —— 与下方 `GRANT ... ON test_platform.*` 完全一致，无需改动任何文件。
> 2. ⚠️ **（备选）** 先编辑 `database/02-init-data.sql`，把首行 `USE test_platform;` 改为你的实际库名，保存后再执行本命令。

创建应用连接账号（后端默认 `appuser / apppwd123`）：

```sql
CREATE USER 'appuser'@'%' IDENTIFIED BY 'apppwd123';
GRANT ALL PRIVILEGES ON test_platform.* TO 'appuser'@'%';
FLUSH PRIVILEGES;
```

> 详细表结构、账户、配置说明见 `database/README.md`。
> 若中文乱码，确认库/表/连接三层字符集均为 `utf8mb4`。

---

## 4. 部署后端

```bash
# 1) 上传 backend/ 到服务器，例如 /opt/test-platform/backend
cd /opt/test-platform/backend

# 2) 安装依赖（bcrypt 将在此编译原生模块）
npm install
#   若担心 devDependencies 干扰，可用：npm install --omit=dev
#   ⚠️ 若此处 bcrypt 报错，回到第 2.2 节确认构建工具已装

# 3) 配置 .env
cp .env.example .env
#   按需修改：
#     PORT=3002
#     DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
#     HOST=localhost（保留，由 nginx 反代）
#   ⚠️ DEEPSEEK_API_KEY 硬编码在 server.js:5376，改 .env 的 AI_* 无效

# 4) 启动（验证）
node server.dist.mjs
#   看到 "Ready to accept connections." 即成功
#   按 Ctrl+C 停止
```

> ✅ 启动入口是 `server.dist.mjs`（已转译），**不是** `server.js`。
> `npm start` 也会运行 `server.dist.mjs`。

---

## 5. 智能体 / 技能 / 知识库 放置

后端运行时从运行用户 HOME 下读取：

```bash
# 智能体（26 个）
cp -r qclaw-agents/* ~/.qclaw/agents/
#   注意：包内已将 <id>/agent/SOUL.md 提升到 <id>/SOUL.md 顶层，
#   与后端 server.js 的读取路径一致。

# 技能（27 个，后端实际引用）
cp -r qclaw-skills/* ~/.qclaw/skills/

# 知识库（general / project-test / project-biz）
mkdir -p ~/.qclaw/knowledge-base
cp -r qclaw-knowledge-base/* ~/.qclaw/knowledge-base/
```

> 若 `~/.qclaw` 不存在，先 `mkdir -p ~/.qclaw`。
> 放置后重启后端生效。

---

## 6. 进程守护（PM2，推荐）

```bash
sudo npm install -g pm2
cd /opt/test-platform/backend
pm2 start server.dist.mjs --name test-platform
pm2 save
pm2 startup   # 按提示设置开机自启
```

查看状态：`pm2 logs test-platform` / `pm2 status`

---

## 7. 反向代理（Nginx，可选但推荐）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;   # WebSocket / SSE 长连接
    }
}
```

> WebSocket（SSE）需要 `Upgrade`/`Connection` 头与足够超时。

---

## 8. 验证部署

1. 浏览器访问 `http://<服务器IP>:3002`（或 nginx 域名）。
2. 用默认账户登录：`admin / admin123`。
3. 进入「分步测试」提交一个简单任务，观察是否生成结果。
4. 进入「智能体」确认 15 个智能体已加载。
5. 进入「知识库」确认文档可检索。

---

## 9. 故障排查

| 现象 | 原因 / 解决 |
|------|------|
| `node server.js` 报 `SyntaxError: Missing initializer` | ❌ 用错了入口。必须用 `server.dist.mjs`。 |
| `npm install` 卡在 bcrypt / `node-pre-gyp ERR` | 缺少构建工具（2.2 节）；或网络无法下载预编译包。 |
| `Cannot find module 'xxx'` | 依赖未装全。`rm -rf node_modules && npm install`。 |
| 启动后中文乱码 | 数据库字符集非 utf8mb4。见 `database/README.md`。 |
| 登录失败（密码错误） | 确认使用 bcrypt 哈希的账户；默认 `admin/admin123`。 |
| 智能体不显示 / 加载为空 | `~/.qclaw/agents/` 未放置或 SOUL.md 不在 `<id>/` 顶层。 |
| 知识库为空 / 解析失败 | `~/.qclaw/knowledge-base/` 未放置文档。 |
| 任务执行无 AI 输出 | Deepseek Key 硬编码于 server.js:5376；确认该 key 仍有效 / 网络可达。 |
| 端口被占用 `EADDRINUSE` | 改 `.env` 的 `PORT` 或释放占用进程。 |

---

## 10. 封版与回滚

- 本包为 **v1.0.0-20260718** 封版。修改任何文件前请先备份。
- 修改 `server.js` 后必须 `npm run build` 重新生成 `server.dist.mjs`。
- 后端业务逻辑、智能体、技能、知识库均为文件形态，回滚 = 还原对应文件 + 重启。

---

## 附录：单命令速查

```bash
# 数据库
mysql -u root -p < database/01-create-database.sql
mysql -u root -p test_platform < database/02-init-data.sql

# 后端
cd backend && npm install && cp .env.example .env && node server.dist.mjs

# 资产放置
cp -r qclaw-agents/* ~/.qclaw/agents/
cp -r qclaw-skills/* ~/.qclaw/skills/
cp -r qclaw-knowledge-base/* ~/.qclaw/knowledge-base/

# 守护
pm2 start server.dist.mjs --name test-platform
```
