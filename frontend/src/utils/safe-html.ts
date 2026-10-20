// 安全渲染工具（2026-10-19 安全整改）
// 背景：AI 输出、知识库正文、交付物内容都来自不可信来源，此前直接 v-html 渲染，
// 任意 `<img onerror>` / `<script>` 都能执行并读取 localStorage 里的 token。
//
// 约定：所有进入 v-html 的 HTML 必须先过 sanitizeHtml()。
// marked 实例按组件局部创建，避免多个组件用 marked.use() 互相覆盖 renderer。

import DOMPurify from 'dompurify'
import { Marked } from 'marked'

/** 白名单清洗：保留排版与代码高亮需要的标签/属性，去掉脚本、事件、iframe 等 */
export function sanitizeHtml(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'class'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'srcdoc', 'style'],
  })
}

/** HTML 转义（用于纯文本片段，如高亮、错误信息） */
export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 正则元字符转义（用户输入做高亮时必须先转义，避免 ReDoS / 语法错误） */
export function escapeRegExp(text: string): string {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 创建一个带代码块「复制」按钮的局部 Marked 实例。
 * 注意：不在渲染结果里塞内联 onclick（CSP 会拦，也是注入面），
 * 复制交互改由组件用事件委托处理（见 .code-block-copy 的 click 监听）。
 */
export function createMarked(): Marked {
  return new Marked({
    breaks: true,
    gfm: true,
  })
}

/**
 * Markdown → 清洗后的 HTML。
 * @param markedInstance 组件级局部 Marked 实例（可选，不传则用全局默认）
 * @param options.codeRenderer 代码块渲染器
 */
export function renderMarkdownSafe(
  text: string,
  markedInstance?: Marked,
  options?: {
    codeRenderer?: (token: { text: string; lang?: string }) => string
  }
): string {
  if (!text) return ''
  try {
    const parser = markedInstance ?? new Marked({ breaks: true, gfm: true })
    if (options?.codeRenderer) {
      parser.use({
        renderer: {
          code({ text: code, lang }: { text: string; lang?: string }) {
            return options.codeRenderer!({ text: code, lang })
          },
        },
      })
    }
    return sanitizeHtml(parser.parse(text) as string)
  } catch {
    return sanitizeHtml(`<p>${escapeHtml(text)}</p>`)
  }
}

/**
 * 知识库/搜索结果高亮：先对正文转义，再做关键词标记。
 * 关键词按字面量处理（escapeRegExp），不会触发正则注入或灾难性回溯。
 */
export function highlightSafe(text: string, keyword: string, maxLength = 200): string {
  const source = String(text ?? '').slice(0, maxLength)
  const escaped = escapeHtml(source)
  const kw = String(keyword ?? '').trim()
  if (!kw) return escaped
  try {
    const re = new RegExp(`(${escapeRegExp(escapeHtml(kw))})`, 'gi')
    return escaped.replace(re, '<mark>$1</mark>')
  } catch {
    return escaped
  }
}
