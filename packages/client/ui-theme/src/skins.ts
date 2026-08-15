/**
 * Skin presets: `--dsw-alias-*` surface-override layers selected by `data-skin`.
 * Each value is a `{ light, dark }` pair so `composeActive` picks the right one
 * for the active color scheme. Skins touch surfaces only — the base, raised,
 * and overlay backgrounds, the l1/l2 borders, and the sidebar fill — leaving
 * brand (`--dsw-alias-brand-*`), label/foreground, and state
 * (`--dsw-alias-state-*`) tokens consistent across skins. Colors come from the
 * existing `--dsw-static-*` scale (or rgba() tints of it); no new palette
 * colors are introduced.
 */
import type { SkinId } from './theme-settings.ts'
import type { ThemeTokenOverrides } from './client/index.ts'

/**
 * Skin → alias-token override layer. `default` is empty (the shipped base
 * palettes, zero visual change); `glass` and `cyber` override the surface
 * tokens only.
 */
export const SKIN_PRESETS: Record<SkinId, ThemeTokenOverrides> = {
  default: {},
  glass: {
    '--dsw-alias-bg-base': { light: 'rgba(255, 255, 255, 0.55)', dark: 'rgba(30, 32, 38, 0.55)' },
    '--dsw-alias-bg-layer-1': { light: 'rgba(255, 255, 255, 0.7)', dark: 'rgba(40, 42, 48, 0.7)' },
    '--dsw-alias-bg-layer-2': { light: 'rgba(255, 255, 255, 0.85)', dark: 'rgba(50, 52, 58, 0.85)' },
    '--dsw-alias-bg-overlay': { light: 'rgba(255, 255, 255, 0.9)', dark: 'rgba(35, 37, 43, 0.9)' },
    '--dsw-alias-border-l1': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.1)' },
    '--dsw-alias-border-l2': { light: 'rgba(0, 0, 0, 0.14)', dark: 'rgba(255, 255, 255, 0.2)' },
    '--dsw-specific-sidebar-fill': { light: 'rgba(255, 255, 255, 0.4)', dark: 'rgba(30, 32, 38, 0.4)' },
  },
  cyber: {
    '--dsw-alias-bg-base': { light: 'var(--dsw-static-blue-50)', dark: 'var(--dsw-static-neutral-900)' },
    '--dsw-alias-bg-layer-1': { light: 'var(--dsw-static-deepseek-50)', dark: 'var(--dsw-static-neutral-850)' },
    '--dsw-alias-bg-layer-2': { light: 'var(--dsw-static-deepseek-100)', dark: 'var(--dsw-static-neutral-800)' },
    '--dsw-alias-bg-overlay': { light: 'var(--dsw-static-blue-50)', dark: 'var(--dsw-static-neutral-850)' },
    '--dsw-alias-border-l1': { light: 'var(--dsw-static-deepseek-200)', dark: 'var(--dsw-static-deepseek-800)' },
    '--dsw-alias-border-l2': { light: 'var(--dsw-static-deepseek-400)', dark: 'var(--dsw-static-deepseek-400)' },
    '--dsw-specific-sidebar-fill': { light: 'var(--dsw-static-deepseek-100)', dark: 'var(--dsw-static-deepseek-900)' },
  },
}
