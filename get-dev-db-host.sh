#!/bin/zsh
# ============================================================================
# get-dev-db-host.sh — 获取开发库可访问地址（自动探测，适配换网络）
#
# 用法:
#   ./get-dev-db-host.sh              # 只打印探测到的 IP
#   ./get-dev-db-host.sh --md         # 输出 Markdown 表格行（发文档用）
#   ./get-dev-db-host.sh --check      # 连通性自检
#
# 背景（2026-10-12 踩坑记录）:
#   开发库跑在本机 MariaDB 上，此前把 IP 写死在 .env.example / 手册里，
#   换网络后（192.168.43.4 → 192.168.151.45）全部失效。
#   本脚本改为运行时探测，避免重复改文件。
# ============================================================================

set -u

# ---------- 探测当前 IP ----------
#策略：默认路由所在接口优先（一定能上网的那块网卡），退回到逐个 en*探测
detect_ip(){
  local iface ip

  # 1) 默认路由接口（最准：这块网卡一定有局域网 IP 且能连同事）
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [ -n "$iface" ]; then
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"
    if [ -n "$ip" ]; then echo "$ip"; return 0; fi
  fi

  # 2) 逐个尝试常见接口（跳过回环与虚拟网卡）
  for iface in $(ifconfig -l 2>/dev/null | grep -E '^(en[0-9]+)'); do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"
    [ -n "$ip" ] && { echo "$ip"; return 0; }
  done

  return 1
}

HOST="$(detect_ip)"
if [ -z "$HOST" ]; then
  printf "\033[31m✗ 未能探测到本机局域网 IP\033[0m\n"
  printf "  请手动执行：ipconfig getifaddr en0\n"
  exit 1
fi

# ---------- 输出 ----------
case "${1:-}" in
  --md)
    printf '| 库地址 | `%s:3306`（负责人 Mac，换网络后需重跑 `./get-dev-db-host.sh`） |\n' "$HOST"
    ;;
  --check)
    printf "\033[2m探测到本机 IP: \033[0m\033[1m%s\033[0m\n" "$HOST"
    printf "\033[2m测试开发库连通性...\033[0m\n"
    if command -v mysql >/dev/null 2>&1; then
      if mysql -uappuser -papppwd123 -h "$HOST" -P 3306 \
           -e "SELECT 1;" test_platform_dev >/dev/null 2>&1; then
        TBL=$(mysql -uappuser -papppwd123 -h "$HOST" -P 3306 -N -e \
          "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='test_platform_dev';" 2>/dev/null)
        printf "\033[32m  ✓ 开发库可连接\033[0m（test_platform_dev，%s 张表）\n" "${TBL:-?}"
        printf "\n  同事 .env 应配：DB_HOST=%s\n" "$HOST"
      else
        printf "\033[31m  ✗ 连不上开发库\033[0m\n"
        printf "  检查：\n"
        printf "    1. MariaDB 是否在跑：brew services list | grep maria\n"
        printf "    2. 是否允许远程连接：应存在 /opt/homebrew/etc/my.cnf.d/test-platform-dev.cnf\n"
        printf "       内容需含 bind-address = 0.0.0.0\n"
      fi
    else
      printf "\033[33m  跳过检查（无 mysql 客户端）\033[0m\n"
    fi
    ;;
  *)
    echo "$HOST"
    ;;
esac