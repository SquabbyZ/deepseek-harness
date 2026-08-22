import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import {
  SearchInput,
  ShadcnButton,
  SwitchRow,
  Toast,
  IconCheckOutline16,
  IconWarningOutline16,
  useDebouncedToggle,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  type SkillEntryId,
  type SkillInventoryEntry,
  type SkillInventoryEntryView,
  type SkillInventoryStore,
  type SkillRegistryInstallTarget,
  type SkillRegistrySearchResult,
  type SkillRegistrySkill,
} from './inventory-store.ts'
import type { SkillInventoryLocaleKey } from './locales.ts'

/** Registration-side Remote face used by the section. */
export interface SkillInventorySettingsTabInjected {
  /** Read the current Host inventory snapshot. */
  list: () => Promise<{ entries: readonly SkillInventoryEntry[] }>
  /** Trigger a fresh read; called from the retry button on read failure. */
  refresh: () => void
  /** Snapshot store carrying the last successful read + listener set. */
  store: SkillInventoryStore
  /** Toggle one entry's enabled state; throws on RPC failure. */
  setEnabled: (action: { entryId: string; enabled: boolean }, options: { signal: AbortSignal }) => Promise<void>
  /** Search skills.sh for installable remote skills; throws on RPC failure. */
  search: (query: string) => Promise<SkillRegistrySearchResult>
  /** Install a remote skill into `~/.dsh/skills/{name}`; throws on RPC failure. */
  install: (target: SkillRegistryInstallTarget) => Promise<void>
}

/** Full component props assembled by the Settings slot renderer. */
export type SkillInventorySettingsTabProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.skill'>
  & InjectFace<SkillInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly entries: readonly SkillInventoryEntryView[] }

/** skills.sh search section state. */
type RemoteState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly skills: readonly SkillRegistrySkill[] }
  | { readonly status: 'error' }

/** Debounce before a keystroke hits the skills.sh registry. */
const SEARCH_DEBOUNCE_MS = 200

const SECTION = 'flex w-full max-w-[760px] flex-col gap-[14px] text-foreground'
const STATUS = 'm-0 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]'
const FAILURE = 'flex items-center gap-2.5 text-[13px] leading-5 text-[var(--dsw-alias-state-error-primary)]'
const RETRY = 'h-auto rounded-md border-border bg-transparent px-2.5 py-1 text-[13px] leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0'
const CATALOG = 'flex flex-col gap-3'
const CATALOG_HEADING = 'flex items-baseline gap-[7px] px-0.5'
const CATALOG_HEADING_H3 = 'm-0 text-[13px] leading-5 font-semibold'
const CATALOG_HEADING_COUNT = 'text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)] [font-variant-numeric:tabular-nums]'
const LIST = 'm-0 flex list-none flex-col gap-2 p-0'
const REMOTE_ROW =
  'flex items-center justify-between gap-3 rounded-[10px] border border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-alias-bg-layer-1)] px-3 py-2.5'
const REMOTE_LEADING = 'flex min-w-0 flex-col'
const REMOTE_NAME = 'm-0 truncate text-sm leading-5 font-semibold text-[var(--dsw-alias-label-primary)]'
const REMOTE_CAPTION = 'm-0 truncate text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const INSTALL_BUTTON = 'h-auto flex-none rounded-md px-2.5 py-1 text-[13px] leading-5'

/** Render the user-toggleable skill inventory + skills.sh search / install. */
export function SkillInventorySettingsTab({
  store,
  setEnabled,
  refresh,
  search,
  install,
  t,
}: SkillInventorySettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [toast, setToast] = useState<{ seq: number; kind: 'success' | 'error'; text: string } | null>(null)
  const toastSeq = useRef(0)
  const [remote, setRemote] = useState<RemoteState>({ status: 'idle' })
  const [installing, setInstalling] = useState<string | null>(null)

  useEffect(() => {
    if (!snapshot.read) store.refresh()
  }, [snapshot.read, store])

  const view = useMemo<ViewState>(() => {
    if (snapshot.read) return { status: 'ready', entries: snapshot.entries }
    if (snapshot.error !== undefined) return { status: 'error' }
    return { status: 'loading' }
  }, [snapshot])

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (view.status !== 'ready') return [] as readonly SkillInventoryEntryView[]
    if (normalized.length === 0) return view.entries
    return view.entries.filter(entry =>
      [entry.name, entry.description].some(value => value.toLocaleLowerCase().includes(normalized)),
    )
  }, [query, view])

  const flash = useCallback((kind: 'success' | 'error', message: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, kind, text: message })
  }, [])

  const flashError = useCallback((message: string): void => {
    flash('error', message)
  }, [flash])

  const flashSuccess = useCallback((message: string): void => {
    flash('success', message)
  }, [flash])

  const { schedule: scheduleToggle, intendedSnapshot } = useDebouncedToggle<SkillEntryId>({
    debounceMs: 500,
    commit: ({ entryId, enabled }, signal) => setEnabled({ entryId, enabled }, { signal }),
    onError: ({ entryId }, error) => {
      const reason = error instanceof Error ? error.message : String(error)
      const entry = view.status === 'ready' ? view.entries.find(e => e.entryId === entryId) : undefined
      const name = entry?.name ?? entryId
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

  // The injected `search` may be recreated per render; hold the latest in a ref
  // so the debounced effect keys only on the query text.
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  }, [search])

  useEffect(() => {
    const normalized = query.trim()
    if (normalized.length === 0) {
      setRemote({ status: 'idle' })
      return
    }
    setRemote({ status: 'loading' })
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchRef.current(normalized).then(
        (value) => {
          if (!cancelled) setRemote({ status: 'ready', skills: value.skills })
        },
        () => {
          if (!cancelled) setRemote({ status: 'error' })
        },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const handleInstall = useCallback(async (skill: SkillRegistrySkill): Promise<void> => {
    // Two registry rows can share a display name but never a source/name pair,
    // so the busy state is keyed by the same composite id the row uses.
    const installKey = `${skill.source}/${skill.name}`
    setInstalling(installKey)
    try {
      await install({ name: skill.name, source: skill.source })
      store.refresh()
      flashSuccess(t('installSuccess', { name: skill.name }))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      flashError(t('installFailed', { name: skill.name, reason }))
    } finally {
      setInstalling(null)
    }
  }, [install, store, t, flashError, flashSuccess])

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
            <span className={CATALOG_HEADING_COUNT} data-skill-count={filteredEntries.length}>
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
                const sourceKey = `source${entry.source.charAt(0).toUpperCase()}${entry.source.slice(1).replace(/-./g, x => x.slice(1).toUpperCase())}` as SkillInventoryLocaleKey
                const sourceLabel = t(sourceKey)
                return (
                  <li key={entry.entryId} data-skill-entry={entry.entryId}>
                    <SwitchRow
                      entryId={entry.entryId}
                      label={entry.name}
                      caption={entry.description || sourceLabel}
                      checked={effective}
                      onCheckedChange={(next) => { scheduleToggle(entry.entryId, next) }}
                    />
                  </li>
                )
              })}
            </ul>
          ) : null}

          {query.trim().length > 0 ? (
            <div className={CATALOG} data-remote-results="">
              <div className={CATALOG_HEADING}>
                <h3 className={CATALOG_HEADING_H3}>{t('searchSkillsSh')}</h3>
              </div>
              {remote.status === 'loading' ? <p className={STATUS}>{t('searching')}</p> : null}
              {remote.status === 'error' ? <p className={FAILURE} role="alert">{t('registryError')}</p> : null}
              {remote.status === 'ready' && remote.skills.length === 0
                ? <p className={STATUS}>{t('registryEmpty')}</p>
                : null}
              {remote.status === 'ready' && remote.skills.length > 0 ? (
                <ul className={LIST}>
                  {remote.skills.map((skill) => {
                    const caption = [
                      skill.description,
                      skill.installs > 0 ? t('installs', { count: String(skill.installs) }) : '',
                    ].filter(Boolean).join(' · ')
                    const busy = installing === `${skill.source}/${skill.name}`
                    return (
                      <li key={`${skill.source}/${skill.name}`} data-remote-skill={skill.name}>
                        <div className={REMOTE_ROW}>
                          <div className={REMOTE_LEADING}>
                            <p className={REMOTE_NAME}>{skill.name}</p>
                            {caption !== '' ? <p className={REMOTE_CAPTION}>{caption}</p> : null}
                          </div>
                          <ShadcnButton
                            size="sm"
                            className={INSTALL_BUTTON}
                            disabled={busy}
                            onClick={() => { void handleInstall(skill) }}
                          >
                            {busy ? t('installing') : t('install')}
                          </ShadcnButton>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {toast ? (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={toast.kind === 'success' ? <IconCheckOutline16 /> : <IconWarningOutline16 />}
          anchor={sectionRef.current}
          onDone={() => {
            if (toast.seq === toastSeq.current) setToast(null)
          }}
        />
      ) : null}
      <span className="sr-only" aria-hidden="true">{request}</span>
    </div>
  )
}
