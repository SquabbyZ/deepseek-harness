/**
 * Global theme DOM applier: projects the resolved ThemeSnapshot onto the
 * document — `html { color-scheme }` for native UA chrome (scrollbars, form
 * controls), `body[data-ds-dark-theme]` for the token palette, the active
 * theme's alias-token overrides as inline CSS variables on body, the global
 * tiled background image as `--app-background-image` (`url(...)` wrapped), and
 * one presenter-owned `meta[name="theme-color"]` for surrounding browser UI.
 * Pure DOM writes, no React involvement; the presenter only ever retracts what
 * it wrote itself, so foreign attributes, metadata, and inline styles survive.
 */
import type { BackgroundCrop, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Body attribute selecting the dark base palette in the token stylesheets. */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Body attribute selecting the skin layer (default/glass/cyber). */
export const SKIN_ATTRIBUTE = 'data-skin'

/** Body inline property carrying the global tiled background image (`url(...)` wrapped). */
export const BACKGROUND_IMAGE_PROPERTY = '--app-background-image'

/** Body inline property carrying the background `background-size` (cover or a crop scale). */
export const BACKGROUND_SIZE_PROPERTY = '--app-background-size'

/** Body inline property carrying the background `background-position` (center or a crop offset). */
export const BACKGROUND_POSITION_PROPERTY = '--app-background-position'

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

/** Applies theme snapshots to the document; one instance per plugin fiber. */
export class ThemePresenter {
  /** Token names this presenter wrote in the last apply (its retraction set). */
  private appliedTokens: string[] = []
  /** The single metadata node this presenter inserts and removes. */
  private readonly themeColorMeta: HTMLMetaElement

  /** Create the presenter-owned metadata node before the first snapshot arrives. */
  constructor() {
    this.themeColorMeta = document.createElement('meta')
    this.themeColorMeta.name = 'theme-color'
  }

  /**
   * Project a snapshot onto the document: set root `color-scheme` and the body
   * palette attribute from `active.colorScheme` (never the id — `system` is
   * resolved upstream), then replace the previously applied token variables
   * with `active.tokens`. Browser theme-color metadata follows the computed
   * body background after those writes, so the rendered palette remains the
   * color authority. The tiled background image rides the same pass: the
   * snapshot's raw URL/data-URL is wrapped in `url(...)` here (the service
   * stores it bare) and `none` clears it.
   * @param snapshot - resolved theme snapshot from ctx.theme.
   */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    body.setAttribute(SKIN_ATTRIBUTE, snapshot.skin)
    body.style.setProperty(BACKGROUND_IMAGE_PROPERTY, snapshot.background ? `url(${snapshot.background})` : 'none')
    const background = cropToBackground(snapshot.backgroundCrop)
    body.style.setProperty(BACKGROUND_SIZE_PROPERTY, background.size)
    body.style.setProperty(BACKGROUND_POSITION_PROPERTY, background.position)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
  }

  /** Retract root color-scheme, the palette attribute, token variables, and the owned metadata node. */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    body.removeAttribute(SKIN_ATTRIBUTE)
    body.style.removeProperty(BACKGROUND_IMAGE_PROPERTY)
    body.style.removeProperty(BACKGROUND_SIZE_PROPERTY)
    body.style.removeProperty(BACKGROUND_POSITION_PROPERTY)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}
