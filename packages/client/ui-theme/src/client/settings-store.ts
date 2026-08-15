/**
 * Appearance row slot store: a mirror of the theme service snapshot. The
 * plugin's apply-world change listener is the only writer; the row component
 * reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_SKIN, type SkinId, type ThemePreference } from '../theme-settings.ts'

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Persisted preference (selection state reads this, never the resolved active theme). */
  preference: ThemePreference
  /** Selected skin layer id (the skin row's selection state). */
  skin: SkinId
  /** Global background image (raw URL or data URL; empty = none). */
  background: string
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, preference: ThemePreference, skin: SkinId, background: string, revision: number) => void
}

/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ preference: 'system', skin: DEFAULT_SKIN, background: '', revision: -1 }),
    actions: {
      sync: (d, preference, skin, background, revision) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.skin = skin
        d.background = background
        d.revision = revision
      },
    },
  })
}
