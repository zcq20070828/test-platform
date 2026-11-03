/** Material Symbols for executor stage / platform option tags (dropdown right side). */
const STAGE_ICONS = [
  'looks_one',
  'looks_two',
  'looks_3',
  'looks_4',
  'looks_5',
  'looks_6',
  'filter_7',
  'filter_8',
  'filter_9',
] as const

export function stageMsIcon(stageIdx: number | undefined | null): string {
  if (stageIdx == null || stageIdx < 0) return 'account_tree'
  if (stageIdx < STAGE_ICONS.length) return STAGE_ICONS[stageIdx]
  return 'filter_9_plus'
}

export function workflowMsIcon(): string {
  return 'account_tree'
}

/** Compat / script executor non-stage tags */
export function scopeMsIcon(label: string, isFull = false): string {
  if (isFull) return 'hub'
  const key = (label || '').toLowerCase()
  if (key.includes('android')) return 'android'
  if (key.includes('ios') || key.includes('iphone')) return 'phone_iphone'
  if (key.includes('harmony') || key.includes('鸿蒙')) return 'smartphone'
  if (key.includes('windows')) return 'window'
  if (key.includes('mac')) return 'laptop_mac'
  if (key.includes('web') || key.includes('浏览器')) return 'language'
  if (key.includes('api') || key.includes('接口')) return 'api'
  if (key.includes('ui') || key.includes('e2e')) return 'web_asset'
  if (key.includes('完整')) return 'hub'
  return 'sell'
}
