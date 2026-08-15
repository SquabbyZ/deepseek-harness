// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SkinId,
  ThemeSettings,
  ThemeSnapshot,
  ThemeTokenOverrides,
} from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  BACKGROUND_CROP_FIELD, BACKGROUND_FIELD, BACKGROUND_NAME_FIELD, DEFAULT_SKIN, SKIN_FIELD, SKIN_IDS, SKIN_PRESETS, ThemeRuntime,
} from '@deepseek-ai/dsh-client-ui-theme/client'

const make = (host = stubSettingsScope<ThemeSettings>()): {
  ctx: Context
  theme: ThemeRuntime
  events: ThemeSnapshot[]
  host: StubSettingsScope<ThemeSettings>
} => {
  const ctx = new Context()
  const events: ThemeSnapshot[] = []
  ctx.on('theme/change', (snapshot) => { events.push(snapshot) })
  return { ctx, theme: new ThemeRuntime(ctx, host.scope), events, host }
}

describe('ThemeRuntime', () => {
  it('defaults to the system preference resolved against prefers-color-scheme', () => {
    const { theme } = make()
    const snapshot = theme.getTheme()
    expect(snapshot.preference).toBe('system')
    // jsdom matchMedia is absent; system resolves to light.
    expect(snapshot.active.id).toBe('light')
    expect(snapshot.active.colorScheme).toBe('light')
    expect(snapshot.themes.map(t => t.id)).toEqual(['light', 'dark'])
  })

  it('setTheme switches, writes through the scope, republishes, and keeps DOM untouched', () => {
    const { theme, events, host } = make()
    theme.setTheme('dark')
    expect(theme.getTheme().preference).toBe('dark')
    expect(theme.getTheme().active.colorScheme).toBe('dark')
    expect(host.set).toHaveBeenCalledWith('preference', 'dark')
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(theme.getTheme())
    // The service never touches presentation state.
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    // Same-value set is a no-op (no extra event).
    theme.setTheme('dark')
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('adopts a published Host section without writing it back', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: { preference: 'dark', skin: 'default', background: '', backgroundName: '', backgroundCrop: null }, revision: 1, writable: true })
    expect(theme.getTheme().preference).toBe('dark')
    expect(events).toHaveLength(1)
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { preference: 'dark', skin: 'default', background: '', backgroundName: '', backgroundCrop: null }, revision: 2 })
    expect(events).toHaveLength(1)
  })

  it('adopts a section already standing at construction', () => {
    const host = stubSettingsScope<ThemeSettings>()
    host.publish({ status: 'ready', value: { preference: 'dark', skin: 'default', background: '', backgroundName: '', backgroundCrop: null }, revision: 1, writable: true })
    const { theme } = make(host)
    expect(theme.getTheme().preference).toBe('dark')
  })

  it('throws on unknown setTheme ids, duplicate registration, and the system id', () => {
    const { theme } = make()
    expect(() => { theme.setTheme('sepia') }).toThrow('not registered')
    expect(() => theme.register({ id: 'light', colorScheme: 'light', tokens: {} })).toThrow('already registered')
    expect(() => theme.register({ id: 'system', colorScheme: 'light', tokens: {} })).toThrow('preference')
  })

  it('registered themes join the snapshot; disposing the active one resets to default', () => {
    const { theme, events, host } = make()
    const dispose = theme.register({ id: 'sepia', colorScheme: 'light', tokens: { '--dsw-alias-bg-base': 'red' } })
    expect(theme.getTheme().themes.map(t => t.id)).toEqual(['light', 'dark', 'sepia'])
    theme.setTheme('sepia')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('red')
    dispose()
    expect(theme.getTheme().preference).toBe('system')
    expect(theme.getTheme().themes.map(t => t.id)).toEqual(['light', 'dark'])
    // Custom ids are in-process extension themes; only the built-in product
    // preferences cross the Host settings schema.
    expect(host.set).not.toHaveBeenCalled()
    // register + set + dispose = three publishes; disposer is idempotent.
    expect(events.length).toBe(3)
    dispose()
    expect(events.length).toBe(3)
  })

  it('disposing an inactive theme keeps the active preference', () => {
    const { theme } = make()
    const dispose = theme.register({ id: 'sepia', colorScheme: 'light', tokens: {} })
    theme.setTheme('dark')
    dispose()
    expect(theme.getTheme().preference).toBe('dark')
  })

  it('revision increases monotonically across every publish', () => {
    const { theme, events } = make()
    theme.setTheme('dark')
    theme.setTheme('light')
    const dispose = theme.register({ id: 'sepia', colorScheme: 'dark', tokens: {} })
    dispose()
    expect(events.map(e => e.revision)).toEqual([1, 2, 3, 4])
  })

  it('stacks reversible token overrides in call order and selects the active palette value', () => {
    const { theme } = make()
    const firstTokens: ThemeTokenOverrides = {
      '--shared': { light: 'first-light', dark: 'first-dark' },
      '--first': { light: 'first-only-light', dark: 'first-only-dark' },
    }
    const disposeFirst = theme.overrideTokens('first', firstTokens)
    firstTokens['--shared']!.light = 'mutated-after-call'
    const disposeSecond = theme.overrideTokens('second', {
      '--shared': { light: 'second-light', dark: 'second-dark' },
    })

    expect(theme.getTheme().active.tokens).toMatchObject({
      '--first': 'first-only-light',
      '--shared': 'second-light',
    })
    theme.setTheme('dark')
    expect(theme.getTheme().active.tokens).toMatchObject({
      '--first': 'first-only-dark',
      '--shared': 'second-dark',
    })

    disposeSecond()
    expect(theme.getTheme().active.tokens['--shared']).toBe('first-dark')
    disposeFirst()
    expect(theme.getTheme().active.tokens['--shared']).toBeUndefined()
  })

  it('replacing one source leaves its stale disposer harmless', () => {
    const { theme, events } = make()
    const stale = theme.overrideTokens('package', {
      '--old': { light: 'old-light', dark: 'old-dark' },
    })
    const current = theme.overrideTokens('package', {
      '--new': { light: 'new-light', dark: 'new-dark' },
    })
    stale()
    expect(theme.getTheme().active.tokens).toEqual({ '--new': 'new-light' })
    current()
    current()
    expect(theme.getTheme().active.tokens).toEqual({})
    expect(events).toHaveLength(3)
  })

  it('exports sorted built-in, registered, and override-only token descriptions as copies', () => {
    const { theme } = make()
    theme.register({
      id: 'custom',
      colorScheme: 'light',
      tokens: {
        '--dsw-alias-bg-base': 'duplicate-built-in',
        '--registered': 'registered',
      },
    })
    theme.overrideTokens('package', {
      '--registered': { light: 'duplicate-registered', dark: 'duplicate-registered' },
      semanticAccent: { light: 'pink', dark: 'red' },
    })

    const tokens = theme.exportInspectTokens()
    expect(tokens.map(token => token.name)).toEqual([...tokens.map(token => token.name)].sort())
    expect(tokens.find(token => token.name === '--registered')).toMatchObject({
      valueType: 'CSS value',
      cssVariable: '--registered',
    })
    const semantic = tokens.find(token => token.name === 'semanticAccent')
    expect(semantic).toMatchObject({ valueType: 'CSS value' })
    expect(semantic).not.toHaveProperty('cssVariable')
    expect(tokens.filter(token => token.name === '--dsw-alias-bg-base')).toHaveLength(1)

    tokens[0]!.description = 'caller mutation'
    expect(theme.exportInspectTokens()[0]!.description).not.toBe('caller mutation')
  })

  it('rejects every malformed token override value with a teaching error', () => {
    const { theme } = make()
    const override = (value: unknown): void => {
      theme.overrideTokens('package', { '--bad': value } as unknown as ThemeTokenOverrides)
    }
    expect(() => { override('red') }).toThrow(/bare string.*light.*dark/)
    for (const value of [1, null, {}, { light: 1, dark: 'dark' }, { light: 'light' }]) {
      expect(() => { override(value) }).toThrow(/must map to a \{ light, dark \} pair/)
    }
  })

  it('context dispose releases the scope subscription', async () => {
    const { ctx, host } = make()
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('defaults to the default skin and carries it in the snapshot', () => {
    const { theme } = make()
    expect(theme.getTheme().skin).toBe(DEFAULT_SKIN)
    // The default skin overrides nothing.
    expect(theme.getTheme().active.tokens).toEqual({})
  })

  it('setSkin switches the skin, persists it, and is a no-op when unchanged', () => {
    const { theme, events, host } = make()
    theme.setSkin('glass')
    expect(theme.getTheme().skin).toBe('glass')
    expect(host.set).toHaveBeenCalledWith(SKIN_FIELD, 'glass')
    const count = events.length
    theme.setSkin('glass')
    expect(events).toHaveLength(count)
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('folds the active skin tokens with the active color scheme', () => {
    const { theme } = make()
    theme.setSkin('cyber')
    const token = '--dsw-alias-bg-base'
    expect(SKIN_PRESETS.cyber[token]!.light).not.toBe(SKIN_PRESETS.cyber[token]!.dark)
    expect(theme.getTheme().active.tokens[token]).toBe(SKIN_PRESETS.cyber[token]!.light)
    theme.setTheme('dark')
    expect(theme.getTheme().active.tokens[token]).toBe(SKIN_PRESETS.cyber[token]!.dark)
  })

  it('rejects unknown skin ids', () => {
    const { theme } = make()
    expect(() => { theme.setSkin('neon' as SkinId) }).toThrow('skin')
  })

  it('adopts a persisted skin alongside the preference without writing it back', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: { preference: 'dark', skin: 'cyber', background: '', backgroundName: '', backgroundCrop: null }, revision: 1, writable: true })
    expect(theme.getTheme().preference).toBe('dark')
    expect(theme.getTheme().skin).toBe('cyber')
    expect(host.set).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
  })

  it('defaults to an empty background and carries it in the snapshot', () => {
    const { theme } = make()
    expect(theme.getTheme().background).toBe('')
  })

  it('setBackground persists the raw value, republishes, and no-ops when unchanged', () => {
    const { theme, events, host } = make()
    theme.setBackground('https://example.com/bg.png')
    expect(theme.getTheme().background).toBe('https://example.com/bg.png')
    expect(host.set).toHaveBeenCalledWith(BACKGROUND_FIELD, 'https://example.com/bg.png')
    expect(events).toHaveLength(1)
    theme.setBackground('https://example.com/bg.png')
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('setBackground clears with an empty string', () => {
    const { theme, events } = make()
    theme.setBackground('data:image/png;base64,AAAA')
    theme.setBackground('')
    expect(theme.getTheme().background).toBe('')
    expect(events).toHaveLength(2)
  })

  it('adopts a persisted background without writing it back', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: { preference: 'system', skin: 'default', background: 'https://example.com/bg.png', backgroundName: '', backgroundCrop: null }, revision: 1, writable: true })
    expect(theme.getTheme().background).toBe('https://example.com/bg.png')
    expect(host.set).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
  })

  it('treats a non-string persisted background as empty', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: { preference: 'system', skin: 'default', background: 42 as unknown as string, backgroundName: '', backgroundCrop: null }, revision: 1, writable: true })
    expect(theme.getTheme().background).toBe('')
    expect(events).toHaveLength(0)
  })

  it('defaults to an empty background name and a null crop', () => {
    const { theme } = make()
    expect(theme.getTheme().backgroundName).toBe('')
    expect(theme.getTheme().backgroundCrop).toBeNull()
  })

  it('setBackgroundName persists, republishes, and no-ops when unchanged', () => {
    const { theme, events, host } = make()
    theme.setBackgroundName('bg.png')
    expect(theme.getTheme().backgroundName).toBe('bg.png')
    expect(host.set).toHaveBeenCalledWith(BACKGROUND_NAME_FIELD, 'bg.png')
    expect(events).toHaveLength(1)
    theme.setBackgroundName('bg.png')
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('setBackgroundCrop persists a region, republishes, and no-ops on an equal region', () => {
    const { theme, events, host } = make()
    const crop = { x: 0.25, y: 0.5, w: 0.5, h: 0.5 }
    theme.setBackgroundCrop(crop)
    expect(theme.getTheme().backgroundCrop).toBe(crop)
    expect(host.set).toHaveBeenCalledWith(BACKGROUND_CROP_FIELD, crop)
    expect(events).toHaveLength(1)
    // Structurally equal (new object) is still a no-op.
    theme.setBackgroundCrop({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 })
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('setBackgroundCrop clears with null', () => {
    const { theme, events } = make()
    theme.setBackgroundCrop({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 })
    theme.setBackgroundCrop(null)
    expect(theme.getTheme().backgroundCrop).toBeNull()
    expect(events).toHaveLength(2)
  })

  it('adopts a persisted background name and crop without writing them back', () => {
    const { theme, events, host } = make()
    host.publish({
      status: 'ready',
      value: { preference: 'system', skin: 'default', background: '', backgroundName: 'bg.png', backgroundCrop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      revision: 1, writable: true,
    })
    expect(theme.getTheme().backgroundName).toBe('bg.png')
    expect(theme.getTheme().backgroundCrop).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })
    expect(host.set).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
  })

  it('treats a malformed persisted crop as null', () => {
    const { theme, host } = make()
    host.publish({
      status: 'ready',
      value: { preference: 'system', skin: 'default', background: '', backgroundName: '', backgroundCrop: { x: 0.1, y: 'bad' } as unknown as never },
      revision: 1, writable: true,
    })
    expect(theme.getTheme().backgroundCrop).toBeNull()
  })

  it('treats an out-of-range persisted crop as null', () => {
    const { theme, host } = make()
    host.publish({
      status: 'ready',
      value: { preference: 'system', skin: 'default', background: '', backgroundName: '', backgroundCrop: { x: 0.1, y: 0.2, w: 1.5, h: 0.4 } },
      revision: 1, writable: true,
    })
    expect(theme.getTheme().backgroundCrop).toBeNull()
  })

  it('treats a zero-area persisted crop as null', () => {
    const { theme, host } = make()
    host.publish({
      status: 'ready',
      value: { preference: 'system', skin: 'default', background: '', backgroundName: '', backgroundCrop: { x: 0.1, y: 0.2, w: 0, h: 0.4 } },
      revision: 1, writable: true,
    })
    expect(theme.getTheme().backgroundCrop).toBeNull()
  })

  it('every skin preset overrides surface tokens only, as { light, dark } pairs', () => {
    expect(SKIN_PRESETS.default).toEqual({})
    for (const skin of SKIN_IDS) {
      if (skin === 'default') continue
      const tokens = SKIN_PRESETS[skin]
      expect(Object.keys(tokens).length).toBeGreaterThan(0)
      for (const [name, modes] of Object.entries(tokens)) {
        expect(name).toMatch(/^--dsw-(?:alias-bg-|alias-border-l|specific-sidebar-fill)/)
        expect(typeof modes.light).toBe('string')
        expect(typeof modes.dark).toBe('string')
      }
    }
  })

  describe('prefers-color-scheme resolution (stubbed matchMedia)', () => {
    type Listener = () => void
    const stubMedia = (initialMatches: boolean) => {
      const listeners = new Set<Listener>()
      const media = {
        matches: initialMatches,
        addEventListener: (_: 'change', fn: Listener) => { listeners.add(fn) },
        removeEventListener: (_: 'change', fn: Listener) => { listeners.delete(fn) },
        flip() {
          this.matches = !this.matches
          for (const fn of listeners) fn()
        },
        listenerCount: () => listeners.size,
      }
      vi.stubGlobal('matchMedia', () => media)
      return media
    }

    afterEach(() => { vi.unstubAllGlobals() })

    it('system resolves against the media query and follows OS flips', () => {
      const media = stubMedia(true)
      const { theme, events } = make()
      expect(theme.getTheme().preference).toBe('system')
      expect(theme.getTheme().active.id).toBe('dark')
      media.flip()
      expect(theme.getTheme().active.id).toBe('light')
      expect(events).toHaveLength(1)
    })

    it('OS flips do not republish while a concrete preference is set', () => {
      const media = stubMedia(false)
      const { theme, events } = make()
      theme.setTheme('light')
      expect(events).toHaveLength(1)
      media.flip()
      expect(events).toHaveLength(1)
      expect(theme.getTheme().active.id).toBe('light')
    })

    it('context dispose releases the media listener', async () => {
      const media = stubMedia(false)
      const { ctx } = make()
      expect(media.listenerCount()).toBe(1)
      await ctx.fiber.dispose()
      expect(media.listenerCount()).toBe(0)
    })
  })
})
