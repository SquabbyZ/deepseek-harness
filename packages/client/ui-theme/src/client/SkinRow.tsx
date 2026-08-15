/**
 * Skin selector row registered into the Personalization section item slot,
 * mirroring the Appearance row's cube interaction: title + three skin cubes
 * (default/glass/cyber). Selection follows the persisted skin id from the
 * theme snapshot mirror, never the resolved active tokens.
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkinId } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './SkinRow.module.css'

/** Injected business face: the skin write (t rides the standard locale seat). */
export interface SkinRowInjected {
  /** Switch the skin layer. */
  setSkin: (id: SkinId) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type SkinRowComponentProps =
  PropsRuntime<'settings.personalization.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & SkinRowInjected

/** Skin order and labels (default/glass/cyber). */
const SKINS: readonly { id: SkinId; labelKey: ThemeKey }[] = [
  { id: 'default', labelKey: 'skin.default' },
  { id: 'glass', labelKey: 'skin.glass' },
  { id: 'cyber', labelKey: 'skin.cyber' },
]

/**
 * Render the Skin row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function SkinRow({ t, setSkin, useStore }: SkinRowComponentProps) {
  const skin = useStore(s => s.skin)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('skin.title')}</div>
      <div className={css.cubeRow}>
        {SKINS.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.skinCube, skin === id && css.selected)}
            aria-pressed={skin === id}
            onClick={() => { setSkin(id) }}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  )
}
