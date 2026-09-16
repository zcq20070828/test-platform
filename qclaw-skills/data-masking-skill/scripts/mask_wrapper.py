#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据脱敏统一入口
用法: python3 mask_wrapper.py <command> <input_path> [options]

命令:
  docx <input> [--output <output>]     - 脱敏 Word 文档
  image <input> [--output <output>] [--method blur|block] [-gpu] - 脱敏图片
  batch <input_dir> [--output <output_dir>] [--method blur|block] [-gpu] - 批量处理
"""

import sys
import os
import json
import argparse

# 添加脚本目录到路径
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

def mask_docx(input_path, output_path=None):
    """脱敏 Word 文档"""
    from docx_masker import mask_docx as _mask_docx
    
    if not os.path.isfile(input_path):
        return {"success": False, "error": f"文件不存在：{input_path}"}
    
    try:
        result_path = _mask_docx(input_path)
        return {
            "success": True,
            "input": input_path,
            "output": result_path,
            "type": "docx"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def mask_image(input_path, output_path=None, method="blur", use_gpu=False):
    """脱敏图片"""
    from image_masker import process_image as _mask_image
    
    if not os.path.isfile(input_path):
        return {"success": False, "error": f"文件不存在：{input_path}"}
    
    try:
        result_path = _mask_image(
            input_path,
            output_path=output_path,
            method=method,
            use_gpu=use_gpu
        )
        return {
            "success": True,
            "input": input_path,
            "output": result_path,
            "type": "image",
            "method": method
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def batch_process(input_dir, output_dir=None, method="blur", use_gpu=False):
    """批量处理目录中的文件"""
    from docx_masker import mask_docx as _mask_docx
    from image_masker import process_image as _mask_image
    
    if not os.path.isdir(input_dir):
        return {"success": False, "error": f"目录不存在：{input_dir}"}
    
    results = []
    output_dir = output_dir or os.path.join(input_dir, "脱敏结果")
    os.makedirs(output_dir, exist_ok=True)
    
    # 支持的文件类型
    docx_exts = ('.docx', '.doc')
    image_exts = ('.jpg', '.jpeg', '.png', '.bmp', '.webp')
    
    for filename in os.listdir(input_dir):
        filepath = os.path.join(input_dir, filename)
        if not os.path.isfile(filepath):
            continue
        
        ext = os.path.splitext(filename)[1].lower()
        base_name = os.path.splitext(filename)[0]
        
        if ext in docx_exts:
            output_path = os.path.join(output_dir, f"{base_name}_脱敏{ext}")
            try:
                result = _mask_docx(filepath)
                results.append({
                    "file": filename,
                    "success": True,
                    "output": result
                })
            except Exception as e:
                results.append({
                    "file": filename,
                    "success": False,
                    "error": str(e)
                })
        
        elif ext in image_exts:
            output_path = os.path.join(output_dir, f"{base_name}{ext}")
            try:
                result = _mask_image(
                    filepath,
                    output_path=output_path,
                    method=method,
                    use_gpu=use_gpu
                )
                results.append({
                    "file": filename,
                    "success": True,
                    "output": result
                })
            except Exception as e:
                results.append({
                    "file": filename,
                    "success": False,
                    "error": str(e)
                })
    
    return {
        "success": True,
        "type": "batch",
        "input_dir": input_dir,
        "output_dir": output_dir,
        "total": len(results),
        "succeeded": sum(1 for r in results if r["success"]),
        "failed": sum(1 for r in results if not r["success"]),
        "results": results
    }


def main():
    # 解析 JSON 输入（从 stdin）
    if not sys.stdin.isatty():
        try:
            input_data = json.load(sys.stdin)
            command = input_data.get("command")
            input_path = input_data.get("input")
            output_path = input_data.get("output")
            method = input_data.get("method", "blur")
            use_gpu = input_data.get("gpu", False)
        except json.JSONDecodeError:
            print(json.dumps({"success": False, "error": "无效的 JSON 输入"}))
            sys.exit(1)
    else:
        # 命令行参数模式
        parser = argparse.ArgumentParser(description="数据脱敏工具")
        parser.add_argument("command", choices=["docx", "image", "batch"], help="处理命令")
        parser.add_argument("input", help="输入文件或目录路径")
        parser.add_argument("-o", "--output", help="输出路径")
        parser.add_argument("--method", choices=["blur", "block"], default="blur", help="脱敏方式")
        parser.add_argument("--gpu", action="store_true", help="使用 GPU")
        args = parser.parse_args()
        
        command = args.command
        input_path = args.input
        output_path = args.output
        method = args.method
        use_gpu = args.gpu
    
    if not input_path:
        print(json.dumps({"success": False, "error": "缺少输入路径"}))
        sys.exit(1)
    
    # 执行脱敏
    if command == "docx":
        result = mask_docx(input_path, output_path)
    elif command == "image":
        result = mask_image(input_path, output_path, method, use_gpu)
    elif command == "batch":
        result = batch_process(input_path, output_dir=output_path, method=method, use_gpu=use_gpu)
    else:
        result = {"success": False, "error": f"未知命令：{command}"}
    
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
