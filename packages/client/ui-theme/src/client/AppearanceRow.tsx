/**
 * Theme preference row registered into the Personalization section item slot
 * (figma 501:30012 'Frame 2117131228'): title + three preference cubes.
 * Registered by this package — the theme feature owns its own settings
 * surface. Selection follows the persisted preference, never the resolved
 * active theme.
 */
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16, ShadcnButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'

/** Shared flexed-cube geometry (figma 'Selector Cube'): 1 1 180px, centered. */
const CUBE_BASE = 'box-border flex-[1_1_180px] flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-transparent px-8 py-5 text-sm font-normal leading-[22px] text-foreground cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

/** Selected cube: module-platform fill + bluish-400 border (static token). */
const CUBE_SELECTED = 'bg-[var(--dsw-alias-bg-module-platform)] border-[var(--dsw-static-neutral-bluish-400)] hover:bg-[var(--dsw-alias-bg-module-platform)]'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.personalization.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'theme.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'theme.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'theme.system', Icon: IconFollowsystemOutline16 },
]

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  return (
    <div className="flex flex-col gap-2 border-b border-border py-4">
      <div className="text-sm font-normal leading-[22px] text-foreground">{t('theme.title')}</div>
      <div className="flex flex-wrap items-stretch gap-2">
        {CUBES.map(({ id, labelKey, Icon }) => (
          <ShadcnButton
            key={id}
            variant="ghost"
            className={clsx(CUBE_BASE, preference === id && CUBE_SELECTED)}
            aria-pressed={preference === id}
            onClick={() => { setTheme(id) }}
          >
            <Icon />
            {t(labelKey)}
          </ShadcnButton>
        ))}
      </div>
    </div>
  )
}
