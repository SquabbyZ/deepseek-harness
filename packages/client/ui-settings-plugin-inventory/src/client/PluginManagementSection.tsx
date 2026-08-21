/**
 * Plugin management settings section: a top-level settings nav entry that
 * lists the loaded plugin graph in two tabs (内置插件 / 外部插件). Every row
 * carries a 详情 button (opens a bottom drawer with the entry's state) and
 * external rows additionally carry an 卸载 button left of the details button.
 */

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
  IconTrashOutline16, IconWarningOutline16, Modal, SearchInput, ShadcnButton, SwitchRow,
  Tabs, TabsList, TabsTrigger, Toast, useDebouncedToggle,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PluginDisabledReason, PluginEntryId, PluginFiberPhase, PluginInventoryEntry,
  PluginInventoryStore,
} from './inventory-store.ts'
import type { PluginInventoryLocaleKey } from './locales.ts'

/** Registration-side Remote face used by the section. */
export interface PluginManagementSectionInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<{ entries: readonly PluginInventoryEntry[] }>
  /** Trigger a fresh read; called from the retry button on read failure. */
  refresh: () => void
  /** Snapshot store carrying the last successful read + listener set. */
  store: PluginInventoryStore
  /** Toggle one entry's enabled state; throws on RPC failure. */
  setEnabled: (action: { entryId: string; enabled: boolean }, options: { signal: AbortSignal }) => Promise<void>
  /** Remove one external entry from the session; throws on RPC failure. */
  uninstall: (entryId: string, options: { signal: AbortSignal }) => Promise<void>
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginManagementSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginManagementSectionInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly entries: readonly PluginInventoryEntry[] }

type Tab = 'builtin' | 'external'

const SECTION = 'flex w-full max-w-[760px] flex-col gap-[14px] text-foreground'
const STATUS = 'm-0 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]'
const FAILURE = 'flex items-center gap-2.5 text-[13px] leading-5 text-[var(--dsw-alias-state-error-primary)]'
const RETRY = 'h-auto rounded-md border-border bg-transparent px-2.5 py-1 text-[13px] leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0'
const HEADING = 'm-0 text-[15px] leading-[22px] font-semibold'
const INTRO = 'm-0 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]'
const CATALOG = 'flex flex-col gap-3'
const LIST = 'm-0 flex list-none flex-col gap-2 p-0'
const ROW_ACTION = 'inline-flex h-7 flex-none items-center gap-1 rounded-lg border-none px-2 text-[12px] leading-[18px] text-[var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-primary)]'
const ROW_ACTION_DANGER = 'text-[var(--dsw-alias-state-error-primary)] hover:text-[var(--dsw-alias-state-error-primary)]'
const DRAWER_BODY = 'grid grid-cols-2 gap-x-5 gap-y-4 px-5 pb-6'
const DRAWER_ROW = 'flex min-w-0 flex-col gap-0.5'
const DRAWER_LABEL = 'm-0 text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const DRAWER_VALUE = 'm-0 text-[13px] leading-5 font-medium break-words'

const HOLD_MS = 3000
const FADE_MS = 1000

/** Render the plugin management settings section. */
export function PluginManagementSection({
  store, setEnabled, uninstall, refresh, t,
}: PluginManagementSectionProps): React.ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('builtin')
  const [detail, setDetail] = useState<PluginInventoryEntry | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<PluginInventoryEntry | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  const flash = useCallback((text: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])

  useEffect(() => {
    if (!snapshot.read) store.refresh()
  }, [snapshot.read, store])

  const view: ViewState = useMemo(() => {
    if (snapshot.error !== undefined) return { status: 'error' }
    if (!snapshot.read) return { status: 'loading' }
    return { status: 'ready', entries: snapshot.entries }
  }, [snapshot])

  const { schedule: scheduleToggle, intendedSnapshot } = useDebouncedToggle<PluginEntryId>({
    debounceMs: 500,
    commit: ({ entryId, enabled }, signal) => setEnabled({ entryId, enabled }, { signal }),
    onError: ({ entryId }, error) => {
      const reason = error instanceof Error ? error.message : String(error)
      const entry = view.status === 'ready' ? view.entries.find(e => e.entryId === entryId) : undefined
      const name = entry ? shortName(entry.moduleName) : entryId
      flash(t('toggleError', { name, reason }))
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

  const entries = view.status === 'ready' ? view.entries : []
  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries = useMemo(() => entries.filter((entry) => {
    const inTab = tab === 'builtin' ? entry.scope !== 'external' : entry.scope === 'external'
    if (!inTab) return false
    if (normalizedQuery === '') return true
    return entry.entryId.toLowerCase().includes(normalizedQuery)
      || entry.moduleName.toLowerCase().includes(normalizedQuery)
  }), [entries, tab, normalizedQuery])

  const requestUninstall = (entry: PluginInventoryEntry): void => {
    setUninstallTarget(entry)
  }
  const confirmUninstall = async (): Promise<void> => {
    if (uninstallTarget === null) return
    const target = uninstallTarget
    setUninstallTarget(null)
    try {
      await uninstall(target.entryId, { signal: new AbortController().signal })
      void store.refresh()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      flash(t('uninstallError', { name: shortName(target.moduleName), reason }))
    }
  }

  const openDetail = (entry: PluginInventoryEntry): void => setDetail(entry)

  return (
    <div className={SECTION} aria-busy={view.status === 'loading'} ref={sectionRef}>
      <h2 className={HEADING}>{t('title')}</h2>
      <p className={INTRO}>{t('intro')}</p>

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
          <Tabs value={tab} onValueChange={(value) => { setTab(value as Tab) }}>
            <TabsList>
              {(['builtin', 'external'] as const).map((key) => {
                const count = entries.filter(e => key === 'builtin' ? e.scope !== 'external' : e.scope === 'external').length
                return (
                  <TabsTrigger key={key} value={key} data-plugin-tab={key}>
                    {t(key === 'builtin' ? 'builtin' : 'external')}
                    <span className="ml-1 text-xs tabular-nums opacity-70">{count}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
          {entries.length === 0 ? <p className={STATUS}>{t('empty')}</p> : null}
          {entries.length > 0 && filteredEntries.length === 0
            ? <p className={STATUS}>{t('emptySearch')}</p> : null}
          {filteredEntries.length > 0 ? (
            <ul className={LIST} data-plugin-tab-list={tab}>
              {filteredEntries.map((entry) => {
                const intended = intendedSnapshot().get(entry.entryId)
                const effective = intended !== undefined ? intended : entry.enabled
                const external = entry.scope === 'external'
                return (
                  <li key={entry.entryId} data-plugin-entry={entry.entryId}>
                    <SwitchRow
                      entryId={entry.entryId}
                      label={shortName(entry.moduleName)}
                      caption={captionFor(entry, effective, t)}
                      checked={effective}
                      disabled={entry.disabledReason === 'cordis'}
                      phase={entry.fiberPhase as PluginFiberPhase}
                      actions={
                        <>
                          {external ? (
                            <ShadcnButton
                              variant="ghost"
                              className={ROW_ACTION_DANGER}
                              onClick={() => { requestUninstall(entry) }}
                              title={t('uninstall')}
                            >
                              <IconTrashOutline16 size={14} />
                              {t('uninstall')}
                            </ShadcnButton>
                          ) : null}
                          <ShadcnButton
                            variant="ghost"
                            className={ROW_ACTION}
                            onClick={() => { openDetail(entry) }}
                            title={t('detail')}
                          >
                            {t('detail')}
                          </ShadcnButton>
                        </>
                      }
                      onCheckedChange={(next) => { scheduleToggle(entry.entryId, next) }}
                    />
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Detail drawer: slides up from the bottom with the entry's state. */}
      <Drawer open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null) }}>
        <DrawerContent data-plugin-detail={detail?.entryId}>
          <DrawerHeader>
            <DrawerTitle>{t('detailTitle')}</DrawerTitle>
            <DrawerDescription>{detail ? shortName(detail.moduleName) : ''}</DrawerDescription>
          </DrawerHeader>
          {detail !== null ? (
            <div className={DRAWER_BODY}>
              <div className={`${DRAWER_ROW} col-span-2`}>
                <p className={DRAWER_LABEL}>{t('fieldModuleId')}</p>
                <p className={DRAWER_VALUE}>{detail.entryId}</p>
              </div>
              <div className={DRAWER_ROW}>
                <p className={DRAWER_LABEL}>{t('fieldScope')}</p>
                <p className={DRAWER_VALUE}>{detail.scope === 'external' ? t('fieldExternal') : t('fieldBuiltin')}</p>
              </div>
              <div className={DRAWER_ROW}>
                <p className={DRAWER_LABEL}>{t('fieldEnabled')}</p>
                <p className={DRAWER_VALUE}>{detail.enabled ? t('enabledLabel') : t('disabledLabel')}</p>
              </div>
              <div className={DRAWER_ROW}>
                <p className={DRAWER_LABEL}>{t('fieldPhase')}</p>
                <p className={DRAWER_VALUE}>{t(reasonKeyForPhase(detail.fiberPhase as PluginFiberPhase))}</p>
              </div>
              <div className={DRAWER_ROW}>
                <p className={DRAWER_LABEL}>{t('fieldReason')}</p>
                <p className={DRAWER_VALUE}>{detail.disabledReason === null ? '—' : t(reasonKeyForDisabled(detail.disabledReason))}</p>
              </div>
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>

      {/* Uninstall confirmation. */}
      <Modal
        open={uninstallTarget !== null}
        onClose={() => { setUninstallTarget(null) }}
        title={uninstallTarget === null ? '' : t('uninstallTitle', { name: shortName(uninstallTarget.moduleName) })}
        closeLabel={t('cancel')}
        footer={uninstallTarget !== null ? (
          <ShadcnButton variant="destructive" onClick={() => { void confirmUninstall() }}>
            {t('uninstall')}
          </ShadcnButton>
        ) : null}
      >
        <p className="m-0 text-[13px] leading-5">{t('uninstallHint')}</p>
      </Modal>

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

      <span className="sr-only" aria-hidden="true" data-catalog-id={catalogId} />
      {/* Suppress unused `request`/`HOLD_MS`/`FADE_MS` when no toast is mounted. */}
      <span className="sr-only" aria-hidden="true">{request + HOLD_MS + FADE_MS}</span>
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
  entry: PluginInventoryEntry,
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
  return 'reasonCordisDisabled'
}
