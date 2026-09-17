#!/usr/bin/env bash
# =============================================================================
# 测试中台 · 部署包构建脚本（封版 v1.0.0-20260718）
#
# 从最新代码全量重建部署包：转译后端、构建前端、收集智能体/技能/知识库、
# 拷贝数据库脚本与文档。产物直接放入「腾讯云应用服务器」文件夹。
#
# 用法：bash deploy/build-deploy-package.sh
# 依赖：node/npm、npx esbuild、jq（可选）、mysql 客户端（仅 DB 重导出用）
# =============================================================================
set -u

WS="/Users/zhaochengqing/.qclaw/workspace"
FRONTEND="$WS/frontend"
AGENTS_SRC="$HOME/.qclaw/agents"
SKILLS_SRC="$HOME/.qclaw/skills"
KB_SRC="$HOME/.qclaw/knowledge-base"
OLD_PKG="$HOME/Desktop/test-platform-2026-07-18"   # 旧包（取 database/ 脚本）

OUT_DIR="$HOME/Desktop/腾讯云应用服务器"
PKG="$OUT_DIR/test-platform-v1.0.0-20260718"

# ---- 权威 15 智能体（来自 server.js AGENTS 对象）----
AGENTS="test-master test-requirement-analyzer test-case-generator test-data-generator \
defect-analyzer test-reporter data-masking test-script-generator ui-e2e-executor \
api-executor test-scheme-generator ai-quality-reviewer-1 ai-quality-reviewer-2 \
ai-quality-reviewer-3 ai-evaluation-agent"

# ---- 被引用的 30 技能（server.js skillHints + 可执行技能）----
SKILLS="5dem-executor 5dem-planner ai-evaluation-agent api-executor api-test-tool-invoker \
context-manager data-masking defect-analyzer defect-classifier defect-knowledge-queryer \
evaluation-system failure-root-cause-analyzer improvement-advisor quality-metrics-calculator \
quality-metrics-definer quality-self-checker report-generator requirement-parser \
result-aggregator self-healing test-case-generator test-data-generator-skill \
test-data-generator test-master test-reporter test-scheme-generator test-strategy-designer \
trend-analyzer ui-e2e-executor ui-test-tool-invoker"

echo "📦 构建部署包 → $PKG"
rm -rf "$PKG"
mkdir -p "$PKG/backend" "$PKG/database" "$PKG/deploy" \
         "$PKG/frontend/dist" "$PKG/qclaw-agents" "$PKG/qclaw-skills" "$PKG/qclaw-knowledge-base"

# ============ 1) 后端：转译 server.js → server.dist.mjs ============
echo "=== [1/6] 转译后端 (esbuild) ==="
npx esbuild "$WS/backend/server.js" --bundle --packages=external --loader:.js=ts \
  --format=esm --platform=node --outfile="$PKG/backend/server.dist.mjs" 2>&1 | tail -3
node -e "require('fs').readFileSync('$PKG/backend/server.dist.mjs','utf8');console.log('  ✅ server.dist.mjs 语法校验通过')"

# 拷贝其余后端文件（排除 node_modules/.env/日志/大目录）
echo "=== 拷贝后端其余文件 ==="
rsync -a --exclude=node_modules --exclude=.env --exclude='*.log' \
  --exclude=output --exclude=test-results --exclude='*.bak' --exclude=.git \
  --exclude=vector --exclude=vector_data --exclude=networks \
  "$WS/backend/" "$PKG/backend/" 2>/dev/null
# 用新转译产物覆盖（rsync 可能拷了旧 dist）
npx esbuild "$WS/backend/server.js" --bundle --packages=external --loader:.js=ts \
  --format=esm --platform=node --outfile="$PKG/backend/server.dist.mjs" >/dev/null 2>&1
# 清理非运行文件（dev 维护脚本 / 备份 / 未用源码 / 空目录）
rm -f "$PKG/backend/"*.bak.* "$PKG/backend/"*.py "$PKG/backend/user-management.ts" \
      "$PKG/backend/fix-prompts.js" "$PKG/backend/fix_prompts_v2.py" \
      "$PKG/backend/fix_reviewer_prompts.py" "$PKG/backend/apply-fixes.js" \
      "$PKG/backend/expand_prompts.py" "$PKG/backend/replace_prompts_simple.py" \
      "$PKG/backend/parse_document.py"
rmdir "$PKG/backend/agents" "$PKG/backend/chroma_db" "$PKG/backend/prompts" 2>/dev/null
echo "  ✅ 后端文件就绪 ($(ls "$PKG/backend" | wc -l | tr -d ' ') 项)"

# ============ 2) 前端：vite build → dist ============
echo "=== [2/6] 构建前端 (npm run build) ==="
( cd "$FRONTEND" && npm run build >/dev/null 2>&1 && echo "  ✅ 前端构建完成" ) \
  || echo "  ⚠️ 前端构建失败，检查 $FRONTEND"
rsync -a --exclude=node_modules "$FRONTEND/dist/" "$PKG/frontend/dist/" 2>/dev/null
echo "  前端文件数: $(find "$PKG/frontend/dist" -type f | wc -l | tr -d ' ')"

# ============ 3) 智能体（15，SOUL.md 顶层化）============
echo "=== [3/6] 收集智能体 (15) ==="
for id in $AGENTS; do
  src="$AGENTS_SRC/$id"
  [ -d "$src" ] || { echo "  ⚠️ 源缺失: $id"; continue; }
  dst="$PKG/qclaw-agents/$id"
  mkdir -p "$dst"
  # 拷贝整个智能体目录，排除大/缓存
  rsync -a --exclude=node_modules --exclude=vector --exclude=sessions \
    --exclude=.cache --exclude='*.sock' "$src/" "$dst/" 2>/dev/null
  # 将 agent/SOUL.md 提到顶层
  if [ -f "$dst/agent/SOUL.md" ]; then
    mv "$dst/agent/SOUL.md" "$dst/SOUL.md"
  fi
done
echo "  ✅ 智能体: $(find "$PKG/qclaw-agents" -maxdepth 2 -name SOUL.md | wc -l | tr -d ' ') 个带 SOUL.md"

# ============ 4) 技能（30，保留 backend/ 子目录）============
echo "=== [4/6] 收集技能 (30) ==="
for id in $SKILLS; do
  src="$SKILLS_SRC/$id"
  [ -d "$src" ] || { echo "  ⚠️ 源缺失: $id"; continue; }
  dst="$PKG/qclaw-skills/$id"
  mkdir -p "$dst"
  rsync -a --exclude=node_modules --exclude=vector "$src/" "$dst/" 2>/dev/null
done
echo "  ✅ 技能: $(find "$PKG/qclaw-skills" -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ') 个带 SKILL.md"

# ============ 5) 知识库（118 文档）============
echo "=== [5/6] 收集知识库 ==="
for sub in general project-test project-biz; do
  [ -d "$KB_SRC/$sub" ] || continue
  mkdir -p "$PKG/qclaw-knowledge-base/$sub"
  rsync -a "$KB_SRC/$sub/" "$PKG/qclaw-knowledge-base/$sub/" 2>/dev/null
done
echo "  ✅ 知识库文件: $(find "$PKG/qclaw-knowledge-base" -type f | wc -l | tr -d ' ')"

# ============ 6) 数据库脚本 + 文档 + deploy ============
echo "=== [6/6] 数据库脚本 / 文档 / deploy ==="
# 数据库脚本（v1.0.0 手写版，幂等；来自旧包以保持版本一致）
if [ -d "$OLD_PKG/database" ]; then
  cp "$OLD_PKG/database/"* "$PKG/database/" 2>/dev/null
fi
# 最新 DEPLOYMENT.md（含醒目警告）
[ -f "$WS/backend/DEPLOYMENT.md" ] && cp "$WS/backend/DEPLOYMENT.md" "$PKG/DEPLOYMENT.md"
# deploy/ 安装脚本（最新）
cp -R "$WS/deploy/." "$PKG/deploy/" 2>/dev/null
# 包级 README
cat > "$PKG/README.md" <<EOF
# 测试中台 · 部署包（封版 v1.0.0-20260718）

适用于**腾讯云应用服务器**（Linux）。完整部署步骤见 \`DEPLOYMENT.md\`。

目录结构：
- \`backend/\`        后端（运行入口 server.dist.mjs）
- \`frontend/dist/\`  前端构建产物（后端直接托管）
- \`qclaw-agents/\`  15 个智能体
- \`qclaw-skills/\`   30 个技能
- \`qclaw-knowledge-base/\`  知识库（118 文档）
- \`database/\`       01 建库 + 02 初始化数据
- \`deploy/\`         智能体/技能一键安装脚本（install.sh）

快速开始：
\`\`\`bash
cd backend && npm install && cp .env.example .env && node server.dist.mjs
bash deploy/install.sh          # 安装智能体/技能/知识库到 ~/.qclaw
\`\`\`

⚠️ 数据库名必须为 \`test_platform\`（详见 DEPLOYMENT.md 醒目警告）。
EOF
echo "  ✅ 数据库脚本 + 文档 + deploy 就绪"

# ============ 完成 & 自检 ============
echo ""
echo "🎉 部署包构建完成：$PKG"
echo "   体积: $(du -sh "$PKG" | cut -f1)"
echo ""
echo "=== 自检（deploy/install.sh --check）==="
bash "$PKG/deploy/install.sh" --check
echo ""
echo "=== 顶层结构 ==="
ls -1 "$PKG"
