#!/usr/bin/env node
/**
 * Excel 工作表划分 单元测试（2026-11-19，按用户口径修正）
 *
 * 用户最终口径：「用例清单不要分多个 sheet 页，其他 sheet 页还是要保留」，
 * 且「接口用例字段数量和字段名称不一样」，所以接口用例要单独一页。
 *
 * 三版口径的演进（前两版都不对）：
 *   v1：每张表一页 → 主用例清单被拆成多页（模型按章节拆表时会裂成 2~3 页）
 *   v2：全部塞进一页 → 覆盖分析/矩阵/豁免声明变成用例下方附录，且接口用例
 *       与主用例强行合表，造出大量空列（接口行没有「所属模块」，主用例行没有「接口编号」）
 *   v3（本版）：**按列结构分组**
 *     - 列结构相同 → 合并成一页（模型把用例清单拆成"功能/安全/性能"多节时仍是一页）
 *     - 列结构不同 → 各自成页（主用例 11 列 vs 接口用例 12 列）
 *     - 其他表格一表一页
 *     - 每页冻结表头 + 自动筛选，各自独立可用
 *     - --multi-sheet 保留 v1 行为，仅调试用
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

t('主用例清单只占 1 页（不被章节拆分）', () => {
  const sheets = readSheets(convert(fullMd, 'merged'));
  const tcSheet = sheets.find((s) => {
    const idCol = s.rows[0].indexOf('用例编号');
    if (idCol < 0) return false;
    return s.rows.some((r) => String(r[idCol] || '').startsWith('TC-'));
  });
  assert.ok(tcSheet, `找不到主用例页，实际：${sheets.map((s) => s.title).join(',')}`);
  const idCol = tcSheet.rows[0].indexOf('用例编号');
  const tcIds = tcSheet.rows.slice(1).map((r) => r[idCol]).filter((v) => String(v).startsWith('TC-'));
  assert.ok(tcIds.length >= 2, `主用例页只找到 ${tcIds.length} 条`);
});

t('接口用例单独成页（字段数量与名称不同，不能合表）', () => {
  const sheets = readSheets(convert(fullMd, 'api-separate'));
  const apiSheet = sheets.find((s) => {
    const idCol = s.rows[0].indexOf('用例编号');
    if (idCol < 0) return false;
    return s.rows.some((r) => String(r[idCol] || '').startsWith('IT-API'));
  });
  assert.ok(apiSheet, `接口用例没有独立页，实际：${sheets.map((s) => s.title).join(',')}`);
  // 主用例页里不应混入接口用例
  const tcSheet = sheets.find((s) => s !== apiSheet && s.rows[0].includes('用例编号'));
  const tcIdCol = tcSheet.rows[0].indexOf('用例编号');
  assert.ok(!tcSheet.rows.some((r) => String(r[tcIdCol] || '').startsWith('IT-API')),
    '接口用例被混进了主用例页');
});

t('接口用例页保留自己的接口特有列（不出现主用例的模块/输入列）', () => {
  const sheets = readSheets(convert(fullMd, 'api-cols'));
  const apiSheet = sheets.find((s) => s.title.includes('接口测试用例'));
  assert.ok(apiSheet, '找不到接口用例页');
  const header = apiSheet.rows[0];
  for (const col of ['接口编号', '接口名称', '请求方式', '用例类型']) {
    assert.ok(header.includes(col), `接口页缺少「${col}」`);
  }
  // 接口用例本就没有「所属模块」「输入数据」，不该为了合并而硬造空列
  assert.ok(!header.includes('所属模块'), `接口页出现了不该有的「所属模块」：${header.join(',')}`);
});

t('列结构相同的用例表仍合并成一页', () => {
  const md = [
    '### 测试用例清单（功能）',
    '| 用例编号 | 所属模块 | 用例名称 | 维度 | 层级 | 预期结果 | 优先级 |',
    '|---|---|---|---|---|---|---|',
    '| TC-001 | 登录 | a | ② 数据 | 正常 | 返回 200 | 高 |',
    '',
    '### 测试用例清单（续：安全）',
    '| 用例编号 | 所属模块 | 用例名称 | 维度 | 层级 | 预期结果 | 优先级 |',
    '|---|---|---|---|---|---|---|',
    '| TC-002 | 安全 | b | ⑤ 安全 | 异常 | 返回 403 | 中 |',
  ].join('\n');
  const sheets = readSheets(convert(md, 'same-struct'));
  assert.strictEqual(sheets.length, 1, `同结构应合并成 1 页，实际 ${sheets.length}：${sheets.map((s) => s.title).join(',')}`);
  const idCol = sheets[0].rows[0].indexOf('用例编号');
  const ids = sheets[0].rows.slice(1).map((r) => r[idCol]).filter(Boolean);
  assert.deepStrictEqual(ids, ['TC-001', 'TC-002']);
});

t('其他表格各自保留独立 sheet（覆盖分析/维度矩阵/方法矩阵/豁免声明）', () => {
  const titles = readSheets(convert(fullMd, 'others')).map((s) => s.title);
  for (const want of ['覆盖分析', '维度覆盖矩阵（必填）', '设计方法覆盖矩阵（必填）', '豁免声明']) {
    assert.ok(titles.includes(want), `缺少独立页「${want}」，实际：${titles.join(',')}`);
  }
});

t('总页数 = 2（主用例 + 接口用例）+ 4（其他表）', () => {
  const sheets = readSheets(convert(fullMd, 'count'));
  assert.strictEqual(sheets.length, 6, `实际 ${sheets.length} 页：${sheets.map((s) => s.title).join(',')}`);
});

t('主用例页保留自己的功能列（不被接口列污染）', () => {
  const sheets = readSheets(convert(fullMd, 'tc-cols'));
  const tcSheet = sheets.find((s) => {
    const idCol = s.rows[0].indexOf('用例编号');
    return idCol >= 0 && s.rows.some((r) => String(r[idCol] || '').startsWith('TC-'));
  });
  const header = tcSheet.rows[0];
  for (const col of ['用例编号', '所属模块', '用例名称', '输入数据', '执行步骤', '预期结果']) {
    assert.ok(header.includes(col), `主用例页缺少「${col}」`);
  }
  assert.ok(!header.includes('接口编号'), `主用例页混入了接口列：${header.join(',')}`);
});

t('主用例页列序按规范顺序', () => {
  const sheets = readSheets(convert(fullMd, 'order'));
  const tcSheet = sheets.find((s) => s.rows[0].includes('所属模块'));
  const header = tcSheet.rows[0];
  assert.strictEqual(header[0], '用例编号');
  assert.ok(header.indexOf('用例名称') < header.indexOf('执行步骤'));
  assert.ok(header.indexOf('执行步骤') < header.indexOf('预期结果'));
});

t('接口页里的步骤列被归一为「执行步骤」（原表写「测试步骤」）', () => {
  const sheets = readSheets(convert(fullMd, 'norm'));
  const apiSheet = sheets.find((s) => s.title.includes('接口测试用例'));
  assert.ok(apiSheet.rows[0].includes('执行步骤'), `表头未归一：${apiSheet.rows[0].join(',')}`);
  assert.ok(!apiSheet.rows[0].includes('测试步骤'), '仍残留「测试步骤」');
});

t('主用例页冻结首行 + 自动筛选', () => {
  const sheets = readSheets(convert(fullMd, 'freeze'));
  const tcSheet = sheets.find((s) => s.rows[0].includes('所属模块'));
  assert.strictEqual(tcSheet.freeze, 'A2');
  assert.ok(/^A1:[A-Z]+\d+$/.test(tcSheet.filter || ''), `筛选范围异常：${tcSheet.filter}`);
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
