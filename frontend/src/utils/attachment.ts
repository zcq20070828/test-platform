/**
 * 附件收集工具（2026-11-05）
 *
 * 背景：原先各面板各自实现 readAttachmentContent()，在浏览器里解析文档
 * （Word 走 /api/parse/word、Excel/PDF 走 /api/parse，文本用 atob 解码），
 * 导致：同一文件在不同面板解析结果不一致、Excel/PDF 在部分面板直接丢失、
 * 截断逻辑重复三份。
 *
 * 现在统一为：**前端只负责读取 base64，解析全部交给后端**
 * （backend/lib/document-reader.js），后端按 Markdown 保留表格结构，
 * 并按 token 预算做结构感知裁剪。
 */

import type { AttachmentFile } from '@/types'

/** 发送给后端的附件载荷 */
export interface AttachmentPayload {
  name: string
  /** 原始内容，base64（不含 data: 前缀） */
  base64?: string
  /** 兼容：知识库引用 */
  kbType?: string
  filename?: string
  /** 兼容：旧客户端已解析好的文本 */
  content?: string
}

/** 单文件上限：与后端 multer MAX_UPLOAD_SIZE 保持一致（50MB） */
export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024

/** 从 dataUrl 中取出纯 base64（去掉 `data:xxx;base64,` 前缀） */
export function stripDataUrl(dataUrl: string): string {
  if (!dataUrl) return ''
  const idx = dataUrl.indexOf(',')
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1)
}

/** 校验并提示 */
export function checkAttachmentSize(file: { name: string; size: number }): boolean {
  if (file.size > MAX_ATTACHMENT_SIZE) {
    console.warn(`[attachment] ${file.name} 超过 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB，已跳过`)
    return false
  }
  return true
}

/**
 * 把 AttachmentFile[] 转成后端可直接解析的载荷
 *
 * - 有 dataUrl 的文件 → `{ name, base64 }`，后端统一解析
 * - 只有 path 的文件 → `{ name, content: '[附件: ...]' }` 占位（无法读取内容时如实标注）
 */
export function toAttachmentPayloads(files: AttachmentFile[] | undefined | null): AttachmentPayload[] {
  if (!files || files.length === 0) return []
  const out: AttachmentPayload[] = []
  for (const f of files) {
    if (!checkAttachmentSize(f)) continue
    if (f.dataUrl) {
      const base64 = stripDataUrl(f.dataUrl)
      if (!base64) continue
      out.push({ name: f.name, base64 })
      continue
    }
    if (f.path) {
      out.push({ name: f.name, content: `[附件: ${f.name} (${(f.size / 1024).toFixed(1)}KB)]` })
      continue
    }
    out.push({ name: f.name, content: `[附件: ${f.name} (${(f.size / 1024).toFixed(1)}KB) - 未提供内容]` })
  }
  return out
}

/**
 * 仅用于界面显示：附件摘要（不含正文，避免把大段内容塞进聊天气泡）
 */
export function describeAttachments(files: AttachmentFile[] | undefined | null): string {
  if (!files || files.length === 0) return ''
  return files
    .map((f) => `[附件: ${f.name} (${(f.size / 1024).toFixed(1)}KB)]`)
    .join('\n')
}

/**
 * 读取本地 File 为 AttachmentFile（base64 dataUrl）
 */
export function readFileAsAttachment(file: File): Promise<AttachmentFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        name: file.name,
        size: file.size,
        type: file.type || '',
        dataUrl: String(reader.result || ''),
      })
    }
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`))
    reader.readAsDataURL(file)
  })
}
