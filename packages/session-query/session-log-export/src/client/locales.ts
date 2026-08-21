/** Locale namespace owned by Session export browser feedback. */
export const NS = 'session-log-download'

/** Simplified-Chinese Session export strings. */
export const zh = {
  'header.label': '导出日志',
  'dialog.preparingTitle': '正在导出会话',
  'dialog.preparingDescription': '正在准备包含当前会话、子会话和附件的 ZIP 压缩包。',
  'dialog.successTitle': '会话日志已导出',
  'dialog.successDescription': '浏览器已开始下载会话日志 ZIP 压缩包，可在下载记录中查看。',
  'dialog.errorTitle': '会话日志导出失败',
  'dialog.close': '关闭',
  'dialog.commandFailed': '无法启动会话日志导出。',
} as const

/** English Session export strings. */
export const en: Record<keyof typeof zh, string> = {
  'header.label': 'Session log',
  'dialog.preparingTitle': 'Exporting session',
  'dialog.preparingDescription': 'Preparing a ZIP archive of this session, its sub-sessions, and attachments.',
  'dialog.successTitle': 'Session log exported',
  'dialog.successDescription': 'The browser has started downloading the session log ZIP; check your download list.',
  'dialog.errorTitle': 'Failed to export session log',
  'dialog.close': 'Close',
  'dialog.commandFailed': 'Could not start the session log export.',
}

/** Stable locale keys consumed by the shared modal. */
export type SessionLogDownloadKey = keyof typeof zh
