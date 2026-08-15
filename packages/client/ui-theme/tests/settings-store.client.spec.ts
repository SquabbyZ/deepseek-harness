/** Appearance row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference, default skin, empty background and name, null crop, revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({
      preference: 'system', skin: 'default', background: '', backgroundName: '', backgroundCrop: null, revision: -1,
    })
  })

  it('sync mirrors the preference, skin, background, name, crop, and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'cyber', 'https://example.com/bg.png', 'bg.png', { x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, 0)
    expect(store.getSnapshot()).toEqual({
      preference: 'dark', skin: 'cyber', background: 'https://example.com/bg.png',
      backgroundName: 'bg.png', backgroundCrop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, revision: 0,
    })
    store.actions.sync('light', 'glass', 'data:image/png;base64,AAAA', '', null, 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().skin).toBe('glass')
    expect(store.getSnapshot().background).toBe('data:image/png;base64,AAAA')
    expect(store.getSnapshot().backgroundName).toBe('')
    expect(store.getSnapshot().backgroundCrop).toBeNull()
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'cyber', 'url-a', 'a.png', null, 3)
    store.actions.sync('system', 'glass', 'url-stale', '', null, 2)
    store.actions.sync('system', 'glass', 'url-dup', '', null, 3)
    expect(store.getSnapshot()).toEqual({
      preference: 'dark', skin: 'cyber', background: 'url-a', backgroundName: 'a.png', backgroundCrop: null, revision: 3,
    })
  })
})
