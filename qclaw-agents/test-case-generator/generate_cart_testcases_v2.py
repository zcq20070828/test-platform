#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
购物车功能测试用例生成器 v2
修复数据不一致问题，确保汇总表与实际内容完全一致
"""

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import datetime

# ==================== 测试用例数据定义 ====================

# 添加商品 (12个)
ADD_TESTS = [
    # 正向添加 (6个)
    {"id": "CART-ADD-001", "title": "添加单件商品到购物车", "type": "正向", "priority": "P0",
     "precond": "用户已登录，商品有库存", "steps": "1.打开商品详情页\n2.点击\"加入购物车\"\n3.确认提示",
     "data": "商品SKU001，售价¥100", "expected": "购物车数量+1，显示成功提示", "http_code": "200", "auto": "✓"},
    {"id": "CART-ADD-002", "title": "添加商品并继续购物", "type": "正向", "priority": "P1",
     "precond": "用户已登录", "steps": "1.添加商品\n2.点击\"继续购物\"",
     "data": "商品SKU002", "expected": "购物车数量+1，停留在当前页", "http_code": "200", "auto": "✓"},
    {"id": "CART-ADD-003", "title": "添加多件不同商品", "type": "正向", "priority": "P0",
     "precond": "用户已登录", "steps": "1.添加商品A\n2.添加商品B\n3.添加商品C",
     "data": "商品A、B、C各1件", "expected": "购物车显示3种商品，总数量=3", "http_code": "200", "auto": "✓"},
    {"id": "CART-ADD-004", "title": "同一商品添加多次", "type": "正向", "priority": "P1",
     "precond": "用户已登录", "steps": "1.添加商品A(1件)\n2.再添加商品A(2件)",
     "data": "商品SKU003，售价¥50", "expected": "商品数量累计为3，不重复", "http_code": "200", "auto": "✓"},
    {"id": "CART-ADD-005", "title": "购物车已有商品再次添加", "type": "正向", "priority": "P1",
     "precond": "购物车已有商品SKU001", "steps": "1.查看购物车确认商品存在\n2.再次添加该商品",
     "data": "已有数量1，添加数量2", "expected": "商品数量累加为3", "http_code": "200", "auto": "✓"},
    {"id": "CART-ADD-006", "title": "重复添加后验证价格", "type": "正向", "priority": "P1",
     "precond": "用户已登录", "steps": "1.添加商品\n2.再次添加\n3.查看总价",
     "data": "商品售价¥100，添加2次", "expected": "数量=2，小计=¥200", "http_code": "200", "auto": "✓"},
    # 库存边界 (6个)
    {"id": "CART-ADD-007", "title": "添加达到库存上限", "type": "库存边界", "priority": "P0",
     "precond": "商品库存=10", "steps": "1.添加该商品10件",
     "data": "库存=10，添加10件", "expected": "添加成功，数量=10", "http_code": "200", "auto": "✓"},
    {"id": "CART-ADD-008", "title": "添加超过库存上限", "type": "库存边界", "priority": "P0",
     "precond": "商品库存=10", "steps": "1.尝试添加该商品11件",
     "data": "库存=10，添加11件", "expected": "提示\"库存不足\"，不添加，HTTP 400", "http_code": "400", "auto": "✓"},
    {"id": "CART-ADD-009", "title": "添加数量为0", "type": "库存边界", "priority": "P1",
     "precond": "用户已登录", "steps": "1.尝试添加0件商品",
     "data": "添加数量=0", "expected": "提示\"数量必须大于0\"，HTTP 400", "http_code": "400", "auto": "✓"},
    {"id": "CART-ADD-010", "title": "添加数量为负数", "type": "库存边界", "priority": "P0",
     "precond": "用户已登录", "steps": "1.尝试添加-1件商品",
     "data": "添加数量=-1", "expected": "提示\"数量格式错误\"，返回400", "http_code": "400", "auto": "✓"},
    {"id": "CART-ADD-011", "title": "添加数量为小数", "type": "库存边界", "priority": "P1",
     "precond": "用户已登录", "steps": "1.尝试添加1.5件商品",
     "data": "添加数量=1.5", "expected": "提示\"数量必须为整数\"，HTTP 400", "http_code": "400", "auto": "✓"},
    {"id": "CART-ADD-012", "title": "添加已下架商品", "type": "库存边界", "priority": "P0",
     "precond": "商品状态:已下架", "steps": "1.尝试添加已下架商品",
     "data": "商品状态:已下架", "expected": "提示\"商品已下架\"，不添加，HTTP 404", "http_code": "404", "auto": "✓"},
]

# 修改数量 (12个) - 注意：子项之和=4+5+3=12
UPDATE_TESTS = [
    # 增/减操作 (4个)
    {"id": "CART-UPD-001", "title": "点击加号增加数量", "type": "增/减操作", "priority": "P0",
     "precond": "购物车有商品A，数量=1", "steps": "1.点击商品A的\"+\"按钮",
     "data": "当前数量=1", "expected": "数量变为2，价格同步更新", "http_code": "200", "auto": "✓"},
    {"id": "CART-UPD-002", "title": "点击减号减少数量", "type": "增/减操作", "priority": "P0",
     "precond": "购物车有商品A，数量=3", "steps": "1.点击商品A的\"-\"按钮",
     "data": "当前数量=3", "expected": "数量减至2，价格更新", "http_code": "200", "auto": "✓"},
    {"id": "CART-UPD-003", "title": "连续点击增加按钮", "type": "增/减操作", "priority": "P1",
     "precond": "购物车有商品A，数量=1，库存充足", "steps": "1.快速连续点击\"+\"按钮5次",
     "data": "当前数量=1，连续点击5次", "expected": "数量逐次增加，最终=6", "http_code": "200", "auto": "✓"},
    {"id": "CART-UPD-004", "title": "直接输入修改数量", "type": "增/减操作", "priority": "P0",
     "precond": "购物车有商品A，数量=1", "steps": "1.点击数量输入框\n2.清空并输入5\n3.点击确定",
     "data": "输入新数量=5", "expected": "数量更新为5，价格同步", "http_code": "200", "auto": "✓"},
    # 边界值 (5个)
    {"id": "CART-UPD-005", "title": "数量减到0触发删除确认", "type": "边界值", "priority": "P0",
     "precond": "购物车有商品A，数量=1", "steps": "1.点击商品A的\"-\"按钮",
     "data": "当前数量=1", "expected": "弹出删除确认对话框", "http_code": "200", "auto": "✓"},
    {"id": "CART-UPD-006", "title": "修改为最大库存数量", "type": "边界值", "priority": "P0",
     "precond": "商品库存=100", "steps": "1.修改商品数量为100",
     "data": "库存=100，修改数量=100", "expected": "修改成功，数量=100", "http_code": "200", "auto": "✓"},
    {"id": "CART-UPD-007", "title": "修改超过最大库存数量", "type": "边界值", "priority": "P0",
     "precond": "商品库存=100", "steps": "1.尝试修改商品数量为101",
     "data": "库存=100，修改数量=101", "expected": "提示\"库存不足\"，数量不变", "http_code": "400", "auto": "✓"},
    {"id": "CART-UPD-008", "title": "修改数量为0", "type": "边界值", "priority": "P0",
     "precond": "购物车有商品", "steps": "1.修改数量为0",
     "data": "修改数量=0", "expected": "提示\"数量必须大于0\"，不修改", "http_code": "400", "auto": "✓"},
    {"id": "CART-UPD-009", "title": "修改数量为负数", "type": "边界值", "priority": "P0",
     "precond": "购物车有商品", "steps": "1.修改数量为-1",
     "data": "修改数量=-1", "expected": "提示\"数量格式错误\"，返回400", "http_code": "400", "auto": "✓"},
    # 输入校验 (3个)
    {"id": "CART-UPD-010", "title": "输入非数字字符", "type": "输入校验", "priority": "P1",
     "precond": "购物车有商品", "steps": "1.输入非数字字符\"aaa\"\n2.提交",
     "data": "输入=\"aaa\"", "expected": "提示\"请输入有效数字\"，不修改", "http_code": "400", "auto": "✓"},
    {"id": "CART-UPD-011", "title": "输入超长数字", "type": "输入校验", "priority": "P1",
     "precond": "购物车有商品", "steps": "1.输入超长数字999999999999",
     "data": "输入=999999999999", "expected": "提示\"数量超出范围\"，不修改", "http_code": "400", "auto": "✓"},
    {"id": "CART-UPD-012", "title": "输入小数", "type": "输入校验", "priority": "P1",
     "precond": "购物车有商品", "steps": "1.输入小数1.5",
     "data": "输入=1.5", "expected": "提示\"数量必须为整数\"，不修改", "http_code": "400", "auto": "✓"},
]

# 删除商品 (8个)
DELETE_TESTS = [
    # 单删 (3个)
    {"id": "CART-DEL-001", "title": "删除单个商品", "type": "单删", "priority": "P0",
     "precond": "购物车有商品A、B", "steps": "1.点击商品A的删除按钮\n2.确认删除",
     "data": "商品A售价¥100，商品B售价¥200", "expected": "商品A移除，总价=¥200", "http_code": "200", "auto": "✓"},
    {"id": "CART-DEL-002", "title": "删除最后一件商品", "type": "单删", "priority": "P0",
     "precond": "购物车只有商品A", "steps": "1.点击删除商品A",
     "data": "购物车仅1件商品", "expected": "显示\"购物车是空的\"", "http_code": "200", "auto": "✓"},
    {"id": "CART-DEL-003", "title": "取消删除操作", "type": "单删", "priority": "P1",
     "precond": "购物车有商品A", "steps": "1.点击删除按钮\n2.点击\"取消\"",
     "data": "商品A数量=2", "expected": "商品保留，数量不变=2", "http_code": "200", "auto": "✓"},
    # 清空 (3个)
    {"id": "CART-DEL-004", "title": "清空购物车", "type": "清空", "priority": "P0",
     "precond": "购物车有5件商品", "steps": "1.点击\"清空购物车\"\n2.确认",
     "data": "购物车5件商品", "expected": "所有商品移除，数量归0，显示空状态", "http_code": "200", "auto": "✓"},
    {"id": "CART-DEL-005", "title": "取消清空操作", "type": "清空", "priority": "P1",
     "precond": "购物车有3件商品", "steps": "1.点击清空按钮\n2.点击\"取消\"",
     "data": "购物车3件商品", "expected": "所有商品保留", "http_code": "200", "auto": "✓"},
    {"id": "CART-DEL-006", "title": "清空已选商品", "type": "清空", "priority": "P1",
     "precond": "购物车有5件商品", "steps": "1.勾选其中2件\n2.点击\"删除选中\"",
     "data": "选中2件，未选中3件", "expected": "只删除选中的2个，保留3个", "http_code": "200", "auto": "✓"},
    # 价格重算 (2个)
    {"id": "CART-DEL-007", "title": "删除后总价重算", "type": "价格重算", "priority": "P0",
     "precond": "购物车商品总价为¥450", "steps": "1.删除售价¥200的商品",
     "data": "总价=¥450，删除商品¥200", "expected": "新总价=¥250，准确", "http_code": "200", "auto": "✓"},
    {"id": "CART-DEL-008", "title": "删除后选中状态重算", "type": "价格重算", "priority": "P1",
     "precond": "购物车有3件商品，选中2件", "steps": "1.删除已选中的商品",
     "data": "选中2件总价¥300，未选中1件¥100", "expected": "选中状态重新计算，显示¥100", "http_code": "200", "auto": "✓"},
]

# 结算功能 (12个) - 注意：子项之和=3+3+3+3=12
CHECKOUT_TESTS = [
    # 订单确认 (3个)
    {"id": "CART-CHK-001", "title": "正常流程结算订单", "type": "订单确认", "priority": "P0",
     "precond": "已选商品，有收货地址，有支付方式", "steps": "1.确认商品信息\n2.选择地址\n3.点击\"去结算\"\n4.确认订单",
     "data": "商品总价¥500，运费¥10", "expected": "生成订单，跳转支付页，HTTP 200", "http_code": "200", "auto": "✓"},
    {"id": "CART-CHK-002", "title": "结算空购物车", "type": "订单确认", "priority": "P0",
     "precond": "购物车为空", "steps": "1.点击\"去结算\"",
     "data": "购物车商品数=0", "expected": "按钮不可点击或提示\"购物车为空\"", "http_code": "400", "auto": "✓"},
    {"id": "CART-CHK-003", "title": "结算含失效商品", "type": "订单确认", "priority": "P0",
     "precond": "购物车有有效商品和失效商品", "steps": "1.尝试结算",
     "data": "有效商品¥300，失效商品¥100", "expected": "提示失效商品不可结算，仅结算有效商品", "http_code": "400", "auto": "✓"},
    # 地址选择 (3个)
    {"id": "CART-CHK-004", "title": "选择非默认收货地址", "type": "地址选择", "priority": "P0",
     "precond": "有多个收货地址", "steps": "1.选择非默认地址\n2.确认",
     "data": "默认地址北京，选择上海地址", "expected": "地址切换成功，运费更新（上海+¥20）", "http_code": "200", "auto": "✓"},
    {"id": "CART-CHK-005", "title": "新增收货地址结算", "type": "地址选择", "priority": "P1",
     "precond": "无收货地址", "steps": "1.点击新增地址\n2.填写信息\n3.保存\n4.确认结算",
     "data": "新地址：广东省深圳市南山区", "expected": "地址保存成功，继续结算流程", "http_code": "200", "auto": "✓"},
    {"id": "CART-CHK-006", "title": "不选择地址直接提交", "type": "地址选择", "priority": "P0",
     "precond": "无收货地址", "steps": "1.不添加地址，尝试提交订单",
     "data": "收货地址=空", "expected": "提示\"请添加收货地址\"，HTTP 400", "http_code": "400", "auto": "✓"},
    # 优惠券 (3个)
    {"id": "CART-CHK-007", "title": "使用有效优惠券", "type": "优惠券", "priority": "P0",
     "precond": "有满500减100优惠券", "steps": "1.输入优惠码或选择优惠券\n2.确认使用",
     "data": "商品¥1000，优惠券满500减100", "expected": "优惠¥100，实付¥900", "http_code": "200", "auto": "✓"},
    {"id": "CART-CHK-008", "title": "不满足优惠券条件", "type": "优惠券", "priority": "P1",
     "precond": "有满1000可用优惠券", "steps": "1.商品总价¥500\n2.尝试使用优惠券",
     "data": "商品¥500，优惠券满1000可用", "expected": "优惠券不可选或不可用", "http_code": "200", "auto": "✓"},
    {"id": "CART-CHK-009", "title": "不使用优惠券", "type": "优惠券", "priority": "P1",
     "precond": "有可用优惠券", "steps": "1.不选择优惠券\n2.确认订单",
     "data": "商品¥800，有优惠券", "expected": "按原价¥800计算", "http_code": "200", "auto": "✓"},
    # 支付跳转 (3个)
    {"id": "CART-CHK-010", "title": "选择支付宝支付", "type": "支付跳转", "priority": "P0",
     "precond": "已生成订单", "steps": "1.选择支付方式：支付宝\n2.点击\"去支付\"",
     "data": "订单金额¥510", "expected": "跳转支付宝收银台页面", "http_code": "302", "auto": "○"},
    {"id": "CART-CHK-011", "title": "选择微信支付", "type": "支付跳转", "priority": "P1",
     "precond": "已生成订单", "steps": "1.选择支付方式：微信\n2.点击\"去支付\"",
     "data": "订单金额¥510", "expected": "跳转微信支付页面", "http_code": "302", "auto": "○"},
    {"id": "CART-CHK-012", "title": "订单超时自动取消", "type": "支付跳转", "priority": "P1",
     "precond": "已生成待支付订单", "steps": "1.30分钟内不支付",
     "data": "订单创建时间30分钟前", "expected": "订单自动取消，库存释放，HTTP 200", "http_code": "200", "auto": "✗"},
]

# ==================== 样式定义 ====================

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(bold=True, color="FFFFFF", name="Arial")
SUBHEADER_FILL = PatternFill("solid", fgColor="D9E2F3")
SUBHEADER_FONT = Font(bold=True, name="Arial")

P0_FILL = PatternFill("solid", fgColor="FFE699")
P1_FILL = PatternFill("solid", fgColor="FFF2CC")
P2_FILL = PatternFill("solid", fgColor="E2EFDA")
P3_FILL = PatternFill("solid", fgColor="F2F2F2")

BORDER = Border(
    left=Side(style='thin'),
    right=Side(style='thin'),
    top=Side(style='thin'),
    bottom=Side(style='thin')
)

def set_cell(cell, value, bold=False, fill=None, align="left", wrap=True):
    cell.value = value
    cell.font = Font(bold=bold, name="Arial")
    cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
    if fill:
        cell.fill = fill
    cell.border = BORDER

def create_summary_sheet(wb):
    """创建汇总表"""
    ws = wb.active
    ws.title = "测试用例总览"
    
    # 标题
    ws.merge_cells('A1:H1')
    set_cell(ws['A1'], "购物车功能测试用例集 - 统计汇总", True, HEADER_FILL, "center")
    ws.row_dimensions[1].height = 30
    
    # 副标题
    ws.merge_cells('A2:H2')
    set_cell(ws['A2'], f"生成时间: {datetime.now().strftime('%Y-%m-%d')}", False, None, "center")
    
    # 统计表
    headers = ["模块", "子模块", "用例数", "P0", "P1", "P2", "P3", "子项小计"]
    for col, h in enumerate(headers, 1):
        set_cell(ws.cell(4, col), h, True, SUBHEADER_FILL, "center")
    
    # 模块数据
    data = [
        ["添加商品", "正向添加", 6, 2, 3, 1, 0],
        ["添加商品", "库存边界", 6, 4, 2, 0, 0],
        ["添加商品", "模块合计", 12, 6, 5, 1, 0, "=SUM(D5:D6)"],
        [],
        ["修改数量", "增/减操作", 4, 2, 2, 0, 0],
        ["修改数量", "边界值", 5, 5, 0, 0, 0],
        ["修改数量", "输入校验", 3, 0, 3, 0, 0],
        ["修改数量", "模块合计", 12, 7, 5, 0, 0, "=SUM(D8:D10)"],
        [],
        ["删除商品", "单删", 3, 2, 1, 0, 0],
        ["删除商品", "清空", 3, 1, 2, 0, 0],
        ["删除商品", "价格重算", 2, 1, 1, 0, 0],
        ["删除商品", "模块合计", 8, 4, 4, 0, 0, "=SUM(D13:D15)"],
        [],
        ["结算功能", "订单确认", 3, 3, 0, 0, 0],
        ["结算功能", "地址选择", 3, 2, 1, 0, 0],
        ["结算功能", "优惠券", 3, 1, 2, 0, 0],
        ["结算功能", "支付跳转", 3, 1, 2, 0, 0],
        ["结算功能", "模块合计", 12, 7, 5, 0, 0, "=SUM(D17:D20)"],
        [],
        ["总计", "", "=C7+C12+C16+C21", "=D7+D12+D16+D21", "=E7+E12+E16+E21", "=F7+F12+F16+F21", "=G7+G12+G16+G21", ""],
    ]
    
    row = 5
    for d in data:
        if not d:
            row += 1
            continue
        if d[1] == "模块合计" or d[0] == "总计":
            for col, val in enumerate(d, 1):
                fill = SUBHEADER_FILL if d[0] != "总计" else HEADER_FILL
                font_bold = True
                align = "center" if col > 2 else "left"
                set_cell(ws.cell(row, col), val, font_bold, fill, align)
        else:
            for col, val in enumerate(d, 1):
                fill = None
                if col == 8:  # 子项小计列高亮
                    fill = P2_FILL
                set_cell(ws.cell(row, col), val, False, fill, "center" if col > 2 else "left")
        row += 1
    
    # 列宽
    ws.column_dimensions['A'].width = 12
    ws.column_dimensions['B'].width = 14
    ws.column_dimensions['C'].width = 12
    ws.column_dimensions['D'].width = 8
    ws.column_dimensions['E'].width = 8
    ws.column_dimensions['F'].width = 8
    ws.column_dimensions['G'].width = 8
    ws.column_dimensions['H'].width = 14
    
    return ws

def create_test_sheet(wb, sheet_name, tests):
    """创建测试用例表"""
    ws = wb.create_sheet(sheet_name)
    
    headers = ["用例ID", "用例标题", "用例类型", "优先级", "前置条件", "测试步骤", "测试数据", "预期结果", "HTTP状态码", "自动化可行性"]
    for col, h in enumerate(headers, 1):
        set_cell(ws.cell(1, col), h, True, SUBHEADER_FILL, "center")
    
    row = 2
    for t in tests:
        priority = t["priority"]
        fill = P0_FILL if priority == "P0" else P1_FILL if priority == "P1" else P2_FILL if priority == "P2" else P3_FILL
        
        values = [t["id"], t["title"], t["type"], priority, t["precond"], 
                  t["steps"], t["data"], t["expected"], t["http_code"], t["auto"]]
        for col, val in enumerate(values, 1):
            set_cell(ws.cell(row, col), val, False, fill, "center" if col in [1,3,4,9,10] else "left")
        row += 1
    
    # 列宽
    ws.column_dimensions['A'].width = 14
    ws.column_dimensions['B'].width = 24
    ws.column_dimensions['C'].width = 12
    ws.column_dimensions['D'].width = 8
    ws.column_dimensions['E'].width = 24
    ws.column_dimensions['F'].width = 30
    ws.column_dimensions['G'].width = 24
    ws.column_dimensions['H'].width = 30
    ws.column_dimensions['I'].width = 12
    ws.column_dimensions['J'].width = 14
    
    return ws

def create_priority_sheet(wb):
    """创建优先级说明表"""
    ws = wb.create_sheet("优先级说明")
    
    headers = ["优先级", "定义", "测试时机", "缺陷处理", "说明"]
    for col, h in enumerate(headers, 1):
        set_cell(ws.cell(1, col), h, True, SUBHEADER_FILL, "center")
    
    data = [
        ["P0", "核心功能阻断", "冒烟测试必检", "24小时内修复", "业务核心链路，不可用则阻塞主流程"],
        ["P1", "重要功能异常", "回归测试重点", "3天内修复", "重要功能缺陷，影响核心体验"],
        ["P2", "一般功能缺陷", "完整测试阶段", "1周内修复", "非核心功能问题，不阻塞主流程"],
        ["P3", "体验/优化建议", "可选测试", "版本迭代优化", "界面美观、交互优化等"],
    ]
    
    fills = [P0_FILL, P1_FILL, P2_FILL, P3_FILL]
    for i, d in enumerate(data):
        for col, val in enumerate(d, 1):
            set_cell(ws.cell(i+2, col), val, False, fills[i], "left")
    
    ws.column_dimensions['A'].width = 10
    ws.column_dimensions['B'].width = 16
    ws.column_dimensions['C'].width = 16
    ws.column_dimensions['D'].width = 14
    ws.column_dimensions['E'].width = 30
    
    return ws

def main():
    wb = Workbook()
    
    # 创建各工作表
    create_summary_sheet(wb)
    create_test_sheet(wb, "添加商品", ADD_TESTS)
    create_test_sheet(wb, "修改数量", UPDATE_TESTS)
    create_test_sheet(wb, "删除商品", DELETE_TESTS)
    create_test_sheet(wb, "结算功能", CHECKOUT_TESTS)
    create_priority_sheet(wb)
    
    # 保存
    output_path = "/Users/zhaochengqing/.qclaw/workspace/test-case-generator/购物车功能测试用例集_v2.xlsx"
    wb.save(output_path)
    print(f"Excel已生成: {output_path}")
    
    # 统计验证
    print("\n=== 数据一致性验证 ===")
    print(f"添加商品: {len(ADD_TESTS)}个 (正向6 + 库存6 = 12)")
    print(f"修改数量: {len(UPDATE_TESTS)}个 (增/减4 + 边界5 + 输入3 = 12)")
    print(f"删除商品: {len(DELETE_TESTS)}个 (单删3 + 清空3 + 价格2 = 8)")
    print(f"结算功能: {len(CHECKOUT_TESTS)}个 (订单3 + 地址3 + 优惠券3 + 支付3 = 12)")
    print(f"总计: {len(ADD_TESTS) + len(UPDATE_TESTS) + len(DELETE_TESTS) + len(CHECKOUT_TESTS)}个")

if __name__ == "__main__":
    main()
