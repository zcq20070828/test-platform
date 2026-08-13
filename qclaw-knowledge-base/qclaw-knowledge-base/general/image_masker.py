# _*_ coding: utf-8 _*_

import os
import re
import argparse
import cv2
import numpy as np

try:
    import easyocr
except ImportError:
    raise ImportError("请先安装: pip install easyocr")

# ========= 敏感规则（与 docx 脱敏一致，可按需扩展）=========

PHONE_PATTERN = re.compile(r'1\d{10}')
ID_PATTERN = re.compile(r'\d{15}(\d{2}[0-9Xx])?')
EMAIL_PATTERN = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
LONG_NUMBER_PATTERN = re.compile(r'\d{12,}')

# 敏感词表路径：与脚本同目录下的 敏感词表.txt
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SENSITIVE_WORDS_FILE = os.path.join(_SCRIPT_DIR, "敏感词表.txt")


def load_sensitive_words(file_path: str = None) -> list:
    """
    从敏感词表文件加载敏感词列表。
    每行一个词，# 开头和空行忽略。文件不存在或读失败时返回空列表。
    """
    path = file_path or SENSITIVE_WORDS_FILE
    words = []
    if not os.path.isfile(path):
        return words
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    words.append(line)
    except Exception:
        pass
    return words


def get_sensitive_spans(text: str, sensitive_words: list = None) -> list:
    """
    返回需要脱敏的字符区间 [(start, end), ...]，按字符下标。
    敏感词只脱敏词本身；正则命中整段。
    """
    if not text or not text.strip():
        return []
    t = text.strip()
    spans = []

    # 正则：记录命中区间
    for pattern in (PHONE_PATTERN, ID_PATTERN, EMAIL_PATTERN, LONG_NUMBER_PATTERN):
        for m in pattern.finditer(t):
            spans.append((m.start(), m.end()))

    # 敏感词表：只记录命中词的位置
    if sensitive_words:
        for w in sensitive_words:
            if not w:
                continue
            start = 0
            while True:
                idx = t.find(w, start)
                if idx == -1:
                    break
                spans.append((idx, idx + len(w)))
                start = idx + 1

    if not spans:
        return []
    spans.sort(key=lambda x: (x[0], x[1]))
    merged = [spans[0]]
    for s, e in spans[1:]:
        if s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def is_sensitive(text: str, sensitive_words: list = None) -> bool:
    """判断一段文字是否包含敏感信息（正则规则 + 敏感词表）"""
    return len(get_sensitive_spans(text, sensitive_words)) > 0


def clamp_bbox(bbox, height, width):
    """把 bbox 限制在图片范围内，并保证 x2>x1, y2>y1"""
    pts = np.array(bbox, dtype=np.int32)
    x1 = max(0, int(pts[:, 0].min()))
    y1 = max(0, int(pts[:, 1].min()))
    x2 = min(width, int(pts[:, 0].max()) + 1)
    y2 = min(height, int(pts[:, 1].max()) + 1)
    if x2 <= x1:
        x2 = x1 + 1
    if y2 <= y1:
        y2 = y1 + 1
    return x1, y1, x2, y2


def mask_region(img: np.ndarray, x1: int, y1: int, x2: int, y2: int, method: str = "blur"):
    """
    对 img[y1:y2, x1:x2] 做脱敏。
    method: "blur" 高斯模糊 | "block" 纯色块遮盖
    """
    if method == "blur":
        roi = img[y1:y2, x1:x2]
        if roi.size == 0:
            return
        # 模糊块稍大一点，避免边缘露馅
        k = max(3, min(roi.shape[0], roi.shape[1]) // 2)
        if k % 2 == 0:
            k += 1
        img[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (k, k), 0)
    else:
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 0), -1)


def process_image(
    image_path: str,
    output_path: str = None,
    lang: list = None,
    method: str = "blur",
    use_gpu: bool = False,
) -> str:
    """
    对单张图片做内容脱敏。

    :param image_path: 输入图片路径
    :param output_path: 输出路径，默认 原名_脱敏.扩展名
    :param lang: OCR 语言，默认 ['ch_sim', 'en']
    :param method: "blur" 模糊 | "block" 黑块
    :param use_gpu: 是否使用 GPU（EasyOCR）
    :return: 输出文件路径
    """
    if lang is None:
        lang = ['ch_sim', 'en']

    # img = cv2.imread(image_path)
    with open(image_path, "rb") as f:
        data = f.read()
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"无法读取图片：{image_path}")

    h, w = img.shape[:2]

    sensitive_words = load_sensitive_words()
    reader = easyocr.Reader(lang, gpu=use_gpu)
    results = reader.readtext(img)

    for (bbox, text, prob) in results:
        spans = get_sensitive_spans(text, sensitive_words)
        if not spans:
            continue
        x1, y1, x2, y2 = clamp_bbox(bbox, h, w)
        L = len(text.strip())
        if L <= 0:
            continue
        # 只对命中区间按字符比例在 bbox 内打码
        for (s, e) in spans:
            xs = x1 + int((x2 - x1) * s / L)
            xe = x1 + int((x2 - x1) * e / L)
            if xe <= xs:
                xe = xs + 1
            mask_region(img, xs, y1, xe, y2, method=method)

    if output_path is None:
        base, ext = os.path.splitext(image_path)
        output_path = f"{base}{ext}"

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    # cv2.imwrite(output_path, img)
    ext = os.path.splitext(output_path)[1].lower()
    _, buf = cv2.imencode(ext if ext else ".png", img)
    with open(output_path, "wb") as f:
        f.write(buf.tobytes())
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="对图片中的敏感文字进行脱敏（OCR 识别后模糊/遮盖）。"
    )
    parser.add_argument("image_path", help="输入图片路径或目录")
    parser.add_argument("-o", "--output", default=None, help="输出路径（目录或文件）")
    parser.add_argument(
        "--method",
        choices=["blur", "block"],
        default="block",
        help="脱敏方式：blur 模糊 / block 黑块",
    )
    parser.add_argument("--gpu", action="store_true", help="使用 GPU 做 OCR")

    args = parser.parse_args()
    path = args.image_path

    if os.path.isfile(path):
        out = process_image(
            path,
            output_path=args.output,
            method=args.method,
            use_gpu=args.gpu,
        )
        print(f"脱敏完成：{out}")
    elif os.path.isdir(path):
        out_dir = args.output or os.path.join(path, "脱敏结果")
        os.makedirs(out_dir, exist_ok=True)
        exts = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
        for name in os.listdir(path):
            if name.lower().endswith(exts):
                fp = os.path.join(path, name)
                name_no_ext, ext = os.path.splitext(name)
                out_path = os.path.join(out_dir, f"{name_no_ext}{ext}")
                process_image(fp, output_path=out_path, method=args.method, use_gpu=args.gpu)
                print(f"已处理：{name} -> {out_path}")
        print(f"目录处理完成，输出目录：{out_dir}")
    else:
        print(f"路径不存在：{path}")
        return 1
    return 0


if __name__ == "__main__":
    exit(main())