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

**使用方法：**
```python
# 直接调用
from docx_masker import mask_docx
result = mask_docx("/path/to/document.docx")
# 输出：/path/to/document_脱敏.docx
```

### 2. 图片脱敏 (image_masker)

**支持的文件格式：** `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`

**依赖：** EasyOCR（用于文字识别）

**脱敏方式：**
- **blur**：高斯模糊
- **block**：黑块遮盖

**使用方法：**
```python
# 直接调用
from image_masker import process_image
result = process_image(
    "/path/to/image.jpg",
    output_path="/path/to/output.jpg",
    method="blur",  # 或 "block"
    use_gpu=False
)
```

### 3. 批量处理 (mask_wrapper)

**统一入口脚本：** `scripts/mask_wrapper.py`

**使用方式：**
```bash
# JSON 模式（推荐）
echo '{"command":"docx","input":"/path/to/file.docx"}' | python3 mask_wrapper.py

# 命令行模式
python3 mask_wrapper.py docx /path/to/file.docx
python3 mask_wrapper.py image /path/to/image.jpg --method blur
python3 mask_wrapper.py batch /path/to/dir --method block
```

## 环境依赖

```bash
# Python 依赖
pip install python-docx opencv-python numpy

# 图片 OCR 依赖（可选，用于图片脱敏）
pip install easyocr
```

## 文件结构

```
data-masking-skill/
├── SKILL.md              # 本文件
├── README.md             # 详细使用说明
├── requirements.txt      # Python 依赖
└── scripts/
    ├── mask_wrapper.py   # 统一入口
    ├── docx_masker.py    # Word 文档脱敏
    └── image_masker.py   # 图片脱敏
```

## 敏感词表

敏感词表文件路径（与脚本同目录）：`敏感词表.txt`

**格式：**
```
# 注释行忽略
中国移动
中国联通
某某公司
```

## 调用示例

### Python API

```python
import json
import subprocess

def mask_document(file_path, output_path=None):
    """脱敏 Word 文档"""
    cmd = [
        "python3",
        "scripts/mask_wrapper.py",
        "docx",
        file_path
    ]
    if output_path:
        cmd.extend(["-o", output_path])
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

def mask_image(file_path, method="blur", use_gpu=False):
    """脱敏图片"""
    cmd = [
        "python3",
        "scripts/mask_wrapper.py",
        "image",
        file_path,
        "--method", method
    ]
    if use_gpu:
        cmd.append("--gpu")
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)
```

### 批量处理

```python
def batch_mask(input_dir, output_dir=None):
    """批量脱敏目录中的文件"""
    cmd = [
        "python3",
        "scripts/mask_wrapper.py",
        "batch",
        input_dir,
        "--method", "blur"
    ]
    if output_dir:
        cmd.extend(["--output", output_dir])
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)
```

## 注意事项

1. **图片 OCR**：首次运行会自动下载 EasyOCR 模型（约 300MB）
2. **GPU 加速**：图片处理可使用 `--gpu` 启用 GPU 加速
3. **敏感词表**：请根据实际需求维护敏感词表文件
4. **原文件保护**：脱敏后生成新文件，不修改原文件

## 合规支持

- GDPR（通用数据保护条例）
- 《个人信息保护法》
- 《数据安全法》
