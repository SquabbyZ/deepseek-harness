/** Copy dictionaries for the Usage statistics settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Usage',
  title: 'Usage statistics',
  intro: 'Token consumption and cache efficiency across your sessions.',
  statConsumption: 'Consumption',
  statRequests: 'Requests',
  statInput: 'Input',
  statOutput: 'Output',
  statCacheRead: 'Cache read',
  statCacheHitRate: 'Cache-hit rate',
  rangeLabel: 'Range',
  rangeToday: 'Today',
  range7d: '7 days',
  range30d: '30 days',
  rangeAll: 'All',
  intervalLabel: 'Refresh',
  interval5s: '5s',
  interval10s: '10s',
  interval30s: '30s',
  interval60s: '60s',
  providerModelLabel: 'Provider & model',
  providerModelAll: 'All',
  refreshButton: 'Refresh now',
  seriesTokens: 'Tokens',
  empty: 'No usage recorded in this window yet.',
  loadFailed: 'Loading usage statistics failed',
  retry: 'Retry',
}

/** The settings.usage namespace key union. */
export type UsageKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in keyof typeof en]: string } = {
  nav: '使用统计',
  title: '使用统计',
  intro: '各会话的 token 消耗与缓存命中情况。',
  statConsumption: '真实消耗',
  statRequests: '总请求次数',
  statInput: '新增输入',
  statOutput: '输出',
  statCacheRead: '命中',
  statCacheHitRate: '命中缓存率',
  rangeLabel: '时间范围',
  rangeToday: '今天',
  range7d: '近 7 天',
  range30d: '近 30 天',
  rangeAll: '全部',
  intervalLabel: '刷新频率',
  interval5s: '5 秒',
  interval10s: '10 秒',
  interval30s: '30 秒',
  interval60s: '60 秒',
  providerModelLabel: '厂商与模型',
  providerModelAll: '全部',
  refreshButton: '刷新',
  seriesTokens: 'Token',
  empty: '该时间范围内暂无使用记录。',
  loadFailed: '加载使用统计失败',
  retry: '重试',
}
