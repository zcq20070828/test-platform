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
    所以按「表头结构」分组：同结构合并、异结构分页。
  - **其余表格各自保留独立 sheet**：覆盖分析 / 维度覆盖矩阵 / 设计方法覆盖矩阵 /
    豁免声明等，一张表一页。

  判定依据是**列集合**而不是表格数量：所以「测试用例清单 + 测试用例清单(续)」合并，
  而「测试用例清单 + 接口测试用例」分开——前者列相同，后者不同。

页名口径（2026-11-20 修正）：
  页名取「这页真正装了什么」，不是「第一张表上面写了什么」。真实文档里模型会把
  用例清单拆成 `### 测试用例清单 → #### A. 九维必测点用例(42条) / #### B. 黑盒9法
  设计用例 / ##### B1~B9 各方法`，这些表列结构相同会合并成一页（实测 257 行）。
  过去页名取第一张表的小标题，于是出现「A. 九维必测点用例(42条)」装 257 行的
  自相矛盾标题——范围只写了九维（漏了黑盒9法）、数量也只有九维的 42 条。
  现在：多张表合并时取它们**共同的父标题**（本例即「测试用例清单」）；单张表仍用
  自己的标题，但去掉「A.」这类章节序号与「(42条)」这类模型自报条数——自报数量
  经常与实际行数不符，页名里不写数量就不会写错。
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

# 合并后的用例清单页名（多张同结构用例表共用时的兜底名）
CASE_SHEET_TITLE = '测试用例清单'

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
    """把 Markdown 切成 [(section_title, header_cells, data_rows)]

    section_title 是这张表**前最近的**标题（行为不变，其他调用方依赖它）。
    额外的标题栈通过 parse_blocks_with_stack 返回，用于给合并页起更准确的名字。
    """
    return [(title, header, body) for title, _, header, body in parse_blocks_with_stack(md)]


def parse_blocks_with_stack(md):
    """同 parse_blocks，但多返回一份标题栈

    标题栈 = 该表之前所有「层级连续」的标题，如
      ['测试用例集', '托管系统技术方案(...)', '项目信息']
    模型常在用例清单下再分层（### 测试用例清单 → #### A.九维必测点用例 → ##### B1.等价类…），
    合并页需要据此找到这些表共同的父标题，而不是只拿最近一级。
    """
    lines = md.split('\n')
    blocks = []
    stack = []          # [(level, text)]
    i = 0
    while i < len(lines):
        line = lines[i]
        h = re.match(r'^(#{1,6})\s+(.+)$', line)
        if h:
            level = len(h.group(1))
            text = h.group(2).strip()
            # 弹出层级 >= 当前标题的祖先，保持栈内层级严格递增
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, text))
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
                titles = [t for _, t in stack]
                blocks.append((titles[-1] if titles else '', list(titles), header, body))
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

    @param case_blocks: [(section, title_stack, header, body)]
    @returns {list[dict]} [{ signature, blocks, title }]
    """
    groups = []
    by_sig = {}
    for block in case_blocks:
        sig = case_signature(block[2])
        if sig in by_sig:
            by_sig[sig]['blocks'].append(block)
        else:
            group = {'signature': sig, 'blocks': [block], 'title': None}
            by_sig[sig] = group
            groups.append(group)
    return groups


# 页名里要剥掉的模型自报信息：
#   「A. 九维必测点用例(42条)」→ 章节序号 A. + 自报条数 (42条)
#   「B. 黑盒9法设计用例(216条,去重后)」→ (216条,去重后)
_CHAPTER_PREFIX = re.compile(r'^[A-Za-zＡ-Ｚ][\.．、]\s*')
_COUNT_SUFFIX = re.compile(r'[（(][^（()）]*?(?:\d+\s*条|\d+\s*个|去重|截取|共\s*\d+)[^（()）]*?[）)]\s*$')


def _clean_sheet_name(title):
    """去掉章节序号与自报条数，避免页名与页内实际内容不符"""
    s = (title or '').strip()
    s = _CHAPTER_PREFIX.sub('', s)
    # 可能叠加多层括号，反复剥到稳定
    for _ in range(4):
        new = _COUNT_SUFFIX.sub('', s).strip()
        if new == s:
            break
        s = new
    return s.strip(' -—·:：')


def _common_parent_title(title_stacks, fallback):
    """多张表合并时，取它们共同的父标题（最长公共前缀的最后一级）

    真实文档：
      表1 栈 ['测试用例集', '方案名', '测试用例清单', 'A. 九维必测点用例(42条)']
      表2 栈 ['测试用例集', '方案名', '测试用例清单', 'B. 黑盒9法设计用例', 'B1. 等价类划分法']
    公共前缀 = [...'测试用例清单']，最后一级 → 「测试用例清单」，正是这一页的全部内容。
    """
    if not title_stacks:
        return fallback
    prefix = title_stacks[0]
    for stack in title_stacks[1:]:
        k = 0
        while k < len(prefix) and k < len(stack) and prefix[k] == stack[k]:
            k += 1
        prefix = prefix[:k]
        if not prefix:
            break
    if not prefix:
        return fallback
    # 公共父标题只剩文档标题（如「测试用例集」）时，它并不能说明这一页装了什么
    # （模型可能把功能/安全用例直接挂在文档标题下），回落成标准页名。
    if len(prefix) == 1:
        return fallback
    cleaned = _clean_sheet_name(prefix[-1])
    return cleaned or fallback


def pick_group_title(group, index):
    """给分组起页名：单张表用自己的小标题，多张表合并用共同父标题"""
    blocks = group['blocks']
    if len(blocks) > 1:
        title = _common_parent_title([b[1] for b in blocks], CASE_SHEET_TITLE)
    else:
        title = _clean_sheet_name(blocks[0][0]) or CASE_SHEET_TITLE
    if index == 0 and not title:
        return CASE_SHEET_TITLE
    return title


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
    columns = [_norm_header(h) for h in blocks[0][2]]

    ws.append(columns)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill('solid', fgColor='DDEBF7')
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    case_rows = 0
    for _, _, header, body in blocks:
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
    for idx, block in enumerate(blocks, start=1):
        section, _, header, body = block
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

    blocks = parse_blocks_with_stack(md)
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

    case_blocks = [b for b in blocks if is_case_table(b[2])]
    other_blocks = [b for b in blocks if not is_case_table(b[2])]

    # 1) 用例表：按列结构分组，同结构合并成一页、异结构各自成页
    #    （主用例清单 11 列、接口用例 12 列且字段名不同，不能强行合并）
    used_titles = set()
    for gi, group in enumerate(group_case_blocks(case_blocks)):
        build_case_sheet(wb, group, pick_group_title(group, gi), used_titles)

    # 2) 其余表格：一张表一页（覆盖分析 / 维度矩阵 / 方法矩阵 / 豁免声明…）
    for idx, block in enumerate(other_blocks, start=1):
        section, _, header, body = block
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
