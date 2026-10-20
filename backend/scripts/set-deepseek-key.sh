#!/usr/bin/env bash
# ============================================================================
# set-deepseek-key.sh — 安全写入 DeepSeek API Key 到 backend/.env
#
# 用法：
#   ./backend/scripts/set-deepseek-key.sh
#   ./backend/scripts/set-deepseek-key.sh --check   # 只校验当前 Key 是否可用
#
# 设计要点：
#   1. 交互式读取（不回显），避免 Key 出现在 shell history / 聊天记录 / ps 输出里；
#   2. 原子写入（临时文件 + mv），失败不会留下半截 .env；
#   3. 写完立刻调一次 DeepSeek /models 做真实连通校验；
#   4. 文件权限强制 600；
#   5. 不打印 Key 本身，只打印 sk-***末4位。
#
# 环境变量 ENV_FILE 可覆盖目标文件（供测试用）。
# ============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/backend/.env}"
API_URL="https://api.deepseek.com/models"

c_ok()   { printf '\033[0;32m✅ %s\033[0m\n' "$1"; }
c_warn() { printf '\033[0;33m⚠️  %s\033[0m\n' "$1"; }
c_err()  { printf '\033[0;31m❌ %s\033[0m\n' "$1"; }
c_dim()  { printf '\033[0;90m   %s\033[0m\n' "$1"; }

read_key_from_env_file() {
  [ -f "$ENV_FILE" ] || { echo ""; return; }
  grep -E '^DEEPSEEK_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true
}

mask_key() {
  local k="$1"
  if [ ${#k} -le 7 ]; then echo "***"; else echo "${k:0:3}***${k: -4}"; fi
}

verify_key() {
  # $1 = key；返回 0=可用，非 0=不可用。只输出状态码，不输出 Key。
  local key="$1" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 20 \
    "$API_URL" -H "Authorization: Bearer $key" 2>/dev/null || echo "000")"
  echo "$code"
}

# ---------- --check 模式 ----------
if [ "${1:-}" = "--check" ]; then
  CUR="$(read_key_from_env_file)"
  if [ -z "$CUR" ]; then c_err "$ENV_FILE 里没有 DEEPSEEK_API_KEY"; exit 1; fi
  echo "当前 Key: $(mask_key "$CUR")"
  CODE="$(verify_key "$CUR")"
  case "$CODE" in
    200) c_ok "Key 有效（HTTP 200）" ;;
    401) c_err "Key 无效或已被吊销（HTTP 401）" ; exit 1 ;;
    402) c_warn "Key 可识别但余额不足（HTTP 402）" ; exit 1 ;;
    000) c_err "无法连接 api.deepseek.com（网络/代理问题）" ; exit 1 ;;
    *)   c_warn "HTTP $CODE" ; exit 1 ;;
  esac
  exit 0
fi

# ---------- 写入模式 ----------
[ -f "$ENV_FILE" ] || { c_err "找不到 $ENV_FILE"; exit 1; }

OLD="$(read_key_from_env_file)"
if [ -n "$OLD" ]; then
  echo "当前 Key: $(mask_key "$OLD")"
  OLD_CODE="$(verify_key "$OLD")"
  if [ "$OLD_CODE" = "200" ]; then
    c_warn "旧 Key 仍有效（HTTP 200）——写入新 Key 后请务必去控制台吊销它"
  fi
else
  c_warn "当前 .env 未配置 DEEPSEEK_API_KEY"
fi
echo

printf '请粘贴新的 DEEPSEEK_API_KEY（输入不回显，粘贴后按回车）: '
read -rs NEW_KEY
echo
NEW_KEY="$(printf '%s' "$NEW_KEY" | tr -d ' \t\r\n"'"'")"

# ---------- 校验格式 ----------
if [ -z "$NEW_KEY" ]; then c_err "未输入内容"; exit 1; fi
case "$NEW_KEY" in
  sk-*) ;;
  *) c_err "格式不正确：DeepSeek Key 应以 sk- 开头"; exit 1 ;;
esac
if [ ${#NEW_KEY} -lt 20 ]; then
  c_err "长度过短（${#NEW_KEY}），看起来不像完整 Key"; exit 1
fi
if [ "$NEW_KEY" = "$OLD" ]; then
  c_warn "新 Key 与旧 Key 完全相同，未做改动"; exit 0
fi

# ---------- 真实连通校验（先验后写，避免把坏 Key 写进配置） ----------
echo "正在校验新 Key..."
CODE="$(verify_key "$NEW_KEY")"
case "$CODE" in
  200) c_ok "新 Key 校验通过（HTTP 200）" ;;
  401) c_err "新 Key 无效（HTTP 401），未写入。请确认是否复制完整/已被吊销"; exit 1 ;;
  402) c_warn "新 Key 可识别但余额不足（HTTP 402），仍会写入，请充值后使用" ;;
  000) c_err "无法连接 api.deepseek.com，未写入。请检查网络或代理"; exit 1 ;;
  *)   c_err "校验失败（HTTP $CODE），未写入"; exit 1 ;;
esac

# ---------- 原子写入 ----------
TMP="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
if grep -qE '^DEEPSEEK_API_KEY=' "$ENV_FILE"; then
  # 用 awk 替换（避免 sed 在 macOS 上的 -i 差异与特殊字符问题）
  awk -v key="$NEW_KEY" '
    /^DEEPSEEK_API_KEY=/ && !done { print "DEEPSEEK_API_KEY=" key; done=1; next }
    { print }
  ' "$ENV_FILE" > "$TMP"
else
  cat "$ENV_FILE" > "$TMP"
  printf '\nDEEPSEEK_API_KEY=%s\n' "$NEW_KEY" >> "$TMP"
fi
chmod 600 "$TMP"
mv "$TMP" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"

c_ok "已写入 ${ENV_FILE}（权限 600）"
echo "   新 Key: $(mask_key "$NEW_KEY")"

# ---------- 后置校验：确认文件里确实是新 Key ----------
SAVED="$(read_key_from_env_file)"
if [ "$SAVED" = "$NEW_KEY" ]; then
  c_ok "落盘校验通过"
else
  c_err "落盘校验失败：文件中的值与写入值不一致"
  exit 1
fi

echo
echo "下一步："
echo "  1) 重启后端让新 Key 生效：  ./start-dev.sh restart"
echo "     （或后台进程方式：        ./deploy/deploy.sh --restart）"
echo "  2) 去 DeepSeek 控制台吊销旧 Key$( [ -n "$OLD" ] && echo "（$(mask_key "$OLD")）" )"
echo "  3) 重启后确认日志只显示： [Deepseek] API Key: sk-***$(printf '%s' "$NEW_KEY" | tail -c 4)"
