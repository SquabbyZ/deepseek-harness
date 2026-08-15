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

/** Field carrying the global background image (raw URL or data URL). */
export const BACKGROUND_FIELD = 'background'

/** Field carrying the local upload's file name (empty for URL backgrounds). */
export const BACKGROUND_NAME_FIELD = 'backgroundName'

/** Field carrying the background crop region as fractions (null = full image). */
export const BACKGROUND_CROP_FIELD = 'backgroundCrop'

/**
 * Fractional sub-region of the background image, top-left origin, each value
 * in [0, 1]. `null` means "no crop" — the layer falls back to cover/center.
 */
export interface BackgroundCrop {
  x: number
  y: number
  w: number
  h: number
}

/** A finite fraction inside the documented [0, 1] range. */
function isUnitFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/**
 * Shape check for a crop region crossing the settings or registry boundary:
 * every field is a finite fraction in [0, 1], and width/height are positive
 * (a zero-area box is not a crop).
 */
export function isBackgroundCrop(value: unknown): value is BackgroundCrop {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, w, h } = value as Record<string, unknown>
  return isUnitFraction(x) && isUnitFraction(y) && isUnitFraction(w) && isUnitFraction(h)
    && w > 0 && h > 0
}

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Selected skin layer (surfaces only; orthogonal to the preference). */
  skin: SkinId
  /** Global background image (raw URL or data URL; empty = none). */
  background: string
  /** Local upload's file name (empty when the background is a remote URL). */
  backgroundName: string
  /** Crop region as fractions (null = full-image cover). */
  backgroundCrop: BackgroundCrop | null
}

/**
 * Per-axis fraction schema; plain numbers, no step — drags produce long floats.
 * Each fraction is bounded to [0, 1] and width/height must be positive, so a
 * zero-area or out-of-range box is rejected at the settings boundary instead
 * of only being clamped at render.
 */
const BackgroundCropSchema: z<BackgroundCrop> = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(Number.MIN_VALUE).max(1),
  h: z.number().min(Number.MIN_VALUE).max(1),
})

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [SKIN_FIELD]: z.union([...SKIN_IDS]).default(DEFAULT_SKIN),
  [BACKGROUND_FIELD]: z.string().default(''),
  [BACKGROUND_NAME_FIELD]: z.string().default(''),
  [BACKGROUND_CROP_FIELD]: z.union([BackgroundCropSchema, z.const(null)]).default(null),
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
