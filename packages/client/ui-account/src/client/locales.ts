export type AccountKey = 'nav' | 'signedIn' | 'login' | 'logout' | 'waiting' | 'error' | 'timeout'

export const zh: Record<AccountKey, string> = {
  nav: '账户',
  signedIn: '已登录为 {name}',
  login: '登录 GitHub',
  logout: '退出登录',
  waiting: '请在浏览器中完成授权…',
  error: '操作失败，请重试',
  timeout: '授权超时，请重试',
}

export const en: Record<AccountKey, string> = {
  nav: 'Account',
  signedIn: 'Signed in as {name}',
  login: 'Sign in with GitHub',
  logout: 'Sign out',
  waiting: 'Waiting for authorization in your browser…',
  error: 'Something went wrong. Please try again.',
  timeout: 'Authorization timed out. Please try again.',
}
