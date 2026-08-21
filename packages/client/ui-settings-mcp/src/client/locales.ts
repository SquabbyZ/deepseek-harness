/** Copy dictionaries for the MCP server inventory Settings section. */

export const zh = {
  nav: 'MCP 管理',
  tab: 'MCP 服务',
  loading: '正在读取 MCP 服务…',
  error: '暂时无法读取 MCP 服务。',
  retry: '重试',
  search: '搜索服务',
  catalog: 'MCP 服务',
  empty: '暂无 MCP 服务。',
  emptySearch: '没有匹配的服务。',
  toggleError: '切换 {{name}} 失败：{{reason}}',
  switchLabel: '启用 {{name}}',
  transportStdio: 'stdio',
  transportStreamableHttp: 'streamable-http',
  transportUnknown: '未知',
} satisfies Record<string, string>

export const en = {
  nav: 'MCP Management',
  tab: 'MCP servers',
  loading: 'Reading MCP servers…',
  error: 'MCP servers are temporarily unavailable.',
  retry: 'Retry',
  search: 'Search servers',
  catalog: 'MCP servers',
  empty: 'No MCP servers are available.',
  emptySearch: 'No matching servers.',
  toggleError: 'Failed to toggle {{name}}: {{reason}}',
  switchLabel: 'Enable {{name}}',
  transportStdio: 'stdio',
  transportStreamableHttp: 'streamable-http',
  transportUnknown: 'unknown',
} satisfies Record<string, string>

export type McpInventoryLocaleKey = keyof typeof zh
