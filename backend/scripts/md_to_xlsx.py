#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将 Markdown 文档中的表格转换为 Excel(.xlsx)

用法:
  python3 md_to_xlsx.py <input.md> <output.xlsx>                 默认：按表结构分组出页
  python3 md_to_xlsx.py <input.md> <output.xlsx> --multi-sheet    每张表一页（旧行为，仅调试用）

工作表划分规则（2026-11-19 最终口径）：
  - **列结构相同的用例表合并成一页**。主用例清单被模型拆成多张表（不同章节）时，
    它们列完全一致，合并后能整表排序/筛选，不再分成多页。
  - **列结构不同的用例表各自成页**。接口用例的字段数量和名称都不同
    （接口编号/接口名称/请求方式/用例类型 而非 所属模块/输入数据），
    硬塞进同一张表会造出大量空列（主用例行的接口列全空、接口行的模块列全空），
    所以按「表头结构」分组：同结构合并、异结构分页。页名取该表前最近的 Markdown 标题。
  - **其余表格各自保留独立 sheet**：覆盖分析 / 维度覆盖矩阵 / 设计方法覆盖矩阵 /
    豁免声明等，一张表一页。

  判定依据是**列集合**而不是表格数量：所以「测试用例清单 + 测试用例清单(续)」合并，
  而「测试用例清单 + 接口测试用例」分开——前者列相同，后者不同。
"""
import sys
import re

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

# openpyxl 不允许出现在 sheet 标题中的字符(ASCII)
_FORBIDDEN = set('\\/:*?[]')
# 常见全角/变体斜杠(部分 Markdown 会用)，一并替换为 '-'
_VARIANT_SLASH = {'／', '⁄', '∕', '╱', '⧸', '⟋'}

# 用例表的规范列序（并集）。按此顺序输出，缺列留空。
CASE_COLUMN_ORDER = [
    '用例编号',
    '所属模块',
    '用例名称',
    '接口编号',
    '接口名称',
    '请求方式',
    '用例类型',
    '维度',
    '层级',
    '前置条件',
    '输入数据',
    '执行步骤',
    '预期结果',
    '优先级',
    '关联需求',
]

# 合并后的用例清单页名
CASE_SHEET_TITLE = '测试用例'

# 同义列表头归一：不同智能体写「测试步骤」还是「执行步骤」都要落到同一列
HEADER_ALIASES = {
    '测试步骤': '执行步骤',
    '操作步骤': '执行步骤',
    '测试数据': '输入数据',
    '输入': '输入数据',
    '期望结果': '预期结果',
    '所属模块/功能': '所属模块',
    '功能模块': '所属模块',
}


def _sanitize_title(name):
    out = []
    for c in name:
        if c in _FORBIDDEN or c in _VARIANT_SLASH:
            out.append('-')
        else:
            out.append(c)
    s = ''.join(out).strip()
    s = s[:31]
    return s or 'Sheet'


def _norm_header(h):
    h = (h or '').strip()
    return HEADER_ALIASES.get(h, h)


def _split_row(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def _is_separator(cells):
    return bool(cells) and all(re.match(r'^[\s:\-]+$', c or '') for c in cells)


def parse_blocks(md):
    """把 Markdown 切成 [(section_title, header_cells, data_rows)]"""
    lines = md.split('\n')
    blocks = []
    last_heading = ''
    i = 0
    while i < len(lines):
        line = lines[i]
        h = re.match(r'^#{1,4}\s+(.+)$', line)
        if h:
            last_heading = h.group(1).strip()
        stripped = line.strip()
        if stripped.startswith('|') and stripped.endswith('|') and '|' in stripped[1:-1]:
            block = [line]
            j = i + 1
            while j < len(lines):
                s2 = lines[j].strip()
                if s2.startswith('|') and s2.endswith('|'):
                    block.append(lines[j])
                    j += 1
                else:
                    break
            header = _split_row(block[0])
            body = []
            for r in block[1:]:
                cells = _split_row(r)
                if _is_separator(cells):
                    continue
                body.append(cells)
            if body:
                blocks.append((last_heading, header, body))
            i = j
            continue
        i += 1
    return blocks


def is_case_table(header):
    norm = [_norm_header(h) for h in header]
    return '用例编号' in norm and '预期结果' in norm


def case_signature(header):
    """用例表的列结构签名（归一化后排序），用于判断两张表能否合并"""
    return tuple(sorted(_norm_header(h) for h in header if str(h).strip()))


def group_case_blocks(case_blocks):
    """
    按「列结构」把用例表分组

    为什么要分组而不是全合并：
      主用例清单的列是「用例编号/所属模块/用例名称/维度/层级/前置条件/输入数据/
      执行步骤/预期结果/优先级/关联需求」；
      接口用例的列是「用例编号/接口编号/接口名称/请求方式/用例类型/维度/层级/
      前置条件/测试步骤/预期结果/优先级/关联需求」。
      字段名称和数量都不同，硬合到一张表会造出大量空列
      （主用例行的接口列全空、接口行的模块列全空），既难看也没法按接口筛。
      所以同结构合并（模型把用例清单拆成多章时仍是一页），异结构分页。

    @returns {list[dict]} [{ signature, blocks, title }]
    """
    groups = []
    by_sig = {}
    for block in case_blocks:
        sig = case_signature(block[1])
        if sig in by_sig:
            by_sig[sig]['blocks'].append(block)
        else:
            group = {'signature': sig, 'blocks': [block], 'title': None}
            by_sig[sig] = group
            groups.append(group)
    return groups


def pick_group_title(group, index):
    """给分组起页名：优先用其中第一张表前最近的 Markdown 标题"""
    for section, _, _ in group['blocks']:
        if section:
            return section
    return CASE_SHEET_TITLE if index == 0 else f'{CASE_SHEET_TITLE}_{index + 1}'


def build_case_sheet(wb, group, title, used_titles):
    """把一组「列结构相同」的用例表写成一张 sheet"""
    safe_title = _sanitize_title(title)
    if safe_title in used_titles:
        k = 2
        while f'{safe_title}_{k}' in used_titles:
            k += 1
        safe_title = f'{safe_title}_{k}'
    used_titles.add(safe_title)

    ws = wb.create_sheet(title=safe_title)
    blocks = group['blocks']

    # 这一组内列结构一致，直接用第一张表的表头（保留原始顺序，不做跨表并集）
    columns = [_norm_header(h) for h in blocks[0][1]]

    ws.append(columns)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill('solid', fgColor='DDEBF7')
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    case_rows = 0
    for _, header, body in blocks:
        index_map = {}
        for idx, h in enumerate(header):
            index_map.setdefault(_norm_header(h), idx)
        for cells in body:
            row = []
            for col in columns:
                pos = index_map.get(col)
                row.append(cells[pos] if pos is not None and pos < len(cells) else '')
            ws.append(row)
            case_rows += 1

    # 列宽：按内容估算，长文本封顶 60
    for idx, col in enumerate(columns, start=1):
        letter = ws.cell(row=1, column=idx).column_letter
        maxlen = len(str(col))
        for r in range(2, case_rows + 2):
            v = ws.cell(row=r, column=idx).value
            if v is not None:
                maxlen = max(maxlen, min(len(str(v)), 60))
        ws.column_dimensions[letter].width = min(max(maxlen + 2, 10), 60)

    # 冻结表头 + 自动筛选，便于整表筛
    ws.freeze_panes = 'A2'
    last_col = ws.cell(row=1, column=len(columns)).column_letter
    ws.auto_filter.ref = f'A1:{last_col}{case_rows + 1}'

    print(f'OK case-sheet[{safe_title}]: {case_rows} 行 × {len(columns)} 列'
          f'（合并 {len(blocks)} 张同结构用例表）')
    return case_rows, len(columns)


def build_table_sheet(wb, section, header, body, used_titles, table_idx):
    """单张非用例表 → 独立 sheet"""
    base = section if section else f'table_{table_idx}'
    title = _sanitize_title(base)
    if title in used_titles:
        k = 2
        while f'{title}_{k}' in used_titles:
            k += 1
        title = f'{title}_{k}'
    used_titles.add(title)

    ws = wb.create_sheet(title=title)
    ws.append([_norm_header(h) for h in header])
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill('solid', fgColor='DDEBF7')
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    for cells in body:
        ws.append(cells)
    ws.freeze_panes = 'A2'
    last_col = ws.cell(row=1, column=max(len(header), 1)).column_letter
    ws.auto_filter.ref = f'A1:{last_col}{len(body) + 1}'
    for col in ws.columns:
        maxlen = max((len(str(c.value)) for c in col if c.value is not None), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(max(maxlen + 2, 10), 60)
    return title


def build_multi_sheet(wb, blocks):
    """旧行为：每张表一页（含用例表），保留用于对比/调试"""
    used_titles = set()
    for idx, (section, header, body) in enumerate(blocks, start=1):
        build_table_sheet(wb, section, header, body, used_titles, idx)
    print('OK multi-sheet: ' + ','.join(wb.sheetnames))


def build_fallback_sheet(wb, md):
    """无表格时：仍给一张「内容」表，保证 Excel 交付物必然存在"""
    ws = wb.create_sheet(title='内容')
    for line in md.split('\n'):
        s = line.strip()
        if not s:
            continue
        if re.match(r'^[\|\s:\-]+$', s):
            continue
        if s.startswith('|') and s.endswith('|') and '|' in s[1:-1]:
            s = s[1:-1].strip()
        ws.append([s])
    ws.column_dimensions['A'].width = 80
    print('OK fallback-sheet: 内容')


def md_to_xlsx(md_path, xlsx_path, multi_sheet=False):
    try:
        with open(md_path, encoding='utf-8') as f:
            md = f.read()
    except Exception as e:
        print(f'read error: {e}')
        sys.exit(1)

    blocks = parse_blocks(md)
    wb = Workbook()
    wb.remove(wb.active)

    if not blocks:
        build_fallback_sheet(wb, md)
        wb.save(xlsx_path)
        return

    if multi_sheet:
        build_multi_sheet(wb, blocks)
        wb.save(xlsx_path)
        return

    case_blocks = [b for b in blocks if is_case_table(b[1])]
    other_blocks = [b for b in blocks if not is_case_table(b[1])]

    # 1) 用例表：按列结构分组，同结构合并成一页、异结构各自成页
    #    （主用例清单 11 列、接口用例 12 列且字段名不同，不能强行合并）
    used_titles = set()
    for gi, group in enumerate(group_case_blocks(case_blocks)):
        build_case_sheet(wb, group, pick_group_title(group, gi), used_titles)

    # 2) 其余表格：一张表一页（覆盖分析 / 维度矩阵 / 方法矩阵 / 豁免声明…）
    for idx, (section, header, body) in enumerate(other_blocks, start=1):
        build_table_sheet(wb, section, header, body, used_titles, idx)

    # 3) 一张表都没有（纯文本）：兜底
    if not wb.sheetnames:
        build_fallback_sheet(wb, md)

    print('OK sheets: ' + ','.join(wb.sheetnames))
    wb.save(xlsx_path)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('usage: md_to_xlsx.py <input.md> <output.xlsx> [--multi-sheet]')
        sys.exit(1)
    md_to_xlsx(sys.argv[1], sys.argv[2], multi_sheet='--multi-sheet' in sys.argv)
