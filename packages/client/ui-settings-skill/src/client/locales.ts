/** Copy dictionaries for the skill inventory Settings section. */

export const zh = {
  nav: '技能管理',
  tab: '技能列表',
  loading: '正在读取技能…',
  error: '暂时无法读取技能。',
  retry: '重试',
  search: '搜索技能',
  catalog: '技能列表',
  empty: '暂无技能。',
  emptySearch: '没有匹配的技能。',
  toggleError: '切换 {{name}} 失败：{{reason}}',
  switchLabel: '启用 {{name}}',
  sourceProjectDsh: '项目 (DSH)',
  sourceProjectAgents: '项目 (agents)',
  sourceRuntime: '运行时',
  sourceUserDsh: '用户 (DSH)',
  sourceUserAgents: '用户 (agents)',
  sourceCustom: '自定义',
  sourceBundled: '内置',
  sourceUnknown: '未知',
} satisfies Record<string, string>

export const en = {
  nav: 'Skill Management',
  tab: 'Skills',
  loading: 'Reading skills…',
  error: 'Skills are temporarily unavailable.',
  retry: 'Retry',
  search: 'Search skills',
  catalog: 'Skills',
  empty: 'No skills are available.',
  emptySearch: 'No matching skills.',
  toggleError: 'Failed to toggle {{name}}: {{reason}}',
  switchLabel: 'Enable {{name}}',
  sourceProjectDsh: 'Project (DSH)',
  sourceProjectAgents: 'Project (agents)',
  sourceRuntime: 'Runtime',
  sourceUserDsh: 'User (DSH)',
  sourceUserAgents: 'User (agents)',
  sourceCustom: 'Custom',
  sourceBundled: 'Bundled',
  sourceUnknown: 'Unknown',
} satisfies Record<string, string>

export type SkillInventoryLocaleKey = keyof typeof zh
