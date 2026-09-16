# Data Masking Skill - 数据脱敏技能

## 概述

提供专业的数据脱敏能力，支持 Word 文档、图片和批量文件的敏感信息处理。

## 功能

### 1. Word 文档脱敏 (docx_masker)

**支持的文件格式：** `.docx`

**脱敏规则：**
- **手机号**：138****1234（保留前3后4）
- **身份证号**：前4后2保留，中间打星
- **邮箱**：a***@example.com（首字母保留）
- **银行卡/长数字**：前4后4保留，中间打星
- **敏感词表**：首尾保留，中间打星（如"中国移动"→"中**动"）

### 2. 图片脱敏 (image_masker)

**支持的文件格式：** `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`

**依赖：** EasyOCR（用于文字识别）

**脱敏方式：**
- **blur**：高斯模糊
- **block**：黑块遮盖

### 3. 批量处理 (mask_wrapper)

统一入口脚本：`scripts/mask_wrapper.py`

## 安装依赖

```bash
# 核心依赖
pip install python-docx opencv-python numpy

# 图片 OCR 依赖（可选，用于图片脱敏）
pip install easyocr
```

## 使用方式

### Python API

```python
# Word 文档脱敏
from docx_masker import mask_docx
result = mask_docx("/path/to/document.docx")

# 图片脱敏
from image_masker import process_image
result = process_image(
    "/path/to/image.jpg",
    output_path="/path/to/output.jpg",
    method="blur"
)
```

### 命令行

```bash
# docx 脱敏
python3 scripts/mask_wrapper.py docx /path/to/file.docx

# 图片脱敏（模糊）
python3 scripts/mask_wrapper.py image /path/to/image.jpg --method blur

# 图片脱敏（黑块）
python3 scripts/mask_wrapper.py image /path/to/image.jpg --method block

# 批量处理
python3 scripts/mask_wrapper.py batch /path/to/dir
```

### JSON 模式

```bash
echo '{"command":"docx","input":"/path/to/file.docx"}' | python3 scripts/mask_wrapper.py
```

## 敏感词表

敏感词表文件路径：`敏感词表.txt`

**格式：**
```
# 注释行忽略
中国移动
中国联通
某某公司
```

## 合规支持

- GDPR（通用数据保护条例）
- 《个人信息保护法》
- 《数据安全法》
