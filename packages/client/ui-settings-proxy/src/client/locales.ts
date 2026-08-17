/** Copy dictionaries for the outbound-proxy settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Proxy',
  title: 'Outbound proxy',
  intro: 'Route outbound requests — LLM calls, web search, downloads — through an HTTP proxy.',
  urlLabel: 'Proxy URL',
  urlPlaceholder: 'http://127.0.0.1:7890',
  test: 'Test',
  testing: 'Testing…',
  clear: 'Clear',
  save: 'Save',
  testOk: 'Connected',
  testFailed: 'Test failed',
  saveOk: 'Proxy saved',
  clearOk: 'Proxy cleared',
} as const

/** The settings.proxy namespace key union. */
export type ProxyKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in keyof typeof en]: string } = {
  nav: '代理',
  title: '出站代理',
  intro: '让对外请求（LLM 调用、网络搜索、下载）走 HTTP 代理。',
  urlLabel: '代理地址',
  urlPlaceholder: 'http://127.0.0.1:7890',
  test: '测试',
  testing: '测试中…',
  clear: '清除',
  save: '保存',
  testOk: '连接成功',
  testFailed: '测试失败',
  saveOk: '代理已保存',
  clearOk: '代理已清除',
}
