#!/usr/bin/env bash
# =============================================================================
# 部署后验证脚本（2026-11-23）
#
# 用途：部署完在目标机跑一遍，确认运行时资源齐备、服务真的可用。
# 起因：生产曾长期缺 6 个 skill 文件（含九维必测与黑盒9法实现），
#       任务显示成功但交付物残缺，从界面上看不出来。
#
# 用法（在部署目录内）：
#   bash deploy/verify-deploy.sh
#   bash deploy/verify-deploy.sh /opt/test-platform/test-platform-v1.0.0-20260718
# =============================================================================
set -uo pipefail

TARGET="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SKILLS="$TARGET/qclaw-skills"
BACKEND_PORT="${BACKEND_PORT:-3002}"

pass=0; fail=0; warn=0
ok()   { echo "  ✅ $*"; pass=$((pass+1)); }
bad()  { echo "  ❌ $*"; fail=$((fail+1)); }
soft() { echo "  ⚠️  $*"; warn=$((warn+1)); }

echo "=== 部署验证: $TARGET ==="
echo ""

# ---------- 1) 后端产物 ----------
echo "[1/6] 后端产物"
DIST="$TARGET/backend/server.dist.mjs"
if [ -f "$DIST" ]; then
  ok "server.dist.mjs 存在（$(du -h "$DIST" | cut -f1)）"
  if node --check "$DIST" 2>/dev/null; then ok "dist 语法校验通过"; else bad "dist 语法错误"; fi
  RESIDUAL=$(grep -cE '^import .* from "\./' "$DIST" || true)
  if [ "$RESIDUAL" = "0" ]; then
    ok "本地模块已全部内联（生产无 backend/lib 也能跑）"
  else
    bad "dist 有 $RESIDUAL 处本地相对 import，若 backend/lib 不存在会启动失败"
    [ -d "$TARGET/backend/lib" ] && soft "backend/lib 存在，可暂时兜住" || bad "且 backend/lib 不存在"
  fi
else
  bad "缺少 server.dist.mjs"
fi

# ---------- 2) 关键技能 ----------
echo ""
echo "[2/6] 关键技能（缺失会导致交付物残缺）"
check_required() {
  local rel="$1" label="$2"
  if [ -f "$SKILLS/$rel" ]; then ok "$label"; else bad "$label 缺失: qclaw-skills/$rel"; fi
}
check_required "9dem-planner/backend/9dem-planner-invoker.js" "9dem-planner（九维规划）"
check_required "9dem-executor/backend/9dem-invoker.js" "9dem-executor（黑盒9法/九维必测）"
# 九维必测与黑盒9法的实现文件（缺了 executor 会跑但没结果）
for f in design-input-derive.js design-methods.js dimension-cases.js dimension-probes.js; do
  check_required "9dem-executor/backend/$f" "9dem-executor/$f"
done

# ---------- 3) 关键技能可加载 ----------
echo ""
echo "[3/6] 关键技能可加载（ESM import 实测）"
if command -v node >/dev/null; then
  for p in 9dem-planner/backend/9dem-planner-invoker.js 9dem-executor/backend/9dem-invoker.js; do
    if node --input-type=module -e "await import('$SKILLS/$p')" >/dev/null 2>&1; then
      ok "$p 可加载"
    else
      bad "$p 加载失败（依赖文件可能也缺）"
    fi
  done

  # 真实跑一次：executor 应产出确定性基线用例
  OUT=$(node --input-type=module -e "
    const { invoke } = await import('$SKILLS/9dem-executor/backend/9dem-invoker.js');
    const r = await invoke({ task: '用户登录：手机号+密码，密码8-20位，连续5次错误锁定30分钟' });
    console.log(JSON.stringify({ ok: r?.success === true, cases: r?.design?.cases?.length || 0, probes: r?.dimensionCases?.length || 0 }));
  " 2>/dev/null | tail -1)
  if echo "$OUT" | grep -q '"ok":true'; then
    CASES=$(echo "$OUT" | sed -E 's/.*"cases":([0-9]+).*/\1/')
    PROBES=$(echo "$OUT" | sed -E 's/.*"probes":([0-9]+).*/\1/')
    ok "9dem_executor 实跑成功：基线用例 ${CASES} 条，九维必测 ${PROBES} 条"
    [ "$PROBES" -ge 30 ] || soft "九维必测点仅 ${PROBES} 条（预期 ≥30，检查 dimension-probes.js 是否最新）"
    [ "$CASES" -ge 10 ] || soft "基线用例仅 ${CASES} 条（预期 ≥10）"
  else
    bad "9dem_executor 实跑失败（输出：${OUT:-空}）"
  fi
else
  bad "目标机没有 node，无法验证技能加载"
fi

# ---------- 4) 其它被引用的技能模块 ----------
echo ""
echo "[4/6] 其它被引用的技能模块（缺失只影响对应功能）"
others="
api-direct-invoker/backend/api-direct-invoker.js
api-test-tool-invoker/backend/api-test-invoker.js
ui-test-tool-invoker/backend/ui-test-invoker.js
ui-direct-invoker/backend/ui-direct-invoker.js
quality-metrics-calculator/backend/quality-metrics-invoker.js
evaluation-system/backend/evaluation-system-invoker.js
result-aggregator/backend/result-aggregator-invoker.js
requirement-parser/backend/requirement-parser-invoker.js
test-strategy-designer/backend/test-strategy-invoker.js
test-data-generator-skill/backend/test-data-generator-invoker.js
defect-classifier/backend/defect-classifier-invoker.js
failure-root-cause-analyzer/backend/rca-invoker.js
data-masking-skill/backend/data-masking-invoker.js
jmeter-executor/backend/jmeter-invoker.js
test-effort-estimator/backend/estimate.js
ui-e2e-executor/backend/desktop-e2e-invoker.js
ui-e2e-executor/backend/mobile-e2e-invoker.js
web-compatibility/backend/browser-matrix-invoker.js
"
missing_others=0
for p in $others; do
  [ -f "$SKILLS/$p" ] || { soft "缺失 $p"; missing_others=$((missing_others+1)); }
done
[ "$missing_others" = "0" ] && ok "19 个可选技能模块齐备"

# ---------- 5) 前端 ----------
echo ""
echo "[5/6] 前端产物"
if [ -f "$TARGET/frontend/dist/index.html" ]; then
  ok "frontend/dist/index.html 存在"
  HASH=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$TARGET/frontend/dist/index.html" | head -1)
  [ -n "$HASH" ] && ok "入口 bundle: $HASH"
  ASSET_FILE="$TARGET/frontend/dist/${HASH#assets/}"
  ASSET_FILE="$TARGET/frontend/dist/$HASH"
  [ -f "$ASSET_FILE" ] && ok "入口 bundle 文件存在" || bad "index.html 引用的 $HASH 不存在"
else
  bad "缺少 frontend/dist/index.html"
fi

# ---------- 6) 服务健康 ----------
echo ""
echo "[6/6] 服务健康"
if command -v curl >/dev/null; then
  HEALTH=$(curl -s -m 8 "http://127.0.0.1:$BACKEND_PORT/api/health" 2>/dev/null)
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    ok "后端健康检查通过"
    echo "$HEALTH" | grep -oE '"(agents|tasks)":[0-9]+' | sed 's/^/      /'
  else
    bad "后端健康检查失败（端口 $BACKEND_PORT）：${HEALTH:-无响应}"
  fi
fi
if command -v pm2 >/dev/null; then
  PM2_STATE=$(pm2 jlist 2>/dev/null | node -e "
    let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
      try { const a=JSON.parse(s); const p=a.find(x=>x.name==='test-platform');
        console.log(p ? (p.pm2_env.status+' restarts='+p.pm2_env.restart_time) : 'not-found');
      } catch(e){ console.log('parse-error'); }
    });
  " 2>/dev/null)
  case "$PM2_STATE" in
    online*) ok "PM2: $PM2_STATE" ;;
    not-found) bad "PM2 找不到 test-platform 进程" ;;
    *) bad "PM2 状态异常: $PM2_STATE" ;;
  esac
fi

echo ""
echo "=== 结果：$pass 通过 / $fail 失败 / $warn 警告 ==="
if [ "$fail" -gt 0 ]; then
  echo ""
  echo "❌ 有 $fail 项失败。关键项失败会导致交付物残缺但任务仍显示成功，"
  echo "   请先把 skills 补齐再对外服务。"
  exit 1
fi
[ "$warn" -gt 0 ] && echo "⚠️  有 $warn 项警告（对应功能不可用，不影响主流程）"
echo "✅ 部署验证通过"
