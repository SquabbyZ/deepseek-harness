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
    // Frosted glass wants MORE transparency than the flat tints it replaced:
    // the backdrop-filter in globals.css does the blurring, so the fill just
    // needs to stay thin enough that background content shows through. The
    // l1/l2 hairlines flip to a light (white) tint in BOTH schemes — the
    // classic glass edge — instead of the default dark hairline.
    '--dsw-alias-bg-base': { light: 'rgba(255, 255, 255, 0.3)', dark: 'rgba(15, 17, 21, 0.32)' },
    '--dsw-alias-bg-layer-1': { light: 'rgba(255, 255, 255, 0.58)', dark: 'rgba(21, 21, 23, 0.55)' },
    '--dsw-alias-bg-layer-2': { light: 'rgba(255, 255, 255, 0.74)', dark: 'rgba(27, 27, 28, 0.7)' },
    '--dsw-alias-bg-overlay': { light: 'rgba(255, 255, 255, 0.88)', dark: 'rgba(35, 35, 36, 0.85)' },
    '--dsw-alias-border-l1': { light: 'rgba(255, 255, 255, 0.7)', dark: 'rgba(255, 255, 255, 0.14)' },
    '--dsw-alias-border-l2': { light: 'rgba(255, 255, 255, 0.9)', dark: 'rgba(255, 255, 255, 0.26)' },
    '--dsw-specific-sidebar-fill': { light: 'rgba(255, 255, 255, 0.3)', dark: 'rgba(15, 17, 21, 0.32)' },
  },
  cyber: {
    // Near-black bluish base (neutral-bluish-1000/950/900) with bright-blue
    // neon accents: the l2 hairline and the sidebar edge carry the accent,
    // while the neon glow itself is painted by the box-shadow rules in
    // globals.css keyed on [data-skin="cyber"].
    '--dsw-alias-bg-base': { light: 'var(--dsw-static-blue-50)', dark: 'var(--dsw-static-neutral-bluish-1000)' },
    '--dsw-alias-bg-layer-1': { light: 'var(--dsw-static-blue-75)', dark: 'var(--dsw-static-neutral-bluish-950)' },
    '--dsw-alias-bg-layer-2': { light: 'var(--dsw-static-blue-100)', dark: 'var(--dsw-static-neutral-bluish-900)' },
    '--dsw-alias-bg-overlay': { light: 'var(--dsw-static-blue-50)', dark: 'var(--dsw-static-neutral-bluish-950)' },
    '--dsw-alias-border-l1': { light: 'var(--dsw-static-deepseek-200)', dark: 'var(--dsw-static-blue-800)' },
    '--dsw-alias-border-l2': { light: 'var(--dsw-static-blue-400)', dark: 'var(--dsw-static-blue-400)' },
    '--dsw-specific-sidebar-fill': { light: 'var(--dsw-static-blue-100)', dark: 'var(--dsw-static-neutral-bluish-950)' },
  },
}
