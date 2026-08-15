/** Appearance row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference, default skin, empty background, revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', skin: 'default', background: '', revision: -1 })
  })

  it('sync mirrors the preference, skin, background, and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'cyber', 'https://example.com/bg.png', 0)
    expect(store.getSnapshot()).toEqual({
      preference: 'dark', skin: 'cyber', background: 'https://example.com/bg.png', revision: 0,
    })
    store.actions.sync('light', 'glass', 'data:image/png;base64,AAAA', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().skin).toBe('glass')
    expect(store.getSnapshot().background).toBe('data:image/png;base64,AAAA')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'cyber', 'url-a', 3)
    store.actions.sync('system', 'glass', 'url-stale', 2)
    store.actions.sync('system', 'glass', 'url-dup', 3)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', skin: 'cyber', background: 'url-a', revision: 3 })
  })
})
