/**
 * Skin selector row registered into the Personalization section item slot,
 * mirroring the Appearance row's cube interaction: title + three skin cubes
 * (default/glass/cyber). Selection follows the persisted skin id from the
 * theme snapshot mirror, never the resolved active tokens.
 */
import clsx from 'clsx'
import { ShadcnButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkinId } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'

/** Shared flexed-cube geometry (figma 'Selector Cube'): 1 1 180px, centered. */
const CUBE_BASE = 'box-border flex-[1_1_180px] flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-transparent px-8 py-5 text-sm font-normal leading-[22px] text-foreground cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

/** Selected cube: module-platform fill + bluish-400 border (static token). */
const CUBE_SELECTED = 'bg-[var(--dsw-alias-bg-module-platform)] border-[var(--dsw-static-neutral-bluish-400)] hover:bg-[var(--dsw-alias-bg-module-platform)]'

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
    <div className="flex flex-col gap-2 border-b border-border py-4">
      <div className="text-sm font-normal leading-[22px] text-foreground">{t('skin.title')}</div>
      <div className="flex flex-wrap items-stretch gap-2">
        {SKINS.map(({ id, labelKey }) => (
          <ShadcnButton
            key={id}
            variant="ghost"
            className={clsx(CUBE_BASE, skin === id && CUBE_SELECTED)}
            aria-pressed={skin === id}
            onClick={() => { setSkin(id) }}
          >
            {t(labelKey)}
          </ShadcnButton>
        ))}
      </div>
    </div>
  )
}
