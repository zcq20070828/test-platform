/** Material Symbols icon names for agents (UI). */
const DEFAULT_AGENT_ICON = 'smart_toy'

export const AGENT_ICON_MAP: Record<string, string> = {
  'test-master': 'workspace_premium',
  'test-requirement-analyzer': 'search',
  'test-scheme-generator': 'assignment',
  'test-case-generator': 'checklist',
  'test-data-generator': 'analytics',
  'api-executor': 'cable',
  'ui-e2e-executor': 'desktop_windows',
  'knowledge-manager': 'menu_book',
  'requirement-optimizer': 'auto_awesome',
  'scheme-optimizer': 'track_changes',
  'case-optimizer': 'diamond',
  'data-optimizer': 'lightbulb',
  'executor-optimizer': 'bolt',
  'performance-analyzer': 'monitoring',
  'test-reporter': 'analytics',
  'defect-analyzer': 'bug_report',
  'data-masking': 'privacy_tip',
  'ai-quality-reviewer-1': 'smart_toy',
  'ai-quality-reviewer-2': 'smart_toy',
  'ai-quality-reviewer-3': 'smart_toy',
  'compatibility-coordinator': 'devices',
  'ai-evaluation-agent': 'query_stats',
  default: DEFAULT_AGENT_ICON,
}

export function getAgentIcon(agentId: string | undefined | null): string {
  if (!agentId) return DEFAULT_AGENT_ICON
  return AGENT_ICON_MAP[agentId] ?? DEFAULT_AGENT_ICON
}

/** If backend still sends emoji, normalize to Material Symbol by id. */
export function normalizeAgentIcon(agent: { id?: string; icon?: string } | null | undefined): string {
  if (!agent) return DEFAULT_AGENT_ICON
  const icon = agent.icon || ''
  // Material symbol names are snake_case ascii; emoji / CJK are not.
  if (icon && /^[a-z0-9_]+$/i.test(icon)) return icon
  return getAgentIcon(agent.id)
}
