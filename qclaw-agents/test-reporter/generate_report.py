# -*- coding: utf-8 -*-
"""
测试报告PDF生成脚本
基于report-generator Skill报告结构 + 测试知识库规范
"""

import sys, os
sys.path.insert(0, os.path.expanduser("~/.qclaw/skills/pdf/scripts"))
from setup_chinese_pdf import setup_chinese_pdf

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.units import mm, cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.lib.colors import HexColor

# ── 初始化中文字体 ──
cn_font, styles = setup_chinese_pdf()

# ── 自定义样式 ──
title_style = ParagraphStyle('CnTitle', parent=styles['Title'], fontSize=22, alignment=TA_CENTER, spaceAfter=6)
subtitle_style = ParagraphStyle('CnSubtitle', parent=styles['Normal'], fontSize=11, alignment=TA_CENTER, textColor=colors.grey, spaceAfter=20)
h1_style = ParagraphStyle('CnH1', parent=styles['Heading1'], fontSize=16, spaceBefore=20, spaceAfter=10, textColor=HexColor('#1a3c6e'))
h2_style = ParagraphStyle('CnH2', parent=styles['Heading2'], fontSize=13, spaceBefore=14, spaceAfter=8, textColor=HexColor('#2E4057'))
body_style = ParagraphStyle('CnBody', parent=styles['Normal'], fontSize=10.5, leading=18, spaceAfter=6)
cell_style = ParagraphStyle('CnCell', parent=styles['Normal'], fontSize=9.5, leading=14)
cell_header_style = ParagraphStyle('CnCellH', parent=styles['Normal'], fontSize=9.5, leading=14, textColor=colors.white)
highlight_style = ParagraphStyle('CnHL', parent=styles['Normal'], fontSize=10.5, leading=18, backColor=HexColor('#fff3cd'), borderPadding=4)
note_style = ParagraphStyle('CnNote', parent=styles['Normal'], fontSize=9, leading=14, textColor=HexColor('#856404'), backColor=HexColor('#fff3cd'), borderPadding=6, spaceAfter=8)

# ── 颜色定义 ──
HEADER_BG = HexColor('#2E4057')
ALT_ROW_BG = HexColor('#f5f7fa')
PASS_COLOR = HexColor('#28a745')
FAIL_COLOR = HexColor('#dc3545')
WARN_COLOR = HexColor('#ffc107')

# ── 辅助函数 ──
def make_table(data, col_widths=None, header_bg=HEADER_BG):
    """创建格式化表格，首行为表头"""
    # 包装所有单元格为Paragraph
    table_data = []
    for i, row in enumerate(data):
        wrapped_row = []
        for cell in row:
            if i == 0:
                wrapped_row.append(Paragraph(str(cell), cell_header_style))
            else:
                wrapped_row.append(Paragraph(str(cell), cell_style))
        table_data.append(wrapped_row)

    t = Table(table_data, colWidths=col_widths, repeatRows=1)

    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), header_bg),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('FONTSIZE', (0, 0), (-1, -1), 9.5),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTNAME', (0, 0), (-1, -1), cn_font),
    ]
    # 交替行背景
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), ALT_ROW_BG))

    t.setStyle(TableStyle(style_cmds))
    return t

def section_header(text):
    return Paragraph(text, h1_style)

def sub_header(text):
    return Paragraph(text, h2_style)

def body_text(text):
    return Paragraph(text, body_style)

def note_text(text):
    return Paragraph(f"⭐ {text}", note_style)


# ── 构建报告 ──
output_path = os.path.expanduser("~/.qclaw/workspace/test-reporter/测试报告_完整版.pdf")
doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    topMargin=2*cm,
    bottomMargin=2*cm,
    leftMargin=2*cm,
    rightMargin=2*cm,
)

story = []

# ============================
# 封面
# ============================
story.append(Spacer(1, 80))
story.append(Paragraph("测 试 报 告", title_style))
story.append(Spacer(1, 10))
story.append(HRFlowable(width="80%", color=HexColor('#2E4057'), thickness=2))
story.append(Spacer(1, 20))
story.append(Paragraph("XX项目 v2.0 系统测试报告", subtitle_style))
story.append(Spacer(1, 40))

# 文档信息表
info_data = [
    ['项目名称', 'XX项目', '版本号', 'v2.0'],
    ['报告类型', '系统测试报告', '测试阶段', '系统测试'],
    ['测试周期', '2025-06-01 ~ 2025-06-20', '报告日期', '2025-06-21'],
    ['编制人', '测试组', '审核人', '请人工填写 ⭐'],
    ['AI智能体', 'test-reporter', '知识库', 'general / project-test'],
]
info_table = make_table(info_data, col_widths=[90, 140, 90, 140])
story.append(info_table)
story.append(Spacer(1, 30))
story.append(note_text("本报告由 test-reporter AI智能体自动生成，⭐标注项需人工填写确认"))
story.append(PageBreak())

# ============================
# 一、测试概述
# ============================
story.append(section_header("一、测试概述"))
story.append(body_text(
    "本次测试针对XX项目v2.0版本进行系统测试，覆盖功能测试、接口测试、安全测试和性能测试四个方面。"
    "测试周期为2025年6月1日至6月20日，共20个自然日。测试团队依据《测试中台软件功能测试规范》和"
    "《测试中台测试方法指南》执行测试工作。"
))

story.append(sub_header("1.1 测试范围"))
scope_data = [
    ['测试类型', '测试范围', '测试环境', '负责模块'],
    ['功能测试', '用户管理、订单管理、支付模块、报表模块', 'ST环境', '测试组A'],
    ['接口测试', '全部REST API接口（共86个）', 'ST环境', '测试组B'],
    ['安全测试', 'SQL注入、XSS、CSRF、权限控制、数据加密', 'ST环境', '测试组C'],
    ['性能测试', '核心业务接口并发、系统稳定性', 'PT环境', '测试组D'],
]
story.append(make_table(scope_data, col_widths=[70, 210, 60, 70]))
story.append(Spacer(1, 8))

story.append(sub_header("1.2 测试环境"))
env_data = [
    ['环境', '服务器', '操作系统', '数据库', '中间件'],
    ['ST环境', '192.168.1.100-102', 'CentOS 7.9', 'MySQL 8.0', 'Nginx 1.24 + Tomcat 9'],
    ['PT环境', '192.168.1.200-204', 'CentOS 7.9', 'MySQL 8.0', 'Nginx 1.24 + Tomcat 9'],
]
story.append(make_table(env_data, col_widths=[60, 110, 80, 70, 130]))
story.append(Spacer(1, 8))

story.append(sub_header("1.3 参考文档"))
ref_data = [
    ['序号', '文档名称', '版本', '备注'],
    ['1', 'XX项目v2.0需求规格说明书', 'v2.0', '产品部输出'],
    ['2', 'XX项目v2.0接口设计文档', 'v2.0', '开发部输出'],
    ['3', '测试中台软件功能测试规范', 'v1.2', '通用知识库'],
    ['4', '测试中台测试方法指南-功能篇', 'v1.1', '通用知识库'],
    ['5', '测试中台测试方法指南-接口篇', 'v1.0', '通用知识库'],
]
story.append(make_table(ref_data, col_widths=[40, 220, 50, 120]))
story.append(PageBreak())

# ============================
# 二、需求覆盖情况
# ============================
story.append(section_header("二、需求覆盖情况"))
story.append(body_text(
    "本次测试共涉及5个功能模块、42个需求点，已设计测试用例覆盖全部需求点，需求覆盖率达100%。"
    "以下为各模块需求覆盖详情："
))

coverage_data = [
    ['功能模块', '需求点数', '已覆盖', '覆盖率', '未覆盖原因'],
    ['用户管理', '10', '10', '100%', '-'],
    ['订单管理', '12', '12', '100%', '-'],
    ['支付模块', '8', '8', '100%', '-'],
    ['报表模块', '6', '6', '100%', '-'],
    ['系统配置', '6', '6', '100%', '-'],
    ['合计', '42', '42', '100%', '-'],
]
story.append(make_table(coverage_data, col_widths=[80, 60, 60, 60, 170]))
story.append(Spacer(1, 10))

story.append(sub_header("2.1 需求追踪矩阵（部分示例）"))
trace_data = [
    ['需求编号', '需求描述', '用例编号', '用例标题', '执行结果'],
    ['REQ-UM-001', '用户注册功能', 'TC-UM-001', '正常注册流程验证', '通过'],
    ['REQ-UM-001', '用户注册功能', 'TC-UM-002', '重复用户名注册校验', '通过'],
    ['REQ-UM-002', '用户登录功能', 'TC-UM-003', '正确账号密码登录', '通过'],
    ['REQ-UM-002', '用户登录功能', 'TC-UM-004', '错误密码登录限制', '通过'],
    ['REQ-OM-001', '创建订单', 'TC-OM-001', '正常创建订单流程', '通过'],
    ['REQ-OM-001', '创建订单', 'TC-OM-002', '库存不足时创建订单', '失败(BUG-015)'],
    ['REQ-PM-001', '在线支付', 'TC-PM-001', '支付宝支付流程', '通过'],
    ['REQ-PM-001', '在线支付', 'TC-PM-002', '微信支付流程', '通过'],
    ['REQ-PM-002', '退款处理', 'TC-PM-003', '订单退款流程验证', '通过'],
    ['REQ-RM-001', '日报表生成', 'TC-RM-001', '日报表数据准确性', '通过'],
]
story.append(make_table(trace_data, col_widths=[65, 80, 65, 110, 80]))
story.append(Spacer(1, 8))
story.append(note_text("完整需求追踪矩阵见附件，此处展示关键需求示例"))
story.append(PageBreak())

# ============================
# 三、测试用例执行情况
# ============================
story.append(section_header("三、测试用例执行情况"))

story.append(sub_header("3.1 整体执行统计"))
exec_summary = [
    ['指标', '计划', '实际', '偏差'],
    ['总用例数', '326', '326', '0'],
    ['已执行用例数', '326', '316', '-10（未执行）'],
    ['用例执行率', '100%', '96.9%', '-3.1%'],
    ['通过用例数', '-', '298', '-'],
    ['失败用例数', '-', '12', '-'],
    ['阻塞用例数', '-', '6', '-'],
    ['未执行用例数', '-', '10', '-'],
    ['用例通过率', '-', '94.3%', '-'],
]
story.append(make_table(exec_summary, col_widths=[100, 80, 80, 120]))
story.append(Spacer(1, 10))

story.append(sub_header("3.2 各模块执行详情"))
module_exec = [
    ['功能模块', '总用例', '通过', '失败', '阻塞', '未执行', '执行率', '通过率'],
    ['用户管理', '68', '65', '2', '0', '1', '98.5%', '97.0%'],
    ['订单管理', '82', '74', '4', '2', '2', '97.6%', '92.7%'],
    ['支付模块', '56', '53', '2', '1', '0', '100%', '96.4%'],
    ['报表模块', '48', '45', '1', '2', '0', '100%', '93.8%'],
    ['系统配置', '42', '38', '2', '1', '1', '97.6%', '92.7%'],
    ['接口测试', '22', '18', '1', '0', '3', '86.4%', '90.0%'],
    ['安全测试', '8', '5', '0', '0', '3', '62.5%', '100%'],
    ['合计', '326', '298', '12', '6', '10', '96.9%', '94.3%'],
]
story.append(make_table(module_exec, col_widths=[65, 45, 40, 40, 40, 45, 50, 50]))
story.append(Spacer(1, 10))

story.append(sub_header("3.3 用例优先级执行情况"))
priority_data = [
    ['优先级', '用例数', '已执行', '通过', '失败', '阻塞', '通过率'],
    ['P0-冒烟', '32', '32', '31', '1', '0', '96.9%'],
    ['P1-核心', '128', '126', '120', '4', '2', '95.2%'],
    ['P2-重要', '106', '102', '96', '5', '1', '94.1%'],
    ['P3-一般', '60', '56', '51', '2', '3', '91.1%'],
    ['合计', '326', '316', '298', '12', '6', '94.3%'],
]
story.append(make_table(priority_data, col_widths=[65, 50, 50, 45, 45, 45, 55]))
story.append(Spacer(1, 8))
story.append(note_text("P0冒烟用例中1条失败：TC-OM-002 库存不足创建订单（关联BUG-015，P1级缺陷）"))
story.append(PageBreak())

# ============================
# 四、缺陷统计
# ============================
story.append(section_header("四、缺陷统计"))

story.append(sub_header("4.1 缺陷总览"))
defect_summary = [
    ['指标', '数量', '说明'],
    ['缺陷总数', '28', '测试期间累计发现'],
    ['P0-致命', '0', '无系统崩溃或数据丢失'],
    ['P1-严重', '3', '核心功能异常，影响主流程'],
    ['P2-一般', '12', '功能存在偏差，有替代方案'],
    ['P3-轻微', '13', '界面/提示文案等小问题'],
    ['已修复', '19', '开发已修复并验证通过'],
    ['待修复', '6', '开发修复中，下版本验证'],
    ['延期处理', '3', '经评估不影响上线，延期至v2.1'],
    ['缺陷关闭率', '67.9%', '已关闭/总数'],
    ['缺陷修复率', '82.1%', '已修复+待修复/总数（含修复中）'],
]
story.append(make_table(defect_summary, col_widths=[90, 60, 280]))
story.append(Spacer(1, 10))

story.append(sub_header("4.2 缺陷按模块分布"))
defect_module = [
    ['功能模块', 'P0', 'P1', 'P2', 'P3', '合计', '已修复', '待修复', '延期'],
    ['用户管理', '0', '0', '3', '4', '7', '5', '1', '1'],
    ['订单管理', '0', '2', '4', '2', '8', '5', '2', '1'],
    ['支付模块', '0', '1', '2', '3', '6', '4', '1', '1'],
    ['报表模块', '0', '0', '2', '2', '4', '3', '1', '0'],
    ['系统配置', '0', '0', '1', '2', '3', '2', '1', '0'],
    ['合计', '0', '3', '12', '13', '28', '19', '6', '3'],
]
story.append(make_table(defect_module, col_widths=[65, 30, 30, 30, 30, 45, 50, 50, 40]))
story.append(Spacer(1, 10))

story.append(sub_header("4.3 P1严重缺陷清单"))
p1_defects = [
    ['缺陷编号', '缺陷标题', '所属模块', '发现日期', '状态', '复现概率'],
    ['BUG-015', '库存不足时创建订单未正确提示，页面卡死', '订单管理', '2025-06-08', '已修复', '必现'],
    ['BUG-019', '微信支付回调偶发失败，订单状态不更新', '支付模块', '2025-06-12', '待修复', '经常'],
    ['BUG-023', '批量导入订单超过500条时系统报500错误', '订单管理', '2025-06-16', '待修复', '必现'],
]
story.append(make_table(p1_defects, col_widths=[55, 160, 60, 60, 50, 50]))
story.append(Spacer(1, 10))

story.append(sub_header("4.4 缺陷趋势"))
trend_data = [
    ['日期', '新增缺陷', '修复缺陷', '关闭缺陷', '遗留缺陷', '累计缺陷', '关闭率'],
    ['06-01 ~ 06-05', '8', '2', '1', '7', '8', '12.5%'],
    ['06-06 ~ 06-10', '7', '5', '4', '10', '15', '33.3%'],
    ['06-11 ~ 06-15', '6', '6', '5', '11', '21', '47.6%'],
    ['06-16 ~ 06-20', '7', '7', '9', '9', '28', '67.9%'],
]
story.append(make_table(trend_data, col_widths=[80, 55, 55, 55, 55, 55, 55]))
story.append(Spacer(1, 8))
story.append(body_text(
    "缺陷趋势分析：测试前期缺陷发现速率较高，中期趋于平稳，后期遗留缺陷逐步收敛。"
    "缺陷关闭率从12.5%提升至67.9%，整体修复趋势良好。P1级缺陷3个，2个待修复，需重点关注。"
))
story.append(PageBreak())

# ============================
# 五、风险评估 ⭐
# ============================
story.append(section_header("五、风险评估 ⭐"))
story.append(note_text("本章节需人工填写评估意见，以下为AI辅助分析参考"))

risk_data = [
    ['风险项', '风险等级', '影响范围', '应对措施', '状态'],
    ['BUG-019微信支付回调偶发失败', '高', '支付模块核心流程', '增加重试机制，加强日志监控', '监控中'],
    ['BUG-023批量导入500+条报错', '高', '订单管理大数据量场景', '优化分批处理逻辑', '修复中'],
    ['安全测试未全部完成', '中', '系统安全性无法全面评估', '上线前完成剩余安全测试项', '进行中'],
    ['3个P2缺陷延期处理', '低', '用户体验轻微受影响', 'v2.1版本优先修复', '已确认'],
]
story.append(make_table(risk_data, col_widths=[110, 50, 100, 120, 50]))
story.append(PageBreak())

# ============================
# 六、测试结论 ⭐
# ============================
story.append(section_header("六、测试结论 ⭐"))
story.append(note_text("本章节需人工填写最终结论，以下为AI辅助分析参考"))
story.append(Spacer(1, 8))

story.append(sub_header("6.1 测试完成度评估"))
conclusion_data = [
    ['评估维度', '评估结果', '说明'],
    ['需求覆盖率', '100%', '全部42个需求点已覆盖'],
    ['用例执行率', '96.9%', '10条用例未执行（安全测试3条+接口3条+其他4条）'],
    ['用例通过率', '94.3%', '298条通过，12条失败，6条阻塞'],
    ['P0/P1用例通过率', '95.6%', 'P0 96.9% + P1 95.2%'],
    ['缺陷修复率', '82.1%', '已修复19个，待修复6个，延期3个'],
    ['P1缺陷修复率', '33.3%', '3个P1仅1个已修复，2个待修复'],
    ['冒烟测试通过', '96.9%', '32条冒烟用例31条通过'],
]
story.append(make_table(conclusion_data, col_widths=[100, 80, 260]))
story.append(Spacer(1, 10))

story.append(sub_header("6.2 建议结论"))
story.append(body_text(
    "<b>有条件通过 — 建议修复P1缺陷后上线</b>"
))
story.append(body_text(
    "1. 本次测试需求覆盖率达100%，用例执行率96.9%，整体测试覆盖充分。<br/>"
    "2. P0级致命缺陷为0，系统核心功能基本可用。<br/>"
    "3. 存在2个P1级待修复缺陷（BUG-019微信支付回调失败、BUG-023批量导入报错），建议修复并回归验证后再上线。<br/>"
    "4. 3个P2缺陷延期至v2.1版本，不影响核心业务流程。<br/>"
    "5. 安全测试尚未全部完成，建议上线前补齐剩余安全测试项。<br/>"
    "6. 综合评估：建议修复P1缺陷后安排上线，上线后持续关注微信支付回调稳定性。"
))
story.append(PageBreak())

# ============================
# 七、遗留问题清单
# ============================
story.append(section_header("七、遗留问题清单"))

remain_data = [
    ['序号', '问题编号', '问题描述', '严重程度', '负责人', '计划修复版本', '状态'],
    ['1', 'BUG-019', '微信支付回调偶发失败，订单状态不更新', 'P1', '开发组A', 'v2.0', '修复中'],
    ['2', 'BUG-023', '批量导入订单超过500条报500错误', 'P1', '开发组B', 'v2.0', '修复中'],
    ['3', 'BUG-005', '用户头像上传偶发裁切失败', 'P2', '开发组A', 'v2.1', '延期'],
    ['4', 'BUG-010', '订单列表排序不稳定性', 'P2', '开发组B', 'v2.1', '延期'],
    ['5', 'BUG-018', '导出Excel金额格式不一致', 'P2', '开发组C', 'v2.1', '延期'],
    ['6', '-', '安全测试3项未完成', '-', '测试组C', '上线前', '进行中'],
    ['7', '-', '接口测试3条用例待环境就绪后执行', '-', '测试组B', 'v2.0', '待执行'],
]
story.append(make_table(remain_data, col_widths=[30, 50, 140, 40, 50, 55, 45]))
story.append(Spacer(1, 15))

# ============================
# 附录
# ============================
story.append(section_header("附录"))
story.append(body_text(
    "附录A：完整需求追踪矩阵（Excel格式，另附）<br/>"
    "附录B：完整缺陷清单（Excel格式，另附）<br/>"
    "附录C：测试用例执行明细（Excel格式，另附）<br/>"
    "附录D：性能测试报告（单独文档）<br/>"
    "附录E：安全测试报告（单独文档）<br/>"
))
story.append(Spacer(1, 20))
story.append(HRFlowable(width="100%", color=HexColor('#2E4057'), thickness=1))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "本报告由 test-reporter AI智能体自动生成 | 基于测试中台AI智能体协作体系 | 2025-06-21",
    ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, alignment=TA_CENTER, textColor=colors.grey)
))

# ── 构建PDF ──
doc.build(story)
print(f"PDF报告已生成: {output_path}")
