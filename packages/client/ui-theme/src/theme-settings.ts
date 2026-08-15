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

/** Shape check for a crop region crossing the settings or registry boundary. */
export function isBackgroundCrop(value: unknown): value is BackgroundCrop {
  if (typeof value !== 'object' || value === null) return false
  const crop = value as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every(key =>
    typeof crop[key] === 'number' && Number.isFinite(crop[key]))
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

/** Per-axis fraction schema; plain numbers, no step — drags produce long floats. */
const BackgroundCropSchema: z<BackgroundCrop> = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [SKIN_FIELD]: z.union([...SKIN_IDS]).default(DEFAULT_SKIN),
  [BACKGROUND_FIELD]: z.string().default(''),
  [BACKGROUND_NAME_FIELD]: z.string().default(''),
  [BACKGROUND_CROP_FIELD]: z.union([BackgroundCropSchema, z.const(null)]).default(null),
})

/** Clamp one crop fraction into [0, 1]; non-finite input collapses to 0. */
function clampFraction(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Format a fraction for a `calc()` string, rounding long drag floats. */
function fraction(n: number): string {
  return String(Math.round(n * 1e6) / 1e6)
}

/**
 * Translate a fractional crop region into the `background-size` and
 * `background-position` pair that shows only that sub-rect scaled to fill the
 * layer ("crop then cover"): size scales each axis by `1 / w` / `1 / h`, and
 * position aligns the crop's top-left corner with the layer's (a positive
 * percentage shifts the enlarged image left/up by the crop offset). A null or
 * zero-area crop returns the default `cover`/`center`.
 * @param crop - fractions (top-left origin); null/undefined = full image.
 * @returns the `background-size` and `background-position` values.
 */
export function cropToBackground(crop: BackgroundCrop | null | undefined): { size: string; position: string } {
  if (crop === null || crop === undefined) return { size: 'cover', position: 'center' }
  const x = clampFraction(crop.x)
  const y = clampFraction(crop.y)
  const w = clampFraction(crop.w)
  const h = clampFraction(crop.h)
  if (w <= 0 || h <= 0) return { size: 'cover', position: 'center' }
  const size = `calc(100% / ${fraction(w)}) calc(100% / ${fraction(h)})`
  const positionX = w >= 1 ? '0%' : `calc(${fraction(x)} / ${fraction(1 - w)} * 100%)`
  const positionY = h >= 1 ? '0%' : `calc(${fraction(y)} / ${fraction(1 - h)} * 100%)`
  return { size, position: `${positionX} ${positionY}` }
}

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
