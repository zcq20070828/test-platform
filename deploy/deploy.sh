#!/bin/bash
# ============================================================
# 测试中台一键部署脚本
# 用法: ./deploy.sh [--start|--stop|--restart|--status]
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="test-platform"
LOG_FILE="$HOME/.qclaw/test-platform.log"
ENV_FILE="$SCRIPT_DIR/backend/.env"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$APP_NAME]${NC} $1"; }
warn() { echo -e "${YELLOW}[$APP_NAME]${NC} $1"; }
err() { echo -e "${RED}[$APP_NAME]${NC} $1"; }

# 检查环境
check_env() {
  if [ ! -f "$ENV_FILE" ]; then
    err "未找到 .env 配置文件: $ENV_FILE"
    warn "请复制 backend/.env.example 为 backend/.env 并配置"
    exit 1
  fi
  if ! command -v node &>/dev/null; then
    err "未找到 Node.js，请先安装"
    exit 1
  fi
  log "环境检查通过"
}

# 停止服务
stop() {
  local pid=$(pgrep -f "test-platform-backend/server.js" 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    log "停止服务 PID=$pid"
    kill $pid
    sleep 2
  else
    warn "服务未运行"
  fi
}

# 启动服务
start() {
  local pid=$(pgrep -f "test-platform-backend/server.js" 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    warn "服务已在运行 PID=$pid"
    return 0
  fi

  log "启动后端服务..."
  cd "$SCRIPT_DIR/backend"
  nohup node server.js > "$LOG_FILE" 2>&1 &
  BACKEND_PID=$!

  sleep 3

  # 检查是否启动成功
  local port=$(grep "^PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "3001")
  if curl -s "http://127.0.0.1:$port/api/health" > /dev/null 2>&1; then
    log "✅ 服务启动成功 (PID=$BACKEND_PID, 端口=$port)"
  else
    err "❌ 服务启动失败，查看日志: tail -50 $LOG_FILE"
    exit 1
  fi
}

# 重启服务
restart() {
  stop
  sleep 1
  start
}

# 状态
status() {
  local pid=$(pgrep -f "test-platform-backend/server.js" 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    local port=$(grep "^PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "3001")
    if curl -s "http://127.0.0.1:$port/api/health" > /dev/null 2>&1; then
      log "✅ 服务运行中 PID=$pid 端口=$port"
    else
      warn "⚠️  进程存在但端口无响应 PID=$pid"
    fi
  else
    warn "❌ 服务未运行"
  fi
}

# 主入口
case "${1:-start}" in
  --start|-s)    check_env; start ;;
  --stop|-x)     stop ;;
  --restart|-r)  check_env; restart ;;
  --status|-t)   status ;;
  *)
    echo "用法: $0 {--start|--stop|--restart|--status}"
    echo "  --start, -s   启动服务 (默认)"
    echo "  --stop,  -x   停止服务"
    echo "  --restart,-r 重启服务"
    echo "  --status,-t  查看状态"
    exit 1
    ;;
esac
