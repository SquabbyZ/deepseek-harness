import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import type { McpEntryId, McpInventoryEntry } from './inventory-store.ts'
import {
  IconCheckOutline16,
  IconEditOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Label,
  SearchInput,
  ShadcnButton,
  ShadcnInput,
  SwitchRow,
  Toast,
  useDebouncedToggle,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  type McpInventoryEntryView,
  type McpInventoryStore,
  type McpRegistrySearchResult,
  type McpServerSpec,
  type SmitheryServer,
} from './inventory-store.ts'
import type { McpInventoryLocaleKey } from './locales.ts'

export interface McpInventorySettingsTabInjected {
  list: () => Promise<{ entries: readonly McpInventoryEntry[] }>
  refresh: () => void
  store: McpInventoryStore
  setEnabled: (action: { entryId: string; enabled: boolean }, options: { signal: AbortSignal }) => Promise<void>
  /** Create or overwrite one server (id derived from serverName); the store re-reads after it settles. */
  upsertServer: (spec: McpServerSpec) => Promise<void>
  /** Remove one server by id; the store re-reads after it settles. */
  deleteServer: (entryId: string) => Promise<void>
  /** Search the Smithery registry for installable remote MCP servers; throws on RPC failure. */
  search: (query: string) => Promise<McpRegistrySearchResult>
  /** One-click install a Smithery server (remote → streamable-http, stdio → throws); throws on RPC failure. */
  installSmithery: (server: SmitheryServer) => Promise<void>
}

export type McpInventorySettingsTabProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly entries: readonly McpInventoryEntryView[] }

type Transport = 'stdio' | 'streamable-http'

const SECTION = 'flex w-full max-w-[760px] flex-col gap-[14px] text-foreground'
const STATUS = 'm-0 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]'
const FAILURE = 'flex items-center gap-2.5 text-[13px] leading-5 text-[var(--dsw-alias-state-error-primary)]'
const RETRY = 'h-auto rounded-md border-border bg-transparent px-2.5 py-1 text-[13px] leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0'
const CATALOG = 'flex flex-col gap-3'
const CATALOG_HEADING = 'flex items-baseline gap-[7px] px-0.5'
const CATALOG_HEADING_H3 = 'm-0 text-[13px] leading-5 font-semibold'
const CATALOG_HEADING_COUNT = 'text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)] [font-variant-numeric:tabular-nums]'
const LIST = 'm-0 flex list-none flex-col gap-2 p-0'
const ROW_ACTION = 'inline-flex h-7 flex-none items-center gap-1 rounded-lg border-none px-2 text-[12px] leading-[18px] text-[var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-primary)]'
const ROW_ACTION_DANGER = 'text-[var(--dsw-alias-state-error-primary)] hover:text-[var(--dsw-alias-state-error-primary)]'
const ADD_TOGGLE = 'self-start rounded-md border-border bg-transparent px-2.5 py-1.5 text-[13px] leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground'
const FORM = 'flex flex-col gap-3 rounded-[10px] border border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-alias-bg-layer-1)] p-3'
const FORM_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2'
const FORM_FIELD = 'flex min-w-0 flex-col gap-1'
const FORM_ACTIONS = 'flex items-center justify-end gap-2'
const FORM_ERROR = 'm-0 text-[12px] leading-[18px] text-[var(--dsw-alias-state-error-primary)]'
const FORM_NOTE = 'm-0 text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const SELECT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const REMOTE_ROW =
  'flex items-center justify-between gap-3 rounded-[10px] border border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-alias-bg-layer-1)] px-3 py-2.5'
const REMOTE_LEADING = 'flex min-w-0 flex-col'
const REMOTE_NAME = 'm-0 truncate text-sm leading-5 font-semibold text-[var(--dsw-alias-label-primary)]'
const REMOTE_CAPTION = 'm-0 truncate text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const INSTALL_BUTTON = 'h-auto flex-none rounded-md px-2.5 py-1 text-[13px] leading-5'
const STDIO_HINT = 'm-0 text-[12px] leading-[18px] text-[var(--dsw-alias-state-error-primary)]'

/** Smithery registry search section state. */
type RemoteState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly servers: readonly SmitheryServer[] }
  | { readonly status: 'error' }

/** Debounce before a keystroke hits the Smithery registry. */
const SEARCH_DEBOUNCE_MS = 200

/** Split a whitespace-separated argument string into argv (empty string → no args). */
function parseArgs(raw: string): string[] {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/)
}

/** Stable entry id derived from a server name (slug); the tab and the fixture agree on it. */
function mcpServerId(serverName: string): string {
  const slug = serverName.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'mcp'
}

export function McpInventorySettingsTab({
  store,
  setEnabled,
  upsertServer,
  deleteServer,
  refresh,
  search,
  installSmithery,
  t,
}: McpInventorySettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [toast, setToast] = useState<{ seq: number; kind: 'success' | 'error'; text: string } | null>(null)
  const toastSeq = useRef(0)
  const [remote, setRemote] = useState<RemoteState>({ status: 'idle' })
  const [installing, setInstalling] = useState<string | null>(null)

  // Collapsible add/edit form state.
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<McpEntryId | null>(null)
  const [transport, setTransport] = useState<Transport>('stdio')
  const [serverName, setServerName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
    if (view.status !== 'ready') return [] as readonly McpInventoryEntryView[]
    if (normalized.length === 0) return view.entries
    return view.entries.filter(entry =>
      [entry.serverName, entry.target].some(value => value.toLocaleLowerCase().includes(normalized)),
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

  const { schedule: scheduleToggle, intendedSnapshot } = useDebouncedToggle<McpEntryId>({
    debounceMs: 500,
    commit: ({ entryId, enabled }, signal) => setEnabled({ entryId, enabled }, { signal }),
    onError: ({ entryId }, error) => {
      const reason = error instanceof Error ? error.message : String(error)
      const entry = view.status === 'ready' ? view.entries.find(e => e.entryId === entryId) : undefined
      const name = entry?.serverName ?? entryId
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
          if (!cancelled) setRemote({ status: 'ready', servers: value.servers })
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

  const handleInstall = useCallback(async (server: SmitheryServer): Promise<void> => {
    setInstalling(server.qualifiedName)
    try {
      await installSmithery(server)
      store.refresh()
      flashSuccess(t('installSuccess', { name: server.displayName }))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      flashError(t('installFailed', { name: server.displayName, reason }))
    } finally {
      setInstalling(null)
    }
  }, [installSmithery, store, t, flashError, flashSuccess])

  const openAdd = (): void => {
    setEditing(null)
    setTransport('stdio')
    setServerName('')
    setCommand('')
    setArgs('')
    setUrl('')
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (entry: McpInventoryEntryView): void => {
    const nextTransport: Transport = entry.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
    setEditing(entry.entryId)
    setTransport(nextTransport)
    setServerName(entry.serverName)
    if (nextTransport === 'stdio') {
      setCommand(entry.target)
      setArgs('')
    } else {
      setUrl(entry.target)
    }
    setFormError(null)
    setFormOpen(true)
  }

  const closeForm = (): void => {
    setFormOpen(false)
    setEditing(null)
    setFormError(null)
  }

  const submit = async (): Promise<void> => {
    const name = serverName.trim()
    const requiredMissing = name.length === 0
      || (transport === 'stdio' ? command.trim().length === 0 : url.trim().length === 0)
    if (requiredMissing) {
      setFormError(t('validationRequired'))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const spec: McpServerSpec = transport === 'stdio'
        ? { transport: 'stdio', serverName: name, command: command.trim(), args: parseArgs(args), env: {}, cwd: '' }
        : { transport: 'streamable-http', serverName: name, url: url.trim(), headers: {} }
      await upsertServer(spec)
      // Renaming derives a fresh id from the new serverName, so the old id would
      // otherwise be left behind as a duplicate row; remove it once the upsert lands.
      if (editing !== null && mcpServerId(name) !== editing) {
        await deleteServer(editing)
      }
      closeForm()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setFormError(t('upsertError', { name, reason }))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entry: McpInventoryEntryView): Promise<void> => {
    try {
      await deleteServer(entry.entryId)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      flashError(t('deleteError', { name: entry.serverName, reason }))
    }
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
          <ShadcnButton
            variant="outline"
            className={ADD_TOGGLE}
            onClick={formOpen ? closeForm : openAdd}
            aria-expanded={formOpen}
          >
            <IconPlusOutline16 size={14} />
            {formOpen ? t('cancel') : t('addServer')}
          </ShadcnButton>
          {formOpen ? (
            <form
              className={FORM}
              onSubmit={(event) => { event.preventDefault(); void submit() }}
              aria-label={editing !== null ? t('editServer', { name: serverName }) : t('addServer')}
            >
              <div className={FORM_GRID}>
                <div className={FORM_FIELD}>
                  <Label htmlFor="mcp-transport">{t('transport')}</Label>
                  <select
                    id="mcp-transport"
                    className={SELECT}
                    value={transport}
                    onChange={(event) => { setTransport(event.currentTarget.value as Transport) }}
                  >
                    <option value="stdio">{t('transportStdio')}</option>
                    <option value="streamable-http">{t('transportStreamableHttp')}</option>
                  </select>
                </div>
                <div className={FORM_FIELD}>
                  <Label htmlFor="mcp-server-name">{t('serverName')}</Label>
                  <ShadcnInput
                    id="mcp-server-name"
                    value={serverName}
                    onChange={(event) => { setServerName(event.currentTarget.value) }}
                  />
                </div>
                {transport === 'stdio' ? (
                  <>
                    <div className={FORM_FIELD}>
                      <Label htmlFor="mcp-command">{t('command')}</Label>
                      <ShadcnInput
                        id="mcp-command"
                        value={command}
                        onChange={(event) => { setCommand(event.currentTarget.value) }}
                      />
                    </div>
                    <div className={FORM_FIELD}>
                      <Label htmlFor="mcp-args">{t('args')}</Label>
                      <ShadcnInput
                        id="mcp-args"
                        value={args}
                        onChange={(event) => { setArgs(event.currentTarget.value) }}
                      />
                    </div>
                  </>
                ) : (
                  <div className={FORM_FIELD}>
                    <Label htmlFor="mcp-url">{t('url')}</Label>
                    <ShadcnInput
                      id="mcp-url"
                      value={url}
                      onChange={(event) => { setUrl(event.currentTarget.value) }}
                    />
                  </div>
                )}
              </div>
              {transport === 'stdio' && editing !== null ? (
                <p className={FORM_NOTE} role="note">{t('editArgsHint')}</p>
              ) : null}
              {formError ? <p className={FORM_ERROR} role="alert">{formError}</p> : null}
              <div className={FORM_ACTIONS}>
                <ShadcnButton type="button" variant="ghost" onClick={closeForm} disabled={saving}>
                  {t('cancel')}
                </ShadcnButton>
                <ShadcnButton type="submit" disabled={saving}>
                  {saving ? t('saving') : t('save')}
                </ShadcnButton>
              </div>
            </form>
          ) : null}
          <div className={CATALOG_HEADING}>
            <h3 className={CATALOG_HEADING_H3}>{t('catalog')}</h3>
            <span className={CATALOG_HEADING_COUNT} data-mcp-count={filteredEntries.length}>
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
                const transportKey = `transport${entry.transport.charAt(0).toUpperCase()}${entry.transport.slice(1).replace(/-./g, x => x.charAt(1).toUpperCase())}` as McpInventoryLocaleKey
                const transportLabel = t(transportKey)
                return (
                  <li key={entry.entryId} data-mcp-entry={entry.entryId}>
                    <SwitchRow
                      entryId={entry.entryId}
                      label={entry.serverName}
                      caption={entry.target ? `${transportLabel} · ${entry.target}` : transportLabel}
                      checked={effective}
                      onCheckedChange={(next) => { scheduleToggle(entry.entryId, next) }}
                      actions={
                        <>
                          <ShadcnButton
                            variant="ghost"
                            className={ROW_ACTION}
                            onClick={() => { openEdit(entry) }}
                            title={t('edit')}
                          >
                            <IconEditOutline16 size={14} />
                            {t('edit')}
                          </ShadcnButton>
                          <ShadcnButton
                            variant="ghost"
                            className={`${ROW_ACTION} ${ROW_ACTION_DANGER}`}
                            onClick={() => { void remove(entry) }}
                            title={t('delete')}
                          >
                            <IconTrashOutline16 size={14} />
                            {t('delete')}
                          </ShadcnButton>
                        </>
                      }
                    />
                  </li>
                )
              })}
            </ul>
          ) : null}

          {query.trim().length > 0 ? (
            <div className={CATALOG} data-remote-results="">
              <div className={CATALOG_HEADING}>
                <h3 className={CATALOG_HEADING_H3}>{t('searchSmithery')}</h3>
              </div>
              {remote.status === 'loading' ? <p className={STATUS}>{t('searching')}</p> : null}
              {remote.status === 'error' ? <p className={FAILURE} role="alert">{t('registryError')}</p> : null}
              {remote.status === 'ready' && remote.servers.length === 0
                ? <p className={STATUS}>{t('registryEmpty')}</p>
                : null}
              {remote.status === 'ready' && remote.servers.length > 0 ? (
                <ul className={LIST}>
                  {remote.servers.map((server) => {
                    const caption = [
                      server.description,
                      server.remote ? t('remoteBadge') : t('stdioBadge'),
                      server.useCount > 0 ? t('useCount', { count: String(server.useCount) }) : '',
                    ].filter(Boolean).join(' · ')
                    const busy = installing === server.qualifiedName
                    const needsManual = !server.remote
                    return (
                      <li key={server.qualifiedName} data-remote-server={server.qualifiedName}>
                        <div className={REMOTE_ROW}>
                          <div className={REMOTE_LEADING}>
                            <p className={REMOTE_NAME}>{server.displayName}</p>
                            {caption !== '' ? <p className={REMOTE_CAPTION}>{caption}</p> : null}
                            {needsManual ? <p className={STDIO_HINT} role="note">{t('stdioManualHint')}</p> : null}
                          </div>
                          <ShadcnButton
                            size="sm"
                            className={INSTALL_BUTTON}
                            disabled={busy || needsManual}
                            title={needsManual ? t('stdioManualHint') : undefined}
                            onClick={() => { void handleInstall(server) }}
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
