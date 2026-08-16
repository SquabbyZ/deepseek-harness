/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @returns the Full access product label or the conventional display name.
 */
export function displayPermissionPreset(value: string, name: string): string {
  return value === FULL_ACCESS_PRESET ? 'Full access' : displayPresetName(name)
}

/** Built-in preset ids with a localized product label; custom presets fall back. */
const LOCALIZED_PRESET_KEYS: ReadonlySet<string> = new Set([
  'preset.read-only',
  'preset.workspace-write',
  'preset.danger-full-access',
])

/**
 * Localize a permission preset label, falling back to the host label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @param t - locale seat owning the `preset.*` keys.
 * @returns the localized product label or the conventional display name.
 */
export function localizedPermissionPreset(value: string, name: string, t: (key: string) => string): string {
  const key = `preset.${value}`
  return LOCALIZED_PRESET_KEYS.has(key) ? t(key) : displayPresetName(name)
}
