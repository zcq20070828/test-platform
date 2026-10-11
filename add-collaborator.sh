#!/bin/zsh
# ============================================================================
# add-collaborator.sh — 测试中台远程仓库 · 成员公钥授权登记
#
# 用法(在项目根目录执行):
#   ./add-collaborator.sh <姓名>            # 生成/读取本机公钥并输出待登记内容
#   ./add-collaborator.sh <姓名> --show     # 只看当前登记状态
#
# 作用:
#   把本机 SSH 公钥整理成「带命令白名单限制」的 authorized_keys 条目，
#   你复制粘贴到服务器即可完成授权（需服务器管理权限）。
#
# 安全设计:
#   授权条目带 command= 前缀 + no-port-forwarding/no-X11/no-pty，
#   使该账号只能对本仓库执行 git 读写，无法登录服务器执行其他命令。
# ============================================================================

set -e

GIT_HOST="42.194.137.114"
GIT_USER="dev"
GIT_REPO="/opt/git/test-platform.git"
GIT_ALIAS="testplatform-git"
FORCE_CMD="/usr/local/bin/git-force-wrapper"

c_ok()   { printf "\033[32m%s\033[0m\n" "$1"; }
c_warn() { printf "\033[33m%s\033[0m\n" "$1"; }
c_err()  { printf "\033[31m%s\033[0m\n" "$1"; }
c_dim()  { printf "\033[2m%s\033[0m\n" "$1"; }

NAME="${1:-}"
SHOW_ONLY=0
[[ "${2:-}" == "--show" ]] && SHOW_ONLY=1

if [[ -z "$NAME" ]]; then
  c_err "用法: $0 <姓名> [--show]"
  echo ""
  echo "示例:"
  echo "  $0 张三              # 登记张三（本机公钥）"
  echo "  $0 张三 --show       # 只看当前状态"
  exit 1
fi

echo ""
c_ok "测试中台 · 成员授权登记 —— $NAME"
echo "============================================================================"
echo ""

# ---------- 1. 确保 SSH 密钥存在 ----------
KEY="$HOME/.ssh/id_ed25519"
if [[ ! -f "$KEY" ]]; then
  c_warn "未找到本机 SSH 密钥，正在生成..."
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "$NAME@workbuddy" >/dev/null 2>&1
  c_ok "已生成: $KEY"
else
  c_ok "使用已有密钥: $KEY"
fi
PUBKEY=$(cat "$KEY.pub")
FINGERPRINT=$(ssh-keygen -lf "$KEY.pub" | awk '{print $2}')

echo ""
echo "  指纹: $FINGERPRINT"
echo ""

if [[ $SHOW_ONLY -eq 1 ]]; then
  c_dim "（--show 模式，未做任何修改）"
  echo ""
  echo "当前本机公钥内容："
  echo "$PUBKEY"
  echo ""
  echo "登记方式见下方「登记步骤」（跳过第1步）。"
  echo ""
  exit 0
fi

# ---------- 2. 检查本机 SSH config 是否已配好别名 ----------
echo "----------------------------------------------------------------------------"
echo " 步骤 1/3：确认本机 ~/.ssh/config"
echo "----------------------------------------------------------------------------"
CFG="$HOME/.ssh/config"
if [[ -f "$CFG" ]] && grep -q "Host $GIT_ALIAS" "$CFG"; then
  c_ok "已配置别名 $GIT_ALIAS"
else
  c_warn "尚未配置 SSH 别名，请把下面段落追加到 ~/.ssh/config（已有文件勿覆盖）："
  echo ""
  cat <<CFGEOF
Host $GIT_ALIAS
    HostName $GIT_HOST
    User $GIT_USER
    Port 22
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    PreferredAuthentications publickey
    BatchMode yes
    StrictHostKeyChecking accept-new
CFGEOF
  echo ""
  echo "  加完后执行: chmod 600 ~/.ssh/config"
fi
echo ""

# ---------- 3. 输出现场登记用的 authorized_keys 条目 ----------
echo "----------------------------------------------------------------------------"
echo " 步骤 2/3：登记到服务器（需服务器管理权限）"
echo "----------------------------------------------------------------------------"
echo ""
c_dim "执行下面命令（会提示输入服务器 root 密码），把 $NAME 加入授权："
echo ""
echo "  ssh root@$GIT_HOST \"bash -s\" <<'EOS'"
# 公钥里含斜杠/加号/等号，直接内联会被二次展开；用 base64 安全传递
PUB_B64=$(printf '%s' "$PUBKEY" | base64 | tr -d '\n')
cat <<EOS
PUB=\$(echo '$PUB_B64' | base64 -d)
mkdir -p /home/$GIT_USER/.ssh && chmod 700 /home/$GIT_USER/.ssh
touch /home/$GIT_USER/.ssh/authorized_keys && chmod 600 /home/$GIT_USER/.ssh/authorized_keys
if ! grep -qF "\$PUB" /home/$GIT_USER/.ssh/authorized_keys; then
  echo "command=\"$FORCE_CMD\",no-port-forwarding,no-X11-forwarding,no-pty \$PUB" >> /home/$GIT_USER/.ssh/authorized_keys
  echo "已登记 $NAME"
else
  echo "$NAME 的公钥已存在，跳过"
fi
chown -R $GIT_USER:$GIT_USER /home/$GIT_USER/.ssh
EOS
echo ""
echo ""

# ---------- 4. 验证 ----------
echo "----------------------------------------------------------------------------"
echo " 步骤 3/3：验证连通"
echo "----------------------------------------------------------------------------"
echo ""
c_dim "在 $NAME 的电脑上执行："
echo ""
echo "  git clone $GIT_ALIAS:$GIT_REPO"
echo ""
echo "看到分支列表即成功。常见问题见 COLLABORATION.md 第七节。"
echo ""
echo "============================================================================"
c_ok "完成：$NAME 现在可以拉取和推送代码"
echo "============================================================================"
echo ""

# ---------- 5. 安全提示 ----------
cat <<'SECEOF'
安全说明：
  · 授权条目带 command= 限制，该账号只能执行 git 操作
  · no-port-forwarding/no-X11/no-pty 禁止端口转发与终端分配
  · 真实 API Key 不在仓库里，由负责人线下分发到各自 .env

SECEOF