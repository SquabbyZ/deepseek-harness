/** Copy dictionaries for the plugin inventory Settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '插件列表',
  loading: '正在读取插件…',
  error: '暂时无法读取插件。',
  retry: '重试',
  search: '搜索插件',
  catalog: '插件列表',
  empty: '暂无插件。',
  emptySearch: '没有匹配的插件。',
  toggleError: '切换 {{name}} 失败：{{reason}}',
  switchLabel: '启用 {{name}}',
  reasonPending: '等待依赖',
  reasonLoading: '加载中',
  reasonActive: '已挂载',
  reasonFailed: '挂载失败',
  reasonUnloading: '卸载中',
  reasonUnobserved: '未挂载',
  reasonUserDisabled: '你已停用',
  reasonCordisDisabled: 'cordis.yml 已停用',
} satisfies Record<string, string>

/** Plugin inventory locale key union. */
export type PluginInventoryLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Plugin list',
  loading: 'Reading plugins…',
  error: 'Plugins are temporarily unavailable.',
  retry: 'Retry',
  search: 'Search plugins',
  catalog: 'Plugin list',
  empty: 'No plugins are available.',
  emptySearch: 'No matching plugins.',
  toggleError: 'Failed to toggle {{name}}: {{reason}}',
  switchLabel: 'Enable {{name}}',
  reasonPending: 'Waiting for dependencies',
  reasonLoading: 'Loading',
  reasonActive: 'Mounted',
  reasonFailed: 'Mount failed',
  reasonUnloading: 'Unloading',
  reasonUnobserved: 'Not mounted',
  reasonUserDisabled: 'You disabled this',
  reasonCordisDisabled: 'Disabled in cordis.yml',
} satisfies Record<PluginInventoryLocaleKey, string>
