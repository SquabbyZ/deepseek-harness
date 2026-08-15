/**
 * `account` namespace dictionaries: the sidebar account seat (avatar, login
 * dialog, logout menu). Owned by this package; copy rides the standard locale
 * seat (`locale: 'account'` on the registration).
 */

/** The account namespace key union (the zh dictionary is the source of truth). */
export type AccountKey =
  | 'notSignedIn'
  | 'loginTitle'
  | 'signIn'
  | 'signingIn'
  | 'logout'
  | 'error'
  | 'timeout'
  | 'close'

/** Simplified Chinese dictionary. */
export const zh: Record<AccountKey, string> = {
  notSignedIn: '未登录',
  loginTitle: '登录 GitHub',
  signIn: '一键登录 GitHub',
  signingIn: '登录中…',
  logout: '退出登录',
  error: '操作失败，请重试',
  timeout: '授权超时，请重试',
  close: '关闭',
}

/** English dictionary, checked complete against the zh key set. */
export const en: Record<AccountKey, string> = {
  notSignedIn: 'Not signed in',
  loginTitle: 'Sign in with GitHub',
  signIn: 'Sign in with GitHub',
  signingIn: 'Signing in…',
  logout: 'Sign out',
  error: 'Something went wrong. Please try again.',
  timeout: 'Authorization timed out. Please try again.',
  close: 'Close',
}
