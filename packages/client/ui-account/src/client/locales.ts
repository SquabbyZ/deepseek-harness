export type AccountKey = 'nav' | 'signedIn' | 'login' | 'logout' | 'waiting'

export const zh: Record<AccountKey, string> = {
  nav: '账户',
  signedIn: '已登录为 {name}',
  login: '登录 GitHub',
  logout: '退出登录',
  waiting: '请在浏览器中完成授权…',
}

export const en: Record<AccountKey, string> = {
  nav: 'Account',
  signedIn: 'Signed in as {name}',
  login: 'Sign in with GitHub',
  logout: 'Sign out',
  waiting: 'Waiting for authorization in your browser…',
}
