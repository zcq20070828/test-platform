#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
购物车功能测试用例生成脚本
生成结构化测试用例Excel文件
"""

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def create_cart_test_cases():
    wb = Workbook()
    
    # ============ Sheet 1: 测试用例总览 ============
    ws_summary = wb.active
    ws_summary.title = "测试用例总览"
    
    # 样式定义
    header_fill = PatternFill("solid", fgColor="4472C4")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    title_font = Font(bold=True, size=14)
    border = Border(
        left=Side(style='thin'),
        right=Side(style='thin'),
        top=Side(style='thin'),
        bottom=Side(style='thin')
    )
    
    # 标题
    ws_summary['A1'] = "购物车功能测试用例集"
    ws_summary['A1'].font = title_font
    ws_summary.merge_cells('A1:F1')
    
    # 统计信息
    ws_summary['A3'] = "模块"
    ws_summary['B3'] = "用例数量"
    ws_summary['C3'] = "P0用例"
    ws_summary['D3'] = "P1用例"
    ws_summary['E3'] = "P2用例"
    ws_summary['F3'] = "P3用例"
    
    for cell in ['A3', 'B3', 'C3', 'D3', 'E3', 'F3']:
        ws_summary[cell].fill = header_fill
        ws_summary[cell].font = header_font
        ws_summary[cell].alignment = Alignment(horizontal='center', vertical='center')
        ws_summary[cell].border = border
    
    summary_data = [
        ("添加商品", 12, 3, 5, 3, 1),
        ("修改数量", 10, 2, 4, 3, 1),
        ("删除商品", 8, 2, 3, 2, 1),
        ("结算功能", 10, 3, 4, 2, 1),
        ("合计", 40, 10, 16, 10, 4)
    ]
    
    for i, row in enumerate(summary_data, start=4):
        for j, val in enumerate(row, start=1):
            cell = ws_summary.cell(row=i, column=j, value=val)
            cell.border = border
            cell.alignment = Alignment(horizontal='center', vertical='center')
            if i == 8:  # 合计行加粗
                cell.font = Font(bold=True)
    
    # 设置列宽
    ws_summary.column_dimensions['A'].width = 15
    ws_summary.column_dimensions['B'].width = 12
    ws_summary.column_dimensions['C'].width = 10
    ws_summary.column_dimensions['D'].width = 10
    ws_summary.column_dimensions['E'].width = 10
    ws_summary.column_dimensions['F'].width = 10
    
    # ============ Sheet 2: 添加商品测试用例 ============
    ws_add = wb.create_sheet("添加商品")
    
    headers = ["用例ID", "模块", "用例标题", "用例类型", "优先级", "前置条件", "测试步骤", "测试数据", "预期结果", "HTTP状态码", "自动化可行性", "备注"]
    
    # 表头
    for col, header in enumerate(headers, start=1):
        cell = ws_add.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = border
    
    add_cases = [
        # 正向添加
        ("CART-ADD-001", "添加商品", "添加单件商品到购物车", "正向", "P0", "用户已登录，商品有库存", 
         "1. 打开商品详情页\n2. 点击'加入购物车'按钮\n3. 确认提示信息", 
         "商品ID: SKU001\n数量: 1", 
         "1. 购物车数量更新+1\n2. 页面显示添加成功提示\n3. 购物车图标显示正确数量",
         "200", "AI可执行", ""),
        
        ("CART-ADD-002", "添加商品", "添加商品到购物车并继续购物", "正向", "P1", "用户已登录，商品有库存",
         "1. 打开商品详情页\n2. 点击'加入购物车'按钮\n3. 点击'继续购物'按钮",
         "商品ID: SKU002\n数量: 1",
         "1. 购物车数量+1\n2. 停留在当前页面\n3. 可继续添加其他商品",
         "200", "AI可执行", ""),
        
        # 多商品添加
        ("CART-ADD-003", "添加商品", "添加多件不同商品到购物车", "正向", "P0", "用户已登录，多个商品有库存",
         "1. 添加商品A到购物车\n2. 返回商品列表\n3. 添加商品B到购物车\n4. 添加商品C到购物车",
         "商品A: SKU001\n商品B: SKU002\n商品C: SKU003\n各数量: 1",
         "1. 购物车显示3种商品\n2. 购物车总数量=3\n3. 各商品信息正确显示",
         "200", "AI可执行", ""),
        
        ("CART-ADD-004", "添加商品", "同一商品添加多次", "正向", "P1", "用户已登录，商品库存充足",
         "1. 添加商品A，数量1\n2. 再添加同一商品A，数量2",
         "商品ID: SKU001\n首次数量: 1\n再次数量: 2",
         "1. 购物车中该商品数量累计为3\n2. 不产生重复的商品行",
         "200", "AI可执行", ""),
        
        # 重复添加
        ("CART-ADD-005", "添加商品", "购物车中已有商品再次添加", "正向", "P1", "购物车中已有商品SKU001",
         "1. 查看购物车确认商品存在\n2. 再次添加SKU001到购物车",
         "已有商品: SKU001(数量1)\n新增数量: 2",
         "1. 商品数量累加\n2. 显示累计后的数量",
         "200", "AI可执行", ""),
        
        ("CART-ADD-006", "添加商品", "重复添加后验证价格计算", "正向", "P1", "购物车中已有商品",
         "1. 添加商品到购物车\n2. 再次添加同一商品\n3. 查看购物车总价",
         "商品单价: ¥100\n首次添加: 1件\n再次添加: 1件",
         "1. 商品数量=2\n2. 该商品小计=¥200\n3. 购物车总价正确",
         "200", "AI可执行", ""),
        
        # 库存边界
        ("CART-ADD-007", "添加商品", "添加商品达到库存上限", "边界", "P0", "商品库存=10",
         "1. 添加商品到购物车\n2. 数量设置为10\n3. 确认添加",
         "商品库存: 10\n添加数量: 10",
         "1. 添加成功\n2. 购物车显示数量=10\n3. 库存同步扣减",
         "200", "AI可执行", ""),
        
        ("CART-ADD-008", "添加商品", "添加商品超过库存上限", "边界", "P0", "商品库存=10",
         "1. 添加商品到购物车\n2. 数量设置为11\n3. 点击确认",
         "商品库存: 10\n尝试添加数量: 11",
         "1. 提示'库存不足'\n2. 不允许添加\n3. 购物车数量不变",
         "400", "AI可执行", "库存不足提示"),
        
        ("CART-ADD-009", "添加商品", "添加商品数量为0", "边界", "P1", "商品有库存",
         "1. 选择商品\n2. 数量设置为0\n3. 点击添加",
         "商品库存: 100\n添加数量: 0",
         "1. 提示'数量必须大于0'\n2. 不允许添加",
         "400", "AI可执行", "参数校验"),
        
        ("CART-ADD-010", "添加商品", "添加商品数量为负数", "边界", "P0", "商品有库存",
         "1. 选择商品\n2. 数量设置为-1\n3. 点击添加",
         "商品库存: 100\n添加数量: -1",
         "1. 提示'数量格式错误'\n2. 不允许添加\n3. 返回400错误",
         "400", "AI可执行", "参数校验-必检"),
        
        ("CART-ADD-011", "添加商品", "添加商品数量为小数", "边界", "P1", "商品有库存",
         "1. 选择商品\n2. 数量设置为1.5\n3. 点击添加",
         "商品库存: 100\n添加数量: 1.5",
         "1. 提示'数量必须为整数'\n2. 不允许添加",
         "400", "AI可执行", "参数校验"),
        
        ("CART-ADD-012", "添加商品", "添加已下架商品", "异常", "P0", "商品已下架",
         "1. 搜索已下架商品\n2. 点击添加到购物车",
         "商品ID: SKU_OFFLINE\n状态: 已下架",
         "1. 提示'商品已下架'\n2. 不允许添加到购物车",
         "400", "AI可执行", "业务规则验证"),
    ]
    
    for row_idx, case in enumerate(add_cases, start=2):
        for col_idx, val in enumerate(case, start=1):
            cell = ws_add.cell(row=row_idx, column=col_idx, value=val)
            cell.border = border
            cell.alignment = Alignment(vertical='top', wrap_text=True)
            # 优先级着色
            if col_idx == 5:
                if val == "P0":
                    cell.fill = PatternFill("solid", fgColor="FF0000")
                    cell.font = Font(color="FFFFFF", bold=True)
                elif val == "P1":
                    cell.fill = PatternFill("solid", fgColor="FFA500")
    
    # 设置列宽
    col_widths = [15, 12, 25, 10, 10, 20, 30, 20, 30, 12, 12, 15]
    for i, width in enumerate(col_widths, start=1):
        ws_add.column_dimensions[get_column_letter(i)].width = width
    
    # ============ Sheet 3: 修改数量测试用例 ============
    ws_update = wb.create_sheet("修改数量")
    
    for col, header in enumerate(headers, start=1):
        cell = ws_update.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = border
    
    update_cases = [
        # 增/减操作
        ("CART-UPD-001", "修改数量", "点击加号增加商品数量", "正向", "P0", "购物车中有商品",
         "1. 进入购物车\n2. 点击商品数量旁的'+'按钮",
         "初始数量: 1\n点击'+'一次",
         "1. 数量增加至2\n2. 商品小计更新\n3. 购物车总价更新",
         "200", "AI可执行", ""),
        
        ("CART-UPD-002", "修改数量", "点击减号减少商品数量", "正向", "P0", "购物车中有商品，数量≥2",
         "1. 进入购物车\n2. 点击商品数量旁的'-'按钮",
         "初始数量: 3\n点击'-'一次",
         "1. 数量减少至2\n2. 商品小计更新\n3. 购物车总价更新",
         "200", "AI可执行", ""),
        
        ("CART-UPD-003", "修改数量", "连续点击增加按钮", "正向", "P1", "购物车中有商品，库存充足",
         "1. 进入购物车\n2. 连续点击'+'按钮5次",
         "初始数量: 1\n点击次数: 5",
         "1. 数量增加至6\n2. 每次点击都有响应\n3. 最终数量和价格正确",
         "200", "AI可执行", ""),
        
        ("CART-UPD-004", "修改数量", "直接输入修改商品数量", "正向", "P0", "购物车中有商品",
         "1. 进入购物车\n2. 点击数量输入框\n3. 清空并输入新数量\n4. 确认修改",
         "初始数量: 1\n新数量: 5",
         "1. 数量更新为5\n2. 小计和总价同步更新",
         "200", "AI可执行", ""),
        
        # 边界值
        ("CART-UPD-005", "修改数量", "数量减少到0触发删除确认", "边界", "P0", "购物车中有商品",
         "1. 进入购物车\n2. 数量为1时点击'-'按钮",
         "初始数量: 1\n操作: 点击'-'",
         "1. 弹出确认对话框'确定要删除该商品吗？'\n2. 确认后商品从购物车移除",
         "200", "AI可执行", "与删除功能联动"),
        
        ("CART-UPD-006", "修改数量", "修改数量为最大库存", "边界", "P0", "商品库存=100",
         "1. 进入购物车\n2. 修改商品数量为100",
         "商品库存: 100\n修改数量: 100",
         "1. 修改成功\n2. 数量显示为100\n3. 库存同步",
         "200", "AI可执行", ""),
        
        ("CART-UPD-007", "修改数量", "修改数量超过最大库存", "边界", "P0", "商品库存=100",
         "1. 进入购物车\n2. 修改商品数量为101",
         "商品库存: 100\n尝试修改为: 101",
         "1. 提示'库存不足'\n2. 数量保持不变\n3. 阻止提交",
         "400", "AI可执行", "库存校验-必检"),
        
        ("CART-UPD-008", "修改数量", "修改数量为0", "边界", "P0", "购物车中有商品",
         "1. 进入购物车\n2. 修改数量为0",
         "商品库存: 100\n修改数量: 0",
         "1. 提示'数量必须大于0'\n2. 不允许修改",
         "400", "AI可执行", "参数校验"),
        
        ("CART-UPD-009", "修改数量", "修改数量为负数", "边界", "P0", "购物车中有商品",
         "1. 进入购物车\n2. 修改数量为-1",
         "商品库存: 100\n修改数量: -1",
         "1. 提示'数量格式错误'\n2. 数量保持不变\n3. 返回400",
         "400", "AI可执行", "参数校验-必检"),
        
        # 输入校验
        ("CART-UPD-010", "修改数量", "输入非数字字符", "异常", "P0", "购物车中有商品",
         "1. 点击数量输入框\n2. 输入'aaa'\n3. 确认修改",
         "输入内容: aaa",
         "1. 提示'请输入有效数字'\n2. 数量保持不变",
         "400", "AI可执行", "参数校验-必检"),
        
        ("CART-UPD-011", "修改数量", "输入超长数字", "异常", "P1", "购物车中有商品",
         "1. 点击数量输入框\n2. 输入999999999999",
         "输入内容: 999999999999",
         "1. 提示'数量超出范围'\n2. 数量保持不变",
         "400", "AI可执行", "参数校验"),
        
        ("CART-UPD-012", "修改数量", "输入小数", "边界", "P1", "购物车中有商品",
         "1. 点击数量输入框\n2. 输入1.5\n3. 确认修改",
         "输入内容: 1.5",
         "1. 提示'数量必须为整数'\n2. 数量保持不变",
         "400", "AI可执行", "参数校验"),
    ]
    
    for row_idx, case in enumerate(update_cases, start=2):
        for col_idx, val in enumerate(case, start=1):
            cell = ws_update.cell(row=row_idx, column=col_idx, value=val)
            cell.border = border
            cell.alignment = Alignment(vertical='top', wrap_text=True)
            if col_idx == 5:
                if val == "P0":
                    cell.fill = PatternFill("solid", fgColor="FF0000")
                    cell.font = Font(color="FFFFFF", bold=True)
                elif val == "P1":
                    cell.fill = PatternFill("solid", fgColor="FFA500")
    
    for i, width in enumerate(col_widths, start=1):
        ws_update.column_dimensions[get_column_letter(i)].width = width
    
    # ============ Sheet 4: 删除商品测试用例 ============
    ws_delete = wb.create_sheet("删除商品")
    
    for col, header in enumerate(headers, start=1):
        cell = ws_delete.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = border
    
    delete_cases = [
        # 单删
        ("CART-DEL-001", "删除商品", "删除购物车中单个商品", "正向", "P0", "购物车中有至少2个商品",
         "1. 进入购物车\n2. 点击商品行的删除按钮\n3. 确认删除",
         "商品SKU: SKU001\n购物车共2个商品",
         "1. 商品从列表移除\n2. 购物车剩余1个商品\n3. 购物车总价更新",
         "200", "AI可执行", ""),
        
        ("CART-DEL-002", "删除商品", "删除购物车中最后一件商品", "正向", "P0", "购物车中只有1个商品",
         "1. 进入购物车\n2. 点击删除按钮\n3. 确认删除",
         "购物车只有1个商品",
         "1. 商品移除\n2. 购物车显示空状态\n3. 提示'购物车是空的'",
         "200", "AI可执行", ""),
        
        ("CART-DEL-003", "删除商品", "取消删除操作", "正向", "P1", "购物车中有商品",
         "1. 点击删除按钮\n2. 在确认弹窗点击'取消'",
         "购物车有商品",
         "1. 弹窗关闭\n2. 商品保留在购物车\n3. 数量和价格不变",
         "200", "AI可执行", ""),
        
        # 清空
        ("CART-DEL-004", "删除商品", "清空购物车", "正向", "P0", "购物车中有多个商品",
         "1. 进入购物车\n2. 点击'清空购物车'按钮\n3. 确认清空",
         "购物车有5个商品",
         "1. 所有商品移除\n2. 购物车显示空状态\n3. 购物车数量归0",
         "200", "AI可执行", ""),
        
        ("CART-DEL-005", "删除商品", "取消清空购物车", "正向", "P1", "购物车中有多个商品",
         "1. 点击'清空购物车'\n2. 在确认弹窗点击'取消'",
         "购物车有多个商品",
         "1. 弹窗关闭\n2. 所有商品保留\n3. 价格不变",
         "200", "AI可执行", ""),
        
        ("CART-DEL-006", "删除商品", "清空已选商品", "正向", "P1", "购物车中部分商品被选中",
         "1. 勾选多个商品\n2. 点击'删除选中'按钮\n3. 确认删除",
         "购物车5个商品，选中2个",
         "1. 只删除选中的2个\n2. 未选中3个保留\n3. 价格更新",
         "200", "AI可执行", ""),
        
        # 删除后价格重算
        ("CART-DEL-007", "删除商品", "删除商品后总价重算", "正向", "P0", "购物车中有3个商品，总价已知",
         "1. 记录当前总价\n2. 删除其中一个商品\n3. 查看新总价",
         "商品A: ¥100\n商品B: ¥200\n商品C: ¥150\n删除商品B",
         "1. 商品B移除\n2. 新总价 = ¥100+¥150 = ¥250\n3. 总价正确更新",
         "200", "AI可执行", ""),
        
        ("CART-DEL-008", "删除商品", "删除商品后勾选状态重算", "正向", "P1", "购物车中有多个商品，部分选中",
         "1. 选中部分商品\n2. 删除已选中的一个\n3. 查看选中商品总价",
         "商品A(¥100)选中\n商品B(¥200)选中\n商品C(¥150)未选\n删除商品A",
         "1. 商品A移除\n2. 选中状态重新计算\n3. 选中商品总价=¥200",
         "200", "AI可执行", ""),
    ]
    
    for row_idx, case in enumerate(delete_cases, start=2):
        for col_idx, val in enumerate(case, start=1):
            cell = ws_delete.cell(row=row_idx, column=col_idx, value=val)
            cell.border = border
            cell.alignment = Alignment(vertical='top', wrap_text=True)
            if col_idx == 5:
                if val == "P0":
                    cell.fill = PatternFill("solid", fgColor="FF0000")
                    cell.font = Font(color="FFFFFF", bold=True)
                elif val == "P1":
                    cell.fill = PatternFill("solid", fgColor="FFA500")
    
    for i, width in enumerate(col_widths, start=1):
        ws_delete.column_dimensions[get_column_letter(i)].width = width
    
    # ============ Sheet 5: 结算功能测试用例 ============
    ws_checkout = wb.create_sheet("结算功能")
    
    for col, header in enumerate(headers, start=1):
        cell = ws_checkout.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = border
    
    checkout_cases = [
        # 订单确认
        ("CART-CHK-001", "结算功能", "正常流程结算订单", "正向", "P0", "用户已登录，购物车有商品，有收货地址",
         "1. 进入购物车\n2. 确认商品和数量\n3. 点击'去结算'按钮\n4. 确认订单信息\n5. 点击'提交订单'",
         "商品总价: ¥500\n运费: ¥10\n优惠: ¥50\n实付: ¥460",
         "1. 跳转至订单确认页\n2. 显示商品列表、价格、运费\n3. 提交成功生成订单\n4. 跳转至支付页面",
         "200", "AI可执行", ""),
        
        ("CART-CHK-002", "结算功能", "结算空购物车", "异常", "P0", "购物车为空",
         "1. 进入购物车\n2. 点击'去结算'按钮",
         "购物车: 空",
         "1. 按钮不可点击\n2. 或提示'请先添加商品'\n3. 无法进入结算流程",
         "400", "AI可执行", "前置条件校验"),
        
        ("CART-CHK-003", "结算功能", "结算已失效商品", "异常", "P0", "购物车中有已下架或失效商品",
         "1. 进入购物车\n2. 点击'去结算'\n3. 发现失效商品",
         "商品SKU001: 已下架\n商品SKU002: 正常",
         "1. 提示失效商品信息\n2. 失效商品不可结算\n3. 只能结算有效商品",
         "400", "AI可执行", "商品状态校验"),
        
        # 地址选择
        ("CART-CHK-004", "结算功能", "选择已有收货地址结算", "正向", "P0", "用户有多个收货地址",
         "1. 进入结算页\n2. 点击'选择收货地址'\n3. 选择非默认地址\n4. 确认订单",
         "默认地址: 北京\n新选地址: 上海",
         "1. 地址切换成功\n2. 订单收货地址更新\n3. 运费可能变化",
         "200", "AI可执行", ""),
        
        ("CART-CHK-005", "结算功能", "新增收货地址后结算", "正向", "P1", "用户没有收货地址",
         "1. 进入结算页\n2. 点击'新增收货地址'\n3. 填写完整信息\n4. 保存并选择\n5. 确认订单",
         "收货人: 张三\n手机: 13800138000\n地址: 上海市浦东新区xxx",
         "1. 地址保存成功\n2. 自动选中新地址\n3. 继续结算流程",
         "200", "AI可执行", ""),
        
        ("CART-CHK-006", "结算功能", "不选择收货地址提交订单", "异常", "P0", "用户没有收货地址",
         "1. 进入结算页\n2. 不添加收货地址\n3. 尝试提交订单",
         "收货地址: 空",
         "1. 提示'请添加收货地址'\n2. 阻止提交订单",
         "400", "AI可执行", "必填项校验"),
        
        # 优惠券应用
        ("CART-CHK-007", "结算功能", "使用有效优惠券", "正向", "P0", "用户有可用优惠券",
         "1. 进入结算页\n2. 点击'使用优惠券'\n3. 选择优惠券\n4. 确认使用",
         "商品总价: ¥1000\n优惠券: 满500减100",
         "1. 优惠金额=¥100\n2. 实付金额=¥900\n3. 订单总价更新",
         "200", "AI可执行", ""),
        
        ("CART-CHK-008", "结算功能", "不满足优惠券使用条件", "异常", "P1", "用户有优惠券但不满足条件",
         "1. 进入结算页\n2. 查看可用优惠券\n3. 尝试使用满1000减200券",
         "商品总价: ¥500\n优惠券条件: 满1000可用",
         "1. 优惠券不可选\n2. 或提示'不满足使用条件'\n3. 无法应用",
         "200", "AI可执行", "优惠券规则校验"),
        
        ("CART-CHK-009", "结算功能", "不使用优惠券结算", "正向", "P1", "用户有可用优惠券",
         "1. 进入结算页\n2. 不选择优惠券\n3. 直接提交订单",
         "商品总价: ¥500\n有优惠券但不使用",
         "1. 订单按原价计算\n2. 不扣除优惠金额\n3. 正常提交",
         "200", "AI可执行", ""),
        
        # 支付跳转
        ("CART-CHK-010", "结算功能", "选择支付宝支付", "正向", "P0", "订单已确认",
         "1. 提交订单\n2. 选择支付方式\n3. 点击'去支付'",
         "支付方式: 支付宝",
         "1. 跳转至支付宝支付页面\n2. 订单状态待支付\n3. 支付倒计时显示",
         "200", "AI可执行", "需实际支付环境"),
        
        ("CART-CHK-011", "结算功能", "选择微信支付", "正向", "P1", "订单已确认",
         "1. 提交订单\n2. 选择支付方式\n3. 点击'去支付'",
         "支付方式: 微信支付",
         "1. 跳转至微信支付页面\n2. 订单状态待支付",
         "200", "AI可执行", "需实际支付环境"),
        
        ("CART-CHK-012", "结算功能", "订单超时未支付自动取消", "异常", "P1", "订单创建后未支付",
         "1. 创建订单\n2. 不进行支付\n3. 等待30分钟",
         "订单创建时间: T\n支付时限: 30分钟",
         "1. 订单自动取消\n2. 库存释放\n3. 收到取消通知",
         "200", "人工验证", "需等待测试"),
    ]
    
    for row_idx, case in enumerate(checkout_cases, start=2):
        for col_idx, val in enumerate(case, start=1):
            cell = ws_checkout.cell(row=row_idx, column=col_idx, value=val)
            cell.border = border
            cell.alignment = Alignment(vertical='top', wrap_text=True)
            if col_idx == 5:
                if val == "P0":
                    cell.fill = PatternFill("solid", fgColor="FF0000")
                    cell.font = Font(color="FFFFFF", bold=True)
                elif val == "P1":
                    cell.fill = PatternFill("solid", fgColor="FFA500")
    
    for i, width in enumerate(col_widths, start=1):
        ws_checkout.column_dimensions[get_column_letter(i)].width = width
    
    # ============ Sheet 6: 优先级说明 ============
    ws_priority = wb.create_sheet("优先级说明")
    
    priority_headers = ["优先级", "定义", "测试时机", "缺陷处理"]
    for col, header in enumerate(priority_headers, start=1):
        cell = ws_priority.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = border
    
    priority_data = [
        ("P0", "核心功能阻断", "冒烟测试必检项", "严重缺陷，24小时内修复"),
        ("P1", "重要功能异常", "回归测试重点", "高优先级缺陷，3天内修复"),
        ("P2", "一般功能缺陷", "完整测试阶段", "中等缺陷，1周内修复"),
        ("P3", "体验/优化建议", "可选测试", "低优先级，版本迭代优化"),
    ]
    
    for row_idx, row in enumerate(priority_data, start=2):
        for col_idx, val in enumerate(row, start=1):
            cell = ws_priority.cell(row=row_idx, column=col_idx, value=val)
            cell.border = border
            cell.alignment = Alignment(vertical='center', wrap_text=True)
            if col_idx == 1:
                if val == "P0":
                    cell.fill = PatternFill("solid", fgColor="FF0000")
                    cell.font = Font(color="FFFFFF", bold=True)
                elif val == "P1":
                    cell.fill = PatternFill("solid", fgColor="FFA500")
    
    ws_priority.column_dimensions['A'].width = 12
    ws_priority.column_dimensions['B'].width = 20
    ws_priority.column_dimensions['C'].width = 20
    ws_priority.column_dimensions['D'].width = 25
    
    # 保存文件
    output_path = "/Users/zhaochengqing/.qclaw/workspace/test-case-generator/购物车功能测试用例集.xlsx"
    wb.save(output_path)
    print(f"测试用例已生成: {output_path}")
    return output_path

if __name__ == "__main__":
    create_cart_test_cases()
