#!/usr/bin/env bash
# =============================================================================
# 测试中台 · 部署包构建脚本（重写版 2026-11-23）
#
# 与旧版的根本区别：**技能清单不再手写，从代码里的实际引用自动推导**。
#
# 旧版为什么必须重写：
#   - 旧脚本的 SKILLS 是写死的 30 个名字，路径指向 ~/.qclaw/skills（已不存在）；
#   - 代码里 server.js 通过 SKILL_EXECUTORS 动态 import 一组 invoker 文件，
#     这些路径构建期完全不校验，打进包里漏了也不会报错；
#   - 结果：生产长期缺 9dem-planner/9dem-executor 的 6 个文件，
#     测试用例生成一直没有九维必测点与黑盒9法覆盖，任务却显示成功。
#
# 本版做四件事：
#   1) 用 node 脚本扫描 server.js 里所有 path.join(SKILLS_DIR, ...) 引用，得到权威清单；
#   2) 逐个校验存在性，缺失直接构建失败（不给「打半个包」的机会）；
#   3) 后端用 --bundle 构建（生产没有 backend/lib 目录，不 bundle 会启动失败）；
#   4) 打包时按清单收集整个技能目录（含 SKILL.md / backend / 依赖文件）。
#
# 用法：
#   bash deploy/build-deploy-package.sh [输出目录]
#   默认输出到 ./dist-deploy/test-platform-v1.0.0-<YYYYMMDD>
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STAMP="$(date +%Y%m%d)"
OUT_DIR="${1:-$REPO_ROOT/dist-deploy}"
PKG="$OUT_DIR/test-platform-v1.0.0-$STAMP"

echo "📦 构建部署包 → $PKG"
echo "   仓库根: $REPO_ROOT"

# ---------- 0) 前置检查 ----------
command -v node >/dev/null || { echo "❌ 需要 node"; exit 1; }
[ -f backend/server.js ] || { echo "❌ 找不到 backend/server.js"; exit 1; }
[ -d frontend ] || { echo "❌ 找不到 frontend/"; exit 1; }

# ---------- 1) 从代码推导技能清单并校验 ----------
echo ""
echo "=== [1/6] 从 server.js 推导技能清单 ==="

node --input-type=module - "$REPO_ROOT" <<'NODE_EOF'
import fs from 'node:fs';
import path from 'node:path';

const repo = process.argv[2];
const serverSrc = fs.readFileSync(path.join(repo, 'backend', 'server.js'), 'utf8');

// 1) SKILL_EXECUTORS 里 path.join(SKILLS_DIR, '<dir>', 'backend', '<file>')
const re = /path\.join\(SKILLS_DIR,\s*'([^']+)',\s*'backend',\s*'([^']+)'\)/g;
const mods = new Set();
let m;
while ((m = re.exec(serverSrc))) mods.add(`${m[1]}/backend/${m[2]}`);

// 2) 提示词里提到的 SKILL.md（qclaw-skills/<dir>/SKILL.md）
const mdRe = /qclaw-skills\/([a-z0-9-]+)\/SKILL\.md/g;
const mdDirs = new Set();
while ((m = mdRe.exec(serverSrc))) mdDirs.add(m[1]);

// 3) 关键技能（boot-check.js 的 REQUIRED，缺了交付物残缺）
const bootCheck = fs.readFileSync(path.join(repo, 'backend', 'lib', 'boot-check.js'), 'utf8');
const reqRe = /rel:\s*'([^']+)'/g;
const required = new Set();
while ((m = reqRe.exec(bootCheck))) required.add(m[1]);

const skillsDir = path.join(repo, 'qclaw-skills');

const missingMods = [...mods].filter((p) => !fs.existsSync(path.join(skillsDir, p)));
const missingReq = [...required].filter((p) => !fs.existsSync(path.join(skillsDir, p)));
const missingMd = [...mdDirs].filter((d) => !fs.existsSync(path.join(skillsDir, d, 'SKILL.md')));

const dirs = new Set();
for (const p of mods) dirs.add(p.split('/')[0]);
for (const d of mdDirs) dirs.add(d);
for (const p of required) dirs.add(p.split('/')[0]);

console.log(`  被引用的工具模块: ${mods.size} 个`);
console.log(`  提示词引用的 SKILL.md: ${mdDirs.size} 个`);
console.log(`  关键技能(required): ${required.size} 个`);
console.log(`  → 需打包技能目录: ${dirs.size} 个`);

if (missingReq.length) {
  console.error('\n❌ 关键技能缺失（缺了交付物会静默残缺，拒绝打包）：');
  for (const p of missingReq) console.error(`   - qclaw-skills/${p}`);
  process.exit(1);
}
if (missingMods.length) {
  console.error('\n❌ 被代码引用的工具模块文件缺失：');
  for (const p of missingMods) console.error(`   - qclaw-skills/${p}`);
  console.error('  这些路径在运行时才会 import，缺了不会在构建期报错 —— 所以这里必须拦住。');
  process.exit(1);
}
if (missingMd.length) {
  console.warn('\n⚠️  以下技能目录缺 SKILL.md（智能体提示词会降级）：');
  for (const d of missingMd) console.warn(`   - qclaw-skills/${d}/SKILL.md`);
}

fs.writeFileSync('/tmp/deploy-skill-dirs.txt', [...dirs].sort().join('\n') + '\n');
fs.writeFileSync('/tmp/deploy-skill-mods.txt', [...mods].sort().join('\n') + '\n');
console.log('  ✅ 技能清单校验通过');
NODE_EOF

SKILL_DIR_COUNT=$(wc -l < /tmp/deploy-skill-dirs.txt | tr -d ' ')
echo "  清单已写入 /tmp/deploy-skill-dirs.txt（$SKILL_DIR_COUNT 个目录）"

# ---------- 2) 后端 bundle ----------
echo ""
echo "=== [2/6] 构建后端（--bundle 内联本地模块）==="
mkdir -p "$PKG/backend" "$PKG/database" "$PKG/deploy" "$PKG/frontend/dist" \
         "$PKG/qclaw-agents" "$PKG/qclaw-skills" "$PKG/qclaw-knowledge-base"

( cd backend && npx esbuild server.js \
  --bundle \
  --format=esm \
  --platform=node \
  --packages=external \
  --loader:.js=ts \
  --outfile="$PKG/backend/server.dist.mjs" 2>&1 | tail -3 )

node --check "$PKG/backend/server.dist.mjs" || { echo "❌ dist 语法错误"; exit 1; }
RESIDUAL=$(grep -cE '^import .* from "\./' "$PKG/backend/server.dist.mjs" || true)
if [ "$RESIDUAL" != "0" ]; then
  echo "❌ dist 仍有 $RESIDUAL 处本地相对 import（未内联），生产没有 backend/lib 会启动失败"
  grep -E '^import .* from "\./' "$PKG/backend/server.dist.mjs" | head -5
  exit 1
fi
echo "  ✅ server.dist.mjs 已内联全部本地模块（$(du -h "$PKG/backend/server.dist.mjs" | cut -f1)）"

# ---------- 3) 后端其余文件 ----------
echo ""
echo "=== [3/6] 拷贝后端运行时文件 ==="
# bundle 后不再需要 lib/，但 database/（DAO 走相对 import）与 scripts/ 等仍需要
for d in database scripts security services migrations vector; do
  if [ -d "backend/$d" ]; then
    rsync -a --exclude '__pycache__' --exclude 'node_modules' "backend/$d" "$PKG/backend/"
    echo "  + backend/$d/"
  fi
done
cp backend/package.json "$PKG/backend/" 2>/dev/null || true
cp backend/package-lock.json "$PKG/backend/" 2>/dev/null || true

# ---------- 4) 前端 ----------
echo ""
echo "=== [4/6] 构建前端 ==="
( cd frontend && npm run build 2>&1 | grep -E 'error|✓ built' | tail -2 )
rsync -a frontend/dist/ "$PKG/frontend/dist/"
echo "  ✅ frontend/dist ($(du -sh frontend/dist | cut -f1))"

# ---------- 5) 技能与智能体（按推导清单）----------
echo ""
echo "=== [5/6] 收集技能与智能体 ==="
while IFS= read -r d; do
  [ -z "$d" ] && continue
  if [ -d "qclaw-skills/$d" ]; then
    rsync -a --exclude 'node_modules' --exclude '__pycache__' "qclaw-skills/$d" "$PKG/qclaw-skills/"
  else
    echo "  ⚠️  跳过不存在的技能目录: $d"
  fi
done < /tmp/deploy-skill-dirs.txt
echo "  ✅ qclaw-skills：$(ls "$PKG/qclaw-skills" | wc -l | tr -d ' ') 个目录"

if [ -d qclaw-agents ]; then
  rsync -a --exclude 'node_modules' qclaw-agents/ "$PKG/qclaw-agents/"
  echo "  ✅ qclaw-agents：$(ls "$PKG/qclaw-agents" | wc -l | tr -d ' ') 个"
fi
if [ -d qclaw-knowledge-base ]; then
  rsync -a qclaw-knowledge-base/ "$PKG/qclaw-knowledge-base/"
  echo "  ✅ qclaw-knowledge-base"
fi

# ---------- 6) 数据库脚本与部署工具 ----------
echo ""
echo "=== [6/6] 收集数据库脚本与部署工具 ==="
rsync -a database/ "$PKG/database/"
for f in install.sh README.md verify-deploy.sh; do
  [ -f "deploy/$f" ] && cp "deploy/$f" "$PKG/deploy/"
done
echo "  ✅ database/：$(ls "$PKG/database"/*.sql 2>/dev/null | wc -l | tr -d ' ') 个 sql"

# ---------- 产物清单 ----------
echo ""
echo "=== 产物 ==="
du -sh "$PKG"
echo ""
echo "包内技能模块完整性抽查："
missing_in_pkg=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  if [ ! -f "$PKG/qclaw-skills/$p" ]; then
    echo "  ❌ 包内缺 $p"
    missing_in_pkg=$((missing_in_pkg+1))
  fi
done < /tmp/deploy-skill-mods.txt
if [ "$missing_in_pkg" = "0" ]; then
  echo "  ✅ 全部 $(wc -l < /tmp/deploy-skill-mods.txt | tr -d ' ') 个被引用模块已入包"
else
  echo "  ❌ 有 $missing_in_pkg 个模块未入包"
  exit 1
fi

echo ""
echo "✅ 构建完成：$PKG"
echo ""
echo "部署步骤："
echo "  1) 备份现有部署目录（cp -a <deploy> <deploy>.bak-\$(date +%Y%m%d_%H%M%S)）"
echo "  2) 备份数据库（mysqldump ... | gzip > /root/prod_backup_*/db.sql.gz）"
echo "  3) 按序执行 database/ 下的增量迁移（幂等，只加不删）"
echo "  4) 覆盖 backend/server.dist.mjs 与 frontend/dist/"
echo "  5) 同步 qclaw-skills/（新增目录整个拷过去，不要只拷改动文件）"
echo "  6) pm2 restart test-platform"
echo "  7) 跑 deploy/verify-deploy.sh 确认资源齐备"
