#!/bin/zsh
# ============================================================================
# start-dev.sh — 测试中台 WorkBuddy 一键 dev 环境 (后端 3888 + 前端 5174)
#
# 用法:
#   ./start-dev.sh            # 启动(已运行则跳过, 幂等)
#   ./start-dev.sh start      # 同上
#   ./start-dev.sh stop       # 停止本项目前后端
#   ./start-dev.sh restart    # 停止后重新启动
#   ./start-dev.sh status     # 查看健康状态
#
# 设计要点(沉淀自 2026-09-17 踩坑):
#   1) 后端用错开端口 3888, 避开 QClaw 监督进程占用的 3002 (不杀 QClaw 后端)。
#   2) 停止/状态一律按「监听端口」发现进程, 不依赖启动方式(手动/脚本均可命中),
#      且 3888/5174 与 QClaw 的 3002 不重叠, 绝不会误杀 QClaw 后端。
#   3) server.js 的 PORT = process.env.PORT || .env(PORT=3002) || 3888,
#      故必须显式 export PORT=3888, 否则会落到 3002 冲突。
#   4) 清空 NODE_OPTIONS, 关闭 WorkBuddy 注入的 node-safe-delete-shim,
#      否则 vite 清理 .vite/deps 缓存(>50 文件)会被拦截而中止。
#   5) 健康探测一律 curl --noproxy '*', 绕过环境 HTTP_PROXY(否则 localhost 被代理返回 502)。
#   6) 启动用 nohup ... & 脱离终端, 关掉终端后服务仍在。
# ============================================================================

set -u

# ---------- 配置(可按需修改) ----------
WS_DIR="/Users/zhaochengqing/WorkBuddy/2026-08-13-20-26-38/test-platform"
BACKEND_DIR="$WS_DIR/backend"
FRONTEND_DIR="$WS_DIR/frontend"
NODE_BIN="/Users/zhaochengqing/.workbuddy/binaries/node/versions/22.12.0/bin/node"

BACKEND_PORT=3888
FRONTEND_PORT=5174
BACKEND_URL="http://localhost:$BACKEND_PORT"
VITE_TARGET="http://localhost:$BACKEND_PORT"

BACKEND_LOG="/tmp/wb-backend-$BACKEND_PORT.log"
FRONTEND_LOG="/tmp/wb-vite-$FRONTEND_PORT.log"
BACKEND_PID="/tmp/wb-backend-$BACKEND_PORT.pid"
FRONTEND_PID="/tmp/wb-vite-$FRONTEND_PORT.pid"

# 进程匹配(作用域限定本项目, 避免误杀 QClaw 监督的后端 3002)
BACKEND_MATCH="$WS_DIR/backend/server.js"
FRONTEND_MATCH="$WS_DIR/frontend/node_modules/vite/bin/vite.js"

# ---------- 关键: 关闭 WorkBuddy 的 node-safe-delete-shim ----------
# 该 shim 会拦截 vite 清理 .vite/deps 缓存(>50 文件)导致启动中止
export NODE_OPTIONS=""

# ---------- 颜色(浅色主题, 深色字) ----------
C_OK="\033[0;32m"; C_WARN="\033[0;33m"; C_ERR="\033[0;31m"; C_DIM="\033[0;90m"; C_RST="\033[0m"
ok(){ echo "${C_OK}✅ $1${C_RST}"; }
warn(){ echo "${C_WARN}⚠️  $1${C_RST}"; }
err(){ echo "${C_ERR}❌ $1${C_RST}"; }
dim(){ echo "${C_DIM}   $1${C_RST}"; }

# ---------- 健康探测(绕过环境 HTTP_PROXY) ----------
backend_up(){
  curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 "$BACKEND_URL/api/health" 2>/dev/null | grep -q 200
}
frontend_up(){
  curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$FRONTEND_PORT/" 2>/dev/null | grep -q 200
}

# ---------- 按监听端口发现进程 PID(macOS lsof) ----------
# 返回监听该端口的进程 PID; 方法无关, 手动/脚本启动均能命中
listener_pid(){
  lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
}

# ---------- 等待函数 ----------
wait_for(){
  local name="$1"; local check="$2"; local timeout="$3"; local logfile="$4"
  local waited=0
  printf "${C_DIM}   等待 %s 就绪" "$name"
  while ! eval "$check"; do
    sleep 3; waited=$((waited+3)); printf "."
    if [ $waited -ge $timeout ]; then echo; err "$name 在 ${timeout}s 内未就绪, 详见日志: $logfile"; return 1; fi
  done
  echo; ok "$name 已就绪"
  return 0
}

# ---------- 启动后端 ----------
start_backend(){
  if backend_up; then ok "后端已运行 ($BACKEND_URL) — 跳过"; return 0; fi
  dim "启动后端 → $BACKEND_URL (首次 warmup 约 2-3 分钟)"
  # 2026-10-11: backend/database/db.js 只读 process.env, 不读 .env,
  #   故必须把 .env 里的 DB_* 显式导出, 否则会静默回落到 localhost/test_platform。
  # 2026-10-14: 开发库地址会随本机网络变化(换 WiFi 就变), 启动前自动校正。
  DB_ENV_ARGS=()
  if [ -f "$BACKEND_DIR/.env" ]; then
    # IP 自愈：仅当.env 的 DB_HOST 像内网 IP（非 localhost）且与本机当前探测值不符时改写
    local cur_ip env_ip
    cur_ip="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}' | xargs -I{} ipconfig getifaddr {} 2>/dev/null)"
    env_ip="$(grep -E '^DB_HOST=' "$BACKEND_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '"'"'"' \r')"
    if [ -n "$cur_ip" ] && [ -n "$env_ip" ] && [ "$env_ip" != "localhost" ] && [ "$env_ip" != "$cur_ip" ]; then
      sed -i '' "s|^DB_HOST=.*|DB_HOST=${cur_ip}|" "$BACKEND_DIR/.env" 2>/dev/null \
        && dim "  开发库地址已自动校正: ${env_ip} → ${cur_ip}（本机网络已变化）"
      env_ip="$cur_ip"
    fi
    while IFS='=' read -r k v; do
      case "$k" in
        DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME|DEEPSEEK_API_KEY|AI_API_KEY|AI_BASE_URL|AI_MODEL|PLATFORM_PYTHON_PATH)
          v="${v%\"}"; v="${v#\"}"   # 去掉可能的行尾/行首双引号
          [ -n "$v" ] && DB_ENV_ARGS+=("$k=$v")
          ;;
      esac
    done < "$BACKEND_DIR/.env"
  fi
  if [ ${#DB_ENV_ARGS[@]} -gt 0 ]; then
    dim "  注入配置: $(printf '%s ' "${DB_ENV_ARGS[@]%%=*}")"
  fi
  ( cd "$BACKEND_DIR" && nohup env PORT=$BACKEND_PORT NODE_ENV=development "${DB_ENV_ARGS[@]}" "$NODE_BIN" server.js > "$BACKEND_LOG" 2>&1 & echo $! > "$BACKEND_PID" )
  disown 2>/dev/null || true
  if ! wait_for "后端" "backend_up" 240 "$BACKEND_LOG"; then
    err "后端启动失败, 尾日志:"; tail -n 20 "$BACKEND_LOG" 2>/dev/null; return 1
  fi
  curl -s --noproxy '*' "$BACKEND_URL/api/health" 2>/dev/null | head -c 200; echo
}

# ---------- 启动前端 ----------
start_frontend(){
  if frontend_up; then ok "前端已运行 (http://localhost:$FRONTEND_PORT) — 跳过"; return 0; fi
  dim "启动前端 vite → http://localhost:$FRONTEND_PORT (代理 $VITE_TARGET)"
  ( cd "$FRONTEND_DIR" && nohup env VITE_API_TARGET="$VITE_TARGET" NODE_ENV=development "$NODE_BIN" node_modules/vite/bin/vite.js --port $FRONTEND_PORT --host > "$FRONTEND_LOG" 2>&1 & echo $! > "$FRONTEND_PID" )
  disown 2>/dev/null || true
  if ! wait_for "前端" "frontend_up" 90 "$FRONTEND_LOG"; then
    err "前端启动失败, 尾日志:"; tail -n 20 "$FRONTEND_LOG" 2>/dev/null; return 1
  fi
}

# ---------- 停止(按端口发现, 不误伤 QClaw 3002) ----------
stop_by_port(){
  local port="$1"; local name="$2"; local pid
  pid=$(listener_pid "$port")
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null
    pkill -P "$pid" 2>/dev/null   # 一并结束 cluster worker(若有)
    sleep 1
    if [ -n "$(listener_pid "$port")" ]; then warn "$name($port) 仍有残留, 强制结束"; kill -9 "$pid" 2>/dev/null; pkill -9 -P "$pid" 2>/dev/null; fi
    ok "$name($port) 已停止"
  else
    dim "$name($port) 未运行"
  fi
  # 兜底: 清理本项目路径匹配的残留(不影响 QClaw 3002)
  pkill -f "$BACKEND_MATCH" 2>/dev/null || true
  pkill -f "$FRONTEND_MATCH" 2>/dev/null || true
}
stop_backend(){ stop_by_port "$BACKEND_PORT" "后端"; }
stop_frontend(){ stop_by_port "$FRONTEND_PORT" "前端"; }

# ---------- 状态(按端口核对) ----------
show_status(){
  local bpid fpid
  if backend_up; then ok "后端  $BACKEND_URL  → 200"; bpid=$(listener_pid "$BACKEND_PORT"); dim "  listener PID: ${bpid:-?}"; curl -s --noproxy '*' "$BACKEND_URL/api/health" 2>/dev/null | head -c 200; echo
  else err "后端  $BACKEND_URL  → 未响应"; fi
  if frontend_up; then ok "前端  http://localhost:$FRONTEND_PORT/  → 200"; fpid=$(listener_pid "$FRONTEND_PORT"); dim "  listener PID: ${fpid:-?}"
  else err "前端  http://localhost:$FRONTEND_PORT/  → 未响应"; fi
}

# ---------- 入口 ----------
case "${1:-start}" in
  start)   echo "=== 启动测试中台 dev 环境 (WorkBuddy) ==="; start_backend; start_frontend; show_status;;
  stop)    echo "=== 停止测试中台 dev 环境 ==="; stop_frontend; stop_backend;;
  restart) echo "=== 重启测试中台 dev 环境 ==="; stop_frontend; stop_backend; sleep 2; start_backend; start_frontend; show_status;;
  status)  show_status;;
  *) echo "用法: $0 [start|stop|restart|status]"; exit 1;;
esac
