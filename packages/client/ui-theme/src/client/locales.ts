/** `settings.theme` namespace dictionaries (the Theme row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'theme.title': '主题',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'theme.system': '跟随系统',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'theme.title': 'Theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',
} satisfies Record<ThemeKey, string>
