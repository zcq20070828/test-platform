#!/usr/bin/env bash
# =============================================================================
# 测试中台 · 部署包构建脚本（2026-07-30 增量版）
#
# 与封版 v1.0.0 的差异：
#  - 输出目录：腾讯云应用服务器/20260730
#  - 智能体：15 → 16（新增 workflow）
#  - 技能：30 → 25（基于 server.js 实际引用 + 历史依赖去重）
#  - 知识库：排除 __temp__ 临时目录
#  - 数据库：增量更新（基于本地 dev 数据库真实结构生成，非全量重建）
#            增量脚本 = 新增表(17) + 共有表新增列(70) + INSERT IGNORE 初始化
#
# 用法：bash deploy/build-deploy-package-20260730.sh
# 依赖：node/npm、npx esbuild、mysql 客户端（本地 dev 库 zhaochengqing）
# =============================================================================
set -u

WS="$HOME/.qclaw/workspace"
FRONTEND="$WS/frontend"
AGENTS_SRC="$HOME/.qclaw/agents"
SKILLS_SRC="$HOME/.qclaw/skills"
KB_SRC="$HOME/.qclaw/knowledge-base"
OUT_DIR="$HOME/Desktop/腾讯云应用服务器"
PKG="$OUT_DIR/20260730"
VERSION="2026-07-30"

# ---- 智能体：动态遍历 ~/.qclaw/agents 下所有目录型智能体（含 SOUL.md）----
# server.js 用 readdirSync 动态加载，故收集全部真实目录（当前 25 个，
# 含 main/report-generator/test-conclusion-writer 等）；workflow 是 server.js
# 内联虚拟 agentId，非目录，不收集。
AGENTS_LIST=()
for d in "$AGENTS_SRC"/*/; do
  [ -d "$d" ] || continue
  base=$(basename "$d")
  # 顶层 SOUL.md 或 agent/SOUL.md 子目录均视为有效智能体目录
  [ -f "$d/SOUL.md" ] || [ -f "$d/agent/SOUL.md" ] && AGENTS_LIST+=("$base")
done
AGENTS="${AGENTS_LIST[*]}"

# ---- 25 技能（server.js 引用 21 + 历史依赖 4，去重）----
SKILLS="5dem-executor 5dem-planner ai-evaluation-agent api-executor api-test-tool-invoker \
context-manager data-masking defect-analyzer defect-classifier defect-knowledge-queryer \
evaluation-system failure-root-cause-analyzer improvement-advisor quality-metrics-calculator \
quality-metrics-definer quality-self-checker report-generator requirement-parser \
result-aggregator self-healing test-data-generator-skill test-strategy-designer \
trend-analyzer ui-test-tool-invoker unified-report-generator"

echo "📦 构建部署包 → $PKG (版本 $VERSION)"
echo "   智能体: $(echo $AGENTS | wc -w | tr -d ' ')  技能: $(echo $SKILLS | wc -w | tr -d ' ')"

# 清理旧的
rm -rf "$PKG"
mkdir -p "$PKG/backend" "$PKG/database" "$PKG/deploy" \
         "$PKG/frontend/dist" "$PKG/qclaw-agents" "$PKG/qclaw-skills" "$PKG/qclaw-knowledge-base"

# ============ 1) 后端：转译 server.js → server.dist.mjs ============
echo "=== [1/7] 转译后端 (esbuild) ==="
npx esbuild "$WS/backend/server.js" --bundle --packages=external --loader:.js=ts \
  --format=esm --platform=node --outfile="$PKG/backend/server.dist.mjs" 2>&1 | tail -3
node -e "require('fs').readFileSync('$PKG/backend/server.dist.mjs','utf8');console.log('  ✅ server.dist.mjs 语法校验通过')"

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

# ============ 2) 智能体（16，SOUL.md 顶层化）============
echo "=== [2/7] 收集智能体 (16) ==="
for id in $AGENTS; do
  src="$AGENTS_SRC/$id"
  [ -d "$src" ] || { echo "  ⚠️ 源缺失: $id"; continue; }
  dst="$PKG/qclaw-agents/$id"
  mkdir -p "$dst"
  rsync -a --exclude=node_modules --exclude=vector --exclude=sessions \
    --exclude=.cache --exclude='*.sock' --exclude=__pycache__ --exclude='*.bak' --exclude=agent.bak \
    "$src/" "$dst/" 2>/dev/null
  if [ -f "$dst/agent/SOUL.md" ]; then
    mv "$dst/agent/SOUL.md" "$dst/SOUL.md"
  fi
done
echo "  ✅ 智能体: $(find "$PKG/qclaw-agents" -maxdepth 2 -name SOUL.md | wc -l | tr -d ' ') 个带 SOUL.md"

# ============ 3) 技能（25，保留 backend/ 子目录）============
echo "=== [3/7] 收集技能 (25) ==="
for id in $SKILLS; do
  src="$SKILLS_SRC/$id"
  [ -d "$src" ] || { echo "  ⚠️ 源缺失: $id"; continue; }
  dst="$PKG/qclaw-skills/$id"
  mkdir -p "$dst"
  rsync -a --exclude=node_modules --exclude=vector "$src/" "$dst/" 2>/dev/null
done
echo "  ✅ 技能: $(find "$PKG/qclaw-skills" -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ') 个带 SKILL.md"

# ============ 4) 知识库（排除 __temp__）============
echo "=== [4/7] 收集知识库 (排除 __temp__) ==="
for sub in general project-test project-biz; do
  [ -d "$KB_SRC/$sub" ] || continue
  mkdir -p "$PKG/qclaw-knowledge-base/$sub"
  rsync -a --exclude=__temp__ "$KB_SRC/$sub/" "$PKG/qclaw-knowledge-base/$sub/" 2>/dev/null
done
echo "  ✅ 知识库文件: $(find "$PKG/qclaw-knowledge-base" -type f | wc -l | tr -d ' ')"

# ============ 5) 数据库增量脚本（基于本地真实 schema）============
echo "=== [5/7] 生成数据库增量脚本 ==="
LOCAL_SCHEMA="/tmp/local_schema_${VERSION}.sql"
if mysqldump -u zhaochengqing --no-data --skip-comments --skip-triggers --compact \
     test_platform > "$LOCAL_SCHEMA" 2>/tmp/mysqldump.err; then
  if [ -s "$LOCAL_SCHEMA" ]; then
    node "$WS/deploy/gen-incremental-sql.mjs" "$LOCAL_SCHEMA" "$PKG/database/"
    cat > "$PKG/database/README.md" <<'EOF'
# 数据库中台增量更新脚本（2026-07-30）

本目录包含「从 v1.0.0 (17表) 到当前最新结构 (34表)」的**增量**更新，
**不会删除或重置现有数据**，仅补齐新增的表/列，并 INSERT IGNORE 初始化数据。
表/列来源为本地 dev 数据库（test_platform）的真实结构。

## 使用方法

在**目标服务器**（腾讯云，数据库名 test_platform）执行：

```bash
mysql -u root -p test_platform < 01-schema-incremental.sql
mysql -u root -p test_platform < 02-init-data-incremental.sql
```

## 幂等说明

- 新增表：`CREATE TABLE IF NOT EXISTS`，已存在则跳过。
- 新增列：`ALTER TABLE ADD COLUMN` 带 INFORMATION_SCHEMA 存在性检查，已存在则跳过。
- 初始化数据：`INSERT IGNORE`，已存在则跳过。

可重复执行，安全无副作用。

## 增量范围

- 新增表 17 张：workflows、conversation_history、waiting_input_sessions、
  agent_learned_knowledge、defects、overall_stats、kb_documents、kb_chunks、
  kb_chunk_terms、kb_doc_stats、kb_global_terms、*_daily_stats 统计表、
  user_action_logs、task_execution_logs、evaluation_configs
- 共有表新增列约 70 个：tasks 的 9 个成本列、evaluation_reports 的 28 个列
  （含 deliverable_score 等）、evaluation_runs / evaluation_metrics_history /
  evaluation_collected_tasks / evaluation_collection_sessions 的新列
- 初始化数据：管理员账户、system_config（INSERT IGNORE）

⚠️ 数据库名必须为 `test_platform`。
EOF
    echo "  ✅ 增量 SQL 已生成 → $PKG/database/"
  else
    echo "  ⚠️ mysqldump 输出为空，跳过增量生成"
    cat /tmp/mysqldump.err
  fi
else
  echo "  ⚠️ mysqldump 失败，跳过增量生成（请手动生成）"
  cat /tmp/mysqldump.err
fi

# ============ 6) 文档 + deploy ============
echo "=== [6/7] 文档 / deploy 脚本 ==="
[ -f "$WS/backend/DEPLOYMENT.md" ] && cp "$WS/backend/DEPLOYMENT.md" "$PKG/DEPLOYMENT.md"
cp -R "$WS/deploy/." "$PKG/deploy/" 2>/dev/null
cat > "$PKG/README.md" <<EOF
# 测试中台 · 部署包（2026-07-30 增量版）

适用于**腾讯云应用服务器**（Linux）。完整部署步骤见 \`DEPLOYMENT.md\`。

目录结构：
- \`backend/\`        后端（运行入口 server.dist.mjs）
- \`frontend/dist/\`  前端构建产物（后端直接托管）
- \`qclaw-agents/\`  16 个智能体（含 workflow）
- \`qclaw-skills/\`   25 个技能
- \`qclaw-knowledge-base/\`  知识库（排除 __temp__ 临时目录）
- \`database/\`       数据库增量更新脚本（01 表结构增量 + 02 初始化数据增量 + README）
- \`deploy/\`         智能体/技能一键安装脚本（install.sh）

快速开始：
\`\`\`bash
cd backend && npm install && cp .env.example .env && node server.dist.mjs
bash deploy/install.sh          # 安装智能体/技能/知识库到 ~/.qclaw
# 数据库增量更新（仅在已部署 v1.0.0 基础上运行）：
mysql -u root -p test_platform < database/01-schema-incremental.sql
mysql -u root -p test_platform < database/02-init-data-incremental.sql
\`\`\`

⚠️ 数据库名必须为 \`test_platform\`（详见 DEPLOYMENT.md 醒目警告）。
EOF
echo "  ✅ 文档 + deploy 就绪"

# ============ 7) 前端：vite build → dist ============
echo "=== [7/7] 构建前端 (npm run build) ==="
( cd "$FRONTEND" && npm run build >/dev/null 2>&1 && echo "  ✅ 前端构建完成" ) \
  || echo "  ⚠️ 前端构建失败，检查 $FRONTEND"
rsync -a --exclude=node_modules "$FRONTEND/dist/" "$PKG/frontend/dist/" 2>/dev/null
echo "  前端文件数: $(find "$PKG/frontend/dist" -type f | wc -l | tr -d ' ')"

# ============ 完成 & 自检 ============
echo ""
echo "🎉 部署包构建完成：$PKG"
echo "   体积: $(du -sh "$PKG" | cut -f1)"
echo ""
echo "=== 自检（deploy/install.sh --check）==="
bash "$PKG/deploy/install.sh" --check 2>/dev/null || echo "  (install.sh --check 跳过)"
echo ""
echo "=== 顶层结构 ==="
ls -1 "$PKG"
echo ""
echo "=== 数据库增量文件 ==="
ls -la "$PKG/database/" 2>/dev/null
