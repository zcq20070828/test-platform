# 智能体 / 技能 / 知识库 安装脚本

封版包内置一键安装脚本 `deploy/install.sh`，把包内的
`qclaw-agents/`、`qclaw-skills/`、`qclaw-knowledge-base/`
复制到目标机的 `~/.qclaw/` 下，使后端能正确加载智能体与技能。

## 在腾讯云应用服务器上的用法

```bash
# 1) 上传整个封版包到服务器，进入包目录
cd /path/to/test-platform-2026-07-18

# 2)（可选）校验部署包本身是否完整
bash deploy/install.sh --check

# 3) 安装智能体 + 技能 + 知识库（默认装到 $HOME/.qclaw）
bash deploy/install.sh

# 4) 安装后校验目标机内容
bash deploy/install.sh --verify

# 5) 重启后端使智能体/技能生效
pm2 restart test-platform
```

## 参数

| 参数 | 说明 |
|------|------|
| （无） | 安装到 `$HOME/.qclaw` |
| `--home <dir>` | 安装到 `<dir>/.qclaw`（如部署用户非运行用户时） |
| `--dry-run` | 仅打印将执行的操作，不实际写入 |
| `--verify` | 校验目标机已安装内容是否完整（不写入） |
| `--check` | 校验部署包本身是否完整（不写入） |

## 说明

- 智能体与技能均为**文件形态**：智能体 = `~/.qclaw/agents/<id>/SOUL.md`，
  技能 = `~/.qclaw/skills/<id>/SKILL.md`，后端启动时按路径读取。
- 本脚本为**幂等**：重复执行会先清除再复制，结果一致。
- 安装后**必须重启后端**，新的智能体/技能才会被加载。
- 知识库根目录由后端硬编码为 `$HOME/.qclaw/knowledge-base`，
  本脚本一并安装，请确保运行后端的用户 HOME 与此一致。
