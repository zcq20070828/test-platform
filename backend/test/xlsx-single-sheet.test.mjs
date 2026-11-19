#!/usr/bin/env node
/**
 * Excel 单 sheet 输出 单元测试（2026-11-19）
 *
 * 问题：旧版 md_to_xlsx.py「每个连续表格块 → 一个 sheet」，一份测试用例交付物裂成
 * 6 个 sheet（测试用例清单 / 覆盖分析 / 维度覆盖矩阵 / 设计方法覆盖矩阵 /
 * 豁免声明 / 接口测试用例）。执行同学拿到文件要跨 sheet 拼用例、无法整表排序筛选，
 * 而且主用例表和接口用例表被拆开，看起来像两套互不相关的清单。
 *
 * 现在默认单 sheet：所有用例表合并（列取并集、按规范列序、缺列留空），
 * 其他表格接在下方用【小节标题】分隔，冻结表头 + 自动筛选。
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

/** 用 python 读回 sheet 结构与内容（避免引入 node xlsx 依赖） */
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
`, xlsxPath], { encoding: 'utf8' });
  return JSON.parse(out).sheets;
}

console.log('=== Excel 单 sheet 输出 单元测试 ===');

const caseMd = [
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
  '### 接口测试用例',
  '| 用例编号 | 接口编号 | 接口名称 | 请求方式 | 用例类型 | 维度 | 层级 | 执行步骤 | 预期结果 | 优先级 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| IT-API-001-01 | API-001 | 登录接口 | POST | 正向 | ② 数据 / 等价类划分法 | 正常 | 1.调用 | 返回 200 | 高 |',
].join('\n');

t('默认只输出 1 个 sheet', () => {
  const sheets = readSheets(convert(caseMd, 'single'));
  assert.strictEqual(sheets.length, 1, `实际 ${sheets.length} 个：${sheets.map((s) => s.title).join(',')}`);
});

t('主用例表与接口用例表合并进同一张表（不拆成两套）', () => {
  const [sheet] = readSheets(convert(caseMd, 'merge'));
  const idCol = sheet.rows[0].indexOf('用例编号');
  const ids = sheet.rows.slice(1).map((r) => r[idCol]).filter(Boolean);
  assert.ok(ids.includes('TC-001'), '缺少主用例 TC-001');
  assert.ok(ids.includes('IT-API-001-01'), '缺少接口用例 IT-API-001-01');
});

t('列取并集：主用例的列与接口用例的列都在表头里', () => {
  const [sheet] = readSheets(convert(caseMd, 'union'));
  const header = sheet.rows[0];
  // 主用例独有
  assert.ok(header.includes('所属模块'), '缺少「所属模块」');
  assert.ok(header.includes('输入数据'), '缺少「输入数据」');
  // 接口用例独有
  assert.ok(header.includes('接口编号'), '缺少「接口编号」');
  assert.ok(header.includes('请求方式'), '缺少「请求方式」');
  assert.ok(header.includes('用例类型'), '缺少「用例类型」');
});

t('列序按规范顺序（用例编号在最前，关联需求在最后）', () => {
  const [sheet] = readSheets(convert(caseMd, 'order'));
  const header = sheet.rows[0];
  assert.strictEqual(header[0], '用例编号');
  assert.ok(header.indexOf('用例名称') < header.indexOf('执行步骤'), '用例名称应在执行步骤之前');
  assert.ok(header.indexOf('执行步骤') < header.indexOf('预期结果'), '执行步骤应在预期结果之前');
});

t('缺列留空，不串列（主用例行没有接口编号）', () => {
  const [sheet] = readSheets(convert(caseMd, 'blank'));
  const header = sheet.rows[0];
  const apiCol = header.indexOf('接口编号');
  const idCol = header.indexOf('用例编号');
  const tcRow = sheet.rows.find((r) => r[idCol] === 'TC-001');
  assert.ok(tcRow, '未找到 TC-001 行');
  assert.strictEqual(tcRow[apiCol], '', `主用例行的接口编号应为空，实际「${tcRow[apiCol]}」`);
});

t('其他表格接在下方且带【小节标题】分隔（信息不丢）', () => {
  const [sheet] = readSheets(convert(caseMd, 'appendix'));
  const firstCol = sheet.rows.map((r) => r[0]);
  assert.ok(firstCol.some((v) => v.includes('【覆盖分析】')), '缺少覆盖分析分隔标题');
  const coverIdx = firstCol.findIndex((v) => v.includes('【覆盖分析】'));
  assert.ok(coverIdx > 1, '附表应在用例之后');
  assert.ok(sheet.rows[coverIdx + 1].includes('需求编号'), '附表表头缺失');
});

t('冻结首行 + 自动筛选只覆盖用例区', () => {
  const [sheet] = readSheets(convert(caseMd, 'freeze'));
  assert.strictEqual(sheet.freeze, 'A2', `冻结应为 A2，实际 ${sheet.freeze}`);
  assert.ok(/^A1:[A-Z]+\d+$/.test(sheet.filter || ''), `筛选范围格式异常：${sheet.filter}`);
});

t('表头同义词归一（测试步骤→执行步骤、期望结果→预期结果）', () => {
  const md = [
    '### 用例',
    '| 用例编号 | 用例名称 | 测试步骤 | 期望结果 |',
    '|---|---|---|---|',
    '| TC-001 | a | 1.x | 返回 200 |',
  ].join('\n');
  const [sheet] = readSheets(convert(md, 'alias'));
  assert.ok(sheet.rows[0].includes('执行步骤'), '未把「测试步骤」归一为「执行步骤」');
  assert.ok(sheet.rows[0].includes('预期结果'), '未把「期望结果」归一为「预期结果」');
});

t('无用例表时（需求分析/方案）也合并成 1 个 sheet', () => {
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
  const sheets = readSheets(convert(md, 'nocase'));
  assert.strictEqual(sheets.length, 1, `应 1 个 sheet，实际 ${sheets.length}`);
  const firstCol = sheets[0].rows.map((r) => r[0]);
  assert.ok(firstCol.some((v) => v.includes('【功能需求清单】')));
  assert.ok(firstCol.some((v) => v.includes('【风险识别】')));
});

t('完全没有表格时兜底仍是 1 个 sheet', () => {
  const sheets = readSheets(convert('# 纯文本\n没有表格。\n', 'plain'));
  assert.strictEqual(sheets.length, 1);
});

t('--multi-sheet 保留旧行为（用于对比/调试）', () => {
  const sheets = readSheets(convert(caseMd, 'multi', ['--multi-sheet']));
  assert.ok(sheets.length > 1, `--multi-sheet 应输出多个 sheet，实际 ${sheets.length}`);
});

t('测试用例表识别同时要求「用例编号」+「预期结果」两列', () => {
  const py = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(/'用例编号' in norm and '预期结果' in norm/.test(py), '识别条件被改弱了');
});

t('冻结/筛选不是无条件加（无用例区时不能有筛选）', () => {
  const py = fs.readFileSync(SCRIPT, 'utf8');
  // 无用例表的路径走 build_other_only_sheet，不应设置 auto_filter
  const fn = py.slice(py.indexOf('def build_other_only_sheet'), py.indexOf('def build_multi_sheet'));
  assert.ok(!/auto_filter/.test(fn), '无用例表分支不应设置自动筛选');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
process.exit(fail ? 1 : 0);
