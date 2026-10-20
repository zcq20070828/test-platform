#!/bin/bash
# ============================================================
# 测试中台一键部署脚本（2026-10-19 安全整改版）
# 用法: ./deploy.sh [--start|--stop|--restart|--status]
#
# 修复内容：
#   1. pgrep 模式改为匹配实际路径（此前写 test-platform-backend/server.js，
#      与本仓库 test-platform/backend/server.js 不匹配，start 永远认为未运行 → 重复启动）。
#   2. 端口兜底 3001 → 3002（与 .env / vite 代理 / 文档统一）。
#   3. 显式从 backend/.env 注入 DB_* 等变量：server.js 自身只读 PORT/SSO/DEEPSEEK，
#      db.js 只读 process.env，不注入会静默连 localhost/test_platform。
#   4. 生产入口改为 node server.js（server.dist.mjs 是旧构建产物，已被 gitignore）。
#   5. 停止时先发 SIGTERM 等优雅关闭，超时再 SIGKILL。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="test-platform"
BACKEND_DIR="$ROOT_DIR/backend"
LOG_DIR="$ROOT_DIR/runtime/logs"
LOG_FILE="$LOG_DIR/backend.log"
PID_FILE="$ROOT_DIR/runtime/backend.pid"
ENV_FILE="$BACKEND_DIR/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$APP_NAME]${NC} $1"; }
warn() { echo -e "${YELLOW}[$APP_NAME]${NC} $1"; }
err() { echo -e "${RED}[$APP_NAME]${NC} $1"; }

# 从 .env 读取单个键（不 source，避免执行任意内容）
env_get() {
  local key="$1" default="${2:-}"
  local val
  val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true)"
  echo "${val:-$default}"
}

check_env() {
  if [ ! -f "$ENV_FILE" ]; then
    err "未找到 .env 配置文件: $ENV_FILE"
    warn "请复制 backend/.env.example 为 backend/.env 并配置"
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    err "未找到 Node.js，请先安装"
    exit 1
  fi
  if ! grep -q '^LOCAL_JWT_SECRET=..*' "$ENV_FILE"; then
    err "backend/.env 缺少 LOCAL_JWT_SECRET（生产环境会拒绝启动）"
    warn "生成方式: openssl rand -hex 32"
    exit 1
  fi
  log "环境检查通过"
}

# 兼容旧位置，但以 PID 文件为准；再按端口兜底发现
find_pid() {
  if [ -f "$PID_FILE" ]; then
    local p; p="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo "$p"; return 0; fi
  fi
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local p; p="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
    [ -n "$p" ] && { echo "$p"; return 0; }
  fi
  echo ""
}

stop() {
  local port; port="$(env_get PORT 3002)"
  local pid; pid="$(find_pid "$port")"
  if [ -z "$pid" ]; then warn "服务未运行"; return 0; fi
  log "停止服务 PID=$pid（SIGTERM，等待优雅关闭）"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 25); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "优雅关闭超时，发送 SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

start() {
  local port; port="$(env_get PORT 3002)"
  local pid; pid="$(find_pid "$port")"
  if [ -n "$pid" ]; then
    warn "服务已在运行 PID=$pid"
    return 0
  fi

  mkdir -p "$LOG_DIR"
  log "启动后端服务（端口 $port）..."
  cd "$BACKEND_DIR"

  # 显式注入 .env 中的 DB / 安全配置（db.js 只读 process.env）
  local db_env=()
  local key
  for key in DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME \
             LOCAL_JWT_SECRET DEFAULT_ADMIN_PASSWORD ALLOWED_ORIGINS BIND_HOST TRUST_PROXY \
             DEEPSEEK_API_KEY AI_API_KEY AI_BASE_URL AI_MODEL PLATFORM_PYTHON_PATH; do
    local val; val="$(env_get "$key" "")"
    [ -n "$val" ] && db_env+=("$key=$val")
  done

  nohup env PORT="$port" NODE_ENV=production "${db_env[@]}" node server.js > "$LOG_FILE" 2>&1 &
  local backend_pid=$!
  echo "$backend_pid" > "$PID_FILE"

  # 等待就绪（/api/readyz 会真正查库）
  local ok=0
  for _ in $(seq 1 30); do
    if curl -fsS --noproxy '*' "http://127.0.0.1:$port/api/readyz" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" = "1" ]; then
    log "✅ 服务启动成功 (PID=$backend_pid, 端口=$port)"
  else
    err "❌ 服务启动失败，查看日志: tail -50 $LOG_FILE"
    exit 1
  fi
}

status() {
  local port; port="$(env_get PORT 3002)"
  local pid; pid="$(find_pid "$port")"
  if [ -z "$pid" ]; then warn "❌ 服务未运行"; return 0; fi
  if curl -fsS --noproxy '*' "http://127.0.0.1:$port/api/readyz" >/dev/null 2>&1; then
    log "✅ 服务运行中（PID=$pid，端口=$port，数据库连通）"
  elif curl -fsS --noproxy '*' "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    warn "⚠️  进程存活但数据库不可用（PID=$pid，端口=$port），检查 /api/readyz"
  else
    warn "⚠️  进程存在但端口无响应（PID=$pid，端口=$port）"
  fi
}

case "${1:-start}" in
  --start|-s)    check_env; start ;;
  --stop|-x)     stop ;;
  --restart|-r)  check_env; stop; sleep 1; start ;;
  --status|-t)   status ;;
  *)
    echo "用法: $0 {--start|--stop|--restart|--status}"
    exit 1
    ;;
esac
