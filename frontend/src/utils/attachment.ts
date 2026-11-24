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

/**
 * 单文件上限
 *
 * 不能简单取后端的 50MB：前端是把附件转成 base64 随 JSON 一起提交的，
 * base64 体积约为原始文件的 1.34 倍（4/3 再加 JSON 转义）。
 * 若这里允许 50MB，实际请求体约 68MB，会被 Nginx / 后端直接拒绝，
 * 用户看到的只是「请求失败」，根本不知道是文件太大。
 *
 * 反算：后端上限 50MB ÷ 1.36 ≈ 36MB。取整 35MB 留余量。
 * 三个数字必须同口径：nginx client_max_body_size / 后端 express.json limit / 这里的上限。
 */
export const MAX_ATTACHMENT_SIZE = 35 * 1024 * 1024

/** base64 与 JSON 包装带来的体积膨胀系数（用于提示文案与容量估算） */
export const BASE64_INFLATE_RATIO = 1.36

/** 从 dataUrl 中取出纯 base64（去掉 `data:xxx;base64,` 前缀） */
export function stripDataUrl(dataUrl: string): string {
  if (!dataUrl) return ''
  const idx = dataUrl.indexOf(',')
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1)
}

/** 校验并提示 */
export function checkAttachmentSize(file: { name: string; size: number }): boolean {
  if (file.size > MAX_ATTACHMENT_SIZE) {
    // 说清「为什么」而不只是「太大了」：
    // 用户看到 35MB 会觉得莫名其妙，说明 base64 膨胀才能真正理解。
    const mb = (file.size / 1024 / 1024).toFixed(1)
    const inflated = (file.size * BASE64_INFLATE_RATIO / 1024 / 1024).toFixed(1)
    console.warn(
      `[attachment] ${file.name} 大小 ${mb}MB 超过上限 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB，已跳过` +
      `（附件会以 base64 随请求提交，实际体积约 ${inflated}MB，服务端上限 50MB）`
    )
    return false
  }
  return true
}

/**
 * 校验整批附件的总体积
 *
 * 单文件不超限，多个文件叠起来仍可能超。base64 后总量必须留在服务端 50MB 以内。
 *
 * @returns {{ok:boolean, totalBytes:number, inflatedBytes:number, message?:string}}
 */
export function checkTotalAttachmentSize(files: AttachmentFile[] | undefined | null): {
  ok: boolean
  totalBytes: number
  inflatedBytes: number
  message?: string
} {
  const list = Array.isArray(files) ? files : []
  const totalBytes = list.reduce((s, f) => s + (Number(f?.size) || 0), 0)
  const inflatedBytes = Math.round(totalBytes * BASE64_INFLATE_RATIO)
  // 留 4MB 给 task input 与 JSON 结构
  const BUDGET = 46 * 1024 * 1024
  if (inflatedBytes > BUDGET) {
    return {
      ok: false,
      totalBytes,
      inflatedBytes,
      message:
        `附件合计 ${(totalBytes / 1024 / 1024).toFixed(1)}MB，以 base64 提交后约 ` +
        `${(inflatedBytes / 1024 / 1024).toFixed(1)}MB，超出服务端上限。` +
        '请减少附件数量或压缩文档后重试。',
    }
  }
  return { ok: true, totalBytes, inflatedBytes }
}

/**
 * 把 AttachmentFile[] 转成后端可直接解析的载荷
 *
 * - 有 dataUrl 的文件 → `{ name, base64 }`，后端统一解析
 * - 只有 path 的文件 → `{ name, content: '[附件: ...]' }` 占位（无法读取内容时如实标注）
 *
 * 注意：超限文件会被跳过（返回的数组里没有它）。调用方必须用
 * `checkAttachmentSize` / `checkTotalAttachmentSize` 先判断并给用户提示，
 * 否则用户会以为文件传上去了——静默跳过是最糟的结果。
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
