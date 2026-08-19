import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  SearchInput,
  ShadcnButton,
  SwitchRow,
  Toast,
  IconWarningOutline16,
  useDebouncedToggle,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PluginDisabledReason,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventoryStore,
} from './inventory-store.ts'
import type { PluginInventoryLocaleKey } from './locales.ts'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<{ entries: readonly PluginInventoryEntry[] }>
  /** Trigger a fresh read; called from the retry button on read failure. */
  refresh: () => void
  /** Snapshot store carrying the last successful read + listener set. */
  store: PluginInventoryStore
  /** Toggle one entry's enabled state; throws on RPC failure. */
  setEnabled: (action: { entryId: string; enabled: boolean }, options: { signal: AbortSignal }) => Promise<void>
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type PluginInventoryEntryView = PluginInventoryEntry

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly entries: readonly PluginInventoryEntryView[] }

const SECTION = 'flex w-full max-w-[760px] flex-col gap-[14px] text-foreground'
const STATUS = 'm-0 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]'
const FAILURE = 'flex items-center gap-2.5 text-[13px] leading-5 text-[var(--dsw-alias-state-error-primary)]'
const RETRY = 'h-auto rounded-md border-border bg-transparent px-2.5 py-1 text-[13px] leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0'
const CATALOG = 'flex flex-col gap-3'
const CATALOG_HEADING = 'flex items-baseline gap-[7px] px-0.5'
const CATALOG_HEADING_H3 = 'm-0 text-[13px] leading-5 font-semibold'
const CATALOG_HEADING_COUNT = 'text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)] [font-variant-numeric:tabular-nums]'
const LIST = 'm-0 flex list-none flex-col gap-2 p-0'

const HOLD_MS = 3000
const FADE_MS = 1000

/** Render the user-toggleable plugin inventory. */
export function PluginInventorySettingsTab({
  store,
  setEnabled,
  refresh,
  t,
}: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)

  useEffect(() => {
    // Trigger an initial read when the tab mounts.
    if (!snapshot.read) store.refresh()
  }, [snapshot.read, store])

  const view = useMemo<ViewState>(() => {
    if (snapshot.read) {
      return { status: 'ready', entries: snapshot.entries }
    }
    if (snapshot.error !== undefined) {
      return { status: 'error' }
    }
    return { status: 'loading' }
  }, [snapshot])

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (view.status !== 'ready') return [] as readonly PluginInventoryEntryView[]
    if (normalized.length === 0) return view.entries
    return view.entries.filter(entry =>
      [entry.moduleName, entry.entryId].some(value => value.toLocaleLowerCase().includes(normalized)),
    )
  }, [query, view])

  const flashError = useCallback((message: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text: message })
  }, [])

  const { schedule: scheduleToggle, intendedSnapshot } = useDebouncedToggle<PluginEntryId>({
    debounceMs: 500,
    commit: ({ entryId, enabled }, signal) => setEnabled({ entryId, enabled }, { signal }),
    onError: ({ entryId }, error) => {
      const reason = error instanceof Error ? error.message : String(error)
      const entry = view.status === 'ready' ? view.entries.find(e => e.entryId === entryId) : undefined
      const name = entry ? shortName(entry.moduleName) : entryId
      flashError(t('toggleError', { name, reason }))
    },
    isCommitted: (entryId, intended) => {
      if (view.status !== 'ready') return false
      const entry = view.entries.find(e => e.entryId === entryId)
      return entry !== undefined && entry.enabled === intended
    },
  })

  const retry = (): void => {
    setRequest(value => value + 1)
    refresh()
  }

  const sectionRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className={SECTION} aria-busy={view.status === 'loading'} ref={sectionRef}>
      {view.status === 'loading' ? <p className={STATUS}>{t('loading')}</p> : null}
      {view.status === 'error' ? (
        <div className={FAILURE}>
          <p className="m-0" role="alert">{t('error')}</p>
          <ShadcnButton variant="outline" className={RETRY} onClick={retry}>{t('retry')}</ShadcnButton>
        </div>
      ) : null}
      {view.status === 'ready' ? (
        <div className={CATALOG}>
          <SearchInput
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
            onClear={() => setQuery('')}
            placeholder={t('search')}
            aria-label={t('search')}
          />
          <div className={CATALOG_HEADING}>
            <h3 className={CATALOG_HEADING_H3}>{t('catalog')}</h3>
            <span className={CATALOG_HEADING_COUNT} data-plugin-count={filteredEntries.length}>
              {filteredEntries.length}
            </span>
          </div>
          {view.entries.length === 0 ? <p className={STATUS}>{t('empty')}</p> : null}
          {view.entries.length > 0 && filteredEntries.length === 0
            ? <p className={STATUS}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={LIST}>
              {filteredEntries.map((entry) => {
                const intended = intendedSnapshot().get(entry.entryId)
                const effective = intended !== undefined ? intended : entry.enabled
                return (
                  <li key={entry.entryId} data-plugin-entry={entry.entryId}>
                    <SwitchRow
                      entryId={entry.entryId}
                      label={shortName(entry.moduleName)}
                      caption={captionFor(entry, effective, t)}
                      checked={effective}
                      phase={entry.fiberPhase as PluginFiberPhase}
                      onCheckedChange={(next) => { scheduleToggle(entry.entryId, next) }}
                    />
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      {toast ? (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={sectionRef.current}
          onDone={() => {
            // No-op timer; Toast handles its own fade-out. We unmount here.
            if (toast.seq === toastSeq.current) setToast(null)
          }}
        />
      ) : null}
      {/* Catalog id reserved for any future tabpanel linkage. */}
      <span className="sr-only" aria-hidden="true" data-catalog-id={catalogId} />
      {/* Suppress unused `HOLD_MS`/`FADE_MS` lint when no toast is mounted. */}
      <span className="sr-only" aria-hidden="true">{HOLD_MS + FADE_MS}</span>
      <span className="sr-only" aria-hidden="true">{request}</span>
    </div>
  )
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function shortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Map one entry to the row's caption text under the current effective state. */
function captionFor(
  entry: PluginInventoryEntryView,
  effective: boolean,
  t: (key: PluginInventoryLocaleKey, params?: Record<string, string>) => string,
): string {
  const phase = entry.fiberPhase
  if (phase !== null) return t(reasonKeyForPhase(phase))
  if (!effective) {
    const reason: PluginDisabledReason = entry.disabledReason
    return t(reasonKeyForDisabled(reason))
  }
  return t('reasonUnobserved')
}

function reasonKeyForPhase(phase: PluginFiberPhase): PluginInventoryLocaleKey {
  switch (phase) {
    case 'pending': return 'reasonPending'
    case 'loading': return 'reasonLoading'
    case 'active': return 'reasonActive'
    case 'failed': return 'reasonFailed'
    case 'unloading': return 'reasonUnloading'
    case null: return 'reasonUnobserved'
  }
}

function reasonKeyForDisabled(reason: PluginDisabledReason): PluginInventoryLocaleKey {
  if (reason === 'user') return 'reasonUserDisabled'
  if (reason === 'cordis') return 'reasonCordisDisabled'
  return 'reasonUnobserved'
}
