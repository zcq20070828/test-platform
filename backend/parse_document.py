#!/usr/bin/env python3
"""
通用文档解析器 - 支持 docx/xlsx/pdf/md/txt/csv
用法: python3 parse_document.py <file_path>
输出: 解析后的纯文本内容到 stdout
退出码: 0=成功, 非0=失败
"""
import sys
import os

def parse_docx(file_path):
    """解析 .docx 文件"""
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                paragraphs.append(text)
        # 也提取表格内容
        for table in doc.tables:
            for row in table.rows:
                row_text = ' | '.join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    paragraphs.append(row_text)
        return '\n'.join(paragraphs)
    except Exception as e:
        raise RuntimeError(f"DOCX解析失败: {e}")

def parse_xlsx(file_path):
    """解析 .xlsx 文件（保留列边界与空单元格位置）

    2026-11-05 修复：
      1. 原先 `' | '.join(v for v in row_vals if v)` 会丢掉空单元格，
         [A, '', C] 被压成 `A | C`，模型会读成两列 → 列错位。
         现在空单元格用 (空) 占位，列数恒定。
      2. data_only=True 时未保存缓存的公式单元格返回 None，整列消失。
         现在同时读公式原文（data_only=False），缓存值为空时回退显示公式。
    """
    try:
        import openpyxl
        wb_values = openpyxl.load_workbook(file_path, data_only=True)
        wb_formulas = openpyxl.load_workbook(file_path, data_only=False)
        sheets_content = []
        for sheet_name in wb_values.sheetnames:
            ws = wb_values[sheet_name]
            ws_f = wb_formulas[sheet_name] if sheet_name in wb_formulas.sheetnames else None
            lines = [f"[Sheet: {sheet_name}]"]
            rows = []
            for row_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
                cells = []
                for col_idx, v in enumerate(row, start=1):
                    if v is not None and str(v).strip() != '':
                        cells.append(str(v).strip())
                    else:
                        # 缓存值缺失时，尝试取公式原文
                        formula = None
                        if ws_f is not None:
                            try:
                                fv = ws_f.cell(row=row_idx, column=col_idx).value
                                if fv is not None and str(fv).startswith('='):
                                    formula = str(fv)
                            except Exception:
                                formula = None
                        cells.append(formula if formula else '(空)')
                # 整行都是 (空) 才跳过
                if all(c == '(空)' for c in cells):
                    continue
                rows.append(cells)
            if rows:
                # 输出 Markdown 表格：表头 + 分隔行 + 数据行，
                # 让下游（切片/预算裁剪）能把它当作原子表格块处理，不会被拆散。
                width = max(len(r) for r in rows)
                norm = [r + [''] * (width - len(r)) for r in rows]
                head = [c if c != '(空)' else '' for c in norm[0]]
                lines.append('')
                lines.append('| ' + ' | '.join(head) + ' |')
                lines.append('| ' + ' | '.join(['---'] * width) + ' |')
                for r in norm[1:]:
                    vals = [('' if c == '(空)' else c).replace('|', '\\|') for c in r]
                    lines.append('| ' + ' | '.join(vals) + ' |')
            if len(lines) > 1:  # 有内容才加
                sheets_content.append('\n'.join(lines))
        return '\n\n'.join(sheets_content)
    except Exception as e:
        raise RuntimeError(f"XLSX解析失败: {e}")

def parse_pdf(file_path):
    """解析 .pdf 文件（2026-11-05：增加表格提取）

    原实现只用 extract_text()，表格会被拉平成错行文本，列对应关系断裂。
    现在优先提取表格并输出为 Markdown 表格，再补上非表格区域的文本。
    """
    try:
        import pdfplumber
        pages_text = []
        with pdfplumber.open(file_path) as pdf:
            for i, page in enumerate(pdf.pages):
                blocks = []
                table_bboxes = []
                try:
                    tables = page.extract_tables()
                except Exception:
                    tables = []
                for ts in tables or []:
                    rows = []
                    for row in ts:
                        cells = [(c or '').replace('\n', ' ').strip() for c in row]
                        if any(cells):
                            rows.append(cells)
                    if len(rows) >= 2:
                        width = max(len(r) for r in rows)
                        rows = [r + [''] * (width - len(r)) for r in rows]
                        md = ['| ' + ' | '.join(rows[0]) + ' |',
                              '| ' + ' | '.join(['---'] * width) + ' |']
                        for r in rows[1:]:
                            md.append('| ' + ' | '.join(r) + ' |')
                        blocks.append('\n'.join(md))
                try:
                    for t in page.find_tables():
                        table_bboxes.append(t.bbox)
                except Exception:
                    pass

                # 非表格区域文本
                body = ''
                try:
                    if table_bboxes:
                        body = page.filter(
                            lambda obj: not any(
                                b[0] <= obj.get('x0', 0) and obj.get('x1', 0) <= b[2]
                                and b[1] <= obj.get('top', 0) and obj.get('bottom', 0) <= b[3]
                                for b in table_bboxes
                            )
                        ).extract_text() or ''
                    else:
                        body = page.extract_text() or ''
                except Exception:
                    body = page.extract_text() or ''

                parts = []
                if body.strip():
                    parts.append(body.strip())
                if blocks:
                    parts.append('\n\n'.join(blocks))
                if parts:
                    pages_text.append(f"[Page {i+1}]\n" + '\n\n'.join(parts))

        result = '\n\n'.join(pages_text)
        if not result.strip():
            raise RuntimeError("PDF内容为空或无法提取")
        return result
    except Exception as e:
        raise RuntimeError(f"PDF解析失败: {e}")

def parse_plain_text(file_path):
    """解析纯文本文件 (.txt/.md/.csv)"""
    encodings = ['utf-8', 'gbk', 'gb2312', 'gb18030', 'latin-1']
    for enc in encodings:
        try:
            with open(file_path, 'r', encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"文本文件编码不支持: {file_path}")

def main():
    if len(sys.argv) < 2:
        print("用法: python3 parse_document.py <file_path>", file=sys.stderr)
        sys.exit(1)
    
    file_path = sys.argv[1]
    
    if not os.path.exists(file_path):
        print(f"文件不存在: {file_path}", file=sys.stderr)
        sys.exit(1)
    
    ext = os.path.splitext(file_path)[1].lower()
    
    try:
        if ext == '.docx':
            content = parse_docx(file_path)
        elif ext == '.xlsx':
            content = parse_xlsx(file_path)
        elif ext == '.pdf':
            content = parse_pdf(file_path)
        elif ext in ('.txt', '.md', '.csv'):
            content = parse_plain_text(file_path)
        else:
            # 尝试当作纯文本处理
            content = parse_plain_text(file_path)
        
        if not content or not content.strip():
            print(f"文档内容为空: {file_path}", file=sys.stderr)
            sys.exit(1)
        
        print(content)
        sys.exit(0)
        
    except Exception as e:
        print(f"解析错误: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
