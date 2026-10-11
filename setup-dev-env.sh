#!/bin/bash
#
# setup-dev-env.sh — 测试中台 · 新成员环境一键配置
#
# 用法：把本文件复制到你的项目根目录（test-platform/）下，执行：
#   chmod +x setup-dev-env.sh
#   ./setup-dev-env.sh
#
# 它会做什么：
#   1. 检查 Node 版本
#   2. 安装前后端依赖
#   3. 生成 backend/.env（从模板复制 + 填入开发库/AI 配置）
#   4. 校验能否连上开发库
#
# 不会做什么：不会改系统配置、不会动生产、不需要 root 权限。

set -u

DB_HOST="192.168.43.4"
DB_PORT="3306"
DB_NAME="test_platform_dev"
DB_USER="appuser"
DB_PASSWORD="apppwd123"
AI_KEY="DEEPSEEK_API_KEY_PLACEHOLDER"

c_ok()   { printf "\033[32m%s\033[0m\n" "$1"; }
c_err()  { printf "\033[31m%s\033[0m\n" "$1"; }
c_warn() { printf "\033[33m%s\033[0m\n" "$1"; }
c_dim()  { printf "\033[2m%s\033[0m\n" "$1"; }

echo ""
c_ok "测试中台 · 开发环境配置"
echo "============================================================================"
echo ""

# ---------- 1. 检查 Node ----------
echo "----------------------------------------------------------------------------"
echo " 步骤 1/4：检查运行环境"
echo "----------------------------------------------------------------------------"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  c_err "  ✗ 未找到 node，请先安装 Node.js 18+（推荐用 nvm 管理）"
  echo ""
  echo "  安装参考：curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  exit 1
fi
NODE_VER="$("$NODE_BIN" -v)"
c_ok "  Node: $NODE_VER  ($(dirname "$NODE_BIN"))"
NODE_MAJOR="$(echo "$NODE_VER" | sed 's/^v\([0-9]*\).*/\1/')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  c_warn "  ⚠ 建议 Node 18 以上，当前 $NODE_VER 可能会有兼容问题"
fi

if ! command -v mysql >/dev/null 2>&1; then
  c_warn "  ⚠ 未找到 mysql 客户端（可选，仅用于验证数据库连通性）"
fi
echo ""

# ---------- 2. 安装依赖 ----------
echo "----------------------------------------------------------------------------"
echo " 步骤 2/4：安装前后端依赖"
echo "----------------------------------------------------------------------------"
if [ -d backend ] && [ -f backend/package.json ]; then
  c_dim "  安装后端依赖 npm install ..."
  ( cd backend && npm install --silent 2>&1 | tail -3 )
  [ -d backend/node_modules ] && c_ok "  ✓ 后端依赖就绪" || c_err "  ✗ 后端依赖安装失败"
else
  c_err "  ✗ 找不到 backend/package.json，请在 test-platform 根目录下运行本脚本"
  exit 1
fi

if [ -d frontend ] && [ -f frontend/package.json ]; then
  c_dim "  安装前端依赖 npm install ..."
  ( cd frontend && npm install --silent 2>&1 | tail -3 )
  [ -d frontend/node_modules ] && c_ok "  ✓ 前端依赖就绪" || c_err "  ✗ 前端依赖安装失败"
fi
echo ""

# ---------- 3. 生成 .env ----------
echo "----------------------------------------------------------------------------"
echo " 步骤 3/4：配置 backend/.env"
echo "----------------------------------------------------------------------------"
cd backend || exit 1
if [ -f .env ]; then
  c_warn "  .env 已存在，跳过（不覆盖你的本地配置）"
else
  cp .env.example .env
  c_ok "  ✓ 已从 .env.example 复制"
fi

# 用脚本读取原有配置，在末尾追加/覆盖开发库与 AI 配置
# （node 不可用时退化为 sed）
upsert_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env 2>/dev/null; then
    # macOS sed 需要 -i ''
    sed -i '' "s|^${key}=.*|${key}=${val}|" .env 2>/dev/null \
      || sed -i "s|^${key}=.*|${key}=${val}|" .env 2>/dev/null
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

upsert_env DB_HOST "${DB_HOST}"
upsert_env DB_PORT "${DB_PORT}"
upsert_env DB_USER "${DB_USER}"
upsert_env DB_PASSWORD "${DB_PASSWORD}"
upsert_env DB_NAME "${DB_NAME}"
upsert_env DEEPSEEK_API_KEY "$AI_KEY"
upsert_env NODE_ENV development
c_ok "  ✓ 已写入开发库与 AI 配置"
c_dim "  提示：start-dev.sh 会把 .env 里这些值注入进程环境（db.js 只读 process.env）"
echo ""

# ---------- 4. 验证数据库 ----------
echo "----------------------------------------------------------------------------"
echo " 步骤 4/4：验证开发库连通性"
echo "----------------------------------------------------------------------------"
if command -v mysql >/dev/null 2>&1; then
  if mysql -u"${DB_USER}" -p"${DB_PASSWORD}" -h "${DB_HOST}" -P "${DB_PORT}" -e "SELECT 1;" "${DB_NAME}" >/dev/null 2>&1; then
    TBL=$(mysql -u"${DB_USER}" -p"${DB_PASSWORD}" -h "${DB_HOST}" -P "${DB_PORT}" -N -e \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}';" 2>/dev/null)
    c_ok "  ✓ 开发库可连接（${DB_NAME}，共 ${TBL:-?} 张表）"
  else
    c_err "  ✗ 连不上开发库 ${DB_HOST}:${DB_PORT}/${DB_NAME}"
    echo ""
    echo "  排查："
    echo "    1. 确认你和负责人在同一个局域网"
    echo "    2. 确认负责人 Mac 上的 MariaDB 已启动：brew services list | grep mariadb"
    echo "    3. 确认 IP 没变：ping ${DB_HOST}"
    echo "    4. IP 可能随网络变化，向负责人确认最新地址"
  fi
else
  c_warn "  跳过（无 mysql 客户端）"
fi
echo ""

# ---------- 完成 ----------
echo "============================================================================"
c_ok " 配置完成，开始工作吧"
echo "============================================================================"
echo ""
echo "  启动开发环境：  ./start-dev.sh"
echo "  查看状态：      ./start-dev.sh status"
echo "  停止：          ./start-dev.sh stop"
echo ""
echo "  端口：后端 3888 / 前端 5174（被占用就改 start-dev.sh 顶部默认值）"
echo "  完整协作说明见：COLLABORATION.md"
echo ""