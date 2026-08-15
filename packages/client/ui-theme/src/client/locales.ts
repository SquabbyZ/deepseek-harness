/** `settings.theme` namespace dictionaries (the Theme row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'theme.title': '主题',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'theme.system': '跟随系统',
  'skin.title': '皮肤',
  'skin.default': '默认',
  'skin.glass': '玻璃',
  'skin.cyber': '赛博',
  'background.title': '背景图',
  'background.upload': '上传图片',
  'background.url': '图片 URL',
  'background.urlPlaceholder': 'https://example.com/image.png',
  'background.clear': '清除',
  'background.fileName': '文件名',
  'background.cropLabel': '拖拽框选区域',
  'background.clearCrop': '清除裁剪',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'theme.title': 'Theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',
  'skin.title': 'Skin',
  'skin.default': 'Default',
  'skin.glass': 'Glass',
  'skin.cyber': 'Cyber',
  'background.title': 'Background image',
  'background.upload': 'Upload image',
  'background.url': 'Image URL',
  'background.urlPlaceholder': 'https://example.com/image.png',
  'background.clear': 'Clear',
  'background.fileName': 'File name',
  'background.cropLabel': 'Drag to crop region',
  'background.clearCrop': 'Clear crop',
} satisfies Record<ThemeKey, string>
