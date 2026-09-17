#!/usr/bin/env bash
# =============================================================================
# 测试中台 · 智能体 / 技能 / 知识库 安装脚本（封版 v1.0.0-20260718）
#
# 作用：将部署包内的 qclaw-agents/、qclaw-skills/、qclaw-knowledge-base/
#       安装到目标机的 ~/.qclaw/ 下，使后端能正确加载智能体与技能。
#
# 用法：
#   ./install.sh                 # 安装到 $HOME/.qclaw
#   ./install.sh --home /opt/qclaw   # 安装到指定根目录下的 .qclaw
#   ./install.sh --dry-run      # 仅打印将执行的操作，不实际写入
#   ./install.sh --verify       # 校验已安装内容是否完整（不写入）
#   ./install.sh --check        # 校验部署包本身是否完整（不写入）
#
# 退出码：0 成功 / 1 参数错误 / 2 包不完整 / 3 安装校验失败
# =============================================================================

set -u

# ---------- 路径解析 ----------
# 脚本位于 <包>/deploy/install.sh，包根为其父目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 目标 QClaw 根目录（默认 $HOME/.qclaw）
QCLAW_HOME="${HOME:?环境变量 HOME 未设置}/.qclaw"
DRY_RUN=0
VERIFY_ONLY=0
CHECK_ONLY=0

# ---------- 参数解析 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --home)     QCLAW_HOME="$2/.qclaw"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --verify)   VERIFY_ONLY=1; shift ;;
    --check)    CHECK_ONLY=1; shift ;;
    -h|--help)  sed -n '3,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

AGENTS_SRC="$PKG_ROOT/qclaw-agents"
SKILLS_SRC="$PKG_ROOT/qclaw-skills"
KB_SRC="$PKG_ROOT/qclaw-knowledge-base"

AGENTS_DST="$QCLAW_HOME/agents"
SKILLS_DST="$QCLAW_HOME/skills"
KB_DST="$QCLAW_HOME/knowledge-base"

# ---------- 颜色 ----------
if [ -t 1 ]; then
  C_GREEN=$'\033[0;32m'; C_RED=$'\033[0;31m'; C_YEL=$'\033[0;33m'; C_NC=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YEL=''; C_NC=''
fi
ok(){ echo "${C_GREEN}✅ $*${C_NC}"; }
no(){ echo "${C_RED}❌ $*${C_NC}"; }
wn(){ echo "${C_YEL}⚠️  $*${C_NC}"; }
info(){ echo "ℹ️  $*"; }

# =============================================================================
# 1) --check：校验部署包本身完整性
# =============================================================================
if [ "$CHECK_ONLY" -eq 1 ]; then
  info "校验部署包完整性：$PKG_ROOT"
  rc=0
  [ -d "$AGENTS_SRC" ] || { no "缺失 qclaw-agents/"; rc=2; }
  [ -d "$SKILLS_SRC" ] || { no "缺失 qclaw-skills/"; rc=2; }
  [ -d "$KB_SRC" ] || { no "缺失 qclaw-knowledge-base/"; rc=2; }
  cnt_agents=0; miss_soul=0
  for d in "$AGENTS_SRC"/*/; do
    [ -d "$d" ] || continue
    cnt_agents=$((cnt_agents+1))
    base="$(basename "$d")"
    [ -f "$d/SOUL.md" ] || { wn "智能体缺 SOUL.md: $base"; miss_soul=$((miss_soul+1)); }
  done
  cnt_skills=0; miss_skill=0
  for d in "$SKILLS_SRC"/*/; do
    [ -d "$d" ] || continue
    cnt_skills=$((cnt_skills+1))
    base="$(basename "$d")"
    [ -f "$d/SKILL.md" ] || { wn "技能缺 SKILL.md: $base"; miss_skill=$((miss_skill+1)); }
  done
  info "包内智能体: $cnt_agents（缺 SOUL.md: $miss_soul）  技能: $cnt_skills（缺 SKILL.md: $miss_skill）"
  [ "$rc" -eq 0 ] && ok "部署包完整性校验通过" || no "部署包不完整"
  exit $rc
fi

# =============================================================================
# 2) --verify：校验目标机已安装内容
# =============================================================================
if [ "$VERIFY_ONLY" -eq 1 ]; then
  info "校验已安装内容：$QCLAW_HOME"
  rc=0
  [ -d "$AGENTS_DST" ] || { no "目录不存在: $AGENTS_DST"; exit 3; }
  # 期望的智能体 = 包内列出的
  for d in "$AGENTS_SRC"/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    if [ -f "$AGENTS_DST/$base/SOUL.md" ]; then
      ok "智能体已安装: $base"
    else
      no "智能体缺失: $base"; rc=3
    fi
  done
  for d in "$SKILLS_SRC"/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    if [ -f "$SKILLS_DST/$base/SKILL.md" ]; then
      ok "技能已安装: $base"
    else
      no "技能缺失: $base"; rc=3
    fi
  done
  # 知识库
  if [ -d "$KB_SRC" ]; then
    for sub in "$KB_SRC"/*/; do
      [ -d "$sub" ] || continue
      base="$(basename "$sub")"
      [ -d "$KB_DST/$base" ] && ok "知识库已安装: $base" || { no "知识库缺失: $base"; rc=3; }
    done
  fi
  [ "$rc" -eq 0 ] && ok "目标机安装校验通过" || no "目标机安装不完整"
  exit $rc
fi

# =============================================================================
# 3) 安装
# =============================================================================
info "安装目标: $QCLAW_HOME"
info "包根: $PKG_ROOT"

[ -d "$AGENTS_SRC" ] || { no "包内缺失 qclaw-agents/"; exit 2; }
[ -d "$SKILLS_SRC" ] || { no "包内缺失 qclaw-skills/"; exit 2; }

run(){ if [ "$DRY_RUN" -eq 1 ]; then echo "  [dry-run] $*"; else eval "$@"; fi; }

# 创建目录
for dir in "$AGENTS_DST" "$SKILLS_DST" "$KB_DST"; do
  if [ ! -d "$dir" ]; then
    info "创建目录: $dir"
    run "mkdir -p '$dir'" || { no "创建失败: $dir"; exit 3; }
  fi
done

# 复制智能体（保留子目录结构，已排除 sessions/向量/软链）
info "安装智能体 → $AGENTS_DST"
for d in "$AGENTS_SRC"/*/; do
  [ -d "$d" ] || continue
  base="$(basename "$d")"
  info "  + $base"
  run "rm -rf '$AGENTS_DST/$base'"
  run "cp -R '$d' '$AGENTS_DST/$base'"
done

# 复制技能
info "安装技能 → $SKILLS_DST"
for d in "$SKILLS_SRC"/*/; do
  [ -d "$d" ] || continue
  base="$(basename "$d")"
  info "  + $base"
  run "rm -rf '$SKILLS_DST/$base'"
  run "cp -R '$d' '$SKILLS_DST/$base'"
done

# 复制知识库
if [ -d "$KB_SRC" ]; then
  info "安装知识库 → $KB_DST"
  for sub in "$KB_SRC"/*/; do
    [ -d "$sub" ] || continue
    base="$(basename "$sub")"
    info "  + $base"
    run "rm -rf '$KB_DST/$base'"
    run "cp -R '$sub' '$KB_DST/$base'"
  done
fi

if [ "$DRY_RUN" -eq 1 ]; then
  wn "dry-run 完成，未做任何写入。去掉 --dry-run 执行真实安装。"
  exit 0
fi

# =============================================================================
# 4) 安装后校验
# =============================================================================
info "安装后校验..."
rc=0
for d in "$AGENTS_SRC"/*/; do
  [ -d "$d" ] || continue
  base="$(basename "$d")"
  [ -f "$AGENTS_DST/$base/SOUL.md" ] || { no "安装后缺失: $base/SOUL.md"; rc=3; }
done
for d in "$SKILLS_SRC"/*/; do
  [ -d "$d" ] || continue
  base="$(basename "$d")"
  [ -f "$SKILLS_DST/$base/SKILL.md" ] || { no "安装后缺失: $base/SKILL.md"; rc=3; }
done

n_agents=$(find "$AGENTS_DST" -maxdepth 2 -name SOUL.md | wc -l | tr -d ' ')
n_skills=$(find "$SKILLS_DST" -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')
if [ "$rc" -eq 0 ]; then
  ok "安装完成：智能体 $n_agents 个，技能 $n_skills 个 → $QCLAW_HOME"
  info "提示：安装后请重启后端使智能体/技能生效。"
else
  no "安装校验失败"
fi
exit $rc
