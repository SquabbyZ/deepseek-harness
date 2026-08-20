/**
 * Settings — renders every `settings.section` slot entry that the in-box
 * `dsh_client_ui_settings_*` plugins register at boot.
 *
 * The full `SettingsRoot` shell from `ui-settings-general` is the
 * production target (it owns the nav, the chrome content, the section
 * ordering, the personalisation overlay, the onboarding wizard, etc.). That
 * shell wants a half-dozen framework services (sessions, workspaces,
 * settingsScope, locale, connection, remote, slots) plus a renderSlot
 * adapter. We don't have all of those — `dsh_session_persistence`,
 * `dsh_storage`, `dsh_session_query`, etc. are still in the Node sidecar
 * phase — so this route stops short of `SettingsRoot` and instead just
 * mounts the registered section components in `settings.section` order.
 *
 * Each section is a self-contained React component (it reads its own slot
 * children via `ctx.slots.entries('settings.general.item')` and the like);
 * we just need to provide a `renderSlot` adapter that maps slot keys to
 * their component entries. The host-context provider already exposes the
 * cordis `ctx`, so the adapter closes over it once.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useHost } from '../dsh/host-context.tsx'

interface SectionEntry {
  component: unknown
  options: {
    id?: string
    order?: number
    label?: unknown
    [key: string]: unknown
  }
}

/** A renderSlot adapter for the slots each section reads internally. */
function makeRenderSlot(
  ctx: ReturnType<typeof useHost>['ctx'],
): (key: string, owner: unknown, opts?: { only?: string }) => ReactNode {
  return (key, _owner, opts) => {
    const entries = ctx.slots.entries(key) as readonly SectionEntry[]
    const filtered = opts?.only !== undefined
      ? entries.filter(entry => entry.options.id === opts.only)
      : entries
    return (
      <>
        {filtered.map((entry) => {
          const Component = entry.component as React.ComponentType<Record<string, unknown>>
          const id = typeof entry.options.id === 'string' ? entry.options.id : 'item'
          return <Component key={`${key}:${id}`} />
        })}
      </>
    )
  }
}

/** No-op selector hook. The full SettingsRoot would return a typed slice
 * of a settings-namespace document; in vite dev without `dsh-storage` we
 * have no document, so sections see an empty map and render their fallback
 * state. */
function useEmptySelector<T>(selector: (state: never) => T): T {
  return selector({} as never)
}

interface SettingsSectionProps {
  readonly entry: SectionEntry
  readonly renderSlot: ReturnType<typeof makeRenderSlot>
}

/**
 * Wrap a single slot entry's component so we can pass the `renderSlot` /
 * `use*` props it expects. Section components ship as `SettingsGeneral` etc.
 * and destructure `useSections`, `useSessions`, `renderSlot`, etc. off their
 * props object; we provide reasonable stand-ins for vite dev where the
 * backend services aren't mounted.
 */
function SettingsSection({ entry, renderSlot }: SettingsSectionProps): ReactNode {
  const Component = entry.component as React.ComponentType<Record<string, unknown>>
  const id = typeof entry.options.id === 'string' ? entry.options.id : 'section'
  // The slot label is a thunk: `() => t('...')`. We don't have t, so fall
  // back to the section id in either branch.
  const label = id
  return (
    <section
      key={id}
      data-section-id={id}
      aria-label={label}
      className="rounded border border-white/10 p-4"
    >
      <h2 className="text-lg font-medium mb-3">{label}</h2>
      <Component
        renderSlot={renderSlot}
        useSections={useEmptySelector}
        useNav={useEmptySelector}
        useSessions={useEmptySelector}
        useWorkspaces={useEmptySelector}
        useOnboardingSteps={useEmptySelector}
        wide
        navActions={{ openSection: () => undefined, close: () => undefined }}
      />
    </section>
  )
}

/** Read every `settings.section` slot entry registered at boot. */
function useSettingsSections(): readonly SectionEntry[] {
  const { ctx } = useHost()
  const [entries, setEntries] = useState<readonly SectionEntry[]>(() =>
    ctx.slots.entries('settings.section') as readonly SectionEntry[],
  )
  useEffect(() => {
    const off = ctx.on('slots/changed', (key) => {
      if (key === 'settings.section') {
        setEntries(ctx.slots.entries('settings.section') as readonly SectionEntry[])
      }
    })
    return () => { void off }
  }, [ctx])
  return entries
}

export function Settings(): ReactNode {
  const { ctx } = useHost()
  const sections = useSettingsSections()
  const renderSlot = makeRenderSlot(ctx)
  // Stable sort by `order` (then id) so the visual order matches the
  // ui-settings-* plugin authors' intent.
  const sorted = [...sections].sort((a, b) => {
    const ao = typeof a.options.order === 'number' ? a.options.order : 0
    const bo = typeof b.options.order === 'number' ? b.options.order : 0
    if (ao !== bo) return ao - bo
    const ai = typeof a.options.id === 'string' ? a.options.id : ''
    const bi = typeof b.options.id === 'string' ? b.options.id : ''
    return ai.localeCompare(bi)
  })

  return (
    <div className="p-4 max-w-3xl mx-auto" data-testid="settings-root">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500">
          {sorted.length === 0
            ? 'No settings sections registered — in-box ui-settings-* plugins may still be booting.'
            : `${sorted.length} section${sorted.length === 1 ? '' : 's'} from in-box ui-settings-* plugins.`}
        </p>
      </header>

      <div className="space-y-6">
        {sorted.map(entry => (
          <SettingsSection key={String(entry.options.id ?? 'section')} entry={entry} renderSlot={renderSlot} />
        ))}
      </div>
    </div>
  )
}
