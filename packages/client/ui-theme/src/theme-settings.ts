/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Built-in skin ids accepted at the settings boundary. */
export const SKIN_IDS = ['default', 'glass', 'cyber'] as const

/** Skin id selecting the alias-token skin layer (orthogonal to preference). */
export type SkinId = typeof SKIN_IDS[number]

/** Field carrying the selected skin id. */
export const SKIN_FIELD = 'skin'

/** Default skin when the user-settings document has no override. */
export const DEFAULT_SKIN: SkinId = 'default'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Selected skin layer (surfaces only; orthogonal to the preference). */
  skin: SkinId
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [SKIN_FIELD]: z.union([...SKIN_IDS]).default(DEFAULT_SKIN),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Narrow one wire or registry value to a persistable skin id.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in skin id.
 */
export function isSkinId(value: unknown): value is SkinId {
  return SKIN_IDS.some(skin => skin === value)
}
