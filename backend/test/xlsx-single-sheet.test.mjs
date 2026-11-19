#!/usr/bin/env node
/**
 * Excel 工作表划分 单元测试（2026-11-19，按用户口径修正）
 *
 * 用户口径：「用例清单不要分多个 sheet 页，其他 sheet 页还是要保留」。
 *
 * 历史两版都错过：
 *   v1（原始）：每张表一页 → 用例清单被拆成「测试用例清单」+「接口测试用例」两页，
 *              执行同学要跨页拼用例、无法整表筛选。
 *   v2（上一版，做过头）：全部塞进一页 → 覆盖分析 / 维度矩阵 / 方法矩阵 / 豁免声明
 *              都被压到用例表下方，失去了「一表一页」的浏览方式。
 *
 * 正确规则（本版）：
 *   1. 所有「用例表」（表头同时有 用例编号 + 预期结果）合并成一张「测试用例」页
 *   2. 其他表格各自保留独立 sheet，名称取该表前最近的 Markdown 标题
 *   3. 用例页冻结表头 + 自动筛选（可整表按维度/优先级筛）
 *   4. --multi-sheet 保留 v1 行为，仅调试用
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'backend', 'scripts', 'md_to_xlsx.py');
const PY = (() => {
  try { return execFileSync('which', ['python3'], { encoding: 'utf8' }).trim() || 'python3'; }
  catch { return 'python3'; }
})();

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ✅ ' + name); }
  catch (e) { fail += 1; console.log('  ❌ ' + name + ' :: ' + e.message); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-test-'));

function convert(md, name, extraArgs = []) {
  const mdPath = path.join(tmp, `${name}.md`);
  const xlsxPath = path.join(tmp, `${name}.xlsx`);
  fs.writeFileSync(mdPath, md, 'utf8');
  execFileSync(PY, [SCRIPT, mdPath, xlsxPath, ...extraArgs], { encoding: 'utf8' });
  return xlsxPath;
}

function readSheets(xlsxPath) {
  const out = execFileSync(PY, ['-c', `
import json, sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
res = []
for ws in wb.worksheets:
    rows = []
    for r in ws.iter_rows(values_only=True):
        rows.append(['' if v is None else str(v) for v in r])
    res.append({
        'title': ws.title,
        'rows': rows,
        'freeze': ws.freeze_panes,
        'filter': ws.auto_filter.ref,
        'maxCol': ws.max_column,
    })
print(json.dumps({'sheets': res}, ensure_ascii=False))
`, xlsxPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out).sheets;
}

console.log('=== Excel 工作表划分 单元测试 ===');

// 完整的用例交付物：2 张用例表 + 4 张普通表
const fullMd = [
  '# 测试用例集',
  '',
  '### 测试用例清单',
  '| 用例编号 | 所属模块 | 用例名称 | 维度 | 层级 | 输入数据 | 执行步骤 | 预期结果 | 优先级 | 关联需求 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| TC-001 | 登录 | 手机号合法 | ② 数据 / 等价类划分法 | 正常 | phone=13800138000 | 1.输入 2.提交 | 返回 200，含 token | 高 | FR-001 |',
  '| TC-002 | 登录 | 手机号过短 | ② 数据 / 边界值分析法 | 边界 | phone=138 | 1.输入 2.提交 | 提示"须11位" | 中 | FR-001 |',
  '',
  '### 覆盖分析',
  '| 需求编号 | 覆盖用例数 | 覆盖状态 |',
  '|---|---|---|',
  '| FR-001 | TC-001,TC-002 | 已覆盖 |',
  '',
  '### 维度覆盖矩阵（必填）',
  '| 维度 | 权重 | 正常层 | 边界层 | 异常层 |',
  '|---|---|---|---|---|',
  '| ① 用户 | ●● | ✅ | ✅ | ✅ |',
  '',
  '### 设计方法覆盖矩阵（必填）',
  '| 设计方法 | 适用维度 | 用例数 |',
  '|---|---|---|',
  '| 等价类划分法 | ② 数据 | 12 |',
  '',
  '### 豁免声明',
  '| 维度/方法 | 不适用原因 | 影响 |',
  '|---|---|---|',
  '| ⑧ 终端环境 | 纯接口，无终端交互 | 无 |',
  '',
  '### 接口测试用例（系统按接口清单补齐）',
  '| 用例编号 | 接口编号 | 接口名称 | 请求方式 | 用例类型 | 维度 | 层级 | 执行步骤 | 预期结果 | 优先级 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| IT-API-001-01 | API-001 | 登录接口 | POST | 正向 | ② 数据 / 等价类划分法 | 正常 | 1.调用 | 返回 200 | 高 |',
].join('\n');

t('用例清单只占 1 页（主用例 + 接口用例合并）', () => {
  const sheets = readSheets(convert(fullMd, 'merged'));
  const caseSheet = sheets.find((s) => s.title === '测试用例');
  assert.ok(caseSheet, `缺少「测试用例」页，实际：${sheets.map((s) => s.title).join(',')}`);
  const idCol = caseSheet.rows[0].indexOf('用例编号');
  const ids = caseSheet.rows.slice(1).map((r) => r[idCol]).filter(Boolean);
  assert.ok(ids.includes('TC-001'), '主用例 TC-001 不在用例页');
  assert.ok(ids.includes('IT-API-001-01'), '接口用例 IT-API-001-01 不在同一页');
  // 不能再有独立的接口用例页
  const apiSheet = sheets.find((s) => s.title.includes('接口测试用例'));
  assert.strictEqual(apiSheet, undefined, `接口用例不应单独成页：${apiSheet && apiSheet.title}`);
});

t('其他表格各自保留独立 sheet（覆盖分析/维度矩阵/方法矩阵/豁免声明）', () => {
  const titles = readSheets(convert(fullMd, 'others')).map((s) => s.title);
  for (const want of ['覆盖分析', '维度覆盖矩阵（必填）', '设计方法覆盖矩阵（必填）', '豁免声明']) {
    assert.ok(titles.includes(want), `缺少独立页「${want}」，实际：${titles.join(',')}`);
  }
});

t('总页数 = 1（用例）+ 4（其他表）', () => {
  const sheets = readSheets(convert(fullMd, 'count'));
  assert.strictEqual(sheets.length, 5, `实际 ${sheets.length} 页：${sheets.map((s) => s.title).join(',')}`);
});

t('用例页列取并集（主用例列 + 接口用例列都在）', () => {
  const caseSheet = readSheets(convert(fullMd, 'union')).find((s) => s.title === '测试用例');
  const header = caseSheet.rows[0];
  for (const col of ['用例编号', '所属模块', '输入数据', '接口编号', '请求方式', '用例类型']) {
    assert.ok(header.includes(col), `缺少列「${col}」`);
  }
});

t('用例页列序按规范顺序', () => {
  const header = readSheets(convert(fullMd, 'order')).find((s) => s.title === '测试用例').rows[0];
  assert.strictEqual(header[0], '用例编号');
  assert.ok(header.indexOf('用例名称') < header.indexOf('执行步骤'));
  assert.ok(header.indexOf('执行步骤') < header.indexOf('预期结果'));
});

t('缺列留空，不串列', () => {
  const caseSheet = readSheets(convert(fullMd, 'blank')).find((s) => s.title === '测试用例');
  const header = caseSheet.rows[0];
  const apiCol = header.indexOf('接口编号');
  const idCol = header.indexOf('用例编号');
  const tcRow = caseSheet.rows.find((r) => r[idCol] === 'TC-001');
  assert.strictEqual(tcRow[apiCol], '', `主用例行的接口编号应为空，实际「${tcRow[apiCol]}」`);
});

t('用例页冻结首行 + 自动筛选', () => {
  const caseSheet = readSheets(convert(fullMd, 'freeze')).find((s) => s.title === '测试用例');
  assert.strictEqual(caseSheet.freeze, 'A2');
  assert.ok(/^A1:[A-Z]+\d+$/.test(caseSheet.filter || ''), `筛选范围异常：${caseSheet.filter}`);
});

t('其他表页也有冻结与筛选（各自独立可用）', () => {
  const sheets = readSheets(convert(fullMd, 'others-freeze'));
  const cover = sheets.find((s) => s.title === '覆盖分析');
  assert.strictEqual(cover.freeze, 'A2');
  assert.ok(/^A1:[A-Z]+\d+$/.test(cover.filter || ''));
});

t('其他表页内容正确（不是被合并到用例页）', () => {
  const cover = readSheets(convert(fullMd, 'others-content')).find((s) => s.title === '覆盖分析');
  assert.ok(cover.rows[0].includes('需求编号'), '覆盖分析表头缺失');
  assert.ok(cover.rows.some((r) => r[0] === 'FR-001'), '覆盖分析数据行缺失');
});

t('表头同义词归一（测试步骤→执行步骤、期望结果→预期结果）', () => {
  const md = [
    '### 用例',
    '| 用例编号 | 用例名称 | 测试步骤 | 期望结果 |',
    '|---|---|---|---|',
    '| TC-001 | a | 1.x | 返回 200 |',
  ].join('\n');
  const header = readSheets(convert(md, 'alias'))[0].rows[0];
  assert.ok(header.includes('执行步骤'), '未把「测试步骤」归一为「执行步骤」');
  assert.ok(header.includes('预期结果'), '未把「期望结果」归一为「预期结果」');
});

t('无用例表时（需求分析/方案）其他表仍各自成页', () => {
  const md = [
    '# 需求分析报告',
    '### 功能需求清单',
    '| 需求编号 | 需求名称 |',
    '|---|---|',
    '| FR-001 | 登录 |',
    '### 风险识别',
    '| 风险 | 影响 |',
    '|---|---|',
    '| 并发 | 高 |',
  ].join('\n');
  const titles = readSheets(convert(md, 'nocase')).map((s) => s.title);
  assert.ok(titles.includes('功能需求清单'), `缺少「功能需求清单」页：${titles.join(',')}`);
  assert.ok(titles.includes('风险识别'), `缺少「风险识别」页：${titles.join(',')}`);
  assert.ok(!titles.includes('测试用例'), '不该凭空造出用例页');
});

t('完全没有表格时兜底仍是 1 页', () => {
  const sheets = readSheets(convert('# 纯文本\n没有表格。\n', 'plain'));
  assert.strictEqual(sheets.length, 1);
});

t('--multi-sheet 保留 v1 行为（每张表一页，含用例表）', () => {
  const titles = readSheets(convert(fullMd, 'multi', ['--multi-sheet'])).map((s) => s.title);
  assert.strictEqual(titles.length, 6, `--multi-sheet 应为 6 页，实际 ${titles.length}：${titles.join(',')}`);
  assert.ok(titles.includes('测试用例清单'), 'v1 行为应保留独立的「测试用例清单」页');
});

t('用例表识别同时要求「用例编号」+「预期结果」两列', () => {
  const py = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(/'用例编号' in norm and '预期结果' in norm/.test(py), '识别条件被改弱了');
});

t('覆盖分析表不会被误判成用例表', () => {
  const py = fs.readFileSync(SCRIPT, 'utf8');
  const fn = py.slice(py.indexOf('def is_case_table'), py.indexOf('def build_merged_case_sheet'));
  assert.ok(!fn.includes("'需求编号'"), 'is_case_table 不应把需求编号当判据');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
process.exit(fail ? 1 : 0);
