/**
 * 任务失败提示 → 可读文本（2026-11-20）
 *
 * 问题：任务失败时前端只显示「任务执行失败：<技术错误>」，用户不知道
 * 该改什么。实测任务 9184ca57 显示「DeepSeek 账户余额不足（402）」，
 * 真实原因是智谱 429 限流 —— 用户按提示去充值也解决不了。
 *
 * 后端 lib/failure-diagnosis.js 负责分类（category/title/detail/actions/retryable），
 * 这里把它渲染成聊天面板里的一段话。没有诊断信息时退回原始错误，
 * 并明确告诉用户「把这条发给管理员」而不是干巴巴一行报错。
 */

export interface TaskFailureLike {
  category?: string
  title?: string
  detail?: string
  actions?: string[]
  retryable?: boolean
  raw?: string
}

/** 类别 → 图标（用 Material Symbols 名，前端 MsIcon 直接渲染） */
export const FAILURE_ICONS: Record<string, string> = {
  balance: 'account_balance_wallet',
  rate_limit: 'hourglass_top',
  auth: 'key_off',
  model_not_found: 'psi',
  context_overflow: 'unfold_less',
  network: 'wifi_off',
  busy: 'pending',
  tool_not_called: 'build_circle',
  quality_gate: 'rule',
  unknown: 'error',
};

/** 类别 → 中文标签（用于任务列表的小标签） */
export const FAILURE_LABELS: Record<string, string> = {
  balance: '余额不足',
  rate_limit: '限流',
  auth: 'Key 无效',
  model_not_found: '模型名不支持',
  context_overflow: '输入过长',
  network: '网络问题',
  busy: '有任务在跑',
  tool_not_called: '工具未执行',
  quality_gate: '未过质量门禁',
  unknown: '执行失败',
};

export function failureIcon(category?: string): string {
  return FAILURE_ICONS[String(category || 'unknown')] || FAILURE_ICONS['unknown'] || 'error';
}

export function failureLabel(category?: string): string {
  return FAILURE_LABELS[String(category || 'unknown')] || FAILURE_LABELS['unknown'] || '执行失败';
}

/**
 * 渲染失败提示
 *
 * @param failure 后端下发的诊断（可能为空：历史任务没有这个字段）
 * @param rawError 原始错误串
 * @returns 多行文本，直接喂给聊天面板的 markdown 渲染
 */
export function formatFailure(failure: TaskFailureLike | null | undefined, rawError?: string): string {
  const f = failure || null;
  const raw = String((f && f.raw) || rawError || '').trim();

  // 没有诊断信息（历史任务 / 后端老版本）→ 至少把原文说清楚，并给出下一步
  if (!f || !f.title) {
    if (!raw) return '任务执行失败，但没有拿到具体原因。请重新执行一次；若持续失败请联系管理员。';
    return [
      '**任务执行失败**',
      '',
      `原因：${raw.slice(0, 400)}`,
      '',
      '**可以这样做：**',
      '1. 重新执行一次（偶发错误多数能自愈）',
      '2. 若持续失败，把上面这条原因发给管理员排查',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`**${f.title || failureLabel(f.category)}**`);
  if (f.detail) {
    lines.push('');
    lines.push(f.detail);
  }

  const actions = Array.isArray(f.actions) ? f.actions.filter(Boolean) : [];
  if (actions.length) {
    lines.push('');
    lines.push('**可以这样做：**');
    actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  }

  // 可重试的才提示「直接重跑就行」，不可重试的别让用户白试
  if (f.retryable === false) {
    lines.push('');
    lines.push('_这个问题重跑也不会变，先按上面调整后再执行。_');
  }

  // 原始错误放最后：排查用，不占主视觉。
  // 不用 <sub>（清洗白名单没保证保留），改用引用块 —— markdown 原生支持，稳定。
  if (raw && raw !== f.detail) {
    lines.push('');
    lines.push(`> 原始错误（排查用）：${escapeForMarkdown(raw.slice(0, 300))}`);
  }

  return lines.join('\n');
}

/** 极简转义：避免原始错误里的 <> 被当成 HTML 标签吃掉 */
function escapeForMarkdown(text: string): string {
  return String(text).replace(/</g, '‹').replace(/>/g, '›');
}

export default { formatFailure, failureIcon, failureLabel, FAILURE_LABELS, FAILURE_ICONS };
