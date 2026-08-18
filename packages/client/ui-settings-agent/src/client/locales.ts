/** Copy dictionaries for the agent inventory Settings section. */

export const zh = {
  tab: '代理预设',
  loading: '正在读取代理预设…',
  error: '暂时无法读取代理预设。',
  retry: '重试',
  search: '搜索预设',
  catalog: '代理预设',
  empty: '暂无代理预设。',
  emptySearch: '没有匹配的预设。',
  toggleError: '切换 {{name}} 失败：{{reason}}',
  switchLabel: '启用 {{name}}',
  defaultBadge: '默认',
  sourceSystem: '系统',
  sourceUser: '用户',
  sourceProject: '项目',
  sourceUnknown: '未知',
} satisfies Record<string, string>

export const en = {
  tab: 'Agent presets',
  loading: 'Reading agent presets…',
  error: 'Agent presets are temporarily unavailable.',
  retry: 'Retry',
  search: 'Search presets',
  catalog: 'Agent presets',
  empty: 'No agent presets are available.',
  emptySearch: 'No matching presets.',
  toggleError: 'Failed to toggle {{name}}: {{reason}}',
  switchLabel: 'Enable {{name}}',
  defaultBadge: 'Default',
  sourceSystem: 'System',
  sourceUser: 'User',
  sourceProject: 'Project',
  sourceUnknown: 'Unknown',
} satisfies Record<string, string>

export type AgentInventoryLocaleKey = keyof typeof zh
