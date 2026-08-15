// @vitest-environment jsdom
// ThemePresenter behavior account: root color-scheme and the palette attribute
// follow active.colorScheme only, token variables replace the previous apply's
// set, theme-color metadata follows the rendered body background, and dispose
// retracts everything the presenter wrote.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackgroundCrop, SkinId, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { cropToBackground } from '@deepseek-ai/dsh-client-ui-theme/client'
import { BACKGROUND_IMAGE_PROPERTY, BACKGROUND_POSITION_PROPERTY, BACKGROUND_SIZE_PROPERTY, DARK_ATTRIBUTE, SKIN_ATTRIBUTE, ThemePresenter } from '@deepseek-ai/dsh-client-ui-layout/src/client/theme-presenter.ts'

const LIGHT_THEME_COLOR = 'rgb(255, 255, 255)'
const DARK_THEME_COLOR = 'rgb(21, 21, 23)'

function snapshot(
  colorScheme: 'light' | 'dark',
  tokens: Record<string, string> = {},
  skin: SkinId = 'default',
  background = '',
  backgroundName = '',
  backgroundCrop: BackgroundCrop | null = null,
): ThemeSnapshot {
  // The presenter must key off colorScheme, not the id — keep them distinct.
  const active = { id: `${colorScheme}-test`, colorScheme, tokens }
  return { preference: colorScheme, skin, background, backgroundName, backgroundCrop, active, themes: [active], revision: 1 }
}

function clearThemePresentation(): void {
  document.head.querySelectorAll('meta[name="theme-color"], style[data-theme-presenter-test]').forEach((node) => { node.remove() })
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
}

beforeEach(() => {
  clearThemePresentation()
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.removeAttribute(SKIN_ATTRIBUTE)
  document.body.removeAttribute('style')
  const style = document.createElement('style')
  style.dataset.themePresenterTest = ''
  style.textContent = `
    body { background-color: ${LIGHT_THEME_COLOR}; }
    body[${DARK_ATTRIBUTE}] { background-color: ${DARK_THEME_COLOR}; }
  `
  document.head.append(style)
})

afterEach(clearThemePresentation)

describe('ThemePresenter', () => {
  it('light scheme sets root color-scheme and leaves the dark attribute absent', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()?.content).toBe(LIGHT_THEME_COLOR)
  })

  it('dark scheme sets root color-scheme, the attribute, and metadata; switching to light updates one node', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark'))
    const meta = themeColorMeta()
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    expect(meta?.content).toBe(DARK_THEME_COLOR)
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()).toBe(meta)
    expect(meta?.content).toBe(LIGHT_THEME_COLOR)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
  })

  it('applies tokens as inline variables and clears the previous set on theme change', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111', '--dsw-alias-fg': '#eee' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#111')
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('#eee')
    presenter.apply(snapshot('light', { '--dsw-alias-bg': '#fff' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#fff')
    // The old theme's extra variable is gone, not merged.
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('')
  })

  it('dispose removes color-scheme, the attribute, and every applied variable, sparing foreign inline styles', () => {
    document.body.style.setProperty('--foreign', 'kept')
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111' }))
    const meta = themeColorMeta()
    presenter.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('')
    expect(document.body.style.getPropertyValue('--foreign')).toBe('kept')
    expect(meta?.isConnected).toBe(false)
  })

  it('sets and clears the skin attribute independently of the dark attribute', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', {}, 'cyber'))
    expect(document.body.getAttribute(SKIN_ATTRIBUTE)).toBe('cyber')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    presenter.apply(snapshot('light', {}, 'glass'))
    expect(document.body.getAttribute(SKIN_ATTRIBUTE)).toBe('glass')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    presenter.dispose()
    expect(document.body.hasAttribute(SKIN_ATTRIBUTE)).toBe(false)
  })

  it('applies the background image as inline url(...), clears to none when empty, and removes on dispose', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light', {}, 'default', 'https://example.com/bg.png'))
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_PROPERTY)).toBe('url(https://example.com/bg.png)')
    presenter.apply(snapshot('light', {}, 'default', ''))
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_PROPERTY)).toBe('none')
    presenter.dispose()
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_PROPERTY)).toBe('')
  })

  it('applies a crop region as background-size/position, defaulting to cover/center, and removes on dispose', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light', {}, 'default', 'https://example.com/bg.png', '', { x: 0.25, y: 0.5, w: 0.5, h: 0.5 }))
    expect(document.body.style.getPropertyValue(BACKGROUND_SIZE_PROPERTY)).toBe('calc(100% / 0.5) calc(100% / 0.5)')
    expect(document.body.style.getPropertyValue(BACKGROUND_POSITION_PROPERTY)).toBe('calc(0.25 / 0.5 * 100%) calc(0.5 / 0.5 * 100%)')
    // Null crop restores the defaults.
    presenter.apply(snapshot('light', {}, 'default', 'https://example.com/bg.png'))
    expect(document.body.style.getPropertyValue(BACKGROUND_SIZE_PROPERTY)).toBe('cover')
    expect(document.body.style.getPropertyValue(BACKGROUND_POSITION_PROPERTY)).toBe('center')
    presenter.dispose()
    expect(document.body.style.getPropertyValue(BACKGROUND_SIZE_PROPERTY)).toBe('')
    expect(document.body.style.getPropertyValue(BACKGROUND_POSITION_PROPERTY)).toBe('')
  })
})

describe('cropToBackground', () => {
  it('scales each axis by 1/w and 1/h and offsets by x/(1-w), y/(1-h)', () => {
    // Center square: both axes scaled 2x and shifted to the crop's top-left.
    expect(cropToBackground({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })).toEqual({
      size: 'calc(100% / 0.5) calc(100% / 0.5)',
      position: 'calc(0.25 / 0.5 * 100%) calc(0.25 / 0.5 * 100%)',
    })
    // Right half, full height: x scaled 2x, y stays 1x with a 0% offset.
    expect(cropToBackground({ x: 0.5, y: 0, w: 0.5, h: 1 })).toEqual({
      size: 'calc(100% / 0.5) calc(100% / 1)',
      position: 'calc(0.5 / 0.5 * 100%) 0%',
    })
  })

  it('falls back to cover/center for null, undefined, and zero-area crops', () => {
    expect(cropToBackground(null)).toEqual({ size: 'cover', position: 'center' })
    expect(cropToBackground(undefined)).toEqual({ size: 'cover', position: 'center' })
    expect(cropToBackground({ x: 0.5, y: 0.5, w: 0, h: 0 })).toEqual({ size: 'cover', position: 'center' })
  })
})
