# 测试中台部署包

## 目录结构

```
test-platform/
├── backend/             # 后端服务 (Node.js)
│   ├── server.js         # 主入口
│   ├── .env              # 配置文件 (需自行创建)
│   ├── .env.example      # 配置示例
│   ├── routes/           # API 路由
│   ├── services/         # 业务服务
│   ├── utils/           # 工具函数
│   └── knowledge/        # 知识库模块
├── frontend/            # 前端页面 (已构建)
│   └── dist/            # Vue 静态文件
├── openclaw/           # OpenClaw Agent 配置
│   └── agents/          # Agent 定义
│   └── skills/          # Skill 脚本
├── knowledge-base/      # 知识库文件
├── vector-service/      # 向量服务 (Python)
├── deploy.sh           # 部署脚本
└── README.md           # 本文件
```

## 快速启动

```bash
# 1. 配置后端
cd backend
cp .env.example .env
# 编辑 .env，配置 OpenClaw Gateway URL 等

# 2. 启动服务
cd ..
chmod +x deploy.sh
./deploy.sh --start

# 3. 访问前端
open http://localhost:3001
```

## 配置说明

`.env` 关键配置项：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 后端服务端口 | `3001` |
| `OPENCLAW_GATEWAY_URL` | OpenClaw Gateway 地址 | `http://localhost:3001` |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway 认证 Token | - |
| `UI_PATH` | 前端静态文件目录 | `../frontend/dist` |

## 部署架构

```
浏览器 ──→ 前端 (3001) ──→ 后端 API (3001)
                        └──→ OpenClaw Gateway (3001)
                              └──→ 测试 Agent (LLM)
```

## 管理命令

```bash
./deploy.sh --start   # 启动
./deploy.sh --stop    # 停止
./deploy.sh --restart # 重启
./deploy.sh --status  # 状态
```

## 主要功能

- 🤖 **智能体调度** — 13个专项测试智能体 (需求分析、用例生成、API测试、UI/E2E测试等)
- 🔄 **自动化工作流** — Test-Master 规划 + 后端自动调度 + 并行AI审核
- 📚 **知识库** — 多知识库支持，支持上传文档和语义搜索
- 📊 **仪表盘** — 实时任务状态、SSE流式输出、Markdown渲染
- 🔒 **安全合规** — 数据脱敏、多维度AI审核
